"""Reviewer accounts: sign up, sign in, sign out, who is signed in, and
setting a new password from a reset link an admin made."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from .. import schemas
from ..accounts import Account, AccountsUnavailable, EmailTaken, email_problem, name_problem, normalise_email
from ..passwords import hash_password, needs_rehash, password_problem, verify_password
from ..sessions import MAX_SECONDS, token_hash
from .deps import cookie_name, current_account, session_token, state

router = APIRouter(prefix="/auth")

UNAVAILABLE = "Accounts can't be saved on this server right now. Try again later."
TOO_MANY = "Too many attempts. Wait 15 minutes and try again."


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def account_out(account: Account) -> dict:
    return dict(id=account.id, name=account.name, email=account.email, role=account.role, status=account.status)


def start_session(request: Request, response: Response, account: Account) -> None:
    """End the session this browser had (if any) and start a new one: a token
    issued before sign-in is never reused after it."""
    app = state(request)
    app.sessions.end(session_token(request))
    token = app.sessions.create(account.id)
    response.set_cookie(
        cookie_name(request),
        token,
        max_age=MAX_SECONDS,
        path="/",
        secure=app.settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )


def end_session(request: Request, response: Response) -> None:
    state(request).sessions.end(session_token(request))
    response.delete_cookie(
        cookie_name(request), path="/", secure=state(request).settings.cookie_secure, httponly=True, samesite="lax"
    )


@router.post(
    "/signup",
    response_model=schemas.AccountOut,
    status_code=201,
    responses={409: {"description": "Email already used"}, 422: {"description": "Invalid name, email or password"},
               429: {"description": "Too many sign-ups from this address"}, 500: {"description": "Accounts can't be saved"}},
)
def sign_up(request: Request, response: Response, body: schemas.SignUpIn):
    """Create an account. It starts as a pending reviewer, signed in, and can
    review once an admin approves it."""
    app = state(request)
    ip = client_ip(request)
    if app.limits.signup_ip.blocked(ip):
        raise HTTPException(429, TOO_MANY)
    problem = name_problem(body.name) or email_problem(body.email) or password_problem(body.password)
    if problem:
        raise HTTPException(422, problem)
    if not app.accounts.writable:
        raise HTTPException(500, UNAVAILABLE)
    app.limits.signup_ip.hit(ip)
    try:
        account = app.accounts.create(body.name, body.email, hash_password(body.password))
    except EmailTaken:
        raise HTTPException(409, "An account with this email already exists. Sign in instead.") from None
    except AccountsUnavailable:
        raise HTTPException(500, UNAVAILABLE) from None
    start_session(request, response, account)
    return account_out(account)


@router.post(
    "/signin",
    response_model=schemas.AccountOut,
    responses={401: {"description": "Wrong email or password"}, 403: {"description": "Account disabled"},
               429: {"description": "Too many failed attempts"}},
)
def sign_in(request: Request, response: Response, body: schemas.SignInIn):
    """Sign in with email and password. After 5 wrong passwords for one account,
    or 20 from one address, within 15 minutes, sign-in waits (429), even with
    the right password."""
    app = state(request)
    email, ip = normalise_email(body.email), client_ip(request)
    if app.limits.signin_account.blocked(email) or app.limits.signin_ip.blocked(ip):
        raise HTTPException(429, TOO_MANY)
    account = app.accounts.by_email(email)
    # Unknown email: the same hashing work as a wrong password, and the same answer.
    if not verify_password(account.password_hash if account else None, body.password):
        app.limits.signin_account.hit(email)
        app.limits.signin_ip.hit(ip)
        raise HTTPException(401, "The email or password is wrong.")
    if account.status == "disabled":
        raise HTTPException(403, "This account has been disabled. Ask an admin.")
    app.limits.signin_account.clear(email)
    if needs_rehash(account.password_hash):
        try:
            account = app.accounts.update(account.id, password_hash=hash_password(body.password))
        except AccountsUnavailable:
            pass  # the old hash still works; upgrade it next time
    start_session(request, response, account)
    return account_out(account)


@router.post("/signout", status_code=204, response_class=Response)
def sign_out(request: Request):
    """End this browser's session. Always succeeds."""
    response = Response(status_code=204)
    end_session(request, response)
    return response


@router.get("/me", response_model=schemas.Me)
def me(account: Account | None = Depends(current_account)):
    """The signed-in account (pending ones included), or null."""
    return dict(account=account_out(account) if account else None)


@router.post(
    "/reset",
    status_code=204,
    response_class=Response,
    responses={400: {"description": "Link not valid or expired"}, 422: {"description": "Password not acceptable"},
               429: {"description": "Too many failed attempts"}},
)
def reset_password(request: Request, body: schemas.ResetIn):
    """Set a new password with the token from a reset link an admin made. The
    link works once, for one hour; afterwards every session of the account ends."""
    app = state(request)
    ip = client_ip(request)
    if app.limits.reset_ip.blocked(ip):
        raise HTTPException(429, TOO_MANY)
    account = app.accounts.by_reset_token_hash(token_hash(body.token)) if body.token else None
    if account is None or account.reset_expires_at is None or app.clock() > account.reset_expires_at:
        app.limits.reset_ip.hit(ip)
        raise HTTPException(400, "This reset link is not valid or has expired. Ask an admin for a new one.")
    problem = password_problem(body.password)
    if problem:
        raise HTTPException(422, problem)
    try:
        app.accounts.update(
            account.id,
            password_hash=hash_password(body.password),
            reset_token_hash=None,
            reset_expires_at=None,
            password_changed_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )
    except AccountsUnavailable:
        raise HTTPException(500, UNAVAILABLE) from None
    app.sessions.end_all(account.id)
    app.limits.signin_account.clear(account.email)
    return Response(status_code=204)
