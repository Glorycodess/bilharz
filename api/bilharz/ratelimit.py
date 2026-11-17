"""Counting failed attempts (wrong passwords, wrong admin tokens) in a sliding window.

Kept in memory: a restart clears the counts. Keys are an account's email or an
IP address. The IP address comes from the proxy's X-Forwarded-For header, which
a client can add to, so the per-IP limit is a best effort; the per-account
limit is what stops someone guessing one reviewer's password.
"""
import threading
import time
from collections import deque


class RateLimiter:
    def __init__(self, limit: int, window_seconds: float, clock=time.time):
        self.limit = limit
        self.window = window_seconds
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _recent(self, key: str, now: float) -> deque[float]:
        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] >= self.window:
            hits.popleft()
        return hits

    def blocked(self, key: str) -> bool:
        """True if `key` has reached the limit within the window."""
        with self._lock:
            hits = self._recent(key, self._clock())
            if not hits:
                self._hits.pop(key, None)
            return len(hits) >= self.limit

    def hit(self, key: str) -> None:
        """Count one attempt (a failure, or a sign-up) for `key`."""
        with self._lock:
            now = self._clock()
            self._recent(key, now).append(now)

    def clear(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)
