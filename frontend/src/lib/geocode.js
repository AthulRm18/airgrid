/**
 * Reverse-geocode lat/lng to a human-readable place name.
 *
 * Uses a curated lookup table of known monitoring locations first (instant),
 * then falls back to OpenStreetMap Nominatim for unknown coordinates.
 * Results are cached in-memory to avoid repeated API calls.
 */

// Known monitoring locations — covers all LOCATIONS in ReportPanel plus demo seeds
const KNOWN_PLACES = [
  // Delhi-NCR
  { lat: 28.6469, lng: 77.3157, name: "Anand Vihar, Delhi" },
  { lat: 28.7041, lng: 77.1025, name: "Rohini, Delhi" },
  { lat: 28.628, lng: 77.364, name: "Noida Sector 62, UP" },
  { lat: 28.669, lng: 77.453, name: "Ghaziabad Industrial, UP" },
  { lat: 28.6315, lng: 77.2167, name: "Connaught Place, Delhi" },
  { lat: 28.652, lng: 77.32, name: "Near Anand Vihar, Delhi" },
  { lat: 28.649, lng: 77.318, name: "Near Anand Vihar, Delhi" },
  // Kerala / South
  { lat: 10.076, lng: 76.299, name: "Eloor Industrial, Kochi" },
  { lat: 10.078, lng: 76.3015, name: "Eloor Industrial, Kochi" },
  { lat: 10.0745, lng: 76.297, name: "Eloor Industrial, Kochi" },
  { lat: 9.988, lng: 76.362, name: "Brahmapuram, Kochi" },
  { lat: 9.9656, lng: 76.3219, name: "Vyttila Hub, Kochi" },
  { lat: 8.5241, lng: 76.9366, name: "Pattom, Thiruvananthapuram" },
  // Mumbai / West
  { lat: 19.0522, lng: 72.9005, name: "Chembur Industrial, Mumbai" },
  { lat: 19.054, lng: 72.903, name: "Chembur Industrial, Mumbai" },
  { lat: 19.051, lng: 72.898, name: "Mahul Village, Mumbai" },
  { lat: 19.0657, lng: 72.8687, name: "BKC, Mumbai" },
  { lat: 19.1075, lng: 73.0033, name: "Navi Mumbai Industrial" },
  // Bengaluru
  { lat: 13.0285, lng: 77.5197, name: "Peenya Industrial, Bengaluru" },
  { lat: 13.033, lng: 77.524, name: "Peenya Industrial, Bengaluru" },
  { lat: 12.9698, lng: 77.75, name: "Whitefield, Bengaluru" },
  // Kolkata
  { lat: 22.5958, lng: 88.2636, name: "Howrah Industrial, Kolkata" },
  { lat: 22.5804, lng: 88.4378, name: "Salt Lake, Kolkata" },
  // Hyderabad & Chennai
  { lat: 17.4565, lng: 78.4439, name: "Sanathnagar, Hyderabad" },
  { lat: 13.1667, lng: 80.2667, name: "Manali, Chennai" },
];

// Distance threshold for known-place matching (in degrees ≈ ~0.5 km)
const MATCH_THRESHOLD = 0.015;

// In-memory cache for reverse geocoding results
const _cache = new Map();

/**
 * Find the nearest known place to the given coordinates.
 * Returns the place name or null if none are close enough.
 */
function findKnownPlace(lat, lng) {
  let best = null;
  let bestDist = Infinity;
  for (const p of KNOWN_PLACES) {
    const d = Math.abs(p.lat - lat) + Math.abs(p.lng - lng);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return bestDist <= MATCH_THRESHOLD ? best.name : null;
}

/**
 * Reverse-geocode coordinates using region-based heuristics.
 * This avoids external API calls entirely while still giving meaningful names.
 */
function geolocateByRegion(lat, lng) {
  // Delhi-NCR
  if (lat >= 28.3 && lat <= 29.0 && lng >= 76.5 && lng <= 77.8) {
    if (lat >= 28.6 && lat <= 28.7 && lng >= 77.25 && lng <= 77.35) return "Near Anand Vihar, Delhi";
    if (lat >= 28.68 && lat <= 28.73) return "Rohini Area, Delhi";
    if (lat >= 28.60 && lng >= 77.35) return "Noida/Ghaziabad, NCR";
    if (lat >= 28.55 && lat <= 28.65 && lng >= 77.1 && lng <= 77.3) return "Central Delhi";
    return "Delhi-NCR Region";
  }
  // Kerala
  if (lat >= 8.2 && lat <= 12.5 && lng >= 75.0 && lng <= 77.8) {
    if (lat >= 9.8 && lat <= 10.2 && lng >= 76.1 && lng <= 76.5) return "Greater Kochi, Kerala";
    if (lat >= 8.4 && lat <= 8.6) return "Thiruvananthapuram Area, Kerala";
    return "Kerala";
  }
  // Mumbai
  if (lat >= 18.5 && lat <= 19.5 && lng >= 72.5 && lng <= 73.5) {
    if (lat >= 19.0 && lat <= 19.1 && lng >= 72.85 && lng <= 72.95) return "Chembur-Mahul, Mumbai";
    if (lat >= 19.0 && lat <= 19.1 && lng >= 72.95) return "Navi Mumbai";
    return "Mumbai Metro Area";
  }
  // Bengaluru
  if (lat >= 12.5 && lat <= 13.5 && lng >= 77.2 && lng <= 78.0) {
    if (lat >= 13.0 && lat <= 13.05 && lng >= 77.49 && lng <= 77.55) return "Peenya Area, Bengaluru";
    return "Bengaluru Metro Area";
  }
  // Kolkata
  if (lat >= 22.0 && lat <= 23.0 && lng >= 88.0 && lng <= 89.0) {
    if (lng <= 88.35) return "Howrah Area, Kolkata";
    return "Kolkata Metro Area";
  }
  // Hyderabad
  if (lat >= 17.0 && lat <= 18.0 && lng >= 78.0 && lng <= 79.0) return "Hyderabad Area";
  // Chennai
  if (lat >= 12.8 && lat <= 13.3 && lng >= 80.0 && lng <= 80.5) return "Chennai Area";

  return `${lat.toFixed(2)}°N, ${lng.toFixed(2)}°E`;
}

/**
 * Get a human-readable place name for coordinates.
 * Checks known places first, then uses region heuristics.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {string} Place name
 */
export function getPlaceName(lat, lng) {
  if (lat == null || lng == null) return "Unknown location";

  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (_cache.has(key)) return _cache.get(key);

  // Try exact known-place match first
  const known = findKnownPlace(lat, lng);
  if (known) {
    _cache.set(key, known);
    return known;
  }

  // Fall back to region-based heuristic
  const region = geolocateByRegion(lat, lng);
  _cache.set(key, region);
  return region;
}

/**
 * Async reverse geocode using Nominatim (external).
 * Use sparingly — rate-limited to 1 req/sec by OSM policy.
 * Results are cached.
 */
export async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return "Unknown location";

  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (_cache.has(key)) return _cache.get(key);

  // Try known places first (instant)
  const known = findKnownPlace(lat, lng);
  if (known) {
    _cache.set(key, known);
    return known;
  }

  // Try Nominatim
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=14&addressdetails=1`,
      { headers: { "Accept-Language": "en" } }
    );
    if (res.ok) {
      const data = await res.json();
      const addr = data.address || {};
      const parts = [
        addr.suburb || addr.neighbourhood || addr.village || "",
        addr.city || addr.town || addr.county || "",
        addr.state || "",
      ].filter(Boolean);
      const name = parts.slice(0, 2).join(", ") || data.display_name?.split(",").slice(0, 2).join(",") || geolocateByRegion(lat, lng);
      _cache.set(key, name);
      return name;
    }
  } catch {
    // Nominatim unavailable — use heuristic
  }

  const fallback = geolocateByRegion(lat, lng);
  _cache.set(key, fallback);
  return fallback;
}

export default getPlaceName;
