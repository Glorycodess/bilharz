"""Choosing the GPU scorer, and its fallback to ONNX. torch is never needed."""
import sys

import numpy as np
import pytest

from bilharz import scoring
from bilharz.analysis import analyse
from bilharz.scoring import OnnxScorer, TorchGpuScorer, load_gpu_scorer
from bilharz.security import Upload
from bilharz.triage import load_config

from .conftest import jpeg

TILES = np.zeros((3, 256, 256, 3), dtype=np.uint8)


class Spy:
    """Records what load_gpu_scorer did with the `gpu` wrapper and `start` hook."""

    def __init__(self):
        self.wrapped, self.started = [], 0

    def gpu(self, fn):
        self.wrapped.append(fn)
        return fn

    def start(self):
        self.started += 1


def test_scoring_module_does_not_import_torch():
    assert "torch" not in sys.modules


def test_without_torch_onnx_is_used(base_settings, monkeypatch):
    monkeypatch.setitem(sys.modules, "torch", None)  # import torch raises ImportError
    spy = Spy()
    scorer = load_gpu_scorer(base_settings, spy.gpu, spy.start, "detector.pt")
    assert isinstance(scorer, OnnxScorer)
    assert spy.wrapped == [] and spy.started == 0


def test_with_a_gpu_the_torch_scorer_is_used(base_settings, monkeypatch):
    detector = lambda tiles: np.full(len(tiles), 0.9, dtype=np.float32)  # noqa: E731
    monkeypatch.setattr(scoring, "torch_detector", lambda path, device: detector)
    spy = Spy()
    scorer = load_gpu_scorer(base_settings, spy.gpu, spy.start, "detector.pt")
    assert isinstance(scorer, TorchGpuScorer) and scorer.name == "torch-gpu"
    assert spy.wrapped == [detector] and spy.started == 1
    assert isinstance(scorer.fallback, OnnxScorer)
    scores, name = scorer.score_named(TILES)
    assert name == "torch-gpu" and np.allclose(scores, 0.9)


def test_failed_gpu_start_up_falls_back_to_onnx(base_settings, monkeypatch):
    monkeypatch.setattr(scoring, "torch_detector", lambda path, device: lambda tiles: tiles)

    def start():
        raise RuntimeError("ZeroGPU unavailable")

    assert isinstance(load_gpu_scorer(base_settings, lambda fn: fn, start, "detector.pt"), OnnxScorer)


@pytest.mark.parametrize("error", [RuntimeError("quota exceeded"), MemoryError(), TimeoutError()])
def test_a_failed_request_is_scored_by_the_fallback(scorer, error, caplog):
    def on_gpu(tiles):
        raise error

    gpu_scorer = TorchGpuScorer(on_gpu, scorer)
    scores, name = gpu_scorer.score_named(TILES)
    assert name == "onnx-cpu"
    assert np.array_equal(scores, scorer.score(TILES))
    assert np.array_equal(gpu_scorer.score(TILES), scores)
    assert type(error).__name__ in caplog.text


def test_analysis_reports_the_scorer_that_ran(scorer, base_settings):
    calls = []

    def on_gpu(tiles):
        calls.append(len(tiles))
        return np.zeros(len(tiles), dtype=np.float32)

    uploads = [Upload(jpeg()) for _ in range(2)]
    rule = load_config(base_settings.config_path).rule(None)
    result = analyse(uploads, TorchGpuScorer(on_gpu, scorer), rule)
    assert result["scorer"] == "torch-gpu"
    assert calls == [24]  # whole_sample: every tile in one call

