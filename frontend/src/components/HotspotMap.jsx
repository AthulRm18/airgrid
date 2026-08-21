import { useMemo, useState, useEffect } from "react";
import { MapContainer, TileLayer, Polygon, CircleMarker, Tooltip as LTooltip, useMap } from "react-leaflet";
import { cellToBoundary } from "h3-js";
import { SEVERITY } from "../lib/severity";
import "leaflet/dist/leaflet.css";

// Delhi-NCR center and zoom
const MAP_CENTER = [28.63, 77.22];
const MAP_ZOOM = 11;

function h3Boundary(cell) {
  try {
    const boundary = cellToBoundary(cell);
    return boundary.map(([lat, lng]) => [lat, lng]);
  } catch {
    return null;
  }
}

export default function HotspotMap({ hotspots, selectedCell, onSelectCell, onOpenEvidence }) {
  const [propagation, setPropagation] = useState(null);
  const [sensors, setSensors] = useState([]);

  // Load ground sensors for map markers
  useEffect(() => {
    fetch("/api/sensors")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setSensors(data?.readings ?? []))
      .catch(() => setSensors([]));
  }, [hotspots.length]);

  // Load propagation when a cell is selected
  useEffect(() => {
    if (!selectedCell) { setPropagation(null); return; }
    fetch(`/api/propagation/${selectedCell}`)
      .then((r) => r.json())
      .then(setPropagation)
      .catch(() => setPropagation(null));
  }, [selectedCell]);

  const hexPolygons = useMemo(() =>
    hotspots.flatMap((h) => {
      const positions = h3Boundary(h.h3_cell);
      if (!positions) return [];
      return [{ ...h, positions }];
    }), [hotspots]
  );

  const corridorPolygons = useMemo(() => {
    if (!propagation?.corridor) return [];
    return propagation.corridor.flatMap((c) => {
      const positions = h3Boundary(c.h3_cell);
      if (!positions) return [];
      return [{ ...c, positions }];
    });
  }, [propagation]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Thin legend strip */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#dde3ea] bg-white px-4 py-2">
        <span className="text-[11px] font-medium text-[#314154]">Pollution grid</span>
        <Legend />
      </div>

      <div className="flex-1">
        <MapContainer
          center={MAP_CENTER}
          zoom={MAP_ZOOM}
          className="h-full w-full"
          zoomControl={true}
          attributionControl={true}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          />

          {/* Propagation corridor (rendered UNDER hotspot hexes) */}
          {corridorPolygons.map((c) => {
            const intensity = c.predicted_intensity || 0.3;
            const color = intensity > 0.5 ? "#e87d3a" : intensity > 0.25 ? "#e8a23d" : "#e8c93d";
            return (
              <Polygon
                key={`prop-${c.h3_cell}`}
                positions={c.positions}
                pathOptions={{
                  fillColor: color,
                  fillOpacity: 0.25 + intensity * 0.2,
                  color: color,
                  weight: 1,
                  opacity: 0.6,
                }}
              >
                <LTooltip sticky>
                  <div style={{ fontSize: 12 }}>
                    <strong>Predicted exposure</strong><br />
                    Intensity: {(intensity * 100).toFixed(0)}%<br />
                    Arrival: ~{c.hours_to_impact}h
                  </div>
                </LTooltip>
              </Polygon>
            );
          })}

          {/* Ground sensor stations */}
          {sensors.map((s) => (
            <CircleMarker
              key={`sensor-${s.station_name}-${s.lat}`}
              center={[s.lat, s.lng]}
              radius={6}
              pathOptions={{
                fillColor: "#4fb8ac",
                fillOpacity: 0.9,
                color: "#fff",
                weight: 1.5,
              }}
            >
              <LTooltip>
                <div style={{ fontSize: 12 }}>
                  <strong>{s.station_name}</strong><br />
                  PM2.5: {s.pm25?.toFixed?.(1) ?? s.pm25} µg/m³<br />
                  <span style={{ color: "#888" }}>{s.source === "openaq_mock" ? "Demo sensor data" : "OpenAQ"}</span>
                </div>
              </LTooltip>
            </CircleMarker>
          ))}

          {/* Hotspot hex cells */}
          {hexPolygons.map((h) => {
            const isSelected = selectedCell === h.h3_cell;
            const sev = SEVERITY[h.severity] ?? SEVERITY.unverified;
            const rawColor = sev.rawColor;
            return (
              <Polygon
                key={h.h3_cell}
                positions={h.positions}
                pathOptions={{
                  fillColor: rawColor,
                  fillOpacity: isSelected ? 0.55 : 0.32,
                  color: rawColor,
                  weight: isSelected ? 3 : 1.5,
                  opacity: isSelected ? 1 : 0.7,
                }}
                eventHandlers={{
                  click: () => onSelectCell(h.h3_cell),
                  dblclick: () => onOpenEvidence?.(h.h3_cell),
                }}
              >
                <LTooltip sticky>
                  <div style={{ fontSize: 12, maxWidth: 220 }}>
                    <strong>{sev.label}</strong>{" "}
                    <span style={{ fontFamily: "monospace", fontSize: 10, color: "#888" }}>
                      {h.h3_cell}
                    </span>
                    <br />
                    {h.confidence_score != null && (
                      <>Confidence: {(h.confidence_score * 100).toFixed(0)}%<br /></>
                    )}
                    {h.sensor_pm25 != null && <>PM2.5: {h.sensor_pm25} µg/m³<br /></>}
                    {h.citizen_report_count > 0 && <>{h.citizen_report_count} citizen report(s)<br /></>}
                    <span style={{ fontSize: 11, color: "#aaa" }}>{h.explanation}</span>
                  </div>
                </LTooltip>
              </Polygon>
            );
          })}

          {/* Wind direction indicator (if propagation loaded) */}
          {propagation?.weather && selectedCell && (
            <WindArrow
              lat={propagation.weather.lat}
              lng={propagation.weather.lng}
              direction={propagation.weather.wind_direction_deg}
              speed={propagation.weather.wind_speed_kmh}
            />
          )}

          <FitBounds hotspots={hotspots} />
        </MapContainer>
      </div>

      {(hotspots.length === 0 && sensors.length === 0) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="rounded-lg bg-white/90 px-3 py-1.5 text-xs text-[#7b8fa1] shadow-sm">
            Loading… or click Seed demo if the backend just started.
          </p>
        </div>
      )}
    </div>
  );
}

function WindArrow({ lat, lng, direction, speed }) {
  // The arrow points in the direction pollution MOVES (wind_from + 180)
  const pollutionDir = (direction + 180) % 360;
  return (
    <CircleMarker
      center={[lat, lng]}
      radius={0}
    >
      <LTooltip permanent direction="top" className="wind-tooltip">
        <div style={{ fontSize: 11, textAlign: "center", whiteSpace: "nowrap" }}>
          <span style={{ display: "inline-block", transform: `rotate(${pollutionDir}deg)`, fontSize: 16 }}>
            ↑
          </span>{" "}
          {speed} km/h
        </div>
      </LTooltip>
    </CircleMarker>
  );
}


function FitBounds({ hotspots }) {
  const map = useMap();
  useEffect(() => {
    if (hotspots.length === 0) return;
    const lats = hotspots.map((h) => h.lat);
    const lngs = hotspots.map((h) => h.lng);
    const bounds = [
      [Math.min(...lats) - 0.02, Math.min(...lngs) - 0.02],
      [Math.max(...lats) + 0.02, Math.max(...lngs) + 0.02],
    ];
    map.fitBounds(bounds, { padding: [20, 20], maxZoom: 12 });
  }, [hotspots.length]); // only on initial load
  return null;
}


function Legend() {
  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-[#7b8fa1]">
      {Object.entries(SEVERITY).map(([key, s]) => (
        <span key={key} className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.rawColor }} />
          {s.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: "#e87d3a" }} />
        Spread
      </span>
    </div>
  );
}
