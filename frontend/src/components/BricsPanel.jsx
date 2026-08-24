import { useEffect, useState } from "react";
import { Globe2, ArrowDownLeft, Loader2 } from "lucide-react";
import { SEVERITY } from "../lib/severity";

export default function BricsPanel({ refreshToken }) {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/brics/hotspots/federated").then((r) => r.ok ? r.json() : { events: [] }),
      fetch("/api/brics/status").then((r) => r.ok ? r.json() : null),
    ])
      .then(([fed, st]) => {
        setEvents(fed.events ?? []);
        setStatus(st);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshToken]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className="shrink-0 border-b border-[#dde3ea] px-4 py-3">
        <div className="flex items-center gap-2">
          <Globe2 size={14} className="text-[#1a73e8]" />
          <h2 className="text-sm font-semibold text-[#1a1f2e]">BRICS Federation</h2>
        </div>
        {status && (
          <p className="mt-0.5 text-[11px] text-[#7b8fa1]">
            Node: {status.local_country} · {status.federated_events_received} incoming event{status.federated_events_received !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-[#7b8fa1]">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : events.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-[#7b8fa1]">
            No federated events yet. Click <strong className="text-[#1a1f2e]">Seed demo</strong> to load a cross-border signal from China.
          </div>
        ) : (
          <div className="divide-y divide-[#dde3ea]">
            {events.map((ev) => {
              const sev = SEVERITY[ev.severity] ?? SEVERITY.unverified;
              const conf = Math.round((ev.confidence_score || 0) * 100);
              return (
                <div key={ev.dedupe_key || `${ev.origin_country}-${ev.h3_cell}`} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ArrowDownLeft size={12} className="text-[#a870e8]" />
                    <span className="text-xs font-semibold text-[#1a1f2e]">
                      {ev.origin_country} → IN
                    </span>
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ color: sev.rawColor, backgroundColor: `${sev.rawColor}18` }}
                    >
                      {sev.label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[#5f6f86] leading-relaxed">
                    {ev.evidence_summary || "Correlated aerosol signal detected via transboundary wind corridor."}
                  </p>
                  <div className="mt-1.5 flex items-center gap-3 text-[10px] text-[#7b8fa1]">
                    <span>{conf}% confidence</span>
                    <span className="font-mono">{ev.h3_cell?.slice(0, 12)}…</span>
                    {ev.source_system && <span>{ev.source_system}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
