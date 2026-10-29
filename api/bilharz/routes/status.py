"""Health and the decision settings."""
from fastapi import APIRouter, Request

from .. import schemas
from .deps import state

router = APIRouter()


@router.get("/health", response_model=schemas.Health)
def health(request: Request):
    """Liveness, the active scorer, and whether reviews survive a restart."""
    app = state(request)
    return dict(
        status="ok",
        scorer=app.scorer.name,
        samples=len(app.samples),
        reviews_persistent=app.reviews.persistent,
        reviews_unreadable=app.reviews.unreadable,
    )


@router.get("/config", response_model=schemas.ConfigOut)
def config(request: Request):
    """Both decision settings with their rules, the default, and whether reviews need a code."""
    triage = state(request).triage
    return dict(
        default=triage.default,
        settings={
            name: dict(tile_threshold=r.tile_threshold, clear_below=r.clear_below, flag_above=r.flag_above, rule=r.describe())
            for name, r in triage.rules.items()
        },
        review_code_required=bool(state(request).settings.review_code),
    )
