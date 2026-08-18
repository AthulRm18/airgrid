"""
OpenAQ v3 client — real ground-sensor air quality data.

OpenAQ now requires a free API key (register at https://explore.openaq.org/register).
Set it as OPENAQ_API_KEY in your environment / .env file.

If no key is set, falls back to realistic mock data so the rest of the
pipeline (H3 binning, hotspot detection, forecasting, dashboard) can be
built and demoed without blocking on registration.
"""
import os
import random
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

OPENAQ_BASE_URL = "https://api.openaq.org/v3"


def _get_api_key() -> Optional[str]:
    return os.environ.get("OPENAQ_API_KEY")


async def fetch_locations(bbox: str, limit: int = 100) -> list[dict]:
    """
    Fetch monitoring station locations within a bounding box.
    bbox format: "min_lng,min_lat,max_lng,max_lat" (OpenAQ's expected order)
    """
    api_key = _get_api_key()
    if not api_key:
        return _mock_locations(bbox, limit)

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{OPENAQ_BASE_URL}/locations",
            params={"bbox": bbox, "limit": limit},
            headers={"X-API-Key": api_key},
            timeout=15.0,
        )
        resp.raise_for_status()
        return resp.json().get("results", [])


async def fetch_latest_measurements(location_id: int) -> list[dict]:
    """Fetch the latest sensor readings for a given location."""
    api_key = _get_api_key()
    if not api_key:
        return _mock_measurements(location_id)

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{OPENAQ_BASE_URL}/locations/{location_id}/latest",
            headers={"X-API-Key": api_key},
            timeout=15.0,
        )
        resp.raise_for_status()
        return resp.json().get("results", [])


# ---------------------------------------------------------------------------
# Mock data — realistic Delhi-NCR-shaped sensor network for demo/dev use
# before an OpenAQ API key is wired in. Swap out instantly once the key
# lands: the function signatures above already match the real API shape.
# ---------------------------------------------------------------------------

_DELHI_NCR_STATIONS = [
    {"id": 1001, "name": "Anand Vihar", "lat": 28.6469, "lng": 77.3157},
    {"id": 1002, "name": "R K Puram", "lat": 28.5636, "lng": 77.1861},
    {"id": 1003, "name": "Punjabi Bagh", "lat": 28.6742, "lng": 77.1310},
    {"id": 1004, "name": "Okhla Phase 2", "lat": 28.5313, "lng": 77.2803},
    {"id": 1005, "name": "Dwarka Sector 8", "lat": 28.5709, "lng": 77.0723},
    {"id": 1006, "name": "Noida Sector 62", "lat": 28.6274, "lng": 77.3701},
    {"id": 1007, "name": "Gurugram Sector 51", "lat": 28.4421, "lng": 77.0721},
    {"id": 1008, "name": "Mandir Marg", "lat": 28.6364, "lng": 77.2007},
]


def _mock_locations(bbox: str, limit: int) -> list[dict]:
    return [
        {
            "id": s["id"],
            "name": s["name"],
            "coordinates": {"latitude": s["lat"], "longitude": s["lng"]},
            "country": {"code": "IN"},
        }
        for s in _DELHI_NCR_STATIONS[:limit]
    ]


def _mock_measurements(location_id: int) -> list[dict]:
    """
    Generates a plausible PM2.5 reading. Seeded loosely by location_id so
    repeated calls for the same station stay in a believable band, with
    some stations running deliberately 'hot' to simulate a real hotspot
    for the demo (e.g. near industrial/agri-burning zones).
    """
    random.seed(location_id * 7 + int(datetime.now().minute / 10))
    hot_stations = {1001, 1006}  # Anand Vihar, Noida — classic Delhi hotspots
    base = 180 if location_id in hot_stations else 90
    pm25 = max(10, base + random.gauss(0, 25))
    return [{
        "parameter": {"name": "pm25", "units": "µg/m³"},
        "value": round(pm25, 1),
        "datetime": {"utc": datetime.now(timezone.utc).isoformat()},
        "coordinates": next(
            (s for s in _DELHI_NCR_STATIONS if s["id"] == location_id), None
        ),
    }]


async def fetch_all_readings(bbox: str = "76.8,28.4,77.6,28.9") -> list[dict]:
    """
    Convenience function: fetch all stations in a bbox and their latest
    readings, flattened into a single list of
    {lat, lng, pm25, station_name, timestamp} dicts ready for H3 binning.
    """
    locations = await fetch_locations(bbox)
    readings = []
    for loc in locations:
        measurements = await fetch_latest_measurements(loc["id"])
        for m in measurements:
            if m["parameter"]["name"] != "pm25":
                continue
            coords = loc.get("coordinates", {})
            readings.append({
                "lat": coords.get("latitude"),
                "lng": coords.get("longitude"),
                "pm25": m["value"],
                "station_name": loc["name"],
                "timestamp": m["datetime"]["utc"],
                "source": "openaq",
            })
    return readings
