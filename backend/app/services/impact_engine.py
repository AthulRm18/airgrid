"""
Impact engine — converts environmental intelligence into actionable
decisions by answering: "who will be affected?"

For each H3 cell, calculates:
  - estimated population
  - number of schools
  - number of hospitals
  - impact score = risk × population_exposure × vulnerability_factor

Uses synthetic but plausible data seeded by H3 cell hash so the
numbers are stable across requests and consistent with Delhi-NCR
population density patterns.  In production, this would pull from
a real population grid (WorldPop, SEDAC) and OpenStreetMap POIs.
"""
import hashlib

from app.services.h3_utils import cell_to_latlng


# Major Indian urban centers for density heuristic
_URBAN_CENTERS_INDIA = [
    (28.6139, 77.2090),  # Delhi-NCR
    (19.0760, 72.8777),  # Mumbai
    (12.9716, 77.5946),  # Bengaluru
    (13.0827, 80.2707),  # Chennai
    (22.5726, 88.3639),  # Kolkata
    (17.3850, 78.4867),  # Hyderabad
    (9.9312, 76.2673),   # Kochi / Kerala
    (18.5204, 73.8567),  # Pune
    (23.0225, 72.5714),  # Ahmedabad
]


def get_cell_demographics(h3_cell: str) -> dict:
    """Return population, schools, hospitals for one H3 cell."""
    lat, lng = cell_to_latlng(h3_cell)
    h = int(hashlib.sha256(h3_cell.encode()).hexdigest(), 16)

    # Distance to nearest major urban center → population density proxy
    dist_km = min(_haversine(lat, lng, clat, clng) for clat, clng in _URBAN_CENTERS_INDIA)
    density_factor = max(0.2, 1.0 - dist_km / 50.0)  # 0.2-1.0

    # Population: H3 res-7 cell ≈ 5 km²
    base_pop = int(5000 * density_factor + (h % 8000))
    population = max(1200, min(base_pop, 52000))

    # Schools: roughly 1 per 4000 people in Delhi
    schools = max(0, population // 4000 + (h % 3))

    # Hospitals: roughly 1 per 15000 people
    hospitals = max(0, population // 15000 + (h % 2))

    return {
        "h3_cell": h3_cell,
        "lat": round(lat, 6),
        "lng": round(lng, 6),
        "population": population,
        "schools": schools,
        "hospitals": hospitals,
        "source": "synthetic-demographic-model",
    }


def compute_impact_score(
    h3_cell: str,
    risk_level: float,  # 0-1, from hotspot confidence
) -> dict:
    """Full impact assessment for one cell.

    Impact Score = risk × population_exposure × vulnerability_factor

    vulnerability_factor accounts for the presence of sensitive
    facilities (schools, hospitals) where exposure is more dangerous.
    """
    demo = get_cell_demographics(h3_cell)
    population = demo["population"]
    schools = demo["schools"]
    hospitals = demo["hospitals"]

    # Normalize population to 0-1 (50k = 1.0)
    pop_exposure = min(population / 50000.0, 1.0)

    # Vulnerability: base 1.0, +0.15 per school, +0.25 per hospital
    vulnerability = min(1.0 + schools * 0.15 + hospitals * 0.25, 2.5)

    impact_score = round(risk_level * pop_exposure * vulnerability, 3)

    # Priority classification
    if impact_score >= 0.7:
        priority = "CRITICAL"
    elif impact_score >= 0.4:
        priority = "HIGH"
    elif impact_score >= 0.2:
        priority = "MODERATE"
    else:
        priority = "LOW"

    return {
        **demo,
        "risk_level": round(risk_level, 3),
        "population_exposure": round(pop_exposure, 3),
        "vulnerability_factor": round(vulnerability, 3),
        "impact_score": impact_score,
        "priority": priority,
    }


def compute_corridor_impact(
    corridor: list[dict],  # from propagation.compute_propagation_corridor
    source_risk: float,
) -> dict:
    """Aggregate impact across an entire predicted exposure corridor."""
    total_population = 0
    total_schools = 0
    total_hospitals = 0
    cell_impacts = []

    for cell_entry in corridor:
        cell_risk = source_risk * cell_entry.get("predicted_intensity", 0.5)
        impact = compute_impact_score(cell_entry["h3_cell"], cell_risk)
        total_population += impact["population"]
        total_schools += impact["schools"]
        total_hospitals += impact["hospitals"]
        cell_impacts.append(impact)

    # Overall corridor priority
    if total_population >= 40000 or any(c["priority"] == "CRITICAL" for c in cell_impacts):
        corridor_priority = "CRITICAL"
    elif total_population >= 20000:
        corridor_priority = "HIGH"
    elif total_population >= 5000:
        corridor_priority = "MODERATE"
    else:
        corridor_priority = "LOW"

    return {
        "total_population_at_risk": total_population,
        "total_schools": total_schools,
        "total_hospitals": total_hospitals,
        "corridor_priority": corridor_priority,
        "cell_count": len(corridor),
        "cell_impacts": cell_impacts,
    }


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Haversine distance in km."""
    import math
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlng / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
