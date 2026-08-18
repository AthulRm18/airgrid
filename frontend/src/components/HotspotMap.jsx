import { useMemo, useState } from "react";
import { cellToBoundary } from "h3-js";
import { SEVERITY } from "../lib/severity";
import { makeProjector } from "../lib/projection";

// Delhi-NCR bbox, matches the backend's default mock coverage area.
// Swap this when you point the pipeline at a different city/region.
const DEFAULT_BBOX = [76.8, 28.4, 77.6, 28.9];

const WIDTH = 720;
const HEIGHT = 560;

export default function HotspotMap({ hotspots, selectedCell, onSelectCell }) {
  const [hovered, setHovered] = useState(null);
  const project = useMemo(() => makeProjector(DEFAULT_BBOX, WIDTH, HEIGHT), []);

  const polygons = useMemo(
    () =>
      hotspots.map((h) => {
        const boundary = cellToBoundary(h.h3_cell, false); // [[lat,lng], ...]
        const points = boundary.map((pt) => project(pt).join(",")).join(" ");
        const [cx, cy] = project([h.lat, h.lng]);
        return { ...h, points, cx, cy };
      }),
    [hotspots, project]
  );

  return (
    <div className="relative rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] haze-backdrop overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-5">
        <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--color-mist-50)]">
          Hotspot grid
        </h2>
        <Legend />
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
        role="img"
        aria-label="H3 hexagon grid of detected air quality hotspots"
      >
        {polygons.map((p) => {
          const isSelected = selectedCell === p.h3_cell;
          const isHovered = hovered === p.h3_cell;
          const sev = SEVERITY[p.severity] ?? SEVERITY.unverified;
          return (
            <g key={p.h3_cell}>
              {p.severity === "hidden" && (
                <circle
                  cx={p.cx}
                  cy={p.cy}
                  r={14}
                  fill="none"
                  stroke={sev.color}
                  strokeWidth={2}
                  className="hex-pulse"
                  style={{ transformOrigin: `${p.cx}px ${p.cy}px` }}
                />
              )}
              <polygon
                points={p.points}
                fill={sev.color}
                fillOpacity={isSelected || isHovered ? 0.55 : 0.32}
                stroke={sev.color}
                strokeWidth={isSelected ? 2.5 : 1}
                className="cursor-pointer transition-[fill-opacity] duration-150"
                onMouseEnter={() => setHovered(p.h3_cell)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelectCell(p.h3_cell)}
              />
            </g>
          );
        })}
      </svg>

      {hovered && (
        <HoverCard hotspot={polygons.find((p) => p.h3_cell === hovered)} />
      )}

      {hotspots.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-[var(--color-mist-400)] text-sm">
            No hotspots yet — submit a citizen report or ingest sensor data to populate the grid.
          </p>
        </div>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex gap-3 text-xs text-[var(--color-mist-400)]">
      {Object.entries(SEVERITY).map(([key, s]) => (
        <span key={key} className="flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: s.color }}
          />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function HoverCard({ hotspot }) {
  if (!hotspot) return null;
  const sev = SEVERITY[hotspot.severity] ?? SEVERITY.unverified;
  return (
    <div className="absolute bottom-4 left-4 right-4 rounded-xl border border-[var(--color-ink-600)] bg-[var(--color-ink-800)]/95 backdrop-blur px-4 py-3 pointer-events-none">
      <div className="flex items-center gap-2 mb-1">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ backgroundColor: sev.color }}
        />
        <span className="text-sm font-medium text-[var(--color-mist-50)]">{sev.label}</span>
        <span className="ml-auto font-[family-name:var(--font-mono)] text-xs text-[var(--color-mist-400)]">
          {hotspot.h3_cell}
        </span>
      </div>
      <p className="text-sm text-[var(--color-mist-200)]">{hotspot.explanation}</p>
    </div>
  );
}
