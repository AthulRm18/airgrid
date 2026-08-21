"""
CONFLUX backend — FastAPI app.

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
from datetime import datetime, timezone, timedelta
import os
import asyncio
import time
from pathlib import Path
from dotenv import load_dotenv

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(_BACKEND_ROOT / ".env")
load_dotenv(_BACKEND_ROOT.parent / ".env")

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi import Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

from app.services import openaq_client, gemini_client
from app.services import historical_data, forecast, earth_engine_client
from app.services import weather_client, impact_engine, demo_scenario
from app.services import firebase_client as fb
from app.services.propagation import compute_propagation_corridor
from app.services.h3_utils import latlng_to_cell, bin_points
from app.services.hotspot_detection import classify_cell, rank_hotspots

BRICS_COUNTRIES = {"BR", "RU", "IN", "CN", "ZA"}
LOCAL_COUNTRY = os.environ.get("LOCAL_COUNTRY_CODE", "IN").strip().upper()
if LOCAL_COUNTRY not in BRICS_COUNTRIES:
    LOCAL_COUNTRY = "IN"

ROLE_CITIZEN = "citizen"
ROLE_VERIFIER = "verifier"
ROLE_AUTHORITY = "authority"
ROLE_RESEARCHER = "researcher"
ROLE_COORDINATOR = "coordinator"

app = FastAPI(title="CONFLUX API", version="0.3.0",
              description="Community environmental intelligence & early warning before exposure.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten before real deployment
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Global in-memory state — declared BEFORE startup event
# Citizen reports, alerts, issued_alerts, dismissed are persisted via
# firebase_client (falls back to in-memory if Firebase not configured).
# ---------------------------------------------------------------------------
FEDERATED_EVENTS: list[dict] = []
FEDERATED_MODEL_REGISTRY: dict[str, dict] = {}
RESOURCE_COORDINATION_REQUESTS: list[dict] = []
INCIDENTS: list[dict] = []

USERS: dict[str, dict] = {
    "citizen.demo": {
        "username": "citizen.demo",
        "password": "demo123",
        "name": "Asha Rao",
        "role": ROLE_CITIZEN,
        "agency": "Public Reporter",
        "country_code": LOCAL_COUNTRY,
    },
    "verifier.demo": {
        "username": "verifier.demo",
        "password": "demo123",
        "name": "Rohan Mehta",
        "role": ROLE_VERIFIER,
        "agency": "City Air Desk",
        "country_code": LOCAL_COUNTRY,
    },
    "authority.demo": {
        "username": "authority.demo",
        "password": "demo123",
        "name": "Dr. Neha Iyer",
        "role": ROLE_AUTHORITY,
        "agency": "District Pollution Control",
        "country_code": LOCAL_COUNTRY,
    },
    "researcher.demo": {
        "username": "researcher.demo",
        "password": "demo123",
        "name": "Dr. Priya Sharma",
        "role": ROLE_RESEARCHER,
        "agency": "Climate Policy Lab, IIT Delhi",
        "country_code": LOCAL_COUNTRY,
    },
    "brics.demo": {
        "username": "brics.demo",
        "password": "demo123",
        "name": "BRICS Coordination Node",
        "role": ROLE_COORDINATOR,
        "agency": "BRICS Air Intelligence Exchange",
        "country_code": LOCAL_COUNTRY,
    },
}
_HISTORICAL_DF = None
_BASELINE_CACHE_HOURLY: dict[tuple[str, int], tuple[float, float]] = {}
_BASELINE_CACHE_OVERALL: dict[str, tuple[float, float]] = {}
_WEATHER_CACHE: dict[str, dict] = {}
_SATELLITE_CACHE: dict[str, float] = {}
_DEMO_SEEDED = False
_HOTSPOTS_CACHE: dict = {"ts": 0.0, "data": None}
_EVIDENCE_CACHE: dict[str, dict] = {}
_OPENAQ_ENDPOINT_TIMEOUT = float(os.environ.get("OPENAQ_ENDPOINT_TIMEOUT", "20"))
_EVIDENCE_CACHE_TTL_SECONDS = float(os.environ.get("EVIDENCE_CACHE_TTL_SECONDS", "20"))
_GEMINI_EVIDENCE_TIMEOUT_SECONDS = float(os.environ.get("GEMINI_EVIDENCE_TIMEOUT_SECONDS", "25"))


@app.on_event("startup")
async def _train_forecast_on_startup():
    """Train the forecast model immediately with synthetic data so the server
    is fully ready to serve requests within seconds of boot.  The live OpenAQ
    readings are already fetched per-request in /api/hotspots, so there is no
    need to also pull 14 days of history at startup."""
    global _HISTORICAL_DF, _DEMO_SEEDED
    print("[CONFLUX] Building training data...")
    _HISTORICAL_DF = historical_data.generate_synthetic_history(days=14)
    _rebuild_baseline_cache(_HISTORICAL_DF)
    forecast.train(_HISTORICAL_DF)
    print("[CONFLUX] Forecast model ready.")

    # Prime sensor cache early so dashboard's first load can use real readings.
    try:
        seeded_readings = await openaq_client.fetch_all_readings("76.8,28.4,77.6,28.9")
        source = seeded_readings[0].get("source") if seeded_readings else "none"
        print(f"[CONFLUX] Sensor cache primed ({len(seeded_readings)} readings, source={source}).")
    except Exception as exc:
        print(f"[CONFLUX] Sensor cache prime skipped: {exc}")

    # Restore persisted BRICS events from previous session
    persisted = fb.get_federated_events()
    if persisted:
        FEDERATED_EVENTS.extend(persisted)

    # Auto-seed demo scenario so the dashboard is never empty on first load.
    if os.environ.get("DEMO_AUTO_SEED", "true").lower() in ("1", "true", "yes"):
        try:
            result = await seed_demo()
            _DEMO_SEEDED = True
            print(f"[CONFLUX] Demo scenario seeded ({result['seeded']} citizen reports).")
        except Exception as exc:
            print(f"[CONFLUX] Demo auto-seed skipped: {exc}")


class CitizenReport(BaseModel):
    lat: float
    lng: float | None = None
    lon: float | None = None
    text: str = ""
    source: str = "text"  # "text" | "voice" | "photo"
    haze_score: float | None = None
    is_demo: bool = False  # skip Gemini for demo seeding speed
    country_code: str | None = None

    @model_validator(mode="after")
    def _normalize_coordinates(self):
        # Accept both lng and lon from different clients.
        if self.lng is None and self.lon is None:
            raise ValueError("Either 'lng' or 'lon' is required")
        if self.lng is None:
            self.lng = self.lon
        if self.country_code is None:
            self.country_code = LOCAL_COUNTRY
        else:
            self.country_code = str(self.country_code).strip().upper()
        if self.country_code not in BRICS_COUNTRIES:
            raise ValueError(f"country_code must be one of {sorted(BRICS_COUNTRIES)}")
        return self


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


class LoginIn(BaseModel):
    username: str
    password: str


class FederatedEventIn(BaseModel):
    origin_country: str
    h3_cell: str
    lat: float
    lng: float
    severity: str
    confidence_score: float
    timestamp: str | None = None
    evidence_summary: str | None = None
    source_system: str = "CONFLUX"

    @model_validator(mode="after")
    def _normalize_country(self):
        self.origin_country = str(self.origin_country).strip().upper()
        if self.origin_country not in BRICS_COUNTRIES:
            raise ValueError(f"origin_country must be one of {sorted(BRICS_COUNTRIES)}")
        return self


class ModelShareIn(BaseModel):
    origin_country: str
    model_name: str
    model_version: str
    target_variable: str = "pm25"
    horizon_hours: int = 24
    training_window_days: int = 14
    metrics: dict = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    artifact_uri: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _normalize_country(self):
        self.origin_country = str(self.origin_country).strip().upper()
        if self.origin_country not in BRICS_COUNTRIES:
            raise ValueError(f"origin_country must be one of {sorted(BRICS_COUNTRIES)}")
        return self


class ResourceCoordinationRequestIn(BaseModel):
    country_code: str
    request_type: str
    reason: str
    requested_for_h3_cell: str | None = None
    priority: str = "normal"
    resources_needed: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _normalize_country(self):
        self.country_code = str(self.country_code).strip().upper()
        if self.country_code not in BRICS_COUNTRIES:
            raise ValueError(f"country_code must be one of {sorted(BRICS_COUNTRIES)}")
        return self


def _public_user(user: dict) -> dict:
    return {
        "username": user["username"],
        "name": user["name"],
        "role": user["role"],
        "agency": user["agency"],
        "country_code": user["country_code"],
    }


def _session_user(session_token: str | None) -> dict | None:
    if not session_token:
        return None
    return fb.get_session(session_token)


def _require_roles(session_token: str | None, allowed_roles: set[str]) -> dict:
    user = _session_user(session_token)
    if user is None:
        raise HTTPException(status_code=401, detail="Login required")
    if user.get("role") not in allowed_roles:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return user


def _create_report_record(
    *,
    lat: float,
    lng: float,
    source: str,
    text: str = "",
    country_code: str = LOCAL_COUNTRY,
    haze_score: float | None = None,
    gemini_classification: dict | None = None,
    photo_classification: dict | None = None,
    is_demo: bool = False,
    incident_id: str | None = None,
    reporter: dict | None = None,
    location_hint: str | None = None,
):
    record = {
        "id": str(uuid.uuid4()),
        "incident_id": incident_id,
        "lat": lat,
        "lng": lng,
        "h3_cell": latlng_to_cell(lat, lng),
        "text": text,
        "source": source,
        "haze_score": haze_score if haze_score is not None else 0.5,
        "country_code": country_code,
        "gemini_classification": gemini_classification,
        "photo_classification": photo_classification,
        "location_hint": location_hint,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "synced": True,
        "is_demo": is_demo,
    }
    if reporter is not None:
        record["reporter"] = _public_user(reporter)
    fb.add_citizen_report(record)
    _invalidate_runtime_caches(clear_satellite=False)
    return record


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    reports = fb.get_all_citizen_reports()
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat(),
            "product": "CONFLUX", "version": "0.3.0",
            "local_country": LOCAL_COUNTRY,
            "demo_seeded": _DEMO_SEEDED,
            "citizen_reports": len(reports),
            "incidents": len(INCIDENTS),
            "firebase": fb.is_connected(),
            "active_sessions": fb.active_session_count()}


# ---------------------------------------------------------------------------
# Demo authentication
# ---------------------------------------------------------------------------

@app.post("/api/auth/login")
async def login(body: LoginIn):
    user = USERS.get(body.username)
    if user is None or user.get("password") != body.password:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = str(uuid.uuid4())
    fb.set_session(token, _public_user(user))
    return {"session_token": token, "user": fb.get_session(token)}


@app.get("/api/auth/session")
async def get_session(x_session_token: str | None = Header(default=None)):
    user = _session_user(x_session_token)
    if user is None:
        raise HTTPException(status_code=401, detail="No active session")
    return {"user": user}


@app.post("/api/auth/logout")
async def logout(x_session_token: str | None = Header(default=None)):
    if x_session_token:
        fb.delete_session(x_session_token)
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Voice transcript (Gemini Speech-to-Text + Translation)
# ---------------------------------------------------------------------------

class VoiceTranscriptIn(BaseModel):
    transcript: str  # raw text from browser Web Speech API
    lang: str = "auto"  # detected or user-specified language


@app.post("/api/voice-transcript")
async def process_voice_transcript(body: VoiceTranscriptIn):
    """Process a voice transcript through Gemini for translation + classification."""
    result = await asyncio.to_thread(
        gemini_client.classify_text_report, body.transcript, body.lang
    )
    return {
        "original": body.transcript,
        "translated": result.get("translated_text", body.transcript),
        "detected_language": result.get("detected_language", "English"),
        "event_type": result.get("event_type", "unclear"),
        "severity": result.get("severity", "low"),
        "haze_score": result.get("haze_score", 0.5),
        "extracted_location_hint": result.get("extracted_location_hint"),
        "reported_symptoms": result.get("reported_symptoms", []),
    }


@app.get("/api/sensors")
async def get_sensors(bbox: str | None = None):
    """Ground sensor readings for map markers — always returns data (mock fallback)."""
    try:
        readings = await asyncio.wait_for(openaq_client.fetch_all_readings(bbox), timeout=_OPENAQ_ENDPOINT_TIMEOUT)
    except Exception:
        readings = await openaq_client._fetch_mock_readings(bbox)
    return {
        "count": len(readings),
        "readings": readings,
        "data_source": "openaq" if readings and readings[0].get("source") == "openaq" else "openaq_mock",
    }


@app.get("/api/data-sources")
async def get_data_sources():
    """Transparency panel: which integrations are live vs demo fallback."""
    use_ee = os.environ.get("USE_EARTH_ENGINE", "false").lower() in ("1", "true", "yes")
    has_openaq = bool(os.environ.get("OPENAQ_API_KEY")) and not getattr(openaq_client, "_FORCE_MOCK", False)
    has_gemini = bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
    ee_status = {"ok": False}
    if use_ee:
        ee_status = earth_engine_client.status()
    return {
        "local_country": LOCAL_COUNTRY,
        "brics_mode": "enabled",
        "openaq": "configured" if has_openaq else "mock_fallback",
        "gemini": "configured" if has_gemini else "mock_fallback",
        "earth_engine": "enabled" if ee_status.get("ok") else ("needs_iam" if use_ee else "mock_fallback"),
        "earth_engine_detail": ee_status.get("detail"),
        "earth_engine_hint": ee_status.get("hint"),
        "weather": "mock_fallback",
        "population": "demo_estimates",
        "demo_auto_seed": os.environ.get("DEMO_AUTO_SEED", "true"),
        "gcp_project": os.environ.get("GCP_PROJECT_ID") or None,
    }


# ---------------------------------------------------------------------------
# Summary (KPI cards)
# ---------------------------------------------------------------------------

@app.get("/api/summary")
async def get_summary():
    """KPI data for the dashboard summary cards."""
    hotspot_data = await _get_hotspots_cached(max_age_seconds=20.0)
    hotspots = hotspot_data["hotspots"]
    hidden = [h for h in hotspots if h["severity"] == "hidden"]
    confirmed = [h for h in hotspots if h["severity"] == "confirmed"]
    high_confidence = [h for h in hotspots if h.get("confidence_score", 0) >= 0.6]

    total_pop = 0
    for h in high_confidence:
        demo = impact_engine.get_cell_demographics(h["h3_cell"])
        total_pop += demo["population"]

    alerts = fb.get_alerts()
    issued = fb.get_issued_alerts()
    reports = fb.get_all_citizen_reports()
    return {
        "active_hotspots": len([h for h in hotspots if h["severity"] in ("hidden", "confirmed", "corroborated")]),
        "hidden_hotspots": len(hidden),
        "confirmed_hotspots": len(confirmed),
        "high_confidence_cells": len(high_confidence),
        "population_at_risk": total_pop,
        "pending_alerts": len([h for h in hotspots if h["h3_cell"] not in alerts and h["severity"] in ("hidden", "confirmed")]),
        "issued_alerts": len(issued),
        "citizen_reports": len(reports),
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

    return _create_report_record(
        lat=report.lat,
        lng=report.lng,
        text=report.text,
        source=report.source,
        country_code=report.country_code or LOCAL_COUNTRY,
        haze_score=record["haze_score"],
        gemini_classification=gemini_result,
        is_demo=report.is_demo,
    )


@app.post("/api/citizen-report/photo")
async def submit_photo_report(
    lat: float = Form(...), lng: float = Form(...), file: UploadFile = File(...),
    country_code: str = Form(LOCAL_COUNTRY),
):
    country_code = str(country_code).strip().upper()
    if country_code not in BRICS_COUNTRIES:
        raise HTTPException(status_code=400, detail=f"country_code must be one of {sorted(BRICS_COUNTRIES)}")
    image_bytes = await file.read()
    scoring = gemini_client.score_photo(image_bytes, mime_type=file.content_type or "image/jpeg")
    return _create_report_record(
        lat=lat,
        lng=lng,
        source="photo",
        country_code=country_code,
        haze_score=scoring.get("haze_score", 0.5),
        photo_classification=scoring,
        gemini_classification=scoring,
    )


@app.post("/api/incidents/report")
async def submit_incident(
    lat: float = Form(...),
    lng: float = Form(...),
    text: str = Form(default=""),
    location_hint: str = Form(default=""),
    country_code: str = Form(default=LOCAL_COUNTRY),
    haze_score: float | None = Form(default=None),
    skip_gemini: str = Form(default="false"),
    file: UploadFile | None = File(default=None),
    x_session_token: str | None = Header(default=None),
):
    reporter = _session_user(x_session_token)
    normalized_country = str(country_code).strip().upper()
    if normalized_country not in BRICS_COUNTRIES:
        raise HTTPException(status_code=400, detail=f"country_code must be one of {sorted(BRICS_COUNTRIES)}")

    text = text.strip()
    location_hint = location_hint.strip()
    if not text and file is None:
        raise HTTPException(status_code=400, detail="Provide text, photo, or both")

    incident_id = str(uuid.uuid4())
    text_classification = None
    photo_classification = None
    haze_candidates: list[float] = []
    use_preclassified = skip_gemini.lower() in ("1", "true", "yes") and haze_score is not None

    if use_preclassified:
        # Voice path already ran Gemini — skip a second round-trip
        haze_candidates.append(float(haze_score))
        text_classification = {
            "haze_score": float(haze_score),
            "event_type": "smoke",
            "severity": "high" if float(haze_score) >= 0.7 else "moderate",
            "translated_text": text,
            "detected_language": "preclassified",
            "confidence": 0.85,
        }
    elif text:
        try:
            text_classification = await asyncio.wait_for(
                asyncio.to_thread(gemini_client.classify_text_report, text),
                timeout=8.0,
            )
        except asyncio.TimeoutError:
            text_classification = {
                "haze_score": 0.55, "event_type": "smoke", "severity": "moderate",
                "translated_text": text, "detected_language": "Unknown",
            }
        if text_classification.get("haze_score") is not None:
            haze_candidates.append(float(text_classification["haze_score"]))

    if file is not None:
        image_bytes = await file.read()
        try:
            photo_classification = await asyncio.wait_for(
                asyncio.to_thread(
                    gemini_client.score_photo,
                    image_bytes,
                    file.content_type or "image/jpeg",
                ),
                timeout=10.0,
            )
        except asyncio.TimeoutError:
            photo_classification = {"haze_score": 0.5, "notes": "Photo analysis timed out"}
        if photo_classification.get("haze_score") is not None:
            haze_candidates.append(float(photo_classification["haze_score"]))

    record = _create_report_record(
        lat=lat,
        lng=lng,
        source="multimodal" if text and file is not None else ("photo" if file is not None else "text"),
        text=text,
        country_code=normalized_country,
        haze_score=max(haze_candidates) if haze_candidates else 0.5,
        gemini_classification=text_classification,
        photo_classification=photo_classification,
        incident_id=incident_id,
        reporter=reporter,
        location_hint=location_hint or None,
    )

    incident = {
        "incident_id": incident_id,
        "id": record["id"],
        "country_code": normalized_country,
        "lat": lat,
        "lng": lng,
        "h3_cell": record["h3_cell"],
        "text": text,
        "location_hint": location_hint or None,
        "reporter": _public_user(reporter) if reporter else None,
        "submitted_at": record["submitted_at"],
        "source": record["source"],
        "text_present": bool(text),
        "photo_present": file is not None,
        "text_analysis": text_classification,
        "photo_analysis": photo_classification,
        "combined_haze_score": record["haze_score"],
    }
    fb.add_incident(incident)
    INCIDENTS.append(incident)
    return incident


@app.get("/api/incidents")
async def list_incidents():
    items = fb.get_all_incidents()
    return {"count": len(items), "incidents": items[-50:]}


@app.get("/api/citizen-reports")
async def list_citizen_reports():
    reports = fb.get_all_citizen_reports()
    reports.sort(key=lambda r: r.get("submitted_at", ""), reverse=True)
    return {"count": len(reports), "reports": reports[:50]}


# ---------------------------------------------------------------------------
# Hotspots (DETECT — fused)
# ---------------------------------------------------------------------------

@app.get("/api/hotspots")
async def get_hotspots(bbox: str | None = None):
    try:
        sensor_readings = await asyncio.wait_for(openaq_client.fetch_all_readings(bbox), timeout=_OPENAQ_ENDPOINT_TIMEOUT)
    except Exception:
        sensor_readings = await openaq_client._fetch_mock_readings(bbox)
    sensor_bins = bin_points(
        [{"lat": r["lat"], "lng": r["lng"], **r} for r in sensor_readings if r["lat"]]
    )
    sensor_coverage = set(sensor_bins.keys())
    citizen_reports_all = fb.get_all_citizen_reports()
    citizen_bins = bin_points(citizen_reports_all) if citizen_reports_all else {}
    all_cells = sensor_coverage | set(citizen_bins.keys())

    df = _get_historical_df()

    results = []
    cell_country_map: dict[str, str] = {}
    for cell in all_cells:
        sensor_pm25 = None
        if cell in sensor_bins:
            sensor_pm25 = max(p["pm25"] for p in sensor_bins[cell])

        satellite_anomaly_score = _get_satellite_score(cell)

        reports = citizen_bins.get(cell, [])
        report_countries = [
            str(r.get("country_code", LOCAL_COUNTRY)).strip().upper()
            for r in reports
            if str(r.get("country_code", LOCAL_COUNTRY)).strip().upper() in BRICS_COUNTRIES
        ]
        dominant_country = max(set(report_countries), key=report_countries.count) if report_countries else LOCAL_COUNTRY

        # Historical baseline
        baseline_mean, baseline_stddev = _get_current_baseline_fast(cell)

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
        cell_country_map[cell] = dominant_country

    ranked = rank_hotspots(results)

    # Only return cells worth showing — hide noise-only unverified cells.
    from app.services.hotspot_detection import Severity, PM25_MODERATE
    visible = [
        c for c in ranked
        if c.severity != Severity.UNVERIFIED
        or c.confidence_score >= 0.35
        or (c.sensor_pm25 is not None and c.sensor_pm25 >= PM25_MODERATE)
        or len(c.citizen_reports) > 0
    ]

    alerts = fb.get_alerts()
    issued = fb.get_issued_alerts()
    dismissed = fb.get_dismissed()
    payload = {
        "count": len(visible),
        "hotspots": [
            {
                "h3_cell": c.h3_cell,
                "lat": c.lat,
                "lng": c.lng,
                "severity": c.severity.value,
                "aqi_estimate": c.aqi_estimate,
                "sensor_pm25": c.sensor_pm25,
                "citizen_report_count": len(c.citizen_reports),
                "country_code": cell_country_map.get(c.h3_cell, LOCAL_COUNTRY),
                "explanation": c.explanation,
                "confidence_score": c.confidence_score,
                "evidence_breakdown": c.evidence_breakdown,
                "acknowledged": c.h3_cell in alerts,
                "alert_issued": c.h3_cell in issued,
                "dismissed": c.h3_cell in dismissed,
            }
            for c in visible
        ],
    }
    _HOTSPOTS_CACHE["ts"] = time.time()
    _HOTSPOTS_CACHE["data"] = payload
    return payload


# ---------------------------------------------------------------------------
# Evidence panel ("Why this alert?")
# ---------------------------------------------------------------------------

@app.get("/api/hotspots/{h3_cell}/evidence")
async def get_evidence(h3_cell: str, fast: bool = False):
    if fast:
        return await _build_evidence_payload(h3_cell, skip_ai=True)
    return await _get_evidence_cached(h3_cell, max_age_seconds=_EVIDENCE_CACHE_TTL_SECONDS)


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
async def acknowledge_hotspot(body: AcknowledgeIn, x_session_token: str | None = Header(default=None)):
    user = _require_roles(x_session_token, {ROLE_AUTHORITY, ROLE_VERIFIER})
    officer = body.officer_name or user.get("name")
    record = {
        "h3_cell": body.h3_cell,
        "action_taken": body.action_taken,
        "officer_name": officer,
        "acknowledged_at": datetime.now(timezone.utc).isoformat(),
    }
    fb.set_alert(body.h3_cell, record)
    _invalidate_runtime_caches(clear_satellite=False)
    return record


@app.post("/api/alerts/issue")
async def issue_alert(body: AlertIssueIn, x_session_token: str | None = Header(default=None)):
    user = _require_roles(x_session_token, {ROLE_AUTHORITY})
    record = {
        "h3_cell": body.h3_cell,
        "alert_type": body.alert_type,
        "message": body.message,
        "officer_name": body.officer_name or user.get("name"),
        "issued_at": datetime.now(timezone.utc).isoformat(),
    }
    fb.set_issued_alert(body.h3_cell, record)
    _invalidate_runtime_caches(clear_satellite=False)
    return record


@app.post("/api/alerts/dismiss")
async def dismiss_alert(body: DismissIn, x_session_token: str | None = Header(default=None)):
    user = _require_roles(x_session_token, {ROLE_AUTHORITY, ROLE_VERIFIER})
    record = {
        "h3_cell": body.h3_cell,
        "reason": body.reason,
        "officer_name": user.get("name"),
        "dismissed_at": datetime.now(timezone.utc).isoformat(),
    }
    fb.set_dismissed(body.h3_cell, record)
    _invalidate_runtime_caches(clear_satellite=False)
    return record


@app.get("/api/hotspots/acknowledged")
async def list_acknowledged():
    return list(fb.get_alerts().values())


@app.get("/api/alerts/issued")
async def list_issued_alerts():
    return list(fb.get_issued_alerts().values())


# ---------------------------------------------------------------------------
# BRICS federation and interoperability
# ---------------------------------------------------------------------------

@app.get("/api/brics/status")
async def brics_status():
    return {
        "local_country": LOCAL_COUNTRY,
        "member_countries": sorted(BRICS_COUNTRIES),
        "federated_events_received": len(FEDERATED_EVENTS),
        "shared_models": len(FEDERATED_MODEL_REGISTRY),
        "resource_requests": len(RESOURCE_COORDINATION_REQUESTS),
    }


@app.get("/api/brics/hotspots/export")
async def export_brics_hotspots(min_confidence: float = 0.4):
    hotspots = await _get_hotspots_cached(max_age_seconds=10.0)
    exported = []
    now_iso = datetime.now(timezone.utc).isoformat()
    for h in hotspots["hotspots"]:
        if h.get("confidence_score", 0.0) < min_confidence:
            continue
        exported.append({
            "schema_version": "brics.v1",
            "origin_country": h.get("country_code", LOCAL_COUNTRY),
            "producer": "CONFLUX",
            "h3_cell": h["h3_cell"],
            "lat": h["lat"],
            "lng": h["lng"],
            "severity": h["severity"],
            "confidence_score": h.get("confidence_score", 0.0),
            "sensor_pm25": h.get("sensor_pm25"),
            "citizen_report_count": h.get("citizen_report_count", 0),
            "evidence_breakdown": h.get("evidence_breakdown", {}),
            "published_at": now_iso,
        })
    return {
        "schema": "brics.v1",
        "origin_country": LOCAL_COUNTRY,
        "count": len(exported),
        "events": exported,
    }


@app.post("/api/brics/hotspots/import")
async def import_brics_hotspots(payload: list[FederatedEventIn], x_session_token: str | None = Header(default=None)):
    _require_roles(x_session_token, {ROLE_COORDINATOR, ROLE_AUTHORITY})
    accepted = 0
    now_iso = datetime.now(timezone.utc).isoformat()
    for event in payload:
        dedupe_key = f"{event.origin_country}:{event.h3_cell}:{event.timestamp or now_iso}"
        if any(e.get("dedupe_key") == dedupe_key for e in FEDERATED_EVENTS):
            continue
        FEDERATED_EVENTS.append({
            "dedupe_key": dedupe_key,
            "schema_version": "brics.v1",
            "origin_country": event.origin_country,
            "h3_cell": event.h3_cell,
            "lat": event.lat,
            "lng": event.lng,
            "severity": event.severity,
            "confidence_score": event.confidence_score,
            "timestamp": event.timestamp or now_iso,
            "evidence_summary": event.evidence_summary,
            "source_system": event.source_system,
            "ingested_at": now_iso,
        })
        accepted += 1

    FEDERATED_EVENTS.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
    del FEDERATED_EVENTS[500:]
    return {"accepted": accepted, "total_stored": len(FEDERATED_EVENTS)}


@app.get("/api/brics/hotspots/federated")
async def list_federated_hotspots(country_code: str | None = None, min_confidence: float = 0.35):
    normalized_country = None
    if country_code is not None:
        normalized_country = str(country_code).strip().upper()
        if normalized_country not in BRICS_COUNTRIES:
            raise HTTPException(status_code=400, detail=f"country_code must be one of {sorted(BRICS_COUNTRIES)}")

    items = [
        e for e in FEDERATED_EVENTS
        if e.get("confidence_score", 0.0) >= min_confidence
        and (normalized_country is None or e.get("origin_country") == normalized_country)
    ]
    return {
        "count": len(items),
        "events": items[:200],
    }


@app.post("/api/brics/models/share")
async def share_model(payload: ModelShareIn, x_session_token: str | None = Header(default=None)):
    _require_roles(x_session_token, {ROLE_COORDINATOR, ROLE_AUTHORITY})
    model_id = f"{payload.origin_country}:{payload.model_name}:{payload.model_version}"
    FEDERATED_MODEL_REGISTRY[model_id] = {
        "model_id": model_id,
        "origin_country": payload.origin_country,
        "model_name": payload.model_name,
        "model_version": payload.model_version,
        "target_variable": payload.target_variable,
        "horizon_hours": payload.horizon_hours,
        "training_window_days": payload.training_window_days,
        "metrics": payload.metrics,
        "tags": payload.tags,
        "artifact_uri": payload.artifact_uri,
        "notes": payload.notes,
        "shared_at": datetime.now(timezone.utc).isoformat(),
    }
    return FEDERATED_MODEL_REGISTRY[model_id]


@app.get("/api/brics/models")
async def list_shared_models(target_variable: str | None = None):
    items = list(FEDERATED_MODEL_REGISTRY.values())
    if target_variable:
        target_variable = target_variable.strip().lower()
        items = [m for m in items if str(m.get("target_variable", "")).lower() == target_variable]
    items.sort(key=lambda m: m.get("shared_at", ""), reverse=True)
    return {"count": len(items), "models": items}


@app.post("/api/brics/resources/request")
async def request_brics_resource(payload: ResourceCoordinationRequestIn, x_session_token: str | None = Header(default=None)):
    _require_roles(x_session_token, {ROLE_COORDINATOR, ROLE_AUTHORITY})
    record = {
        "id": str(uuid.uuid4()),
        "country_code": payload.country_code,
        "request_type": payload.request_type,
        "reason": payload.reason,
        "requested_for_h3_cell": payload.requested_for_h3_cell,
        "priority": payload.priority,
        "resources_needed": payload.resources_needed,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "open",
    }
    RESOURCE_COORDINATION_REQUESTS.append(record)
    RESOURCE_COORDINATION_REQUESTS.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    del RESOURCE_COORDINATION_REQUESTS[300:]
    return record


@app.get("/api/brics/resources/requests")
async def list_brics_resource_requests(country_code: str | None = None):
    items = RESOURCE_COORDINATION_REQUESTS
    if country_code:
        normalized = country_code.strip().upper()
        if normalized not in BRICS_COUNTRIES:
            raise HTTPException(status_code=400, detail=f"country_code must be one of {sorted(BRICS_COUNTRIES)}")
        items = [r for r in items if r.get("country_code") == normalized]
    return {"count": len(items), "requests": items}


# ---------------------------------------------------------------------------
# Demo scenario
# ---------------------------------------------------------------------------

@app.post("/api/demo/seed")
async def seed_demo():
    """Seed the system with pre-scripted demo data and pre-advance the workflow.

    After seeding:
      - Citizen reports across 3 hotspot clusters are stored
      - Satellite cache is primed for dramatic demo blind-zone reveal
      - Primary hotspot (Anand Vihar) is pre-acknowledged (verifier step done)
      - Primary hotspot has an alert issued (authority step done)
      - A BRICS federated event from China is injected
    So the dashboard immediately shows a full end-to-end response in progress.
    """
    global _SATELLITE_CACHE, _DEMO_SEEDED, INCIDENTS
    # Clear previous demo data and workflow state
    fb.clear_citizen_reports()
    fb.clear_incidents()
    fb.clear_workflow_state()
    INCIDENTS.clear()
    _SATELLITE_CACHE.clear()
    _invalidate_runtime_caches(clear_satellite=False)
    FEDERATED_EVENTS.clear()
    fb.clear_federated_events()

    # Step 1: Seed citizen reports (fast — skip Gemini with is_demo=True)
    import importlib
    importlib.reload(demo_scenario)
    demo_reports = demo_scenario.get_demo_reports()
    seeded = []
    for r in demo_reports:
        report = CitizenReport(
            lat=r["lat"], lng=r["lng"],
            text=r["text"], source=r["source"],
            haze_score=r.get("haze_score"),
            is_demo=True,
        )
        result = await submit_report(report)
        seeded.append(result)

    # Step 2: Prime satellite overrides (skip slow full hotspot recalc — frontend will poll)
    for cell, score in demo_scenario.get_demo_satellite_overrides().items():
        _SATELLITE_CACHE[cell] = score
    now_iso = datetime.now(timezone.utc).isoformat()

    # Step 3: Pre-acknowledge primary hotspot (simulates verifier action)
    ack = demo_scenario.DEMO_ACKNOWLEDGE.copy()
    ack["acknowledged_at"] = now_iso
    fb.set_alert(demo_scenario.DEMO_PRIMARY_CELL, ack)

    # Step 4: Pre-issue alert (simulates authority action)
    issued = demo_scenario.DEMO_ISSUED_ALERT.copy()
    issued["issued_at"] = now_iso
    fb.set_issued_alert(demo_scenario.DEMO_PRIMARY_CELL, issued)

    # Step 5: Inject BRICS federated events (all partner countries)
    brics_count = 0
    for evt in demo_scenario.DEMO_BRICS_EVENTS:
        brics_event = evt.copy()
        brics_event["timestamp"] = now_iso
        brics_event["ingested_at"] = now_iso
        brics_event["dedupe_key"] = f"{brics_event['origin_country']}:{brics_event['h3_cell']}:{now_iso}"
        FEDERATED_EVENTS.append(brics_event)
        brics_count += 1
    fb.save_federated_events(FEDERATED_EVENTS)

    _invalidate_runtime_caches(clear_satellite=False)
    _DEMO_SEEDED = True

    return {
        "seeded": len(seeded),
        "acknowledged": demo_scenario.DEMO_PRIMARY_CELL,
        "alert_issued": demo_scenario.DEMO_PRIMARY_CELL,
        "brics_events": brics_count,
        "reports": [{"h3_cell": r["h3_cell"], "source": r["source"]} for r in seeded],
    }


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
        _rebuild_baseline_cache(_HISTORICAL_DF)
    return _HISTORICAL_DF


def _rebuild_baseline_cache(df):
    """Pre-compute baseline stats so hotspots can use O(1) lookups."""
    global _BASELINE_CACHE_HOURLY, _BASELINE_CACHE_OVERALL
    if df is None or len(df) == 0:
        _BASELINE_CACHE_HOURLY = {}
        _BASELINE_CACHE_OVERALL = {}
        return

    work = df[["h3_cell", "timestamp", "pm25"]].copy()
    work["timestamp"] = historical_data.pd.to_datetime(work["timestamp"])
    work["hour"] = work["timestamp"].dt.hour

    hourly = work.groupby(["h3_cell", "hour"]) ["pm25"].agg(["mean", "std"])
    overall = work.groupby("h3_cell")["pm25"].agg(["mean", "std"])

    _BASELINE_CACHE_HOURLY = {
        (cell, int(hour)): (
            float(row["mean"]),
            float(row["std"]) if not historical_data.pd.isna(row["std"]) else 1.0,
        )
        for (cell, hour), row in hourly.iterrows()
    }

    _BASELINE_CACHE_OVERALL = {
        cell: (
            float(row["mean"]),
            float(row["std"]) if not historical_data.pd.isna(row["std"]) else 1.0,
        )
        for cell, row in overall.iterrows()
    }


def _get_current_baseline_fast(h3_cell: str) -> tuple[float | None, float | None]:
    """Return cached mean/stddev baseline for the current UTC hour."""
    hour = datetime.now(timezone.utc).hour
    direct = _BASELINE_CACHE_HOURLY.get((h3_cell, hour))
    if direct is not None:
        return direct
    return _BASELINE_CACHE_OVERALL.get(h3_cell, (None, None))


def _get_satellite_score(cell: str) -> float:
    """Satellite aerosol signal — cached per cell."""
    if cell in _SATELLITE_CACHE:
        return _SATELLITE_CACHE[cell]

    overrides = demo_scenario.get_demo_satellite_overrides()
    if cell in overrides:
        _SATELLITE_CACHE[cell] = overrides[cell]
        return overrides[cell]

    use_ee = os.environ.get("USE_EARTH_ENGINE", "false").lower() in ("1", "true", "yes")
    score = None
    if use_ee:
        try:
            score = earth_engine_client.get_aerosol_index(cell)
        except (RuntimeError, Exception):
            pass

    if score is None:
        score = _mock_satellite_score(cell)

    _SATELLITE_CACHE[cell] = score
    return score


def _mock_satellite_score(cell: str) -> float:
    """Deterministic stand-in for Earth Engine Sentinel-5P aerosol index."""
    import hashlib
    h = int(hashlib.sha256(cell.encode()).hexdigest(), 16)
    return (h % 100) / 100.0


async def _get_hotspots_cached(max_age_seconds: float = 12.0):
    cached = _HOTSPOTS_CACHE.get("data")
    ts = float(_HOTSPOTS_CACHE.get("ts") or 0.0)
    if cached is not None and (time.time() - ts) <= max_age_seconds:
        return cached
    return await get_hotspots()


def _invalidate_runtime_caches(clear_satellite: bool = False):
    _HOTSPOTS_CACHE["ts"] = 0.0
    _HOTSPOTS_CACHE["data"] = None
    _EVIDENCE_CACHE.clear()
    if clear_satellite:
        _SATELLITE_CACHE.clear()


def _build_fallback_forecast(match: dict, hours: int = 12) -> list[dict]:
    """Fallback curve when a specific H3 cell has no historical rows."""
    base = match.get("sensor_pm25")
    if base is None:
        base = match.get("aqi_estimate")
    if base is None:
        base = 80.0
    base = float(base)

    now = datetime.now(timezone.utc)
    preds = []
    for step in range(1, hours + 1):
        trend = base * (0.98 + (step / 200.0))
        preds.append({
            "timestamp": (now + timedelta(hours=step)).isoformat(),
            "predicted_pm25": round(max(10.0, trend), 1),
        })
    return preds


async def _get_evidence_cached(h3_cell: str, max_age_seconds: float = 20.0):
    cached = _EVIDENCE_CACHE.get(h3_cell)
    if cached and (time.time() - cached.get("ts", 0.0)) <= max_age_seconds:
        return cached["payload"]

    payload = await _build_evidence_payload(h3_cell)

    # Do not cache placeholder/template AI responses. If Gemini timed out once,
    # the next request should retry live generation instead of repeating fallback.
    incident_note = str(payload.get("incident_explanation", {}).get("confidence_note", "")).lower()
    recommendation_note = str(payload.get("recommendation", {}).get("fallback_note", "")).lower()
    has_fallback_template = (
        "template explanation" in incident_note
        or "template recommendation" in recommendation_note
    )

    if not has_fallback_template:
        _EVIDENCE_CACHE[h3_cell] = {"ts": time.time(), "payload": payload}
    return payload


async def _build_evidence_payload(h3_cell: str, skip_ai: bool = False):
    hotspots = await _get_hotspots_cached(max_age_seconds=12.0)
    match = next((h for h in hotspots["hotspots"] if h["h3_cell"] == h3_cell), None)
    if match is None:
        raise HTTPException(status_code=404, detail="cell not currently a hotspot")

    impact = impact_engine.compute_impact_score(h3_cell, match.get("confidence_score", 0))
    weather = await weather_client.fetch_weather(h3_cell)

    corridor = compute_propagation_corridor(
        h3_cell,
        weather["wind_direction_deg"],
        weather["wind_speed_kmh"],
        match.get("confidence_score", 0.5),
    )
    corridor_impact = impact_engine.compute_corridor_impact(corridor, match.get("confidence_score", 0.5))

    df = _get_historical_df()
    forecast_data = None
    try:
        if not forecast.is_trained():
            forecast.train(df)
        forecast_data = forecast.forecast_cell(df, h3_cell, hours_ahead=12)
    except ValueError:
        forecast_data = _build_fallback_forecast(match, hours=12)
    except RuntimeError:
        forecast_data = _build_fallback_forecast(match, hours=12)

    spike_info = None
    if forecast_data:
        from app.services.hotspot_detection import PM25_UNHEALTHY
        now_utc = datetime.now(timezone.utc)
        for pred in forecast_data:
            if pred["predicted_pm25"] >= PM25_UNHEALTHY:
                hours_until = round((
                    datetime.fromisoformat(pred["timestamp"]) - now_utc
                ).total_seconds() / 3600, 1)
                # Only surface spikes that are genuinely in the future
                if hours_until > 0:
                    spike_info = {
                        "threshold": PM25_UNHEALTHY,
                        "predicted_value": pred["predicted_pm25"],
                        "hours_until": hours_until,
                        "timestamp": pred["timestamp"],
                    }
                break

    # Build Gemini context that matches exactly what the UI renders, so the AI
    # narrative is consistent with the numbers shown to the user.
    gemini_context = {
        "h3_cell": match.get("h3_cell"),
        "severity": match.get("severity"),
        "confidence_score": match.get("confidence_score"),
        "aqi_estimate": match.get("aqi_estimate"),
        "sensor_pm25": match.get("sensor_pm25"),
        "citizen_report_count": match.get("citizen_report_count"),
        "explanation": match.get("explanation"),
        "evidence_breakdown": match.get("evidence_breakdown"),
        # Impact numbers (same as UI)
        "population_at_risk": impact.get("population"),
        "schools_at_risk": impact.get("schools"),
        "hospitals_at_risk": impact.get("hospitals"),
        # Weather (same as UI)
        "wind_speed_kmh": weather.get("wind_speed_kmh"),
        "wind_direction_deg": weather.get("wind_direction_deg"),
        "temperature_c": weather.get("temperature_c"),
        "humidity_pct": weather.get("humidity_pct"),
        # Forecast spike (same as UI)
        "forecast_spike": spike_info,
    }
    explanation_data = gemini_context
    rec_data = {
        **gemini_context,
        "corridor_impact": corridor_impact,
    }

    if skip_ai or not os.environ.get("GEMINI_API_KEY"):
        incident_explanation = gemini_client._mock_incident_explanation(
            explanation_data,
            fallback_reason="fast_mode" if skip_ai else "missing_api_key",
        )
        if match.get("explanation"):
            incident_explanation["summary"] = match["explanation"]
        recommendation = gemini_client._mock_recommendation(
            rec_data,
            fallback_reason="fast_mode" if skip_ai else "missing_api_key",
        )
    else:
        # Run both Gemini calls concurrently. Each call uses _generate_with_timeout
        # internally (18s) so they will always complete (success or fallback) within
        # that window. We do NOT wrap with asyncio.wait_for because asyncio.to_thread
        # threads are non-cancellable — a wait_for timeout just abandons the result
        # and returns a mock while Gemini is still running in the background.
        incident_result, recommendation_result = await asyncio.gather(
            asyncio.to_thread(gemini_client.generate_incident_explanation, explanation_data),
            asyncio.to_thread(gemini_client.generate_structured_recommendation, rec_data),
            return_exceptions=True,
        )

        if isinstance(incident_result, Exception):
            incident_explanation = gemini_client._mock_incident_explanation(
                explanation_data,
                fallback_reason=f"gemini_error: {str(incident_result)[:120]}",
            )
        else:
            incident_explanation = incident_result

        if isinstance(recommendation_result, Exception):
            recommendation = gemini_client._mock_recommendation(
                rec_data,
                fallback_reason=f"gemini_error: {str(recommendation_result)[:120]}",
            )
        else:
            recommendation = recommendation_result

        if match.get("explanation") and "template explanation" in str(incident_explanation.get("confidence_note", "")).lower():
            incident_explanation["summary"] = match["explanation"]

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
# Production Single-Container SPA Static Mounting
# ---------------------------------------------------------------------------
_FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if not _FRONTEND_DIST.exists():
    _FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if not _FRONTEND_DIST.exists():
    _FRONTEND_DIST = Path("/app/frontend/dist")

if _FRONTEND_DIST.exists() and (_FRONTEND_DIST / "index.html").exists():
    from fastapi.staticfiles import StaticFiles
    from starlette.responses import FileResponse

    app.mount("/assets", StaticFiles(directory=str(_FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/") or full_path == "api":
            raise HTTPException(status_code=404, detail="API endpoint not found")
        file_path = _FRONTEND_DIST / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(_FRONTEND_DIST / "index.html")

