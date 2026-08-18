"""
Historical PM2.5 time series for forecast training.

For the hackathon demo window, this generates a realistic 14-day hourly
series per mock station: diurnal traffic-driven double-peak (morning +
evening rush), weekday/weekend difference, and one deliberate agricultural-
burning spike event — the kind of event AirGrid's fusion is built to catch
early. It's seeded, so it's identical across runs (stable demo).

For your REAL submission, replace `generate_synthetic_history()` with
`fetch_real_history()` below, which pulls actual historical readings from
OpenAQ's /locations/{id}/measurements endpoint (needs OPENAQ_API_KEY).
Judges are told to reward "real or realistic data" — synthetic-but-
physically-plausible data is an accepted fallback where live history
isn't available, but swap in the real pull if you have time before the
deadline; it strengthens your Problem-Solution Fit score.
"""
import math
import random
from datetime import datetime, timedelta, timezone

import httpx
import pandas as pd

from app.services.openaq_client import _DELHI_NCR_STATIONS, OPENAQ_BASE_URL
from app.services.h3_utils import latlng_to_cell


def generate_synthetic_history(days: int = 14, resolution: int = 7) -> pd.DataFrame:
    """Returns a DataFrame: h3_cell, timestamp, pm25 — one row per station per hour."""
    rows = []
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = now - timedelta(days=days)

    hot_stations = {1001, 1006}  # Anand Vihar, Noida — matches openaq_client mock

    # deliberate burning-event window: day 9-10 of the series, evening hours,
    # affecting stations near the "hidden hotspot" test area used elsewhere
    burn_event_start = start + timedelta(days=9, hours=17)
    burn_event_end = start + timedelta(days=9, hours=23)

    for station in _DELHI_NCR_STATIONS:
        cell = latlng_to_cell(station["lat"], station["lng"], resolution)
        rng = random.Random(station["id"])  # per-station deterministic noise

        t = start
        while t <= now:
            hour = t.hour
            is_weekend = t.weekday() >= 5

            # diurnal double-peak: rush hour bumps at ~8am and ~7pm
            diurnal = 25 * math.exp(-((hour - 8) ** 2) / 8) + 30 * math.exp(-((hour - 19) ** 2) / 10)
            weekend_factor = 0.75 if is_weekend else 1.0

            base = 70 if station["id"] in hot_stations else 45
            pm25 = base + diurnal * weekend_factor + rng.gauss(0, 12)

            if burn_event_start <= t <= burn_event_end and station["id"] in {1001, 1006}:
                pm25 += 140  # sharp spike — this is the event the forecast should learn to flag

            rows.append({"h3_cell": cell, "timestamp": t, "pm25": max(8, round(pm25, 1))})
            t += timedelta(hours=1)

    return pd.DataFrame(rows)


async def fetch_real_history(location_id: int, date_from: str, date_to: str) -> pd.DataFrame:
    """
    Real OpenAQ historical pull for one station. date_from/date_to as
    ISO date strings e.g. "2026-08-01". Needs OPENAQ_API_KEY.

    Swap generate_synthetic_history() for a loop over this once you have
    a key + want the forecast trained on real history instead of the
    synthetic stand-in.
    """
    import os
    api_key = os.environ.get("OPENAQ_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAQ_API_KEY not set — can't fetch real history")

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{OPENAQ_BASE_URL}/locations/{location_id}/measurements",
            params={"date_from": date_from, "date_to": date_to, "parameters_id": 2, "limit": 1000},
            headers={"X-API-Key": api_key},
            timeout=30.0,
        )
        resp.raise_for_status()
        results = resp.json().get("results", [])

    return pd.DataFrame([
        {
            "timestamp": pd.to_datetime(r["period"]["datetimeFrom"]["utc"]),
            "pm25": r["value"],
            "location_id": location_id,
        }
        for r in results
    ])
