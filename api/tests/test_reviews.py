"""Reviews: create, list, validation and the admin-only delete."""
import pytest

from .conftest import ADMIN_TOKEN


def test_create_and_list(make_client):
    with make_client() as c:
        r = c.post("/api/reviews/DT40", json={"verdict": "infected", "note": "Spine visible on tile 1.", "tester_code": "T7"})
        assert r.status_code == 201
        saved = r.json()
        assert saved["sample_id"] == "DT40" and saved["verdict"] == "infected" and saved["tester_code"] == "T7"
        assert saved["created_at"].endswith("+00:00")
        c.post("/api/reviews/DT03", json={"verdict": "healthy"})

        listed = c.get("/api/reviews").json()
        assert [x["sample_id"] for x in listed] == ["DT40", "DT03"]
        assert set(listed[0]) == {"id", "sample_id", "verdict", "note", "tester_code", "created_at"}

        queue = {s["id"]: s for s in c.get("/api/samples").json()["samples"]}
        assert queue["DT40"]["reviewed"] and queue["DT03"]["reviewed"] and not queue["DT01"]["reviewed"]


@pytest.mark.parametrize(
    "body",
    [
        {"verdict": "maybe"},
        {},
        {"verdict": "healthy", "note": "x" * 501},
        {"verdict": "healthy", "tester_code": "Alice"},
        {"verdict": "healthy", "tester_code": "T1234"},
        {"verdict": "healthy", "tester_code": "t1"},
        {"verdict": "healthy", "tester_code": "T\u0661"},
    ],
)
def test_invalid_review_is_422(client, body):
    assert client.post("/api/reviews/DT40", json=body).status_code == 422


def test_review_unknown_sample(client):
    assert client.post("/api/reviews/DT99", json={"verdict": "healthy"}).status_code == 404


def test_delete_requires_token(make_client):
    with make_client() as c:
        c.post("/api/reviews/DT40", json={"verdict": "healthy"})
        assert c.delete("/api/reviews").status_code == 403
        assert c.delete("/api/reviews", headers={"X-Admin-Token": "wrong"}).status_code == 403
        assert len(c.get("/api/reviews").json()) == 1
        r = c.delete("/api/reviews", headers={"X-Admin-Token": ADMIN_TOKEN})
        assert r.status_code == 200 and r.json() == {"deleted": 1}
        assert c.get("/api/reviews").json() == []


def test_delete_disabled_without_configured_token(make_client):
    with make_client(admin_token=None) as c:
        r = c.delete("/api/reviews", headers={"X-Admin-Token": "anything"})
        assert r.status_code == 403


def test_no_personal_columns(make_client):
    import sqlite3

    with make_client() as c:
        db = c.app.state.settings.reviews_db
        cols = [row[1] for row in sqlite3.connect(db).execute("PRAGMA table_info(reviews)")]
    assert cols == ["id", "sample_id", "verdict", "note", "tester_code", "created_at"]
