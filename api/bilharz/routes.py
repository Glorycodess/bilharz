"""HTTP endpoints, all under /api."""
import asyncio
import csv
import hmac
import io
import re
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

from . import schemas
from .analysis import analyse
from .reviews import ReviewConflict, ReviewNotFound
from .security import check_jpeg, read_uploads
from .triage import Rule, decide

router = APIRouter(prefix="/api")

RANK = re.compile(r"^[0-9]{1,2}$")


def _state(request: Request):
    return request.app.state


def _rule(request: Request, setting: str | None) -> Rule:
    config = _state(request).triage
    try:
        return config.rule(setting)
    except KeyError:
        names = ", ".join(config.rules)
        raise HTTPException(422, f"Unknown setting. Use one of: {names}.") from None


def _matches(given: str | None, expected: str) -> bool:
    """Constant-time comparison of a secret from a request header."""
    return given is not None and hmac.compare_digest(given.encode(), expected.encode())


def require_admin(request: Request, x_admin_token: str | None = Header(default=None)) -> None:
    """Admin-only endpoints: off (403) unless BILHARZ_ADMIN_TOKEN is set, then it must match."""
    expected = _state(request).settings.admin_token
    if not expected:
        raise HTTPException(403, "This is turned off on this server: no admin token is set.")
    if not _matches(x_admin_token, expected):
        raise HTTPException(403, "Not allowed.")


def has_review_access(request: Request, x_review_code: str | None) -> bool:
    """True if no review code is configured, or the right one was sent."""
    expected = _state(request).settings.review_code
    return not expected or _matches(x_review_code, expected)


def require_review_code(request: Request, x_review_code: str | None = Header(default=None)) -> None:
    """Review endpoints: open unless BILHARZ_REVIEW_CODE is set, then the code must match."""
    expected = _state(request).settings.review_code
    if not expected:
        return
    if x_review_code is None:
        raise HTTPException(403, "A review access code is required.")
    if not _matches(x_review_code, expected):
        raise HTTPException(403, "That review code isn't valid.")


def _known(request: Request, sample_id: str) -> None:
    if sample_id not in _state(request).samples:
        raise HTTPException(404, "Sample not found.")


@router.get("/health", response_model=schemas.Health)
def health(request: Request):
    state = _state(request)
    return dict(
        status="ok",
        scorer=state.scorer.name,
        samples=len(state.samples),
        reviews_persistent=state.settings.reviews_persistent,
    )


@router.get("/config", response_model=schemas.ConfigOut)
def config(request: Request):
    triage = _state(request).triage
    return dict(
        default=triage.default,
        settings={
            name: dict(tile_threshold=r.tile_threshold, clear_below=r.clear_below, flag_above=r.flag_above, rule=r.describe())
            for name, r in triage.rules.items()
        },
        review_code_required=bool(_state(request).settings.review_code),
    )


@router.get("/samples", response_model=schemas.Queue)
def queue(request: Request, setting: str | None = None):
    rule = _rule(request, setting)
    state = _state(request)
    latest = state.reviews.latest()
    items = []
    for sid in state.samples.ids:
        n = state.samples.count(sid, rule)
        review = latest.get(sid)
        review = dict(verdict=review["verdict"], created_at=review["created_at"]) if review else None
        items.append(dict(id=sid, confident_tiles=n, decision=decide(n, rule), review=review))
    return dict(setting=rule.name, samples=items)


@router.get("/samples/{sample_id}", response_model=schemas.SampleResult, responses={404: {"description": "Unknown sample"}})
def sample(
    request: Request,
    sample_id: str,
    setting: str | None = None,
    x_review_code: str | None = Header(default=None),
):
    """One sample's result. With a review code configured, the review's note and
    tester code are only included when the code is sent; the verdict always is."""
    _known(request, sample_id)
    rule = _rule(request, setting)
    store = _state(request).samples
    n = store.count(sample_id, rule)
    score, image, tile = store.highest(sample_id)
    review, review_count = _state(request).reviews.history(sample_id)
    if review and not has_review_access(request, x_review_code):
        review = {**review, "note": None, "tester_code": None, "details_hidden": True}
    return dict(
        id=sample_id,
        source="stored",
        setting=rule.name,
        tile_threshold=rule.tile_threshold,
        confident_tiles=n,
        decision=decide(n, rule),
        tiles_scored=len(store.scores(sample_id)),
        highest_score=round(score, 4),
        highest_tile=dict(image=image, tile=tile),
        top_tiles=[
            dict(
                rank=t.rank,
                score=t.score,
                image=t.image,
                tile=t.tile,
                url=f"/api/tiles/{sample_id}/{t.rank}.jpg",
                confident=t.raw_score > rule.tile_threshold,
            )
            for t in store.top_tiles(sample_id)
        ],
        review=review,
        review_count=review_count,
    )


@router.get(
    "/tiles/{sample_id}/{rank}.jpg",
    response_class=Response,
    responses={200: {"content": {"image/jpeg": {}}}, 404: {"description": "Unknown sample or rank"}},
)
def tile(request: Request, sample_id: str, rank: str):
    state = _state(request)
    # The archive member comes from the manifest, never from the request path.
    member = state.samples.tile_file(sample_id, int(rank)) if RANK.match(rank) else None
    data = state.tiles.read(member) if member else None
    if data is None:
        raise HTTPException(404, "Tile not found.")
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


@router.post(
    "/analyse",
    response_model=schemas.AnalysisResult,
    responses={
        413: {"description": "A file or the whole upload is too large"},
        415: {"description": "A file is not a JPEG"},
        422: {"description": "Wrong number of files, or an image too large or unreadable"},
        408: {"description": "The upload did not arrive in time"},
        429: {"description": "Another analysis is running"},
    },
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "required": ["files"],
                        "properties": {"files": {"type": "array", "items": {"type": "string", "format": "binary"}}},
                    }
                }
            },
        }
    },
)
async def analyse_upload(request: Request, setting: str | None = None):
    """Score one uploaded sample (its 117 JPEG images, field `files`). One analysis runs at a time."""
    rule = _rule(request, setting)
    state = _state(request)
    lock: asyncio.Lock = state.analysis_lock
    if lock.locked():
        raise HTTPException(429, "Analysis in progress, try again shortly.")
    # The lock is released on every way out: success, timeout, a rejected
    # upload, a client disconnect or a scoring error.
    async with lock:
        try:
            async with asyncio.timeout(state.settings.upload_timeout_seconds):
                uploads = await read_uploads(request, state.settings)
        except TimeoutError:
            raise HTTPException(408, "Upload took too long. Please try again.") from None
        for position, upload in enumerate(uploads, 1):
            check_jpeg(upload, position, state.settings)
        try:
            return await run_in_threadpool(analyse, uploads, state.scorer, rule)
        finally:
            del uploads


@router.post(
    "/reviews/{sample_id}",
    response_model=schemas.ReviewOut,
    status_code=201,
    dependencies=[Depends(require_review_code)],
    responses={
        403: {"description": "Review code required or wrong"},
        404: {"description": "Unknown sample"},
        409: {"description": "`supersedes` is no longer the current review"},
        422: {"description": "Invalid review, or `supersedes` is not a review of this sample"},
    },
)
def add_review(request: Request, sample_id: str, review: schemas.ReviewIn):
    """Record a review. To change a sample's verdict, send `supersedes` with the id of
    its current review: a new version is added and the old one is kept."""
    _known(request, sample_id)
    note = review.note.strip() if review.note else None
    try:
        return _state(request).reviews.add(sample_id, review.verdict, note or None, review.tester_code, review.supersedes)
    except ReviewNotFound:
        raise HTTPException(422, "That review does not exist for this sample.") from None
    except ReviewConflict:
        raise HTTPException(409, "This review has already been changed. Reload to see the latest.") from None


def _reviews_with_decisions(
    request: Request, view: str, verdict: str | None, sample_id: str | None
) -> list[dict]:
    if sample_id is not None and sample_id not in _state(request).samples:
        raise HTTPException(422, "Unknown sample.")
    state = _state(request)
    rule = state.triage.rule(None)
    if view == "current":
        rows = state.reviews.current(verdict=verdict, sample_id=sample_id)
    else:
        rows = state.reviews.all(verdict=verdict, sample_id=sample_id)
        counts = state.reviews.version_counts()
        for r in rows:
            r["version_count"] = counts[r["sample_id"]]
    decisions = {}
    for r in rows:
        sid = r["sample_id"]
        if sid not in decisions:
            decisions[sid] = decide(state.samples.count(sid, rule), rule) if sid in state.samples else None
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


CSV_FIELDS = ["review_id", "sample_id", "system_decision", "verdict", "note", "tester_code", "created_at", "supersedes"]
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
    Needs the admin token in X-Admin-Token."""
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
    return dict(deleted=_state(request).reviews.clear())
