"""HTTP endpoints, all under /api: one router per area, in this order."""
from fastapi import APIRouter

from . import admin, analyse, auth, reviews, samples, status

router = APIRouter(prefix="/api")
for area in (status, samples, analyse, reviews, auth, admin):
    router.include_router(area.router)
