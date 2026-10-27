"""Reviews: create, list, validation and the admin-only delete."""
import csv
import io
import json

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
        assert [x["sample_id"] for x in listed] == ["DT03", "DT40"]  # newest first
        assert set(listed[0]) == {
            "id", "sample_id", "verdict", "note", "tester_code", "created_at", "supersedes", "decision", "version_count",
        }

        queue = {s["id"]: s for s in c.get("/api/samples").json()["samples"]}
        assert queue["DT40"]["review"]["verdict"] == "infected"
        assert queue["DT03"]["review"]["verdict"] == "healthy"
        assert queue["DT01"]["review"] is None


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
    assert cols == ["id", "sample_id", "verdict", "note", "tester_code", "created_at", "supersedes"]


def test_latest_review_wins(make_client):
    with make_client() as c:
        c.post("/api/reviews/DT40", json={"verdict": "healthy", "note": "first look"})
        c.post("/api/reviews/DT40", json={"verdict": "infected", "note": "second look", "tester_code": "T2"})

        queue = {s["id"]: s for s in c.get("/api/samples").json()["samples"]}
        assert set(queue["DT40"]["review"]) == {"verdict", "created_at"}
        assert queue["DT40"]["review"]["verdict"] == "infected"

        result = c.get("/api/samples/DT40").json()
        assert result["review_count"] == 2
        assert result["review"]["verdict"] == "infected"
        assert result["review"]["note"] == "second look" and result["review"]["tester_code"] == "T2"
        assert set(result["review"]) == {"id", "verdict", "created_at", "note", "tester_code"}

        # The earlier review stays in the audit trail.
        history = c.get("/api/reviews", params={"sample_id": "DT40", "view": "all"}).json()
        assert [r["verdict"] for r in history] == ["infected", "healthy"]


def test_unreviewed_sample_result(client):
    body = client.get("/api/samples/DT02").json()
    assert body["review"] is None and body["review_count"] == 0


def test_filters(make_client):
    with make_client() as c:
        c.post("/api/reviews/DT40", json={"verdict": "infected"})
        c.post("/api/reviews/DT03", json={"verdict": "healthy"})
        c.post("/api/reviews/DT05", json={"verdict": "infected"})

        assert [r["sample_id"] for r in c.get("/api/reviews", params={"verdict": "infected"}).json()] == ["DT05", "DT40"]
        assert [r["sample_id"] for r in c.get("/api/reviews", params={"verdict": "healthy"}).json()] == ["DT03"]
        assert [r["sample_id"] for r in c.get("/api/reviews", params={"sample_id": "DT03"}).json()] == ["DT03"]
        assert c.get("/api/reviews", params={"verdict": "maybe"}).status_code == 422
        assert c.get("/api/reviews", params={"sample_id": "DT99"}).status_code == 422
        assert c.get("/api/reviews", params={"sample_id": "../DT40"}).status_code == 422

        decisions = {r["sample_id"]: r["decision"] for r in c.get("/api/reviews").json()}
        assert decisions == {"DT40": "referred", "DT03": "referred", "DT05": "positive"}


def test_csv_export(make_client):
    with make_client() as c:
        c.post("/api/reviews/DT40", json={"verdict": "infected", "note": "=HYPERLINK(\"http://x\")", "tester_code": "T1"})
        c.post("/api/reviews/DT03", json={"verdict": "healthy", "note": "Debris only, see tile 2"})
        for note in ["+1", "-2", "@SUM(A1)"]:
            c.post("/api/reviews/DT05", json={"verdict": "infected", "note": note})

        r = c.get("/api/reviews.csv")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        assert r.headers["content-disposition"] == 'attachment; filename="bilharz-reviews.csv"'
        rows = list(csv.reader(io.StringIO(r.text)))
        assert rows[0] == [
            "review_id", "sample_id", "system_decision", "verdict", "note", "tester_code", "created_at", "supersedes",
        ]
        by_note = {row[4]: row for row in rows[1:]}
        assert "'=HYPERLINK(\"http://x\")" in by_note
        assert by_note["'=HYPERLINK(\"http://x\")"][1:4] == ["DT40", "referred", "infected"]
        assert {"'+1", "'-2", "'@SUM(A1)", "Debris only, see tile 2"} <= set(by_note)
        assert all(not row[4].startswith(("=", "+", "-", "@")) for row in rows[1:])
        assert [row[1] for row in rows[1:]][:1] == ["DT05"]  # newest first
        assert len(rows) == 1 + 5  # every version, not only the current ones

        filtered = list(csv.reader(io.StringIO(c.get("/api/reviews.csv", params={"verdict": "healthy"}).text)))
        assert [row[1] for row in filtered[1:]] == ["DT03"]


def test_no_labels_in_review_responses(make_client):
    labels = {"y", "eggs", "label", "labels", "truth", "diagnosis", "infected_truth"}

    def keys(value):
        if isinstance(value, dict):
            for k, v in value.items():
                yield k
                yield from keys(v)
        elif isinstance(value, list):
            for v in value:
                yield from keys(v)

    with make_client() as c:
        c.post("/api/reviews/DT40", json={"verdict": "infected", "note": "spine visible"})
        bodies = [
            c.get("/api/samples").json(),
            c.get("/api/samples/DT40").json(),
            c.get("/api/reviews").json(),
            c.get("/api/reviews", params={"sample_id": "DT40"}).json(),
        ]
        for body in bodies:
            assert not labels & set(keys(body))
        header = c.get("/api/reviews.csv").text.splitlines()[0].split(",")
        assert not labels & set(header) and "egg" not in json.dumps(header)


# Amending reviews ---------------------------------------------------------------


def test_amend_keeps_the_old_version(make_client):
    with make_client() as c:
        first = c.post("/api/reviews/DT40", json={"verdict": "healthy", "note": "No egg seen"}).json()
        assert first["supersedes"] is None
        r = c.post("/api/reviews/DT40", json={"verdict": "infected", "note": "Spine on tile 1", "supersedes": first["id"]})
        assert r.status_code == 201
        second = r.json()
        assert second["supersedes"] == first["id"] and second["id"] != first["id"]

        everything = c.get("/api/reviews", params={"view": "all"}).json()
        assert [(x["id"], x["verdict"], x["supersedes"]) for x in everything] == [
            (second["id"], "infected", first["id"]),
            (first["id"], "healthy", None),
        ]
        assert all(x["version_count"] == 2 for x in everything)

        result = c.get("/api/samples/DT40").json()
        assert result["review"]["id"] == second["id"] and result["review"]["verdict"] == "infected"
        assert result["review_count"] == 2


def test_current_view_has_one_row_per_sample(make_client):
    with make_client() as c:
        a = c.post("/api/reviews/DT40", json={"verdict": "healthy"}).json()
        b = c.post("/api/reviews/DT40", json={"verdict": "infected", "supersedes": a["id"]}).json()
        c.post("/api/reviews/DT40", json={"verdict": "healthy", "supersedes": b["id"]})
        c.post("/api/reviews/DT03", json={"verdict": "infected"})

        current = c.get("/api/reviews").json()  # view=current is the default
        assert c.get("/api/reviews", params={"view": "current"}).json() == current
        assert [(x["sample_id"], x["verdict"], x["version_count"]) for x in current] == [
            ("DT03", "infected", 1),
            ("DT40", "healthy", 3),
        ]
        assert len(c.get("/api/reviews", params={"view": "all"}).json()) == 4
        assert [x["sample_id"] for x in c.get("/api/reviews", params={"verdict": "healthy"}).json()] == ["DT40"]
        assert c.get("/api/reviews", params={"view": "latest"}).status_code == 422

        queue = {s["id"]: s for s in c.get("/api/samples").json()["samples"]}
        assert queue["DT40"]["review"]["verdict"] == "healthy"


def test_stale_supersedes_is_409(make_client):
    with make_client() as c:
        first = c.post("/api/reviews/DT40", json={"verdict": "healthy"}).json()
        c.post("/api/reviews/DT40", json={"verdict": "infected", "supersedes": first["id"]})
        # A second reviewer still looking at the first version:
        r = c.post("/api/reviews/DT40", json={"verdict": "healthy", "supersedes": first["id"]})
        assert r.status_code == 409
        assert r.json() == {"detail": "This review has already been changed. Reload to see the latest."}
        assert len(c.get("/api/reviews", params={"view": "all"}).json()) == 2


def test_supersedes_must_belong_to_the_sample(make_client):
    with make_client() as c:
        other = c.post("/api/reviews/DT03", json={"verdict": "healthy"}).json()
        c.post("/api/reviews/DT40", json={"verdict": "healthy"})
        wrong_sample = c.post("/api/reviews/DT40", json={"verdict": "infected", "supersedes": other["id"]})
        assert 400 <= wrong_sample.status_code < 500 and wrong_sample.status_code != 409
        missing = c.post("/api/reviews/DT40", json={"verdict": "infected", "supersedes": 99999})
        assert 400 <= missing.status_code < 500
        assert c.post("/api/reviews/DT40", json={"verdict": "infected", "supersedes": "x"}).status_code == 422
        assert len(c.get("/api/reviews", params={"view": "all"}).json()) == 2


def test_old_database_is_migrated(tmp_path):
    import sqlite3

    from bilharz.reviews import ReviewStore

    db = tmp_path / "old.db"
    con = sqlite3.connect(db)
    con.execute(
        "CREATE TABLE reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, sample_id TEXT NOT NULL, "
        "verdict TEXT NOT NULL CHECK (verdict IN ('infected', 'healthy')), note TEXT, tester_code TEXT, "
        "created_at TEXT NOT NULL)"
    )
    con.execute("INSERT INTO reviews (sample_id, verdict, note, tester_code, created_at) VALUES ('DT40', 'healthy', 'kept', NULL, '2026-10-26T10:00:00+00:00')")
    con.commit()
    con.close()

    store = ReviewStore(db)
    [old] = store.all()
    assert old["note"] == "kept" and old["supersedes"] is None
    new = store.add("DT40", "infected", None, None, supersedes=old["id"])
    assert new["supersedes"] == old["id"]
    assert [r["verdict"] for r in store.current()] == ["infected"]
