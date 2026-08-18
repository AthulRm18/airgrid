"""
Weather data integration — Open-Meteo API (free, no key required).

Wind direction and wind speed are the most critical signals for the
pollution propagation model.  Temperature, humidity, and precipitation
are secondary but useful for the evidence-fusion confidence score
(high humidity + low wind = pollution traps in place).

Falls back to deterministic mock data so the demo always works even
if the network is down or the API is rate-limited.
"""
import hashlib
import math
from datetime import datetime, timezone

import httpx

from app.services.h3_utils import cell_to_latlng


async def fetch_weather(h3_cell: str) -> dict:
    """Current weather for the area around an H3 cell center."""
    lat, lng = cell_to_latlng(h3_cell)
    try:
        return await _fetch_open_meteo(lat, lng, h3_cell)
    except Exception:
        return _mock_weather(h3_cell)


async def _fetch_open_meteo(lat: float, lng: float, h3_cell: str) -> dict:
    """Query Open-Meteo's free current-weather endpoint."""
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": round(lat, 4),
        "longitude": round(lng, 4),
        "current": "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m",
        "timezone": "auto",
    }
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, params=params, timeout=10.0)
        resp.raise_for_status()
        data = resp.json()

    current = data.get("current", {})
    return {
        "h3_cell": h3_cell,
        "lat": lat,
        "lng": lng,
        "wind_speed_kmh": current.get("wind_speed_10m", 0),
        "wind_direction_deg": current.get("wind_direction_10m", 0),
        "temperature_c": current.get("temperature_2m", 0),
        "humidity_pct": current.get("relative_humidity_2m", 0),
        "precipitation_mm": current.get("precipitation", 0),
        "timestamp": current.get("time", datetime.now(timezone.utc).isoformat()),
        "source": "open-meteo",
    }


def _mock_weather(h3_cell: str) -> dict:
    """Deterministic mock weather seeded by cell hash.  Wind blows
    roughly NW→SE (315°-ish) with some per-cell jitter — this gives
    the propagation demo a realistic, consistent downwind corridor
    pointing toward densely populated south-east Delhi in the default
    mock geography."""
    lat, lng = cell_to_latlng(h3_cell)
    h = int(hashlib.sha256(h3_cell.encode()).hexdigest(), 16)
    base_direction = 315  # NW wind (blowing FROM northwest)
    jitter = (h % 40) - 20  # ±20°
    return {
        "h3_cell": h3_cell,
        "lat": lat,
        "lng": lng,
        "wind_speed_kmh": 12 + (h % 15),
        "wind_direction_deg": (base_direction + jitter) % 360,
        "temperature_c": 32 + (h % 8),
        "humidity_pct": 55 + (h % 30),
        "precipitation_mm": 0.0,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": "mock",
    }


def wind_favors_spread(weather: dict) -> bool:
    """Heuristic: does the current weather favor pollution spreading
    (as opposed to being washed out by rain or diluted by calm air)?"""
    return (
        weather["wind_speed_kmh"] >= 5
        and weather["precipitation_mm"] < 1.0
    )


def weather_consistency_score(weather: dict) -> float:
    """0-1 score for how much current weather conditions are consistent
    with a pollution event persisting and spreading.

    High wind + no rain + moderate humidity = pollution moves.
    Calm air + rain = pollution disperses/washes out.
    """
    wind = min(weather["wind_speed_kmh"] / 30.0, 1.0)  # 0-1, capped at 30 km/h
    no_rain = max(0.0, 1.0 - weather["precipitation_mm"] / 5.0)
    # high humidity traps pollution near ground
    humidity_factor = min(weather["humidity_pct"] / 100.0, 1.0)
    return round(0.5 * wind + 0.3 * no_rain + 0.2 * humidity_factor, 3)
