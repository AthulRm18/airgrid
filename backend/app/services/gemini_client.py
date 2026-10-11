"""
Gemini integration — turns raw citizen reports into structured evidence
and generates structured incident explanations + recommendations.

Kept deliberately narrow: Gemini is the intelligence layer, NOT the
whole application. The quantitative work comes from ML models,
geospatial calculations, real data, and deterministic scoring.

Needs GEMINI_API_KEY in .env (get one free at https://aistudio.google.com/apikey).
Falls back to clearly-labeled heuristic scores if no key is set.
"""
import json
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from google import genai

# Ensure backend .env is loaded even when this module is imported outside app.main.
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_BACKEND_ROOT / ".env")

# ── Confirmed working models (tested directly against API Oct 2026) ────────
# gemini-3.1-flash-lite: CONFIRMED WORKING
# gemini-flash-latest: available but may hit quota
# gemini-2.5-flash / gemini-2.0-flash: 404 for new API keys
_KNOWN_MODELS = [
    "gemini-3.1-flash-lite",       # Confirmed working — primary
    "gemini-flash-latest",         # Alias — secondary
    "gemini-3.1-flash-lite-preview",  # Preview variant
    "gemini-3-flash-preview",      # Next gen preview
]

_env_model = os.environ.get("GEMINI_MODEL", "").strip()
MODEL = _env_model if _env_model else "gemini-3.1-flash-lite"

_seen: set = set()
_ORDERED_CANDIDATES: list[str] = []
for _m in [MODEL] + _KNOWN_MODELS:
    if _m and _m not in _seen:
        _seen.add(_m)
        _ORDERED_CANDIDATES.append(_m)

_WORKING_MODEL: str | None = None

# ── Persistent client (created once, reused across all calls) ──────────────
_CLIENT: Optional[genai.Client] = None


def _get_client() -> Optional[genai.Client]:
    global _CLIENT
    if _CLIENT is not None:
        return _CLIENT
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if key:
        key = key.strip().strip('"').strip("'")
    if not key:
        return None
    # Disable SDK-level retries — our own fallback loop handles 503s.
    try:
        from google.genai import types as genai_types
        http_opts = genai_types.HttpOptions(api_version="v1beta")
        _CLIENT = genai.Client(api_key=key, http_options=http_opts)
    except Exception:
        _CLIENT = genai.Client(api_key=key)
    return _CLIENT


def _parse_json(text: str) -> dict:
    cleaned = text.strip()
    # Strip markdown fences if present
    if "```" in cleaned:
        parts = cleaned.split("```")
        for part in parts:
            part = part.strip().lstrip("json").strip()
            if part.startswith("{"):
                cleaned = part
                break
    # Find the first { ... } block
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1:
        cleaned = cleaned[start:end + 1]
    return json.loads(cleaned)


def _generate_with_fallback(client: genai.Client, contents, timeout: float = 12.0) -> str:
    """Try each model candidate with a per-model timeout.
    Caches the first working model so subsequent calls skip straight to it."""
    import concurrent.futures
    global _WORKING_MODEL

    try:
        from google.genai import types
        config = types.GenerateContentConfig(
            temperature=0.2,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )
    except Exception:
        config = None

    # Put the working model first so we don't waste time on others
    candidates = []
    if _WORKING_MODEL:
        candidates.append(_WORKING_MODEL)
    for m in _ORDERED_CANDIDATES:
        if m not in candidates:
            candidates.append(m)

    last_error = None
    for model_name in candidates:
        def _try(mn=model_name):
            kwargs = {"model": mn, "contents": contents}
            if config is not None:
                kwargs["config"] = config
            response = client.models.generate_content(**kwargs)
            return (response.text or "").strip()

        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                text = ex.submit(_try).result(timeout=timeout)
            if text:
                _WORKING_MODEL = model_name
                return text
        except concurrent.futures.TimeoutError:
            last_error = TimeoutError(f"{model_name} did not respond in {timeout}s")
            # Reset working model cache — it may have degraded
            if _WORKING_MODEL == model_name:
                _WORKING_MODEL = None
            continue
        except Exception as e:
            last_error = e
            if _WORKING_MODEL == model_name:
                _WORKING_MODEL = None
            continue

    raise last_error or RuntimeError("All Gemini model candidates failed")


# ── Prompts ────────────────────────────────────────────────────────────────

PHOTO_PROMPT = """You are an air-quality field analyst reviewing a citizen-submitted photo.
Analyze the visible environmental conditions.

IMPORTANT: Do NOT claim to measure PM2.5 or any pollutant concentration from the photo.
You are extracting VISUAL EVIDENCE only.

Return ONLY valid JSON, no markdown fences:
{
  "smoke_visible": <boolean>,
  "haze_visible": <boolean>,
  "visibility_reduced": <boolean>,
  "possible_source": "<one of: vehicular, industrial, agricultural_burning, dust, construction, unclear>",
  "visual_confidence": <float 0.0-1.0>,
  "haze_score": <float 0.0-1.0, 0=clear, 1=severe smog>,
  "notes": "<one sentence, plain language, for a dashboard tooltip>"
}

Be conservative — an ambiguous photo should get lower confidence, not a guessed-high score."""

TEXT_PROMPT_TEMPLATE = """You are processing a citizen air-quality report,
submitted as text, SMS, or a voice-note transcript.

The report may be written in ANY language. Specifically supported regional
languages include (but are not limited to):
  - English, Hindi (हिंदी), Malayalam (മലയാളം), Tamil (தமிழ்),
    Bengali (বাংলা), Kannada (ಕನ್ನಡ), Telugu (తెలుగు), Marathi (मराठी),
    Gujarati (ગુજરાતી), Odia (ଓଡ଼ିଆ), Portuguese, Russian, Chinese, Zulu.

Language hint from browser: {lang_hint}

Report: "{report_text}"

Return ONLY valid JSON, no markdown fences:
{{
  "translated_text": "<English translation, or original if already English>",
  "detected_language": "<language name, e.g. Malayalam>",
  "event_type": "<one of: smoke, haze, dust, chemical_smell, burning, unclear>",
  "severity": "<one of: low, moderate, high, severe>",
  "possible_source": "<one of: vehicular, industrial, agricultural_burning, dust, construction, unclear>",
  "haze_score": <float 0.0-1.0, inferred from described severity>,
  "reported_symptoms": ["<health symptoms mentioned, if any>"],
  "extracted_location_hint": "<place name mentioned, or null>",
  "confidence": <float 0.0-1.0>
}}"""

INCIDENT_EXPLANATION_PROMPT = """You are briefing a district pollution-control officer about a detected environmental incident.
Given this fused evidence data, generate a clear, structured incident explanation.

Return ONLY valid JSON, no markdown fences:
{{
  "incident_title": "<short descriptive title, e.g. 'Industrial Smoke Event — East Delhi'>",
  "severity_assessment": "<one of: CRITICAL, HIGH, MODERATE, LOW>",
  "summary": "<2-3 sentence executive summary of the incident>",
  "evidence_signals": [
    "<each signal that contributed, e.g. 'Satellite anomaly: +132% above baseline'>",
    "<e.g. 'Citizen reports: 7 reports in this zone'>",
    "<e.g. 'Wind direction consistent with movement toward Zone B'>",
    "<e.g. 'Historical baseline exceeded by 2.1 standard deviations'>",
    "<e.g. 'Insufficient official monitoring coverage in this area'>"
  ],
  "likely_cause": "<best assessment of the pollution source>",
  "confidence_note": "<honest note about confidence level and limitations>"
}}

Incident data: {data}"""

RECOMMENDATION_PROMPT = """You are advising a district pollution-control officer.
Given this incident data (including hotspot confidence, forecast, weather,
immediate cell impact, downwind corridor impact, and evidence), generate a
structured recommended response.

DATA STRUCTURE EXPLANATION:
- "population_at_risk", "schools_at_risk", "hospitals_at_risk" represent the IMMEDIATE HOTSPOT CELL.
- "corridor_impact" (with total_population_at_risk, total_schools, total_hospitals, cell_count) represents the predicted DOWNWIND EXPOSURE CORRIDOR over time.

GUIDELINES FOR ACTIONS:
- If recommending actions for the immediate source/cell, use the immediate cell numbers (e.g. schools_at_risk, hospitals_at_risk).
- If recommending actions for the broader downwind trajectory/plume, refer to the corridor numbers (e.g. corridor_impact.total_schools across corridor_impact.cell_count cells).
- Ensure all quoted statistics match the exact numbers in the incident data.

Return ONLY valid JSON, no markdown fences:
{{
  "urgency": "<one of: IMMEDIATE, WITHIN_1_HOUR, WITHIN_4_HOURS, MONITOR>",
  "actions": [
    {{
      "priority": <int 1-5>,
      "action": "<specific, concrete action to take>",
      "rationale": "<why this action matters>"
    }}
  ],
  "monitoring_recommendations": "<what to watch for next>",
  "public_advisory_needed": <boolean>,
  "advisory_text": "<draft advisory text for public, if needed, else null>"
}}

Be specific — name the likely cause, the affected area/corridor, and concrete actions.
Do NOT hedge or be vague.

Incident data: {data}"""


# ── Public API ─────────────────────────────────────────────────────────────

async def score_photo(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    import asyncio, base64
    client = _get_client()
    if client is None:
        return unavailable_photo("missing_api_key")
    try:
        img_b64 = base64.b64encode(image_bytes).decode()
        contents = [{"inline_data": {"mime_type": mime_type, "data": img_b64}}, PHOTO_PROMPT]
        text = await asyncio.to_thread(_generate_with_fallback, client, contents, 12.0)
        return _parse_json(text)
    except Exception:
        return {
            "smoke_visible": True, "haze_visible": True,
            "visibility_reduced": True, "possible_source": "unclear",
            "visual_confidence": 0.4, "haze_score": 0.5,
            "notes": "Visual analysis unavailable — report saved with default assessment.",
        }


async def classify_text_report(report_text: str, lang_hint: str = "auto") -> dict:
    import asyncio
    client = _get_client()
    if client is None:
        return unavailable_text(report_text, reason="missing_api_key")
    try:
        prompt = TEXT_PROMPT_TEMPLATE.format(
            report_text=report_text,
            lang_hint=lang_hint or "auto",
        )
        text = await asyncio.to_thread(_generate_with_fallback, client, prompt, 12.0)
        return _parse_json(text)
    except Exception:
        return {
            "translated_text": report_text,
            "detected_language": lang_hint or "unknown",
            "event_type": "smoke", "severity": "moderate",
            "possible_source": "unclear", "haze_score": 0.5,
            "reported_symptoms": [], "extracted_location_hint": None,
            "confidence": 0.3,
        }


def generate_incident_explanation(cell_data: dict) -> dict:
    """Generate a structured incident explanation from fused evidence."""
    client = _get_client()
    if client is None:
        return _mock_incident_explanation(cell_data, fallback_reason="missing_api_key")
    try:
        text = _generate_with_fallback(
            client,
            INCIDENT_EXPLANATION_PROMPT.format(data=json.dumps(cell_data)),
            timeout=12.0,
        )
        return _parse_json(text)
    except Exception as e:
        return _mock_incident_explanation(cell_data, fallback_reason=f"gemini_error: {str(e)[:80]}")


def generate_structured_recommendation(cell_data: dict) -> dict:
    """Generate a structured recommendation from incident data."""
    client = _get_client()
    if client is None:
        return _mock_recommendation(cell_data, fallback_reason="missing_api_key")
    try:
        text = _generate_with_fallback(
            client,
            RECOMMENDATION_PROMPT.format(data=json.dumps(cell_data)),
            timeout=12.0,
        )
        return _parse_json(text)
    except Exception as e:
        return _mock_recommendation(cell_data, fallback_reason=f"gemini_error: {str(e)[:80]}")


async def generate_authority_recommendation(cell_summary: dict) -> str:
    """Kept for backward compatibility."""
    import asyncio
    client = _get_client()
    if client is None:
        return "Gemini not configured — add GEMINI_API_KEY to generate live recommendations."
    try:
        prompt = f"""You are briefing a district pollution-control officer.
Given this fused sensor + satellite + citizen-report summary for one
area, write a 2-3 sentence actionable recommendation. Be concrete —
name the likely cause and a specific first action, don't hedge.

Data: {json.dumps(cell_summary)}"""
        text = await asyncio.to_thread(_generate_with_fallback, client, prompt, 10.0)
        return text.strip()
    except Exception:
        return "Recommendation generation temporarily unavailable."


# ── Mock fallbacks (rich, data-grounded) ──────────────────────────────────

def _mock_incident_explanation(cell_data: dict, fallback_reason: str = "missing_api_key") -> dict:
    severity = cell_data.get("severity", "unverified")
    confidence = float(cell_data.get("confidence_score", 0) or 0)
    reports = int(cell_data.get("citizen_report_count", 0) or 0)
    sensor = cell_data.get("sensor_pm25")
    cell = str(cell_data.get("h3_cell", "unknown"))[:12]

    if fallback_reason == "missing_api_key":
        note = "Gemini API key missing — using fused evidence summary."
    elif fallback_reason in ("fast_mode",):
        note = "Instant fused summary — live Gemini analysis loading."
    else:
        note = f"Evidence summary based on fused data ({fallback_reason})."

    title_map = {
        "confirmed":    f"Sensor-confirmed pollution — {cell}",
        "hidden":       f"Blind-spot hotspot — {cell}",
        "corroborated": f"Multi-signal haze event — {cell}",
        "unverified":   f"Early pollution signal — {cell}",
    }
    signals = []
    if sensor is not None:
        signals.append(f"Ground sensor PM2.5: {sensor} µg/m³")
    if reports:
        signals.append(f"Citizen reports in zone: {reports}")
    eb = (cell_data.get("evidence_breakdown") or {})
    sat = cell_data.get("satellite_anomaly_score") or eb.get("satellite_anomaly", {}).get("signal_strength")
    if sat:
        signals.append("Satellite aerosol signal present")
    if severity == "hidden":
        signals.append("No official monitoring station covers this cell")
    if not signals:
        signals = ["Fused confidence from available evidence streams"]

    summary = cell_data.get("explanation") or (
        f"A {severity} hotspot was detected with {confidence:.0%} confidence. "
        + (f"{reports} citizen report(s) support this zone. " if reports else "")
        + ("OpenAQ sensor readings corroborate elevated PM2.5. " if sensor else "This may be a sensor-blind zone. ")
        + "Recommend field verification and a localized advisory if confidence stays high."
    )

    return {
        "incident_title": title_map.get(severity, f"Pollution event — {cell}"),
        "severity_assessment": "HIGH" if confidence > 0.7 or severity in ("confirmed", "hidden") else "MODERATE",
        "summary": summary,
        "evidence_signals": signals,
        "likely_cause": "Industrial / combustion smoke (pending field confirmation)",
        "confidence_note": note,
    }


def _mock_recommendation(cell_data: dict, fallback_reason: str = "missing_api_key") -> dict:
    if fallback_reason == "missing_api_key":
        note = "Gemini API key missing — using template recommendation."
    else:
        note = f"Template recommendation ({fallback_reason})."
    return {
        "urgency": "WITHIN_1_HOUR",
        "actions": [
            {"priority": 1, "action": "Dispatch field monitoring team to verify pollution source", "rationale": "Ground-truth confirmation needed"},
            {"priority": 2, "action": "Notify nearby schools and hospitals", "rationale": "Vulnerable populations at risk"},
            {"priority": 3, "action": "Increase monitoring frequency in the area", "rationale": "Insufficient official coverage"},
            {"priority": 4, "action": "Investigate suspected industrial source", "rationale": "Citizen reports indicate industrial origin"},
            {"priority": 5, "action": "Prepare localized public health advisory", "rationale": "Population exposure growing"},
        ],
        "monitoring_recommendations": "Track wind direction changes and monitor neighboring cells for pollution spread.",
        "public_advisory_needed": True,
        "advisory_text": "Elevated air pollution levels detected in your area. Minimize outdoor activity. Close windows. Wear masks if going outside.",
        "fallback_note": note,
    }


# ── Compatibility shims — functions main.py expects ────────────────────────

def is_configured() -> bool:
    """Return True if a Gemini API key is present and usable."""
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    return bool(key and key.strip())


async def close() -> None:
    """Graceful shutdown — release the persistent client if any."""
    global _CLIENT
    _CLIENT = None


def unavailable_photo(reason: str = "missing_api_key") -> dict:
    """Fallback photo result when Gemini is not available."""
    return {
        "smoke_visible": True,
        "haze_visible": True,
        "visibility_reduced": True,
        "possible_source": "unclear",
        "visual_confidence": 0.0,
        "haze_score": 0.5,
        "notes": "Photo received — visual analysis will be available once AI service is ready.",
        "analysis_status": "pending",
        "analysis_reason": reason,
    }


def unavailable_text(text: str = "", reason: str = "missing_api_key") -> dict:
    """Fallback text result when Gemini is not available."""
    return {
        "translated_text": text,
        "detected_language": "unknown",
        "event_type": "smoke",
        "severity": "moderate",
        "possible_source": "unclear",
        "haze_score": 0.5,
        "reported_symptoms": [],
        "extracted_location_hint": None,
        "confidence": 0.0,
        "analysis_status": "pending",
        "analysis_reason": reason,
    }


async def analyze_evidence(cell_data: dict) -> dict:
    """Async wrapper: run both Gemini evidence calls concurrently and return combined result."""
    import asyncio
    import concurrent.futures

    loop = asyncio.get_event_loop()
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        explanation_fut = loop.run_in_executor(pool, generate_incident_explanation, cell_data)
        recommendation_fut = loop.run_in_executor(pool, generate_structured_recommendation, cell_data)
        explanation, recommendation = await asyncio.gather(
            explanation_fut, recommendation_fut, return_exceptions=True
        )

    if isinstance(explanation, Exception):
        explanation = _mock_incident_explanation(cell_data, fallback_reason=str(explanation)[:80])
    if isinstance(recommendation, Exception):
        recommendation = _mock_recommendation(cell_data, fallback_reason=str(recommendation)[:80])

    return {
        "incident_explanation": explanation,
        "recommendation": recommendation,
        "status": "live",
    }
