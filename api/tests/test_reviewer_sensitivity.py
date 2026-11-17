"""scripts/reviewer_sensitivity.py: the formula, its check against confusion.json, and the crossover."""
import copy
import importlib.util
import json

import pytest

from bilharz.settings import REPO_DIR

spec = importlib.util.spec_from_file_location("reviewer_sensitivity", REPO_DIR / "scripts" / "reviewer_sensitivity.py")
rs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rs)

CONFUSION = json.loads(rs.SOURCE.read_text())


@pytest.mark.parametrize("rule", rs.RULES)
def test_correct_review_reproduces_confusion_json(rule):
    final = CONFUSION["out_of_fold"][rule]["final_with_correct_review"]
    o = rs.outcome(rs.inputs(CONFUSION, rule), 1.0, 1.0)
    assert o["sensitivity"] == pytest.approx(final["sensitivity"])
    assert o["specificity"] == pytest.approx(final["specificity"])
    assert o["missed_infected_per_repeat"] == pytest.approx(final["FN"] / 20)
    assert o["false_positives_per_repeat"] == pytest.approx(final["FP"] / 20)


def test_hand_computed_values_at_80_percent():
    triage = rs.outcome(rs.inputs(CONFUSION, "triage"), 0.8, 0.8)
    assert triage["sensitivity"] == pytest.approx((248 + 0.8 * 372) / 640)
    assert triage["specificity"] == pytest.approx((414 + 0.8 * 224) / 660)
    margin = rs.outcome(rs.inputs(CONFUSION, "safety_margin"), 0.8, 0.8)
    assert margin["sensitivity"] == pytest.approx((140 + 0.8 * 500) / 640)
    assert margin["specificity"] == pytest.approx((200 + 0.8 * 437) / 660)


def test_different_accuracies_move_only_their_own_class():
    c = rs.inputs(CONFUSION, "triage")
    low_inf, low_hea = rs.outcome(c, 0.5, 1.0), rs.outcome(c, 1.0, 0.5)
    perfect = rs.outcome(c, 1.0, 1.0)
    assert low_inf["specificity"] == perfect["specificity"] and low_inf["sensitivity"] < perfect["sensitivity"]
    assert low_hea["sensitivity"] == perfect["sensitivity"] and low_hea["specificity"] < perfect["specificity"]


def test_sensitivity_crossover():
    a, b = rs.inputs(CONFUSION, "safety_margin"), rs.inputs(CONFUSION, "triage")
    x = rs.crossover(a, b, "tp_auto", "referred_infected", "infected")
    assert x == pytest.approx(108 / 128)
    assert rs.outcome(a, x, x)["sensitivity"] == pytest.approx(rs.outcome(b, x, x)["sensitivity"])
    assert rs.crossover(a, b, "tn_auto", "referred_healthy", "healthy") is None


def test_counts_that_do_not_reproduce_stop_the_script():
    tampered = copy.deepcopy(CONFUSION)
    tampered["out_of_fold"]["triage"]["three_way"]["infected"]["counts"]["referred"] -= 1
    tampered["out_of_fold"]["triage"]["three_way"]["infected"]["counts"]["negative"] += 1
    with pytest.raises(SystemExit):
        rs.inputs(tampered, "triage")
