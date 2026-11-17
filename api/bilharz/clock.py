"""The time, in one place, so tests can move it forward."""
import time


class Clock:
    def __init__(self):
        self.offset = 0.0

    def __call__(self) -> float:
        return time.time() + self.offset

    def advance(self, seconds: float) -> None:
        self.offset += seconds
