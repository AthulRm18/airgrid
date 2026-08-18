"""
Replayable demo scenario for VIGIL hackathon presentation.

Provides pre-seeded citizen reports and a scripted timeline so the
3-minute demo walkthrough never depends on live APIs producing an
interesting event at the right moment.

Usage:
  POST /api/demo/start   → seeds the system with demo data
  GET  /api/demo/status   → current demo state

The scenario is based on a realistic Delhi-NCR industrial corridor
event: smoke from agricultural/industrial burning near Anand Vihar
spreading south-east with prevailing NW winds.
"""
from datetime import datetime, timezone


# Pre-scripted citizen reports for the demo
DEMO_CITIZEN_REPORTS = [
    # --- Reports near Anand Vihar (HAS sensor) → triggers CONFIRMED ---
    {
        "lat": 28.6469, "lng": 77.3157,
        "text": "बहुत धुआँ है, साँस लेने में तकलीफ़ हो रही है",
        "source": "voice",
        "scenario_note": "Hindi voice report near Anand Vihar industrial area",
    },
    {
        "lat": 28.6520, "lng": 77.3200,
        "text": "Heavy smoke coming from the factory side, can barely see the road",
        "source": "text",
        "scenario_note": "English text report, nearby location",
    },
    # --- Reports in SENSOR-BLIND ZONE (east of Noida) → triggers HIDDEN ---
    # These land in H3 cell 873da1068ffffff which has NO official sensor
    {
        "lat": 28.580, "lng": 77.400,
        "text": "ధూమం చాలా ఎక్కువగా ఉంది, పిల్లలకు ఊపిరి ఆడటం లేదు",
        "source": "text",
        "scenario_note": "Telugu report — children can't breathe, NO SENSOR in this zone",
    },
    {
        "lat": 28.582, "lng": 77.405,
        "text": "কারখানার দিক থেকে প্রচুর ধোঁয়া আসছে",
        "source": "text",
        "scenario_note": "Bengali report about factory smoke in sensor-blind zone",
    },
    {
        "lat": 28.578, "lng": 77.398,
        "text": "Smoke is very thick, no monitoring station anywhere near here",
        "source": "text",
        "scenario_note": "English report noting lack of monitoring",
    },
    {
        "lat": 28.584, "lng": 77.402,
        "text": "ഫാക്ടറിയുടെ അടുത്ത് നിന്ന് വലിയ പുക വരുന്നുണ്ട്, ശ്വാസം എടുക്കാൻ ബുദ്ധിമുട്ട്",
        "source": "voice",
        "scenario_note": "Malayalam voice report about difficulty breathing — sensor blind zone",
    },
    {
        "lat": 28.576, "lng": 77.403,
        "text": "Eyes are burning, there is some kind of chemical smell in the air. No govt sensor nearby.",
        "source": "text",
        "scenario_note": "English report about chemical smell in unmonitored area",
    },
]


def get_demo_reports() -> list[dict]:
    """Return the pre-scripted citizen reports for the demo scenario."""
    return [
        {**r, "scenario_note": r.get("scenario_note", "")}
        for r in DEMO_CITIZEN_REPORTS
    ]


DEMO_SCENARIO_DESCRIPTION = {
    "title": "Industrial Corridor Smoke Event — Anand Vihar, Delhi-NCR",
    "description": (
        "A sudden pollution event is detected near the Anand Vihar industrial "
        "corridor in east Delhi. Official monitoring stations are sparse in this "
        "area. Multiple citizens report heavy smoke, reduced visibility, and "
        "respiratory distress in Hindi, Telugu, Bengali, Malayalam, and English. "
        "Satellite data shows an aerosol anomaly. Prevailing NW winds push the "
        "pollution south-east toward densely populated residential areas with "
        "schools and hospitals."
    ),
    "demo_sequence": [
        {"time": "0:00", "event": "Normal environmental map displayed"},
        {"time": "0:15", "event": "Citizen submits voice report in Hindi about heavy smoke"},
        {"time": "0:30", "event": "Gemini processes: Hindi detected, translated, smoke classified, confidence scored"},
        {"time": "0:50", "event": "Report mapped to H3 cell near Anand Vihar"},
        {"time": "1:00", "event": "Satellite anomaly + ground sensor evidence + historical deviation shown"},
        {"time": "1:15", "event": "HIDDEN HOTSPOT DETECTED — 94% confidence"},
        {"time": "1:30", "event": "Forecast shows PM2.5 spike in 4.2 hours"},
        {"time": "1:45", "event": "Wind-aware propagation corridor appears on map"},
        {"time": "2:00", "event": "Impact: 42,000+ people, 7 schools, 2 hospitals at risk"},
        {"time": "2:15", "event": "Gemini generates structured response recommendation"},
        {"time": "2:30", "event": "Authority reviews evidence, clicks ACKNOWLEDGE then ISSUE ALERT"},
        {"time": "2:45", "event": "Dashboard updates: RESPONSE INITIATED"},
    ],
}
