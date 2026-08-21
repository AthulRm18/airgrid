import { useMemo, useState, useEffect, useRef } from "react";
import { MapContainer, TileLayer, Polygon, Circle, Tooltip as LTooltip, useMap, useMapEvents } from "react-leaflet";
import { cellToBoundary } from "h3-js";
import { SEVERITY } from "../lib/severity";
import "leaflet/dist/leaflet.css";

const MAP_CENTER = [28.63, 77.22];
const MAP_ZOOM = 11;
const BRICS_COLORS = { CN: "#e0524a", BR: "#4fb8ac", RU: "#e8a23d", ZA: "#a870e8", IN: "#1a73e8" };

const CITIES = [
  { id: "all", label: "🇮🇳 All India", center: [21.5, 78.9], zoom: 5 },
  { id: "delhi", label: "Delhi-NCR", center: [28.63, 77.22], zoom: 11 },
  { id: "kerala", label: "Kerala / Kochi", center: [10.05, 76.32], zoom: 12 },
  { id: "mumbai", label: "Mumbai", center: [19.06, 72.88], zoom: 11 },
  { id: "bengaluru", label: "Bengaluru", center: [12.97, 77.59], zoom: 11 },
  { id: "kolkata", label: "Kolkata", center: [22.57, 88.36], zoom: 11 },
];

function h3Boundary(cell) {
  try {
    return cellToBoundary(cell).map(([lat, lng]) => [lat, lng]);
  } catch {
    return null;
  }
}

function isRecent(iso) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < 5 * 60 * 1000;
}

function groupReportsByCell(reports) {
  const byCell = new Map();
  for (const r of reports) {
    if (!r.h3_cell || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
    const prev = byCell.get(r.h3_cell);
    if (!prev || (r.submitted_at || "") > (prev.submitted_at || "")) {
      byCell.set(r.h3_cell, r);
    }
  }
  return [...byCell.values()];
}

/** Track zoom so we only show station dots when zoomed in enough */
function ZoomWatcher({ onZoom }) {
  const map = useMap();
  useEffect(() => { onZoom(map.getZoom()); }, [map, onZoom]);
  useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  return null;
}

/** Handles smooth camera transitions ONLY when user explicitly changes city or selects a new cell */
function MapController({ targetView, selectedCell, hotspots }) {
  const map = useMap();
  const prevCellRef = useRef(null);
  const prevTargetRef = useRef(null);

  useEffect(() => {
    if (targetView && targetView !== prevTargetRef.current) {
      prevTargetRef.current = targetView;
      map.flyTo(targetView.center, targetView.zoom, { duration: 1.0 });
    }
  }, [targetView, map]);

  useEffect(() => {
    if (selectedCell && selectedCell !== prevCellRef.current) {
      prevCellRef.current = selectedCell;
      const match = hotspots.find((h) => h.h3_cell === selectedCell);
      if (match && Number.isFinite(match.lat) && Number.isFinite(match.lng)) {
        map.flyTo([match.lat, match.lng], 13, { duration: 0.9 });
      }
    }
  }, [selectedCell, hotspots, map]);

  return null;
}

export default function HotspotMap({
  hotspots,
  selectedCell,
  onSelectCell,
  onOpenEvidence,
  refreshToken,
  flashCells = [],
  bricsEvents = [],
  activeRegion = "all",
  onRegionChange,
}) {
  const [propagation, setPropagation] = useState(null);
  const [sensors, setSensors] = useState([]);
  const [reports, setReports] = useState([]);
  const [zoom, setZoom] = useState(MAP_ZOOM);
  const [targetView, setTargetView] = useState(null);

  // Sync targetView when activeRegion changes from parent
  useEffect(() => {
    const found = CITIES.find((c) => c.id === activeRegion);
    if (found) {
      setTargetView({ center: found.center, zoom: found.zoom });
    }
  }, [activeRegion]);

  useEffect(() => {
    fetch("/api/sensors")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setSensors(d?.readings ?? []))
      .catch(() => setSensors([]));
  }, [refreshToken]);

  useEffect(() => {
    fetch("/api/citizen-reports")
      .then((r) => r.ok ? r.json() : { reports: [] })
      .then((d) => setReports(d.reports ?? []))
      .catch(() => setReports([]));
  }, [refreshToken]);

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
    if (!propagation?.corridor || zoom < 11) return [];
    return propagation.corridor.flatMap((c) => {
      const positions = h3Boundary(c.h3_cell);
      if (!positions) return [];
      return [{ ...c, positions }];
    });
  }, [propagation, zoom]);

  // Pending report pins only before a hex exists — geographic Circle (meters), not pixel blobs
  const pendingPins = useMemo(() => {
    const hexCells = new Set(hotspots.map((h) => h.h3_cell));
    return groupReportsByCell(reports).filter(
      (r) => isRecent(r.submitted_at) && !hexCells.has(r.h3_cell)
    );
  }, [reports, hotspots]);

  const showStations = zoom >= 10;

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-[#dde3ea] bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-medium text-[#314154]">National environmental grid</span>
          {bricsEvents.length > 0 && (
            <div className="flex items-center gap-1">
              {bricsEvents.map((ev) => (
                <span
                  key={ev.dedupe_key || ev.origin_country}
                  className="rounded-full px-1.5 py-0.5 text-[9px] font-medium text-white"
                  style={{ background: BRICS_COLORS[ev.origin_country] || "#a870e8" }}
                  title={`${ev.origin_country}: ${ev.evidence_summary}`}
                >
                  {ev.origin_country}
                </span>
              ))}
              <span className="text-[9px] text-[#7b8fa1]">· BRICS feed</span>
            </div>
          )}
        </div>
        <Legend />
      </div>

      {/* City quick navigator pill bar */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[#dde3ea] bg-[#f9fafb] px-3 py-1.5">
        <span className="shrink-0 text-[10px] font-medium text-[#7b8fa1] mr-1">Region:</span>
        {CITIES.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setTargetView({ center: c.center, zoom: c.zoom });
              onRegionChange?.(c.id);
            }}
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
              activeRegion === c.id
                ? "bg-[#1a73e8] text-white"
                : "border border-[#dde3ea] bg-white text-[#314154] hover:border-[#1a73e8] hover:text-[#1a73e8]"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="flex-1">
        <MapContainer
          center={MAP_CENTER}
          zoom={MAP_ZOOM}
          className="h-full w-full"
          zoomControl
          attributionControl
          scrollWheelZoom
          preferCanvas
        >
          <MapController targetView={targetView} selectedCell={selectedCell} hotspots={hotspots} />
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="© OSM"
          />
          <ZoomWatcher onZoom={setZoom} />
          <InitialFit hotspots={hotspots} />

          {corridorPolygons.map((c) => {
            const intensity = c.predicted_intensity || 0.3;
            const color = intensity > 0.5 ? "#e87d3a" : intensity > 0.25 ? "#e8a23d" : "#e8c93d";
            return (
              <Polygon
                key={`prop-${c.h3_cell}`}
                positions={c.positions}
                pathOptions={{ fillColor: color, fillOpacity: 0.18, color, weight: 1, opacity: 0.45 }}
              />
            );
          })}

          {hexPolygons.map((h) => {
            const isSelected = selectedCell === h.h3_cell;
            const isFlashing = flashCells.includes(h.h3_cell);
            const sev = SEVERITY[h.severity] ?? SEVERITY.unverified;
            const isHidden = h.severity === "hidden";

            return (
              <Polygon
                key={h.h3_cell}
                positions={h.positions}
                pathOptions={{
                  fillColor: sev.rawColor,
                  fillOpacity: isSelected ? 0.65 : isFlashing ? 0.55 : isHidden ? 0.42 : 0.32,
                  color: isFlashing ? "#16202c" : isSelected ? "#1a73e8" : sev.rawColor,
                  weight: isSelected ? 3 : isFlashing ? 2.5 : 1.5,
                  opacity: 0.95,
                }}
                eventHandlers={{
                  click: () => onSelectCell(h.h3_cell),
                  dblclick: () => onOpenEvidence?.(h.h3_cell),
                }}
              >
                <LTooltip sticky>
                  <div style={{ fontSize: 12, maxWidth: 240 }}>
                    <strong style={{ color: sev.rawColor }}>{sev.label}</strong>
                    {isHidden && (
                      <div style={{ marginTop: 4, fontSize: 11, color: "#6b21a8", fontWeight: 600 }}>
                        Blind spot — no ground sensors here
                      </div>
                    )}
                    {h.confidence_score != null && (
                      <div style={{ fontSize: 11, marginTop: 2 }}>
                        Confidence {(h.confidence_score * 100).toFixed(0)}%
                      </div>
                    )}
                    {h.citizen_report_count > 0 && (
                      <div style={{ fontSize: 11 }}>{h.citizen_report_count} citizen report(s)</div>
                    )}
                    <div style={{ fontSize: 10, color: "#1a73e8", marginTop: 4 }}>
                      Click zone · Double-click evidence
                    </div>
                  </div>
                </LTooltip>
              </Polygon>
            );
          })}

          {/* New reports: fixed geographic radius so they don't balloon when zooming out */}
          {pendingPins.map((r) => (
            <Circle
              key={r.id || `pending-${r.h3_cell}`}
              center={[r.lat, r.lng]}
              radius={280}
              pathOptions={{
                fillColor: "#1a73e8",
                fillOpacity: 0.45,
                color: "#1a73e8",
                weight: 2,
              }}
            >
              <LTooltip>
                <div style={{ fontSize: 11 }}>
                  <strong>New report</strong><br />
                  {(r.text || r.location_hint || "Citizen report").slice(0, 80)}
                </div>
              </LTooltip>
            </Circle>
          ))}

          {/* OpenAQ stations: only when zoomed in; meter-based so they stay put */}
          {showStations && sensors.map((s) => {
            if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) return null;
            return (
              <Circle
                key={`sensor-${s.station_name}-${s.lat}-${s.lng}`}
                center={[s.lat, s.lng]}
                radius={180}
                pathOptions={{
                  fillColor: "#0d9488",
                  fillOpacity: 0.85,
                  color: "#fff",
                  weight: 2,
                }}
              >
                <LTooltip>
                  <div style={{ fontSize: 11 }}>
                    <strong>{s.station_name}</strong><br />
                    PM2.5: {s.pm25} µg/m³<br />
                    <span style={{ color: "#666" }}>
                      {s.source === "openaq" ? "OpenAQ live" : "Demo station"}
                    </span>
                  </div>
                </LTooltip>
              </Circle>
            );
          })}
        </MapContainer>
      </div>

      {!showStations && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-white/90 px-2 py-1 text-[10px] text-[#5f6f86] shadow-sm">
          Zoom in to see OpenAQ stations
        </div>
      )}
    </div>
  );
}

function InitialFit({ hotspots }) {
  const map = useMap();
  const fittedRef = useRef(false);

  useEffect(() => {
    if (fittedRef.current || !hotspots?.length) return;
    const lats = hotspots.map((h) => h.lat).filter(Number.isFinite);
    const lngs = hotspots.map((h) => h.lng).filter(Number.isFinite);
    if (!lats.length) return;
    fittedRef.current = true;
    try {
      map.fitBounds(
        [
          [Math.min(...lats) - 0.03, Math.min(...lngs) - 0.03],
          [Math.max(...lats) + 0.03, Math.max(...lngs) + 0.03],
        ],
        { padding: [28, 28], maxZoom: 12, animate: false },
      );
    } catch { /* ignore */ }
  }, [hotspots, map]);

  return null;
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2.5 text-[10px] text-[#7b8fa1]">
      {Object.entries(SEVERITY).map(([key, s]) => (
        <span key={key} className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.rawColor }} />
          {s.label}
        </span>
      ))}
      <span className="flex items-center gap-1 border-l border-[#dde3ea] pl-2">
        <span className="inline-block h-2 w-2 rounded-full bg-[#0d9488]" />
        OpenAQ
      </span>
    </div>
  );
}
