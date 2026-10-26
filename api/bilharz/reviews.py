"""Technician reviews in SQLite.

Only the review itself is stored: no names, IP addresses or user agents. The
tester code is optional and anonymous.
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
    created_at TEXT NOT NULL
)
"""

COLUMNS = ("id", "sample_id", "verdict", "note", "tester_code", "created_at")


class ReviewStore:
    def __init__(self, path: Path):
        self._path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute(SCHEMA)

    @contextmanager
    def _connect(self):
        """One connection per operation: committed on success, always closed."""
        db = sqlite3.connect(self._path)
        try:
            with db:
                yield db
        finally:
            db.close()

    def add(self, sample_id: str, verdict: str, note: str | None, tester_code: str | None) -> dict:
        created = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with self._connect() as db:
            cur = db.execute(
                "INSERT INTO reviews (sample_id, verdict, note, tester_code, created_at) VALUES (?, ?, ?, ?, ?)",
                (sample_id, verdict, note, tester_code, created),
            )
            row_id = cur.lastrowid
        return dict(zip(COLUMNS, (row_id, sample_id, verdict, note, tester_code, created)))

    def all(self) -> list[dict]:
        with self._connect() as db:
            rows = db.execute(f"SELECT {', '.join(COLUMNS)} FROM reviews ORDER BY id").fetchall()
        return [dict(zip(COLUMNS, r)) for r in rows]

    def reviewed_ids(self) -> set[str]:
        with self._connect() as db:
            return {r[0] for r in db.execute("SELECT DISTINCT sample_id FROM reviews")}

    def clear(self) -> int:
        with self._connect() as db:
            return db.execute("DELETE FROM reviews").rowcount
