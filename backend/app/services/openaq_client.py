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

import requests

OPENAQ_BASE_URL = "https://api.openaq.org/v3"

# Fail fast during local demos: if live OpenAQ is slow/unreachable,
# immediately fall back to deterministic mock readings.
OPENAQ_REQUEST_TIMEOUT = float(os.environ.get("OPENAQ_REQUEST_TIMEOUT", "5"))
OPENAQ_TOTAL_TIMEOUT = float(os.environ.get("OPENAQ_TOTAL_TIMEOUT", "10"))
OPENAQ_LOCATIONS_LIMIT = int(os.environ.get("OPENAQ_LOCATIONS_LIMIT", "6"))
OPENAQ_MAX_CONCURRENCY = int(os.environ.get("OPENAQ_MAX_CONCURRENCY", "4"))
OPENAQ_REAL_CACHE_TTL_SECONDS = float(os.environ.get("OPENAQ_REAL_CACHE_TTL_SECONDS", "300"))  # 5 min cache minimum

_LAST_REAL_READINGS: list[dict] = []
_LAST_REAL_READINGS_TS: float = 0.0
_LAST_NETWORK_ATTEMPT_TS: float = 0.0
_MIN_NETWORK_INTERVAL_SECONDS = 60.0  # At most 1 network call per minute
_FORCE_MOCK = False  # Set True after ANY 401, 403, 429 or auth issue to protect account


def _get_api_key() -> Optional[str]:
    if _FORCE_MOCK:
        return None
    key = os.environ.get("OPENAQ_API_KEY")
    if not key or key.strip() in ("", "none", "null"):
        return None
    return key.strip()


def _mark_key_invalid(reason: str):
    global _FORCE_MOCK
    if not _FORCE_MOCK:
        _FORCE_MOCK = True
        print(f"[OpenAQ Safety Guard] Rate limit or auth signal received ({reason}). Switching to offline CPCB demo grid to protect account.")


def _check_rate_limit_headers(headers: dict):
    remaining = headers.get("x-ratelimit-remaining") or headers.get("X-RateLimit-Remaining")
    if remaining is not None:
        try:
            if int(remaining) <= 1:
                _mark_key_invalid(f"Rate limit remaining={remaining}")
        except Exception:
            pass


async def fetch_locations(bbox: str | None = None, limit: int = OPENAQ_LOCATIONS_LIMIT) -> list[dict]:
    """
    Fetch monitoring station locations within a bounding box, or nationwide if bbox is None.
    Guarded with rate-limit circuit breaker.
    """
    global _LAST_NETWORK_ATTEMPT_TS
    api_key = _get_api_key()
    if not api_key:
        return _mock_locations(bbox, limit)

    # Throttling guard: enforce minimum interval between live network attempts
    now_ts = datetime.now(timezone.utc).timestamp()
    if (now_ts - _LAST_NETWORK_ATTEMPT_TS) < _MIN_NETWORK_INTERVAL_SECONDS:
        return _mock_locations(bbox, limit)

    _LAST_NETWORK_ATTEMPT_TS = now_ts
    try:
        def _call():
            return requests.get(
                f"{OPENAQ_BASE_URL}/locations",
                params={"bbox": bbox, "limit": limit} if bbox else {"limit": limit, "countries_id": 99},
                headers={"X-API-Key": api_key},
                timeout=OPENAQ_REQUEST_TIMEOUT,
            )

        resp = await asyncio.to_thread(_call)
        _check_rate_limit_headers(resp.headers)

        if resp.status_code in (401, 403, 429):
            _mark_key_invalid(f"HTTP {resp.status_code}")
            return _mock_locations(bbox, limit)

        if resp.status_code >= 400:
            _mark_key_invalid(f"HTTP {resp.status_code}")
            return _mock_locations(bbox, limit)

        return resp.json().get("results", [])
    except Exception as exc:
        _mark_key_invalid(f"Network error: {str(exc)[:60]}")
        return _mock_locations(bbox, limit)


async def fetch_latest_measurements(location_id: int, loc: dict) -> list[dict]:
    """
    Fetch the latest readings for a location. Guarded with rate-limit circuit breaker.
    """
    api_key = _get_api_key()
    if not api_key:
        return _mock_measurements(location_id)

    try:
        def _call():
            return requests.get(
                f"{OPENAQ_BASE_URL}/locations/{location_id}/latest",
                headers={"X-API-Key": api_key},
                params={"parameters_id": 2},
                timeout=OPENAQ_REQUEST_TIMEOUT,
            )

        resp = await asyncio.to_thread(_call)
        _check_rate_limit_headers(resp.headers)

        if resp.status_code in (401, 403, 429):
            _mark_key_invalid(f"HTTP {resp.status_code}")
            return _mock_measurements(location_id)

        if resp.status_code >= 400:
            return _mock_measurements(location_id)

        raw = resp.json().get("results", [])
    except Exception:
        return _mock_measurements(location_id)

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
# Mock data — realistic multi-city India sensor network (CPCB nodes)
# ---------------------------------------------------------------------------

_INDIA_STATIONS = [
    # Delhi-NCR
    {"id": 1001, "name": "Anand Vihar, Delhi",        "lat": 28.6469, "lng": 77.3157, "base": 185},
    {"id": 1002, "name": "R K Puram, Delhi",           "lat": 28.5636, "lng": 77.1861, "base": 110},
    {"id": 1003, "name": "Punjabi Bagh, Delhi",        "lat": 28.6742, "lng": 77.1310, "base": 130},
    {"id": 1004, "name": "Okhla Phase 2, Delhi",       "lat": 28.5313, "lng": 77.2803, "base": 125},
    {"id": 1005, "name": "Dwarka Sector 8, Delhi",     "lat": 28.5709, "lng": 77.0723, "base": 95},
    {"id": 1006, "name": "Noida Sector 62, UP",        "lat": 28.6274, "lng": 77.3701, "base": 160},
    {"id": 1007, "name": "Gurugram Sector 51, HR",     "lat": 28.4421, "lng": 77.0721, "base": 120},
    # Mumbai MMR
    {"id": 2001, "name": "Bandra Kurla Complex, Mumbai", "lat": 19.0657, "lng": 72.8687, "base": 115},
    {"id": 2002, "name": "Chembur Industrial, Mumbai",   "lat": 19.0522, "lng": 72.9005, "base": 150},
    {"id": 2003, "name": "Colaba, Mumbai",               "lat": 18.9067, "lng": 72.8147, "base": 75},
    # Bengaluru
    {"id": 3001, "name": "BTM Layout, Bengaluru",       "lat": 12.9166, "lng": 77.6101, "base": 65},
    {"id": 3002, "name": "Peenya Industrial, Bengaluru","lat": 13.0285, "lng": 77.5197, "base": 135},
    {"id": 3003, "name": "Whitefield, Bengaluru",       "lat": 12.9698, "lng": 77.7500, "base": 85},
    # Kerala / Kochi
    {"id": 4001, "name": "Vyttila Hub, Kochi",          "lat": 9.9656,  "lng": 76.3219, "base": 70},
    {"id": 4002, "name": "Kacheripady, Kochi",          "lat": 9.9880,  "lng": 76.2820, "base": 60},
    {"id": 4003, "name": "Pattom, Thiruvananthapuram",  "lat": 8.5241,  "lng": 76.9366, "base": 45},
    # Kolkata
    {"id": 5001, "name": "Victoria Memorial, Kolkata",  "lat": 22.5448, "lng": 88.3426, "base": 105},
    {"id": 5002, "name": "Howrah Industrial, WB",       "lat": 22.5958, "lng": 88.2636, "base": 165},
    # Hyderabad & Chennai
    {"id": 6001, "name": "Sanathnagar, Hyderabad",      "lat": 17.4565, "lng": 78.4439, "base": 140},
    {"id": 7001, "name": "Manali, Chennai",             "lat": 13.1667, "lng": 80.2667, "base": 145},
]

_DELHI_NCR_STATIONS = _INDIA_STATIONS


def _mock_locations(bbox: str | None = None, limit: int | None = None) -> list[dict]:
    stations = _INDIA_STATIONS
    if bbox:
        try:
            parts = [float(x.strip()) for x in bbox.split(",")]
            if len(parts) == 4:
                min_lng, min_lat, max_lng, max_lat = parts
                in_bbox = [
                    s for s in stations
                    if min_lat <= s["lat"] <= max_lat and min_lng <= s["lng"] <= max_lng
                ]
                if in_bbox:
                    stations = in_bbox
        except Exception:
            pass

    max_len = limit if limit and bbox else len(stations)
    return [
        {
            "id": s["id"],
            "name": s["name"],
            "coordinates": {"latitude": s["lat"], "longitude": s["lng"]},
            "country": {"code": "IN"},
        }
        for s in stations[:max_len]
    ]


def _mock_measurements(location_id: int) -> list[dict]:
    """Generates a plausible PM2.5 reading with deterministic noise per station."""
    random.seed(location_id * 7 + int(datetime.now().minute / 10))
    station = next((s for s in _INDIA_STATIONS if s["id"] == location_id), None)
    base = station.get("base", 90) if station else 90
    pm25 = max(10, base + random.gauss(0, 15))
    coords = {"latitude": station["lat"], "longitude": station["lng"]} if station else {}
    return [{
        "parameter": {"name": "pm25", "units": "µg/m³"},
        "value": round(pm25, 1),
        "datetime": {"utc": datetime.now(timezone.utc).isoformat()},
        "coordinates": coords,
    }]


async def fetch_all_readings(bbox: str | None = None) -> list[dict]:
    """
    Fetch all stations in a bbox (or nationwide if None) and their latest PM2.5 readings.
    Returns [{lat, lng, pm25, station_name, timestamp, source}] ready for H3 binning.
    Guarded with pre-fetch caching and rate-limit circuit breakers.
    """
    global _LAST_REAL_READINGS, _LAST_REAL_READINGS_TS

    # 1. Early return from memory cache (5-minute TTL) if valid nationwide data exists
    now_ts = datetime.now(timezone.utc).timestamp()
    if _LAST_REAL_READINGS and len(_LAST_REAL_READINGS) >= 15 and (now_ts - _LAST_REAL_READINGS_TS) <= OPENAQ_REAL_CACHE_TTL_SECONDS:
        return _LAST_REAL_READINGS

    # 2. If no key is set or safety circuit breaker is active, use offline demo grid immediately
    if not _get_api_key():
        return await _fetch_mock_readings(bbox)

    try:
        locations = await asyncio.wait_for(
            fetch_locations(bbox, limit=OPENAQ_LOCATIONS_LIMIT),
            timeout=OPENAQ_TOTAL_TIMEOUT,
        )
    except Exception:
        if _LAST_REAL_READINGS and (datetime.now(timezone.utc).timestamp() - _LAST_REAL_READINGS_TS) <= OPENAQ_REAL_CACHE_TTL_SECONDS:
            return _LAST_REAL_READINGS
        return await _fetch_mock_readings(bbox)

    if not locations:
        if _LAST_REAL_READINGS and (datetime.now(timezone.utc).timestamp() - _LAST_REAL_READINGS_TS) <= OPENAQ_REAL_CACHE_TTL_SECONDS:
            return _LAST_REAL_READINGS
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

    # Fetch all concurrently; each task has its own timeout budget.
    results = await asyncio.gather(*[_fetch_one(loc) for loc in locations], return_exceptions=True)

    readings = []
    for r in results:
        if isinstance(r, list):
            readings.extend(r)

    # If no usable live readings arrived in budget, prefer recent real cache before mock.
    if not readings:
        if _LAST_REAL_READINGS and (datetime.now(timezone.utc).timestamp() - _LAST_REAL_READINGS_TS) <= OPENAQ_REAL_CACHE_TTL_SECONDS:
            return _LAST_REAL_READINGS
        return await _fetch_mock_readings(bbox)

    _LAST_REAL_READINGS = readings
    _LAST_REAL_READINGS_TS = datetime.now(timezone.utc).timestamp()

    return readings


async def _fetch_mock_readings(bbox: str | None = None) -> list[dict]:
    """Realistic multi-city India mock readings — used when no API key or live data is empty."""
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
