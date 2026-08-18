// Simple equirectangular projection — accurate enough at city/district
// scale (a few tens of km), which is all AirGrid's H3 res-7 grid needs.
// bbox: [minLng, minLat, maxLng, maxLat]
export function makeProjector(bbox, width, height, padding = 24) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const lngSpan = maxLng - minLng;
  const latSpan = maxLat - minLat;

  return function project([lat, lng]) {
    const x = padding + ((lng - minLng) / lngSpan) * (width - padding * 2);
    // invert y: higher latitude = further north = smaller y (top of SVG)
    const y = padding + (1 - (lat - minLat) / latSpan) * (height - padding * 2);
    return [x, y];
  };
}
