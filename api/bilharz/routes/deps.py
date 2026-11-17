"""What the routers share: app state, the decision setting, the signed-in
account, and the checks of who may do what."""
import hmac
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, Request

from ..accounts import Account
from ..sessions import COOKIE_PLAIN, COOKIE_SECURE
from ..triage import Rule


def state(request: Request):
    return request.app.state


def rule_for(request: Request, setting: str | None) -> Rule:
    """The named decision setting's rule (the default if None); 422 if unknown."""
    config = state(request).triage
    try:
        return config.rule(setting)
    except KeyError:
        names = ", ".join(config.rules)
        raise HTTPException(422, f"Unknown setting. Use one of: {names}.") from None


def require_known(request: Request, sample_id: str) -> None:
    if sample_id not in state(request).samples:
        raise HTTPException(404, "Sample not found.")


# Who is signed in --------------------------------------------------------------


def cookie_name(request: Request) -> str:
    return COOKIE_SECURE if state(request).settings.cookie_secure else COOKIE_PLAIN


def session_token(request: Request) -> str | None:
    return request.cookies.get(cookie_name(request))


def current_account(request: Request) -> Account | None:
    """The account of the session cookie, or None. A disabled account has no session."""
    app = state(request)
    account_id = app.sessions.account_id(session_token(request))
    account = app.accounts.get(account_id) if account_id is not None else None
    if account is None or account.status == "disabled":
        return None
    return account


@dataclass(frozen=True)
class Reviewer:
    """The account a review is recorded under."""

    id: int
    name: str


def current_reviewer(account: Account | None = Depends(current_account)) -> Reviewer | None:
    """The signed-in, approved reviewer (admins review too), from the server-side
    session; None otherwise. A review's reviewer comes only from here, never from
    the request body."""
    if account is None or not account.can_review:
        return None
    return Reviewer(id=account.id, name=account.name)


def require_account(account: Account | None = Depends(current_account)) -> Account:
    """Any signed-in account, pending ones included: 401 otherwise."""
    if account is None:
        raise HTTPException(401, "Sign in first.")
    return account


def require_reviewer(
    reviewer: Reviewer | None = Depends(current_reviewer),
    account: Account | None = Depends(current_account),
) -> Reviewer:
    """Recording and reading reviews: 401 if not signed in, 403 if not approved."""
    if reviewer is not None:
        return reviewer
    if account is None:
        raise HTTPException(401, "Sign in as a reviewer to do this.")
    raise HTTPException(403, "Your account is waiting for an admin to approve it.")


def require_admin_account(account: Account | None = Depends(current_account)) -> Account:
    """Managing accounts: a signed-in, approved admin only."""
    if account is None:
        raise HTTPException(401, "Sign in first.")
    if not account.is_admin:
        raise HTTPException(403, "Only an admin can do this.")
    return account


# The admin token ---------------------------------------------------------------


def token_matches(given: str | None, expected: str) -> bool:
    """Constant-time comparison of a secret from a request header."""
    return given is not None and hmac.compare_digest(given.encode(), expected.encode())


def require_admin(
    request: Request,
    x_admin_token: str | None = Header(default=None),
    account: Account | None = Depends(current_account),
) -> None:
    """Exporting and deleting reviews: a signed-in admin, or the admin token
    (the emergency fallback). Without either: 403."""
    if account is not None and account.is_admin:
        return
    expected = state(request).settings.admin_token
    if not expected:
        raise HTTPException(403, "This is turned off on this server: no admin token is set.")
    if not token_matches(x_admin_token, expected):
        raise HTTPException(403, "Not allowed.")
