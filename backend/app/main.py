"""
VIGIL backend — FastAPI app.

Run locally:
    uvicorn app.main:app --reload --port 8000

Core loop endpoints:
    DETECT    → GET  /api/hotspots              ranked H3 cells with evidence-fusion scores
    PREDICT   → GET  /api/forecast/{h3_cell}    LightGBM 6-24h PM2.5 forecast
    IMPACT    → GET  /api/impact/{h3_cell}      population / schools / hospitals at risk
    RECOMMEND → GET  /api/hotspots/{h3_cell}/evidence   full evidence + Gemini recommendation
    ACKNOWLEDGE → POST /api/hotspots/acknowledge
    ALERT     → POST /api/alerts/issue

Supporting:
    GET  /api/health
    GET  /api/summary                 KPI dashboard cards
    GET  /api/weather/{h3_cell}       wind / temperature / humidity
    GET  /api/propagation/{h3_cell}   predicted pollution corridor
    POST /api/citizen-report          text/voice report
    POST /api/citizen-report/photo    photo report
    POST /api/demo/seed              seed demo scenario data
    GET  /api/demo/scenario          demo scenario description
"""
import uuid
from datetime import datetime, timezone
import os
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.services import openaq_client, gemini_client
from app.services import historical_data, forecast, earth_engine_client
from app.services import weather_client, impact_engine, demo_scenario
from app.services.propagation import compute_propagation_corridor
from app.services.h3_utils import latlng_to_cell, bin_points
from app.services.hotspot_detection import classify_cell, rank_hotspots

app = FastAPI(title="VIGIL API", version="0.2.0",
              description="Environmental intelligence before exposure.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten before real deployment
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Global in-memory state — declared BEFORE startup event
# ---------------------------------------------------------------------------
CITIZEN_REPORTS: list[dict] = []
ALERTS: dict[str, dict] = {}
ISSUED_ALERTS: dict[str, dict] = {}
DISMISSED: dict[str, dict] = {}
_HISTORICAL_DF = None
_WEATHER_CACHE: dict[str, dict] = {}


@app.on_event("startup")
async def _train_forecast_on_startup():
    """Train the forecast model immediately with synthetic data so the server
    is fully ready to serve requests within seconds of boot.  The live OpenAQ
    readings are already fetched per-request in /api/hotspots, so there is no
    need to also pull 14 days of history at startup."""
    global _HISTORICAL_DF
    print("[VIGIL] Building training data...")
    _HISTORICAL_DF = historical_data.generate_synthetic_history(days=14)
    forecast.train(_HISTORICAL_DF)
    print("[VIGIL] Forecast model ready.")


class CitizenReport(BaseModel):
    lat: float
    lng: float
    text: str = ""
    source: str = "text"  # "text" | "voice" | "photo"
    haze_score: float | None = None
    is_demo: bool = False  # skip Gemini for demo seeding speed


class AcknowledgeIn(BaseModel):
    h3_cell: str
    action_taken: str
    officer_name: str | None = None


class AlertIssueIn(BaseModel):
    h3_cell: str
    alert_type: str = "public_advisory"
    message: str | None = None
    officer_name: str | None = None


class DismissIn(BaseModel):
    h3_cell: str
    reason: str


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat(),
            "product": "VIGIL", "version": "0.2.0"}


# ---------------------------------------------------------------------------
# Summary (KPI cards)
# ---------------------------------------------------------------------------

@app.get("/api/summary")
async def get_summary():
    """KPI data for the dashboard summary cards."""
    hotspot_data = await get_hotspots()
    hotspots = hotspot_data["hotspots"]
    hidden = [h for h in hotspots if h["severity"] == "hidden"]
    confirmed = [h for h in hotspots if h["severity"] == "confirmed"]
    high_confidence = [h for h in hotspots if h.get("confidence_score", 0) >= 0.6]

    total_pop = 0
    for h in high_confidence:
        demo = impact_engine.get_cell_demographics(h["h3_cell"])
        total_pop += demo["population"]

    return {
        "active_hotspots": len([h for h in hotspots if h["severity"] in ("hidden", "confirmed", "corroborated")]),
        "hidden_hotspots": len(hidden),
        "confirmed_hotspots": len(confirmed),
        "high_confidence_cells": len(high_confidence),
        "population_at_risk": total_pop,
        "pending_alerts": len([h for h in hotspots if h["h3_cell"] not in ALERTS and h["severity"] in ("hidden", "confirmed")]),
        "issued_alerts": len(ISSUED_ALERTS),
        "citizen_reports": len(CITIZEN_REPORTS),
    }


# ---------------------------------------------------------------------------
# Citizen reports (DETECT)
# ---------------------------------------------------------------------------

@app.post("/api/citizen-report")
async def submit_report(report: CitizenReport):
    import asyncio
    record = report.model_dump()
    gemini_result = None
    if record["haze_score"] is None and report.text and not report.is_demo:
        # Run synchronous Gemini call in thread pool so it doesn't block the event loop
        gemini_result = await asyncio.to_thread(gemini_client.classify_text_report, report.text)
        record["haze_score"] = gemini_result.get("haze_score", 0.5)
    elif record["haze_score"] is None:
        record["haze_score"] = 0.6  # default for demo reports

    record["id"] = str(uuid.uuid4())
    record["h3_cell"] = latlng_to_cell(report.lat, report.lng)
    record["submitted_at"] = datetime.now(timezone.utc).isoformat()
    record["synced"] = True
    record["gemini_classification"] = gemini_result
    CITIZEN_REPORTS.append(record)
    return record


@app.post("/api/citizen-report/photo")
async def submit_photo_report(
    lat: float = Form(...), lng: float = Form(...), file: UploadFile = File(...)
):
    image_bytes = await file.read()
    scoring = gemini_client.score_photo(image_bytes, mime_type=file.content_type or "image/jpeg")

    record = {
        "id": str(uuid.uuid4()),
        "lat": lat, "lng": lng,
        "h3_cell": latlng_to_cell(lat, lng),
        "source": "photo",
        "haze_score": scoring.get("haze_score", 0.5),
        "gemini_classification": scoring,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "synced": True,
    }
    CITIZEN_REPORTS.append(record)
    return record


@app.get("/api/citizen-reports")
async def list_citizen_reports():
    return {"count": len(CITIZEN_REPORTS), "reports": CITIZEN_REPORTS[-50:]}


# ---------------------------------------------------------------------------
# Hotspots (DETECT — fused)
# ---------------------------------------------------------------------------

@app.get("/api/hotspots")
async def get_hotspots(bbox: str = "76.8,28.4,77.6,28.9"):
    sensor_readings = await openaq_client.fetch_all_readings(bbox)
    sensor_bins = bin_points(
        [{"lat": r["lat"], "lng": r["lng"], **r} for r in sensor_readings if r["lat"]]
    )
    sensor_coverage = set(sensor_bins.keys())
    citizen_bins = bin_points(CITIZEN_REPORTS) if CITIZEN_REPORTS else {}
    all_cells = sensor_coverage | set(citizen_bins.keys())

    df = _get_historical_df()

    results = []
    for cell in all_cells:
        sensor_pm25 = None
        if cell in sensor_bins:
            sensor_pm25 = max(p["pm25"] for p in sensor_bins[cell])

        satellite_anomaly_score = _get_satellite_score(cell)

        reports = citizen_bins.get(cell, [])

        # Historical baseline
        baseline_mean, baseline_stddev = historical_data.get_current_baseline(df, cell)

        # Weather (cached)
        weather = _WEATHER_CACHE.get(cell)
        if weather is None:
            weather = weather_client._mock_weather(cell)
            _WEATHER_CACHE[cell] = weather

        classified = classify_cell(
            cell, sensor_pm25, satellite_anomaly_score, reports, sensor_coverage,
            historical_baseline=baseline_mean,
            historical_stddev=baseline_stddev,
            weather_data=weather,
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
                "confidence_score": c.confidence_score,
                "evidence_breakdown": c.evidence_breakdown,
                "acknowledged": c.h3_cell in ALERTS,
                "alert_issued": c.h3_cell in ISSUED_ALERTS,
                "dismissed": c.h3_cell in DISMISSED,
            }
            for c in ranked
        ],
    }


# ---------------------------------------------------------------------------
# Evidence panel ("Why this alert?")
# ---------------------------------------------------------------------------

@app.get("/api/hotspots/{h3_cell}/evidence")
async def get_evidence(h3_cell: str):
    hotspots = await get_hotspots()
    match = next((h for h in hotspots["hotspots"] if h["h3_cell"] == h3_cell), None)
    if match is None:
        raise HTTPException(status_code=404, detail="cell not currently a hotspot")

    # Get impact
    impact = impact_engine.compute_impact_score(h3_cell, match.get("confidence_score", 0))

    # Get weather
    weather = await weather_client.fetch_weather(h3_cell)

    # Get propagation corridor
    corridor = compute_propagation_corridor(
        h3_cell,
        weather["wind_direction_deg"],
        weather["wind_speed_kmh"],
        match.get("confidence_score", 0.5),
    )
    corridor_impact = impact_engine.compute_corridor_impact(corridor, match.get("confidence_score", 0.5))

    # Get forecast
    df = _get_historical_df()
    forecast_data = None
    try:
        if not forecast.is_trained():
            forecast.train(df)
        forecast_data = forecast.forecast_cell(df, h3_cell, hours_ahead=12)
    except (ValueError, RuntimeError):
        pass

    # Spike detection from forecast
    spike_info = None
    if forecast_data:
        from app.services.hotspot_detection import PM25_UNHEALTHY
        for pred in forecast_data:
            if pred["predicted_pm25"] >= PM25_UNHEALTHY:
                spike_info = {
                    "threshold": PM25_UNHEALTHY,
                    "predicted_value": pred["predicted_pm25"],
                    "hours_until": round((
                        datetime.fromisoformat(pred["timestamp"]) - datetime.now(timezone.utc)
                    ).total_seconds() / 3600, 1),
                    "timestamp": pred["timestamp"],
                }
                break

    # Gemini structured explanation
    explanation_data = {**match, "weather": weather, "impact": impact}
    incident_explanation = gemini_client.generate_incident_explanation(explanation_data)

    # Gemini structured recommendation
    rec_data = {**match, "weather": weather, "impact": impact, "corridor_impact": corridor_impact, "forecast_spike": spike_info}
    recommendation = gemini_client.generate_structured_recommendation(rec_data)

    # Evidence checklist
    eb = match.get("evidence_breakdown", {})
    evidence_checklist = []
    if eb.get("satellite_anomaly", {}).get("signal_strength", 0) > 0.3:
        evidence_checklist.append({"check": "Satellite anomaly detected", "active": True})
    else:
        evidence_checklist.append({"check": "Satellite anomaly detected", "active": False})

    citizen_count = match.get("citizen_report_count", 0)
    if citizen_count > 0:
        evidence_checklist.append({"check": f"{citizen_count} citizen report{'s' if citizen_count != 1 else ''} in this zone", "active": True})
    else:
        evidence_checklist.append({"check": "Citizen reports in this zone", "active": False})

    if eb.get("historical_deviation", {}).get("signal_strength", 0) > 0.3:
        evidence_checklist.append({"check": "Historical baseline exceeded", "active": True})
    else:
        evidence_checklist.append({"check": "Historical baseline exceeded", "active": False})

    if eb.get("weather_consistency", {}).get("signal_strength", 0) > 0.4:
        evidence_checklist.append({"check": "Wind direction consistent with spread", "active": True})
    else:
        evidence_checklist.append({"check": "Wind direction consistent with spread", "active": False})

    if eb.get("coverage_uncertainty", {}).get("signal_strength", 0) > 0.5:
        evidence_checklist.append({"check": "Insufficient official sensor coverage", "active": True})
    else:
        evidence_checklist.append({"check": "Sufficient official sensor coverage", "active": True})

    if eb.get("sensor_evidence", {}).get("signal_strength", 0) > 0.3:
        evidence_checklist.append({"check": "Nearby sensor confirms elevated levels", "active": True})
    else:
        evidence_checklist.append({"check": "Nearby sensor data does not yet show equivalent severity", "active": match.get("severity") == "hidden"})

    return {
        **match,
        "weather": weather,
        "impact": impact,
        "corridor": corridor,
        "corridor_impact": corridor_impact,
        "forecast": forecast_data,
        "spike_info": spike_info,
        "incident_explanation": incident_explanation,
        "recommendation": recommendation,
        "evidence_checklist": evidence_checklist,
    }


# ---------------------------------------------------------------------------
# Recommendation (backward compat)
# ---------------------------------------------------------------------------

@app.get("/api/hotspots/{h3_cell}/recommendation")
async def get_recommendation(h3_cell: str):
    hotspots = await get_hotspots()
    match = next((h for h in hotspots["hotspots"] if h["h3_cell"] == h3_cell), None)
    if match is None:
        raise HTTPException(status_code=404, detail="cell not currently a hotspot")
    recommendation = gemini_client.generate_authority_recommendation(match)
    return {**match, "recommendation": recommendation}


# ---------------------------------------------------------------------------
# Weather
# ---------------------------------------------------------------------------

@app.get("/api/weather/{h3_cell}")
async def get_weather(h3_cell: str):
    return await weather_client.fetch_weather(h3_cell)


# ---------------------------------------------------------------------------
# Propagation
# ---------------------------------------------------------------------------

@app.get("/api/propagation/{h3_cell}")
async def get_propagation(h3_cell: str):
    weather = await weather_client.fetch_weather(h3_cell)
    hotspots = await get_hotspots()
    match = next((h for h in hotspots["hotspots"] if h["h3_cell"] == h3_cell), None)
    source_intensity = match.get("confidence_score", 0.5) if match else 0.5

    corridor = compute_propagation_corridor(
        h3_cell,
        weather["wind_direction_deg"],
        weather["wind_speed_kmh"],
        source_intensity,
    )
    corridor_impact = impact_engine.compute_corridor_impact(corridor, source_intensity)

    return {
        "source_cell": h3_cell,
        "weather": weather,
        "corridor": corridor,
        "corridor_impact": corridor_impact,
    }


# ---------------------------------------------------------------------------
# Impact
# ---------------------------------------------------------------------------

@app.get("/api/impact/{h3_cell}")
async def get_impact(h3_cell: str):
    hotspots = await get_hotspots()
    match = next((h for h in hotspots["hotspots"] if h["h3_cell"] == h3_cell), None)
    risk = match.get("confidence_score", 0.3) if match else 0.3
    return impact_engine.compute_impact_score(h3_cell, risk)


# ---------------------------------------------------------------------------
# Forecast
# ---------------------------------------------------------------------------

@app.post("/api/forecast/train")
async def train_forecast_model():
    df = _get_historical_df()
    metrics = forecast.train(df)
    return {"status": "trained", **metrics}


@app.get("/api/forecast/{h3_cell}")
async def get_forecast(h3_cell: str, hours: int = 24):
    df = _get_historical_df()
    if not forecast.is_trained():
        forecast.train(df)
    try:
        predictions = forecast.forecast_cell(df, h3_cell, hours_ahead=hours)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"h3_cell": h3_cell, "predictions": predictions}


# ---------------------------------------------------------------------------
# Acknowledge / Alert / Dismiss
# ---------------------------------------------------------------------------

@app.post("/api/hotspots/acknowledge")
async def acknowledge_hotspot(body: AcknowledgeIn):
    ALERTS[body.h3_cell] = {
        "h3_cell": body.h3_cell,
        "action_taken": body.action_taken,
        "officer_name": body.officer_name,
        "acknowledged_at": datetime.now(timezone.utc).isoformat(),
    }
    return ALERTS[body.h3_cell]


@app.post("/api/alerts/issue")
async def issue_alert(body: AlertIssueIn):
    ISSUED_ALERTS[body.h3_cell] = {
        "h3_cell": body.h3_cell,
        "alert_type": body.alert_type,
        "message": body.message,
        "officer_name": body.officer_name,
        "issued_at": datetime.now(timezone.utc).isoformat(),
    }
    return ISSUED_ALERTS[body.h3_cell]


@app.post("/api/alerts/dismiss")
async def dismiss_alert(body: DismissIn):
    DISMISSED[body.h3_cell] = {
        "h3_cell": body.h3_cell,
        "reason": body.reason,
        "dismissed_at": datetime.now(timezone.utc).isoformat(),
    }
    return DISMISSED[body.h3_cell]


@app.get("/api/hotspots/acknowledged")
async def list_acknowledged():
    return list(ALERTS.values())


@app.get("/api/alerts/issued")
async def list_issued_alerts():
    return list(ISSUED_ALERTS.values())


# ---------------------------------------------------------------------------
# Demo scenario
# ---------------------------------------------------------------------------

@app.post("/api/demo/seed")
async def seed_demo():
    """Seed the system with pre-scripted demo citizen reports."""
    demo_reports = demo_scenario.get_demo_reports()
    seeded = []
    for r in demo_reports:
        report = CitizenReport(lat=r["lat"], lng=r["lng"], text=r["text"], source=r["source"], is_demo=True)
        result = await submit_report(report)
        seeded.append(result)
    return {"seeded": len(seeded), "reports": seeded}


@app.get("/api/demo/scenario")
async def get_demo_scenario():
    return demo_scenario.DEMO_SCENARIO_DESCRIPTION


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

def _get_historical_df():
    global _HISTORICAL_DF
    if _HISTORICAL_DF is None:
        # Fallback if somehow not initialized
        _HISTORICAL_DF = historical_data.generate_synthetic_history(days=14)
    return _HISTORICAL_DF


def _get_satellite_score(cell: str) -> float:
    """Tries real Earth Engine Sentinel-5P data first; falls back to the
    deterministic mock if EE isn't configured yet."""
    try:
        real_score = earth_engine_client.get_aerosol_index(cell)
        if real_score is not None:
            return real_score
    except RuntimeError:
        pass
    except Exception:
        pass
    return _mock_satellite_score(cell)


def _mock_satellite_score(cell: str) -> float:
    """Deterministic stand-in for Earth Engine Sentinel-5P aerosol index."""
    import hashlib
    h = int(hashlib.sha256(cell.encode()).hexdigest(), 16)
    return (h % 100) / 100.0
