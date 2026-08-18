"""
Gemini integration — turns a raw citizen report (photo or text/voice
transcript) into the structured signal hotspot_detection.py needs
(haze_score, likely source, translated text).

Kept deliberately narrow: Gemini scores one photo or classifies one
report at a time. It is NOT the whole app — it's one component in the
Detect -> Recommend -> Notify -> Acknowledge pipeline, which is exactly
what the hackathon's own build guide asks for ("do not make Gemini the
entire application").

Needs GEMINI_API_KEY in .env (get one free at https://aistudio.google.com/apikey).
Falls back to a clearly-labeled heuristic score if no key is set, so the
rest of the pipeline stays demoable while you're waiting on a key.
"""
import json
import os
from typing import Optional

from google import genai

MODEL = "gemini-2.5-flash"

PHOTO_PROMPT = """You are an air-quality field analyst reviewing a citizen-
submitted photo. Score the visible air pollution.

Return ONLY valid JSON, no markdown fences:
{
  "haze_score": <float 0.0-1.0, 0=clear sky, 1=severe smog/near-zero visibility>,
  "likely_source": "<one of: vehicular, industrial, agricultural_burning, dust, construction, unclear>",
  "confidence": <float 0.0-1.0>,
  "notes": "<one sentence, plain language, for a dashboard tooltip>"
}
Be conservative — an ambiguous photo should get lower confidence, not a
guessed-high haze_score."""

TEXT_PROMPT_TEMPLATE = """You are processing a citizen air-quality report,
submitted as text, SMS, or a voice-note transcript. It may be in any
language spoken in India, Brazil, Russia, China, or South Africa.

Report: "{report_text}"

Return ONLY valid JSON, no markdown fences:
{{
  "translated_text": "<English translation, or original if already English>",
  "detected_language": "<language name>",
  "haze_score": <float 0.0-1.0, inferred from described severity>,
  "reported_symptoms": ["<health symptoms mentioned, if any>"],
  "extracted_location_hint": "<place name mentioned, or null>"
}}"""


def _get_client() -> Optional[genai.Client]:
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        return None
    return genai.Client(api_key=key)


def _parse_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1].replace("json", "", 1).strip()
    return json.loads(cleaned)


def score_photo(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    client = _get_client()
    if client is None:
        return {
            "haze_score": 0.6, "likely_source": "unclear", "confidence": 0.0,
            "notes": "GEMINI_API_KEY not set — placeholder score, wire up your key.",
        }
    response = client.models.generate_content(
        model=MODEL,
        contents=[{"inline_data": {"mime_type": mime_type, "data": image_bytes}}, PHOTO_PROMPT],
    )
    return _parse_json(response.text)


def classify_text_report(report_text: str) -> dict:
    client = _get_client()
    if client is None:
        return {
            "translated_text": report_text, "detected_language": "unknown",
            "haze_score": 0.5, "reported_symptoms": [], "extracted_location_hint": None,
        }
    response = client.models.generate_content(
        model=MODEL, contents=TEXT_PROMPT_TEMPLATE.format(report_text=report_text)
    )
    return _parse_json(response.text)


def generate_authority_recommendation(cell_summary: dict) -> str:
    """RECOMMEND step: turn a fused cell summary into a short, actionable
    brief for a district authority reviewing the alert queue."""
    client = _get_client()
    if client is None:
        return "Gemini not configured — add GEMINI_API_KEY to generate live recommendations."
    prompt = f"""You are briefing a district pollution-control officer.
Given this fused sensor + satellite + citizen-report summary for one
area, write a 2-3 sentence actionable recommendation. Be concrete —
name the likely cause and a specific first action, don't hedge.

Data: {json.dumps(cell_summary)}"""
    response = client.models.generate_content(model=MODEL, contents=prompt)
    return response.text.strip()
