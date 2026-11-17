"""Response and request models. Field names are snake_case throughout."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

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
    accounts_writable: bool = Field(
        default=True, description="Whether accounts can be created and changed: the accounts file was read and can be written"
    )


class RuleOut(BaseModel):
    tile_threshold: float
    clear_below: int
    flag_above: int
    rule: str


class ConfigOut(BaseModel):
    default: str
    settings: dict[str, RuleOut]


class LatestReview(BaseModel):
    verdict: Literal["infected", "healthy"]
    created_at: str


class LatestReviewDetail(LatestReview):
    id: int = Field(description="Send as `supersedes` to amend this review")
    note: str | None = Field(description="Null when hidden: see details_hidden")
    tester_code: str | None = Field(description="Older reviews only; null when hidden: see details_hidden")
    reviewer_name: str | None = Field(
        default=None, description="Who recorded it; null for reviews from before accounts, or when hidden"
    )
    details_hidden: bool = Field(
        default=False,
        description="True unless a signed-in, approved reviewer asked: the note, tester code and reviewer are withheld",
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
    # Unknown fields are refused, so a reviewer can never be sent in the body:
    # it comes from the session.
    model_config = ConfigDict(extra="forbid")

    verdict: Literal["infected", "healthy"]
    note: str | None = Field(default=None, max_length=500)
    supersedes: int | None = Field(default=None, description="To amend: the id of the sample's current review")


class ReviewOut(BaseModel):
    id: int
    sample_id: str
    verdict: Literal["infected", "healthy"]
    note: str | None
    tester_code: str | None = Field(description="The anonymous tester code of an older review; new reviews have none")
    created_at: str
    supersedes: int | None
    reviewer_name: str | None = Field(description="Who recorded it; null for reviews from before accounts")


class ReviewListItem(ReviewOut):
    decision: Decision = Field(description="Bilharz's decision for the sample under the default setting")
    version_count: int = Field(description="How many versions this sample's review has")


class Deleted(BaseModel):
    deleted: int


# Accounts ----------------------------------------------------------------------


class SignUpIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(max_length=200)
    email: str = Field(max_length=320)
    password: str = Field(max_length=1000)


class SignInIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(max_length=320)
    password: str = Field(max_length=1000)


class ResetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(max_length=200)
    password: str = Field(max_length=1000)


class RoleIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["reviewer", "admin"]


class AccountOut(BaseModel):
    """The signed-in account, as it sees itself."""

    id: int
    name: str
    email: str
    role: Literal["reviewer", "admin"]
    status: Literal["pending", "approved", "disabled"]


class Me(BaseModel):
    account: AccountOut | None = Field(description="Null when nobody is signed in")


class AccountListItem(AccountOut):
    """An account as an admin sees it."""

    created_at: str
    approved_at: str | None
    reset_link_active: bool = Field(description="A reset link has been made and has not been used or expired")


class ResetLink(BaseModel):
    url: str = Field(description="Give this to the account's owner; it works once")
    expires_at: str
