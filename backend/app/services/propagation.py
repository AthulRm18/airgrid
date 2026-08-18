"""
Wind-aware spatial pollution propagation — VIGIL's major visual feature.

Given a hotspot cell, current wind direction/speed, and pollution
intensity, estimates which neighboring H3 cells are likely to be
affected next and when.

This is NOT a full atmospheric dispersion simulation.  It is a
**weather-aware short-term pollution movement estimation** using:
  - wind direction → which neighbors are downwind
  - wind speed → how quickly the plume reaches each ring
  - pollution intensity → how far the effect extends
  - H3 neighbor rings → discrete spatial steps

The output is a list of cells forming a "predicted exposure corridor"
that the map renders as an orange→yellow gradient spreading from the
red source cell.
"""
import math

from app.services.h3_utils import cell_to_latlng, neighbors


# Rough H3 res-7 cell edge-to-edge distance in km
_H3_RES7_STEP_KM = 2.5


def compute_propagation_corridor(
    source_cell: str,
    wind_direction_deg: float,
    wind_speed_kmh: float,
    source_intensity: float,  # 0-1 normalized pollution severity
    max_rings: int = 4,
) -> list[dict]:
    """Returns a list of cells in the predicted exposure corridor,
    sorted by estimated time-to-impact.

    Each entry:
      {
        "h3_cell": str,
        "lat": float, "lng": float,
        "ring": int,                    # 1-4 (distance from source)
        "hours_to_impact": float,       # estimated arrival time
        "predicted_intensity": float,   # 0-1, decays with distance
        "is_downwind": bool,
        "angular_weight": float,        # 0-1, how aligned with wind
      }
    """
    if wind_speed_kmh < 2:
        # Calm conditions — pollution stays in place, no corridor
        return []

    source_lat, source_lng = cell_to_latlng(source_cell)
    corridor = []

    for ring in range(1, max_rings + 1):
        # Get all cells exactly `ring` steps away
        ring_cells = neighbors(source_cell, ring) - neighbors(source_cell, ring - 1) if ring > 1 else neighbors(source_cell, 1) - {source_cell}

        for cell in ring_cells:
            cell_lat, cell_lng = cell_to_latlng(cell)

            # Bearing from source to this cell
            bearing = _bearing(source_lat, source_lng, cell_lat, cell_lng)

            # Angular distance from wind direction
            # Wind direction is where wind comes FROM, so pollution moves
            # in the direction (wind_direction + 180) % 360
            pollution_direction = (wind_direction_deg + 180) % 360
            angle_diff = abs(_angle_diff(bearing, pollution_direction))

            # Cells within ±60° of the pollution direction are "downwind"
            is_downwind = angle_diff <= 60
            # Angular weight: 1.0 if perfectly aligned, 0 if perpendicular
            angular_weight = max(0.0, 1.0 - angle_diff / 90.0)

            if angular_weight < 0.15:
                continue  # Skip upwind cells

            # Time to impact: distance / wind speed
            distance_km = ring * _H3_RES7_STEP_KM
            hours_to_impact = distance_km / wind_speed_kmh

            # Intensity decays with distance and angular offset
            decay = math.exp(-0.5 * ring) * angular_weight
            predicted_intensity = round(source_intensity * decay, 3)

            if predicted_intensity < 0.05:
                continue  # Below noise threshold

            corridor.append({
                "h3_cell": cell,
                "lat": round(cell_lat, 6),
                "lng": round(cell_lng, 6),
                "ring": ring,
                "hours_to_impact": round(hours_to_impact, 1),
                "predicted_intensity": predicted_intensity,
                "is_downwind": is_downwind,
                "angular_weight": round(angular_weight, 3),
            })

    # Sort by time to impact
    corridor.sort(key=lambda c: (c["hours_to_impact"], -c["predicted_intensity"]))
    return corridor


def _bearing(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Bearing in degrees from point 1 to point 2."""
    lat1, lng1, lat2, lng2 = map(math.radians, [lat1, lng1, lat2, lng2])
    dlon = lng2 - lng1
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    bearing = math.degrees(math.atan2(x, y))
    return (bearing + 360) % 360


def _angle_diff(a: float, b: float) -> float:
    """Smallest signed angle difference between two bearings."""
    diff = (b - a + 180) % 360 - 180
    return diff
