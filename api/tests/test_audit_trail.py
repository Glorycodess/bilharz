"""The audit trail: who recorded each review, one review history per sample, and
a journal that old and new versions of the app can both read."""
import csv
import io
import json
import sqlite3
import threading

import pytest

from bilharz.reviews import REQUIRED, ReviewExists, ReviewJournal, ReviewStore
from bilharz.routes.deps import Reviewer, current_reviewer

from .conftest import ADMIN_TOKEN
from .test_journal import journal_lines, start  # noqa: F401  (start is a fixture)

ADMIN = {"X-Admin-Token": ADMIN_TOKEN}
ADA = Reviewer(id=7, name="Ada Obi")


def signed_in(client, reviewer=ADA):
    """Stand in for the session: the server says who is signed in."""
    client.app.dependency_overrides[current_reviewer] = lambda: reviewer
    return client


# The journal parser of the deployed version (commit 280f277), verbatim. Used to
# check that a rollback to it can still read what this version writes.
DEPLOYED_COLUMNS = ("id", "sample_id", "verdict", "note", "tester_code", "created_at", "supersedes")


def deployed_review_from_json(line: str) -> dict | None:
    """A journal line as a review row, or None if it is not a complete, valid review."""
    try:
        row = json.loads(line)
    except ValueError:
        return None
    if not isinstance(row, dict) or set(row) != set(DEPLOYED_COLUMNS):
        return None
    optional_text = (row["note"], row["tester_code"])
    valid = (
        type(row["id"]) is int
        and row["id"] > 0
        and isinstance(row["sample_id"], str)
        and row["verdict"] in ("infected", "healthy")
        and all(v is None or isinstance(v, str) for v in optional_text)
        and isinstance(row["created_at"], str)
        and (row["supersedes"] is None or type(row["supersedes"]) is int)
    )
    return {c: row[c] for c in DEPLOYED_COLUMNS} if valid else None


def old_line(id, sample_id="DT40", verdict="healthy", supersedes=None, note=None):
    """A journal line exactly as the deployed version writes it."""
    return json.dumps(
        dict(id=id, sample_id=sample_id, verdict=verdict, note=note, tester_code=None,
             created_at="2026-10-29T10:00:00+00:00", supersedes=supersedes),
        ensure_ascii=False,
    )


def write_journal(tmp_path, lines):
    bucket = tmp_path / "bucket"
    bucket.mkdir(exist_ok=True)
    (bucket / "reviews.jsonl").write_text("".join(line + "\n" for line in lines))


# One review history per sample ------------------------------------------------


def test_a_second_first_review_is_409_and_not_stored(make_client):
    with make_client() as c:
        first = c.post("/api/reviews/DT40", json={"verdict": "healthy"})
        assert first.status_code == 201
        again = c.post("/api/reviews/DT40", json={"verdict": "infected", "note": "my own look"})
        assert again.status_code == 409
        assert again.json() == {"detail": "This sample already has a review. Edit the existing review instead."}
        assert [r["verdict"] for r in c.get("/api/reviews", params={"view": "all"}).json()] == ["healthy"]

        # Editing the existing review is still how the verdict changes.
        edit = c.post("/api/reviews/DT40", json={"verdict": "infected", "supersedes": first.json()["id"]})
        assert edit.status_code == 201
        assert c.get("/api/samples/DT40").json()["review_count"] == 2


def test_two_first_reviews_at_the_same_moment_store_one(tmp_path):
    store = ReviewStore(tmp_path / "reviews.db")
    barrier = threading.Barrier(8)
    outcomes = []

    def review():
        barrier.wait()
        try:
            store.add("DT40", "healthy", None, None)
            outcomes.append("stored")
        except ReviewExists:
            outcomes.append("refused")

    threads = [threading.Thread(target=review) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(outcomes) == ["refused"] * 7 + ["stored"]
    assert len(store.all()) == 1


def test_samples_with_several_first_reviews_from_before_still_work(start, tmp_path):  # noqa: F811
    """The live journal has samples reviewed more than once without `supersedes`:
    they are kept, the latest is current, and it can be edited."""
    write_journal(tmp_path, [old_line(1), old_line(2, verdict="infected"), old_line(3)])
    with start() as c:
        result = c.get("/api/samples/DT40").json()
        assert result["review"]["id"] == 3 and result["review_count"] == 3
        assert c.post("/api/reviews/DT40", json={"verdict": "healthy"}).status_code == 409
        assert c.post("/api/reviews/DT40", json={"verdict": "infected", "supersedes": 3}).status_code == 201


# The reviewer comes from the session -----------------------------------------


def test_the_reviewer_is_taken_from_the_session(make_client):
    with signed_in(make_client()) as c:
        saved = c.post("/api/reviews/DT40", json={"verdict": "infected", "note": "Spine on tile 1"}).json()
        assert saved["reviewer_name"] == "Ada Obi"

        assert c.get("/api/reviews").json()[0]["reviewer_name"] == "Ada Obi"
        assert c.get("/api/samples/DT40").json()["review"]["reviewer_name"] == "Ada Obi"
        with sqlite3.connect(c.app.state.settings.reviews_db) as db:
            assert db.execute("SELECT reviewer_id, reviewer_name FROM reviews").fetchall() == [(7, "Ada Obi")]

        rows = list(csv.reader(io.StringIO(c.get("/api/reviews.csv", headers=ADMIN).text)))
        assert rows[0][-2:] == ["reviewer_id", "reviewer"]
        assert rows[1][-2:] == ["7", "Ada Obi"]


def test_each_version_keeps_the_reviewer_who_made_it(make_client):
    with signed_in(make_client()) as c:
        first = c.post("/api/reviews/DT40", json={"verdict": "healthy"}).json()
        signed_in(c, Reviewer(id=9, name="Kofi Mensah"))
        c.post("/api/reviews/DT40", json={"verdict": "infected", "supersedes": first["id"]})
        history = c.get("/api/reviews", params={"view": "all"}).json()
        assert [(r["verdict"], r["reviewer_name"]) for r in history] == [("infected", "Kofi Mensah"), ("healthy", "Ada Obi")]


@pytest.mark.parametrize(
    "extra",
    [
        {"reviewer_id": 1},
        {"reviewer_name": "Someone else"},
        {"reviewer": {"id": 1, "name": "Someone else"}},
        {"reviewer_id": 7, "reviewer_name": "Ada Obi"},
    ],
)
def test_a_reviewer_sent_in_the_body_is_refused(make_client, extra):
    with signed_in(make_client()) as c:
        r = c.post("/api/reviews/DT40", json={"verdict": "healthy", **extra})
        assert r.status_code == 422
        assert c.get("/api/reviews").json() == []


def test_without_a_session_the_reviewer_is_unknown(make_client):
    with make_client() as c:
        assert c.post("/api/reviews/DT40", json={"verdict": "healthy"}).json()["reviewer_name"] is None
        row = list(csv.reader(io.StringIO(c.get("/api/reviews.csv", headers=ADMIN).text)))[1]
        assert row[-2:] == ["", "unknown"]


def test_the_reviewer_is_hidden_with_the_note_without_the_review_code(make_client):
    with signed_in(make_client(review_code="ward-7-code")) as c:
        c.post("/api/reviews/DT40", json={"verdict": "infected", "note": "Spine"}, headers={"X-Review-Code": "ward-7-code"})
        hidden = c.get("/api/samples/DT40").json()["review"]
        assert hidden["reviewer_name"] is None and hidden["details_hidden"] is True
        shown = c.get("/api/samples/DT40", headers={"X-Review-Code": "ward-7-code"}).json()["review"]
        assert shown["reviewer_name"] == "Ada Obi"


def test_a_reviewer_name_that_looks_like_a_formula_is_escaped_in_the_csv(make_client):
    with signed_in(make_client(), Reviewer(id=3, name="=cmd()")) as c:
        c.post("/api/reviews/DT40", json={"verdict": "healthy"})
        row = list(csv.reader(io.StringIO(c.get("/api/reviews.csv", headers=ADMIN).text)))[1]
        assert row[-1] == "'=cmd()"


# The journal: old lines, new lines, both directions ---------------------------


def test_journal_lines_from_the_deployed_version_are_all_read(start, tmp_path):  # noqa: F811
    """58 lines in the deployed format, as on the live Space: none is unreadable."""
    lines = [old_line(i, sample_id=f"DT{(i % 48) + 1:02d}", note="ok" if i % 10 == 0 else None) for i in range(1, 59)]
    write_journal(tmp_path, lines)
    with start() as c:
        assert c.get("/api/health").json()["reviews_unreadable"] == 0
        everything = c.get("/api/reviews", params={"view": "all"}).json()
        assert len(everything) == 58
        assert all(r["reviewer_name"] is None for r in everything)
        csv_rows = list(csv.reader(io.StringIO(c.get("/api/reviews.csv", headers=ADMIN).text)))[1:]
        assert len(csv_rows) == 58 and {tuple(r[-2:]) for r in csv_rows} == {("", "unknown")}
    # Reading changed nothing in the file.
    assert journal_lines(tmp_path) == lines


def test_a_review_without_a_reviewer_is_written_as_the_deployed_version_writes_it(start, tmp_path):  # noqa: F811
    """So a rollback to the deployed version reads every review recorded before sign-in exists."""
    write_journal(tmp_path, [old_line(1, sample_id="DT03")])
    with start() as c:
        first = c.post("/api/reviews/DT40", json={"verdict": "healthy"}).json()
        c.post("/api/reviews/DT40", json={"verdict": "infected", "supersedes": first["id"]})
    lines = journal_lines(tmp_path)
    assert len(lines) == 3
    assert all(set(json.loads(line)) == set(REQUIRED) for line in lines)
    assert all(deployed_review_from_json(line) is not None for line in lines)


def test_a_review_with_a_reviewer_is_read_back_after_a_restart(start, tmp_path):  # noqa: F811
    write_journal(tmp_path, [old_line(1, sample_id="DT03")])
    with signed_in(start()) as c:
        c.post("/api/reviews/DT40", json={"verdict": "infected"})
    new_line = journal_lines(tmp_path)[1]
    assert json.loads(new_line)["reviewer_id"] == 7 and json.loads(new_line)["reviewer_name"] == "Ada Obi"

    with start() as c:  # a restart: the database is rebuilt from the journal
        assert c.get("/api/health").json()["reviews_unreadable"] == 0
        by_sample = {r["sample_id"]: r["reviewer_name"] for r in c.get("/api/reviews").json()}
        assert by_sample == {"DT40": "Ada Obi", "DT03": None}

    # The deployed version cannot read a line with a reviewer (it would count it
    # as unreadable and keep it in the file); it still reads the old line.
    assert deployed_review_from_json(new_line) is None
    assert deployed_review_from_json(journal_lines(tmp_path)[0]) is not None


def test_fields_a_later_version_adds_are_ignored_and_kept(start, tmp_path):  # noqa: F811
    later = json.dumps({**json.loads(old_line(1)), "reviewer_id": 4, "reviewer_name": "Ama", "site": "Ward 7"})
    write_journal(tmp_path, [later])
    with start() as c:
        assert c.get("/api/health").json()["reviews_unreadable"] == 0
        assert c.get("/api/reviews").json()[0]["reviewer_name"] == "Ama"
        c.post("/api/reviews/DT03", json={"verdict": "healthy"})
    assert journal_lines(tmp_path)[0] == later


@pytest.mark.parametrize(
    "bad",
    [
        {"reviewer_id": "7"},
        {"reviewer_id": 0},
        {"reviewer_id": True},
        {"reviewer_name": 7},
    ],
)
def test_invalid_reviewer_fields_make_a_line_unreadable(start, tmp_path, bad):  # noqa: F811
    write_journal(tmp_path, [old_line(1), json.dumps({**json.loads(old_line(2, sample_id="DT03")), **bad})])
    with start() as c:
        assert c.get("/api/health").json()["reviews_unreadable"] == 1
        assert [r["id"] for r in c.get("/api/reviews").json()] == [1]


def test_a_line_missing_a_required_field_is_still_unreadable(start, tmp_path):  # noqa: F811
    incomplete = json.loads(old_line(1))
    del incomplete["supersedes"]
    write_journal(tmp_path, [json.dumps(incomplete)])
    with start() as c:
        assert c.get("/api/health").json()["reviews_unreadable"] == 1


def test_a_database_from_the_deployed_version_is_migrated(tmp_path):
    db = tmp_path / "deployed.db"
    with sqlite3.connect(db) as con:
        con.execute(
            "CREATE TABLE reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, sample_id TEXT NOT NULL, "
            "verdict TEXT NOT NULL CHECK (verdict IN ('infected', 'healthy')), note TEXT, tester_code TEXT, "
            "created_at TEXT NOT NULL, supersedes INTEGER REFERENCES reviews (id))"
        )
        con.execute("INSERT INTO reviews (sample_id, verdict, created_at) VALUES ('DT40', 'healthy', '2026-10-29T10:00:00+00:00')")
    store = ReviewStore(db)
    [old] = store.all()
    assert old["reviewer_id"] is None and old["reviewer_name"] is None
    new = store.add("DT40", "infected", None, None, supersedes=old["id"], reviewer_id=7, reviewer_name="Ada Obi")
    assert store.current()[0]["reviewer_name"] == "Ada Obi" and new["supersedes"] == old["id"]


def test_journal_rewrites_keep_the_deployed_format_for_reviews_without_a_reviewer(tmp_path):
    journal = ReviewJournal(tmp_path)
    rows = [dict(id=1, sample_id="DT40", verdict="healthy", note=None, tester_code=None,
                 created_at="2026-10-29T10:00:00+00:00", supersedes=None, reviewer_id=None, reviewer_name=None)]
    journal.replace_all(rows)
    [line] = (tmp_path / "reviews.jsonl").read_text().splitlines()
    assert deployed_review_from_json(line) is not None
