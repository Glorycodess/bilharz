"""Technician reviews in SQLite.

A review stores the verdict, an optional note, the time, and who recorded it:
the signed-in reviewer's account id and name, taken from the server-side
session, never from the request. Reviews recorded before accounts existed
have no reviewer. No IP addresses or user agents are stored.

Reviews are never overwritten. A sample's current review is its latest one; a
change is a new review that names the one it replaces (`supersedes`), and every
earlier version stays as the audit trail. A sample has one review history: a
second, separate first review of the same sample is refused (ReviewExists).

Where the database's disk does not survive a restart (the Space), a
ReviewJournal on persistent storage keeps every review as well, and the
database is rebuilt from it at start-up.
"""
import json
import logging
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("bilharz")

SCHEMA = """
CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_id TEXT NOT NULL,
    verdict TEXT NOT NULL CHECK (verdict IN ('infected', 'healthy')),
    note TEXT,
    tester_code TEXT,
    created_at TEXT NOT NULL,
    supersedes INTEGER REFERENCES reviews (id),
    reviewer_id INTEGER,
    reviewer_name TEXT
)
"""

# Every review has the REQUIRED fields. The OPTIONAL ones were added later:
# journal lines from before then do not have them, and a line only has them
# when they are set, so a review without a reviewer is written exactly as
# before and older versions of this code can still read it.
REQUIRED = ("id", "sample_id", "verdict", "note", "tester_code", "created_at", "supersedes")
OPTIONAL = ("reviewer_id", "reviewer_name")
COLUMNS = REQUIRED + OPTIONAL
# Columns added to the table after it was first created, with their types.
ADDED_COLUMNS = {
    "supersedes": "INTEGER REFERENCES reviews (id)",
    "reviewer_id": "INTEGER",
    "reviewer_name": "TEXT",
}
SELECT = f"SELECT {', '.join(COLUMNS)} FROM reviews"


class ReviewNotFound(Exception):
    """`supersedes` names a review that doesn't exist, or belongs to another sample."""


class ReviewConflict(Exception):
    """`supersedes` names a review that is no longer the sample's current one."""


class ReviewExists(Exception):
    """A new review (no `supersedes`) for a sample that already has one."""


class ReviewJournal:
    """Every review as one JSON line in `reviews.jsonl`, in a directory on
    persistent storage (a Storage Bucket mounted into the Space).

    A bucket mount is not an ordinary disk: a file is uploaded when it is
    closed, and locks are not shared between machines. So the journal is never
    appended to in place. Each change writes the whole file to a temporary
    file, which then replaces the journal; a crash leaves the old journal or
    the new one, never half of one. One process owns the journal, and the lock
    orders its writes.

    At start-up the same steps are tried on a probe file. If they fail, or the
    journal cannot be read, nothing is written to the directory (so a journal
    that could not be read is never overwritten) and `writable` is False.
    """

    NAME = "reviews.jsonl"

    def __init__(self, directory: Path):
        self.path = directory / self.NAME
        self.readable = False
        self.writable = False
        # Line numbers (from 1) of lines that are not a valid review.
        self.unreadable: list[int] = []
        self._lines: list[str] = []
        self._lock = threading.Lock()
        try:
            directory.mkdir(parents=True, exist_ok=True)
            if self.path.exists():
                # Bytes that are not UTF-8 (a cut-off line) are kept as they are
                # and written back unchanged.
                self._lines = self.path.read_bytes().decode("utf-8", "surrogateescape").splitlines()
            self.readable = True
        except OSError as error:
            log.error("Reviews journal %s could not be read (%s): not using it", self.path, type(error).__name__)
            return
        self.writable = self._probe(directory)

    def _probe(self, directory: Path) -> bool:
        probe = directory / ".bilharz-probe"
        try:
            for attempt in (b"1", b"2"):  # the second replaces an existing file, as every write after the first does
                self._replace(probe, attempt)
                if probe.read_bytes() != attempt:
                    raise OSError("read back a different value")
            probe.unlink()
        except OSError as error:
            log.error("Reviews journal directory %s is not writable (%s)", directory, error)
            return False
        return True

    @staticmethod
    def _replace(path: Path, data: bytes) -> None:
        temporary = path.with_name(path.name + ".tmp")
        with open(temporary, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporary, path)

    def _write(self, lines: list[str]) -> None:
        self._replace(self.path, "".join(line + "\n" for line in lines).encode("utf-8", "surrogateescape"))

    def records(self) -> list[dict]:
        """Every valid review in the journal, in id order. Invalid lines are
        listed in `unreadable` and logged by number; they stay in the file."""
        records, seen = [], set()
        self.unreadable = []
        for number, line in enumerate(self._lines, 1):
            if not line.strip():
                continue
            row = _review_from_json(line)
            if row is None or row["id"] in seen:
                self.unreadable.append(number)
                continue
            seen.add(row["id"])
            records.append(row)
        if self.unreadable:
            log.warning(
                "Reviews journal %s: %d line(s) could not be read and were skipped (lines %s); "
                "they are kept in the file",
                self.path,
                len(self.unreadable),
                ", ".join(map(str, self.unreadable)),
            )
        return sorted(records, key=lambda r: r["id"])

    def append(self, row: dict) -> None:
        """Add one review; raises OSError if it could not be written."""
        with self._lock:
            lines = self._lines + [_review_to_json(row)]
            self._write(lines)
            self._lines = lines

    def replace_all(self, rows: list[dict]) -> None:
        with self._lock:
            lines = [_review_to_json(row) for row in rows]
            self._write(lines)
            self._lines = lines


def _review_to_json(row: dict) -> str:
    """A review as one journal line: every required field, and the optional ones that are set."""
    kept = {c: row[c] for c in REQUIRED}
    kept.update({c: row[c] for c in OPTIONAL if row.get(c) is not None})
    return json.dumps(kept, ensure_ascii=False)


def _review_from_json(line: str) -> dict | None:
    """A journal line as a review row, or None if it is not a complete, valid review.

    The required fields must all be there; optional fields that are missing are
    None. Fields this version does not know are ignored (they stay in the file),
    so a journal written by a later version can still be read."""
    try:
        row = json.loads(line)
    except ValueError:
        return None
    if not isinstance(row, dict) or not set(REQUIRED) <= set(row):
        return None
    row = {c: row.get(c) for c in COLUMNS}
    optional_text = (row["note"], row["tester_code"], row["reviewer_name"])
    valid = (
        type(row["id"]) is int
        and row["id"] > 0
        and isinstance(row["sample_id"], str)
        and row["verdict"] in ("infected", "healthy")
        and all(v is None or isinstance(v, str) for v in optional_text)
        and isinstance(row["created_at"], str)
        and (row["supersedes"] is None or type(row["supersedes"]) is int)
        and (row["reviewer_id"] is None or (type(row["reviewer_id"]) is int and row["reviewer_id"] > 0))
    )
    return row if valid else None


class ReviewStore:
    """Reviews in one SQLite file; the table is created, or migrated, on start.

    With a journal, the journal is the record: the database is rebuilt from it
    on start, and a review is only stored once the journal has it too.
    """

    def __init__(self, path: Path, journal: ReviewJournal | None = None, disk_persistent: bool = True):
        self._path = path
        self._journal = journal
        self._disk_persistent = disk_persistent
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute(SCHEMA)
            # Databases from before review editing or reviewer accounts: add
            # the missing columns, keep every review.
            existing = {row[1] for row in db.execute("PRAGMA table_info(reviews)")}
            for column, kind in ADDED_COLUMNS.items():
                if column not in existing:
                    db.execute(f"ALTER TABLE reviews ADD COLUMN {column} {kind}")
        if journal is not None and journal.readable:
            self._sync_with(journal)

    @property
    def persistent(self) -> bool:
        """Whether reviews survive a restart: in a writable journal if there is
        one, otherwise as the database's disk was described (`disk_persistent`)."""
        return self._disk_persistent if self._journal is None else self._journal.writable

    @property
    def unreadable(self) -> int:
        """How many journal lines could not be read at start-up."""
        return 0 if self._journal is None else len(self._journal.unreadable)

    def _sync_with(self, journal: ReviewJournal) -> None:
        if not journal.path.exists():
            # First start with a journal: start it from the reviews already here.
            if journal.writable:
                journal.replace_all(self.all()[::-1])
            return
        records = journal.records()
        with self._connect() as db:
            db.execute("DELETE FROM reviews")
            db.executemany(
                f"INSERT INTO reviews ({', '.join(COLUMNS)}) VALUES ({', '.join('?' * len(COLUMNS))})",
                [tuple(r[c] for c in COLUMNS) for r in records],
            )
        log.info("Rebuilt %d review(s) from %s", len(records), journal.path)

    @contextmanager
    def _connect(self):
        """One connection per operation: committed on success, always closed."""
        db = sqlite3.connect(self._path)
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def _row(row) -> dict:
        return dict(zip(COLUMNS, row))

    def add(
        self,
        sample_id: str,
        verdict: str,
        note: str | None,
        tester_code: str | None,
        supersedes: int | None = None,
        reviewer_id: int | None = None,
        reviewer_name: str | None = None,
    ) -> dict:
        """Insert a sample's first review, or a new version of its current one
        (`supersedes`). Raises ReviewExists, ReviewNotFound or ReviewConflict;
        returns the stored row."""
        created = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with self._connect() as db:
            # Hold the write lock from the check to the insert, so two edits of
            # the same review can't both succeed.
            db.execute("BEGIN IMMEDIATE")
            current = db.execute("SELECT MAX(id) FROM reviews WHERE sample_id = ?", (sample_id,)).fetchone()[0]
            if supersedes is None and current is not None:
                raise ReviewExists
            if supersedes is not None:
                old = db.execute("SELECT sample_id FROM reviews WHERE id = ?", (supersedes,)).fetchone()
                if old is None or old[0] != sample_id:
                    raise ReviewNotFound
                if current != supersedes:
                    raise ReviewConflict
            values = (sample_id, verdict, note, tester_code, created, supersedes, reviewer_id, reviewer_name)
            cur = db.execute(
                f"INSERT INTO reviews ({', '.join(COLUMNS[1:])}) VALUES ({', '.join('?' * len(values))})", values
            )
            row = dict(zip(COLUMNS, (cur.lastrowid, *values)))
            # Inside the transaction: if the journal can't be written, the insert is rolled back.
            if self._journal is not None and self._journal.writable:
                self._journal.append(row)
        return row

    def all(self, verdict: str | None = None, sample_id: str | None = None) -> list[dict]:
        """Every review, newest first, optionally filtered."""
        where, params = self._filters(verdict, sample_id)
        with self._connect() as db:
            rows = db.execute(f"{SELECT}{where} ORDER BY id DESC", params).fetchall()
        return [self._row(r) for r in rows]

    def current(self, verdict: str | None = None, sample_id: str | None = None) -> list[dict]:
        """Each reviewed sample's latest review, newest first, with its version count."""
        where, params = self._filters(verdict, sample_id, table="r")
        cols = ", ".join(f"r.{c}" for c in COLUMNS)
        sql = (
            f"SELECT {cols}, m.versions FROM reviews r "
            "JOIN (SELECT sample_id, MAX(id) AS id, COUNT(*) AS versions FROM reviews GROUP BY sample_id) m "
            f"ON r.id = m.id{where} ORDER BY r.id DESC"
        )
        with self._connect() as db:
            rows = db.execute(sql, params).fetchall()
        return [{**self._row(r[:-1]), "version_count": r[-1]} for r in rows]

    def latest(self) -> dict[str, dict]:
        """Each reviewed sample's current review, by sample ID."""
        return {r["sample_id"]: r for r in self.current()}

    def history(self, sample_id: str) -> tuple[dict | None, int]:
        """A sample's current review and how many versions it has."""
        rows = self.current(sample_id=sample_id)
        return (rows[0], rows[0]["version_count"]) if rows else (None, 0)

    def version_counts(self) -> dict[str, int]:
        """How many versions each reviewed sample's review has."""
        with self._connect() as db:
            return dict(db.execute("SELECT sample_id, COUNT(*) FROM reviews GROUP BY sample_id"))

    @staticmethod
    def _filters(verdict, sample_id, table=None):
        col = (lambda c: f"{table}.{c}") if table else (lambda c: c)
        where, params = [], []
        if verdict:
            where.append(f"{col('verdict')} = ?")
            params.append(verdict)
        if sample_id:
            where.append(f"{col('sample_id')} = ?")
            params.append(sample_id)
        return (" WHERE " + " AND ".join(where) if where else ""), params

    def clear(self) -> int:
        """Delete every review; returns how many were deleted."""
        with self._connect() as db:
            deleted = db.execute("DELETE FROM reviews").rowcount
            if self._journal is not None and self._journal.writable:
                self._journal.replace_all([])
            return deleted
