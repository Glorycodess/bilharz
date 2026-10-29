"""Read endpoints, tiles, error format and security headers."""
import json

import pytest

from .conftest import ORIGIN

FORBIDDEN_KEYS = {"y", "eggs", "label", "labels", "infected", "truth", "diagnosis"}


def all_keys(value):
    if isinstance(value, dict):
        for k, v in value.items():
            yield k
            yield from all_keys(v)
    elif isinstance(value, list):
        for v in value:
            yield from all_keys(v)


def test_health(client):
    assert client.get("/api/health").json() == {
        "status": "ok",
        "scorer": "onnx-cpu",
        "samples": 65,
        "reviews_persistent": True,
        "reviews_unreadable": 0,
    }


def test_config(client):
    body = client.get("/api/config").json()
    assert body["default"] == "safety"
    assert body["settings"]["safety"]["tile_threshold"] == 0.95
    assert body["settings"]["efficiency"]["flag_above"] == 12


def test_queue(client):
    body = client.get("/api/samples").json()
    assert body["setting"] == "safety"
    assert len(body["samples"]) == 65
    first = body["samples"][0]
    assert set(first) == {"id", "confident_tiles", "decision", "review"}
    by_id = {s["id"]: s for s in body["samples"]}
    assert by_id["DT40"]["confident_tiles"] == 4 and by_id["DT40"]["decision"] == "referred"


def test_queue_efficiency(client):
    body = client.get("/api/samples", params={"setting": "efficiency"}).json()
    assert body["setting"] == "efficiency"
    assert sum(s["decision"] == "referred" for s in body["samples"]) == 33


def test_unknown_setting_is_422(client):
    r = client.get("/api/samples", params={"setting": "fast"})
    assert r.status_code == 422
    assert "detail" in r.json()


def test_dt40(client):
    body = client.get("/api/samples/DT40").json()
    assert body["id"] == "DT40" and body["source"] == "stored"
    assert body["setting"] == "safety" and body["tile_threshold"] == 0.95
    assert body["confident_tiles"] == 4 and body["decision"] == "referred"
    assert body["tiles_scored"] == 1404
    assert body["highest_tile"] == {"image": "0004_0004", "tile": 12}
    assert body["highest_score"] == pytest.approx(0.9927, abs=1e-4)
    tiles = body["top_tiles"]
    assert len(tiles) == 12 and [t["rank"] for t in tiles] == list(range(1, 13))
    assert tiles[0]["url"] == "/api/tiles/DT40/1.jpg"
    assert sum(t["confident"] for t in tiles) == 4
    assert set(tiles[0]) == {"rank", "score", "image", "tile", "url", "confident"}


def test_unknown_sample_is_404(client):
    r = client.get("/api/samples/DT99")
    assert r.status_code == 404 and r.json() == {"detail": "Sample not found."}


def test_no_labels_anywhere(client):
    responses = [
        client.get("/api/samples").json(),
        client.get("/api/samples", params={"setting": "efficiency"}).json(),
        client.get("/api/samples/DT40").json(),
        client.get("/api/samples/DT29").json(),
        client.get("/api/config").json(),
        client.get("/api/health").json(),
    ]
    for body in responses:
        assert not FORBIDDEN_KEYS & set(all_keys(body))
    # The stored labels themselves are never loaded.
    assert "eggs" not in json.dumps(responses)


def test_tile(client):
    r = client.get("/api/tiles/DT40/1.jpg")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    assert r.headers["cache-control"] == "public, max-age=86400"
    assert r.content[:3] == b"\xff\xd8\xff"


@pytest.mark.parametrize(
    "path",
    [
        "/api/tiles/DT40/13.jpg",
        "/api/tiles/DT40/0.jpg",
        "/api/tiles/DT40/-1.jpg",
        "/api/tiles/DT40/abc.jpg",
        "/api/tiles/DT40/1.png",
        "/api/tiles/DT99/1.jpg",
        "/api/tiles/..%2F..%2Fassets/1.jpg",
        "/api/tiles/DT40/..%2F..%2Ftiles_manifest.json",
        "/api/tiles/..%2Ftiles_manifest.json/1.jpg",
        "/api/tiles/DT40%2F01.jpg/1.jpg",
        "/api/tiles/%2e%2e/1.jpg",
    ],
)
def test_tile_rejects(client, path):
    assert client.get(path).status_code == 404


def test_security_headers(client):
    for path in ["/api/health", "/api/samples/DT99", "/api/tiles/DT40/1.jpg"]:
        h = client.get(path).headers
        assert h["x-content-type-options"] == "nosniff"
        assert h["referrer-policy"] == "no-referrer"
        assert h["permissions-policy"] == "camera=(), microphone=(), geolocation=()"
        assert "x-frame-options" not in h


def test_cors_allowed_origin(client):
    r = client.get("/api/health", headers={"Origin": ORIGIN})
    assert r.headers.get("access-control-allow-origin") == ORIGIN
    pre = client.options(
        "/api/reviews/DT40",
        headers={"Origin": ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"},
    )
    assert pre.status_code == 200 and pre.headers.get("access-control-allow-origin") == ORIGIN


def test_cors_other_origin(client):
    r = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r.headers
    pre = client.options(
        "/api/reviews",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "DELETE"},
    )
    assert "access-control-allow-origin" not in pre.headers


def test_unhandled_error_is_plain_json(app, client, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("/secret/path/inside")

    monkeypatch.setattr(app.state.samples, "highest", boom)
    r = client.get("/api/samples/DT40")
    assert r.status_code == 500
    assert r.json() == {"detail": "Internal server error."}
    assert "secret" not in r.text
    assert r.headers["x-content-type-options"] == "nosniff"
