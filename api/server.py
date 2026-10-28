"""The Bilharz API. Run locally with `uvicorn server:app --port 8000`.

`create_app` builds the app; `server.app` is the default one, built on first
use, so importing this module (tests, the Space entry point) has no side effects.
"""
import asyncio
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from bilharz.reviews import ReviewStore
from bilharz.routes import router
from bilharz.samples import SampleStore, TileArchive
from bilharz.scoring import Scorer, load_scorer
from bilharz.security import UploadError, configure_pillow
from bilharz.settings import Settings, load_settings
from bilharz.triage import load_config

log = logging.getLogger("bilharz")

SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"no-referrer"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
]


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
                message["headers"] = list(message.get("headers", [])) + SECURITY_HEADERS
            await send(message)

        try:
            await self.app(scope, receive, send_with_headers)
        except Exception:
            log.exception("unhandled error on %s %s", scope.get("method"), scope.get("path"))
            if started:
                raise
            response = JSONResponse({"detail": "Internal server error."}, status_code=500)
            await response(scope, receive, send_with_headers)


def create_app(settings: Settings | None = None, scorer: Scorer | None = None) -> FastAPI:
    """Build the API. Settings default to the environment's, and the scorer to
    the first available one; the Space passes its GPU scorer, tests pass stubs."""
    settings = settings or load_settings()
    configure_pillow(settings)

    app = FastAPI(
        title="Bilharz API",
        version="1.0.0",
        description="Patient-level triage for urogenital schistosomiasis from urine microscopy.",
    )
    app.state.settings = settings
    app.state.triage = load_config(settings.config_path)
    app.state.samples = SampleStore(settings.scores_path, settings.manifest_path)
    app.state.tiles = TileArchive(settings.tiles_zip)
    app.state.reviews = ReviewStore(settings.reviews_db)
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
        allow_headers=["Content-Type", "X-Admin-Token", "X-Review-Code"],
    )
    app.add_middleware(SecurityHeaders)
    return app


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
