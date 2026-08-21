import { useMemo, useState, useEffect, useRef } from "react";
import { MapContainer, TileLayer, Polygon, CircleMarker, Tooltip as LTooltip, useMap } from "react-leaflet";
import { cellToBoundary } from "h3-js";
import { SEVERITY } from "../lib/severity";
import "leaflet/dist/leaflet.css";

const MAP_CENTER = [28.63, 77.22];
const MAP_ZOOM = 11;
const BRICS_COLORS = { CN: "#e0524a", BR: "#4fb8ac", RU: "#e8a23d", ZA: "#a870e8", IN: "#1a73e8" };

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

/** One pin per H3 cell — avoids stacked blobs */
function groupReportsByCell(reports) {
  const byCell = new Map();
  for (const r of reports) {
    if (!r.h3_cell || !r.lat || !r.lng) continue;
    const prev = byCell.get(r.h3_cell);
    if (!prev || (r.submitted_at || "") > (prev.submitted_at || "")) {
      byCell.set(r.h3_cell, r);
    }
  }
  return [...byCell.values()];
}

export default function HotspotMap({
  hotspots,
  selectedCell,
  onSelectCell,
  onOpenEvidence,
  refreshToken,
  flashCells = [],
  bricsEvents = [],
}) {
  const [propagation, setPropagation] = useState(null);
  const [sensors, setSensors] = useState([]);
  const [reports, setReports] = useState([]);

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

  const hotspotByCell = useMemo(() => {
    const m = {};
    hotspots.forEach((h) => { m[h.h3_cell] = h; });
    return m;
  }, [hotspots]);

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

  // Only show pins for recent reports in cells without a visible hotspot hex yet
  const pendingPins = useMemo(() => {
    const hexCells = new Set(hotspots.map((h) => h.h3_cell));
    return groupReportsByCell(reports).filter(
      (r) => isRecent(r.submitted_at) && !hexCells.has(r.h3_cell)
    );
  }, [reports, hotspots]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-[#dde3ea] bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-medium text-[#314154]">Delhi-NCR pollution grid</span>
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
              <span className="text-[9px] text-[#7b8fa1]">· BRICS feed (see panel)</span>
            </div>
          )}
        </div>
        <Legend />
      </div>

      <div className="flex-1">
        <MapContainer
          center={MAP_CENTER}
          zoom={MAP_ZOOM}
          className="h-full w-full"
          zoomControl
          attributionControl
          scrollWheelZoom
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="© OSM"
          />

          {corridorPolygons.map((c) => {
            const intensity = c.predicted_intensity || 0.3;
            const color = intensity > 0.5 ? "#e87d3a" : intensity > 0.25 ? "#e8a23d" : "#e8c93d";
            return (
              <Polygon
                key={`prop-${c.h3_cell}`}
                positions={c.positions}
                pathOptions={{ fillColor: color, fillOpacity: 0.2, color, weight: 1, opacity: 0.5 }}
              />
            );
          })}

          {hexPolygons.map((h) => {
            const isSelected = selectedCell === h.h3_cell;
            const isFlashing = flashCells.includes(h.h3_cell);
            const sev = SEVERITY[h.severity] ?? SEVERITY.unverified;
            const isHidden = h.severity === "hidden";
            const isConfirmed = h.severity === "confirmed";

            return (
              <Polygon
                key={h.h3_cell}
                positions={h.positions}
                pathOptions={{
                  fillColor: sev.rawColor,
                  fillOpacity: isSelected ? 0.65 : isFlashing ? 0.6 : isHidden ? 0.45 : 0.35,
                  color: isFlashing ? "#fff" : isSelected ? "#1a73e8" : sev.rawColor,
                  weight: isSelected ? 3.5 : isFlashing ? 3 : 1.5,
                  opacity: 1,
                  className: isFlashing ? "hex-flash" : isHidden ? "hex-pulse" : "",
                }}
                eventHandlers={{
                  click: () => onSelectCell(h.h3_cell),
                  dblclick: () => onOpenEvidence?.(h.h3_cell),
                }}
              >
                <LTooltip sticky>
                  <div style={{ fontSize: 12, maxWidth: 240, padding: "2px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span style={{
                        display: "inline-block",
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: sev.rawColor
                      }} />
                      <strong>{sev.label}</strong>
                    </div>
                    {isHidden && (
                      <div style={{ background: "#f3ebfc", color: "#6b21a8", padding: "3px 6px", borderRadius: 4, fontSize: 11, marginBottom: 4, fontWeight: 600 }}>
                        ⚠️ Blind Spot: Zero ground sensors!
                      </div>
                    )}
                    {h.confidence_score != null && (
                      <div style={{ fontSize: 11, color: "#314154", marginBottom: 2 }}>
                        Confidence: <strong>{(h.confidence_score * 100).toFixed(0)}%</strong>
                      </div>
                    )}
                    {h.citizen_report_count > 0 && (
                      <div style={{ fontSize: 11, color: "#314154", marginBottom: 2 }}>
                        👥 {h.citizen_report_count} citizen report(s)
                      </div>
                    )}
                    {h.explanation && (
                      <div style={{ fontSize: 11, color: "#5f6f86", borderTop: "1px solid #eef1f5", paddingTop: 4, marginTop: 4 }}>
                        {h.explanation.slice(0, 140)}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: "#1a73e8", marginTop: 4, fontWeight: 500 }}>
                      👉 Click for plume spread · Double-click for evidence
                    </div>
                  </div>
                </LTooltip>
              </Polygon>
            );
          })}

          {/* Pending report — small fixed pin, only before hex appears */}
          {pendingPins.map((r) => (
            <CircleMarker
              key={r.id || `pending-${r.lat}-${r.lng}`}
              center={[r.lat, r.lng]}
              radius={6}
              pathOptions={{
                fillColor: "#1a73e8",
                fillOpacity: 0.9,
                color: "#fff",
                weight: 2,
              }}
            >
              <LTooltip>
                <div style={{ fontSize: 11 }}>
                  <strong>📍 New Citizen Report</strong><br />
                  Cross-referencing satellite & ground telemetry…
                </div>
              </LTooltip>
            </CircleMarker>
          ))}

          {sensors.map((s) => (
            <CircleMarker
              key={`sensor-${s.station_name}-${s.lat}`}
              center={[s.lat, s.lng]}
              radius={5}
              pathOptions={{ fillColor: "#4fb8ac", fillOpacity: 0.9, color: "#fff", weight: 1.5 }}
            >
              <LTooltip>
                <div style={{ fontSize: 11 }}>
                  <strong>📡 {s.station_name}</strong><br />
                  PM2.5: <strong>{s.pm25} µg/m³</strong><br />
                  <span style={{ color: "#888", fontSize: 10 }}>{s.source === "openaq" ? "OpenAQ live station" : "Ground station"}</span>
                </div>
              </LTooltip>
            </CircleMarker>
          ))}

          <InitialFit hotspots={hotspots} />
        </MapContainer>
      </div>
    </div>
  );
}

function InitialFit({ hotspots }) {
  const map = useMap();
  const fittedRef = useRef(false);

  useEffect(() => {
    // Only fit bounds ONCE on first non-empty hotspots load, to avoid interrupting manual zoom/pan
    if (fittedRef.current || !hotspots || hotspots.length === 0) return;
    fittedRef.current = true;
    const lats = hotspots.map((h) => h.lat).filter(Boolean);
    const lngs = hotspots.map((h) => h.lng).filter(Boolean);
    if (lats.length === 0 || lngs.length === 0) return;

    try {
      map.fitBounds([
        [Math.min(...lats) - 0.02, Math.min(...lngs) - 0.02],
        [Math.max(...lats) + 0.02, Math.max(...lngs) + 0.02],
      ], { padding: [24, 24], maxZoom: 12 });
    } catch {
      /* ignore map fit race condition */
    }
  }, [hotspots, map]);

  return null;
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2.5 text-[10px] text-[#7b8fa1]">
      {Object.entries(SEVERITY).map(([key, s]) => (
        <span key={key} className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.rawColor }} />
          <span>{s.label}</span>
        </span>
      ))}
      <span className="flex items-center gap-1 border-l border-[#dde3ea] pl-2">
        <span className="inline-block h-2 w-2 rounded-full bg-[#4fb8ac]" />
        OpenAQ station
      </span>
    </div>
  );
}
