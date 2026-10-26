"""Upload validation and limits.

Uploads are read straight from the request stream into memory and checked as
they arrive: the request size, each file's size and the number of files are
enforced before the whole body has been received. Nothing is written to disk
and nothing about the files is logged.
"""
import io
from dataclasses import dataclass

from PIL import Image, UnidentifiedImageError
from python_multipart.multipart import MultipartParser, parse_options_header
from starlette.requests import Request

from .settings import Settings

FIELD = "files"


class UploadError(Exception):
    """A rejected upload: an HTTP status and a message safe to show the user."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


@dataclass
class Upload:
    """One uploaded image. Its filename is never kept: images are known only by position."""

    data: bytes


def configure_pillow(settings: Settings) -> None:
    """Pillow's decompression-bomb guard, matched to the largest allowed image."""
    Image.MAX_IMAGE_PIXELS = settings.max_image_side * settings.max_image_side


def _mb(n: int) -> str:
    return f"{n / (1024 * 1024):g} MB"


async def read_uploads(request: Request, settings: Settings) -> list[Upload]:
    """The `files` parts of a multipart request, in upload order."""
    ctype, params = parse_options_header(request.headers.get("content-type", ""))
    boundary = params.get(b"boundary")
    if ctype != b"multipart/form-data" or not boundary:
        raise UploadError(415, "Send the images as multipart/form-data, in a field named 'files'.")

    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > settings.max_request_bytes:
        raise UploadError(413, f"The upload is larger than {_mb(settings.max_request_bytes)}.")

    uploads: list[Upload] = []
    state = {"headers": {}, "field": b"", "value": b"", "data": None, "error": None}

    def fail(status: int, detail: str) -> None:
        if state["error"] is None:
            state["error"] = UploadError(status, detail)

    def on_part_begin():
        state["headers"], state["data"] = {}, None

    def on_header_field(data, start, end):
        state["field"] += data[start:end]

    def on_header_value(data, start, end):
        state["value"] += data[start:end]

    def on_header_end():
        state["headers"][state["field"].lower()] = state["value"]
        state["field"], state["value"] = b"", b""

    def on_headers_finished():
        _, disp = parse_options_header(state["headers"].get(b"content-disposition", b""))
        if disp.get(b"name") == FIELD.encode() and b"filename" in disp:
            if len(uploads) >= settings.expected_files:
                fail(422, f"Expected exactly {settings.expected_files} images; received more.")
            state["data"] = bytearray()

    def on_part_data(data, start, end):
        buf = state["data"]
        if buf is None or state["error"]:
            return
        buf += data[start:end]
        if len(buf) > settings.max_file_bytes:
            fail(413, f"Image {len(uploads) + 1} is larger than {_mb(settings.max_file_bytes)}.")

    def on_part_end():
        if state["data"] is not None and not state["error"]:
            uploads.append(Upload(bytes(state["data"])))
        state["data"] = None

    parser = MultipartParser(
        boundary,
        callbacks={
            "on_part_begin": on_part_begin,
            "on_header_field": on_header_field,
            "on_header_value": on_header_value,
            "on_header_end": on_header_end,
            "on_headers_finished": on_headers_finished,
            "on_part_data": on_part_data,
            "on_part_end": on_part_end,
        },
    )

    received = 0
    try:
        async for chunk in request.stream():
            received += len(chunk)
            if received > settings.max_request_bytes:
                fail(413, f"The upload is larger than {_mb(settings.max_request_bytes)}.")
            if state["error"]:
                raise state["error"]
            parser.write(chunk)
        parser.finalize()
    except UploadError:
        raise
    except Exception:
        raise UploadError(400, "The upload could not be read as multipart/form-data.") from None
    if state["error"]:
        raise state["error"]

    if len(uploads) != settings.expected_files:
        raise UploadError(
            422, f"Expected exactly {settings.expected_files} images in the 'files' field; received {len(uploads)}."
        )
    return uploads


def check_jpeg(upload: Upload, position: int, settings: Settings) -> None:
    """Reject anything that is not really a JPEG, or is too large to decode safely."""
    try:
        with Image.open(io.BytesIO(upload.data)) as img:
            fmt, (w, h) = img.format, img.size
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError):
        raise UploadError(415, f"Image {position} is not a JPEG.") from None
    if fmt != "JPEG":
        raise UploadError(415, f"Image {position} is not a JPEG.")
    side = settings.max_image_side
    if w > side or h > side:
        raise UploadError(422, f"Image {position} is {w} × {h} pixels; the limit is {side} × {side}.")
