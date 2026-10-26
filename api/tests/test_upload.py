"""Upload validation and one full analysis."""
import asyncio
import io
import json
import re

import pytest
from PIL import Image

from .conftest import as_files, jpeg


def png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), (10, 20, 30)).save(buf, format="PNG")
    return buf.getvalue()


def test_wrong_count(make_client):
    with make_client(expected_files=3) as c:
        r = c.post("/api/analyse", files=as_files([jpeg(), jpeg()]))
        assert r.status_code == 422
        assert "Expected exactly 3 images" in r.json()["detail"]
        r = c.post("/api/analyse", files=as_files([jpeg()] * 4))
        assert r.status_code == 422


def test_png_renamed_jpg_is_rejected(make_client):
    with make_client(expected_files=2) as c:
        r = c.post("/api/analyse", files=as_files([jpeg(), png()]))
        assert r.status_code == 415
        assert r.json() == {"detail": "Image 2 is not a JPEG."}


def test_text_renamed_jpg_is_rejected(make_client):
    with make_client(expected_files=1) as c:
        r = c.post("/api/analyse", files=as_files([b"not an image at all"]))
        assert r.status_code == 415


def test_truncated_jpeg_is_rejected(make_client):
    broken = jpeg(256, 256)[:400]
    with make_client(expected_files=1) as c:
        r = c.post("/api/analyse", files=as_files([broken]))
        assert r.status_code in (415, 422)
        assert "detail" in r.json()


def test_oversized_file(make_client):
    big = jpeg(400, 400, quality=100)
    with make_client(expected_files=1, max_file_bytes=len(big) - 1) as c:
        r = c.post("/api/analyse", files=as_files([big]))
        assert r.status_code == 413
        assert "larger than" in r.json()["detail"]


def test_oversized_request(make_client):
    with make_client(expected_files=3, max_request_bytes=2000) as c:
        r = c.post("/api/analyse", files=as_files([jpeg(200, 200)] * 3))
        assert r.status_code == 413


def test_oversized_dimensions(make_client):
    with make_client(expected_files=1, max_image_side=100) as c:
        r = c.post("/api/analyse", files=as_files([jpeg(120, 80)]))
        assert r.status_code == 422
        assert "pixels" in r.json()["detail"]


def test_not_multipart(client):
    r = client.post("/api/analyse", content=b"{}", headers={"content-type": "application/json"})
    assert r.status_code == 415


def test_unknown_setting(client):
    r = client.post("/api/analyse", params={"setting": "fast"}, files=as_files([jpeg()]))
    assert r.status_code == 422


def test_busy_returns_429(app, client, monkeypatch):
    class Busy:
        def locked(self):
            return True

    monkeypatch.setattr(app.state, "analysis_lock", Busy())
    r = client.post("/api/analyse", files=as_files([jpeg()]))
    assert r.status_code == 429
    assert r.json() == {"detail": "Analysis in progress, try again shortly."}


@pytest.mark.slow
def test_full_analysis(client):
    blobs = [jpeg(160, 120, colour=(100 + i % 50, 80, 60)) for i in range(117)]
    r = client.post("/api/analyse", files=as_files(blobs))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] is None and body["source"] == "upload"
    assert body["setting"] == "safety" and body["tiles_scored"] == 1404
    assert body["decision"] in {"negative", "referred", "positive"}
    assert isinstance(body["seconds"], float)
    assert len(body["top_tiles"]) == 12
    first = body["top_tiles"][0]
    assert first["url"].startswith("data:image/jpeg;base64,")
    assert re.fullmatch(r"upload_(00[1-9]|0[1-9][0-9]|1[01][0-9])", first["image"]) and 1 <= first["tile"] <= 12
    assert body["highest_tile"] == {"image": first["image"], "tile": first["tile"]}


# Filenames are never echoed ---------------------------------------------------

SECRET_NAMES = [f"Jane-Doe_ward7_bed{i}_MRN84213{i}.jpg" for i in range(1, 4)]


def assert_no_names(text):
    for name in SECRET_NAMES:
        stem = name.rsplit(".", 1)[0]
        assert name not in text and stem not in text
    assert "Jane-Doe" not in text and "MRN84213" not in text


def named(blobs):
    return [("files", (name, b, "image/jpeg")) for name, b in zip(SECRET_NAMES, blobs)]


def test_filenames_never_echoed(make_client, caplog):
    caplog.set_level("DEBUG")
    with make_client(expected_files=3) as c:
        r = c.post("/api/analyse", files=named([jpeg(160, 120, colour=(90 + 20 * i, 80, 60)) for i in range(3)]))
        assert r.status_code == 200, r.text
        assert_no_names(r.text)
        body = r.json()
        assert {t["image"] for t in body["top_tiles"]} <= {"upload_001", "upload_002", "upload_003"}
        assert body["highest_tile"]["image"].startswith("upload_")

        # Error responses don't name files either.
        for files in (named([jpeg(), jpeg()]), named([jpeg(), png(), jpeg()])):
            r = c.post("/api/analyse", files=files)
            assert r.status_code in (415, 422)
            assert_no_names(r.text)
    assert_no_names(caplog.text)


# Upload time limit and the analysis lock ---------------------------------------

BOUNDARY = "bilharz-test-boundary"


def multipart_body(blobs):
    parts = [
        f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="files"; filename="{i}.jpg"\r\n'
        f"Content-Type: image/jpeg\r\n\r\n".encode() + b + b"\r\n"
        for i, b in enumerate(blobs, 1)
    ]
    return b"".join(parts) + f"--{BOUNDARY}--\r\n".encode()


def post_raw(app, chunks, then):
    """POST /api/analyse over ASGI, sending `chunks` and then either stalling
    ("stall") or dropping the connection ("disconnect")."""
    pending = list(chunks)
    sent = []

    async def receive():
        if pending:
            return {"type": "http.request", "body": pending.pop(0), "more_body": True}
        if then == "disconnect":
            return {"type": "http.disconnect"}
        await asyncio.sleep(3600)  # the rest of the body never arrives

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/analyse",
        "raw_path": b"/api/analyse",
        "query_string": b"",
        "root_path": "",
        "headers": [(b"host", b"testserver"), (b"content-type", f"multipart/form-data; boundary={BOUNDARY}".encode())],
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
    }
    asyncio.run(asyncio.wait_for(app(scope, receive, send), timeout=10))
    status = next(m["status"] for m in sent if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return status, json.loads(body)


def test_upload_timeout(make_client):
    with make_client(expected_files=3, upload_timeout_seconds=0.3) as c:
        body = multipart_body([jpeg()] * 3)
        status, detail = post_raw(c.app, [body[: len(body) // 2]], then="stall")
        assert status == 408
        assert detail == {"detail": "Upload took too long. Please try again."}
        assert not c.app.state.analysis_lock.locked()
        # The next upload is handled normally, not refused as busy.
        assert c.post("/api/analyse", files=as_files([jpeg()] * 3)).status_code == 200


def test_lock_released_after_disconnect(make_client):
    with make_client(expected_files=3) as c:
        body = multipart_body([jpeg()] * 3)
        status, _ = post_raw(c.app, [body[:200]], then="disconnect")
        assert 400 <= status < 500
        assert not c.app.state.analysis_lock.locked()
        assert c.post("/api/analyse", files=as_files([jpeg()] * 3)).status_code == 200


def test_lock_released_after_validation_errors(make_client):
    with make_client(expected_files=3) as c:
        assert c.post("/api/analyse", files=as_files([jpeg()])).status_code == 422
        assert not c.app.state.analysis_lock.locked()
        assert c.post("/api/analyse", files=as_files([jpeg(), png(), jpeg()])).status_code == 415
        assert not c.app.state.analysis_lock.locked()
        assert c.post("/api/analyse", files=as_files([jpeg()] * 3)).status_code == 200


def test_lock_released_after_scoring_error(make_client, monkeypatch):
    class Broken:
        name = "broken"

        def score(self, tiles):
            raise RuntimeError("scorer failed")

    with make_client(expected_files=3) as c:
        working = c.app.state.scorer
        monkeypatch.setattr(c.app.state, "scorer", Broken())
        r = c.post("/api/analyse", files=as_files([jpeg()] * 3))
        assert r.status_code == 500 and r.json() == {"detail": "Internal server error."}
        assert not c.app.state.analysis_lock.locked()
        monkeypatch.setattr(c.app.state, "scorer", working)
        assert c.post("/api/analyse", files=as_files([jpeg()] * 3)).status_code == 200
