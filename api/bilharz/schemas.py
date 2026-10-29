"""Response and request models. Field names are snake_case throughout."""
from typing import Literal

from pydantic import BaseModel, Field

from .triage import Decision


class Health(BaseModel):
    status: Literal["ok"]
    scorer: str
    samples: int
    reviews_persistent: bool = Field(
        description="True when reviews survive a restart: kept on a persistent disk, or in a writable reviews journal"
    )
    reviews_unreadable: int = Field(
        default=0, description="Lines of the reviews journal that could not be read at start-up (kept in the file)"
    )


class RuleOut(BaseModel):
    tile_threshold: float
    clear_below: int
    flag_above: int
    rule: str


class ConfigOut(BaseModel):
    default: str
    settings: dict[str, RuleOut]
    review_code_required: bool = Field(description="Whether review endpoints need the X-Review-Code header")


class LatestReview(BaseModel):
    verdict: Literal["infected", "healthy"]
    created_at: str


class LatestReviewDetail(LatestReview):
    id: int = Field(description="Send as `supersedes` to amend this review")
    note: str | None = Field(description="Null when hidden: see details_hidden")
    tester_code: str | None = Field(description="Null when hidden: see details_hidden")
    details_hidden: bool = Field(
        default=False,
        description="True when the server needs a review code and none (or a wrong one) was sent: "
        "the note and tester code are withheld",
    )


class QueueItem(BaseModel):
    id: str
    confident_tiles: int
    decision: Decision
    review: LatestReview | None = Field(description="The latest review, or null if never reviewed")


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
    review: LatestReviewDetail | None = Field(default=None, description="The current (latest) review: the final verdict")
    review_count: int = Field(default=0, description="Versions of the review, the current one included")


class AnalysisResult(SampleResult):
    seconds: float
    scorer: str = Field(description="The scorer that scored this upload, e.g. torch-gpu, or onnx-cpu after a fallback")


class ReviewIn(BaseModel):
    verdict: Literal["infected", "healthy"]
    note: str | None = Field(default=None, max_length=500)
    tester_code: str | None = Field(default=None, pattern=r"^T[0-9]{1,3}$")
    supersedes: int | None = Field(default=None, description="To amend: the id of the sample's current review")


class ReviewOut(BaseModel):
    id: int
    sample_id: str
    verdict: Literal["infected", "healthy"]
    note: str | None
    tester_code: str | None
    created_at: str
    supersedes: int | None


class ReviewListItem(ReviewOut):
    decision: Decision = Field(description="Bilharz's decision for the sample under the default setting")
    version_count: int = Field(description="How many versions this sample's review has")


class Deleted(BaseModel):
    deleted: int
