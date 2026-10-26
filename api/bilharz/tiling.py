"""Cut one microscope image into the detector's 12 tiles.

This must match the notebooks exactly: resize to 1024 × 768, then a 3 × 4 grid
of 256 × 256 tiles, row by row and left to right (tile k = row * 4 + column;
the public tile number is k + 1).
"""
import io

import numpy as np
from PIL import Image

SIZE = (1024, 768)
ROWS, COLS, PX = 3, 4, 256
TILES_PER_IMAGE = ROWS * COLS


def tiles_of(data: bytes) -> np.ndarray:
    """JPEG bytes → uint8 (12, 256, 256, 3)."""
    a = np.asarray(Image.open(io.BytesIO(data)).convert("RGB").resize(SIZE, Image.BILINEAR))
    return a.reshape(ROWS, PX, COLS, PX, 3).transpose(0, 2, 1, 3, 4).reshape(TILES_PER_IMAGE, PX, PX, 3)
