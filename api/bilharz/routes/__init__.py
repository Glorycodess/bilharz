"""HTTP endpoints, all under /api: one router per area, in this order."""
from fastapi import APIRouter

from . import analyse, reviews, samples, status

router = APIRouter(prefix="/api")
for area in (status, samples, analyse, reviews):
    router.include_router(area.router)
