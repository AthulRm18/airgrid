"""
OpenAQ v3 client — real ground-sensor air quality data.

Set OPENAQ_API_KEY in .env (free key at https://explore.openaq.org/register).
Falls back to realistic mock data if no key is present.

Real v3 /locations/{id}/latest response shape (one item per sensor reading):
[
  {
    "datetime": {"utc": "...", "local": "..."},
    "value": 123.4,
    "coordinates": {"latitude": ..., "longitude": ...},
    "sensors": [{"id": ..., "name": "pm25 µg/m³", "parameter": {"name": "pm25", ...}}]
  },
  ...
]
"""
import os
import random
import asyncio
from datetime import datetime, timezone
from typing import Optional

import httpx

OPENAQ_BASE_URL = "https://api.openaq.org/v3"

# Fail fast during local demos: if live OpenAQ is slow/unreachable,
# immediately fall back to deterministic mock readings.
OPENAQ_REQUEST_TIMEOUT = float(os.environ.get("OPENAQ_REQUEST_TIMEOUT", "8"))
OPENAQ_TOTAL_TIMEOUT = float(os.environ.get("OPENAQ_TOTAL_TIMEOUT", "25"))
OPENAQ_LOCATIONS_LIMIT = int(os.environ.get("OPENAQ_LOCATIONS_LIMIT", "25"))
OPENAQ_MAX_CONCURRENCY = int(os.environ.get("OPENAQ_MAX_CONCURRENCY", "8"))


def _get_api_key() -> Optional[str]:
    return os.environ.get("OPENAQ_API_KEY")


async def fetch_locations(bbox: str, limit: int = OPENAQ_LOCATIONS_LIMIT) -> list[dict]:
    """
    Fetch monitoring station locations within a bounding box.
    bbox: "min_lng,min_lat,max_lng,max_lat"
    """
    api_key = _get_api_key()
    if not api_key:
        return _mock_locations(bbox, limit)

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{OPENAQ_BASE_URL}/locations",
                params={"bbox": bbox, "limit": limit},
                headers={"X-API-Key": api_key},
                timeout=OPENAQ_REQUEST_TIMEOUT,
            )
            resp.raise_for_status()
            return resp.json().get("results", [])
    except Exception:
        return _mock_locations(bbox, limit)


async def fetch_latest_measurements(location_id: int, loc: dict) -> list[dict]:
    """
    Fetch the latest readings for a location and normalize to our internal shape:
      {parameter: {name, units}, value, datetime: {utc}, coordinates: {latitude, longitude}}
    Works with both real v3 API and mock data.
    """
    api_key = _get_api_key()
    if not api_key:
        return _mock_measurements(location_id)

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{OPENAQ_BASE_URL}/locations/{location_id}/latest",
                headers={"X-API-Key": api_key},
                params={"parameters_id": 2},
                timeout=OPENAQ_REQUEST_TIMEOUT,
            )
            resp.raise_for_status()
            raw = resp.json().get("results", [])
    except Exception:
        return _mock_measurements(location_id)

    # Normalize both known v3 shapes to internal format.
    # Shape A (older docs): each item has a "sensors" array with parameter details.
    # Shape B (current in production): each item has sensorsId/locationsId/value and coordinates.
    normalized = []
    coords = loc.get("coordinates", {})
    for item in raw:
        sensors = item.get("sensors", [])
        if sensors:
            for sensor in sensors:
                param = sensor.get("parameter", {})
                param_name = param.get("name", "").lower()
                if param_name != "pm25":
                    continue
                normalized.append({
                    "parameter": {"name": "pm25", "units": param.get("units", "µg/m³")},
                    "value": item.get("value"),
                    "datetime": item.get("datetime", {"utc": datetime.now(timezone.utc).isoformat()}),
                    "coordinates": coords,
                })
            continue

        # Current response form where parameter details are omitted.
        if item.get("value") is None:
            continue
        item_coords = item.get("coordinates") or coords
        if not item_coords:
            continue
        normalized.append({
            "parameter": {"name": "pm25", "units": "µg/m³"},
            "value": item.get("value"),
            "datetime": item.get("datetime", {"utc": datetime.now(timezone.utc).isoformat()}),
            "coordinates": item_coords,
        })
    return normalized


# ---------------------------------------------------------------------------
# Mock data — realistic Delhi-NCR sensor network
# ---------------------------------------------------------------------------

_DELHI_NCR_STATIONS = [
    {"id": 1001, "name": "Anand Vihar",        "lat": 28.6469, "lng": 77.3157},
    {"id": 1002, "name": "R K Puram",           "lat": 28.5636, "lng": 77.1861},
    {"id": 1003, "name": "Punjabi Bagh",        "lat": 28.6742, "lng": 77.1310},
    {"id": 1004, "name": "Okhla Phase 2",       "lat": 28.5313, "lng": 77.2803},
    {"id": 1005, "name": "Dwarka Sector 8",     "lat": 28.5709, "lng": 77.0723},
    {"id": 1006, "name": "Noida Sector 62",     "lat": 28.6274, "lng": 77.3701},
    {"id": 1007, "name": "Gurugram Sector 51",  "lat": 28.4421, "lng": 77.0721},
    {"id": 1008, "name": "Mandir Marg",         "lat": 28.6364, "lng": 77.2007},
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
    """Generates a plausible PM2.5 reading with deterministic noise per station."""
    random.seed(location_id * 7 + int(datetime.now().minute / 10))
    hot_stations = {1001, 1006}  # Anand Vihar, Noida — classic Delhi hotspots
    base = 180 if location_id in hot_stations else 90
    pm25 = max(10, base + random.gauss(0, 25))
    station = next((s for s in _DELHI_NCR_STATIONS if s["id"] == location_id), None)
    coords = {"latitude": station["lat"], "longitude": station["lng"]} if station else {}
    return [{
        "parameter": {"name": "pm25", "units": "µg/m³"},
        "value": round(pm25, 1),
        "datetime": {"utc": datetime.now(timezone.utc).isoformat()},
        "coordinates": coords,
    }]


async def fetch_all_readings(bbox: str = "76.8,28.4,77.6,28.9") -> list[dict]:
    """
    Fetch all stations in a bbox and their latest PM2.5 readings.
    Returns [{lat, lng, pm25, station_name, timestamp, source}] ready for H3 binning.
    Fetches all stations concurrently with individual error handling.
    """
    try:
        locations = await asyncio.wait_for(
            fetch_locations(bbox, limit=OPENAQ_LOCATIONS_LIMIT),
            timeout=OPENAQ_TOTAL_TIMEOUT,
        )
    except Exception:
        return await _fetch_mock_readings(bbox)

    if not locations:
        return await _fetch_mock_readings(bbox)

    semaphore = asyncio.Semaphore(OPENAQ_MAX_CONCURRENCY)

    async def _fetch_one(loc: dict) -> list[dict]:
        coords = loc.get("coordinates", {})
        lat = coords.get("latitude")
        lng = coords.get("longitude")
        if lat is None or lng is None:
            return []
        try:
            async with semaphore:
                measurements = await asyncio.wait_for(
                    fetch_latest_measurements(loc["id"], loc),
                    timeout=OPENAQ_REQUEST_TIMEOUT,
                )
        except Exception:
            return []
        results = []
        for m in measurements:
            param_name = m.get("parameter", {}).get("name", "")
            if param_name != "pm25":
                continue
            value = m.get("value")
            if value is None:
                continue
            dt = m.get("datetime", {})
            timestamp = dt.get("utc", datetime.now(timezone.utc).isoformat())
            results.append({
                "lat": lat,
                "lng": lng,
                "pm25": float(value),
                "station_name": loc.get("name", "Unknown"),
                "timestamp": timestamp,
                "source": "openaq",
            })
        return results

    # Fetch all concurrently
    tasks = [asyncio.create_task(_fetch_one(loc)) for loc in locations]
    done, pending = await asyncio.wait(tasks, timeout=OPENAQ_TOTAL_TIMEOUT)

    # Cancel and drain pending tasks so cancelled exceptions are consumed.
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)

    results = []
    for task in done:
        try:
            results.append(task.result())
        except Exception:
            results.append([])

    readings = []
    for r in results:
        if isinstance(r, list):
            readings.extend(r)

    # If no usable live readings arrived in budget, fall back to mock so map is never blank.
    if not readings:
        return await _fetch_mock_readings(bbox)

    return readings


async def _fetch_mock_readings(bbox: str) -> list[dict]:
    """Deterministic Delhi-NCR mock readings — used when no API key or live data is empty."""
    locations = _mock_locations(bbox, limit=100)
    readings: list[dict] = []
    for loc in locations:
        for m in _mock_measurements(loc["id"]):
            coords = m.get("coordinates", {})
            lat = coords.get("latitude")
            lng = coords.get("longitude")
            if lat is None or lng is None:
                continue
            readings.append({
                "lat": lat,
                "lng": lng,
                "pm25": float(m["value"]),
                "station_name": loc.get("name", "Unknown"),
                "timestamp": m.get("datetime", {}).get("utc", datetime.now(timezone.utc).isoformat()),
                "source": "openaq_mock",
            })
    return readings
