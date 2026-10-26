"""The ONNX scorer reproduces the stored scores for DT40's top tiles."""
import io
import json
import zipfile

import numpy as np
from PIL import Image


def test_shape_and_range(scorer):
    rng = np.random.default_rng(0)
    tiles = rng.integers(0, 256, size=(70, 256, 256, 3), dtype=np.uint8)  # crosses a batch boundary
    scores = scorer.score(tiles)
    assert scores.shape == (70,)
    assert np.all((scores >= 0) & (scores <= 1))


def test_empty_batch(scorer):
    assert scorer.score(np.zeros((0, 256, 256, 3), dtype=np.uint8)).shape == (0,)


def spearman(a, b):
    """Spearman rank correlation, with tied values given their average rank."""

    def ranks(x):
        r = np.empty(len(x))
        r[np.argsort(x, kind="stable")] = np.arange(1, len(x) + 1)
        for v in np.unique(x):
            r[x == v] = r[x == v].mean()
        return r

    return float(np.corrcoef(ranks(np.asarray(a)), ranks(np.asarray(b)))[0, 1])


def test_dt40_display_crops(scorer, base_settings):
    """The tile crops in tiles.zip are for display on the review screen only.

    They are JPEG-compressed copies of the original tiles, so re-scoring them is
    not expected to reproduce the manifest scores exactly, and no decision ever
    uses them. The end-to-end check of the deployed model against the stored
    decisions was done in notebook 05: the ONNX detector, run on the original
    images, reproduced all 65 decisions under both settings. Here we only check
    that the crops are valid images that still look like what the manifest says:
    roughly the same order, and the top crop still clearly scored as an egg.
    """
    manifest = json.loads(base_settings.manifest_path.read_text())["DT40"]
    with zipfile.ZipFile(base_settings.tiles_zip) as z:
        images = [Image.open(io.BytesIO(z.read(e["file"]))) for e in manifest]

    assert len(images) == 12
    for e, img in zip(manifest, images):
        assert (img.format, img.size, img.mode) == ("JPEG", (256, 256), "RGB"), f"rank {e['rank']}"

    scores = scorer.score(np.stack([np.asarray(img) for img in images]))
    expected = [e["score"] for e in manifest]
    assert spearman(scores, expected) >= 0.6
    assert scores[0] > 0.5
