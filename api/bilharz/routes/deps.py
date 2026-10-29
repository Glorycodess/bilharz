"""What the routers share: app state, the decision setting, and the secret checks."""
import hmac

from fastapi import Header, HTTPException, Request

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


def _matches(given: str | None, expected: str) -> bool:
    """Constant-time comparison of a secret from a request header."""
    return given is not None and hmac.compare_digest(given.encode(), expected.encode())


def require_admin(request: Request, x_admin_token: str | None = Header(default=None)) -> None:
    """Admin-only endpoints: off (403) unless BILHARZ_ADMIN_TOKEN is set, then it must match."""
    expected = state(request).settings.admin_token
    if not expected:
        raise HTTPException(403, "This is turned off on this server: no admin token is set.")
    if not _matches(x_admin_token, expected):
        raise HTTPException(403, "Not allowed.")


def has_review_access(request: Request, x_review_code: str | None) -> bool:
    """True if no review code is configured, or the right one was sent."""
    expected = state(request).settings.review_code
    return not expected or _matches(x_review_code, expected)


def require_review_code(request: Request, x_review_code: str | None = Header(default=None)) -> None:
    """Review endpoints: open unless BILHARZ_REVIEW_CODE is set, then the code must match."""
    expected = state(request).settings.review_code
    if not expected:
        return
    if x_review_code is None:
        raise HTTPException(403, "A review access code is required.")
    if not _matches(x_review_code, expected):
        raise HTTPException(403, "That review code isn't valid.")
