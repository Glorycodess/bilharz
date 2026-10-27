"""Tile scorers: uint8 tiles (N, 256, 256, 3) → egg probabilities (N,).

Scorers are tried in order of preference and the first available one is used.
The Hugging Face Space passes its own TorchGpuScorer (detector.pt on ZeroGPU,
see deploy/space/app.py) to create_app, with ONNX on the CPU as its fallback.
A scorer may set `whole_sample = True` to be called once per upload.
"""
from typing import ClassVar, Protocol

import numpy as np

from .settings import Settings


class Scorer(Protocol):
    name: str

    def score(self, tiles: np.ndarray) -> np.ndarray: ...


class OnnxScorer:
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


def load_scorer(settings: Settings) -> Scorer:
    for cls in SCORERS:
        if cls.available():
            return cls.from_settings(settings)
    raise RuntimeError("no tile scorer is available")
