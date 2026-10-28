"""The deployed triage rule, read from triage_config.json."""
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np

Decision = Literal["negative", "positive", "referred"]


@dataclass(frozen=True)
class Rule:
    """One decision setting: the tile threshold and the two count cut-offs."""

    name: str
    tile_threshold: float
    clear_below: int
    flag_above: int

    def describe(self) -> str:
        """The rule in one sentence, for /api/config."""
        return (
            f"A tile is confident if it scores above {self.tile_threshold}. "
            f"Fewer than {self.clear_below} confident tiles: negative. "
            f"More than {self.flag_above}: positive. Otherwise: referred to a technician."
        )


@dataclass(frozen=True)
class TriageConfig:
    """Every setting by name, and which one is the default."""

    default: str
    rules: dict[str, Rule]

    def rule(self, name: str | None) -> Rule:
        """The named rule, or the default one. Raises KeyError for an unknown name."""
        return self.rules[name or self.default]


def load_config(path: Path) -> TriageConfig:
    """Read triage_config.json, as written by notebook 05."""
    raw = json.loads(path.read_text())
    rules = {
        name: Rule(
            name=name,
            tile_threshold=float(r["tile_threshold"]),
            clear_below=int(r["clear_below"]),
            flag_above=int(r["flag_above"]),
        )
        for name, r in raw["settings"].items()
    }
    if raw["default"] not in rules:
        raise ValueError("triage config: the default setting is not defined")
    return TriageConfig(default=raw["default"], rules=rules)


def count_confident(scores: np.ndarray, rule: Rule) -> int:
    """Tiles scoring strictly above the rule's threshold."""
    return int((np.asarray(scores) > rule.tile_threshold).sum())


def decide(count: int, rule: Rule) -> Decision:
    """Negative below `clear_below`, positive above `flag_above`, referred in between."""
    if count < rule.clear_below:
        return "negative"
    if count > rule.flag_above:
        return "positive"
    return "referred"
