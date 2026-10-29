"""Every path, origin and limit, read from environment variables.

Defaults point at the local repository layout, so `uvicorn server:app` works
without configuration. A deployment overrides only what differs.
"""
import os
from dataclasses import dataclass, field
from pathlib import Path

API_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = API_DIR.parent


def _path(name: str, default: Path) -> Path:
    value = os.environ.get(name)
    return Path(value).expanduser() if value else default


def _optional_path(name: str) -> Path | None:
    value = os.environ.get(name)
    return Path(value).expanduser() if value else None


def _int(name: str, default: int) -> int:
    value = os.environ.get(name)
    return int(value) if value else default


@dataclass(frozen=True)
class Settings:
    """Read once at start-up by load_settings and passed to whatever needs it."""

    model_path: Path
    config_path: Path
    tiles_zip: Path
    manifest_path: Path
    scores_path: Path
    reviews_db: Path
    allowed_origins: tuple[str, ...]
    expected_files: int = 117
    max_file_bytes: int = 15 * 1024 * 1024
    max_request_bytes: int = 600 * 1024 * 1024
    max_image_side: int = 6000
    batch_size: int = 64
    upload_timeout_seconds: float = 120.0
    # Read from the environment only; kept out of repr so it never reaches a log.
    admin_token: str | None = field(default=None, repr=False)
    # Optional: when set, every review endpoint requires it in X-Review-Code.
    review_code: str | None = field(default=None, repr=False)
    # Whether reviews_db survives a restart (true on a normal disk; false on
    # hosts with ephemeral storage). Reported by /api/health without a reviews_dir.
    reviews_persistent: bool = True
    # A directory on persistent storage (a mounted Storage Bucket) for the
    # reviews journal; reviews_db is then rebuilt from it on start.
    reviews_dir: Path | None = None


def load_settings() -> Settings:
    """Settings from BILHARZ_* environment variables, with local defaults."""
    assets = _path("BILHARZ_ASSETS_DIR", API_DIR / "assets")
    origins = os.environ.get("BILHARZ_ALLOWED_ORIGINS", "http://localhost:5173")
    return Settings(
        model_path=_path("BILHARZ_MODEL_PATH", assets / "detector.onnx"),
        config_path=_path("BILHARZ_CONFIG_PATH", assets / "triage_config.json"),
        tiles_zip=_path("BILHARZ_TILES_ZIP", assets / "tiles.zip"),
        manifest_path=_path("BILHARZ_MANIFEST_PATH", assets / "tiles_manifest.json"),
        scores_path=_path("BILHARZ_SCORES_PATH", REPO_DIR / "results" / "patient_scores.npz"),
        reviews_db=_path("BILHARZ_REVIEWS_DB", API_DIR / "data" / "reviews.db"),
        allowed_origins=tuple(o.strip() for o in origins.split(",") if o.strip() and o.strip() != "*"),
        expected_files=_int("BILHARZ_EXPECTED_FILES", 117),
        max_file_bytes=_int("BILHARZ_MAX_FILE_MB", 15) * 1024 * 1024,
        max_request_bytes=_int("BILHARZ_MAX_REQUEST_MB", 600) * 1024 * 1024,
        max_image_side=_int("BILHARZ_MAX_IMAGE_SIDE", 6000),
        batch_size=_int("BILHARZ_BATCH_SIZE", 64),
        upload_timeout_seconds=float(os.environ.get("BILHARZ_UPLOAD_TIMEOUT_SECONDS") or 120),
        admin_token=os.environ.get("BILHARZ_ADMIN_TOKEN") or None,
        review_code=os.environ.get("BILHARZ_REVIEW_CODE") or None,
        reviews_persistent=os.environ.get("BILHARZ_REVIEWS_PERSISTENT", "true").lower() in ("1", "true", "yes"),
        reviews_dir=_optional_path("BILHARZ_REVIEWS_DIR"),
    )
