"""Technician reviews: record, list, export and clear."""
import csv
import io
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from .. import schemas
from ..reviews import ReviewConflict, ReviewExists, ReviewNotFound
from ..triage import decide
from .deps import Reviewer, current_reviewer, require_admin, require_known, require_review_code, state

router = APIRouter()


@router.post(
    "/reviews/{sample_id}",
    response_model=schemas.ReviewOut,
    status_code=201,
    dependencies=[Depends(require_review_code)],
    responses={
        403: {"description": "Review code required or wrong"},
        404: {"description": "Unknown sample"},
        409: {"description": "The sample already has a review, or `supersedes` is no longer the current one"},
        422: {"description": "Invalid review, or `supersedes` is not a review of this sample"},
    },
)
def add_review(
    request: Request,
    sample_id: str,
    review: schemas.ReviewIn,
    reviewer: Reviewer | None = Depends(current_reviewer),
):
    """Record a sample's review. A sample has one review: to change its verdict, send
    `supersedes` with the id of its current review, and a new version is added while
    the old one is kept. The reviewer is the signed-in account, never a request field."""
    require_known(request, sample_id)
    note = review.note.strip() if review.note else None
    try:
        return state(request).reviews.add(
            sample_id,
            review.verdict,
            note or None,
            review.tester_code,
            review.supersedes,
            reviewer_id=reviewer.id if reviewer else None,
            reviewer_name=reviewer.name if reviewer else None,
        )
    except ReviewExists:
        raise HTTPException(409, "This sample already has a review. Edit the existing review instead.") from None
    except ReviewNotFound:
        raise HTTPException(422, "That review does not exist for this sample.") from None
    except ReviewConflict:
        raise HTTPException(409, "This review has already been changed. Reload to see the latest.") from None


def _reviews_with_decisions(
    request: Request, view: str, verdict: str | None, sample_id: str | None
) -> list[dict]:
    """Review rows for the list and the CSV, each with Bilharz's decision (default setting)."""
    app = state(request)
    if sample_id is not None and sample_id not in app.samples:
        raise HTTPException(422, "Unknown sample.")
    rule = app.triage.rule(None)
    if view == "current":
        rows = app.reviews.current(verdict=verdict, sample_id=sample_id)
    else:
        rows = app.reviews.all(verdict=verdict, sample_id=sample_id)
        counts = app.reviews.version_counts()
        for r in rows:
            r["version_count"] = counts[r["sample_id"]]
    decisions = {}
    for r in rows:
        sid = r["sample_id"]
        if sid not in decisions:
            decisions[sid] = decide(app.samples.count(sid, rule), rule) if sid in app.samples else None
        r["decision"] = decisions[sid]
    return rows


@router.get(
    "/reviews",
    response_model=list[schemas.ReviewListItem],
    dependencies=[Depends(require_review_code)],
    responses={403: {"description": "Review code required or wrong"}},
)
def list_reviews(
    request: Request,
    view: Literal["current", "all"] = "current",
    verdict: Literal["infected", "healthy"] | None = None,
    sample_id: str | None = None,
):
    """Reviews, newest first, with Bilharz's decision for each sample (default setting).

    `view=current` (default): one row per sample, its current review.
    `view=all`: every version, with `supersedes` linking each change to the review it replaced."""
    return _reviews_with_decisions(request, view, verdict, sample_id)


# reviewer_id and reviewer were added last, so existing readers of the columns before them still work.
CSV_FIELDS = [
    "review_id", "sample_id", "system_decision", "verdict", "note", "tester_code", "created_at", "supersedes",
    "reviewer_id", "reviewer",
]
UNKNOWN_REVIEWER = "unknown"
FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def _csv_safe(value):
    """Stop a spreadsheet from running a note as a formula."""
    if isinstance(value, str) and value.startswith(FORMULA_START):
        return "'" + value
    return value


@router.get(
    "/reviews.csv",
    response_class=Response,
    dependencies=[Depends(require_admin)],
    responses={
        200: {"content": {"text/csv": {}}, "description": "All reviews as CSV"},
        403: {"description": "Missing or wrong admin token"},
    },
)
def export_reviews(
    request: Request,
    verdict: Literal["infected", "healthy"] | None = None,
    sample_id: str | None = None,
):
    """Every version of every review as a CSV download, newest first: the full history.
    `reviewer` is "unknown" for reviews recorded before accounts. Needs the admin
    token in X-Admin-Token."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(CSV_FIELDS)
    for r in _reviews_with_decisions(request, "all", verdict, sample_id):
        writer.writerow(
            [
                r["id"],
                r["sample_id"],
                r["decision"],
                r["verdict"],
                _csv_safe(r["note"]),
                _csv_safe(r["tester_code"]),
                r["created_at"],
                r["supersedes"] if r["supersedes"] is not None else "",
                r["reviewer_id"] if r["reviewer_id"] is not None else "",
                _csv_safe(r["reviewer_name"]) if r["reviewer_name"] is not None else UNKNOWN_REVIEWER,
            ]
        )
    return Response(
        buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="bilharz-reviews.csv"'},
    )


@router.delete(
    "/reviews",
    response_model=schemas.Deleted,
    dependencies=[Depends(require_admin)],
    responses={403: {"description": "Missing or wrong admin token"}},
)
def clear_reviews(request: Request):
    """Delete every review. Needs the admin token in X-Admin-Token."""
    return dict(deleted=state(request).reviews.clear())
