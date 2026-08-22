"""
Earth Engine — Sentinel-5P aerosol for H3 cells.

Setup (your GCP project already has Earth Engine API enabled):
  1. Create a service account in the GCP project (e.g. cognitive-late)
  2. Grant it "Earth Engine Resource Viewer" (and register EE access for the SA)
  3. Download the JSON key to backend/ee-service-account.json
  4. In backend/.env set:

     USE_EARTH_ENGINE=true
     GCP_PROJECT_ID=cognitive-late
     EE_SERVICE_ACCOUNT=your-sa@cognitive-late.iam.gserviceaccount.com
     EE_PRIVATE_KEY_PATH=./ee-service-account.json

Or set GOOGLE_APPLICATION_CREDENTIALS to the key path and GCP_PROJECT_ID.
"""
import os
import json
from datetime import datetime, timedelta
from pathlib import Path

import ee

from app.services.h3_utils import cell_to_latlng

_initialized = False
_init_error: str | None = None


def _ensure_initialized(force_retry: bool = False):
    global _initialized, _init_error
    if _initialized and not force_retry:
        return
    if _init_error and not force_retry:
        raise RuntimeError(_init_error)

    project_id = os.environ.get("GCP_PROJECT_ID") or os.environ.get("GOOGLE_CLOUD_PROJECT") or "cognitive-late"
    service_account = os.environ.get("EE_SERVICE_ACCOUNT") or "firebase-adminsdk-fbsvc@cognitive-late.iam.gserviceaccount.com"
    raw_json = (
        os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
        or os.environ.get("EE_SERVICE_ACCOUNT_JSON")
    )
    key_path_env = os.environ.get("EE_PRIVATE_KEY_PATH") or os.environ.get("FIREBASE_CREDENTIALS") or "./service-account.json"

    if key_path_env and key_path_env.strip().startswith("{") and key_path_env.strip().endswith("}"):
        raw_json = key_path_env.strip()

    try:
        if raw_json:
            try:
                parsed = json.loads(raw_json)
                sa = parsed.get("client_email", service_account)
                credentials = ee.ServiceAccountCredentials(sa, key_data=raw_json)
                ee.Initialize(credentials, project=project_id)
                _initialized = True
                _init_error = None
                print(f"[Earth Engine] Initialized with key_data (project={project_id})")
                return
            except Exception as e:
                print(f"[Earth Engine] Raw JSON init failed: {e}")

        resolved_path = None
        p = Path(key_path_env)
        backend_dir = Path(__file__).resolve().parents[2]
        if p.exists():
            resolved_path = str(p)
        elif (backend_dir / key_path_env).exists():
            resolved_path = str(backend_dir / key_path_env)
        elif (backend_dir / p.name).exists():
            resolved_path = str(backend_dir / p.name)
        elif (backend_dir / "service-account.json").exists():
            resolved_path = str(backend_dir / "service-account.json")
        elif (backend_dir.parent / "service-account.json").exists():
            resolved_path = str(backend_dir.parent / "service-account.json")
        elif Path("/etc/secrets/service-account.json").exists():
            resolved_path = "/etc/secrets/service-account.json"
        elif Path(f"/etc/secrets/{p.name}").exists():
            resolved_path = f"/etc/secrets/{p.name}"

        if service_account and resolved_path:
            credentials = ee.ServiceAccountCredentials(service_account, resolved_path)
            ee.Initialize(credentials, project=project_id)
        elif resolved_path and project_id:
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = resolved_path
            ee.Initialize(project=project_id)
        elif project_id:
            ee.Initialize(project=project_id)
        else:
            raise RuntimeError(
                "Set GCP_PROJECT_ID and EE_PRIVATE_KEY_PATH (service account JSON)."
            )
        _initialized = True
        _init_error = None
        print(f"[Earth Engine] Initialized (project={project_id})")
    except Exception as exc:
        _init_error = str(exc)
        raise RuntimeError(_init_error) from exc


def is_configured() -> bool:
    try:
        _ensure_initialized()
        return True
    except Exception as exc:
        print(f"[Earth Engine] Not ready: {exc}")
        return False


def status() -> dict:
    """Return EE readiness for /api/data-sources."""
    try:
        _ensure_initialized(force_retry=True)
        return {"ok": True, "detail": "initialized"}
    except Exception as exc:
        msg = str(exc)
        hint = None
        if "serviceUsageConsumer" in msg or "permission" in msg.lower():
            hint = (
                "Grant the service account roles/serviceusage.serviceUsageConsumer "
                "on project cognitive-late (IAM → ee-runner → Add role)."
            )
        return {"ok": False, "detail": msg[:200], "hint": hint}


def get_aerosol_index(h3_cell: str, days_lookback: int = 3) -> float | None:
    """0-1 normalized Sentinel-5P UV Aerosol Index for the cell area."""
    _ensure_initialized()

    lat, lng = cell_to_latlng(h3_cell)
    point = ee.Geometry.Point([lng, lat])
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

    normalized = max(0.0, min(raw_value / 3.0, 1.0))
    return round(normalized, 3)


def get_no2_column(h3_cell: str, days_lookback: int = 3) -> float | None:
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
    from dotenv import load_dotenv
    load_dotenv()

    test_cell = "873da1149ffffff"
    print(f"Testing Earth Engine against cell {test_cell}...")
    try:
        aerosol = get_aerosol_index(test_cell)
        no2 = get_no2_column(test_cell)
        print(f"  aerosol index (0-1): {aerosol}")
        print(f"  NO2 column density:  {no2}")
    except RuntimeError as e:
        print(f"  Not configured yet: {e}")
