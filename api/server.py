"""The Bilharz API. Run locally with `uvicorn server:app --port 8000`.

`create_app` builds the app; `server.app` is the default one, built on first
use, so importing this module (tests, the Space entry point) has no side effects.
"""
import asyncio
import logging
import os

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from bilharz.accounts import AccountStore
from bilharz.clock import Clock
from bilharz.ratelimit import RateLimiter
from bilharz.reviews import ReviewJournal, ReviewStore
from bilharz.routes import router
from bilharz.samples import SampleStore, TileArchive
from bilharz.scoring import Scorer, load_scorer
from bilharz.security import UploadError, configure_pillow
from bilharz.sessions import COOKIE_PLAIN, COOKIE_SECURE, SessionStore
from bilharz.settings import Settings, load_settings
from bilharz.triage import load_config

log = logging.getLogger("bilharz")

SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"no-referrer"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
]
# Responses about accounts and reviews are never kept by a browser or proxy cache.
NO_STORE_PATHS = ("/api/auth", "/api/admin", "/api/reviews")
NO_STORE = [(b"cache-control", b"no-store")]
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class SecurityHeaders:
    """Adds security headers to every response, and turns any unhandled error
    into a plain JSON 500 with no stack trace or path."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        started = False

        async def send_with_headers(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                extra = NO_STORE if scope["path"].startswith(NO_STORE_PATHS) else []
                message["headers"] = list(message.get("headers", [])) + SECURITY_HEADERS + extra
            await send(message)

        try:
            await self.app(scope, receive, send_with_headers)
        except Exception:
            log.exception("unhandled error on %s %s", scope.get("method"), scope.get("path"))
            if started:
                raise
            response = JSONResponse({"detail": "Internal server error."}, status_code=500)
            await response(scope, receive, send_with_headers)


class OriginCheck:
    """Refuses a request that changes something (POST, PUT, PATCH, DELETE under
    /api) when it comes from another site: a page elsewhere cannot use a
    reviewer's session cookie (cross-site request forgery).

    Browsers send an Origin header with every such request. It must be this
    server's own origin or one of BILHARZ_ALLOWED_ORIGINS. A request with no
    Origin (a script, not a browser) is allowed only if it carries no session
    cookie, since without the cookie it has nothing to borrow."""

    def __init__(self, app, allowed_origins: tuple[str, ...]):
        self.app = app
        self.allowed = set(allowed_origins)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in UNSAFE_METHODS or not scope["path"].startswith("/api/"):
            return await self.app(scope, receive, send)
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        origin = headers.get("origin")
        own = f"{scope.get('scheme', 'http')}://{headers.get('host', '')}"
        cookie = headers.get("cookie", "")
        has_session = f"{COOKIE_SECURE}=" in cookie or f"{COOKIE_PLAIN}=" in cookie
        if origin is None or origin == "null":
            refused = has_session
        else:
            refused = origin != own and origin not in self.allowed
        if refused:
            response = JSONResponse({"detail": "This request came from another site and was refused."}, status_code=403)
            return await response(scope, receive, send)
        return await self.app(scope, receive, send)


def create_app(settings: Settings | None = None, scorer: Scorer | None = None) -> FastAPI:
    """Build the API. Settings default to the environment's, and the scorer to
    the first available one; the Space passes its GPU scorer, tests pass stubs."""
    settings = settings or load_settings()
    configure_pillow(settings)
    if os.environ.get("BILHARZ_REVIEW_CODE"):
        log.warning("BILHARZ_REVIEW_CODE is set but no longer used: reviewing needs an approved reviewer account")

    app = FastAPI(
        title="Bilharz API",
        version="1.0.0",
        description="Patient-level triage for urogenital schistosomiasis from urine microscopy.",
    )
    app.state.settings = settings
    app.state.triage = load_config(settings.config_path)
    app.state.samples = SampleStore(settings.scores_path, settings.manifest_path)
    app.state.tiles = TileArchive(settings.tiles_zip)
    journal = ReviewJournal(settings.reviews_dir) if settings.reviews_dir else None
    app.state.reviews = ReviewStore(settings.reviews_db, journal, settings.reviews_persistent)
    app.state.clock = Clock()
    app.state.accounts = AccountStore(settings.accounts_dir or settings.reviews_db.parent)
    app.state.sessions = SessionStore(clock=app.state.clock)
    app.state.limits = Limits(app.state.clock)
    app.state.scorer = scorer or load_scorer(settings)
    app.state.analysis_lock = asyncio.Lock()

    @app.exception_handler(UploadError)
    async def upload_error(request: Request, exc: UploadError):
        return JSONResponse({"detail": exc.detail}, status_code=exc.status)

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # Field locations and messages only: submitted values are not echoed back.
        errors = [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
        return JSONResponse({"detail": errors}, status_code=422)

    app.include_router(router)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type", "X-Admin-Token"],
    )
    app.add_middleware(OriginCheck, allowed_origins=settings.allowed_origins)
    app.add_middleware(SecurityHeaders)
    return app


class Limits:
    """The attempt counters, each over 15 minutes (sign-ups over an hour)."""

    def __init__(self, clock):
        window = 15 * 60
        self.signin_account = RateLimiter(5, window, clock)  # wrong passwords for one email
        self.signin_ip = RateLimiter(20, window, clock)  # wrong passwords from one address
        self.signup_ip = RateLimiter(5, 60 * 60, clock)  # new accounts from one address
        self.reset_ip = RateLimiter(10, window, clock)  # wrong reset links from one address
        self.claim_account = RateLimiter(5, window, clock)  # wrong admin tokens from one account


_default_app: FastAPI | None = None


def __getattr__(name: str):
    # `uvicorn server:app` and `from server import app` get the default app,
    # built from the environment the first time it is asked for.
    if name == "app":
        global _default_app
        if _default_app is None:
            _default_app = create_app()
        return _default_app
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
