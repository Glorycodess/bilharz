"""The deployed rule reproduces the research counts on the 65 stored samples."""
from collections import Counter

import pytest

from bilharz.samples import SampleStore
from bilharz.settings import load_settings
from bilharz.triage import decide, load_config


@pytest.fixture(scope="module")
def setup():
    s = load_settings()
    return load_config(s.config_path), SampleStore(s.scores_path, s.manifest_path)


def tally(config, store, name):
    rule = config.rule(name)
    return Counter(decide(store.count(sid, rule), rule) for sid in store.ids)


def test_safety_counts(setup):
    assert tally(*setup, "safety") == {"referred": 48, "negative": 10, "positive": 7}


def test_efficiency_counts(setup):
    assert tally(*setup, "efficiency") == {"referred": 33, "negative": 20, "positive": 12}


@pytest.mark.parametrize("setting", ["safety", "efficiency"])
@pytest.mark.parametrize("sid,expected", [("DT40", "referred"), ("DT29", "positive"), ("DT02", "negative")])
def test_known_samples(setup, setting, sid, expected):
    config, store = setup
    rule = config.rule(setting)
    assert decide(store.count(sid, rule), rule) == expected


def test_default_is_safety(setup):
    config, _ = setup
    assert config.rule(None).name == "safety"


def test_rule_boundaries(setup):
    rule = setup[0].rule("safety")
    assert decide(0, rule) == "negative"
    assert decide(1, rule) == "referred"
    assert decide(rule.flag_above, rule) == "referred"
    assert decide(rule.flag_above + 1, rule) == "positive"
