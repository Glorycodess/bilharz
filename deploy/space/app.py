"""Bilharz on a Hugging Face Space (Gradio SDK, ZeroGPU hardware).

One server on the port the Space expects:
  /api/...   the Bilharz API (server.create_app, unchanged)
  /gradio    a small Gradio status page (the SDK needs a Gradio app)
  /          the built React site, with single-page-app fallback

Scoring uploads: on ZeroGPU, the detector runs in PyTorch on the GPU through
one @spaces.GPU function (bilharz.scoring.TorchGpuScorer), called from the
FastAPI route. Calls from outside a
Gradio event carry no visitor token, so they count against the Space's own
ZeroGPU allowance, not the visitor's. Any GPU error (including an exhausted
quota) falls back to the ONNX model on the CPU for that request. Without
ZeroGPU (e.g. running this file locally), ONNX on the CPU is used throughout.

This file is copied into the Space by deploy/build_space.sh.
"""
import spaces  # noqa: I001  must be imported before torch / anything that touches CUDA

import logging
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets"
STATIC = HERE / "static"
SPACE_URL = "https://iamglory-bilharz.hf.space"

# Defaults for the Space; anything set in the Space settings wins. Secrets
# (BILHARZ_ADMIN_TOKEN, BILHARZ_REVIEW_CODE) are only ever read from the environment.
os.environ.setdefault("BILHARZ_ASSETS_DIR", str(ASSETS))
os.environ.setdefault("BILHARZ_SCORES_PATH", str(ASSETS / "patient_scores.npz"))
os.environ.setdefault("BILHARZ_ALLOWED_ORIGINS", SPACE_URL)
# The Space disk is ephemeral, so the reviews database there is lost when it
# restarts. Set BILHARZ_REVIEWS_DIR to the mount path of a Storage Bucket to
# keep every review in a journal there; the database is rebuilt from it on start.
os.environ.setdefault("BILHARZ_REVIEWS_DB", str(HERE / "data" / "reviews.db"))
os.environ.setdefault("BILHARZ_REVIEWS_PERSISTENT", "false")
# No usage analytics from Gradio.
os.environ.setdefault("GRADIO_ANALYTICS_ENABLED", "False")

import gradio as gr  # noqa: E402
import uvicorn  # noqa: E402
from fastapi import Request  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse  # noqa: E402

from bilharz.scoring import OnnxScorer, load_gpu_scorer  # noqa: E402
from bilharz.settings import load_settings  # noqa: E402
from server import create_app  # noqa: E402

log = logging.getLogger("bilharz.space")
logging.basicConfig(level=logging.INFO)

ON_ZERO_GPU = os.environ.get("SPACES_ZERO_GPU", "").lower() in ("1", "t", "true")


def start_zero_gpu() -> None:
    """Run ZeroGPU's start-up: pack the model's CUDA weights for the GPU
    workers and report the @spaces.GPU function to ZeroGPU.

    spaces runs this from the first gr.Blocks.launch(). This app is served by
    uvicorn with Gradio mounted, so launch() is never called, and the hook is
    called here instead. `spaces.zero.startup` is not part of the package's
    public API, which is why spaces is pinned in requirements.txt. If it is
    missing or fails, load_gpu_scorer logs it and scores with ONNX on the CPU.
    See docs/architecture.md.
    """
    startup = getattr(getattr(spaces, "zero", None), "startup", None)
    if startup is None:
        raise RuntimeError("this version of spaces has no zero.startup")
    startup()


def make_scorer(settings):
    if not ON_ZERO_GPU:
        log.info("Not on ZeroGPU: scoring with ONNX on the CPU")
        return OnnxScorer.from_settings(settings)
    # The ZeroGPU docs: place models on cuda at start-up (CUDA is emulated
    # here; the real GPU is attached inside @spaces.GPU functions).
    return load_gpu_scorer(settings, spaces.GPU(duration=45), start_zero_gpu, ASSETS / "detector.pt")


# --- Content-Security-Policy --------------------------------------------------
# The built site has no inline scripts or styles, so it gets a strict policy.
# The Gradio page needs inline scripts and styles, so /gradio gets its own.
SITE_CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self' https://huggingface.co",
    ]
)
GRADIO_CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: blob:",
        "font-src 'self' data: https://fonts.gstatic.com",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'self' https://huggingface.co",
    ]
)


class ContentSecurityPolicy:
    """Adds the Content-Security-Policy header (the API's other security headers stay)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        policy = GRADIO_CSP if scope["path"].startswith("/gradio") else SITE_CSP

        async def send_with_csp(message):
            if message["type"] == "http.response.start":
                message["headers"] = list(message.get("headers", [])) + [
                    (b"content-security-policy", policy.encode())
                ]
            await send(message)

        await self.app(scope, receive, send_with_csp)


# --- The app ------------------------------------------------------------------
settings = load_settings()
app = create_app(settings, scorer=make_scorer(settings))

with gr.Blocks(title="Bilharz status") as status_page:
    gr.Markdown(
        "## Bilharz\n"
        "Patient-level triage for urogenital schistosomiasis from urine microscopy.\n\n"
        f"The app runs at [{SPACE_URL}]({SPACE_URL}). This page only reports its status.\n\n"
        f"- Scoring: **{app.state.scorer.name}**\n"
        f"- Samples: **{len(app.state.samples)}**\n"
        f"- Reviews kept after a restart: **{'yes' if app.state.reviews.persistent else 'no'}**\n\n"
        "Research prototype. Not a medical device."
    )

# ssr_mode=False: Spaces set GRADIO_SSR_MODE=true, and with SSR on,
# mount_gradio_app starts Gradio's Node server on GRADIO_SERVER_PORT (7860),
# before uvicorn below can bind it. The status page needs no SSR.
app = gr.mount_gradio_app(app, status_page, path="/gradio", ssr_mode=False)
app.add_middleware(ContentSecurityPolicy)

INDEX = STATIC / "index.html"
# Gradio's page links /manifest.json from the site root; answer with a valid one.
MANIFEST = {"name": "Bilharz", "short_name": "Bilharz", "start_url": "/", "display": "browser", "icons": []}


@app.get("/manifest.json", include_in_schema=False)
def manifest():
    return JSONResponse(MANIFEST, media_type="application/manifest+json")


# Browsers ask for /favicon.ico on pages that name no icon (the Gradio page).
@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(STATIC / "favicon.svg", media_type="image/svg+xml")


@app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
def site(path: str, request: Request):
    """The built React site. Real files are served as they are; any other path
    gets index.html so the app's own routes (/queue, /review/DT40) work on reload."""
    if path == "api" or path.startswith("api/"):
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    if path:
        candidate = (STATIC / path).resolve()
        if candidate.is_relative_to(STATIC) and candidate.is_file():
            immutable = candidate.parent.name == "assets"  # Vite's hashed file names
            return FileResponse(
                candidate,
                headers={"Cache-Control": "public, max-age=31536000, immutable" if immutable else "no-cache"},
            )
        # A missing file (it has an extension) is a 404, not the app's page.
        if "." in Path(path).name:
            return JSONResponse({"detail": "Not Found"}, status_code=404)
    return FileResponse(INDEX, headers={"Cache-Control": "no-cache"})


if __name__ == "__main__":
    # The Space runs `python app.py`. The app object (not an "app:app" string)
    # is passed, so this module is not imported a second time.
    uvicorn.run(
        app,
        host=os.environ.get("GRADIO_SERVER_NAME", "0.0.0.0"),
        port=int(os.environ.get("GRADIO_SERVER_PORT", "7860")),
        proxy_headers=True,
        forwarded_allow_ips="*",
    )
