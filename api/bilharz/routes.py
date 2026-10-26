"""HTTP endpoints, all under /api."""
import asyncio
import hmac
import re

from fastapi import APIRouter, Header, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

from . import schemas
from .analysis import analyse
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


def _known(request: Request, sample_id: str) -> None:
    if sample_id not in _state(request).samples:
        raise HTTPException(404, "Sample not found.")


@router.get("/health", response_model=schemas.Health)
def health(request: Request):
    state = _state(request)
    return dict(status="ok", scorer=state.scorer.name, samples=len(state.samples))


@router.get("/config", response_model=schemas.ConfigOut)
def config(request: Request):
    triage = _state(request).triage
    return dict(
        default=triage.default,
        settings={
            name: dict(tile_threshold=r.tile_threshold, clear_below=r.clear_below, flag_above=r.flag_above, rule=r.describe())
            for name, r in triage.rules.items()
        },
    )


@router.get("/samples", response_model=schemas.Queue)
def queue(request: Request, setting: str | None = None):
    rule = _rule(request, setting)
    state = _state(request)
    reviewed = state.reviews.reviewed_ids()
    items = []
    for sid in state.samples.ids:
        n = state.samples.count(sid, rule)
        items.append(dict(id=sid, confident_tiles=n, decision=decide(n, rule), reviewed=sid in reviewed))
    return dict(setting=rule.name, samples=items)


@router.get("/samples/{sample_id}", response_model=schemas.SampleResult, responses={404: {"description": "Unknown sample"}})
def sample(request: Request, sample_id: str, setting: str | None = None):
    _known(request, sample_id)
    rule = _rule(request, setting)
    store = _state(request).samples
    n = store.count(sample_id, rule)
    score, image, tile = store.highest(sample_id)
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


@router.post("/reviews/{sample_id}", response_model=schemas.ReviewOut, status_code=201)
def add_review(request: Request, sample_id: str, review: schemas.ReviewIn):
    _known(request, sample_id)
    note = review.note.strip() if review.note else None
    return _state(request).reviews.add(sample_id, review.verdict, note or None, review.tester_code)


@router.get("/reviews", response_model=list[schemas.ReviewOut])
def list_reviews(request: Request):
    return _state(request).reviews.all()


@router.delete("/reviews", response_model=schemas.Deleted, responses={403: {"description": "Missing or wrong admin token"}})
def clear_reviews(request: Request, x_admin_token: str | None = Header(default=None)):
    expected = _state(request).settings.admin_token
    if not expected:
        raise HTTPException(403, "Deleting reviews is disabled.")
    if x_admin_token is None or not hmac.compare_digest(x_admin_token.encode(), expected.encode()):
        raise HTTPException(403, "Not allowed.")
    return dict(deleted=_state(request).reviews.clear())
