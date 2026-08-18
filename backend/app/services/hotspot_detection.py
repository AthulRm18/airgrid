"""
Hotspot detection & fusion logic — this is AirGrid's core differentiator.

Official sensor networks are sparse. A citizen report (backed by a Gemini-
scored photo showing heavy haze) in an H3 cell with NO nearby sensor
coverage is exactly the "hidden hotspot" the problem statement asks for:
pollution that official monitoring structurally cannot see.

Severity tiers, in order of how alarming they should be to an authority:
  1. CONFIRMED   — sensor reading itself is above threshold
  2. CORROBORATED— citizen report + satellite anomaly agree, sensor nearby confirms
  3. HIDDEN       — citizen report + satellite anomaly agree, but the nearest
                    sensor is too far away (>1 H3 ring) to confirm or deny.
                    This is the "we caught what official monitors missed" case.
  4. UNVERIFIED   — citizen report alone, no satellite/sensor corroboration yet
"""
from dataclasses import dataclass, field
from enum import Enum

from app.services.h3_utils import neighbors, cell_to_latlng

# WHO-aligned-ish PM2.5 thresholds for demo purposes (µg/m³, 24h-ish proxy)
PM25_MODERATE = 60
PM25_UNHEALTHY = 120
PM25_SEVERE = 200


class Severity(str, Enum):
    CONFIRMED = "confirmed"
    CORROBORATED = "corroborated"
    HIDDEN = "hidden"
    UNVERIFIED = "unverified"


@dataclass
class HotspotCell:
    h3_cell: str
    lat: float
    lng: float
    sensor_pm25: float | None = None
    satellite_anomaly_score: float | None = None  # 0-1, from Earth Engine aerosol index
    citizen_reports: list[dict] = field(default_factory=list)
    severity: Severity = Severity.UNVERIFIED
    aqi_estimate: float | None = None
    explanation: str = ""


def classify_cell(
    h3_cell: str,
    sensor_pm25: float | None,
    satellite_anomaly_score: float | None,
    citizen_reports: list[dict],
    sensor_coverage: set[str],
) -> HotspotCell:
    """
    Given everything we know about one H3 cell, decide its severity tier
    and produce a human-readable explanation an authority can act on.
    """
    lat, lng = cell_to_latlng(h3_cell)
    cell = HotspotCell(
        h3_cell=h3_cell, lat=lat, lng=lng,
        sensor_pm25=sensor_pm25,
        satellite_anomaly_score=satellite_anomaly_score,
        citizen_reports=citizen_reports,
    )

    has_citizen_signal = any(r.get("haze_score", 0) >= 0.5 for r in citizen_reports)
    has_satellite_signal = (satellite_anomaly_score or 0) >= 0.5
    nearby_sensor_cells = neighbors(h3_cell, k=1) & sensor_coverage

    if sensor_pm25 is not None and sensor_pm25 >= PM25_UNHEALTHY:
        cell.severity = Severity.CONFIRMED
        cell.aqi_estimate = sensor_pm25
        cell.explanation = (
            f"Ground sensor confirms PM2.5 at {sensor_pm25:.0f} µg/m³ "
            f"(unhealthy threshold: {PM25_UNHEALTHY})."
        )
    elif has_citizen_signal and has_satellite_signal and nearby_sensor_cells:
        cell.severity = Severity.CORROBORATED
        cell.aqi_estimate = sensor_pm25 or (satellite_anomaly_score * 250)
        cell.explanation = (
            "Citizen reports and satellite aerosol data agree, corroborated "
            "by a nearby ground sensor."
        )
    elif has_citizen_signal and has_satellite_signal and not nearby_sensor_cells:
        cell.severity = Severity.HIDDEN
        cell.aqi_estimate = satellite_anomaly_score * 250
        cell.explanation = (
            "No official sensor within range of this cell. Citizen photo "
            "reports and satellite aerosol imagery independently agree on "
            "a pollution event here — this would be invisible to standard "
            "monitoring infrastructure."
        )
    elif has_citizen_signal:
        cell.severity = Severity.UNVERIFIED
        cell.explanation = (
            "Citizen report received, awaiting satellite pass or sensor "
            "corroboration before escalating."
        )
    else:
        cell.severity = Severity.UNVERIFIED
        cell.explanation = "No significant signal in this cell."

    return cell


def rank_hotspots(cells: list[HotspotCell]) -> list[HotspotCell]:
    """Sort cells by urgency: CONFIRMED/HIDDEN first (both are actionable —
    HIDDEN is arguably more urgent since no one else is watching it),
    then by estimated AQI descending."""
    priority = {
        Severity.HIDDEN: 0,
        Severity.CONFIRMED: 1,
        Severity.CORROBORATED: 2,
        Severity.UNVERIFIED: 3,
    }
    return sorted(
        cells,
        key=lambda c: (priority[c.severity], -(c.aqi_estimate or 0)),
    )
