"""Final sensitivity and specificity when the reviewer is not always right.

The triage results in docs/evidence/confusion.json assume that every referred
sample is read correctly ("final_with_correct_review"). This recomputes the
final figures for reviewers who read a referred infected sample correctly with
probability `a_inf` (the reviewer's sensitivity) and a referred healthy sample
correctly with probability `a_hea` (the reviewer's specificity):

    Sensitivity = (TP_auto + a_inf * Referred_infected) / N_infected
    Specificity = (TN_auto + a_hea * Referred_healthy)  / N_healthy

TP_auto and TN_auto are the samples decided correctly without review. The
inputs are the out-of-fold counts (20 x 5-fold cross-validation, nested
threshold selection, pooled over the 20 repeats) for the two rules evaluated
there: `triage` and `safety_margin`. The figures are expected values: no
interval is computed.

Standard library only:

    python scripts/reviewer_sensitivity.py [--a-inf 0.85 --a-hea 0.95]

Writes docs/evidence/reviewer_sensitivity.json.
"""
import argparse
import json
import platform
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SOURCE = REPO / "docs" / "evidence" / "confusion.json"
OUT = REPO / "docs" / "evidence" / "reviewer_sensitivity.json"

RULES = ("triage", "safety_margin")
ACCURACIES = (1.00, 0.95, 0.90, 0.85, 0.80)
REPEATS = 20  # the cross-validation repeats pooled in confusion.json


def inputs(confusion: dict, rule: str) -> dict:
    """One rule's three-way counts, checked against the figures already in confusion.json."""
    block = confusion["out_of_fold"][rule]
    inf = block["three_way"]["infected"]["counts"]
    hea = block["three_way"]["healthy"]["counts"]
    counts = {
        "infected": inf["negative"] + inf["referred"] + inf["positive"],
        "healthy": hea["negative"] + hea["referred"] + hea["positive"],
        "tp_auto": inf["positive"],
        "fn_auto": inf["negative"],
        "referred_infected": inf["referred"],
        "tn_auto": hea["negative"],
        "fp_auto": hea["positive"],
        "referred_healthy": hea["referred"],
    }
    auto, final = block["automatic_only_2x2"], block["final_with_correct_review"]
    expected = {
        "automatic TP": (counts["tp_auto"], auto["TP"]),
        "automatic FN": (counts["fn_auto"], auto["FN"]),
        "automatic TN": (counts["tn_auto"], auto["TN"]),
        "automatic FP": (counts["fp_auto"], auto["FP"]),
        "infected total": (counts["infected"], block["three_way"]["infected"]["total"]),
        "healthy total": (counts["healthy"], block["three_way"]["healthy"]["total"]),
    }
    at_one = outcome(counts, 1.0, 1.0)
    expected["sensitivity with correct review"] = (at_one["sensitivity"], final["sensitivity"])
    expected["specificity with correct review"] = (at_one["specificity"], final["specificity"])
    for name, (got, want) in expected.items():
        if abs(got - want) > 1e-12:
            sys.exit(f"{rule}: {name} is {got}, but confusion.json has {want}; not writing {OUT.name}")
    return counts


def outcome(c: dict, a_inf: float, a_hea: float) -> dict:
    """Expected final counts and rates for reviewer accuracies a_inf and a_hea."""
    tp = c["tp_auto"] + a_inf * c["referred_infected"]
    tn = c["tn_auto"] + a_hea * c["referred_healthy"]
    fn, fp = c["infected"] - tp, c["healthy"] - tn
    return {
        "reviewer_sensitivity": a_inf,
        "reviewer_specificity": a_hea,
        "sensitivity": tp / c["infected"],
        "specificity": tn / c["healthy"],
        # Per repeat: one pass over the 65 patients (32 infected, 33 healthy).
        "missed_infected_per_repeat": fn / REPEATS,
        "false_positives_per_repeat": fp / REPEATS,
    }


def crossover(a: dict, b: dict, auto: str, referred: str, total: str) -> float | None:
    """The reviewer accuracy at which rules a and b give the same final rate, if it lies in [0, 1]."""
    slope = a[referred] / a[total] - b[referred] / b[total]
    if slope == 0:
        return None
    x = (b[auto] / b[total] - a[auto] / a[total]) / slope
    return x if 0 <= x <= 1 else None


def pct(x: float) -> str:
    return f"{100 * x:5.1f}%"


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--a-inf", type=float, default=0.85, help="example: reviewer sensitivity (default 0.85)")
    parser.add_argument("--a-hea", type=float, default=0.95, help="example: reviewer specificity (default 0.95)")
    args = parser.parse_args()
    for value in (args.a_inf, args.a_hea):
        if not 0 <= value <= 1:
            parser.error("accuracies are between 0 and 1")

    confusion = json.loads(SOURCE.read_text())
    counts = {rule: inputs(confusion, rule) for rule in RULES}
    results = {
        rule: {
            "inputs": counts[rule],
            "same_accuracy": [outcome(counts[rule], a, a) for a in ACCURACIES],
            "different_accuracy_example": outcome(counts[rule], args.a_inf, args.a_hea),
        }
        for rule in RULES
    }
    a, b = counts["safety_margin"], counts["triage"]
    crossings = {
        "sensitivity": crossover(a, b, "tp_auto", "referred_infected", "infected"),
        "specificity": crossover(a, b, "tn_auto", "referred_healthy", "healthy"),
    }

    print("Final sensitivity / specificity by reviewer accuracy (out-of-fold, pooled over 20 repeats)\n")
    print(f"{'Reviewer accuracy':<26}" + "".join(f"{rule:>26}" for rule in RULES))
    rows = [(f"{pct(x)} (both classes)", i) for i, x in enumerate(ACCURACIES)]
    for name, i in rows:
        cells = (results[r]["same_accuracy"][i] for r in RULES)
        print(f"{name:<26}" + "".join(f"{pct(o['sensitivity']) + ' / ' + pct(o['specificity']):>26}" for o in cells))
    example = f"{pct(args.a_inf).strip()} inf, {pct(args.a_hea).strip()} healthy"
    cells = (results[r]["different_accuracy_example"] for r in RULES)
    print(f"{example:<26}" + "".join(f"{pct(o['sensitivity']) + ' / ' + pct(o['specificity']):>26}" for o in cells))
    for measure, x in crossings.items():
        where = f"at reviewer accuracy {pct(x).strip()}" if x is not None else "nowhere between 0% and 100%"
        print(f"\nThe two rules' final {measure} cross {where}.")

    report = {
        "description": "Final sensitivity and specificity of triage when the reviewer of referred samples is "
        "not always right. Expected values from the out-of-fold three-way counts; no intervals.",
        "source": "docs/evidence/confusion.json, out_of_fold.<rule>: three_way counts and automatic_only_2x2",
        "formula": {
            "sensitivity": "(TP_auto + a_inf * referred_infected) / infected",
            "specificity": "(TN_auto + a_hea * referred_healthy) / healthy",
            "a_inf": "probability the reviewer reads a referred infected sample as infected",
            "a_hea": "probability the reviewer reads a referred healthy sample as healthy",
        },
        "basis": "20 x 5-fold stratified cross-validation, nested threshold selection; counts pooled over the "
        "20 repeats (1,300 decisions: 640 infected, 660 healthy). Per-repeat figures divide by 20.",
        "assumptions": [
            "Every reviewer has the same accuracy on every referred sample of a class, independent of the sample. "
            "Referred samples are the hard ones (few eggs), so a real reviewer's accuracy on them may be lower "
            "than their accuracy in general.",
            "Automatic decisions are unchanged: the reviewer sees only referred samples.",
            "The rules are those of the cross-validation (triage and safety_margin), not the deployed settings "
            "(efficiency and safety), whose figures in confusion.json are in-sample only.",
        ],
        "accuracies": list(ACCURACIES),
        "rules": results,
        "crossover_safety_margin_vs_triage": {
            **crossings,
            "meaning": "the reviewer accuracy below which safety_margin's final rate is lower than triage's "
            "(null if the rates do not cross between 0 and 1)",
        },
        "environment": {"python": platform.python_version()},
    }
    OUT.write_text(json.dumps(report, indent=2) + "\n")
    print(f"\nWrote {OUT.relative_to(REPO)}")


if __name__ == "__main__":
    main()
