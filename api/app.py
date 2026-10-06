"""
Bilharz — patient-level triage API (deployment mockup).

Exposes the decision path that the capstone is about: a sample is scored,
and the system either decides it or defers it to a human reviewer.
"""
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(
    title="Bilharz API",
    version="0.3.0",
    description=(
        "Patient-level triage for urogenital schistosomiasis.\n\n"
        "Each sample arrives as 117 field-of-view images. The model scores every "
        "region, aggregates them into one patient-level probability, and either "
        "returns a verdict or **defers** the sample to a human reviewer when the "
        "probability falls inside the abstention band."
    ),
)


class Decision(str, Enum):
    negative = "negative"
    positive = "positive"
    defer = "defer"


class Region(BaseModel):
    rank: int = Field(..., example=1)
    frame: str = Field(..., example="frame_041.jpg")
    tile: int = Field(..., example=7)
    score: float = Field(..., example=0.061)


class Prediction(BaseModel):
    sample_id: str = Field(..., example="DT29")
    probability: float = Field(..., ge=0, le=1, example=0.52)
    decision: Decision
    abstention_band: list[float] = Field(..., example=[0.40, 0.60])
    regions_examined: int = Field(..., example=1404)
    aggregation: str = Field(..., example="top-k mean, k=500")
    top_regions: list[Region]
    model_version: str = Field(..., example="bilharz-v0.3")


class ReviewDecision(BaseModel):
    verdict: Decision = Field(..., example="positive")
    reviewer: str = Field(..., example="G. Paul")
    notes: Optional[str] = Field(None, example="Two clear ova in region 1.")


class Settings(BaseModel):
    band_low: float = Field(0.40, ge=0, le=1)
    band_high: float = Field(0.60, ge=0, le=1)


# in-memory store (mockup) 
BAND = [0.40, 0.60]
SAMPLES = {
    "DT29": 0.52, "DT04": 0.48, "DT17": 0.53, "DT33": 0.49, "DT08": 0.51,
    "DT12": 0.96, "DT45": 0.94, "DT02": 0.02, "DT19": 0.03, "DT51": 0.01,
}
DECISIONS: dict[str, dict] = {}


def classify(p: float) -> Decision:
    if p < BAND[0]:
        return Decision.negative
    if p > BAND[1]:
        return Decision.positive
    return Decision.defer


def regions_for(sample_id: str, n: int = 12) -> list[Region]:
    base = sum(ord(c) for c in sample_id)
    return [
        Region(rank=i + 1,
               frame=f"frame_{(base + i * 7) % 117:03d}.jpg",
               tile=(base + i) % 12,
               score=round(0.062 - i * 0.0019, 4))
        for i in range(n)
    ]


@app.get("/health", tags=["system"], summary="Service health")
def health():
    return {"status": "ok", "model_version": "bilharz-v0.3",
            "time": datetime.now(timezone.utc).isoformat(timespec="seconds")}


@app.get("/settings", response_model=Settings, tags=["system"],
         summary="Current abstention band")
def get_settings():
    """The band that decides autonomy. Widening it refers more samples to review."""
    return Settings(band_low=BAND[0], band_high=BAND[1])


@app.put("/settings", response_model=Settings, tags=["system"],
         summary="Update abstention band")
def put_settings(s: Settings):
    if s.band_low >= s.band_high:
        raise HTTPException(422, "band_low must be below band_high")
    BAND[0], BAND[1] = s.band_low, s.band_high
    return s


@app.get("/samples/{sample_id}/predict", response_model=Prediction,
         tags=["triage"], summary="Score a sample and return a verdict or a deferral")
def predict(sample_id: str):
    """
    Returns the patient-level probability and one of three decisions.

    A `defer` decision is not a failure — it is the system declining to guess,
    and is the behaviour this project exists to produce.
    """
    if sample_id not in SAMPLES:
        raise HTTPException(404, f"unknown sample {sample_id}")
    p = SAMPLES[sample_id]
    return Prediction(
        sample_id=sample_id, probability=p, decision=classify(p),
        abstention_band=list(BAND), regions_examined=1404,
        aggregation="top-k mean, k=500", top_regions=regions_for(sample_id),
        model_version="bilharz-v0.3",
    )


@app.get("/review/queue", tags=["review"],
         summary="Samples awaiting human review")
def queue():
    items = [{"sample_id": s, "probability": p}
             for s, p in SAMPLES.items()
             if classify(p) is Decision.defer and s not in DECISIONS]
    return {"count": len(items), "abstention_band": list(BAND), "items": items}


@app.get("/review/{sample_id}/regions", response_model=list[Region],
         tags=["review"], summary="Regions a reviewer should inspect, ranked")
def review_regions(sample_id: str):
    if sample_id not in SAMPLES:
        raise HTTPException(404, f"unknown sample {sample_id}")
    return regions_for(sample_id)


@app.post("/review/{sample_id}/decision", tags=["review"],
          summary="Record a reviewer's verdict")
def record_decision(sample_id: str, d: ReviewDecision):
    """Reviewer verdicts are stored for audit. They are not used to retrain."""
    if sample_id not in SAMPLES:
        raise HTTPException(404, f"unknown sample {sample_id}")
    rec = {"sample_id": sample_id, "verdict": d.verdict,
           "reviewer": d.reviewer, "notes": d.notes,
           "model_probability": SAMPLES[sample_id],
           "decided_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "used_for_training": False}
    DECISIONS[sample_id] = rec
    return rec
