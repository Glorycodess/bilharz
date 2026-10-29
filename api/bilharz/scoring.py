"""Tile scorers: uint8 tiles (N, 256, 256, 3) → egg probabilities (N,).

Locally, scorers are tried in order of preference and the first available one
is used. The Hugging Face Space builds a TorchGpuScorer instead (detector.pt on
ZeroGPU, with ONNX on the CPU as its fallback; see load_gpu_scorer) and passes
it to create_app. A scorer may set `whole_sample = True` to be called once per
upload, and a scorer with a fallback implements `score_named` to report which
one ran. torch is imported only when the PyTorch detector is loaded, so the
local backend and its tests do not need it.
"""
import logging
from collections.abc import Callable
from typing import ClassVar, Protocol

import numpy as np

from .settings import Settings

log = logging.getLogger("bilharz")


class Scorer(Protocol):
    """Anything with a `name` and a `score` method; see the module docstring."""

    name: str

    def score(self, tiles: np.ndarray) -> np.ndarray: ...


class OnnxScorer:
    """The exported detector (detector.onnx) on the CPU, in batches."""

    name: ClassVar[str] = "onnx-cpu"

    def __init__(self, model_path, batch_size: int = 64):
        import onnxruntime as ort

        self._session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        self._input = self._session.get_inputs()[0].name
        self._batch = batch_size

    @staticmethod
    def available() -> bool:
        try:
            import onnxruntime  # noqa: F401
        except ImportError:
            return False
        return True

    @classmethod
    def from_settings(cls, settings: Settings) -> "OnnxScorer":
        return cls(settings.model_path, settings.batch_size)

    def score(self, tiles: np.ndarray) -> np.ndarray:
        if len(tiles) == 0:
            return np.zeros(0, dtype=np.float32)
        out = []
        for i in range(0, len(tiles), self._batch):
            x = tiles[i : i + self._batch].transpose(0, 3, 1, 2).astype(np.float32) / 255.0
            out.append(self._session.run(None, {self._input: x})[0])
        return np.concatenate(out).reshape(-1)


SCORERS = [OnnxScorer]


def score_named(scorer: Scorer, tiles: np.ndarray) -> tuple[np.ndarray, str]:
    """The scores, and the name of the scorer that actually produced them."""
    if hasattr(scorer, "score_named"):
        return scorer.score_named(tiles)
    return scorer.score(tiles), scorer.name


def load_scorer(settings: Settings) -> Scorer:
    """The first available scorer in SCORERS."""
    for cls in SCORERS:
        if cls.available():
            return cls.from_settings(settings)
    raise RuntimeError("no tile scorer is available")


def torch_detector(weights_path, device: str, batch_size: int = 256) -> Callable[[np.ndarray], np.ndarray]:
    """detector.pt in PyTorch, as a function from uint8 tiles to probabilities.

    ResNet18 with a single-logit head; ImageNet normalisation before, sigmoid
    after. Same weights as detector.onnx (exported from detector.pt in notebook 05).
    """
    import torch
    import torchvision

    model = torchvision.models.resnet18(weights=None)
    model.fc = torch.nn.Linear(512, 1)
    model.load_state_dict(torch.load(weights_path, map_location="cpu", weights_only=True))
    model.eval().to(device)
    mean = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1).to(device)
    std = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1).to(device)

    def score(tiles: np.ndarray) -> np.ndarray:
        x = torch.from_numpy(tiles)
        out = []
        with torch.inference_mode():
            for i in range(0, len(x), batch_size):
                batch = x[i : i + batch_size].to(device).permute(0, 3, 1, 2).float().div(255)
                logits = model((batch - mean) / std).squeeze(1)
                out.append(torch.sigmoid(logits).float().cpu())
        return torch.cat(out).numpy() if out else np.zeros(0, dtype=np.float32)

    return score


class TorchGpuScorer:
    """The detector on a GPU, through `score_on_gpu`; any error there falls
    back to `fallback` for that request."""

    name: ClassVar[str] = "torch-gpu"
    whole_sample: ClassVar[bool] = True  # one GPU reservation per upload

    def __init__(self, score_on_gpu: Callable[[np.ndarray], np.ndarray], fallback: Scorer):
        self._score_on_gpu = score_on_gpu
        self.fallback = fallback

    def score_named(self, tiles: np.ndarray) -> tuple[np.ndarray, str]:
        """The scores, and which scorer produced them (reported per upload)."""
        try:
            return self._score_on_gpu(tiles), self.name
        except Exception as error:  # quota exhausted, no GPU free, worker error, ...
            # Log the kind of error only: never data from the upload.
            log.warning("GPU scoring failed (%s); using %s for this request", type(error).__name__, self.fallback.name)
            return self.fallback.score(tiles), self.fallback.name

    def score(self, tiles: np.ndarray) -> np.ndarray:
        return self.score_named(tiles)[0]


def load_gpu_scorer(
    settings: Settings,
    gpu: Callable[[Callable], Callable],
    start: Callable[[], None],
    weights_path,
) -> Scorer:
    """The PyTorch detector on the GPU with the ONNX scorer as fallback, or the
    ONNX scorer alone if torch is missing or the GPU cannot be set up.

    `gpu` wraps the scoring function so it runs on the GPU (`spaces.GPU` on
    ZeroGPU), and `start` is called once that is done.
    """
    onnx = OnnxScorer.from_settings(settings)
    try:
        score_on_gpu = gpu(torch_detector(weights_path, device="cuda"))
        start()
    except Exception as error:
        log.warning("GPU scoring is not available (%s: %s): scoring with ONNX on the CPU", type(error).__name__, error)
        return onnx
    log.info("Scoring uploads on the GPU, with ONNX on the CPU as fallback")
    return TorchGpuScorer(score_on_gpu, onnx)
