"""
Replayable end-to-end demo scenario for VIGIL.

POST /api/demo/seed seeds:
  1. Multiple citizen reports across two hotspot clusters
  2. Pre-acknowledged hotspot (verifier step already done)
  3. Pre-issued alert (authority step already done)
  4. BRICS federated event from a partner country

This means the dashboard immediately shows:
  - Hotspots on the map (confirmed + hidden severity)
  - Alert queue with items at different stages
  - Summary cards with non-zero numbers
  - BRICS panel with an incoming event
"""
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Pre-scripted citizen reports
# ---------------------------------------------------------------------------

DEMO_CITIZEN_REPORTS = [
    # --- Cluster A: Near Anand Vihar (has a sensor) → CONFIRMED severity ---
    {
        "lat": 28.6469, "lng": 77.3157,
        "text": "बहुत धुआँ है, साँस लेने में बहुत तकलीफ़ हो रही है। सड़क पर कुछ दिखाई नहीं दे रहा।",
        "source": "voice",
        "haze_score": 0.82,
        "scenario_note": "Hindi voice report near Anand Vihar — high haze score",
    },
    {
        "lat": 28.6520, "lng": 77.3200,
        "text": "Heavy smoke coming from the factory side, can barely see the road. Eyes burning badly.",
        "source": "text",
        "haze_score": 0.78,
        "scenario_note": "English text report, nearby location",
    },
    {
        "lat": 28.6490, "lng": 77.3180,
        "text": "Thick black smoke from the chimney, children coughing. Please help.",
        "source": "text",
        "haze_score": 0.75,
        "scenario_note": "Third report confirms the cluster — raises confidence",
    },

    # --- Cluster B: Sensor-blind zone east of Noida → HIDDEN severity ---
    {
        "lat": 28.580, "lng": 77.400,
        "text": "ధూమం చాలా ఎక్కువగా ఉంది, పిల్లలకు ఊపిరి ఆడటం లేదు. దగ్గర ఎలాంటి పర్యవేక్షణ స్టేషన్ లేదు.",
        "source": "text",
        "haze_score": 0.71,
        "scenario_note": "Telugu — children can't breathe, NO sensor in this zone",
    },
    {
        "lat": 28.582, "lng": 77.405,
        "text": "কারখানার দিক থেকে প্রচুর ধোঁয়া আসছে। এখানে কোনো সরকারি পর্যবেক্ষণ নেই।",
        "source": "text",
        "haze_score": 0.68,
        "scenario_note": "Bengali — factory smoke in sensor-blind zone",
    },
    {
        "lat": 28.578, "lng": 77.398,
        "text": "Smoke is very thick, no monitoring station anywhere near here. Air smells of burning chemicals.",
        "source": "text",
        "haze_score": 0.65,
        "scenario_note": "English noting lack of monitoring",
    },
    {
        "lat": 28.584, "lng": 77.402,
        "text": "ഫാക്ടറിയുടെ അടുത്ത് നിന്ന് വലിയ പുക വരുന്നുണ്ട്, ശ്വാസം എടുക്കാൻ ബുദ്ധിമുട്ട്.",
        "source": "voice",
        "haze_score": 0.70,
        "scenario_note": "Malayalam voice report — sensor blind zone",
    },

    # --- Cluster C: Rohini (residential spread) → CORROBORATED ---
    {
        "lat": 28.7041, "lng": 77.1025,
        "text": "Strong haze this morning, visibility under 200 metres on the highway.",
        "source": "text",
        "haze_score": 0.58,
        "scenario_note": "Rohini residential — secondary spread cluster",
    },
    {
        "lat": 28.7010, "lng": 77.1080,
        "text": "धुंध बहुत है, स्कूल के बच्चे खांस रहे हैं।",
        "source": "text",
        "haze_score": 0.55,
        "scenario_note": "Hindi — children coughing near school",
    },
]


# Cells that always show a strong satellite anomaly in the demo.
DEMO_SATELLITE_OVERRIDES = {
    "873da1068ffffff": 0.88,   # sensor-blind zone east of Noida
    "873da1149ffffff": 0.72,   # Anand Vihar corridor
    "873da10d8ffffff": 0.61,   # Rohini spread zone
}

# The primary hotspot cell for the pre-acknowledged / alert-issued demo state.
DEMO_PRIMARY_CELL = "873da1149ffffff"   # Anand Vihar — confirmed, acknowledged
DEMO_HIDDEN_CELL = "873da1068ffffff"    # Sensor-blind zone — hidden, pending

# Pre-scripted demo verifier action (auto-acknowledged for demo)
DEMO_ACKNOWLEDGE = {
    "h3_cell": DEMO_PRIMARY_CELL,
    "action_taken": "Field team dispatched to Anand Vihar — industrial inspection initiated",
    "officer_name": "Rohan Mehta (City Verifier)",
    "acknowledged_at": None,  # filled at seed time
}

# Pre-scripted authority alert
DEMO_ISSUED_ALERT = {
    "h3_cell": DEMO_PRIMARY_CELL,
    "alert_type": "public_advisory",
    "message": (
        "Air quality advisory: Residents near Anand Vihar and east Delhi "
        "should limit outdoor exposure. PM2.5 levels are elevated. Schools "
        "advised to keep children indoors. Response team deployed."
    ),
    "officer_name": "Dr. Neha Iyer (District Pollution Control)",
    "issued_at": None,  # filled at seed time
}

# Pre-scripted BRICS federated events (one per partner country)
DEMO_BRICS_EVENTS = [
    {
        "schema_version": "brics.v1",
        "origin_country": "CN",
        "h3_cell": "872a1072fffffff",
        "lat": 39.9042,
        "lng": 116.4074,
        "severity": "corroborated",
        "confidence_score": 0.74,
        "evidence_summary": "Beijing node: PM2.5 spike aligned with transboundary wind corridor toward northern India.",
        "source_system": "VIGIL-CN",
    },
    {
        "schema_version": "brics.v1",
        "origin_country": "BR",
        "h3_cell": "87a8100c7ffffff",
        "lat": -23.5505,
        "lng": -46.6333,
        "severity": "confirmed",
        "confidence_score": 0.68,
        "evidence_summary": "São Paulo: Industrial corridor smoke event — shared for model calibration.",
        "source_system": "VIGIL-BR",
    },
    {
        "schema_version": "brics.v1",
        "origin_country": "RU",
        "h3_cell": "8711aa48cffffff",
        "lat": 55.7558,
        "lng": 37.6173,
        "severity": "corroborated",
        "confidence_score": 0.61,
        "evidence_summary": "Moscow region: Seasonal biomass burning pattern matches forecast model training set.",
        "source_system": "VIGIL-RU",
    },
    {
        "schema_version": "brics.v1",
        "origin_country": "ZA",
        "h3_cell": "87b2e0a12ffffff",
        "lat": -26.2041,
        "lng": 28.0473,
        "severity": "hidden",
        "confidence_score": 0.58,
        "evidence_summary": "Johannesburg east: Sensor-blind zone detected via citizen reports only.",
        "source_system": "VIGIL-ZA",
    },
]

# Legacy single event alias
DEMO_BRICS_EVENT = DEMO_BRICS_EVENTS[0]


def get_demo_reports() -> list[dict]:
    """Return the pre-scripted citizen reports for the demo scenario."""
    return list(DEMO_CITIZEN_REPORTS)


DEMO_SCENARIO_DESCRIPTION = {
    "title": "Industrial Corridor Smoke Event — Anand Vihar, Delhi-NCR",
    "description": (
        "A sudden pollution event near Anand Vihar industrial corridor. "
        "Multiple citizens report heavy smoke in Hindi, Telugu, Bengali, "
        "Malayalam, and English. Satellite data shows an aerosol anomaly. "
        "Prevailing NW winds push pollution south-east. A sensor-blind zone "
        "is exposed purely by citizen evidence. BRICS partner shares a "
        "corroborating cross-border signal."
    ),
    "demo_sequence": [
        {"time": "0:00", "event": "Dashboard loads — hotspots and alerts already visible from seed"},
        {"time": "0:20", "event": "Citizen submits voice report in Hindi — Gemini transcribes and translates"},
        {"time": "0:40", "event": "Report mapped to H3 cell; confidence score rises"},
        {"time": "1:00", "event": "HIDDEN HOTSPOT shown — no official sensor, citizen evidence only"},
        {"time": "1:20", "event": "Evidence panel: satellite anomaly + wind corridor + forecast spike"},
        {"time": "1:40", "event": "Verifier acknowledges — field team dispatched"},
        {"time": "2:00", "event": "Authority issues public advisory alert"},
        {"time": "2:20", "event": "BRICS node receives cross-border correlation from China"},
        {"time": "2:45", "event": "Dashboard: all roles see coordinated response in progress"},
    ],
}
