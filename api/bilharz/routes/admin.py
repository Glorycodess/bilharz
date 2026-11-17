"""Managing accounts: approve, disable, change role, make a reset link; and
the first admin, who makes themselves admin with BILHARZ_ADMIN_TOKEN."""
import logging
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from .. import schemas
from ..accounts import Account, AccountsUnavailable, now_iso
from ..sessions import token_hash
from .auth import UNAVAILABLE, account_out
from .deps import require_account, require_admin_account, state, token_matches

log = logging.getLogger("bilharz")
router = APIRouter(prefix="/admin")

RESET_SECONDS = 60 * 60


def _target(request: Request, account_id: int) -> Account:
    account = state(request).accounts.get(account_id)
    if account is None:
        raise HTTPException(404, "No such account.")
    return account


def _update(request: Request, account_id: int, **changes) -> Account:
    try:
        return state(request).accounts.update(account_id, **changes)
    except AccountsUnavailable:
        raise HTTPException(500, UNAVAILABLE) from None


def _listed(request: Request, account: Account) -> dict:
    active = account.reset_token_hash is not None and (account.reset_expires_at or 0) > state(request).clock()
    return dict(**account_out(account), created_at=account.created_at, approved_at=account.approved_at,
                reset_link_active=active)


@router.post(
    "/claim",
    response_model=schemas.AccountOut,
    responses={403: {"description": "No admin token set, or a wrong one"}, 429: {"description": "Too many wrong tokens"}},
)
def claim_admin(
    request: Request,
    x_admin_token: str | None = Header(default=None),
    account: Account = Depends(require_account),
):
    """Make the signed-in account an approved admin, with the admin token in
    X-Admin-Token. This is how the first admin is made, and the way back in if
    every admin is locked out. Five wrong tokens per account in 15 minutes: 429."""
    app = state(request)
    expected = app.settings.admin_token
    if not expected:
        raise HTTPException(403, "This is turned off on this server: no admin token is set.")
    key = str(account.id)
    if app.limits.claim_account.blocked(key):
        raise HTTPException(429, "Too many attempts. Wait 15 minutes and try again.")
    if not token_matches(x_admin_token, expected):
        app.limits.claim_account.hit(key)
        raise HTTPException(403, "That admin token isn't valid.")
    app.limits.claim_account.clear(key)
    updated = _update(request, account.id, role="admin", status="approved", approved_at=account.approved_at or now_iso(),
                      approved_by=account.approved_by or account.id)
    log.info("Account %d became an admin with the admin token", account.id)
    return account_out(updated)


@router.get("/accounts", response_model=list[schemas.AccountListItem])
def list_accounts(request: Request, admin: Account = Depends(require_admin_account)):
    """Every account, oldest first, pending ones included."""
    return [_listed(request, a) for a in state(request).accounts.all()]


@router.post("/accounts/{account_id}/approve", response_model=schemas.AccountListItem,
             responses={404: {"description": "No such account"}})
def approve(request: Request, account_id: int, admin: Account = Depends(require_admin_account)):
    """Let a pending (or disabled) account review."""
    target = _target(request, account_id)
    updated = _update(request, target.id, status="approved", approved_at=now_iso(), approved_by=admin.id,
                      disabled_at=None)
    log.info("Account %d approved by account %d", target.id, admin.id)
    return _listed(request, updated)


@router.post("/accounts/{account_id}/disable", response_model=schemas.AccountListItem,
             responses={404: {"description": "No such account"}, 409: {"description": "Your own account"}})
def disable(request: Request, account_id: int, admin: Account = Depends(require_admin_account)):
    """Turn an account off: it is signed out everywhere and cannot sign in. Its
    reviews stay, with its name."""
    target = _target(request, account_id)
    if target.id == admin.id:
        raise HTTPException(409, "You can't disable your own account.")
    updated = _update(request, target.id, status="disabled", disabled_at=now_iso(), reset_token_hash=None,
                      reset_expires_at=None)
    ended = state(request).sessions.end_all(target.id)
    log.info("Account %d disabled by account %d (%d session(s) ended)", target.id, admin.id, ended)
    return _listed(request, updated)


@router.post("/accounts/{account_id}/role", response_model=schemas.AccountListItem,
             responses={404: {"description": "No such account"}, 409: {"description": "Your own account"}})
def set_role(request: Request, account_id: int, body: schemas.RoleIn, admin: Account = Depends(require_admin_account)):
    """Make an account a reviewer or an admin."""
    target = _target(request, account_id)
    if target.id == admin.id and body.role != "admin":
        raise HTTPException(409, "You can't remove your own admin role.")
    updated = _update(request, target.id, role=body.role)
    log.info("Account %d is now %s (by account %d)", target.id, body.role, admin.id)
    return _listed(request, updated)


@router.post("/accounts/{account_id}/reset-link", response_model=schemas.ResetLink,
             responses={404: {"description": "No such account"}, 409: {"description": "Account disabled"}})
def reset_link(request: Request, account_id: int, admin: Account = Depends(require_admin_account)):
    """A one-time link, valid for an hour, to set a new password. Only its hash
    is stored, and a new link replaces an older one. Give it to the account's
    owner yourself: Bilharz sends no email."""
    target = _target(request, account_id)
    if target.status == "disabled":
        raise HTTPException(409, "Approve the account again before making a reset link.")
    token = secrets.token_urlsafe(32)
    expires = state(request).clock() + RESET_SECONDS
    _update(request, target.id, reset_token_hash=token_hash(token), reset_expires_at=expires)
    log.info("Reset link made for account %d by account %d", target.id, admin.id)
    # The page's own origin (checked by the Origin check), so the link opens the
    # site the admin is using. The token is after #, so it is never sent to a
    # server or written into a log.
    origin = request.headers.get("origin") or str(request.base_url).rstrip("/")
    return dict(url=f"{origin}/reset-password#token={token}",
                expires_at=datetime.fromtimestamp(expires, timezone.utc).isoformat(timespec="seconds"))
