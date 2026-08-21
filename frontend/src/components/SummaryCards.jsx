import { useEffect, useState } from "react";
import { Activity, Eye, Bell, Users, AlertTriangle } from "lucide-react";

const CARDS = [
  { key: "active_hotspots", label: "Incidents", icon: Activity, color: "var(--color-sev-confirmed)" },
  { key: "hidden_hotspots", label: "Blind spots", icon: Eye, color: "var(--color-sev-hidden)" },
  { key: "high_confidence_cells", label: "High conf.", icon: AlertTriangle, color: "var(--color-sev-corroborated)" },
  { key: "population_at_risk", label: "At risk", icon: Users, color: "var(--color-prop-near)", fmt: (v) => v != null ? (v > 999 ? `${Math.round(v / 1000)}k` : v) : "—" },
  { key: "citizen_reports", label: "Reports", icon: Bell, color: "var(--color-clear-500)" },
];

export default function SummaryCards({ backendOk, refreshToken, inline }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/summary")
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d) setData(d); })
        .catch(() => {});
    load();
    const id = setInterval(load, 6000);
    return () => clearInterval(id);
  }, [refreshToken]);

  // ── Inline header mode: compact pill strip ──
  if (inline) {
    if (!data) {
      return (
        <div className="flex items-center gap-3">
          {CARDS.map((c) => (
            <div key={c.key} className="h-4 w-16 animate-pulse rounded bg-[#dde3ea]" />
          ))}
        </div>
      );
    }
    return (
      <div className="flex items-center gap-3">
        {CARDS.map((c) => {
          const raw = data[c.key];
          const display = c.fmt ? c.fmt(raw) : raw;
          return (
            <div key={c.key} className="flex items-center gap-1.5">
              <c.icon size={12} style={{ color: c.color }} />
              <span className="font-[family-name:var(--font-display)] text-sm font-semibold" style={{ color: c.color }}>
                {display}
              </span>
              <span className="text-[11px] text-[#7b8fa1]">{c.label}</span>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Standalone card grid (not used in new layout but kept for fallback) ──
  if (!data || backendOk === false) {
    return (
      <div className="grid grid-cols-5 gap-2">
        {CARDS.map((c) => (
          <div key={c.key} className="rounded-xl border border-[#dde3ea] bg-white px-3 py-3 animate-pulse">
            <div className="h-3 w-12 rounded bg-[#dde3ea] mb-2" />
            <div className="h-6 w-8 rounded bg-[#dde3ea]" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-5 gap-2">
      {CARDS.map((c) => {
        const raw = data[c.key];
        const display = c.fmt ? c.fmt(raw) : raw;
        return (
          <div key={c.key} className="rounded-xl border border-[#dde3ea] bg-white px-3 py-3">
            <div className="flex items-center gap-1.5 mb-1">
              <c.icon size={12} style={{ color: c.color }} />
              <span className="text-[11px] text-[#7b8fa1]">{c.label}</span>
            </div>
            <p
              className="font-[family-name:var(--font-display)] text-2xl font-semibold"
              style={{ color: c.color }}
            >
              {display}
            </p>
          </div>
        );
      })}
    </div>
  );
}
