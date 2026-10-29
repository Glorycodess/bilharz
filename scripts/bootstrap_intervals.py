"""Patient-level bootstrap intervals for the triage results of notebook 04.

Reruns the notebook's nested cross-validation from results/patient_scores.npz:
the triage rule and its safety-margin variant (section 7, "Confidence
intervals") and the risk-coverage comparison with nested threshold selection.
It stops if the notebook's point estimates do not reproduce. Each patient's
outcome is averaged over the 20 repeats; patients are then resampled with
replacement, within each class, and 95% percentile intervals are computed for
sensitivity, specificity, coverage rate and AURC. The exact Clopper-Pearson
intervals of the notebook are reported alongside.

Needs numpy, scipy and scikit-learn:

    python scripts/bootstrap_intervals.py [--resamples 10000] [--seed 0]

Writes docs/evidence/bootstrap.json.
"""
import argparse
import json
import platform
import sys
from pathlib import Path

import numpy as np
import scipy
import sklearn
from scipy.stats import beta
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import RepeatedStratifiedKFold

REPO = Path(__file__).resolve().parent.parent
SCORES = REPO / "results" / "patient_scores.npz"
OUT = REPO / "docs" / "evidence" / "bootstrap.json"

THRS = (0.9, 0.95, 0.99, 0.995, 0.999)
SPLITS, REPEATS, CV_SEED = 5, 20, 0
MARGIN = 2

# Figures as printed in notebook 04, to one decimal place of a percent (AURC to four places).
NOTEBOOK = {
    "triage": {"sensitivity": (96.9, 83.8, 99.9), "specificity": (96.7, 83.8, 99.9), "reviewed": (45.8, 33.4, 58.7)},
    "safety_margin": {"sensitivity": (100.0, 89.1, 100.0), "specificity": (96.5, 83.5, 99.9), "reviewed": (72.1, 59.6, 82.5)},
    "aurc": {"confidence": 0.0946, "random": 0.2065, "wins": 20},
}


def load():
    with np.load(SCORES) as z:
        S, y = z["S"], z["y"].astype(int)
    T = S.reshape(len(S), -1)
    return {t: (T > t).sum(1) for t in THRS}, y


def folds(y):
    rskf = RepeatedStratifiedKFold(n_splits=SPLITS, n_repeats=REPEATS, random_state=CV_SEED)
    return rskf.split(np.zeros((len(y), 1)), y)


def triage_runs(C, y, margin=None):
    """Per-patient outcomes over the repeats: decided correctly, and deferred (notebook 04, section 7)."""
    correct = np.zeros((REPEATS, len(y)))
    deferred = np.zeros((REPEATS, len(y)))
    for i, (tr, te) in enumerate(folds(y)):
        r, best = i // SPLITS, None
        for t in THRS:
            ctr = C[t][tr]
            pmin = ctr[y[tr] == 1].min()
            hi = ctr[y[tr] == 0].max()
            if margin is None:
                lo = pmin
            else:
                if pmin < margin:
                    continue
                lo = 1
            cov_tr = ((ctr < lo) | (ctr > hi)).mean()
            if best is None or cov_tr > best[0]:
                best = (cov_tr, t, lo, hi)
        if best is None:
            t, lo = THRS[0], 0
            hi = C[t][tr][y[tr] == 0].max()
        else:
            _, t, lo, hi = best
        s, yt = C[t][te], y[te]
        d = ~((s < lo) | (s > hi))
        pred = (s > hi) | (d & (yt == 1))
        correct[r, te] = pred == (yt == 1)
        deferred[r, te] = d
    return correct.mean(0), deferred.mean(0)


def nested_probabilities(C, y):
    """Held-out probability of infection per repeat, threshold chosen inside each fold (notebook 04, section 7)."""
    P = np.zeros((REPEATS, len(y)))
    for i, (tr, te) in enumerate(folds(y)):
        best = None
        for t in THRS:
            ctr = C[t][tr]
            lo, hi = ctr[y[tr] == 1].min(), ctr[y[tr] == 0].max()
            cov_tr = ((ctr < lo) | (ctr > hi)).mean()
            if best is None or cov_tr > best[0]:
                best = (cov_tr, t)
        x = np.log1p(C[best[1]]).reshape(-1, 1)
        model = LogisticRegression(C=1e6).fit(x[tr], y[tr])
        P[i // SPLITS, te] = model.predict_proba(x[te])[:, 1]
    return P


def notebook_aurc(P, y):
    """The notebook's estimate: random tie-breaking and random deferral drawn with seed 0."""
    def curve(err, conf, rng):
        order = np.lexsort((rng.random(len(err)), -conf))
        e = err[order]
        return np.cumsum(e) / np.arange(1, len(e) + 1)

    rng = np.random.default_rng(0)
    conf_aurc, rand_aurc = [], []
    for r in range(REPEATS):
        err = ((P[r] > 0.5).astype(int) != y).astype(float)
        conf = np.abs(P[r] - 0.5)
        conf_aurc.append(np.mean([curve(err, conf, rng) for _ in range(20)], axis=0).mean())
        rand_aurc.append(np.mean([curve(err, rng.random(len(y)), rng) for _ in range(50)], axis=0).mean())
        curve(err, -err, rng)  # the oracle curve: drawn only to keep the random stream as in the notebook
    conf_aurc, rand_aurc = np.array(conf_aurc), np.array(rand_aurc)
    return conf_aurc.mean(), rand_aurc.mean(), int((conf_aurc < rand_aurc).sum())


def expected_aurc(err, conf):
    """AURC averaged over every order of tied confidences: the value the notebook's random
    tie-breaking estimates. With all confidences tied it is random deferral, the mean error."""
    order = np.argsort(-conf, kind="stable")
    e, c = err[order], conf[order]
    starts = np.r_[0, np.flatnonzero(np.diff(c)) + 1]
    sizes = np.diff(np.r_[starts, len(c)])
    sums = np.add.reduceat(e, starts)
    group = np.repeat(np.arange(len(starts)), sizes)
    before = np.r_[0, np.cumsum(sums)[:-1]][group]
    k = np.arange(1, len(e) + 1)
    return ((before + (k - starts[group]) * (sums / sizes)[group]) / k).mean()


def aurc_pair(err, conf, idx):
    """Mean AURC over the repeats for the patients idx: by confidence, and at random."""
    by_conf = np.mean([expected_aurc(err[r, idx], conf[r, idx]) for r in range(REPEATS)])
    return by_conf, err[:, idx].mean()


def clopper_pearson(k, n, a=0.05):
    lo = 0.0 if k <= 0 else beta.ppf(a / 2, k, n - k + 1)
    hi = 1.0 if k >= n else beta.ppf(1 - a / 2, k + 1, n - k)
    return lo, hi


def percentile(values):
    lo, hi = np.percentile(values, [2.5, 97.5])
    return float(lo), float(hi)


def check(label, got, expected, places):
    if round(got, places) != round(expected, places):
        sys.exit(f"{label}: got {got:.{places + 2}f}, notebook 04 reports {expected}; stopping")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--resamples", type=int, default=10_000)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()
    if args.resamples < 5_000:
        parser.error("use at least 5,000 resamples")

    C, y = load()
    pos, neg = np.flatnonzero(y == 1), np.flatnonzero(y == 0)
    n = len(y)

    runs = {"triage": triage_runs(C, y), "safety_margin": triage_runs(C, y, margin=MARGIN)}
    point = {}
    for name, (correct, deferred) in runs.items():
        counts = {
            "sensitivity": (correct[pos].sum(), len(pos)),
            "specificity": (correct[neg].sum(), len(neg)),
            "reviewed": (deferred.sum(), n),
        }
        for metric, (k, m) in counts.items():
            lo, hi = clopper_pearson(k, m)
            expected = NOTEBOOK[name][metric]
            for label, got, want in zip(("estimate", "lower", "upper"), (k / m, lo, hi), expected):
                check(f"{name} {metric} {label}", 100 * got, want, 1)
        point[name] = counts

    P = nested_probabilities(C, y)
    nb_conf, nb_rand, wins = notebook_aurc(P, y)
    check("AURC by confidence", nb_conf, NOTEBOOK["aurc"]["confidence"], 4)
    check("AURC at random", nb_rand, NOTEBOOK["aurc"]["random"], 4)
    if wins != NOTEBOOK["aurc"]["wins"]:
        sys.exit(f"confidence beat random in {wins} repeats, notebook 04 reports 20; stopping")
    err = ((P > 0.5).astype(int) != y).astype(float)
    conf = np.abs(P - 0.5)

    rng = np.random.default_rng(args.seed)
    boot = {name: {m: np.empty(args.resamples) for m in ("sensitivity", "specificity", "coverage")} for name in runs}
    aurc = np.empty((args.resamples, 2))
    for b in range(args.resamples):
        bp, bn = rng.choice(pos, len(pos)), rng.choice(neg, len(neg))
        idx = np.r_[bp, bn]
        for name, (correct, deferred) in runs.items():
            boot[name]["sensitivity"][b] = correct[bp].mean()
            boot[name]["specificity"][b] = correct[bn].mean()
            boot[name]["coverage"][b] = 1 - deferred[idx].mean()
        aurc[b] = aurc_pair(err, conf, idx)

    results = {}
    for name, counts in point.items():
        k_rev, _ = counts["reviewed"]
        rows = {
            "sensitivity": counts["sensitivity"],
            "specificity": counts["specificity"],
            "coverage": (n - k_rev, n),
        }
        results[name] = {}
        for metric, (k, m) in rows.items():
            lo, hi = percentile(boot[name][metric])
            results[name][metric] = {
                "estimate": k / m,
                "bootstrap_95": [lo, hi],
                "clopper_pearson_95": list(clopper_pearson(k, m)),
                "bootstrap_degenerate": bool(np.ptp(boot[name][metric]) == 0),
            }

    all_idx = np.arange(n)
    exact_conf, exact_rand = aurc_pair(err, conf, all_idx)
    diff = aurc[:, 0] - aurc[:, 1]
    results["aurc"] = {
        "notebook": {"confidence": nb_conf, "random": nb_rand, "confidence_wins": wins},
        "confidence": {"estimate": exact_conf, "bootstrap_95": percentile(aurc[:, 0])},
        "random": {"estimate": exact_rand, "bootstrap_95": percentile(aurc[:, 1])},
        "difference": {
            "estimate": exact_conf - exact_rand,
            "bootstrap_95": percentile(diff),
            "share_of_resamples_below_zero": float((diff < 0).mean()),
        },
    }

    report = {
        "method": {
            "scores": "results/patient_scores.npz",
            "cross_validation": f"{REPEATS} x {SPLITS}-fold stratified, random_state={CV_SEED}",
            "thresholds": list(THRS),
            "safety_margin": MARGIN,
            "outcome_per_patient": "share of the 20 repeats in which the patient was decided correctly, or deferred",
            "bootstrap": f"patients resampled with replacement within each class ({len(pos)} infected, {len(neg)} healthy)",
            "resamples": args.resamples,
            "seed": args.seed,
            "interval": "95% percentile",
            "aurc": "AURC averaged over tied confidences (exact form of the notebook's random tie-breaking); random deferral is the mean error",
        },
        "environment": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "scikit-learn": sklearn.__version__,
        },
        "results": results,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2) + "\n")

    pct = lambda v: f"{100 * v:5.1f}%"
    print(f"Reproduced notebook 04: triage, safety margin, AURC {nb_conf:.4f} vs {nb_rand:.4f}, {wins} of 20")
    print(f"{args.resamples:,} stratified resamples, seed {args.seed}\n")
    for name in runs:
        print(name)
        for metric, r in results[name].items():
            (blo, bhi), (clo, chi) = r["bootstrap_95"], r["clopper_pearson_95"]
            print(f"  {metric:12s} {pct(r['estimate'])}   bootstrap {pct(blo)} - {pct(bhi)}"
                  f"   Clopper-Pearson {pct(clo)} - {pct(chi)}")
        print()
    a = results["aurc"]
    for key in ("confidence", "random", "difference"):
        lo, hi = a[key]["bootstrap_95"]
        print(f"AURC {key:11s} {a[key]['estimate']:+.4f}   bootstrap {lo:+.4f} - {hi:+.4f}")
    print(f"\nwrote {OUT.relative_to(REPO)}")


if __name__ == "__main__":
    main()
