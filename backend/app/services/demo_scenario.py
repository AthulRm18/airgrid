"""
Replayable end-to-end demo scenario for CONFLUX.

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
from h3 import latlng_to_cell

# ---------------------------------------------------------------------------
# Pre-scripted citizen reports
# ---------------------------------------------------------------------------

DEMO_CITIZEN_REPORTS = [
    # --- Cluster A: Delhi Anand Vihar (has a sensor) → CONFIRMED severity ---
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

    # --- Cluster B: Kochi Eloor Industrial Belt, Kerala (Sensor-blind zone) → HIDDEN severity ---
    {
        "lat": 10.0760, "lng": 76.2990,
        "text": "ഏലൂർ വ്യവസായ മേഖലയിൽ നിന്ന് കനത്ത രാസഗന്ധവും പുകയും വരുന്നു. ശ്വാസമെടുക്കാൻ വല്ലാത്ത ബുദ്ധിമുട്ട്.",
        "source": "voice",
        "haze_score": 0.85,
        "scenario_note": "Malayalam voice report — Eloor industrial zone sensor-blind hotspot",
    },
    {
        "lat": 10.0780, "lng": 76.3015,
        "text": "Chemical smoke spreading over Periyar river banks, visibility very low, eye irritation in school children.",
        "source": "text",
        "haze_score": 0.78,
        "scenario_note": "English report from Kochi Eloor corridor",
    },
    {
        "lat": 10.0745, "lng": 76.2970,
        "text": "ഫാക്ടറിയിൽ നിന്ന് കറുത്ത പുക ഉയരുന്നുണ്ട്. ഇവിടെ ഔദ്യോഗിക മോണിറ്ററിംഗ് സ്റ്റേഷനുകൾ ഒന്നുമില്ല.",
        "source": "voice",
        "haze_score": 0.80,
        "scenario_note": "Malayalam noting lack of official monitoring in Kochi",
    },

    # --- Cluster C: Mumbai Chembur Industrial, Maharashtra → CORROBORATED ---
    {
        "lat": 19.0522, "lng": 72.9005,
        "text": "Chembur refinery area has dense smog since early morning, strong sulfur smell.",
        "source": "text",
        "haze_score": 0.76,
        "scenario_note": "Mumbai Chembur industrial corridor",
    },
    {
        "lat": 19.0540, "lng": 72.9030,
        "text": "रिफाइनरी जवळ खूप धूर पसरला आहे, श्वास घ्यायला त्रास होतोय.",
        "source": "text",
        "haze_score": 0.74,
        "scenario_note": "Marathi report — Mumbai refinery cluster",
    },
    {
        "lat": 19.0510, "lng": 72.8980,
        "text": "Heavy industrial smog near Mahul village. Children are complaining of nausea.",
        "source": "text",
        "haze_score": 0.72,
        "scenario_note": "Mumbai Chembur cluster report",
    },

    # --- Cluster D: Bengaluru Peenya Industrial, Karnataka → CORROBORATED ---
    {
        "lat": 13.0285, "lng": 77.5197,
        "text": "ದಟ್ಟವಾದ ಹೊಗೆ ಮತ್ತು ರಾಸಾಯನಿಕ ವಾಸನೆ ಪೀಣ್ಯ ಕೈಗಾರಿಕಾ ಪ್ರದೇಶದಿಂದ ಬರುತ್ತಿದೆ.",
        "source": "voice",
        "haze_score": 0.80,
        "scenario_note": "Kannada voice report — Peenya industrial cluster",
    },
    {
        "lat": 13.0310, "lng": 77.5220,
        "text": "Toxic fumes and particulate haze over Peenya 2nd stage industrial area.",
        "source": "text",
        "haze_score": 0.76,
        "scenario_note": "English report — Peenya Bengaluru",
    },

    # --- Cluster E: Kolkata Howrah Industrial, West Bengal → CORROBORATED ---
    {
        "lat": 22.5958, "lng": 88.2636,
        "text": "হাওড়া শিল্পাঞ্চল থেকে প্রচণ্ড কালো ধোঁয়া বের হচ্ছে, চোখে জ্বালা করছে।",
        "source": "voice",
        "haze_score": 0.82,
        "scenario_note": "Bengali voice report — Howrah industrial belt",
    },
    {
        "lat": 22.5980, "lng": 88.2660,
        "text": "Heavy furnace emissions spreading across Howrah near the highway.",
        "source": "text",
        "haze_score": 0.75,
        "scenario_note": "English report — Howrah Kolkata",
    },
]


def get_demo_satellite_overrides() -> dict[str, float]:
    """Dynamically compute satellite anomaly overrides for all multi-state demo clusters."""
    overrides = {
        "873da1068ffffff": 0.88,   # sensor-blind zone east of Noida
        "873da1149ffffff": 0.72,   # Anand Vihar corridor
        "873da10d8ffffff": 0.61,   # Rohini spread zone
    }
    for r in DEMO_CITIZEN_REPORTS:
        cell = latlng_to_cell(r["lat"], r["lng"], 7)
        overrides[cell] = max(overrides.get(cell, 0.0), 0.78)
    return overrides


# Legacy dict alias
DEMO_SATELLITE_OVERRIDES = get_demo_satellite_overrides()

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
        "source_system": "CONFLUX-CN",
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
        "source_system": "CONFLUX-BR",
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
        "source_system": "CONFLUX-RU",
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
        "source_system": "CONFLUX-ZA",
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
