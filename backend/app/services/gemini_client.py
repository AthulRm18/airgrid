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

# Primary model can be overridden via GEMINI_MODEL.
# Keep a fallback list with broadly-available model IDs.
MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
MODEL_CANDIDATES = [
    MODEL,
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-1.5-flash",
]
_DISCOVERED_MODELS: list[str] = []

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
submitted as text, SMS, or a voice-note transcript. It may be in any
language spoken in India, Brazil, Russia, China, or South Africa.

Report: "{report_text}"

Return ONLY valid JSON, no markdown fences:
{{
  "translated_text": "<English translation, or original if already English>",
  "detected_language": "<language name>",
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
affected population, schools, hospitals, and evidence), generate a
structured recommended response.

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

Be specific — name the likely cause, the affected area, and concrete actions.
Do NOT hedge or be vague.

Incident data: {data}"""


def _get_client() -> Optional[genai.Client]:
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if key:
        key = key.strip().strip('"').strip("'")
    if not key:
        return None
    return genai.Client(api_key=key)


def _parse_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1].replace("json", "", 1).strip()
    return json.loads(cleaned)


def _candidate_models(client: genai.Client) -> list[str]:
    if _DISCOVERED_MODELS:
        return list(dict.fromkeys(MODEL_CANDIDATES + _DISCOVERED_MODELS))

    discovered: list[str] = []
    try:
        for model in client.models.list():
            name = getattr(model, "name", "") or ""
            short_name = name.split("/", 1)[-1] if name.startswith("models/") else name
            if "gemini" not in short_name:
                continue
            if "flash" in short_name or "pro" in short_name:
                discovered.append(short_name)
            if len(discovered) >= 8:
                break
    except Exception:
        discovered = []

    _DISCOVERED_MODELS.extend(discovered)
    return list(dict.fromkeys(MODEL_CANDIDATES + discovered))


def _generate_with_fallback(client: genai.Client, contents) -> str:
    """Try a small ordered set of models so transient deprecations don't break runtime."""
    last_error = None
    for model_name in _candidate_models(client):
        try:
            response = client.models.generate_content(model=model_name, contents=contents)
            return response.text or ""
        except Exception as e:
            last_error = e
            continue
    if last_error:
        raise last_error
    raise RuntimeError("Gemini generation failed with no candidate models attempted")


def score_photo(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    client = _get_client()
    if client is None:
        return {
            "smoke_visible": True, "haze_visible": True,
            "visibility_reduced": True, "possible_source": "unclear",
            "visual_confidence": 0.0, "haze_score": 0.6,
            "notes": "GEMINI_API_KEY not set — placeholder score.",
        }
    try:
        text = _generate_with_fallback(
            client,
            [{"inline_data": {"mime_type": mime_type, "data": image_bytes}}, PHOTO_PROMPT],
        )
        return _parse_json(text)
    except Exception as e:
        return {
            "smoke_visible": False, "haze_visible": False,
            "visibility_reduced": False, "possible_source": "unclear",
            "visual_confidence": 0.0, "haze_score": 0.3,
            "notes": f"Gemini error: {str(e)[:80]}",
        }


def classify_text_report(report_text: str) -> dict:
    client = _get_client()
    if client is None:
        return {
            "translated_text": report_text, "detected_language": "unknown",
            "event_type": "unclear", "severity": "moderate",
            "possible_source": "unclear",
            "haze_score": 0.5, "reported_symptoms": [],
            "extracted_location_hint": None, "confidence": 0.0,
        }
    try:
        text = _generate_with_fallback(
            client,
            TEXT_PROMPT_TEMPLATE.format(report_text=report_text),
        )
        return _parse_json(text)
    except Exception as e:
        return {
            "translated_text": report_text, "detected_language": "unknown",
            "event_type": "unclear", "severity": "moderate",
            "possible_source": "unclear",
            "haze_score": 0.4, "reported_symptoms": [],
            "extracted_location_hint": None, "confidence": 0.0,
            "error": str(e)[:80],
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
        )
        return _parse_json(text)
    except Exception as e:
        return _mock_incident_explanation(cell_data, fallback_reason=f"gemini_error: {str(e)[:120]}")


def generate_structured_recommendation(cell_data: dict) -> dict:
    """Generate a structured recommendation from incident data."""
    client = _get_client()
    if client is None:
        return _mock_recommendation(cell_data, fallback_reason="missing_api_key")
    try:
        text = _generate_with_fallback(
            client,
            RECOMMENDATION_PROMPT.format(data=json.dumps(cell_data)),
        )
        return _parse_json(text)
    except Exception as e:
        return _mock_recommendation(cell_data, fallback_reason=f"gemini_error: {str(e)[:120]}")


def generate_authority_recommendation(cell_summary: dict) -> str:
    """RECOMMEND step: turn a fused cell summary into a short, actionable
    brief for a district authority reviewing the alert queue.
    Kept for backward compatibility — new code should prefer
    generate_structured_recommendation()."""
    client = _get_client()
    if client is None:
        return "Gemini not configured — add GEMINI_API_KEY to generate live recommendations."
    try:
        prompt = f"""You are briefing a district pollution-control officer.
Given this fused sensor + satellite + citizen-report summary for one
area, write a 2-3 sentence actionable recommendation. Be concrete —
name the likely cause and a specific first action, don't hedge.

Data: {json.dumps(cell_summary)}"""
        text = _generate_with_fallback(client, prompt)
        return text.strip()
    except Exception:
        return "Recommendation generation temporarily unavailable."


def _mock_incident_explanation(cell_data: dict, fallback_reason: str = "missing_api_key") -> dict:
    severity = cell_data.get("severity", "unverified")
    confidence = cell_data.get("confidence_score", 0)
    if fallback_reason == "missing_api_key":
        note = "Gemini API key missing - using template explanation."
    else:
        note = f"Gemini temporarily unavailable - using template explanation ({fallback_reason})."
    return {
        "incident_title": f"Pollution Event — H3 {cell_data.get('h3_cell', 'unknown')[:12]}",
        "severity_assessment": "HIGH" if confidence > 0.7 else "MODERATE",
        "summary": (
            "Multi-signal evidence indicates a localized pollution event. "
            f"Hotspot confidence is {confidence:.0%}. "
            "Further monitoring and investigation recommended."
        ),
        "evidence_signals": [
            f"Satellite anomaly score: {cell_data.get('satellite_anomaly_score', 'N/A')}",
            f"Citizen reports in zone: {cell_data.get('citizen_report_count', 0)}",
            f"Sensor PM2.5: {cell_data.get('sensor_pm25', 'No sensor')} µg/m³",
        ],
        "likely_cause": "Under investigation",
        "confidence_note": note,
    }


def _mock_recommendation(cell_data: dict, fallback_reason: str = "missing_api_key") -> dict:
    if fallback_reason == "missing_api_key":
        note = "Gemini API key missing - using template recommendation."
    else:
        note = f"Gemini temporarily unavailable - using template recommendation ({fallback_reason})."
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
