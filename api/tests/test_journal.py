"""Reviews kept in a journal on persistent storage, and rebuilt on restart."""
import json
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from bilharz.reviews import ReviewJournal
from server import create_app

from .conftest import ADMIN_TOKEN


@pytest.fixture()
def start(base_settings, scorer, tmp_path):
    """Start an app over a reviews directory, each time with a new, empty local
    database: as the Space starts after a restart."""
    starts = iter(range(1, 100))

    def make(reviews_dir=tmp_path / "bucket", **changes):
        db = tmp_path / f"local-{next(starts)}" / "reviews.db"
        settings = replace(base_settings, reviews_db=db, reviews_dir=reviews_dir, reviews_persistent=False, **changes)
        return TestClient(create_app(settings, scorer=scorer))

    return make


def journal_lines(tmp_path):
    return (tmp_path / "bucket" / "reviews.jsonl").read_text().splitlines()


def test_reviews_and_versions_survive_a_restart(start, tmp_path):
    with start() as c:
        assert c.get("/api/health").json()["reviews_persistent"] is True
        first = c.post("/api/reviews/DT40", json={"verdict": "infected", "note": "Spine on tile 1.", "tester_code": "T7"})
        c.post("/api/reviews/DT03", json={"verdict": "healthy"})
        c.post("/api/reviews/DT40", json={"verdict": "healthy", "supersedes": first.json()["id"]})
        before = c.get("/api/reviews?view=all").json()
    assert len(before) == 3

    with start() as c:
        after = c.get("/api/reviews?view=all").json()
        assert after == before
        current = {r["sample_id"]: r for r in c.get("/api/reviews").json()}
        assert current["DT40"]["verdict"] == "healthy" and current["DT40"]["version_count"] == 2
        assert current["DT40"]["supersedes"] == first.json()["id"]
        # Conflict detection still works on the rebuilt history.
        stale = c.post("/api/reviews/DT40", json={"verdict": "infected", "supersedes": first.json()["id"]})
        assert stale.status_code == 409
        newer = c.post("/api/reviews/DT40", json={"verdict": "infected", "supersedes": current["DT40"]["id"]})
        assert newer.status_code == 201 and newer.json()["id"] > current["DT40"]["id"]

    with start() as c:
        assert len(c.get("/api/reviews?view=all").json()) == 4
    assert len(journal_lines(tmp_path)) == 4


def test_unreadable_lines_are_reported_and_kept(start, tmp_path):
    good = dict(id=1, sample_id="DT40", verdict="infected", note=None, tester_code=None,
                created_at="2026-10-01T10:00:00+00:00", supersedes=None)
    bucket = tmp_path / "bucket"
    bucket.mkdir()
    lines = [
        json.dumps(good),
        "not json",
        json.dumps({**good, "id": 2, "verdict": "maybe"}),
        json.dumps({**good, "sample_id": "DT03"}),  # repeats id 1
        "[1, 2]",
        "",
        '{"id": 3, "sample_id": "DT0',  # cut off mid-write
    ]
    (bucket / "reviews.jsonl").write_text("\n".join(lines))

    with start() as c:
        health = c.get("/api/health").json()
        assert health["reviews_unreadable"] == 5 and health["reviews_persistent"] is True
        assert [r["id"] for r in c.get("/api/reviews?view=all").json()] == [1]
        added = c.post("/api/reviews/DT03", json={"verdict": "healthy"})
        assert added.status_code == 201 and added.json()["id"] == 2

    # Nothing was dropped from the file: the bad lines are still there for
    # someone to repair, and the new review follows them.
    kept = journal_lines(tmp_path)
    assert kept[:7] == lines and json.loads(kept[7])["sample_id"] == "DT03"


def test_unwritable_directory_is_reported_and_reviews_still_work(start, tmp_path):
    blocker = tmp_path / "not-a-directory"
    blocker.write_text("")
    with start(reviews_dir=blocker / "reviews") as c:
        assert c.get("/api/health").json()["reviews_persistent"] is False
        assert c.post("/api/reviews/DT40", json={"verdict": "healthy"}).status_code == 201


def test_a_journal_that_fails_the_write_test_is_read_but_never_written(start, tmp_path, monkeypatch):
    with start() as c:
        c.post("/api/reviews/DT40", json={"verdict": "infected"})
    before = (tmp_path / "bucket" / "reviews.jsonl").read_bytes()

    def refuse(path, data):
        raise PermissionError("rename not allowed")

    monkeypatch.setattr(ReviewJournal, "_replace", staticmethod(refuse))
    with start() as c:
        assert c.get("/api/health").json()["reviews_persistent"] is False
        assert [r["sample_id"] for r in c.get("/api/reviews").json()] == ["DT40"]
        assert c.post("/api/reviews/DT03", json={"verdict": "healthy"}).status_code == 201
    assert (tmp_path / "bucket" / "reviews.jsonl").read_bytes() == before


def test_a_probe_that_reads_back_wrong_fails_the_write_test(tmp_path, monkeypatch):
    original = ReviewJournal._replace

    def lossy(path, data):
        original(path, b"" if path.name.startswith(".bilharz-probe") else data)

    monkeypatch.setattr(ReviewJournal, "_replace", staticmethod(lossy))
    assert ReviewJournal(tmp_path / "bucket").writable is False


def test_a_review_the_journal_could_not_take_is_not_stored(start, monkeypatch):
    with start() as c:
        def fail(path, data):
            raise OSError("bucket unavailable")

        monkeypatch.setattr(ReviewJournal, "_replace", staticmethod(fail))
        assert c.post("/api/reviews/DT40", json={"verdict": "healthy"}).status_code == 500
        assert c.get("/api/reviews").json() == []


def test_first_start_with_a_journal_keeps_existing_reviews(base_settings, scorer, tmp_path):
    db = tmp_path / "reviews.db"
    with TestClient(create_app(replace(base_settings, reviews_db=db), scorer=scorer)) as c:
        c.post("/api/reviews/DT40", json={"verdict": "infected"})
        c.post("/api/reviews/DT03", json={"verdict": "healthy"})
    settings = replace(base_settings, reviews_db=db, reviews_dir=tmp_path / "bucket")
    with TestClient(create_app(settings, scorer=scorer)) as c:
        assert len(c.get("/api/reviews").json()) == 2
    assert [json.loads(line)["sample_id"] for line in journal_lines(tmp_path)] == ["DT40", "DT03"]


def test_clearing_reviews_clears_the_journal(start, tmp_path):
    with start() as c:
        c.post("/api/reviews/DT40", json={"verdict": "healthy"})
        assert c.delete("/api/reviews", headers={"X-Admin-Token": ADMIN_TOKEN}).json() == {"deleted": 1}
    assert journal_lines(tmp_path) == []
    with start() as c:
        assert c.get("/api/reviews").json() == []


def test_without_a_journal_health_reports_the_disk_setting(make_client):
    with make_client(reviews_persistent=False) as c:
        assert c.get("/api/health").json()["reviews_persistent"] is False
    with make_client() as c:
        assert c.get("/api/health").json()["reviews_persistent"] is True
