import { useEffect, useState } from "react";
import { Globe2, ArrowDownLeft, Loader2, X, Share2, ShieldCheck, Database } from "lucide-react";
import { SEVERITY } from "../lib/severity";

const COUNTRY_NAMES = {
  CN: { name: "China (Beijing)", flag: "🇨🇳", color: "#e0524a" },
  BR: { name: "Brazil (São Paulo)", flag: "🇧🇷", color: "#16a34a" },
  RU: { name: "Russia (Moscow)", flag: "🇷🇺", color: "#2563eb" },
  ZA: { name: "South Africa (Johannesburg)", flag: "🇿🇦", color: "#d97706" },
  IN: { name: "India (National Node)", flag: "🇮🇳", color: "#ea580c" },
};

export default function BricsPanel({ refreshToken, onClose }) {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("events"); // 'events' | 'protocol'

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
    <div className="fixed inset-y-0 right-0 z-[4000] flex w-full max-w-md flex-col bg-white shadow-2xl border-l border-[#dde3ea] animate-slide-in">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#dde3ea] px-5 py-4 bg-[#f8fafc]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(168,112,232,0.12)] text-[#a870e8]">
            <Globe2 size={18} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-[#16202c]">BRICS Climate Federation</h2>
            <p className="text-[11px] text-[#64748b]">
              Protocol: <span className="font-mono font-semibold text-[#1a73e8]">brics.v1</span> · Node: <strong className="text-[#16202c]">{status?.local_country || "IN"}</strong>
            </p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#64748b] hover:bg-[#e2e8f0] hover:text-[#16202c] transition"
            title="Close panel"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Mode Tabs */}
      <div className="flex border-b border-[#dde3ea] bg-white px-5 pt-2">
        <button
          onClick={() => setTab("events")}
          className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition ${
            tab === "events"
              ? "border-[#1a73e8] text-[#1a73e8]"
              : "border-transparent text-[#64748b] hover:text-[#16202c]"
          }`}
        >
          Incoming Signals ({events.length})
        </button>
        <button
          onClick={() => setTab("protocol")}
          className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition ${
            tab === "protocol"
              ? "border-[#1a73e8] text-[#1a73e8]"
              : "border-transparent text-[#64748b] hover:text-[#16202c]"
          }`}
        >
          Federated Schema Info
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5">
        {tab === "events" ? (
          loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-[#64748b]">
              <Loader2 size={16} className="animate-spin text-[#1a73e8]" /> Loading federated stream…
            </div>
          ) : events.length === 0 ? (
            <div className="rounded-xl border border-[#dde3ea] bg-[#f8fafc] p-6 text-center text-xs text-[#64748b]">
              No federated events in stream. Click <strong>Seed demo</strong> to ingest transboundary signals.
            </div>
          ) : (
            <div className="space-y-3.5">
              {events.map((ev) => {
                const cInfo = COUNTRY_NAMES[ev.origin_country] || { name: ev.origin_country, flag: "🌐", color: "#a870e8" };
                const sev = SEVERITY[ev.severity] ?? SEVERITY.unverified;
                const conf = Math.round((ev.confidence_score || 0) * 100);

                return (
                  <div
                    key={ev.dedupe_key || `${ev.origin_country}-${ev.h3_cell}`}
                    className="rounded-xl border border-[#dde3ea] bg-white p-4 shadow-sm hover:border-[#1a73e8] transition"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{cInfo.flag}</span>
                        <span className="text-xs font-bold text-[#16202c]">{cInfo.name}</span>
                      </div>
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{ color: sev.rawColor, backgroundColor: `${sev.rawColor}18` }}
                      >
                        {sev.label}
                      </span>
                    </div>

                    <p className="mt-2 text-xs text-[#334155] leading-relaxed">
                      {ev.evidence_summary || "Correlated aerosol anomaly detected across transboundary economic corridor."}
                    </p>

                    <div className="mt-3 flex items-center justify-between border-t border-[#f1f5f9] pt-2.5 text-[10px] text-[#64748b]">
                      <span className="font-semibold text-[#16202c]">{conf}% Confidence</span>
                      <span className="font-mono bg-[#f1f5f9] px-1.5 py-0.5 rounded text-[#475569]">{ev.h3_cell?.slice(0, 12)}…</span>
                      <span className="text-[#1a73e8] font-medium">{ev.source_system || "AirGrid"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <div className="space-y-4 text-xs text-[#334155] leading-relaxed">
            <div className="rounded-xl border border-[#dde3ea] bg-[#f8fafc] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#16202c] mb-1.5">
                <ShieldCheck size={16} className="text-[#16a34a]" />
                Privacy-Preserving Interoperability
              </div>
              <p className="text-[#64748b]">
                Under the <strong>brics.v1</strong> standard, nodes only exchange spatial H3 hexagon hashes, satellite optical anomaly scores, and model weights. Zero citizen personally identifiable information (PII) crosses borders.
              </p>
            </div>

            <div className="rounded-xl border border-[#dde3ea] p-4 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-[#16202c]">
                <Database size={14} className="text-[#1a73e8]" />
                Live Endpoints
              </div>
              <ul className="list-disc pl-4 space-y-1 font-mono text-[11px] text-[#475569]">
                <li>GET /api/brics/hotspots/federated</li>
                <li>POST /api/brics/models/share</li>
                <li>POST /api/brics/resources/request</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-[#dde3ea] bg-[#f8fafc] px-5 py-3 text-center text-[11px] text-[#64748b]">
        Cross-border compliance with <strong>BRICS Climate Accord v1</strong>
      </div>
    </div>
  );
}
