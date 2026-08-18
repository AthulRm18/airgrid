"""
Hotspot detection & evidence-fusion logic — VIGIL's core differentiator.

Replaces the boolean severity logic with a weighted **evidence-fusion
confidence score** that combines:

  satellite_anomaly     → 0.32 weight
  citizen_evidence      → 0.24 weight
  historical_deviation  → 0.16 weight
  weather_consistency   → 0.10 weight
  sensor_evidence       → 0.12 weight
  coverage_uncertainty  → 0.06 weight

The confidence score is labeled as **Hotspot Confidence** rather than
a calibrated probability — it is a transparent weighted scoring model,
not a scientifically validated probability estimate.

Severity tiers remain for backward compatibility and quick visual
scanning, but are now derived from the confidence score.
"""
from dataclasses import dataclass, field
from enum import Enum

from app.services.h3_utils import neighbors, cell_to_latlng

# India-realistic PM2.5 thresholds (µg/m³)
# India NAAQS 24h standard = 60; WHO 24h target = 15 (rarely achievable in Delhi)
PM25_MODERATE = 35    # noticeable elevated
PM25_UNHEALTHY = 60   # India standard exceeded → CONFIRMED
PM25_SEVERE = 120     # highly hazardous


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
    # --- New fields for evidence-fusion ---
    confidence_score: float = 0.0
    evidence_breakdown: dict = field(default_factory=dict)
    historical_baseline: float | None = None
    historical_stddev: float | None = None
    weather_data: dict | None = None


# --- Evidence-fusion weights (transparent, explainable) ---
WEIGHTS = {
    "satellite_anomaly": 0.24,    # Lowered slightly to balance with sensor
    "citizen_evidence": 0.24,
    "historical_deviation": 0.16,
    "weather_consistency": 0.10,
    "sensor_evidence": 0.20,      # Raised: ground truth is most reliable
    "coverage_uncertainty": 0.06,
}


def _compute_satellite_signal(score: float | None) -> float:
    """0-1: how strong is the satellite anomaly signal?"""
    if score is None:
        return 0.0
    # Score >= 0.5 is considered anomalous; 0.8+ is strong
    return min(score / 0.8, 1.0)


def _compute_citizen_signal(reports: list[dict]) -> float:
    """0-1: how strong is the citizen evidence?"""
    if not reports:
        return 0.0
    # More reports + higher haze scores = stronger signal
    high_confidence_count = sum(1 for r in reports if r.get("haze_score", 0) >= 0.5)
    avg_haze = sum(r.get("haze_score", 0) for r in reports) / len(reports)
    # Scale: 1 report = ~0.3, 3 reports = ~0.6, 7+ reports = ~1.0
    count_factor = min(len(reports) / 7.0, 1.0)
    return min((count_factor * 0.5 + avg_haze * 0.5), 1.0)


def _compute_historical_deviation(
    current_pm25: float | None,
    baseline: float | None,
    stddev: float | None,
) -> float:
    """0-1: how far above historical baseline is the current reading?"""
    if current_pm25 is None or baseline is None or stddev is None:
        return 0.0
    if stddev < 1:
        stddev = 1  # avoid division by zero
    z_score = (current_pm25 - baseline) / stddev
    # z_score of 2+ = strong deviation, 3+ = extreme
    return min(max(z_score / 3.0, 0.0), 1.0)


def _compute_sensor_signal(sensor_pm25: float | None) -> float:
    """0-1: what does the ground sensor tell us?"""
    if sensor_pm25 is None:
        return 0.0
    if sensor_pm25 >= PM25_SEVERE:
        return 1.0
    if sensor_pm25 >= PM25_UNHEALTHY:
        return 0.7
    if sensor_pm25 >= PM25_MODERATE:
        return 0.4
    return max(sensor_pm25 / PM25_MODERATE * 0.3, 0.0)


def _compute_coverage_score(h3_cell: str, sensor_coverage: set[str]) -> float:
    """0-1: how much does the ABSENCE of sensor coverage contribute
    to the need for this alert? Higher score = less coverage = more
    need for VIGIL's intelligence."""
    nearby = neighbors(h3_cell, k=1) & sensor_coverage
    if h3_cell in sensor_coverage:
        return 0.1  # Cell itself has a sensor — coverage is good
    if nearby:
        return 0.4  # Some neighbors have sensors
    # Check ring-2
    ring2 = neighbors(h3_cell, k=2) & sensor_coverage
    if ring2:
        return 0.7  # Sensors exist but far away
    return 1.0  # No sensors anywhere nearby — maximum blind spot


def compute_evidence_fusion(
    h3_cell: str,
    sensor_pm25: float | None,
    satellite_anomaly_score: float | None,
    citizen_reports: list[dict],
    sensor_coverage: set[str],
    historical_baseline: float | None = None,
    historical_stddev: float | None = None,
    weather_consistency: float = 0.5,
) -> tuple[float, dict]:
    """Compute the evidence-fusion confidence score.

    Returns (confidence_score, evidence_breakdown).
    """
    signals = {
        "satellite_anomaly": _compute_satellite_signal(satellite_anomaly_score),
        "citizen_evidence": _compute_citizen_signal(citizen_reports),
        "historical_deviation": _compute_historical_deviation(
            sensor_pm25, historical_baseline, historical_stddev
        ),
        "weather_consistency": weather_consistency,
        "sensor_evidence": _compute_sensor_signal(sensor_pm25),
        "coverage_uncertainty": _compute_coverage_score(h3_cell, sensor_coverage),
    }

    # Weighted sum
    confidence = sum(signals[k] * WEIGHTS[k] for k in WEIGHTS)
    # Clamp to [0, 1]
    confidence = round(min(max(confidence, 0.0), 1.0), 3)

    evidence_breakdown = {
        k: {
            "signal_strength": round(signals[k], 3),
            "weight": WEIGHTS[k],
            "contribution": round(signals[k] * WEIGHTS[k], 4),
        }
        for k in WEIGHTS
    }

    return confidence, evidence_breakdown


def classify_cell(
    h3_cell: str,
    sensor_pm25: float | None,
    satellite_anomaly_score: float | None,
    citizen_reports: list[dict],
    sensor_coverage: set[str],
    historical_baseline: float | None = None,
    historical_stddev: float | None = None,
    weather_data: dict | None = None,
) -> HotspotCell:
    """
    Given everything we know about one H3 cell, compute evidence-fusion
    confidence score and derive severity tier + explanation.
    """
    lat, lng = cell_to_latlng(h3_cell)

    # Weather consistency score
    weather_consistency = 0.5  # default neutral
    if weather_data:
        from app.services.weather_client import weather_consistency_score
        weather_consistency = weather_consistency_score(weather_data)

    confidence, evidence_breakdown = compute_evidence_fusion(
        h3_cell, sensor_pm25, satellite_anomaly_score,
        citizen_reports, sensor_coverage,
        historical_baseline, historical_stddev,
        weather_consistency,
    )

    cell = HotspotCell(
        h3_cell=h3_cell, lat=lat, lng=lng,
        sensor_pm25=sensor_pm25,
        satellite_anomaly_score=satellite_anomaly_score,
        citizen_reports=citizen_reports,
        confidence_score=confidence,
        evidence_breakdown=evidence_breakdown,
        historical_baseline=historical_baseline,
        historical_stddev=historical_stddev,
        weather_data=weather_data,
    )

    # --- Derive severity tier from evidence signals ---
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
    elif has_citizen_signal and has_satellite_signal and not nearby_sensor_cells:
        cell.severity = Severity.HIDDEN
        cell.aqi_estimate = satellite_anomaly_score * 250
        cell.explanation = (
            "No official sensor within range of this cell. Citizen photo "
            "reports and satellite aerosol imagery independently agree on "
            "a pollution event here — this would be invisible to standard "
            "monitoring infrastructure."
        )
    elif has_citizen_signal and has_satellite_signal and nearby_sensor_cells:
        cell.severity = Severity.CORROBORATED
        cell.aqi_estimate = sensor_pm25 or (satellite_anomaly_score * 250)
        cell.explanation = (
            "Citizen reports and satellite aerosol data agree, corroborated "
            "by a nearby ground sensor."
        )
    elif has_citizen_signal or confidence >= 0.4:
        cell.severity = Severity.UNVERIFIED
        if has_citizen_signal:
            cell.explanation = (
                "Citizen report received, awaiting satellite pass or sensor "
                "corroboration before escalating."
            )
        else:
            cell.explanation = "Elevated multi-signal score, under observation."
    else:
        cell.severity = Severity.UNVERIFIED
        cell.explanation = "No significant signal in this cell."

    return cell


def rank_hotspots(cells: list[HotspotCell]) -> list[HotspotCell]:
    """Sort cells by urgency: HIDDEN first (no one else watching),
    then CONFIRMED, then by confidence score descending."""
    priority = {
        Severity.HIDDEN: 0,
        Severity.CONFIRMED: 1,
        Severity.CORROBORATED: 2,
        Severity.UNVERIFIED: 3,
    }
    return sorted(
        cells,
        key=lambda c: (priority[c.severity], -c.confidence_score, -(c.aqi_estimate or 0)),
    )
