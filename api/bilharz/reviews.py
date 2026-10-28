"""Technician reviews in SQLite.

Only the review itself is stored: no names, IP addresses or user agents. The
tester code is optional and anonymous.

Reviews are never overwritten. A sample's current review is its latest one; a
change is a new review that names the one it replaces (`supersedes`), and every
earlier version stays as the audit trail.
"""
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_id TEXT NOT NULL,
    verdict TEXT NOT NULL CHECK (verdict IN ('infected', 'healthy')),
    note TEXT,
    tester_code TEXT,
    created_at TEXT NOT NULL,
    supersedes INTEGER REFERENCES reviews (id)
)
"""

COLUMNS = ("id", "sample_id", "verdict", "note", "tester_code", "created_at", "supersedes")
SELECT = f"SELECT {', '.join(COLUMNS)} FROM reviews"


class ReviewNotFound(Exception):
    """`supersedes` names a review that doesn't exist, or belongs to another sample."""


class ReviewConflict(Exception):
    """`supersedes` names a review that is no longer the sample's current one."""


class ReviewStore:
    """Reviews in one SQLite file; the table is created, or migrated, on start."""

    def __init__(self, path: Path):
        self._path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute(SCHEMA)
            # Databases from before review editing: add the column, keep every review.
            if "supersedes" not in {row[1] for row in db.execute("PRAGMA table_info(reviews)")}:
                db.execute("ALTER TABLE reviews ADD COLUMN supersedes INTEGER REFERENCES reviews (id)")

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
    ) -> dict:
        """Insert a review, or a new version of the current one (`supersedes`).
        Raises ReviewNotFound or ReviewConflict; returns the stored row."""
        created = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with self._connect() as db:
            # Hold the write lock from the check to the insert, so two edits of
            # the same review can't both succeed.
            db.execute("BEGIN IMMEDIATE")
            if supersedes is not None:
                old = db.execute("SELECT sample_id FROM reviews WHERE id = ?", (supersedes,)).fetchone()
                if old is None or old[0] != sample_id:
                    raise ReviewNotFound
                current = db.execute(
                    "SELECT MAX(id) FROM reviews WHERE sample_id = ?", (sample_id,)
                ).fetchone()[0]
                if current != supersedes:
                    raise ReviewConflict
            cur = db.execute(
                "INSERT INTO reviews (sample_id, verdict, note, tester_code, created_at, supersedes) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (sample_id, verdict, note, tester_code, created, supersedes),
            )
            row_id = cur.lastrowid
        return dict(zip(COLUMNS, (row_id, sample_id, verdict, note, tester_code, created, supersedes)))

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
            return db.execute("DELETE FROM reviews").rowcount
