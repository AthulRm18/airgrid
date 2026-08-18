"""
Earth Engine integration — pulls real Sentinel-5P aerosol/NO2 satellite
data for an H3 cell, replacing the deterministic mock currently used in
main.py's _mock_satellite_score().

Needs:
  - EE_SERVICE_ACCOUNT   (from your GCP service account JSON)
  - EE_PRIVATE_KEY_PATH  (path to that JSON key file)
  - GCP_PROJECT_ID       (your Earth Engine-enabled Cloud project)
all set in backend/.env — see README for the registration walkthrough.

This module can't be exercised in this sandbox (no live credentials, no
network egress to earthengine.googleapis.com from here) — it's written
against the documented ee.ServiceAccountCredentials + ee.Initialize
pattern and Sentinel-5P's real band names, but test it for real the
moment your EE access is approved: run
    python -m app.services.earth_engine_client
from backend/ once your .env is filled in — it does a single test query
and prints the result.
"""
import os
from datetime import datetime, timedelta

import ee

from app.services.h3_utils import cell_to_latlng

_initialized = False


def _ensure_initialized():
    """Lazy init — don't touch Earth Engine's auth flow at import time,
    only when a caller actually needs a real query. Keeps the rest of the
    app importable/testable even with no EE credentials configured."""
    global _initialized
    if _initialized:
        return

    service_account = os.environ.get("EE_SERVICE_ACCOUNT")
    key_path = os.environ.get("EE_PRIVATE_KEY_PATH", "./ee-service-account.json")
    project_id = os.environ.get("GCP_PROJECT_ID")

    if not service_account or not project_id:
        raise RuntimeError(
            "EE_SERVICE_ACCOUNT / GCP_PROJECT_ID not set in .env — "
            "Earth Engine isn't configured yet. See README registration steps."
        )
    if not os.path.exists(key_path):
        raise RuntimeError(f"EE key file not found at {key_path} — did you download it?")

    credentials = ee.ServiceAccountCredentials(service_account, key_path)
    ee.Initialize(credentials, project=project_id)
    _initialized = True


def get_aerosol_index(h3_cell: str, days_lookback: int = 3) -> float | None:
    """
    Returns a 0-1 normalized aerosol/pollution index for the area around
    an H3 cell, using Sentinel-5P's UV Aerosol Index band (a good general
    smoke/dust/haze indicator — positive values indicate absorbing
    aerosols like smoke or dust).

    Averages over the last `days_lookback` days since Sentinel-5P revisit
    isn't daily-guaranteed for every location (cloud cover, orbit gaps) —
    a single-day query can come back empty.

    Returns None if no cloud-free pass covered this cell in the window
    (be honest about this in the UI — an absent satellite reading is a
    real "we don't know yet", not a zero).
    """
    _ensure_initialized()

    lat, lng = cell_to_latlng(h3_cell)
    point = ee.Geometry.Point([lng, lat])
    # ~2km buffer around the cell center — roughly matches an H3 res-7
    # hexagon's footprint, coarser than Sentinel-5P's native ~7km pixel
    # anyway so this just controls how we sample within that pixel.
    region = point.buffer(2000)

    end = datetime.utcnow()
    start = end - timedelta(days=days_lookback)

    collection = (
        ee.ImageCollection("COPERNICUS/S5P/OFFL/L3_AER_AI")
        .filterDate(start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
        .filterBounds(region)
        .select("absorbing_aerosol_index")
    )

    if collection.size().getInfo() == 0:
        return None

    mean_image = collection.mean()
    stats = mean_image.reduceRegion(
        reducer=ee.Reducer.mean(), geometry=region, scale=1000, bestEffort=True
    ).getInfo()

    raw_value = stats.get("absorbing_aerosol_index")
    if raw_value is None:
        return None

    # Aerosol index typically ranges roughly -1 (clean) to 3+ (heavy
    # smoke/dust) in practice over polluted regions — clamp and normalize
    # to 0-1 so it combines cleanly with the other fusion signals.
    normalized = max(0.0, min(raw_value / 3.0, 1.0))
    return round(normalized, 3)


def get_no2_column(h3_cell: str, days_lookback: int = 3) -> float | None:
    """
    Tropospheric NO2 column density (mol/m^2) — a strong proxy for
    vehicular/industrial combustion specifically, complements the aerosol
    index (which catches dust/smoke more broadly). Useful for the
    photo-classification's "likely_source" field: high NO2 + low aerosol
    suggests vehicular; high aerosol + moderate NO2 suggests
    burning/dust.
    """
    _ensure_initialized()

    lat, lng = cell_to_latlng(h3_cell)
    region = ee.Geometry.Point([lng, lat]).buffer(2000)

    end = datetime.utcnow()
    start = end - timedelta(days=days_lookback)

    collection = (
        ee.ImageCollection("COPERNICUS/S5P/OFFL/L3_NO2")
        .filterDate(start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
        .filterBounds(region)
        .select("tropospheric_NO2_column_number_density")
    )

    if collection.size().getInfo() == 0:
        return None

    stats = collection.mean().reduceRegion(
        reducer=ee.Reducer.mean(), geometry=region, scale=1000, bestEffort=True
    ).getInfo()
    return stats.get("tropospheric_NO2_column_number_density")


if __name__ == "__main__":
    # Quick manual test — run from backend/: python -m app.services.earth_engine_client
    # once your .env has EE_SERVICE_ACCOUNT / EE_PRIVATE_KEY_PATH / GCP_PROJECT_ID set.
    from dotenv import load_dotenv
    load_dotenv()

    test_cell = "873da1149ffffff"  # Anand Vihar, Delhi — matches the mock station set
    print(f"Testing Earth Engine against cell {test_cell}...")
    try:
        aerosol = get_aerosol_index(test_cell)
        no2 = get_no2_column(test_cell)
        print(f"  aerosol index (0-1): {aerosol}")
        print(f"  NO2 column density:  {no2}")
    except RuntimeError as e:
        print(f"  Not configured yet: {e}")
