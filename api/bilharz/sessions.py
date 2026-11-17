"""Sign-in sessions, held in the server's memory.

A session is a random token (256 bits) in an HttpOnly cookie. The server keeps
only the token's SHA-256 hash, the account it belongs to, and two times: a
session ends after 8 hours without a request, and 7 days after sign-in at the
latest. Sessions are not written to disk, so a restart signs everyone out.
"""
import hashlib
import secrets
import threading
import time
from dataclasses import dataclass

IDLE_SECONDS = 8 * 60 * 60
MAX_SECONDS = 7 * 24 * 60 * 60

COOKIE_SECURE = "__Host-bilharz_session"  # __Host-: Secure, Path=/, no Domain; set over https only
COOKIE_PLAIN = "bilharz_session"  # development over plain http (BILHARZ_COOKIE_SECURE=false)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass
class _Session:
    account_id: int
    created: float
    last_seen: float


class SessionStore:
    def __init__(self, clock=time.time):
        self._clock = clock
        self._sessions: dict[str, _Session] = {}
        self._lock = threading.Lock()

    def create(self, account_id: int) -> str:
        """A new session for the account; returns the token for the cookie."""
        token = secrets.token_urlsafe(32)
        now = self._clock()
        with self._lock:
            self._purge(now)
            self._sessions[token_hash(token)] = _Session(account_id, now, now)
        return token

    def account_id(self, token: str | None) -> int | None:
        """The account of a live session, or None. A live session's idle clock restarts."""
        if not token:
            return None
        key = token_hash(token)
        now = self._clock()
        with self._lock:
            session = self._sessions.get(key)
            if session is None:
                return None
            if now - session.last_seen > IDLE_SECONDS or now - session.created > MAX_SECONDS:
                del self._sessions[key]
                return None
            session.last_seen = now
            return session.account_id

    def end(self, token: str | None) -> None:
        if token:
            with self._lock:
                self._sessions.pop(token_hash(token), None)

    def end_all(self, account_id: int) -> int:
        """End every session of an account (disabled, or its password reset)."""
        with self._lock:
            keys = [k for k, s in self._sessions.items() if s.account_id == account_id]
            for k in keys:
                del self._sessions[k]
            return len(keys)

    def __len__(self) -> int:
        return len(self._sessions)

    def _purge(self, now: float) -> None:
        expired = [
            k for k, s in self._sessions.items() if now - s.last_seen > IDLE_SECONDS or now - s.created > MAX_SECONDS
        ]
        for k in expired:
            del self._sessions[k]
