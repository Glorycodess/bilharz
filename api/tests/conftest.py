import io
import os
import tempfile
from dataclasses import replace

# Importing `server` builds the default app, which opens the reviews database.
# Point it at a throwaway file first, so tests never touch real reviews.
os.environ["BILHARZ_REVIEWS_DB"] = os.path.join(tempfile.mkdtemp(prefix="bilharz-tests-"), "reviews.db")
# Tests choose their own secrets; ignore any set in the shell.
os.environ.pop("BILHARZ_REVIEW_CODE", None)
os.environ.pop("BILHARZ_ADMIN_TOKEN", None)

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from bilharz.scoring import load_scorer
from bilharz.settings import load_settings
from server import create_app

ADMIN_TOKEN = "test-admin-token"
ORIGIN = "http://localhost:5173"


@pytest.fixture(scope="session")
def base_settings(tmp_path_factory):
    db = tmp_path_factory.mktemp("data") / "reviews.db"
    return replace(load_settings(), reviews_db=db, allowed_origins=(ORIGIN,), admin_token=ADMIN_TOKEN)


@pytest.fixture(scope="session")
def scorer(base_settings):
    return load_scorer(base_settings)


@pytest.fixture(scope="session")
def app(base_settings, scorer):
    return create_app(base_settings, scorer=scorer)


@pytest.fixture()
def client(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def make_client(base_settings, scorer, tmp_path, monkeypatch):
    """A client for an app with some settings changed, e.g. lower upload limits."""

    # create_app sets Pillow's global pixel limit; put it back after the test.
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", Image.MAX_IMAGE_PIXELS)

    def make(**changes):
        settings = replace(base_settings, reviews_db=tmp_path / "reviews.db", **changes)
        return TestClient(create_app(settings, scorer=scorer))

    return make


def jpeg(width=64, height=48, colour=(120, 90, 60), quality=90) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), colour).save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def as_files(blobs, name="img{:03d}.jpg"):
    return [("files", (name.format(i), b, "image/jpeg")) for i, b in enumerate(blobs, 1)]
