"""The stored samples: the queue, one sample's result, and its top tiles."""
import re

from fastapi import APIRouter, Header, HTTPException, Request, Response

from .. import schemas
from ..triage import decide
from .deps import has_review_access, require_known, rule_for, state

router = APIRouter()

RANK = re.compile(r"^[0-9]{1,2}$")


@router.get("/samples", response_model=schemas.Queue)
def queue(request: Request, setting: str | None = None):
    """Every stored sample with its confident-tile count, decision and latest review."""
    rule = rule_for(request, setting)
    app = state(request)
    latest = app.reviews.latest()
    items = []
    for sid in app.samples.ids:
        n = app.samples.count(sid, rule)
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
    require_known(request, sample_id)
    rule = rule_for(request, setting)
    store = state(request).samples
    n = store.count(sample_id, rule)
    score, image, tile = store.highest(sample_id)
    review, review_count = state(request).reviews.history(sample_id)
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
    """One of a stored sample's 12 highest-scoring tiles, as a JPEG."""
    app = state(request)
    # The archive member comes from the manifest, never from the request path.
    member = app.samples.tile_file(sample_id, int(rank)) if RANK.match(rank) else None
    data = app.tiles.read(member) if member else None
    if data is None:
        raise HTTPException(404, "Tile not found.")
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})
