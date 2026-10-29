# Scope: the proposal and what was built

This document maps the approved proposal to the delivered system: each planned
feature and its status, where each item of the evaluation objective is
delivered, the one deviation from the approved objectives with the evidence
behind it, the answers to the research questions, and the first mockups against
the built screens.
Numbers come from the notebooks, the [README](../README.md) and
[testing.md](testing.md).

## Objectives

From the approved proposal:

1. To inspect, document and assess whether the available public datasets
   provide the sample-level grouping, complete field-of-view image sets and
   reference labels required for patient-level modelling.
2. To develop a patient-level diagnostic system combining egg detection, gated
   attention-based Multiple Instance Learning over the resulting bags, and a
   selective prediction layer capable of deferring high-ambiguity samples to
   human review.
3. To evaluate the system using nested cross-validation and non-parametric
   bootstrapping against an independent expert microscopist reference
   standard, reporting patient-level specificity, sensitivity, coverage rate,
   risk-coverage curves and the area under the risk-coverage curve (AURC).

Objective 1 is met. Objective 2 is met with one deviation: gated attention MIL
was built and evaluated but not adopted, and a trained detector with a
confident-tile count rule replaced it ([deviation](#deviation-from-the-approved-objectives)).
Objective 3 is met item by item ([below](#objective-3-item-by-item)). The
comparison with fixed aggregation rules and with published results goes beyond
the approved objectives.

## Features

| Planned feature | Intended purpose | Current status | Evidence |
| --- | --- | --- | --- |
| Dataset inspection | Establish whether a public dataset supports patient-level modelling (objective 1) | Completed | Notebook 01 (download, MD5 check, 65 samples × 117 images); notebook 02 §1–2 (structure asserted, `microscopist_result.csv` with egg count and diagnosis); notebook 03 (SHdataset_12k: 12,051 images with pixel masks) |
| Egg detection | Score each field-of-view region for eggs (objective 2) | Completed | Notebook 03: ResNet18 fine-tuned on 32,277 tiles, validation AUROC 0.985, average precision 0.957 ([development notes](#development-notes)) |
| Gated attention MIL | Combine a sample's bag of detections into one patient score (objective 2) | Built and evaluated, not adopted | Notebook 02 §6–9: frames AUROC 0.731 ± 0.042 against max-pooling 0.723 ± 0.017; tiles 0.641 ± 0.033 against 0.762 ± 0.019. Replaced by the trained detector and the confident-tile count rule (notebook 03; notebook 04 §4–5) |
| Selective prediction and deferral | Defer high-ambiguity samples to a reviewer instead of deciding them (objective 2) | Completed | Notebook 04: three-way triage; referral by confidence AURC 0.095 against 0.206 at random, better in 20 of 20 repetitions; [`figures/fig_risk_coverage_nested.png`](../figures/fig_risk_coverage_nested.png) |
| Evaluation against the reference standard | Nested cross-validation and bootstrapping; patient-level sensitivity, specificity, coverage rate, risk-coverage curves and AURC against expert microscopy (objective 3) | Completed | See [objective 3, item by item](#objective-3-item-by-item) |
| Comparison with fixed rules and published results | Show what triage adds over simpler rules and the existing system; beyond the approved objectives | Completed | README, Results §2: any-detection rule 100% / 0%; highest tile 85.6% / 83.6%; tile count 79.4% / 86.7%; random referral 88.8% / 93.3% at the same workload. Published Schistoscope figures (Meulah et al., 2022) given as context, not a like-for-like comparison |
| Backend API | Serve stored results, analyse uploads, record reviews | Completed | [`api/`](../api/), [`api/README.md`](../api/README.md); 108 backend tests; [testing.md](testing.md#backend-unit-and-integration-tests) |
| Deployment | A public, working instance of the system | Completed | Hugging Face Space at https://iamglory-bilharz.hf.space, scoring on ZeroGPU with ONNX on the CPU as fallback; [`deploy/README.md`](../deploy/README.md); [architecture.md](architecture.md) |
| Reviewer workflow | A technician decides the referred samples | Completed | Queue, Review workspace with the 12 highest-ranked tiles and an egg guide, versioned reviews with conflict detection; [queue](evidence/features/queue.jpg), [review](evidence/features/review-dt40-egg-guide.jpg), [reviews](evidence/features/reviews.jpg) |
| Review persistence | Reviews survive restarts of the server | Completed | SQLite, plus a journal on a Hugging Face Storage Bucket from which the database is rebuilt at start-up ([architecture.md](architecture.md#settings-and-storage), `api/tests/test_journal.py`). On the live app once the bucket is attached ([`deploy/README.md`](../deploy/README.md)) |
| Decision setting | Choose between review workload and safety | Completed | Two settings (Efficiency, Safety) compared on the Performance page and chosen there for the app, per browser; [Performance](evidence/features/performance-local-setting-control.jpg); `frontend/src/setting.test.js`, end-to-end test "switching the decision setting" |
| Access control | Keep review data from casual access | Completed | An optional review access code for reading and writing reviews, and an admin token for export and deletion ([architecture.md](architecture.md#settings-and-storage)) |

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

## Objective 3, item by item

All figures are for the 65 patients of the diagnosis dataset, against the
microscopist's diagnosis in `microscopist_result.csv`, with every threshold and
cut-off chosen inside the cross-validation folds.

| Promised item | Delivered | Where |
| --- | --- | --- |
| Nested cross-validation | 20 repeats of stratified 5-fold cross-validation, split by patient; the confident-tile threshold and both cut-offs chosen from training patients only in each fold | Notebook 04, the sections after §5 (§8 summarises them); README, Validation |
| Non-parametric bootstrapping | Patient-level bootstrap, stratified by class, 10,000 resamples, seed 0, over the per-patient cross-validation outcomes; 95% percentile intervals reported next to exact Clopper–Pearson intervals | [`scripts/bootstrap_intervals.py`](../scripts/bootstrap_intervals.py), [`evidence/bootstrap.json`](evidence/bootstrap.json), [testing.md](testing.md#bootstrap-intervals) |
| Specificity | 96.7% (Clopper–Pearson 83.8–99.9%, bootstrap 90.3–100%); Safety setting 96.5% | Notebook 04, "Confidence intervals", and §8; [testing.md](testing.md#bootstrap-intervals) |
| Sensitivity | 96.9% (Clopper–Pearson 83.8–99.9%, bootstrap 90.6–100%); Safety setting 100% (Clopper–Pearson 89.1–100%) | Notebook 04, "Confidence intervals", and §8; [testing.md](testing.md#bootstrap-intervals) |
| Coverage rate | 54.2% of samples decided automatically, 45.8% referred (Clopper–Pearson for coverage 41.3–66.6%, bootstrap 42.8–65.3%); Safety setting 27.9% decided automatically | Notebook 04, "Confidence intervals", and §8; [testing.md](testing.md#bootstrap-intervals) |
| Risk-coverage curves | Confidence against random deferral and the oracle, with nested threshold selection | Notebook 04, "Deferral vs random, with nested threshold selection"; [`figures/fig_risk_coverage_nested.png`](../figures/fig_risk_coverage_nested.png); README, Results §3 |
| AURC | 0.095 by confidence against 0.206 at random, better in 20 of 20 repeats; bootstrap interval for the difference −0.174 to −0.043 | Notebook 04, "Deferral vs random, with nested threshold selection"; [testing.md](testing.md#bootstrap-intervals) |

## Deviation from the approved objectives

**Gated attention MIL: built and evaluated, not adopted.** Objective 2 promised gated attention-based Multiple Instance Learning over the
bags of detections. It was built and evaluated in notebook 02 (65 patients,
5 × 5-fold cross-validation). On whole frames it did no better than max-pooling
(AUROC 0.731 ± 0.042 against 0.723 ± 0.017), and on tiles it fell well below it
(0.641 ± 0.033 against 0.762 ± 0.019). Its attention was concentrated but
pointed at different instances in each fit (top-10 agreement 0.369 on frames,
0.163 on tiles): it overfit 52 training bags. It was replaced by the trained egg
detector of notebook 03 and a parameter-free rule, counting tiles above a
confidence threshold, which separated patients well (AUROC 0.908 at 0.99 in
notebook 04 §4) and gave the three-way triage directly. The selective prediction
layer of objective 2 is built on that count.

## Development notes

**How the egg detector was arrived at.** Notebook 02 scored tiles with a linear probe on a frozen ImageNet ResNet50. Deferral by its
confidence was no better than deferral at random: AURC 0.2755 against 0.2829,
and the error rate did not fall with confidence across quintiles (23%, 23%, 38%,
38%, 15%). Notebook 03 therefore trained a detector on SHdataset_12k, whose
pixel masks give tile labels directly. With it, referral by confidence beat
random referral in 20 of 20 repetitions (notebook 04).

**Reviewer interaction evaluated by simulation.** As the proposal's scope
defined, referred samples are assumed to be read correctly by a reviewer,
simulated against the expert labels; no human participants were involved. The
reviewer workflow is built and tested, but its effect on accuracy was not
measured with real reviewers.

## Research questions

| Question | Answer | Evidence |
| --- | --- | --- |
| 1. Do the public datasets support patient-level modelling? | Yes, one does. The diagnosis set on Zenodo (record 6467268) groups images by patient, has all 117 fields of view for each of 65 samples, and gives an expert egg count and diagnosis per sample (32 infected, 33 healthy). It is small, and nine infected patients have five eggs or fewer. SHdataset_12k has pixel masks for detector training and shares no patients with it. | Notebooks 01, 02 §1–2, 03 |
| 2. Learned or fixed aggregation? | Fixed. Gated attention MIL did not beat max-pooling at n = 65 and overfit; with a trained detector, the confident-tile count separates patients well and is transparent. | Notebook 02 §6–9; notebook 04 §4 |
| 3. Does confidence track correctness well enough for deferral? | Not with generic features (AURC 0.276 against 0.283 at random). With the trained detector, yes: AURC 0.095 against 0.206 at random, 8.0% error against 20.9% with half the samples referred, better in 20 of 20 repetitions. | Notebook 02 §11; notebook 04; README, Results §3 |
| 4. What are the specificity, sensitivity and coverage trade-offs? | Efficiency: 96.9% sensitivity, 96.7% specificity, 45.8% referred (54.2% decided automatically). Safety: 100% sensitivity (≥ 89.1%), 96.5% specificity, 72.1% referred. Preventing the one observed miss (DT40, 7 eggs) sends 26 percentage points more of the samples to review; the sensitivity intervals overlap. | Notebook 04 §8; README, Results §4 |

## The first mockups and the built screens

The mockups in [`design/`](../design/) are the first design iteration, mapped
here to the built screens.

| Mockup | Built screen |
| --- | --- |
| Review queue | [Queue](evidence/features/queue.jpg) |
| All samples | Merged into the Queue's "All" filter |
| Sample record | [Result](evidence/features/result-dt40-referred.jpg) |
| Sample review | [Review workspace](evidence/features/review-dt40-egg-guide.jpg) |
| Batch report | [Reviews](evidence/features/reviews.jpg) with CSV export, and [Performance](evidence/features/performance.jpg) |
| Decision settings | The [decision setting](evidence/features/performance-local-setting-control.jpg), chosen on the Performance page |
