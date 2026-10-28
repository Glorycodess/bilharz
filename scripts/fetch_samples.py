"""Download the images of chosen patients from the Zenodo diagnosis dataset.

The archive (record 6467268, diagnosis_test_dataset.zip) is 12.5 GB. This reads
only its central directory, then fetches each requested image with an HTTP
range request, so the archive is never downloaded whole.

    api/.venv/bin/python scripts/fetch_samples.py DT40 DT02 DT29

Images are saved to test-data/samples/<ID>/ under their names in the archive
(117 JPEGs per patient). Images already present with the right size are
skipped, so an interrupted run can be repeated. Needs `remotezip`
(api/requirements-dev.txt).
"""
import argparse
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from remotezip import RemoteZip

URL = "https://zenodo.org/records/6467268/files/diagnosis_test_dataset.zip?download=1"
ROOT = "diagnosis_test_dataset"
IMAGES_PER_SAMPLE = 117
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "test-data" / "samples"
SAMPLE_ID = re.compile(r"^DT[0-9]{2}$")

_local = threading.local()


def _archive() -> RemoteZip:
    # One connection per worker thread: a RemoteZip is not safe to share.
    if not hasattr(_local, "zip"):
        _local.zip = RemoteZip(URL)
    return _local.zip


def _fetch(info, target: Path) -> bool:
    """Save one archive entry to `target`; False if it was already there."""
    if target.exists() and target.stat().st_size == info.file_size:
        return False
    partial = target.with_name(target.name + ".part")
    # ZipFile.read checks the entry's CRC, so a damaged download raises here.
    partial.write_bytes(_archive().read(info))
    partial.replace(target)
    return True


def fetch(sample_ids: list[str], out: Path, workers: int = 4) -> None:
    with RemoteZip(URL) as z:
        entries = [i for i in z.infolist() if not i.is_dir()]

    for sid in sample_ids:
        images = sorted(
            (i for i in entries if i.filename.startswith(f"{ROOT}/{sid}/") and i.filename.lower().endswith(".jpeg")),
            key=lambda i: i.filename,
        )
        if len(images) != IMAGES_PER_SAMPLE:
            sys.exit(f"{sid}: the archive has {len(images)} images, expected {IMAGES_PER_SAMPLE}")
        folder = out / sid
        folder.mkdir(parents=True, exist_ok=True)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            fetched = sum(pool.map(lambda i: _fetch(i, folder / Path(i.filename).name), images))
        saved = sorted(folder.glob("*.jpeg"))
        if len(saved) != IMAGES_PER_SAMPLE:
            sys.exit(f"{sid}: {len(saved)} images in {folder}, expected {IMAGES_PER_SAMPLE}")
        size = sum(p.stat().st_size for p in saved) / 1e6
        print(f"{sid}: {len(saved)} images, {size:.0f} MB ({fetched} downloaded, {len(saved) - fetched} already present)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("ids", nargs="+", help="patient IDs, DT01 to DT65")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"output folder (default: {DEFAULT_OUT})")
    args = parser.parse_args()
    bad = [i for i in args.ids if not SAMPLE_ID.match(i)]
    if bad:
        parser.error(f"not a patient ID: {', '.join(bad)}")
    fetch(args.ids, args.out)


if __name__ == "__main__":
    main()
