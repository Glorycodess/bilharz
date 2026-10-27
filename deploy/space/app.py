"""Bilharz on a Hugging Face Space (Gradio SDK, ZeroGPU hardware).

One server on the port the Space expects:
  /api/...   the Bilharz API (server.create_app, unchanged)
  /gradio    a small Gradio status page (the SDK needs a Gradio app)
  /          the built React site, with single-page-app fallback

Scoring uploads: on ZeroGPU, the detector runs in PyTorch on the GPU through
one @spaces.GPU function, called from the FastAPI route. Calls from outside a
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
# The Space disk is ephemeral: reviews are lost when it restarts, unless
# BILHARZ_REVIEWS_DB points at an attached storage bucket and
# BILHARZ_REVIEWS_PERSISTENT is set to true.
os.environ.setdefault("BILHARZ_REVIEWS_DB", str(HERE / "data" / "reviews.db"))
os.environ.setdefault("BILHARZ_REVIEWS_PERSISTENT", "false")
# No usage analytics from Gradio.
os.environ.setdefault("GRADIO_ANALYTICS_ENABLED", "False")

import gradio as gr  # noqa: E402
import numpy as np  # noqa: E402
import torch  # noqa: E402
import torchvision  # noqa: E402
import uvicorn  # noqa: E402
from fastapi import Request  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse  # noqa: E402

from bilharz.scoring import OnnxScorer  # noqa: E402
from bilharz.settings import load_settings  # noqa: E402
from server import create_app  # noqa: E402

log = logging.getLogger("bilharz.space")
logging.basicConfig(level=logging.INFO)

ON_ZERO_GPU = os.environ.get("SPACES_ZERO_GPU", "").lower() in ("1", "t", "true")
GPU_BATCH = 256

# --- The detector in PyTorch -------------------------------------------------
# ResNet18 with a single-logit head; ImageNet normalisation before, sigmoid after.
# Same weights as detector.onnx (exported from detector.pt in notebook 05).
_model = torchvision.models.resnet18(weights=None)
_model.fc = torch.nn.Linear(512, 1)
_model.load_state_dict(torch.load(ASSETS / "detector.pt", map_location="cpu", weights_only=True))
_model.eval()
_mean = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
_std = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)
_device = "cpu"
if ON_ZERO_GPU:
    # The ZeroGPU docs: place models on cuda at module level (CUDA is emulated
    # here; the real GPU is attached inside @spaces.GPU functions).
    _device = "cuda"
    _model.to(_device)
    _mean, _std = _mean.to(_device), _std.to(_device)


@spaces.GPU(duration=45)
def score_on_gpu(tiles: np.ndarray) -> np.ndarray:
    """uint8 tiles (N, 256, 256, 3) → probabilities (N,). Runs on the GPU on ZeroGPU."""
    x = torch.from_numpy(tiles)
    out = []
    with torch.inference_mode():
        for i in range(0, len(x), GPU_BATCH):
            batch = x[i : i + GPU_BATCH].to(_device).permute(0, 3, 1, 2).float().div(255)
            logits = _model((batch - _mean) / _std).squeeze(1)
            out.append(torch.sigmoid(logits).float().cpu())
    return torch.cat(out).numpy() if out else np.zeros(0, dtype=np.float32)


class TorchGpuScorer:
    """The detector on ZeroGPU, with the ONNX scorer as fallback."""

    name = "torch-gpu"
    whole_sample = True  # one GPU reservation per upload

    def __init__(self, fallback: OnnxScorer):
        self.fallback = fallback

    def score(self, tiles: np.ndarray) -> np.ndarray:
        try:
            return score_on_gpu(tiles)
        except Exception as error:  # quota exhausted, no GPU free, worker error, ...
            # Log the kind of error only: never data from the upload.
            log.warning("GPU scoring failed (%s); using ONNX on the CPU for this request", type(error).__name__)
            return self.fallback.score(tiles)


def make_scorer(settings):
    onnx = OnnxScorer.from_settings(settings)
    if not ON_ZERO_GPU:
        log.info("Not on ZeroGPU: scoring with ONNX on the CPU")
        return onnx
    try:
        # spaces runs this hook from gr.Blocks.launch(); this app is served by
        # uvicorn with Gradio mounted, so launch() is never called: run it here.
        # It packs the CUDA weights for the GPU workers and reports the
        # @spaces.GPU functions to ZeroGPU.
        spaces.zero.startup()
    except Exception as error:
        log.warning("ZeroGPU start-up failed (%s): scoring with ONNX on the CPU", type(error).__name__)
        return onnx
    log.info("Scoring uploads on ZeroGPU, with ONNX on the CPU as fallback")
    return TorchGpuScorer(onnx)


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
        f"- Reviews kept after a restart: **{'yes' if settings.reviews_persistent else 'no'}**\n\n"
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
