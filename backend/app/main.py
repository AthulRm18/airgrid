"""
AirGrid backend — FastAPI app.

Run locally:
    uvicorn app.main:app --reload --port 8000

Endpoints:
    GET  /api/hotspots          -> ranked list of H3 cells with severity
    POST /api/citizen-report    -> submit a photo/voice/text report
    GET  /api/health            -> liveness check
"""
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.services import openaq_client, gemini_client
from app.services.h3_utils import latlng_to_cell, bin_points
from app.services.hotspot_detection import classify_cell, rank_hotspots

app = FastAPI(title="AirGrid API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten before real deployment
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory store for the hackathon build. Swap for Firestore before demo day
# if there's time — the shape is already Firestore-document-friendly.
CITIZEN_REPORTS: list[dict] = []
ALERTS: dict[str, dict] = {}  # keyed by alert id, populated from /api/hotspots on demand


class CitizenReport(BaseModel):
    lat: float
    lng: float
    text: str | None = None
    haze_score: float | None = None  # filled in by Gemini vision scoring, 0-1
    source: str = "text"  # "text" | "voice" | "photo"


class AcknowledgeIn(BaseModel):
    h3_cell: str
    action_taken: str
    officer_name: str | None = None


@app.get("/api/health")
async def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


@app.post("/api/citizen-report")
async def submit_report(report: CitizenReport):
    """
    Ingest a text/SMS/voice-transcript citizen report. If no haze_score is
    supplied, Gemini classifies the text (translate + infer severity) —
    this is the DETECT step for non-photo reports. For photo reports, use
    POST /api/citizen-report/photo instead.
    """
    record = report.model_dump()
    gemini_result = None
    if record["haze_score"] is None and report.text:
        gemini_result = gemini_client.classify_text_report(report.text)
        record["haze_score"] = gemini_result["haze_score"]

    record["id"] = str(uuid.uuid4())
    record["h3_cell"] = latlng_to_cell(report.lat, report.lng)
    record["submitted_at"] = datetime.now(timezone.utc).isoformat()
    record["synced"] = True  # would be False if queued offline client-side
    record["gemini_classification"] = gemini_result
    CITIZEN_REPORTS.append(record)
    return record


@app.post("/api/citizen-report/photo")
async def submit_photo_report(
    lat: float = Form(...), lng: float = Form(...), file: UploadFile = File(...)
):
    """Photo variant of the report endpoint — Gemini multimodal scores the
    image directly (haze severity, likely source) rather than trusting a
    client-supplied score."""
    image_bytes = await file.read()
    scoring = gemini_client.score_photo(image_bytes, mime_type=file.content_type or "image/jpeg")

    record = {
        "id": str(uuid.uuid4()),
        "lat": lat, "lng": lng,
        "h3_cell": latlng_to_cell(lat, lng),
        "source": "photo",
        "haze_score": scoring["haze_score"],
        "gemini_classification": scoring,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "synced": True,
    }
    CITIZEN_REPORTS.append(record)
    return record


@app.get("/api/hotspots")
async def get_hotspots(bbox: str = "76.8,28.4,77.6,28.9"):
    """
    The core endpoint: fuses sensor readings + citizen reports into
    ranked H3 hotspot cells. This is what the dashboard map renders.
    """
    sensor_readings = await openaq_client.fetch_all_readings(bbox)
    sensor_bins = bin_points(
        [{"lat": r["lat"], "lng": r["lng"], **r} for r in sensor_readings if r["lat"]]
    )
    sensor_coverage = set(sensor_bins.keys())

    citizen_bins = bin_points(CITIZEN_REPORTS) if CITIZEN_REPORTS else {}

    all_cells = sensor_coverage | set(citizen_bins.keys())

    results = []
    for cell in all_cells:
        sensor_pm25 = None
        if cell in sensor_bins:
            sensor_pm25 = max(p["pm25"] for p in sensor_bins[cell])

        # Placeholder until Earth Engine integration lands — random-ish but
        # deterministic per cell so the demo is stable across refreshes.
        satellite_anomaly_score = _mock_satellite_score(cell)

        reports = citizen_bins.get(cell, [])
        classified = classify_cell(
            cell, sensor_pm25, satellite_anomaly_score, reports, sensor_coverage
        )
        results.append(classified)

    ranked = rank_hotspots(results)
    return {
        "count": len(ranked),
        "hotspots": [
            {
                "h3_cell": c.h3_cell,
                "lat": c.lat,
                "lng": c.lng,
                "severity": c.severity.value,
                "aqi_estimate": c.aqi_estimate,
                "sensor_pm25": c.sensor_pm25,
                "citizen_report_count": len(c.citizen_reports),
                "explanation": c.explanation,
            }
            for c in ranked
        ],
    }


@app.get("/api/hotspots/{h3_cell}/recommendation")
async def get_recommendation(h3_cell: str):
    """
    RECOMMEND step: on-demand, generate a Gemini-written brief for one
    hotspot cell — called when an authority opens a specific alert in the
    dashboard, rather than for every cell on every /api/hotspots poll
    (keeps the hotspot list endpoint fast and cheap).
    """
    hotspots = await get_hotspots()
    match = next((h for h in hotspots["hotspots"] if h["h3_cell"] == h3_cell), None)
    if match is None:
        raise HTTPException(status_code=404, detail="cell not currently a hotspot")

    recommendation = gemini_client.generate_authority_recommendation(match)
    return {**match, "recommendation": recommendation}


@app.post("/api/hotspots/acknowledge")
async def acknowledge_hotspot(body: AcknowledgeIn):
    """
    ACKNOWLEDGE step: authority confirms they've reviewed and acted on a
    hotspot. Closes the Detect -> Recommend -> Notify -> Acknowledge loop.
    """
    ALERTS[body.h3_cell] = {
        "h3_cell": body.h3_cell,
        "action_taken": body.action_taken,
        "officer_name": body.officer_name,
        "acknowledged_at": datetime.now(timezone.utc).isoformat(),
    }
    return ALERTS[body.h3_cell]


@app.get("/api/hotspots/acknowledged")
async def list_acknowledged():
    return list(ALERTS.values())


def _mock_satellite_score(cell: str) -> float:
    """Deterministic stand-in for Earth Engine Sentinel-5P aerosol index
    until that integration is wired in. Replace with a real GEE query."""
    import hashlib
    h = int(hashlib.sha256(cell.encode()).hexdigest(), 16)
    return (h % 100) / 100.0
