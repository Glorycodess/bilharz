# Scope: the proposal and what was built

This document maps the approved proposal to the delivered system: each planned
feature and its status, every change of scope with the evidence behind it, the
answers to the research questions, and the first mockups against the built
screens. Numbers come from the notebooks, the [README](../README.md) and
[testing.md](testing.md).

## Objectives

From the proposal:

1. To review existing automated microscopy systems for urogenital
   schistosomiasis, and to inspect, document and assess whether the available
   public datasets provide the sample-level grouping, complete field-of-view
   image sets and reference labels required for patient-level modelling.
2. To develop a patient-level diagnostic system combining egg detection,
   learned aggregation of detections across a sample's field-of-view images,
   and a selective prediction layer capable of deferring uncertain samples to
   human review.
3. To evaluate the system against an independent expert microscopist reference
   standard, reporting patient-level specificity, sensitivity and deferral rate,
   and comparing performance against published results and against fixed
   aggregation rules.

## Features

| Planned feature | Intended purpose | Current status | Evidence |
| --- | --- | --- | --- |
| Dataset inspection | Establish whether a public dataset supports patient-level modelling (objective 1) | Completed | Notebook 01 (download, MD5 check, 65 samples × 117 images); notebook 02 §1–2 (structure asserted, `microscopist_result.csv` with egg count and diagnosis); notebook 03 (SHdataset_12k: 12,051 images with pixel masks) |
| Egg detection | Score each field-of-view region for eggs | Completed, changed | Notebook 03: ResNet18 fine-tuned on 32,277 tiles, validation AUROC 0.985, average precision 0.957. Replaced frozen ImageNet features (see [scope changes](#scope-changes)) |
| Learned aggregation (attention MIL) | Combine a sample's detections into one patient score | Implemented and evaluated, not adopted | Notebook 02 §6–9: gated attention MIL against mean- and max-pooling. The confident-tile count rule was adopted (notebook 04 §4–5) |
| Selective prediction and deferral | Refer uncertain samples to a reviewer instead of deciding them | Completed | Notebook 04: three-way triage; referral by confidence AURC 0.095 against 0.206 at random, better in 20 of 20 repetitions; [`figures/fig_risk_coverage_nested.png`](../figures/fig_risk_coverage_nested.png) |
| Evaluation against the reference standard | Patient-level sensitivity, specificity and deferral rate against expert microscopy (objective 3) | Completed | Notebook 04 §8: sensitivity 96.9% (95% CI 83.8–99.9%), specificity 96.7% (83.8–99.9%), 45.8% of samples referred (33.4–58.7%); Safety setting 100% (≥ 89.1%), 96.5%, 72.1% |
| Comparison with fixed rules and published results | Show what triage adds over simpler rules and the existing system | Completed | README, Results §2: any-detection rule 100% / 0%; highest tile 85.6% / 83.6%; tile count 79.4% / 86.7%; random referral 88.8% / 93.3% at the same workload. Published Schistoscope figures (Meulah et al., 2022) given as context, not a like-for-like comparison |
| Backend API | Serve stored results, analyse uploads, record reviews | Completed | [`api/`](../api/), [`api/README.md`](../api/README.md); 108 backend tests; [testing.md](testing.md#backend-unit-and-integration-tests) |
| Deployment | A public, working instance of the system | Completed, changed | Hugging Face Space at https://iamglory-bilharz.hf.space, scoring on ZeroGPU with ONNX on the CPU as fallback; [`deploy/README.md`](../deploy/README.md); [architecture.md](architecture.md) |
| Reviewer workflow | A technician decides the referred samples | Completed | Queue, Review workspace with the 12 highest-ranked tiles and an egg guide, versioned reviews with conflict detection; [queue](evidence/features/queue.jpg), [review](evidence/features/review-dt40-egg-guide.jpg), [reviews](evidence/features/reviews.jpg) |
| Review persistence | Reviews survive restarts of the server | Completed, changed | SQLite, plus a journal on a Hugging Face Storage Bucket from which the database is rebuilt at start-up ([architecture.md](architecture.md#settings-and-storage), `api/tests/test_journal.py`). On the live app once the bucket is attached ([`deploy/README.md`](../deploy/README.md)) |
| Decision setting | Choose between review workload and safety | Completed | Two settings (Efficiency, Safety) compared on the Performance page and chosen there for the app, per browser; [Performance](evidence/features/performance-local-setting-control.jpg); `frontend/src/setting.test.js`, end-to-end test "switching the decision setting" |
| Access control | Keep review data from casual access | Completed, changed | No accounts: an optional review access code and an admin token for export and deletion ([`design/README.md`](../design/README.md#first-design-iteration)) |

Screens of the built system, captured from the live app at 1440 × 900:
[landing](evidence/features/landing.jpg),
[queue](evidence/features/queue.jpg),
[DT40, referred](evidence/features/result-dt40-referred.jpg),
[DT02, negative](evidence/features/result-dt02-negative.jpg),
[DT29, positive](evidence/features/result-dt29-positive.jpg),
[review with the egg guide](evidence/features/review-dt40-egg-guide.jpg),
[reviews](evidence/features/reviews.jpg),
[performance](evidence/features/performance.jpg),
[analyse](evidence/features/analyse.jpg), and the
[server waking up](evidence/features/server-waking-up.jpg) (reproduced locally
with the backend stopped). The decision-setting control is not yet on the live
app, so [its screenshot](evidence/features/performance-local-setting-control.jpg)
is from a local build. The script is
[`frontend/scripts/capture-features.mjs`](../frontend/scripts/capture-features.mjs).

## Scope changes

**Frozen ImageNet features replaced by a trained egg detector.** Notebook 02
scored tiles with a linear probe on a frozen ImageNet ResNet50. Deferral by its
confidence was no better than deferral at random: AURC 0.2755 against 0.2829,
and the error rate did not fall with confidence across quintiles (23%, 23%, 38%,
38%, 15%). Notebook 03 therefore trained a detector on SHdataset_12k, whose
pixel masks give tile labels directly. With it, referral by confidence beat
random referral in 20 of 20 repetitions (notebook 04).

**Attention MIL evaluated, not adopted; the confident-tile count rule adopted
instead.** In notebook 02 (65 patients, 5 × 5-fold cross-validation), gated
attention MIL matched max-pooling on whole frames (AUROC 0.731 ± 0.042 against
0.723 ± 0.017) and fell well below it on tiles (0.641 ± 0.033 against
0.762 ± 0.019). Its attention was concentrated but pointed at different
instances in each fit (top-10 agreement 0.369 on frames, 0.163 on tiles): it
overfit 52 training bags. With the trained detector, a parameter-free rule,
counting tiles above a confidence threshold, separated patients well (AUROC
0.908 at 0.99 in notebook 04 §4) and gave the three-way triage directly.

**Deployment moved from Render to Hugging Face Spaces.** The API ran on
Render's free tier from 8 October (commit `2988068`). An analysis of one sample
needs about 0.9 GB of memory at its peak (861 MB measured) and about 30 seconds
of CPU on an 8-core laptop ([testing.md](testing.md#performance)), which
Render's free tier could not provide. A Hugging Face Space with ZeroGPU runs
the detector on a GPU (about 5 seconds per analysis on the server) and serves
the site, the API and the model from one server, with the CPU as fallback.

**Sign-in replaced by an optional review access code.** The system is a
research prototype with no user accounts and stores no personal data: a review
is a verdict, an optional note, an optional anonymous tester code and a time.
An access code, and an admin token for export and deletion, protect the review
data without collecting identities (commit `be7fc3c`;
[`design/README.md`](../design/README.md)).

**Reviewer interaction evaluated by simulation.** As the proposal's scope
defined, referred samples are assumed to be read correctly by a reviewer,
simulated against the expert labels; no human participants were involved. The
reviewer workflow is built and tested, but its effect on accuracy was not
measured with real reviewers.

## Research questions

| Question | Answer | Evidence |
| --- | --- | --- |
| 1. Do the public datasets support patient-level modelling? | Yes, one does. The diagnosis set on Zenodo (record 6467268) groups images by patient, has all 117 fields of view for each of 65 samples, and gives an expert egg count and diagnosis per sample (32 infected, 33 healthy). It is small, and nine infected patients have five eggs or fewer. SHdataset_12k has pixel masks for detector training and shares no patients with it. | Notebooks 01, 02 §1–2, 03 |
| 2. Learned or fixed aggregation? | Fixed. Attention MIL did not beat max-pooling at n = 65 and overfit; with a trained detector, the confident-tile count separates patients well and is transparent. | Notebook 02 §6–9; notebook 04 §4 |
| 3. Does confidence track correctness well enough for deferral? | Not with generic features (AURC 0.276 against 0.283 at random). With the trained detector, yes: AURC 0.095 against 0.206 at random, 8.0% error against 20.9% with half the samples referred, better in 20 of 20 repetitions. | Notebook 02 §11; notebook 04; README, Results §3 |
| 4. What are the specificity, sensitivity and coverage trade-offs? | Efficiency: 96.9% sensitivity, 96.7% specificity, 45.8% referred (54.2% decided automatically). Safety: 100% sensitivity (≥ 89.1%), 96.5% specificity, 72.1% referred. Preventing the one observed miss (DT40, 7 eggs) sends 26 percentage points more of the samples to review; the sensitivity intervals overlap. | Notebook 04 §8; README, Results §4 |

## The first mockups and the built screens

The seven mockups in [`design/`](../design/) are the first design iteration.

| Mockup | Built screen |
| --- | --- |
| Review queue | [Queue](evidence/features/queue.jpg) |
| All samples | Merged into the Queue's "All" filter |
| Sample record | [Result](evidence/features/result-dt40-referred.jpg) |
| Sample review | [Review workspace](evidence/features/review-dt40-egg-guide.jpg) |
| Batch report | [Reviews](evidence/features/reviews.jpg) with CSV export, and [Performance](evidence/features/performance.jpg) |
| Decision settings | The [decision setting](evidence/features/performance-local-setting-control.jpg), chosen on the Performance page |
| Sign-in | Not built: an optional review access code instead (see above) |
