"""Tiles come out row by row, left to right, after resizing to 1024 × 768."""
import io

import numpy as np
from PIL import Image

from bilharz.tiling import tiles_of

# 12 well-separated colours, one per grid cell.
COLOURS = [
    (255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0),
    (255, 0, 255), (0, 255, 255), (128, 0, 0), (0, 128, 0),
    (0, 0, 128), (128, 128, 0), (255, 255, 255), (0, 0, 0),
]


def grid_jpeg(width, height):
    img = Image.new("RGB", (width, height))
    cw, ch = width // 4, height // 3
    for k, colour in enumerate(COLOURS):
        r, c = divmod(k, 4)
        img.paste(colour, (c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def centre_colours(tiles):
    return [tuple(int(v) for v in t[96:160, 96:160].reshape(-1, 3).mean(0)) for t in tiles]


def close(a, b, tol=12):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


def test_shape_and_dtype():
    tiles = tiles_of(grid_jpeg(1024, 768))
    assert tiles.shape == (12, 256, 256, 3)
    assert tiles.dtype == np.uint8


def test_row_by_row_order():
    for k, got in enumerate(centre_colours(tiles_of(grid_jpeg(1024, 768)))):
        assert close(got, COLOURS[k]), f"tile {k + 1}: {got} != {COLOURS[k]}"


def test_other_sizes_are_resized_first():
    # A larger image with the same grid, and one with a different aspect ratio.
    for size in [(2048, 1536), (640, 600)]:
        tiles = tiles_of(grid_jpeg(*size))
        assert tiles.shape == (12, 256, 256, 3)
        for k, got in enumerate(centre_colours(tiles)):
            assert close(got, COLOURS[k]), f"{size} tile {k + 1}: {got} != {COLOURS[k]}"
