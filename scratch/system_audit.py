import json
import urllib.request
import urllib.parse
import time

BASE_URL = "http://localhost:8000"

def get(path):
    req = urllib.request.Request(f"{BASE_URL}{path}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))

def post(path, data=None):
    body = json.dumps(data).encode("utf-8") if data else b"{}"
    req = urllib.request.Request(f"{BASE_URL}{path}", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))

def audit():
    print("=== SYSTEM AUDIT START ===")
    
    # 1. Test /api/data-sources
    status, ds = get("/api/data-sources")
    print(f"[1] /api/data-sources: status={status}, data={ds}", flush=True)
    
    # 2. Test /api/demo/seed
    status, seed_res = post("/api/demo/seed")
    print(f"[2] /api/demo/seed: status={status}, seeded={seed_res.get('seeded')} reports, brics={seed_res.get('brics_events')}", flush=True)
    
    # 3. Test /api/sensors
    status, sensors = get("/api/sensors")
    print(f"[3] /api/sensors: status={status}, count={sensors.get('count')}, source={sensors.get('data_source')}", flush=True)
    
    # 4. Test /api/citizen-reports
    status, reports = get("/api/citizen-reports")
    print(f"[4] /api/citizen-reports: status={status}, count={reports.get('count')}", flush=True)
    
    # 5. Test /api/hotspots across India
    status, hotspots = get("/api/hotspots")
    print(f"[5] /api/hotspots: status={status}, count={hotspots.get('count')}", flush=True)
    
    # Inspect geographic distribution of hotspots
    cells = hotspots.get("hotspots", [])
    regions = {
        "Delhi": [c for c in cells if 28.0 <= c["lat"] <= 29.0 and 76.5 <= c["lng"] <= 77.8],
        "Kerala": [c for c in cells if 8.2 <= c["lat"] <= 12.5 and 75.0 <= c["lng"] <= 77.8],
        "Mumbai": [c for c in cells if 18.5 <= c["lat"] <= 19.5 and 72.5 <= c["lng"] <= 73.5],
        "Bengaluru": [c for c in cells if 12.5 <= c["lat"] <= 13.5 and 77.2 <= c["lng"] <= 78.0],
        "Kolkata": [c for c in cells if 22.0 <= c["lat"] <= 23.0 and 88.0 <= c["lng"] <= 89.0],
    }
    for reg, items in regions.items():
        print(f"    Region '{reg}': {len(items)} hotspots detected -> {[c['severity'] for c in items]}", flush=True)
    
    # 6. Test Evidence generation on primary cell
    if cells:
        test_cell = cells[0]["h3_cell"]
        status, evidence = get(f"/api/hotspots/{test_cell}/evidence?fast=true")
        print(f"[6] /api/hotspots/{test_cell}/evidence: status={status}, severity={evidence.get('severity')}", flush=True)
        demo_stats = evidence.get("demographics", {})
        print(f"    Demographics: pop={demo_stats.get('estimated_population')}, schools={demo_stats.get('schools')}, hospitals={demo_stats.get('hospitals')}", flush=True)
        corridor = evidence.get("corridor_demographics", {})
        print(f"    Corridor: cells={corridor.get('corridor_cells')}, pop={corridor.get('corridor_population')}, schools={corridor.get('corridor_schools')}", flush=True)

    # 7. Test Summary stats
    status, summary = get("/api/summary")
    print(f"[7] /api/summary: status={status}, active={summary.get('active_hotspots')}, hidden={summary.get('hidden_hotspots')}, at_risk={summary.get('population_at_risk')}", flush=True)

    print("=== SYSTEM AUDIT COMPLETED SUCCESSFULLY ===", flush=True)

if __name__ == "__main__":
    audit()
