"""
Firebase Firestore client for VIGIL.

Falls back to a local JSON file when Firebase is not configured.
No database tables — just a single demo-state file for persistence
across page refreshes and backend restarts during local development.
"""
import os
import json
from pathlib import Path

_db = None
_using_firebase = False
_initialized = False
_PERSIST_PATH = Path(__file__).resolve().parents[2] / "data" / "demo_state.json"

_FALLBACK_STORE: dict[str, list | dict] = {
    "citizen_reports": [],
    "incidents": [],
    "alerts": {},
    "issued_alerts": {},
    "dismissed": {},
    "active_sessions": {},
    "federated_events": [],
}
_loaded = False


def _init_firebase():
    global _db, _using_firebase, _initialized
    if _initialized:
        return
    _initialized = True

    creds_path = os.environ.get("FIREBASE_CREDENTIALS")
    project_id = os.environ.get("FIREBASE_PROJECT_ID")

    if not creds_path and not project_id:
        _load_persisted_state()
        print("[Firebase] No credentials — using local JSON fallback.")
        return

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore

        if not firebase_admin._apps:
            if creds_path and Path(creds_path).exists():
                cred = credentials.Certificate(creds_path)
            elif creds_path:
                try:
                    cred_dict = json.loads(creds_path)
                    cred = credentials.Certificate(cred_dict)
                except Exception:
                    print(f"[Firebase] Could not load credentials from: {creds_path}")
                    _load_persisted_state()
                    return
            else:
                cred = credentials.ApplicationDefault()
            firebase_admin.initialize_app(cred, {"projectId": project_id})

        _db = firestore.client()
        _using_firebase = True
        print(f"[Firebase] Connected to Firestore (project={project_id or 'default'}).")
    except ImportError:
        _load_persisted_state()
        print("[Firebase] firebase-admin not installed — using local JSON fallback.")
    except Exception as exc:
        _load_persisted_state()
        print(f"[Firebase] Init failed ({exc}) — using local JSON fallback.")


def _load_persisted_state():
    global _loaded
    if _loaded:
        return
    _loaded = True
    if not _PERSIST_PATH.exists():
        return
    try:
        data = json.loads(_PERSIST_PATH.read_text(encoding="utf-8"))
        for key in _FALLBACK_STORE:
            if key in data:
                _FALLBACK_STORE[key] = data[key]
        print(f"[Firebase] Loaded demo state from {_PERSIST_PATH.name}")
    except Exception as exc:
        print(f"[Firebase] Could not load demo state: {exc}")


def _persist_state():
    if _using_firebase:
        return
    _load_persisted_state()
    try:
        _PERSIST_PATH.parent.mkdir(parents=True, exist_ok=True)
        _PERSIST_PATH.write_text(
            json.dumps(_FALLBACK_STORE, indent=2, default=str),
            encoding="utf-8",
        )
    except Exception as exc:
        print(f"[Firebase] Could not persist demo state: {exc}")


def is_connected() -> bool:
    return _using_firebase


# ---------------------------------------------------------------------------
# Citizen Reports
# ---------------------------------------------------------------------------

def add_citizen_report(record: dict) -> dict:
    _init_firebase()
    if _using_firebase:
        _db.collection("citizen_reports").document(record["id"]).set(record)
    else:
        _FALLBACK_STORE["citizen_reports"].append(record)
        _persist_state()
    return record


def get_all_citizen_reports() -> list[dict]:
    _init_firebase()
    if _using_firebase:
        docs = _db.collection("citizen_reports").order_by(
            "submitted_at", direction="DESCENDING"
        ).limit(500).stream()
        return [d.to_dict() for d in docs]
    return list(_FALLBACK_STORE["citizen_reports"])


def clear_citizen_reports():
    _init_firebase()
    if _using_firebase:
        batch = _db.batch()
        docs = _db.collection("citizen_reports").limit(500).stream()
        for doc in docs:
            batch.delete(doc.reference)
        batch.commit()
    else:
        _FALLBACK_STORE["citizen_reports"].clear()
        _persist_state()


# ---------------------------------------------------------------------------
# Incidents
# ---------------------------------------------------------------------------

def add_incident(record: dict) -> dict:
    _init_firebase()
    if _using_firebase:
        _db.collection("incidents").document(record["incident_id"]).set(record)
    else:
        _FALLBACK_STORE["incidents"].append(record)
        _persist_state()
    return record


def get_all_incidents() -> list[dict]:
    _init_firebase()
    if _using_firebase:
        docs = _db.collection("incidents").order_by(
            "submitted_at", direction="DESCENDING"
        ).limit(200).stream()
        return [d.to_dict() for d in docs]
    return list(_FALLBACK_STORE["incidents"])


def clear_incidents():
    _init_firebase()
    if _using_firebase:
        batch = _db.batch()
        docs = _db.collection("incidents").limit(200).stream()
        for doc in docs:
            batch.delete(doc.reference)
        batch.commit()
    else:
        _FALLBACK_STORE["incidents"].clear()
        _persist_state()


# ---------------------------------------------------------------------------
# Alerts (acknowledged)
# ---------------------------------------------------------------------------

def set_alert(h3_cell: str, record: dict):
    _init_firebase()
    if _using_firebase:
        _db.collection("alerts").document(h3_cell).set(record)
    else:
        _FALLBACK_STORE["alerts"][h3_cell] = record
        _persist_state()


def get_alerts() -> dict[str, dict]:
    _init_firebase()
    if _using_firebase:
        docs = _db.collection("alerts").stream()
        return {d.id: d.to_dict() for d in docs}
    return dict(_FALLBACK_STORE["alerts"])


def clear_alerts():
    _init_firebase()
    if _using_firebase:
        docs = _db.collection("alerts").stream()
        batch = _db.batch()
        for doc in docs:
            batch.delete(doc.reference)
        batch.commit()
    else:
        _FALLBACK_STORE["alerts"].clear()
        _persist_state()


def alert_exists(h3_cell: str) -> bool:
    return h3_cell in get_alerts()


# ---------------------------------------------------------------------------
# Issued alerts
# ---------------------------------------------------------------------------

def set_issued_alert(h3_cell: str, record: dict):
    _init_firebase()
    if _using_firebase:
        _db.collection("issued_alerts").document(h3_cell).set(record)
    else:
        _FALLBACK_STORE["issued_alerts"][h3_cell] = record
        _persist_state()


def get_issued_alerts() -> dict[str, dict]:
    _init_firebase()
    if _using_firebase:
        docs = _db.collection("issued_alerts").stream()
        return {d.id: d.to_dict() for d in docs}
    return dict(_FALLBACK_STORE["issued_alerts"])


def clear_issued_alerts():
    _init_firebase()
    if _using_firebase:
        docs = _db.collection("issued_alerts").stream()
        batch = _db.batch()
        for doc in docs:
            batch.delete(doc.reference)
        batch.commit()
    else:
        _FALLBACK_STORE["issued_alerts"].clear()
        _persist_state()


# ---------------------------------------------------------------------------
# Dismissed
# ---------------------------------------------------------------------------

def set_dismissed(h3_cell: str, record: dict):
    _init_firebase()
    if _using_firebase:
        _db.collection("dismissed").document(h3_cell).set(record)
    else:
        _FALLBACK_STORE["dismissed"][h3_cell] = record
        _persist_state()


def get_dismissed() -> dict[str, dict]:
    _init_firebase()
    if _using_firebase:
        docs = _db.collection("dismissed").stream()
        return {d.id: d.to_dict() for d in docs}
    return dict(_FALLBACK_STORE["dismissed"])


def clear_dismissed():
    _init_firebase()
    if _using_firebase:
        docs = _db.collection("dismissed").stream()
        batch = _db.batch()
        for doc in docs:
            batch.delete(doc.reference)
        batch.commit()
    else:
        _FALLBACK_STORE["dismissed"].clear()
        _persist_state()


def clear_workflow_state():
    """Reset all authority queue state — used by demo re-seed."""
    clear_alerts()
    clear_issued_alerts()
    clear_dismissed()


# ---------------------------------------------------------------------------
# Federated BRICS events
# ---------------------------------------------------------------------------

def save_federated_events(events: list[dict]):
    _init_firebase()
    _FALLBACK_STORE["federated_events"] = list(events)
    _persist_state()


def get_federated_events() -> list[dict]:
    _init_firebase()
    return list(_FALLBACK_STORE.get("federated_events", []))


def clear_federated_events():
    _init_firebase()
    _FALLBACK_STORE["federated_events"] = []
    _persist_state()


# ---------------------------------------------------------------------------
# Sessions — persisted in fallback mode so refresh survives backend restart
# ---------------------------------------------------------------------------

def set_session(token: str, user: dict):
    _init_firebase()
    if _using_firebase:
        _FALLBACK_STORE.setdefault("active_sessions", {})[token] = user
    else:
        _FALLBACK_STORE["active_sessions"][token] = user
        _persist_state()


def get_session(token: str) -> dict | None:
    _init_firebase()
    if _using_firebase:
        return _FALLBACK_STORE.get("active_sessions", {}).get(token)
    return _FALLBACK_STORE["active_sessions"].get(token)


def delete_session(token: str):
    _init_firebase()
    if token in _FALLBACK_STORE.get("active_sessions", {}):
        _FALLBACK_STORE["active_sessions"].pop(token, None)
        _persist_state()


def active_session_count() -> int:
    _init_firebase()
    return len(_FALLBACK_STORE.get("active_sessions", {}))
