"""Measure the Bilharz backend.

    analyse    time full 117-image analyses of fetched samples, and compare each
               decision with the stored result for that sample
    latency    p50 and p95 of /api/samples, /api/samples/DT40 and a tile image
    resources  peak memory and CPU of a local server process during one analysis
    breakdown  in-process split of a local analysis into decoding and scoring

Examples (with a server on port 8020):

    api/.venv/bin/python scripts/measure_backend.py analyse --url http://127.0.0.1:8020 --runs 3 DT40 DT02 DT29
    api/.venv/bin/python scripts/measure_backend.py latency --url http://127.0.0.1:8020
    api/.venv/bin/python scripts/measure_backend.py resources --url http://127.0.0.1:8020 --pid 12345 DT40
    api/.venv/bin/python scripts/measure_backend.py breakdown DT40

Add --save NAME to write the results to docs/evidence/performance/NAME.json.
Samples come from scripts/fetch_samples.py.
"""
import argparse
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import numpy as np

from backend_client import EVIDENCE, REPO, environment, multipart, sample_images, summary_ms, timed_upload


def analyse(args) -> dict:
    runs = []
    with httpx.Client(base_url=args.url, timeout=600) as client:
        health = client.get("/api/health").json()
        for sid in args.samples:
            stored = client.get(f"/api/samples/{sid}").json()
            body, ctype = multipart(sample_images(sid))
            for run in range(1, args.runs + 1):
                try:
                    r = timed_upload(client, "/api/analyse", body, ctype)
                except httpx.HTTPError as error:
                    print(json.dumps(dict(sample=sid, run=run, error=type(error).__name__)))
                    runs.append(dict(sample=sid, run=run, status=None, error=type(error).__name__))
                    continue
                reply = r.pop("reply") or {}
                row = dict(
                    sample=sid,
                    run=run,
                    **r,
                    server_analysis_s=reply.get("seconds"),
                    scorer=reply.get("scorer", "not reported"),
                    decision=reply.get("decision"),
                    confident_tiles=reply.get("confident_tiles"),
                    stored_decision=stored["decision"],
                    stored_confident_tiles=stored["confident_tiles"],
                )
                if r["status"] == 200:
                    row["matches_stored"] = (
                        row["decision"] == row["stored_decision"]
                        and abs(row["confident_tiles"] - row["stored_confident_tiles"]) <= 1
                    )
                else:
                    row["detail"] = reply.get("detail")
                print(json.dumps(row))
                runs.append(row)
    return dict(url=args.url, health=health, runs=runs)


ENDPOINTS = ["/api/samples", "/api/samples/DT40", "/api/tiles/DT40/1.jpg"]


def latency(args) -> dict:
    results = {}
    with httpx.Client(base_url=args.url, timeout=30) as client:
        for path in ENDPOINTS:
            for _ in range(10):  # warm up
                client.get(path).raise_for_status()
            times = []
            for _ in range(args.n):
                start = time.perf_counter()
                client.get(path).raise_for_status()
                times.append(time.perf_counter() - start)
            results[path] = summary_ms(times)
            print(path, results[path])
    return dict(url=args.url, requests_per_endpoint=args.n, sequential=True, keep_alive=True, endpoints=results)


def resources(args) -> dict:
    import psutil

    server = psutil.Process(args.pid)
    server.cpu_percent(None)
    time.sleep(1)
    baseline = dict(rss_mb=round(server.memory_info().rss / 2**20), cpu_percent=server.cpu_percent(None))
    samples, stop = [], threading.Event()

    def watch():
        while not stop.is_set():
            samples.append((server.memory_info().rss, server.cpu_percent(None)))
            time.sleep(0.1)

    body, ctype = multipart(sample_images(args.samples[0]))
    watcher = threading.Thread(target=watch)
    with httpx.Client(base_url=args.url, timeout=600) as client:
        server.cpu_percent(None)
        watcher.start()
        r = timed_upload(client, "/api/analyse", body, ctype)
        stop.set()
        watcher.join()
    rss = [s[0] for s in samples]
    cpu = [s[1] for s in samples[1:]]
    result = dict(
        url=args.url,
        sample=args.samples[0],
        status=r["status"],
        total_s=r["total_s"],
        baseline=baseline,
        peak_rss_mb=round(max(rss) / 2**20),
        mean_cpu_percent=round(sum(cpu) / len(cpu)),
        peak_cpu_percent=round(max(cpu)),
        samples_every_s=0.1,
        note="CPU percent is of one core; the machine has %d cores." % psutil.cpu_count(),
    )
    print(json.dumps(result))
    return result


def breakdown(args) -> dict:
    sys.path.insert(0, str(REPO / "api"))
    from bilharz.scoring import load_scorer
    from bilharz.settings import load_settings
    from bilharz.tiling import tiles_of

    scorer = load_scorer(load_settings())
    rows = []
    for sid in args.samples:
        images = sample_images(sid)
        for run in range(1, args.runs + 1):
            start = time.perf_counter()
            with ThreadPoolExecutor(max_workers=4) as pool:  # as bilharz.analysis does
                tiles = list(pool.map(tiles_of, images))
            decoded = time.perf_counter()
            scorer.score(np.concatenate(tiles))
            scored = time.perf_counter()
            row = dict(sample=sid, run=run, decode_s=round(decoded - start, 2), score_s=round(scored - decoded, 2))
            print(json.dumps(row))
            rows.append(row)
    return dict(scorer=scorer.name, tiles_per_sample=1404, runs=rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Measure the Bilharz backend.")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("analyse", "latency", "resources", "breakdown"):
        p = sub.add_parser(name)
        if name != "breakdown":
            p.add_argument("--url", default="http://127.0.0.1:8000")
        if name in ("analyse", "resources", "breakdown"):
            p.add_argument("samples", nargs="+")
        if name in ("analyse", "breakdown"):
            p.add_argument("--runs", type=int, default=1)
        if name == "latency":
            p.add_argument("-n", type=int, default=200)
        if name == "resources":
            p.add_argument("--pid", type=int, required=True, help="the server's process ID")
        p.add_argument("--save", metavar="NAME", help="write results to docs/evidence/performance/NAME.json")
    args = parser.parse_args()

    result = {"analyse": analyse, "latency": latency, "resources": resources, "breakdown": breakdown}[args.command](args)
    result["environment"] = environment()
    result["measured_at"] = time.strftime("%Y-%m-%d %H:%M %Z")
    if args.save:
        out = EVIDENCE / "performance" / f"{args.save}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=2) + "\n")
        print(f"saved {out.relative_to(REPO)}")


if __name__ == "__main__":
    main()
