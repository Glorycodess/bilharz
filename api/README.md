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
| GET | `/api/health` | `{"status": "ok", "scorer": "onnx-cpu", "samples": 65, "reviews_persistent": true, "reviews_unreadable": 0, "accounts_writable": true}` |
| GET | `/api/config` | Both settings, their rules and the default |
| GET | `/api/samples?setting=` | The queue: `id`, `confident_tiles`, `decision` and `review` (the latest verdict and its time, or null) per sample |
| GET | `/api/samples/{id}?setting=` | One sample's result, with its top 12 tiles; 404 if unknown. The review's note and reviewer only for an approved reviewer |
| GET | `/api/tiles/{id}/{rank}.jpg` | A top tile (rank 1–12) from `tiles.zip`; 404 otherwise |
| POST | `/api/analyse?setting=` | Analyse one uploaded sample (multipart field `files`, 117 JPEGs) |
| POST | `/api/reviews/{id}` | Save a sample's review: `verdict` (`infected`/`healthy`), optional `note` (≤ 500 chars) and `supersedes` (to amend the current review). Needs an approved reviewer; the reviewer is the signed-in account. 409 if the sample already has a review and `supersedes` is not its current one |
| GET | `/api/reviews?view=current\|all` | One row per sample (its current review), or every version; needs an approved reviewer |
| GET | `/api/reviews.csv` | Every version as CSV, with `reviewer_id` and `reviewer`; needs an admin, or header `X-Admin-Token` |
| DELETE | `/api/reviews` | Delete all reviews; needs an admin, or header `X-Admin-Token` |
| POST | `/api/auth/signup` | Create an account (`name`, `email`, `password` of 12–128 characters): a pending reviewer, signed in |
| POST | `/api/auth/signin` | Sign in with `email` and `password`; sets the session cookie |
| POST | `/api/auth/signout` | End this browser's session |
| GET | `/api/auth/me` | `{"account": {...}}` for the signed-in account (pending ones included), or `{"account": null}` |
| POST | `/api/auth/reset` | Set a new password with the `token` of an admin's reset link |
| POST | `/api/admin/claim` | Make the signed-in account an approved admin; needs header `X-Admin-Token` |
| GET | `/api/admin/accounts` | Every account (admins only) |
| POST | `/api/admin/accounts/{id}/approve`, `/disable`, `/role`, `/reset-link` | Approve, disable, set `role` (`reviewer`/`admin`), or make a one-time reset link valid for an hour (admins only) |

### Accounts and access

The queue, results, uploads and the decision settings are open to everyone.
Recording and reading reviews need a signed-in **approved** reviewer (401 when
not signed in, 403 while the account waits for approval); managing accounts
needs an approved **admin**. A new account starts as a pending reviewer, and an
admin approves it. The first admin is made with `POST /api/admin/claim` and the
admin token; the token also exports and deletes reviews when no admin can.

- **Passwords**: stored only as Argon2id hashes (`argon2-cffi`, RFC 9106
  parameters), upgraded at sign-in if the parameters change. An unknown email
  costs the same hashing work and gets the same answer as a wrong password.
- **Sessions**: a 256-bit random token in the cookie `__Host-bilharz_session`
  (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`). The server
  keeps only its SHA-256 hash, in memory: a session ends after 8 hours without
  a request, 7 days after sign-in, at sign-out, when the account is disabled or
  its password reset, and when the server restarts. Each sign-in issues a new
  token.
- **Rate limits** (in memory, per 15 minutes unless stated): 5 wrong passwords
  per account (sign-in then waits, even with the right password), 20 per IP
  address, 5 sign-ups per IP address per hour, 10 wrong reset links per IP
  address, 5 wrong admin tokens per account. The IP address comes from
  `X-Forwarded-For`, which a client can add to, so the per-IP limits are a
  best effort; the per-account limit is the protection against guessing.
- **Origin check**: a POST, PUT, PATCH or DELETE under `/api` is refused (403)
  when its `Origin` header is another site, or when it carries the session
  cookie without an `Origin` header (cross-site request forgery). Scripts
  without a cookie are not affected.
- **Reset links**: an admin makes one; it works once, for an hour, and a newer
  link replaces it. Only its SHA-256 hash is stored, and the token is after `#`
  in the link, so it is never sent to a server or logged. Bilharz sends no email.
- **Storage**: accounts are kept in `accounts.jsonl` in `BILHARZ_ACCOUNTS_DIR`
  (by default the reviews journal's directory), rewritten whole on each change
  like the journal. If any line cannot be read, the file is never written
  over: existing accounts still sign in, and new accounts and changes are
  refused (500) until it is repaired; `/api/health` reports
  `accounts_writable: false`.
- Responses under `/api/auth`, `/api/admin` and `/api/reviews` are sent with
  `Cache-Control: no-store`.

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
| `BILHARZ_ADMIN_TOKEN` | unset | The emergency fallback: makes a signed-in account an admin (`POST /api/admin/claim`), and exports and deletes reviews without an admin session. Unset: none of these work with a token |
| `BILHARZ_ACCOUNTS_DIR` | `BILHARZ_REVIEWS_DIR`, else the database's folder | Folder of `accounts.jsonl`, on persistent storage |
| `BILHARZ_COOKIE_SECURE` | `true` | `false` only for a development server on plain http: the cookie is then `bilharz_session`, without `Secure` |

## Privacy

A review stores the sample ID, verdict, optional note, a UTC timestamp and the
reviewer's account id and name, taken from the session. Reviews from before
accounts have no reviewer (some have an anonymous tester code); new reviews
take no tester code. An account stores its name, email, Argon2 password hash,
role, status, and the times it was created, approved, disabled or had its
password changed, with the admin who approved it. No IP address or user agent
is stored with either. IP addresses are held in memory for the rate limits
only and are never written to a log: the Space starts uvicorn with
`access_log=False` (`deploy/space/app.py`), and the app's own log lines carry no
client address (`tests/test_logging.py`). Run locally with `uvicorn server:app`,
uvicorn's access log is on unless `--no-access-log` is given. The note and the reviewer's name are shown only to approved
reviewers, and email addresses only to admins. Queries are parameterised. The
admin token is compared in constant time, and the server's own log records
account numbers only, never names, emails, passwords or tokens.

## Layout

```
server.py            FastAPI app: routes, CORS, the Origin check, security headers, errors
bilharz/settings.py  paths, origins and limits from the environment
bilharz/triage.py    the rule: count confident tiles, decide
bilharz/tiling.py    one image → 12 tiles, exactly as in the notebooks
bilharz/scoring.py   Scorer interface; OnnxScorer (CPU); TorchGpuScorer and load_gpu_scorer (Space)
bilharz/samples.py   the 65 stored samples and the tile archive
bilharz/analysis.py  live analysis of an upload, in memory
bilharz/security.py  streaming upload reader and JPEG checks
bilharz/reviews.py   SQLite review store; the review journal on persistent storage
bilharz/accounts.py  reviewer accounts in accounts.jsonl on persistent storage
bilharz/passwords.py Argon2id hashing and the password rules
bilharz/sessions.py  sign-in sessions in memory (hashed tokens, 8 h idle, 7 days)
bilharz/ratelimit.py failed-attempt counters
bilharz/storage.py   whole-file replace, shared by the journal and the accounts file
bilharz/clock.py     the time, in one place, so tests can move it
bilharz/routes/      the endpoints, one router per area; deps.py holds who may do what
bilharz/schemas.py   Pydantic models
tests/               pytest
```
