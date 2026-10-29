"""Analysis of an uploaded sample."""
import asyncio

from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from .. import schemas
from ..analysis import analyse
from ..security import check_jpeg, read_uploads
from .deps import rule_for, state

router = APIRouter()


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
    rule = rule_for(request, setting)
    app = state(request)
    lock: asyncio.Lock = app.analysis_lock
    if lock.locked():
        raise HTTPException(429, "Analysis in progress, try again shortly.")
    # The lock is released on every way out: success, timeout, a rejected
    # upload, a client disconnect or a scoring error.
    async with lock:
        try:
            async with asyncio.timeout(app.settings.upload_timeout_seconds):
                uploads = await read_uploads(request, app.settings)
        except TimeoutError:
            raise HTTPException(408, "Upload took too long. Please try again.") from None
        for position, upload in enumerate(uploads, 1):
            check_jpeg(upload, position, app.settings)
        try:
            return await run_in_threadpool(analyse, uploads, app.scorer, rule)
        finally:
            del uploads
