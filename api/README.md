# Bilharz API

FastAPI backend for Bilharz: patient-level triage for urogenital schistosomiasis
from urine microscopy. It serves the 65 evaluation samples, analyses an uploaded
sample of 117 microscope images on the CPU with the exported ONNX detector, and
stores technician reviews.

## Run it locally

From this folder (`api/`), with Python 3.12 to 3.14:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
.venv/bin/pytest
.venv/bin/uvicorn server:app --reload --port 8000
```

Then open <http://localhost:8000/docs>. The frontend's dev server
(`http://localhost:5173`) is allowed by CORS by default.

`pytest -m "not slow"` skips the full 117-image analysis test.

### Assets

These must be present (they are not in git):

| File | Default location |
| --- | --- |
| Detector (ONNX) | `api/assets/detector.onnx` |
| Triage rule | `api/assets/triage_config.json` |
| Top-12 tiles per sample | `api/assets/tiles.zip` |
| Tile manifest | `api/assets/tiles_manifest.json` |
| Stored tile scores | `results/patient_scores.npz` |

`api/assets/detector.pt` is the same detector for PyTorch. It is used only on the
Hugging Face Space, by the GPU scorer (`TorchGpuScorer` in `bilharz/scoring.py`);
torch is not needed locally.

## Endpoints

All under `/api`, JSON, snake_case. `setting` is `safety` (the default) or
`efficiency`; anything else gives 422. Errors are `{"detail": "…"}`.

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/health` | `{"status": "ok", "scorer": "onnx-cpu", "samples": 65, "reviews_persistent": true, "reviews_unreadable": 0}` |
| GET | `/api/config` | Both settings, their rules and the default |
| GET | `/api/samples?setting=` | The queue: `id`, `confident_tiles`, `decision`, `reviewed` per sample |
| GET | `/api/samples/{id}?setting=` | One sample's result, with its top 12 tiles; 404 if unknown |
| GET | `/api/tiles/{id}/{rank}.jpg` | A top tile (rank 1–12) from `tiles.zip`; 404 otherwise |
| POST | `/api/analyse?setting=` | Analyse one uploaded sample (multipart field `files`, 117 JPEGs) |
| POST | `/api/reviews/{id}` | Save a review: `verdict` (`infected`/`healthy`), optional `note` (≤ 500 chars), `tester_code` (`T1`–`T999`) and `supersedes` (to amend the current review) |
| GET | `/api/reviews?view=current\|all` | One row per sample (its current review), or every version |
| GET | `/api/reviews.csv` | Every version as CSV; needs header `X-Admin-Token` |
| DELETE | `/api/reviews` | Delete all reviews; needs header `X-Admin-Token` |

If `BILHARZ_REVIEW_CODE` is set, the review endpoints (POST and GET
`/api/reviews…`) also need it in the `X-Review-Code` header; `/api/config`
reports `review_code_required` but never the code. The queue and sample results
stay public.

The ground-truth labels in `patient_scores.npz` are never loaded, so no response
can reveal a diagnosis.

### Uploads

`POST /api/analyse` reads the request stream straight into memory and validates
as it goes: at most 600 MB in total and 15 MB per file, exactly 117 files, each
a real JPEG (checked by decoding, not by name or content type) of at most
6000 × 6000 pixels. If the whole body hasn't arrived within 120 seconds, the
request is aborted with 408 and everything received is discarded. Nothing is
written to disk or logged, and the images are discarded after the response.
One analysis runs at a time; a second request gets 429, and the lock is
released however a request ends. The response matches a stored sample's
result, with `id: null`, `source: "upload"`, `seconds`, `scorer` (the scorer
that actually ran: `torch-gpu`, or `onnx-cpu` locally or after a fallback) and
each top tile as a JPEG data URI. Images are named by their position in the upload
(`upload_001` … `upload_117`); uploaded filenames are never kept, returned or
logged.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `BILHARZ_ASSETS_DIR` | `api/assets` | Folder for the four asset files below |
| `BILHARZ_MODEL_PATH` | `<assets>/detector.onnx` | ONNX detector |
| `BILHARZ_CONFIG_PATH` | `<assets>/triage_config.json` | Triage rule |
| `BILHARZ_TILES_ZIP` | `<assets>/tiles.zip` | Tile archive |
| `BILHARZ_MANIFEST_PATH` | `<assets>/tiles_manifest.json` | Tile manifest |
| `BILHARZ_SCORES_PATH` | `results/patient_scores.npz` | Stored tile scores |
| `BILHARZ_REVIEWS_DB` | `api/data/reviews.db` | SQLite file for reviews (folder created on start) |
| `BILHARZ_REVIEWS_DIR` | unset | A folder on persistent storage (a mounted Storage Bucket) for the reviews journal, `reviews.jsonl`. Every review is written there too, and the SQLite file is rebuilt from it on start |
| `BILHARZ_REVIEWS_PERSISTENT` | `true` | Without `BILHARZ_REVIEWS_DIR`: whether the SQLite file's disk survives a restart. `/api/health` reports it; with a journal, health reports whether the journal is writable instead |
| `BILHARZ_ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated CORS origins (`*` is ignored) |
| `BILHARZ_EXPECTED_FILES` | `117` | Images per uploaded sample |
| `BILHARZ_MAX_FILE_MB` | `15` | Largest single image |
| `BILHARZ_MAX_REQUEST_MB` | `600` | Largest upload |
| `BILHARZ_MAX_IMAGE_SIDE` | `6000` | Largest image width or height, in pixels |
| `BILHARZ_BATCH_SIZE` | `64` | Tiles per detector batch |
| `BILHARZ_UPLOAD_TIMEOUT_SECONDS` | `120` | Time allowed for an upload's body to arrive |
| `BILHARZ_ADMIN_TOKEN` | unset | Enables `DELETE /api/reviews` and `GET /api/reviews.csv`; unset means both are disabled |
| `BILHARZ_REVIEW_CODE` | unset | If set, review endpoints need it in `X-Review-Code` |

## Privacy

Reviews store only the sample ID, verdict, note, optional anonymous tester code
and a UTC timestamp: no names, IP addresses or user agents. Queries are
parameterised. The admin token is compared in constant time and never logged.

## Layout

```
server.py            FastAPI app: routes, CORS, security headers, errors
bilharz/settings.py  paths, origins and limits from the environment
bilharz/triage.py    the rule: count confident tiles, decide
bilharz/tiling.py    one image → 12 tiles, exactly as in the notebooks
bilharz/scoring.py   Scorer interface; OnnxScorer (CPU); TorchGpuScorer and load_gpu_scorer (Space)
bilharz/samples.py   the 65 stored samples and the tile archive
bilharz/analysis.py  live analysis of an upload, in memory
bilharz/security.py  streaming upload reader and JPEG checks
bilharz/reviews.py   SQLite review store; the review journal on persistent storage
bilharz/routes/      the endpoints, one router per area; deps.py holds the shared checks
bilharz/schemas.py   Pydantic models
tests/               pytest
```
