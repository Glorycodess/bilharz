# Bilharz

Patient-level triage for urogenital schistosomiasis from urine microscopy: an egg
detector decides the clear cases, and refers the uncertain ones to a human reviewer.

Final-year capstone · BSc Software Engineering (Machine Learning) ·
African Leadership University · Glory Paul

## Links

| | |
|---|---|
| **Live app** | https://iamglory-bilharz.hf.space |
| **Hugging Face Space** | https://huggingface.co/spaces/iamglory/bilharz |
| **Repository** | https://github.com/Glorycodess/bilharz |
| **Figma** | https://www.figma.com/design/yNDxzYmsbYGOrhljmDWXmz/Bilharz |
| **Walkthrough video** | (link to be added) |
| **Technical report** | (link to be added) |
| **Scope** | [docs/scope.md](docs/scope.md): the proposal against what was built |
| **First mockups** | [design/README.md](design/README.md): the first design iteration and what replaced it |

---

## 1. Description

### The disease

Schistosomiasis, or bilharzia, is caused by parasitic worms picked up from
infested fresh water. In the urogenital form, caused by *Schistosoma haematobium*,
the worms' eggs pass out in urine; the eggs that stay behind lodge in the bladder
and genital tract, causing bleeding, scarring, kidney damage, infertility, and in
late stages bladder cancer. In women it causes female genital schistosomiasis and
raises the risk of HIV. In children it causes anaemia, stunted growth and impaired
learning, often for years before anyone notices.

As of 2024, WHO reports:

| | |
|---|---|
| People requiring preventive treatment | **253.7 million** |
| Share of them who received it | **39.6%** |
| Share of them living in Africa | **≥ 93.9%** |

Treatment is cheap and effective. The bottleneck is diagnosis: finding eggs in
urine under a microscope is slow, skilled work, in the places with the fewest
trained microscopists.

### The problem with automated screening

The **Schistoscope** is an automated microscope built for this. It photographs each
urine sample as **117 images** and runs an egg detector on each one. The patient is
then called positive if an egg is detected in **any** image.

That rule is the weak point. Across 117 images, a single piece of debris mistaken
for an egg is enough to misdiagnose a healthy person. In a field study of 487
participants in Nigeria (Meulah et al., 2022):

| | Sensitivity | Specificity |
|---|---|---|
| Fully automated (any-detection rule) | 87.3% | **48.9%** |
| Semi-automated (human reviews the results) | 80.1% | 95.3% |

Fully automated, about half of healthy people are told they are infected. Making it
reliable requires a human to review the output, which brings back the workload the
device was meant to remove.

### What Bilharz does

Bilharz replaces the any-detection rule with **triage**. Each sample gets one of
three outcomes:

| Outcome | When |
|---|---|
| **Negative**, decided automatically | The detector is confident about no egg anywhere |
| **Positive**, decided automatically | The detector is confident about many eggs |
| **Referred to a reviewer** | The evidence is in between |

The reviewer sees only the referred samples, and for each one only the image
regions the detector ranked highest, instead of 117 full images.

**Results on 65 patients**, with every threshold learned on separate patients:

| | Sensitivity | Specificity | Samples a human reviews |
|---|---|---|---|
| Any-detection rule | 100.0% | 0.0% | 0% |
| **Bilharz triage** | **96.9%** | **96.7%** | **45.8%** |
| Full human review | 100% | 100% | 100% |

On this cohort, triage approaches full-review accuracy with less than half the
review workload. The Results section below gives the full comparison, intervals, and the one
infection it missed.

## 2. Setting up the environment

### Trying it without installing anything

Open **https://iamglory-bilharz.hf.space**. The Queue lists the 65 evaluation
samples with their decisions; any referred sample can be opened for review, and
the Analyse page accepts a folder of 117 microscope images. The Space sleeps
when unused, so the first visit after a quiet period can take a minute while it
starts.

### Technical requirements

| | Version |
|---|---|
| Python (local) | 3.12 to 3.14 (developed on 3.14.7) |
| Python (Hugging Face Space) | 3.12.12 |
| Node.js and npm | Node 20.19+ or 22.12+ (developed on Node 26.12, npm 11.20) |
| Backend | FastAPI 0.162, Starlette 1.10, Pydantic 2.14 (2.12.5 on the Space), uvicorn 0.54 |
| Model runtime | onnxruntime 1.31 (CPU); PyTorch 2.13 and torchvision 0.28 on the Space |
| Space wrapper | Gradio 6.30 with `spaces` 0.51.3 (ZeroGPU) |
| Frontend | React 19.3, React Router 7.18, Vite 8.3 |
| Tests | pytest 9.1, Vitest 5.0, Testing Library, Playwright 1.64 |

**Hardware.** Everything runs on an ordinary CPU: a full 117-image analysis takes
about 30 seconds on an Apple M1 with ONNX Runtime and needs about 0.9 GB of
memory at its peak. On the Space the detector runs on ZeroGPU (an analysis takes
about 5 seconds on the server), with the CPU as the fallback. The notebooks need a
GPU and were run on Kaggle.

**Browsers.** Tested in Chromium 156 (Chrome, Edge), Firefox 157 and WebKit 27.2
(the engine behind Safari), at 1440, 768 and 390 pixels wide; see
[docs/testing.md](docs/testing.md#compatibility).

### Installation and running

The model and tile files are not in git (they are on the Hugging Face Space).
Put `detector.onnx`, `detector.pt` and `tiles.zip` in `api/assets/`, next to
`tiles_manifest.json` and `triage_config.json`.

**Backend**, from `api/`:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
.venv/bin/uvicorn server:app --reload --port 8000
```

The API is then at `http://localhost:8000/api`, with interactive docs at
`http://localhost:8000/docs`. Reviews are stored in `api/data/reviews.db`; set
`BILHARZ_REVIEWS_DB` to use another file, and `BILHARZ_REVIEWS_DIR` to keep a
journal of every review on other storage, from which the database is rebuilt on
start (as the live app does). [api/README.md](api/README.md) lists
every endpoint and environment variable.

**Frontend**, from `frontend/`:

```bash
npm ci
npm run dev
```

The site is then at `http://localhost:5173`.

**Both together.** Start the backend first, then the frontend: the development
server sends every `/api` request to `http://localhost:8000` (set
`BILHARZ_API_TARGET` for another address). If the backend is not running, the
site says the server is waking up and tries again.

### Running the tests

```bash
cd api && .venv/bin/pytest                # backend: unit and integration
cd api && .venv/bin/pytest --cov=bilharz --cov=server --cov-report=term   # with coverage

cd frontend
npx playwright install chromium firefox webkit   # once
npm test                  # unit and component tests (Vitest)
npm run test:e2e          # end to end in Chromium, against a local backend with a throwaway database
npm run test:compat       # three browsers, three screen sizes, eight pages
npm run check:api         # a running backend against the fields the frontend uses
```

`test:e2e` and `test:compat` build the site and start their own servers on ports
8010, 4173 and 4174; they never touch `api/data/reviews.db`. The end-to-end
upload test needs the real DT40 sample (below) and is skipped without it.

### Fetching real test samples

```bash
api/.venv/bin/python scripts/fetch_samples.py DT40 DT02 DT29
```

This downloads only those patients' 117 images each from the Zenodo dataset
(about 180 MB each), using HTTP range requests on the 12.5 GB archive, into
`test-data/samples/<ID>/`, which git ignores. The folders can be uploaded on the
Analyse page as they are.

### Bootstrap intervals

```bash
api/.venv/bin/python scripts/bootstrap_intervals.py
```

This reruns notebook 04's nested cross-validation from
`results/patient_scores.npz`, checks that the notebook's figures reproduce, and
writes patient-level bootstrap intervals to `docs/evidence/bootstrap.json`
([docs/testing.md](docs/testing.md#bootstrap-intervals)). It needs scipy and
scikit-learn, which `requirements-dev.txt` installs.

### Building the Hugging Face Space

```bash
git clone https://huggingface.co/spaces/iamglory/bilharz ~/bilharz-space   # once
deploy/build_space.sh
```

This builds the frontend and assembles the Space in `~/bilharz-space`; committing
and pushing there deploys it. See [deploy/README.md](deploy/README.md).

### Running the notebooks

The notebooks run on Kaggle and download their data from Zenodo. Run each with
**Save & Run All (Commit)** so its outputs are kept.

| Notebook | What it does | Kaggle settings |
|---|---|---|
| `01-data-collection.ipynb` | Downloads the diagnosis dataset, verifies its checksum, and checks its structure | Internet on |
| `02-data-preparation-and-baseline.ipynb` | Data preparation and exploratory analysis, and a baseline using generic image features | Internet on, GPU T4 |
| `03-detection.ipynb` | Trains the egg detector on a separate, expert-annotated dataset | Internet on, GPU T4 |
| `04-prediction-and-evaluation.ipynb` | Scores all 65 patients, applies triage, compares it with alternative systems, and evaluates deferral | Internet on, GPU T4, output of `03` attached |
| `05-export.ipynb` | Exports the detector to ONNX, checks it end to end on all 65 patients, and builds the app's tiles and triage rule | Internet on, outputs of `03` and `04` attached |

Notebook 04 takes about 55 minutes, mostly the 12.5 GB download. Its tile scores
are saved in `results/patient_scores.npz`, so the analysis can be re-run without
the images.

## 3. Designs

The interface is built around the three triage outcomes, with **referral** as the
centre of the design, since it is where the human and the model meet.

| Screen | Purpose |
|---|---|
| Landing | What the system does and the evidence for it |
| Analyse | Upload a sample's 117 images, or open a stored sample |
| Result | The outcome for one sample: negative, positive, or referred |
| Review | The 12 highest-ranked tiles of a referred sample, for a technician to decide |
| Queue | All samples, with the ones waiting for review |
| Reviews | Every recorded review, its earlier versions, and a CSV export |
| Performance | Accuracy and review workload for the two decision settings, and the choice of setting the app uses |

The working designs are on
[Figma](https://www.figma.com/design/yNDxzYmsbYGOrhljmDWXmz/Bilharz). Earlier
mockups, the first design iteration, are in `design/`; [design/README.md](design/README.md)
maps each one to the screen that replaced it, and [docs/scope.md](docs/scope.md)
maps the proposal's features to what was built.

**The decision setting.** Bilharz has two settings: Efficiency (fewer reviews)
and Safety (no infected patient cleared in testing, more reviews). The app uses
Safety by default; the Performance page compares the two and lets the user
choose the one the app uses. The choice is remembered in that browser and
applies to the queue, sample results and new analyses; recorded reviews do not
depend on it.

## 4. Deployment

**Current.** The app runs on a Hugging Face Space (Gradio SDK, ZeroGPU hardware)
at https://iamglory-bilharz.hf.space. One server provides the API under `/api`,
the built React site at `/`, and a small Gradio status page at `/gradio`.
Uploads are scored by the detector in PyTorch on ZeroGPU, with ONNX Runtime on the
CPU as the fallback. The 65 evaluation samples are served from their stored
scores. Reviews are written to a private Hugging Face Storage Bucket as well as
the Space's local database, which is rebuilt from the bucket when the Space
restarts. `deploy/build_space.sh` assembles the Space from this repository; pushing
to the Space's own repository redeploys it.

![Bilharz architecture](figures/bilharz-architecture.png)

The design behind it is described in [docs/architecture.md](docs/architecture.md).

**Next.** Package the service in a container so it can run on a laboratory's
own infrastructure, where patient data often cannot leave the site.

**Longer term.** The Schistoscope is used in the field with unreliable
connectivity, so a realistic deployment runs analysis on or beside the microscope
and synchronises records when a connection is available.

## 5. Video demo

Walkthrough video: (link to be added)

## 6. Testing

The backend has unit and integration tests (pytest), the frontend has component
tests (Vitest and Testing Library) and end-to-end tests (Playwright), and a
contract check compares a running backend with the fields the frontend reads.
The app was checked in three browser engines at three screen sizes, measured for
speed locally and on the live site, and stress-tested locally.
[docs/testing.md](docs/testing.md) gives every strategy, its results and what was
changed because of it.

| Strategy | Result |
|---|---|
| Backend unit and integration (pytest) | 108 passed, 96% statement coverage |
| Frontend unit and component (Vitest) | 38 passed |
| End to end (Playwright, Chromium) | 8 passed, including a real 117-image upload and switching the decision setting |
| API contract (`npm run check:api`) | All fields the frontend reads are present |
| Real samples (DT40, DT02, DT29) | All three decisions match the stored results, locally and live |
| Compatibility (3 engines × 3 sizes × 8 pages) | Local 72 of 72; live 69 of 72 (a WebKit console message on one page) |
| Analysis time | About 30 s on a laptop CPU; about 5 s on the live GPU, plus the upload |
| Stress | 1 of 4 simultaneous uploads analysed, 3 refused with 429; 200 of 200 concurrent reads served |

---

## Data

**Evaluation:** [*Schistosoma haematobium* egg image dataset](https://doi.org/10.5281/zenodo.6467268),
Zenodo, CC-BY-4.0.

- 65 patients (DT01–DT65), **117 images each**, 7,605 images in total
- 32 infected, 33 healthy, labelled by expert microscopists
- Egg counts from 0 to 516; **nine infected patients have five eggs or fewer**

![Infection burden](figures/fig_egg_burden.png)

The low-burden patients matter most: a light infection is an early one, and it is
where a single missed or false detection changes the verdict.

**Detector training:** SHdataset_12k, a separate dataset of microscopy images with
expert-drawn egg masks. It shares **no patients** with the evaluation set.

![Example fields of view](figures/fig_fov_examples.png)

## Method

### From images to tiles

An egg is small compared with a whole image, and shrinking an image to fit a model
shrinks the egg into a few pixels. Each image is therefore resized to 1024 × 768
and cut into a 3 × 4 grid of 256 × 256 **tiles**: 12 per image, **1,404 per
patient**.

### The egg detector

A ResNet18, pre-trained on ImageNet and fine-tuned end to end, gives each tile a
score from 0 to 1: how likely it is to contain an egg. It was trained on about
32,000 tiles from SHdataset_12k, cut the same way, with a tile counted as an egg
tile if it held at least 500 marked egg pixels. Validation AUROC on held-out tiles
is **0.985**.

### Triage

For each patient, Bilharz counts the tiles the detector is confident contain an
egg. A patient with **none** is cleared; a patient with **more than any healthy
patient in training** is flagged; anyone in between is referred. The confidence
threshold and both cut-offs are learned from training patients only.

### Validation

Repeated stratified 5-fold cross-validation, 20 repeats, split by **patient**, so
all of a patient's tiles fall on the same side of every split. Every threshold any
system uses is chosen inside the folds. Referred samples are assumed to be read
correctly by the reviewer, the same assumption behind the full-review baseline.
Intervals are exact 95% Clopper–Pearson intervals over patients. A patient-level
bootstrap of the same results, with AURC intervals, is in
[docs/testing.md](docs/testing.md#bootstrap-intervals).

## Results

### 1. The any-detection failure reproduces

Calling a patient positive if any tile scores above 0.5 gives **100% sensitivity
and 0% specificity**. Every healthy sample contains at least one confident false
alarm among its 1,404 tiles.

### 2. Triage against the alternatives

| System | Sensitivity | Specificity | Samples reviewed |
|---|---|---|---|
| Any-detection (tile > 0.5) | 100.0% | 0.0% | 0% |
| Highest tile, single threshold | 85.6% | 83.6% | 0% |
| Confident-tile count, single threshold | 79.4% | 86.7% | 0% |
| Random referral, same workload as triage | 88.8% | 93.3% | 45.8% |
| **Triage** | **96.9%** | **96.7%** | **45.8%** |
| Full human review | 100.0% | 100.0% | 100% |

95% intervals for triage: sensitivity 83.8–99.9%, specificity 83.8–99.9%, samples
reviewed 33.4–58.7%.

Fully automatic systems miss 15–21% of infected patients. Random referral uses the
same reviewer time as triage and does worse on both measures: what matters is
**which** samples reach the reviewer.

![Patient scores by diagnosis](figures/fig_patient_scores.png)

### 3. Referring by confidence beats referring at random

As more uncertain patients are referred, the error rate among the remaining
automatic decisions should fall. The area under that curve (AURC, lower is better)
summarises it:

| | AURC | Error with half the samples referred |
|---|---|---|
| **Referral by confidence** | **0.095** | **8.0%** |
| Referral at random | 0.206 | 20.9% |
| Best possible | 0.024 | — |

Confidence beats random in **20 of 20** repetitions. With the generic image
features of notebook 02, the two were indistinguishable (AURC 0.276 vs 0.283).

![Risk–coverage curve](figures/fig_risk_coverage_nested.png)

### 4. The missed infection, and a safer setting

The one infected patient triage missed is DT40 (7 eggs). Its eggs scored just
below the stricter confidence threshold that some training folds selected, so it
had no confident tiles and was cleared.

A **safety margin**, designed after this miss was found and therefore reported as
an extra analysis, only allows thresholds at which every infected training patient
has at least two confident tiles:

| | Sensitivity | Specificity | Samples reviewed |
|---|---|---|---|
| Triage | 96.9% | 96.7% | 45.8% |
| Triage with safety margin | 100.0% (95% CI ≥ 89.1%) | 96.5% | 72.1% |

It prevents the miss at the cost of more review. The two sensitivity intervals
overlap, so the margin is not proven more sensitive; the extra workload is clear.

### 5. What the hard cases look like

![Highest-scoring tiles for the hardest patients](figures/fig_hard_cases.png)

*Top: the three healthy patients with the most confident tiles. Bottom: the three
infected patients with the fewest.* The false alarms come from debris- and
fibre-heavy samples; the hardest infected patients carry a single egg. By count
alone they look alike, which is why they are referred.

## Findings

1. **The failure is in the decision rule, not the detector.** The same tile scores
   give 0% specificity under the any-detection rule and 96.7% under triage.
2. **A detector trained on eggs is what makes referral work.** Generic image
   features gave referral no better than random.
3. **Triage approaches full-review accuracy at less than half the workload** on
   this cohort.
4. **Simple aggregation of a good detector beat learned aggregation.** In the
   notebook 02 baseline, attention-based multiple-instance learning did not beat
   taking the highest score, at this sample size.
5. **Safety and workload trade off directly.** Preventing the one observed miss
   raises review from 46% to 72% of samples.

## Limitations

- **65 patients.** Every estimate has a wide interval; the results show the
  approach works on this cohort, not clinical performance.
- **No external validation of the triage rule.** The detector is tested on
  patients from a different dataset, but the triage cut-offs are learned and tested
  within the same 65 patients. A cohort from another site is needed.
- **The cut-offs depend on the most extreme patients in training**: the healthy
  patient with the most false alarms, and the infected patient with the faintest
  eggs.
- **The reviewer is simulated** against the expert labels; no human participants
  were involved.
- **Debris and fibres** cause most false alarms.
- **Tiles do not overlap**, so an egg on a tile boundary is split between two.
- **The Schistoscope figures** come from a different detector and pipeline, so
  they are context, not a like-for-like comparison.
- **Reviews on the live app depend on the storage bucket.** They are kept in a
  Storage Bucket, which is eventually consistent and has no shared locks, so the
  app assumes a single server process owns the reviews journal.
- **Uploads must arrive within 120 seconds.** A sample is about 180 MB, so a
  connection slower than about 1.5 MB/s cannot upload one to the live app.
- **GPU time is shared.** ZeroGPU has a daily quota; when it is used up, uploads
  are scored on the CPU, which takes about 30 seconds instead of 5.

## Next

1. Retrain the detector with debris and fibres as negative examples
2. Validate on new field samples from another site
3. Run analysis beside the microscope, for sites without a reliable connection

## API endpoints

All under `/api`; [api/README.md](api/README.md) has the details.

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Status, the active scorer, and whether reviews survive a restart |
| `GET /api/config` | The two decision settings and their rules |
| `GET /api/samples` | The queue: each sample's confident-tile count, decision and latest review |
| `GET /api/samples/{id}` | One sample's result, with its 12 highest-scoring tiles |
| `GET /api/tiles/{id}/{rank}.jpg` | One of those tiles |
| `POST /api/analyse` | Analyse an uploaded sample of 117 JPEG images |
| `POST /api/reviews/{id}` | Record a technician's verdict, or a new version of it |
| `GET /api/reviews` | The current reviews, or every version |
| `GET /api/reviews.csv` | Every review as CSV (needs the admin token) |
| `DELETE /api/reviews` | Delete all reviews (needs the admin token) |

Reviewer verdicts are stored for audit and are not used to retrain the model.

## Repository structure

```
bilharz/
├── api/          FastAPI backend: triage, scoring, uploads, reviews, and its tests
├── frontend/     React and Vite site, with unit, end-to-end and compatibility tests
├── deploy/       Hugging Face Space build script and entry point; submission ZIP script
├── notebooks/    Data collection, preparation, detection, prediction and export
├── results/      Saved tile scores for the 65 patients
├── figures/      Result figures and the architecture diagram
├── docs/         Scope (scope.md), architecture, testing results, and evidence (screenshots, measurements)
├── design/       The first design iteration's mockups, mapped to the built screens in design/README.md
├── scripts/      Fetching real test samples; backend measurements and stress tests; bootstrap intervals
└── README.md
```

## References

World Health Organization (2025). *Schistosomiasis fact sheet.*
https://www.who.int/news-room/fact-sheets/detail/schistosomiasis

Meulah, B., Oyibo, P., Bengtson, M., Agbana, T., Lontchi, R. A. L., Adegnika, A. A.,
Oyibo, W., Hokke, C. H., Diehl, J. C., van Lieshout, L. (2022). Performance
evaluation of the Schistoscope 5.0 for (semi-)automated digital detection and
quantification of *Schistosoma haematobium* eggs in urine: a field-based study in
Nigeria. *American Journal of Tropical Medicine and Hygiene* 107(5), 1047–1054.
https://doi.org/10.4269/ajtmh.22-0276

Oyibo, P., Jujjavarapu, S., Meulah, B., Agbana, T., Braakman, I., van Diepen, A.,
Bengtson, M., van Lieshout, L., Oyibo, W., Vdovine, G., Diehl, J. C. (2022).
Schistoscope: an automated microscope with artificial intelligence for detection of
*Schistosoma haematobium* eggs in resource-limited settings. *Micromachines* 13(5),
643. https://doi.org/10.3390/mi13050643

Ilse, M., Tomczak, J. M., Welling, M. (2018). Attention-based deep multiple instance
learning. *ICML*.

Geifman, Y., El-Yaniv, R. (2017). Selective classification for deep neural networks.
*NeurIPS*.
