"""Shared by the measurement scripts: sample images, multipart bodies, timing."""
import os
import platform
import statistics
import subprocess
import sys
import time
import uuid
from pathlib import Path

import httpx

REPO = Path(__file__).resolve().parent.parent
SAMPLES = REPO / "test-data" / "samples"
EVIDENCE = REPO / "docs" / "evidence"
CHUNK = 256 * 1024


def sample_images(sample_id: str) -> list[bytes]:
    """The 117 images of a fetched sample, in name order."""
    paths = sorted((SAMPLES / sample_id).glob("*.jpeg"))
    if len(paths) != 117:
        sys.exit(f"{sample_id}: {len(paths)} images in {SAMPLES / sample_id}; run scripts/fetch_samples.py {sample_id}")
    return [p.read_bytes() for p in paths]


def multipart(blobs: list[bytes], field: str = "files") -> tuple[bytes, str]:
    """A multipart/form-data body like the browser sends: neutral file names, in order."""
    boundary = uuid.uuid4().hex
    parts = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="upload_{i:03d}.jpg"\r\n'
        f"Content-Type: image/jpeg\r\n\r\n".encode() + blob + b"\r\n"
        for i, blob in enumerate(blobs, 1)
    ]
    return b"".join(parts) + f"--{boundary}--\r\n".encode(), f"multipart/form-data; boundary={boundary}"


def timed_upload(client: httpx.Client, url: str, body: bytes, content_type: str) -> dict:
    """POST a body in chunks. Returns the status, the JSON reply and three times:
    the whole request, the upload (until the last chunk was handed to the
    socket), and the rest (waiting for the server's answer)."""
    sent = {}

    def chunks():
        for i in range(0, len(body), CHUNK):
            yield body[i : i + CHUNK]
        sent["at"] = time.perf_counter()

    start = time.perf_counter()
    response = client.post(
        url,
        content=chunks(),
        headers={"Content-Type": content_type, "Content-Length": str(len(body)), "Accept": "application/json"},
    )
    end = time.perf_counter()
    try:
        reply = response.json()
    except ValueError:
        reply = None
    return dict(
        status=response.status_code,
        reply=reply,
        total_s=round(end - start, 2),
        upload_s=round(sent.get("at", end) - start, 2),
        after_upload_s=round(end - sent.get("at", end), 2),
        megabytes=round(len(body) / 1e6, 1),
    )


def percentile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    k = (len(ordered) - 1) * p / 100
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def summary_ms(seconds: list[float]) -> dict:
    ms = [s * 1000 for s in seconds]
    return dict(
        n=len(ms),
        p50_ms=round(percentile(ms, 50), 2),
        p95_ms=round(percentile(ms, 95), 2),
        mean_ms=round(statistics.fmean(ms), 2),
        max_ms=round(max(ms), 2),
    )


def environment() -> dict:
    """The machine and software the measurement ran on."""
    def sysctl(name):
        try:
            return subprocess.run(["sysctl", "-n", name], capture_output=True, text=True).stdout.strip()
        except OSError:
            return ""

    memory = sysctl("hw.memsize")
    return dict(
        machine=platform.machine(),
        cpu=sysctl("machdep.cpu.brand_string") or platform.processor(),
        cores=os.cpu_count(),
        ram_gb=round(int(memory) / 2**30) if memory.isdigit() else None,
        os=f"{platform.system()} {platform.mac_ver()[0] or platform.release()}",
        python=platform.python_version(),
        client="httpx " + httpx.__version__,
    )
