"""Response and request models. Field names are snake_case throughout."""
from typing import Literal

from pydantic import BaseModel, Field

Decision = Literal["negative", "positive", "referred"]


class Health(BaseModel):
    status: Literal["ok"]
    scorer: str
    samples: int


class RuleOut(BaseModel):
    tile_threshold: float
    clear_below: int
    flag_above: int
    rule: str


class ConfigOut(BaseModel):
    default: str
    settings: dict[str, RuleOut]


class QueueItem(BaseModel):
    id: str
    confident_tiles: int
    decision: Decision
    reviewed: bool


class Queue(BaseModel):
    setting: str
    samples: list[QueueItem]


class HighestTile(BaseModel):
    image: str
    tile: int = Field(description="1–12, row by row")


class TileOut(BaseModel):
    rank: int
    score: float
    image: str
    tile: int = Field(description="1–12, row by row")
    url: str = Field(description="The tile image: an API path, or a JPEG data URI for uploads")
    confident: bool


class SampleResult(BaseModel):
    id: str | None
    source: Literal["stored", "upload"]
    setting: str
    tile_threshold: float
    confident_tiles: int
    decision: Decision
    tiles_scored: int
    highest_score: float
    highest_tile: HighestTile
    top_tiles: list[TileOut]


class AnalysisResult(SampleResult):
    seconds: float


class ReviewIn(BaseModel):
    verdict: Literal["infected", "healthy"]
    note: str | None = Field(default=None, max_length=500)
    tester_code: str | None = Field(default=None, pattern=r"^T[0-9]{1,3}$")


class ReviewOut(BaseModel):
    id: int
    sample_id: str
    verdict: Literal["infected", "healthy"]
    note: str | None
    tester_code: str | None
    created_at: str


class Deleted(BaseModel):
    deleted: int
