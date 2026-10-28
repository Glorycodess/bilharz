"""Stress and robustness checks against a local Bilharz backend.

    api/.venv/bin/python scripts/stress_backend.py --url http://127.0.0.1:8020 [--save NAME]

1. Concurrent uploads: several full uploads at once. Exactly one should be
   analysed (200) and the others refused (429); the next upload then succeeds.
2. A burst of concurrent GET /api/samples requests.
3. Rejected uploads: an oversized file, a non-JPEG renamed .jpg, the wrong file
   count and a stalled upload, each followed by a probe that shows the
   analysis lock is free again (a busy lock answers 429, a free one 422).

The stalled upload waits for the server's upload time limit
(BILHARZ_UPLOAD_TIMEOUT_SECONDS, 120 s by default). Uses DT40 from
scripts/fetch_samples.py. Never point this at a shared server.
"""
import argparse
import asyncio
import io
import json
import socket
import threading
import time
from urllib.parse import urlsplit

import httpx
from PIL import Image

from backend_client import EVIDENCE, REPO, environment, multipart, sample_images, summary_ms


def raw_post(url: str, body: bytes, content_type: str, stall_after: int | None = None, timeout: float = 600) -> dict:
    """POST over a plain socket, reading the reply while the body is still being
    sent: the server may answer (429, 413) before the upload has arrived.
    With `stall_after`, only that many bytes are ever sent."""
    parts = urlsplit(url)
    sock = socket.create_connection((parts.hostname, parts.port), timeout=timeout)
    head = (
        f"POST {parts.path} HTTP/1.1\r\nHost: {parts.netloc}\r\nContent-Type: {content_type}\r\n"
        f"Content-Length: {len(body)}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    ).encode()
    payload = head + (body if stall_after is None else body[:stall_after])

    def send():
        try:
            sock.sendall(payload)
        except OSError:
            pass  # the server answered early and closed the connection

    start = time.perf_counter()
    sender = threading.Thread(target=send, daemon=True)
    sender.start()
    data = b""
    try:
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            data += chunk
            header_end = data.find(b"\r\n\r\n")
            if header_end >= 0:
                headers = data[:header_end].decode("latin-1").lower()
                length = next((int(h.split(":")[1]) for h in headers.split("\r\n") if h.startswith("content-length:")), None)
                if length is not None and len(data) - header_end - 4 >= length:
                    break
    finally:
        sock.close()
    elapsed = time.perf_counter() - start
    if not data:
        return dict(status=None, seconds=round(elapsed, 2), detail="no response")
    status = int(data.split(b" ", 2)[1])
    try:
        reply = json.loads(data[data.find(b"\r\n\r\n") + 4 :])
    except ValueError:
        reply = {}
    return dict(status=status, seconds=round(elapsed, 2), detail=reply.get("detail") if status != 200 else None, reply=reply)


def tiny_jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), (120, 90, 60)).save(buf, format="JPEG")
    return buf.getvalue()


def png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), (10, 20, 30)).save(buf, format="PNG")
    return buf.getvalue()


def lock_is_free(url: str) -> bool:
    """A one-image upload is refused 422 (wrong count) by a free lock, 429 by a busy one."""
    body, ctype = multipart([tiny_jpeg()])
    return raw_post(url, body, ctype)["status"] == 422


def concurrent_uploads(url: str, images: list[bytes], n: int) -> dict:
    body, ctype = multipart(images)
    results = [None] * n
    barrier = threading.Barrier(n)

    def upload(i):
        barrier.wait()
        results[i] = raw_post(url, body, ctype)

    threads = [threading.Thread(target=upload, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    statuses = sorted(r["status"] for r in results)
    after = raw_post(url, body, ctype)
    return dict(
        uploads=n,
        statuses=statuses,
        refused_seconds=sorted(r["seconds"] for r in results if r["status"] == 429),
        analysed_seconds=[r["seconds"] for r in results if r["status"] == 200],
        next_upload_status=after["status"],
        passed=statuses == [200] + [429] * (n - 1) and after["status"] == 200,
    )


async def burst(base: str, n: int) -> dict:
    limits = httpx.Limits(max_connections=n, max_keepalive_connections=0)
    async with httpx.AsyncClient(base_url=base, limits=limits, timeout=60) as client:

        async def one():
            start = time.perf_counter()
            try:
                r = await client.get("/api/samples")
                return r.status_code, time.perf_counter() - start
            except httpx.HTTPError as error:
                return type(error).__name__, time.perf_counter() - start

        start = time.perf_counter()
        results = await asyncio.gather(*(one() for _ in range(n)))
        wall = time.perf_counter() - start
    ok = [t for s, t in results if s == 200]
    return dict(
        requests=n,
        succeeded=len(ok),
        success_rate=round(len(ok) / n * 100, 1),
        failures=sorted({str(s) for s, _ in results if s != 200}),
        wall_s=round(wall, 2),
        latency=summary_ms(ok) if ok else None,
    )


def rejected_uploads(url: str, images: list[bytes]) -> list[dict]:
    cases = []

    def case(name, expected, result):
        free = lock_is_free(url)
        cases.append(
            dict(case=name, expected=expected, status=result["status"], detail=result["detail"],
                 seconds=result["seconds"], lock_free_after=free, passed=result["status"] == expected and free)
        )
        print(json.dumps(cases[-1]))

    oversized = images[0] + b"\0" * (16 * 1024 * 1024)  # a 16 MB file; the limit is 15 MB
    body, ctype = multipart([oversized] + images[1:])
    case("oversized file (16 MB)", 413, raw_post(url, body, ctype))

    body, ctype = multipart(images[:-1] + [png()])
    case("PNG renamed .jpg", 415, raw_post(url, body, ctype))

    body, ctype = multipart(images[:-1])
    case("116 images instead of 117", 422, raw_post(url, body, ctype))

    body, ctype = multipart(images)
    case("stalled upload (half the body, then nothing)", 408, raw_post(url, body, ctype, stall_after=len(body) // 2))

    body, ctype = multipart(images)
    final = raw_post(url, body, ctype)
    cases.append(dict(case="full upload afterwards", expected=200, status=final["status"], seconds=final["seconds"],
                      passed=final["status"] == 200))
    print(json.dumps(cases[-1]))
    return cases


def main() -> None:
    parser = argparse.ArgumentParser(description="Stress and robustness checks against a local backend.")
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--uploads", type=int, default=4, help="concurrent uploads (default 4)")
    parser.add_argument("--burst", type=int, default=200, help="concurrent GET requests (default 200)")
    parser.add_argument("--save", metavar="NAME", help="write results to docs/evidence/performance/NAME.json")
    args = parser.parse_args()
    if urlsplit(args.url).hostname not in ("127.0.0.1", "localhost"):
        parser.error("stress tests run against a local server only")

    analyse = args.url.rstrip("/") + "/api/analyse"
    images = sample_images("DT40")
    result = dict(url=args.url)
    result["concurrent_uploads"] = concurrent_uploads(analyse, images, args.uploads)
    print(json.dumps(result["concurrent_uploads"]))
    result["burst"] = asyncio.run(burst(args.url, args.burst))
    print(json.dumps(result["burst"]))
    result["rejected_uploads"] = rejected_uploads(analyse, images)
    result["environment"] = environment()
    result["measured_at"] = time.strftime("%Y-%m-%d %H:%M %Z")
    if args.save:
        out = EVIDENCE / "performance" / f"{args.save}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=2) + "\n")
        print(f"saved {out.relative_to(REPO)}")


if __name__ == "__main__":
    main()
