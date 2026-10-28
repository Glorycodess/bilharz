# Testing and results

How Bilharz was tested, what each test found, and what changed because of it.
Every number here was measured; the raw results are in
[`docs/evidence/`](evidence/).

**Machine for local measurements:** Apple M1 (8 cores), 8 GB RAM, macOS 26.5,
Python 3.14.7, Node 26.12.1. **Live site:** https://iamglory-bilharz.hf.space
(Hugging Face Space, Gradio SDK on ZeroGPU), measured on 27 October 2026 from
the same machine over a home connection.

## Summary

| Strategy | Tool | Result |
|---|---|---|
| Backend unit and integration | pytest | 91 passed |
| Frontend unit and component | Vitest, Testing Library | 31 passed |
| End to end | Playwright (Chromium) | 7 passed |
| API contract | `npm run check:api` | All 5 endpoints match, with and without a review in the database |
| Model validation | notebooks 04 and 05 | Nested cross-validation; ONNX reproduces all 65 decisions |
| Real samples | `scripts/fetch_samples.py`, `/api/analyse` | 3 of 3 decisions match, locally and live |
| Security and input validation | pytest, `scripts/stress_backend.py` | Every rejected upload gets its documented status; the lock is always released |
| Compatibility | Playwright: Chromium, Firefox, WebKit × 3 sizes × 8 pages | Local 72 of 72; live 69 of 72 (WebKit, one page, see below) |
| Performance | `scripts/measure_backend.py`, Lighthouse, `measure-loading.mjs` | Analysis 29–34 s on CPU, 4–5 s on the live GPU; API p95 under 1.3 ms |
| Stress | `scripts/stress_backend.py` | 1 of 4 simultaneous uploads analysed, 3 refused; 200 of 200 concurrent reads served |
| Coverage | pytest-cov | 98% of backend statements |

## Strategies

### Backend unit and integration tests

**Why.** The backend makes the decision, so the rule, the tiling and the
handling of uploads and reviews must be exact, and stay exact as the code changes.

**How.** pytest in [`api/tests/`](../api/tests/), against the real model, the
real stored scores and the FastAPI app through its test client, with a
throwaway reviews database for every test. Unit tests cover tiling (grid order,
resizing), the triage rule (boundaries, both settings, the research counts
48 / 10 / 7 and 33 / 20 / 12) and the ONNX scorer. Integration tests cover every
endpoint, the review versioning, the CSV export, the admin token and review code,
CORS and security headers, and the upload limits.

**Result.** 91 passed in about 39 s
(`pytest -m "not slow"` skips the one full 117-image analysis).

**Added in this round.** A test that sends four uploads at the same moment
(earlier, the 429 test only faked a busy lock), a check that the lock is free
after a 413, and tests for the new `scorer` field in the analysis response,
including a GPU scorer that reports its CPU fallback.

### Frontend unit and component tests

**Why.** All network access goes through one module, `src/api.js`, which
renames fields and turns errors into messages; a mistake there breaks every
page. A few components carry rules that must not regress: an outcome is never
shown by colour alone, and the admin token is never kept.

**How.** Vitest with Testing Library in jsdom, with the network mocked
([`frontend/src/**/*.test.js(x)`](../frontend/src/)). Covered: the snake_case to
camelCase mapping and defaults for missing fields, `isWaiting`, `isReviewed`
and `countWaiting`, error handling (404 as "not found", 502/503/504 and network
failures as "waking up", the server's own message otherwise), sharing of
identical requests in flight; `OutcomeMark` and `VerdictMark` (the word is always
present, and each mark resolves to the right colour in the stylesheets);
`PageHeader`; the export dialog (the token field is emptied after a refused
attempt, a download and a cancel, and the token never reaches `localStorage`,
`sessionStorage` or a cookie); and page states (loading, "the server is waking
up" with the automatic retry after 10 seconds, and Try again).

**Result.** 31 tests in 5 files, all passing (`npm test`, about 1 second).

### End-to-end tests

**Why.** To check the whole path a technician takes, in a real browser, against
the real backend.

**How.** Playwright in Chromium ([`frontend/e2e/app.spec.js`](../frontend/e2e/app.spec.js)).
`npm run test:e2e` builds the site and starts the backend with a new, empty
reviews database and a random admin token, the site through `vite preview`, and a
second copy of the site whose backend is not running.

| Test | Checks |
|---|---|
| Queue | 65 samples, 48 / 10 / 7 by decision, 48 waiting in the header |
| Tiles | DT40's 12 review tiles load |
| Record a review | The waiting count drops to 47; the Reviews page shows it |
| Edit a review | A new version replaces it; the old one is listed as replaced |
| Export | A wrong token shows "That token isn't valid." and is not kept |
| Upload | The real DT40 sample (117 images) gives Referred, with the time taken |
| Backend stopped | The site says the server is waking up and will try again |

**Result.** 7 of 7 passed (about 40 seconds, 30 of them the upload).

### API contract check

**Why.** The frontend and backend are developed side by side, and a renamed field
fails silently: the page shows nothing rather than an error.

**How.** `npm run check:api` requests every endpoint the frontend reads and checks
that each field it uses is present with the right type.

**Result.** All 5 endpoints match, with and without a review in the database

### Model validation

**Why.** The app is only as good as the rule it applies.

**How and results** (from the notebooks, not repeated here):

- **Notebook 04: nested cross-validation.** Repeated stratified 5-fold
  cross-validation, 20 repeats, split by patient. Every threshold and cut-off is
  chosen inside the folds from training patients only. Exact 95%
  Clopper–Pearson intervals over patients. Triage: sensitivity 96.9%
  (83.8–99.9%), specificity 96.7% (83.8–99.9%), 45.8% of samples reviewed
  (33.4–58.7%); with the safety margin, 100% (at least 89.1%), 96.5% and 72.1%.
  Referral by confidence beat random referral in 20 of 20 repeats.
- **Notebook 05: ONNX equivalence.** The exported model matches the PyTorch
  original to within 0.000002 on 600 tiles. End to end on all 65 patients, scored
  on a CPU from the original images as the backend does it, the confident-tile
  count changed for 3 patients at threshold 0.95 (by one tile each) and 2 at
  0.99, and **no decision changed** under either setting.

### Real samples

**Why.** Synthetic test images check the plumbing, not the model. Three real
patients, one per outcome, check that an upload gives the same decision as the
stored result.

**How.** [`scripts/fetch_samples.py`](../scripts/fetch_samples.py) reads the
central directory of the 12.5 GB Zenodo archive and fetches only the needed
images with HTTP range requests (568 MB for three patients). Each sample has
exactly 117 images. Each was uploaded to `/api/analyse` and compared with
`/api/samples/<ID>` under the default setting (Safety).

| Sample | Stored | Local CPU (3 runs) | Live GPU | Match |
|---|---|---|---|---|
| DT40 | Referred, 4 tiles | Referred, 4 | Referred, 4 (twice) | Yes |
| DT02 | Negative, 0 | Negative, 0 | Negative, 0 | Yes |
| DT29 | Positive, 241 | Positive, 240 | Positive, 240 | Yes (one tile apart) |

DT29's one-tile difference is the one notebook 05 recorded for the ONNX model. The
live PyTorch model on a GPU gives 240 as well, so the difference comes from
preparing the images rather than from CPU and GPU precision; it is far from the
cut-off (35).

### Security and input validation

**Why.** The app accepts large uploads from anyone and stores reviews, so it must
reject bad input early, never leak data, and never get stuck.

**How.** pytest covers: uploads that are not multipart, the wrong number of
files, a PNG or text file renamed `.jpg`, a truncated JPEG, an oversized file,
request and image; uploaded filenames never appearing in responses or logs; the
upload time limit; the lock released after a timeout, a disconnect, a rejected
upload and a scoring error; the admin token compared in constant time, and export
and delete disabled without one; the optional review code; no ground-truth labels
in any response; no personal columns in the reviews table; spreadsheet formulas
neutralised in the CSV; tile paths taken from the manifest, never from the URL;
security headers and CORS. The same rejections were repeated against a real
server ([Stress](#stress-and-robustness)).

**Result.** All pass. On the live site, the strict Content Security Policy is in
force; the only console error it causes is described under Compatibility.

### Compatibility

**Why.** Technicians will use whatever browser and screen they have.

**How.** [`frontend/compat/compat.spec.js`](../frontend/compat/compat.spec.js):
Chromium 156, Firefox 157 and WebKit 27.2 (Playwright builds; WebKit is the engine
behind Safari), each at 1440 × 900, 768 × 1024 and 390 × 844, on eight pages:
Landing, Analyse, Queue, Result (DT40), Review (DT40), Reviews, Performance and a
not-found page. For each: no console errors, no sideways scrolling (document width
at most the viewport width), the header and the page heading visible, and on Result
and Review every tile image loaded. Run against the local build and, reading pages
only, against the live site.

| Browser | Size | Local | Live |
|---|---|---|---|
| Chromium 156 | 1440 × 900 | 8 / 8 | 8 / 8 |
| Chromium 156 | 768 × 1024 | 8 / 8 | 8 / 8 |
| Chromium 156 | 390 × 844 | 8 / 8 | 8 / 8 |
| Firefox 157 | 1440 × 900 | 8 / 8 | 8 / 8 |
| Firefox 157 | 768 × 1024 | 8 / 8 | 8 / 8 |
| Firefox 157 | 390 × 844 | 8 / 8 | 8 / 8 |
| WebKit 27.2 | 1440 × 900 | 8 / 8 | 7 / 8 |
| WebKit 27.2 | 768 × 1024 | 8 / 8 | 7 / 8 |
| WebKit 27.2 | 390 × 844 | 8 / 8 | 7 / 8 |

No page scrolled sideways in any browser, and all tiles loaded everywhere.

**The three live failures** are WebKit on the Analyse page, at every size: the
console reports "Refused to apply a stylesheet because its hash, its nonce, or
'unsafe-inline' does not appear in the style-src directive". A test page with
nothing but a `<select>` element under the same policy gives the same error in
WebKit and none in Chromium or Firefox, so it comes from WebKit's own built-in
styles for the dropdown, which the site's strict policy (`style-src 'self'`)
applies to. The dropdown still works and looks as designed (checked in WebKit on
the live site). It does not appear locally, because `vite preview` sends no
Content Security Policy. Loosening the policy to silence it was not done.

Screenshots of every browser, size and page (72) are in
[`docs/evidence/compatibility/`](evidence/compatibility/), named
`<browser>-<width>-<page>.jpg`; the per-page results are in `results-local.csv`
and `results-live.csv`.

### Performance

**Upload analysis**, one full 117-image sample per run. *Upload* is the time to
send the request body, *server analysis* is the `seconds` the server reports
(decoding, scoring, decision and previews), and *total* is the whole request.

| Sample | Size | Local CPU total (3 runs) | Local server analysis | Live total | Live upload | Live server analysis |
|---|---|---|---|---|---|---|
| DT40 | 182 MB | 28.8, 30.6, 32.3 s | 28.6, 30.4, 32.1 s | 42.5 s | 36.6 s | 4.7 s |
| DT02 | 208 MB | 33.7, 32.7, 32.7 s | 33.5, 32.5, 32.5 s | 82.7 s | 76.2 s | 5.0 s |
| DT29 | 178 MB | 33.2, 33.5, 33.2 s | 33.0, 33.4, 33.0 s | 54.6 s | 48.7 s | 4.3 s |
| DT40 again | 182 MB | | | 107.1 s | 102.3 s | 4.1 s |

- Local: ONNX Runtime 1.31 on the CPU (`scorer: onnx-cpu`, reported per request).
  The upload itself takes 0.14–0.20 s over localhost. Times rose over the session
  (28.8 s to 33.7 s) as the fanless machine warmed up.
- Of a local analysis, decoding and tiling the 117 images takes 1.2–1.7 s; scoring
  the 1,404 tiles takes the rest (29–40 s in a separate in-process measurement).
- Live: four uploads in all (DT40, DT02, DT29, DT40 again). The deployed backend
  did not yet return `scorer` per request, so the scoring path of each upload
  could not be confirmed; `/api/health` reported `torch-gpu` throughout, and the
  4–5 s server time, against about 30 s on the CPU, is consistent with the GPU.
  The repeated DT40 (4.1 s against 4.7 s) shows no meaningful cold-start cost:
  the Space was already awake.
- On the live site the upload dominates: 1.8 to 5.0 MB/s on this connection. The
  fourth upload took 102 s, close to the server's 120-second limit.

**Backend resource use, locally**, during one DT40 analysis (sampled every 0.1 s):

| | Idle | During analysis |
|---|---|---|
| Memory (RSS) | 87 MB | 861 MB peak |
| CPU | 0% | 375% mean, 445% peak (100% = one core of eight) |

**API latency, locally**: 200 sequential requests per endpoint after 10 warm-up
requests, one connection.

| Endpoint | p50 | p95 | Max |
|---|---|---|---|
| `GET /api/samples` | 1.07 ms | 1.20 ms | 1.76 ms |
| `GET /api/samples/DT40` | 0.86 ms | 0.97 ms | 1.24 ms |
| `GET /api/tiles/DT40/1.jpg` | 0.63 ms | 0.70 ms | 0.97 ms |

**Frontend bundle** (production build, Vite 8.3.5):

| | Files | Raw | Gzip |
|---|---|---|---|
| JavaScript | 1 | 319.1 kB | 97.7 kB |
| CSS | 1 | 42.9 kB | 8.1 kB |
| HTML | 1 | 0.6 kB | 0.4 kB |
| Fonts (Latin, the ones a browser loads) | 6 | 140.4 kB | already compressed |

Fonts are self-hosted; the build also contains 36 font files for other scripts
(Cyrillic, Greek, Vietnamese and extended Latin), which browsers download only
for text that needs them. On the low-end profile below, the JavaScript alone
takes about 2 seconds to arrive.

**Lighthouse 13.5** on the live site, Chrome 156 headless. Desktop uses
Lighthouse's desktop preset; mobile uses its default mobile emulation with
simulated throttling (slow 4G, 4× CPU slowdown).

| Page | Mode | Performance | Accessibility | Best practices | LCP | CLS |
|---|---|---|---|---|---|---|
| Landing | Desktop | 80 | 100 | 100 | 0.6 s | 0.324 |
| Queue | Desktop | 95 | 100 | 100 | 0.7 s | 0.002 |
| Review | Desktop | 82 | 100 | 100 | 1.5 s | 0.002 |
| Landing | Mobile | 85 | 100 | 100 | 2.6 s | 0.001 |
| Queue | Mobile | 85 | 100 | 100 | 3.2 s | 0 |
| Review | Mobile | 83 | 100 | 100 | 3.5 s | 0 |

The desktop Landing score is held down by layout shift: see
[the font experiment](#improvements-made-because-of-testing).

**Low-end device simulation**: Chromium with a 4× CPU slowdown and Chrome's Slow 3G
profile (400 kbit/s, 2-second round trips) against the local build, at 390 × 844,
three runs each, nothing cached. Median times from navigation:

| | No throttling | Low-end |
|---|---|---|
| Queue table shown | 0.1 s | 8.9 s |
| First Review tile loaded | 0.1 s | 12.5 s |
| All 12 Review tiles loaded (scrolling down) | 0.5 s | 15.9 s |

### Stress and robustness

Against a local server only ([`scripts/stress_backend.py`](../scripts/stress_backend.py)),
with the production limits (120-second upload limit, 15 MB per file).

| Test | Expected | Result |
|---|---|---|
| 4 full DT40 uploads at the same moment | one 200, three 429 | 200 (32.1 s), 429 ×3 (within 0.2 s) |
| The next upload | 200 | 200 |
| 200 concurrent `GET /api/samples` | all served | 200 of 200 (100%); p50 273 ms, p95 286 ms, all done in 0.34 s |
| 117 images, the first 16 MB | 413 | 413 "Image 1 is larger than 15 MB.", lock free after |
| 116 JPEGs and a PNG named `.jpg` | 415 | 415 "Image 117 is not a JPEG.", lock free after |
| 116 images | 422 | 422, lock free after |
| Half the body, then nothing | 408 | 408 after 120.0 s, lock free after |
| A full upload afterwards | 200 | 200 |

"Lock free after" means a one-image probe straight after got 422 (wrong count), not
429 (busy). The burst latency is queueing: the API answers one request in about a
millisecond, and 200 arrive at once.

### Coverage

`pytest --cov=bilharz --cov=server` on the backend:

| Module | Statements | Missed | Coverage |
|---|---|---|---|
| `bilharz/analysis.py` | 46 | 0 | 100% |
| `bilharz/reviews.py` | 75 | 0 | 100% |
| `bilharz/routes.py` | 151 | 0 | 100% |
| `bilharz/samples.py` | 52 | 2 | 96% |
| `bilharz/schemas.py` | 36 | 0 | 100% |
| `bilharz/scoring.py` | 39 | 3 | 92% |
| `bilharz/security.py` | 88 | 1 | 99% |
| `bilharz/settings.py` | 26 | 0 | 100% |
| `bilharz/tiling.py` | 9 | 0 | 100% |
| `bilharz/triage.py` | 28 | 1 | 96% |
| `server.py` | 68 | 4 | 94% |
| **Total** | **618** | **11** | **98%** |

Two important paths were untested and now have tests: an image whose JPEG header
is valid but whose data is cut off (422, found by decoding), and an upload sent
without a `Content-Length` header that passes the size limit while streaming
(413). The 11 statements still untested are: closing the tile archive, a missing
archive member that the manifest lookup already prevents, the error when no
scorer can be loaded, a triage file whose default setting is missing, re-raising
an error after a response has started, and building the default app on first
use. The Space entry point (`deploy/space/app.py`) is not in these figures: it
needs `spaces` and a GPU, and was tested by running it with the Space's settings.

## Improvements made because of testing

- **A field mismatch between frontend and backend.** The contract check caught the
  frontend reading fields the running backend did not send (a `reviewed` flag
  replaced by a `review` object, and later `review_code_required` and
  `details_hidden`), when an old backend process was still running. The check now
  names that case in its output.
- **The DT40 crop test, redesigned.** A test re-scored DT40's review tiles from
  `tiles.zip` and expected the stored scores. Those crops are JPEG-compressed copies
  for display, so re-scoring them cannot reproduce the original scores exactly, and
  no decision ever uses them. The test now checks what the crops are for: valid
  256 × 256 JPEGs in roughly the stored order, with the top one still clearly an
  egg. The end-to-end check of the model is the one in notebook 05.
- **Uploaded filenames are no longer echoed.** Filenames could carry patient names
  or record numbers. Images are now known only by position (`upload_001` …), the
  browser sends neutral names, and a test checks that names never appear in
  responses, errors or logs.
- **An upload time limit, and a lock that is always released.** A stalled upload
  could hold the one-analysis lock indefinitely. Uploads now get 120 seconds (408
  after that), and tests check that the lock is released after a timeout, a
  disconnect, a rejected upload and a scoring error.
- **A dependency conflict found on Hugging Face.** The first Space build failed:
  `gradio[mcp]` 6.30 requires Pydantic 2.12.5 or lower, and the Space pinned 2.14.1.
  The Space now pins 2.12.5; Hugging Face's exact install command was resolved in a
  clean Python 3.12 environment before pushing, and the backend tests pass on 2.12.5.
- **A port conflict at start-up on the Space.** The container kept restarting: on
  Spaces, Gradio turns on server-side rendering, and mounting Gradio then started a
  Node server on port 7860 before uvicorn could bind it. Gradio is now mounted with
  server-side rendering off, and the start-up was reproduced locally with the
  Space's settings to confirm one server on one port.

**Found in this round:**

- **The scorer was not visible per request.** The Space falls back from the GPU to
  the CPU silently, so the timing of an upload could not be attributed. Each
  analysis now reports `scorer`, the one that actually ran; this needs deploying
  to the Space.
- **A WebKit console error on the live Analyse page** (above). Not fixed: it comes
  from WebKit's own dropdown styles under the strict policy, and the dropdown works.
- **Layout shift on the desktop Landing page** (Lighthouse CLS 0.324). The hero
  figure is centred against the headline; when the web fonts arrive after the first
  paint, the headline's height changes and the figure moves. Locally, with a
  10 Mbit/s, 40 ms network, it happened in 6 of 30 loads without changes.
  Preloading the hero's fonts removed it, but slowed the low-end load:

  | Fonts preloaded | Loads with a shift | Low-end: Queue table | First Review tile | All 12 tiles |
  |---|---|---|---|---|
  | None (kept) | 6 of 30 (0.284 each) | 8.9 s | 12.4 s | 15.9 s |
  | Three (Inter 600, Inter Tight 600 and 700) | 0 of 15 | 10.4 s | 12.5 s | 16.5 s |
  | Four (also Inter 400) | 0 of 30 | 10.9 s | 13.2 s | 17.0 s |

  The preload was **not kept**: it costs every page 1.5–2 seconds on a slow
  connection, where Bilharz is most likely to be used, to fix a shift on one page
  on desktop. A layout that does not centre the figure against the text would fix
  the shift without that cost; it is a design change, so it is left for a
  decision.
- **Uploads near the time limit.** A live upload took 102 of the allowed 120
  seconds. At under about 1.5 MB/s, a 180 MB sample cannot be uploaded. The limit
  is a setting (`BILHARZ_UPLOAD_TIMEOUT_SECONDS`) and can be raised on the Space
  without a code change.
- **A test-tool artefact, not an app bug.** Playwright hides the text caret during
  a screenshot by adding a `<style>` element, which the strict policy blocks in
  WebKit with a console error. The compatibility test now collects console errors
  before taking its screenshot.

## Known limitations

- **Real-sample coverage is three patients**, one per outcome. The model's
  accuracy rests on the 65-patient cross-validation in notebook 04, with wide
  intervals, and has not been validated on another cohort.
- **The live GPU path was not confirmed per request**, because the `scorer` field
  was not yet deployed. The server time suggests the GPU.
- **Browsers are Playwright's builds of the engines**, not branded Chrome, Firefox
  and Safari, and only on macOS. Mobile sizes were tested as small viewports on a
  desktop engine, not on phones.
- **Live measurements come from one connection on one day.** Upload times depend
  entirely on the connection.
- **Reviews on the live site are lost when the Space restarts**, so no
  persistence test was possible there.
- **The low-end simulation and the layout-shift test use the local build**, served
  by `vite preview` rather than the Space.
- **Stress tests ran locally only**, by design, so the live site's behaviour under
  load was not measured.
