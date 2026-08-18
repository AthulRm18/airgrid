import { useMemo, useState, useEffect } from "react";
import { MapContainer, TileLayer, Polygon, CircleMarker, Tooltip as LTooltip, useMap } from "react-leaflet";
import { cellToBoundary } from "h3-js";
import { SEVERITY } from "../lib/severity";
import "leaflet/dist/leaflet.css";

// Delhi-NCR center and zoom
const MAP_CENTER = [28.63, 77.22];
const MAP_ZOOM = 11;

export default function HotspotMap({ hotspots, selectedCell, onSelectCell, onOpenEvidence }) {
  const [propagation, setPropagation] = useState(null);
  const [sensors, setSensors] = useState([]);

  // Load propagation when a cell is selected
  useEffect(() => {
    if (!selectedCell) { setPropagation(null); return; }
    fetch(`/api/propagation/${selectedCell}`)
      .then((r) => r.json())
      .then(setPropagation)
      .catch(() => setPropagation(null));
  }, [selectedCell]);

  const hexPolygons = useMemo(() =>
    hotspots.map((h) => {
      const boundary = cellToBoundary(h.h3_cell); // returns [lat, lng]
      const positions = boundary.map(([lat, lng]) => [lat, lng]);
      return { ...h, positions };
    }), [hotspots]
  );

  const corridorPolygons = useMemo(() => {
    if (!propagation?.corridor) return [];
    return propagation.corridor.map((c) => {
      const boundary = cellToBoundary(c.h3_cell);
      const positions = boundary.map(([lat, lng]) => [lat, lng]);
      return { ...c, positions };
    });
  }, [propagation]);

  return (
    <div className="relative rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] haze-backdrop overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--color-mist-50)]">
          Pollution intelligence grid
        </h2>
        <Legend />
      </div>

      <div className="h-[480px]">
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

      {hotspots.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-[var(--color-mist-400)] text-sm bg-[var(--color-ink-900)]/80 px-4 py-2 rounded-lg">
            No hotspots yet — submit a citizen report or seed demo data.
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
    <div className="flex flex-wrap gap-3 text-xs text-[var(--color-mist-400)]">
      {Object.entries(SEVERITY).map(([key, s]) => (
        <span key={key} className="flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: s.rawColor }}
          />
          {s.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#e87d3a" }} />
        Predicted spread
      </span>
    </div>
  );
}
