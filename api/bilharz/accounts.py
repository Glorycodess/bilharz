"""Reviewer accounts, kept in `accounts.jsonl` on persistent storage.

An account is a name, an email address, an Argon2 password hash, a role
(reviewer or admin) and a status:

    pending   just signed up; can sign in, but cannot review
    approved  an admin approved it; can review (and, as an admin, manage accounts)
    disabled  an admin turned it off; cannot sign in

The file holds one JSON line per account, its current state. Like the reviews
journal it is never changed in place: every change writes the whole file to a
temporary file that then replaces it. One process owns the file and a lock
orders its writes. If the file cannot be read completely, nothing is ever
written over it, and accounts cannot be created or changed (`writable` False)
until someone repairs it.

Passwords and reset tokens are never stored: only the password's hash, and a
SHA-256 hash of a reset token with its expiry.
"""
import json
import logging
import re
import threading
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from pathlib import Path

from .storage import replace_file

log = logging.getLogger("bilharz")

ROLES = ("reviewer", "admin")
STATUSES = ("pending", "approved", "disabled")
NAME_MAX = 100
EMAIL_MAX = 254
# One @, something on both sides, a dot in the domain, no spaces. Whether the
# address really exists is not checked: Bilharz sends no email.
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalise_email(email: str) -> str:
    return email.strip().lower()


def name_problem(name: str) -> str | None:
    name = name.strip()
    if not name:
        return "Enter your name."
    if len(name) > NAME_MAX:
        return f"Use at most {NAME_MAX} characters for your name."
    if CONTROL.search(name):
        return "The name contains characters that aren't allowed."
    return None


def email_problem(email: str) -> str | None:
    email = normalise_email(email)
    if len(email) > EMAIL_MAX or not EMAIL.match(email):
        return "Enter a valid email address."
    return None


@dataclass(frozen=True)
class Account:
    id: int
    name: str
    email: str
    password_hash: str
    role: str
    status: str
    created_at: str
    approved_at: str | None = None
    approved_by: int | None = None
    disabled_at: str | None = None
    password_changed_at: str | None = None
    reset_token_hash: str | None = None
    reset_expires_at: float | None = None

    @property
    def can_review(self) -> bool:
        return self.status == "approved"

    @property
    def is_admin(self) -> bool:
        return self.status == "approved" and self.role == "admin"


FIELDS = tuple(Account.__dataclass_fields__)


class EmailTaken(Exception):
    """Another account has this email address."""


class AccountsUnavailable(Exception):
    """The accounts file could not be read completely or cannot be written."""


def _account_from_json(line: str) -> Account | None:
    try:
        row = json.loads(line)
    except ValueError:
        return None
    if not isinstance(row, dict) or set(row) != set(FIELDS):
        return None
    try:
        account = Account(**row)
    except TypeError:
        return None
    valid = (
        type(account.id) is int
        and account.id > 0
        and isinstance(account.name, str)
        and isinstance(account.email, str)
        and isinstance(account.password_hash, str)
        and account.role in ROLES
        and account.status in STATUSES
        and isinstance(account.created_at, str)
    )
    return account if valid else None


class AccountStore:
    """Every account, in memory, backed by `accounts.jsonl` in `directory`."""

    NAME = "accounts.jsonl"

    def __init__(self, directory: Path):
        self.path = directory / self.NAME
        self.readable = False
        self.writable = False
        self._accounts: dict[int, Account] = {}
        self._lock = threading.Lock()
        try:
            directory.mkdir(parents=True, exist_ok=True)
            lines = self.path.read_text("utf-8").splitlines() if self.path.exists() else []
        except (OSError, UnicodeDecodeError) as error:
            log.error("Accounts file %s could not be read (%s): accounts are unavailable", self.path, type(error).__name__)
            return
        bad = []
        for number, line in enumerate(lines, 1):
            if not line.strip():
                continue
            account = _account_from_json(line)
            if account is None or account.id in self._accounts:
                bad.append(number)
                continue
            self._accounts[account.id] = account
        if bad:
            # Rewriting the file would drop these lines, so it is left alone.
            log.error(
                "Accounts file %s: line(s) %s could not be read; accounts are read-only until it is repaired",
                self.path,
                ", ".join(map(str, bad)),
            )
            self.readable = True
            return
        self.readable = True
        self.writable = self._probe(directory)

    @staticmethod
    def _replace(path: Path, data: bytes) -> None:
        replace_file(path, data)

    def _probe(self, directory: Path) -> bool:
        probe = directory / ".bilharz-accounts-probe"
        try:
            for attempt in (b"1", b"2"):
                self._replace(probe, attempt)
                if probe.read_bytes() != attempt:
                    raise OSError("read back a different value")
            probe.unlink()
        except OSError as error:
            log.error("Accounts directory %s is not writable (%s)", directory, error)
            return False
        return True

    def _save(self, accounts: dict[int, Account]) -> None:
        """Write every account; on success, they become the current state."""
        if not self.writable:
            raise AccountsUnavailable
        data = "".join(json.dumps(asdict(a), ensure_ascii=False) + "\n" for a in sorted(accounts.values(), key=lambda a: a.id))
        try:
            self._replace(self.path, data.encode("utf-8"))
        except OSError as error:
            log.error("Accounts file %s could not be written (%s)", self.path, type(error).__name__)
            raise AccountsUnavailable from None
        self._accounts = accounts

    def __len__(self) -> int:
        return len(self._accounts)

    def all(self) -> list[Account]:
        return sorted(self._accounts.values(), key=lambda a: a.id)

    def get(self, account_id: int) -> Account | None:
        return self._accounts.get(account_id)

    def by_email(self, email: str) -> Account | None:
        email = normalise_email(email)
        return next((a for a in self._accounts.values() if a.email == email), None)

    def by_reset_token_hash(self, token_hash: str) -> Account | None:
        return next((a for a in self._accounts.values() if a.reset_token_hash == token_hash), None)

    def create(self, name: str, email: str, password_hash: str) -> Account:
        """A new pending reviewer account. Raises EmailTaken or AccountsUnavailable."""
        with self._lock:
            email = normalise_email(email)
            if any(a.email == email for a in self._accounts.values()):
                raise EmailTaken
            account = Account(
                id=max(self._accounts, default=0) + 1,
                name=name.strip(),
                email=email,
                password_hash=password_hash,
                role="reviewer",
                status="pending",
                created_at=now_iso(),
            )
            self._save({**self._accounts, account.id: account})
            return account

    def update(self, account_id: int, **changes) -> Account:
        """Change some fields of an account; returns it. Raises KeyError or AccountsUnavailable."""
        with self._lock:
            account = replace(self._accounts[account_id], **changes)
            self._save({**self._accounts, account_id: account})
            return account
