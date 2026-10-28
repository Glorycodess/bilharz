"""Live analysis of one uploaded sample, entirely in memory."""
import base64
import io
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

from .scoring import Scorer, score_named
from .security import Upload, UploadError
from .tiling import TILES_PER_IMAGE, tiles_of
from .triage import Rule, count_confident, decide

TOP = 12
IMAGES_PER_BATCH = 16  # 192 tiles in memory at a time


def _image_name(position: int) -> str:
    """Images are named by their 1-based position in the upload, never by filename."""
    return f"upload_{position:03d}"


def _data_uri(tile: np.ndarray) -> str:
    """A tile as a JPEG data URI: upload previews are returned inline, never stored."""
    buf = io.BytesIO()
    Image.fromarray(tile).save(buf, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _decode(args: tuple[int, Upload]) -> np.ndarray:
    position, upload = args
    try:
        return tiles_of(upload.data)
    except Exception:
        raise UploadError(422, f"Image {position} could not be decoded.") from None


def analyse(uploads: list[Upload], scorer: Scorer, rule: Rule) -> dict:
    """Decode and score in groups of images, keeping only the scores; then cut
    again just the images that hold the top tiles, for their previews."""
    start = time.perf_counter()
    numbered = list(enumerate(uploads, 1))
    # A scorer with `whole_sample` (the GPU one) gets every tile in one call,
    # since each call reserves a GPU; the CPU scorer works through groups.
    group = len(numbered) if getattr(scorer, "whole_sample", False) else IMAGES_PER_BATCH
    scores, used = [], set()
    with ThreadPoolExecutor(max_workers=4) as pool:
        for i in range(0, len(numbered), group):
            tiles = np.concatenate(list(pool.map(_decode, numbered[i : i + group])))
            group_scores, name = score_named(scorer, tiles)
            scores.append(group_scores)
            used.add(name)
    scores = np.concatenate(scores)

    count = count_confident(scores, rule)
    order = np.argsort(-scores, kind="stable")[:TOP]
    names = [_image_name(i) for i, _ in numbered]
    cut = {f: _decode(numbered[f]) for f in {int(flat) // TILES_PER_IMAGE for flat in order}}
    top = []
    for rank, flat in enumerate(order, 1):
        f, t = divmod(int(flat), TILES_PER_IMAGE)
        top.append(
            dict(
                rank=rank,
                score=round(float(scores[flat]), 4),
                image=names[f],
                tile=t + 1,
                url=_data_uri(cut[f][t]),
                confident=bool(scores[flat] > rule.tile_threshold),
            )
        )
    best = int(order[0])
    return dict(
        id=None,
        source="upload",
        setting=rule.name,
        tile_threshold=rule.tile_threshold,
        confident_tiles=count,
        decision=decide(count, rule),
        tiles_scored=int(len(scores)),
        highest_score=round(float(scores[best]), 4),
        highest_tile=dict(image=names[best // TILES_PER_IMAGE], tile=best % TILES_PER_IMAGE + 1),
        top_tiles=top,
        seconds=round(time.perf_counter() - start, 2),
        scorer="+".join(sorted(used)),
    )
