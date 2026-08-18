"""
H3 spatial indexing utilities.

Everything in AirGrid — citizen reports, sensor readings, satellite pixels —
gets binned into H3 cells so we can fuse heterogeneous sources at a common
spatial resolution and run hotspot detection / forecasting per-cell.
"""
import h3
from typing import Iterable

# Resolution 7 ≈ ~5.16 km^2 hexagons — good balance for city/district-scale
# pollution monitoring. Res 8 (~0.74 km^2) is better for dense urban areas
# if you want finer granularity later.
DEFAULT_RESOLUTION = 7


def latlng_to_cell(lat: float, lng: float, resolution: int = DEFAULT_RESOLUTION) -> str:
    """Bin a lat/lng point into an H3 cell index."""
    return h3.latlng_to_cell(lat, lng, resolution)


def cell_to_latlng(cell: str) -> tuple[float, float]:
    """Get the center lat/lng of an H3 cell (for map markers)."""
    return h3.cell_to_latlng(cell)


def cell_to_boundary(cell: str) -> list[tuple[float, float]]:
    """Get the hex boundary vertices of an H3 cell (for rendering polygons on a map)."""
    return h3.cell_to_boundary(cell)


def neighbors(cell: str, k: int = 1) -> set[str]:
    """Get the ring of neighboring cells within k steps — used to check
    whether a detected anomaly is isolated noise or a real spreading hotspot."""
    return set(h3.grid_disk(cell, k))


def cells_in_bbox(min_lat: float, min_lng: float, max_lat: float, max_lng: float,
                   resolution: int = DEFAULT_RESOLUTION) -> list[str]:
    """Get all H3 cells covering a bounding box — useful for seeding a
    region (e.g. Delhi-NCR) with a full grid before data arrives."""
    poly = h3.LatLngPoly([
        (min_lat, min_lng),
        (min_lat, max_lng),
        (max_lat, max_lng),
        (max_lat, min_lng),
    ])
    return list(h3.polygon_to_cells(poly, resolution))


def bin_points(points: Iterable[dict], resolution: int = DEFAULT_RESOLUTION) -> dict[str, list[dict]]:
    """
    Bin a list of points (each a dict with 'lat' and 'lng' keys, plus
    whatever payload) into H3 cells.

    Returns: {h3_cell: [point, point, ...]}
    """
    bins: dict[str, list[dict]] = {}
    for p in points:
        cell = latlng_to_cell(p["lat"], p["lng"], resolution)
        bins.setdefault(cell, []).append(p)
    return bins
