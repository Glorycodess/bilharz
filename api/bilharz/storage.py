"""Writing files on persistent storage (a Storage Bucket mounted into the Space).

A bucket mount is not an ordinary disk: a file is uploaded when it is closed,
and locks are not shared between machines. So files there are never changed in
place. The whole new content is written to a temporary file, which then
replaces the old one; a crash leaves the old file or the new one, never half.
"""
import os
from pathlib import Path


def replace_file(path: Path, data: bytes) -> None:
    """Write `data` to `path` in one step: a temporary file, then a rename over it."""
    temporary = path.with_name(path.name + ".tmp")
    with open(temporary, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temporary, path)
