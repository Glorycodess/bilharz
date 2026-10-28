"""The 65 evaluation samples: stored tile scores and their top-12 tiles.

Only the scores, sample IDs and image names are read from patient_scores.npz.
The labels in that file are never loaded, so the API cannot reveal a diagnosis.
Confident-tile counts are computed per setting from the scores.
"""
import json
import threading
import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .triage import Rule, count_confident


@dataclass(frozen=True)
class TopTile:
    """One of a sample's 12 highest-scoring tiles, from the manifest."""

    rank: int
    score: float
    image: str
    tile: int  # 1–12
    raw_score: float  # full-precision score, used for the confident flag


class SampleStore:
    """Stored tile scores and top tiles of the 65 samples, read once at start-up."""

    def __init__(self, scores_path: Path, manifest_path: Path):
        with np.load(scores_path) as z:
            self._scores = np.asarray(z["S"], dtype=np.float32)  # (samples, images, 12)
            self.ids = [str(s) for s in z["samples"]]
            self._frames = z["frames"].astype(str)
        self._index = {sid: i for i, sid in enumerate(self.ids)}
        manifest = json.loads(manifest_path.read_text())
        self._top = {sid: self._top_tiles(sid, manifest[sid]) for sid in self.ids}
        self._files = {sid: {e["rank"]: e["file"] for e in manifest[sid]} for sid in self.ids}

    def _top_tiles(self, sid: str, entries: list[dict]) -> list[TopTile]:
        i = self._index[sid]
        frame_of = {f.rsplit(".", 1)[0]: n for n, f in enumerate(self._frames[i])}
        return [
            TopTile(
                rank=e["rank"],
                score=float(e["score"]),
                image=e["image"],
                tile=e["tile"],
                raw_score=float(self._scores[i, frame_of[e["image"]], e["tile"] - 1]),
            )
            for e in entries
        ]

    def __contains__(self, sid: str) -> bool:
        return sid in self._index

    def __len__(self) -> int:
        return len(self.ids)

    def scores(self, sid: str) -> np.ndarray:
        """Flat (images × 12,) tile scores."""
        return self._scores[self._index[sid]].reshape(-1)

    def count(self, sid: str, rule: Rule) -> int:
        """Confident tiles under `rule`."""
        return count_confident(self.scores(sid), rule)

    def highest(self, sid: str) -> tuple[float, str, int]:
        """(score, image name, tile number) of the highest-scoring tile."""
        i = self._index[sid]
        flat = int(np.argmax(self._scores[i].reshape(-1)))
        f, t = divmod(flat, self._scores.shape[2])
        return float(self._scores[i].reshape(-1)[flat]), self._frames[i, f].rsplit(".", 1)[0], t + 1

    def top_tiles(self, sid: str) -> list[TopTile]:
        return self._top[sid]

    def tile_file(self, sid: str, rank: int) -> str | None:
        """The archive member for a known sample and rank, or None."""
        return self._files.get(sid, {}).get(rank)


class TileArchive:
    """Serves tile JPEGs straight from tiles.zip, opened once."""

    def __init__(self, path: Path):
        self._zip = zipfile.ZipFile(path)
        self._names = set(self._zip.namelist())
        self._lock = threading.Lock()

    def read(self, member: str) -> bytes | None:
        if member not in self._names:
            return None
        with self._lock:
            return self._zip.read(member)

    def close(self) -> None:
        self._zip.close()
