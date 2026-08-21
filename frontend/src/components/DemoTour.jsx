import { useState, useEffect } from "react";
import { ChevronRight, ChevronLeft, CheckCircle2, Loader2, X } from "lucide-react";

const STEPS = [
  {
    id: "citizen",
    role: "Citizen",
    title: "Citizen reports smoke",
    description: "Residents submit text, voice, or photo reports. Reports are geolocated to H3 grid cells on the map.",
    action: "Switch to Citizen role and submit a report, or click Seed demo.",
    dataFn: async () => {
      const r = await fetch("/api/citizen-reports");
      const d = await r.json();
      return { label: "Reports stored", value: d.count };
    },
  },
  {
    id: "hotspot",
    role: "System",
    title: "Evidence fusion detects hotspots",
    description: "VIGIL combines citizen reports, satellite aerosol data, and ground sensors. Blind-spot zones with no official monitoring are flagged in purple.",
    action: "Click any hexagon on the map to inspect evidence.",
    dataFn: async () => {
      const r = await fetch("/api/hotspots");
      const d = await r.json();
      const hidden = d.hotspots.filter((h) => h.severity === "hidden").length;
      const confirmed = d.hotspots.filter((h) => h.severity === "confirmed").length;
      return { label: "Hotspots", value: `${hidden} blind-spot, ${confirmed} confirmed` };
    },
  },
  {
    id: "verifier",
    role: "Verifier",
    title: "Verifier acknowledges",
    description: "City Verifier reviews the action queue, checks forecast and evidence, then acknowledges with a response action.",
    action: "Login as Verifier, expand a queue item, enter action, click Ack.",
    dataFn: async () => {
      const r = await fetch("/api/hotspots/acknowledged");
      const d = await r.json();
      return { label: "Acknowledged", value: `${d.length} hotspot(s)` };
    },
  },
  {
    id: "authority",
    role: "Authority",
    title: "Authority issues alert",
    description: "District authority issues a public advisory for acknowledged hotspots. Alert status persists across page refresh.",
    action: "Login as Authority, expand acknowledged item, click Issue public alert.",
    dataFn: async () => {
      const r = await fetch("/api/alerts/issued");
      const d = await r.json();
      return { label: "Alerts issued", value: `${d.length} alert(s)` };
    },
  },
  {
    id: "brics",
    role: "BRICS",
    title: "Cross-border correlation",
    description: "Partner nodes share federated events. A correlated signal from China adds confidence to the Indian prediction.",
    action: "Login as BRICS Coordinator to see the federation panel on the right.",
    dataFn: async () => {
      const r = await fetch("/api/brics/status");
      const d = await r.json();
      return { label: "Federated events", value: d.federated_events_received };
    },
  },
];

export default function DemoTour({ onClose }) {
  const [step, setStep] = useState(0);
  const [liveData, setLiveData] = useState({});
  const [loading, setLoading] = useState(false);

  const current = STEPS[step];

  async function loadStepData(idx) {
    const s = STEPS[idx];
    if (liveData[s.id]) return;
    setLoading(true);
    try {
      const data = await s.dataFn();
      setLiveData((prev) => ({ ...prev, [s.id]: data }));
    } catch { /* best-effort */ }
    finally { setLoading(false); }
  }

  useEffect(() => { loadStepData(0); }, []);

  function go(idx) {
    if (idx < 0 || idx >= STEPS.length) return;
    setStep(idx);
    loadStepData(idx);
  }

  const stepData = liveData[current.id];
  const roleColor = {
    Citizen: "#4fb8ac", System: "#1a73e8", Verifier: "#e8a23d", Authority: "#e0524a", BRICS: "#a870e8",
  };

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-end justify-center p-4 sm:items-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-[#dde3ea] bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#dde3ea] px-5 py-3">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-widest text-[#7b8fa1]">
              Walkthrough · {step + 1}/{STEPS.length}
            </p>
            <h2 className="text-sm font-semibold text-[#1a1f2e]">{current.title}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-[#7b8fa1] hover:text-[#1a1f2e]">
            <X size={16} />
          </button>
        </div>

        <div className="h-0.5 bg-[#eef1f5]">
          <div className="h-full transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%`, background: roleColor[current.role] }} />
        </div>

        <div className="px-5 py-4 space-y-3">
          <span className="inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
            style={{ background: `${roleColor[current.role]}18`, color: roleColor[current.role] }}>
            {current.role}
          </span>

          <p className="text-sm leading-relaxed text-[#5f6f86]">{current.description}</p>

          <div className="flex items-center gap-2 rounded-lg border border-[#dde3ea] bg-[#f9fafb] px-3 py-2">
            {loading ? (
              <Loader2 size={13} className="animate-spin text-[#7b8fa1]" />
            ) : (
              <CheckCircle2 size={13} style={{ color: roleColor[current.role] }} />
            )}
            <div>
              <p className="text-[9px] uppercase tracking-wider text-[#7b8fa1]">Live data</p>
              <p className="text-xs font-medium text-[#1a1f2e]">
                {stepData ? `${stepData.label}: ${stepData.value}` : "Loading…"}
              </p>
            </div>
          </div>

          <p className="text-xs text-[#5f6f86]">{current.action}</p>
        </div>

        <div className="flex items-center justify-between border-t border-[#dde3ea] px-5 py-3">
          <button onClick={() => go(step - 1)} disabled={step === 0}
            className="flex items-center gap-1 rounded-full border border-[#dde3ea] px-3 py-1.5 text-xs text-[#314154] disabled:opacity-30">
            <ChevronLeft size={13} /> Back
          </button>

          <div className="flex gap-1">
            {STEPS.map((_, i) => (
              <button key={i} onClick={() => go(i)}
                className="h-1.5 rounded-full transition-all"
                style={{ width: i === step ? 16 : 6, background: i === step ? roleColor[current.role] : "#dde3ea" }}
              />
            ))}
          </div>

          {step < STEPS.length - 1 ? (
            <button onClick={() => go(step + 1)}
              className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-white"
              style={{ background: roleColor[current.role] }}>
              Next <ChevronRight size={13} />
            </button>
          ) : (
            <button onClick={onClose}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-white"
              style={{ background: roleColor[current.role] }}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
