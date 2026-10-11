import { useState } from "react";
import {
  X, MapPin, Radio, Satellite, Users, ShieldCheck, BookOpen,
  AlertTriangle, Eye, CheckCircle2, CircleDot, ChevronDown, ChevronUp,
  Mic, Camera, FileText, Wind, TrendingUp, Bell,
} from "lucide-react";

/* ── Design tokens matching the app theme ── */
const CLR = {
  confirmed:    "#e0524a",
  corroborated: "#e8a23d",
  hidden:       "#a870e8",
  unverified:   "#7b8fa1",
  openaq:       "#34a853",
  citizen:      "#4fb8ac",
  verifier:     "#e8a23d",
  authority:    "#e0524a",
  brics:        "#a870e8",
  blue:         "#1a73e8",
};

const SEVERITIES = [
  {
    dot: CLR.confirmed,
    label: "Confirmed",
    badge: "RED",
    icon: <CheckCircle2 size={14} color={CLR.confirmed} />,
    meaning: "A ground sensor (CPCB / OpenAQ) measured PM2.5 above the India NAAQS threshold (60 µg/m³). This is hard evidence — official monitoring agrees with community reports.",
    example: "Howrah Industrial, Kolkata — sensor at 160 µg/m³ with 2 matching citizen reports.",
  },
  {
    dot: CLR.corroborated,
    label: "Corroborated",
    badge: "ORANGE",
    icon: <CircleDot size={14} color={CLR.corroborated} />,
    meaning: "Citizen reports and sensor data are elevated, but below the confirmed threshold. Two independent signals agree — the event is real but lower intensity.",
    example: "Chembur Industrial, Mumbai — sensor at 9 µg/m³ above baseline, 2 citizen reports.",
  },
  {
    dot: CLR.hidden,
    label: "Hidden Hotspot",
    badge: "PURPLE",
    icon: <Eye size={14} color={CLR.hidden} />,
    meaning: "AirGrid's core differentiator. Strong citizen reports + satellite aerosol anomaly, but ZERO official ground sensors in range. This pollution event is completely invisible to the official monitoring network.",
    example: "Eloor Chemical Belt, Kerala — 2 citizen reports, satellite aerosol signal detected, nearest CPCB station is 12 km away.",
  },
  {
    dot: CLR.unverified,
    label: "Unverified",
    badge: "GREY",
    icon: <AlertTriangle size={14} color={CLR.unverified} />,
    meaning: "A single citizen report with no corroborating satellite or sensor data yet. Flagged for monitoring — one more report or a satellite pass will upgrade its status.",
    example: "A single voice report in Hindi about burning smell, no sensor coverage nearby.",
  },
  {
    dot: CLR.openaq,
    label: "OpenAQ",
    badge: "GREEN",
    icon: <Radio size={14} color={CLR.openaq} />,
    meaning: "A live official ground monitoring station from the OpenAQ / CPCB network. This is what the existing infrastructure covers — notice how sparse they are outside major metros.",
    example: "CPCB station at Anand Vihar, Delhi showing live PM2.5 readings.",
  },
];

const ROLES = [
  {
    color: CLR.citizen,
    label: "Citizen",
    icon: <Users size={14} />,
    what: "Report what you see — smoke, haze, burning smell. Use text, voice (in your regional language), or a photo.",
    how: [
      "Type a description in the Report Incident box, or tap the mic for voice",
      "Select your language (Hindi, Bengali, Kannada, Marathi, Malayalam, English)",
      "GPS pins your location automatically — or pick a landmark",
      "Attach a photo for Gemini visual analysis",
      "Hit Submit — your report appears on the map within seconds",
    ],
  },
  {
    color: CLR.verifier,
    label: "Verifier",
    icon: <ShieldCheck size={14} />,
    what: "City-level verifier who reviews the action queue, checks the evidence panel, and dispatches field teams.",
    how: [
      "Login as Verifier (top-right corner)",
      "Open the Action Queue (right panel) — sorted by confidence score",
      "Click a hotspot to open the Evidence Panel — see satellite data, citizen photos, forecast",
      "Review the Gemini AI analysis explaining why this is flagged",
      "Enter your action note and click Acknowledge",
    ],
  },
  {
    color: CLR.authority,
    label: "Authority",
    icon: <Bell size={14} />,
    what: "District authority who issues public health advisories for acknowledged hotspots.",
    how: [
      "Login as Authority (top-right corner)",
      "Acknowledged hotspots appear in your queue with 'Issue alert' option",
      "Gemini drafts a regional-language advisory automatically",
      "Review, edit if needed, and Issue public alert",
      "Alert is logged with timestamp and your credentials — full audit trail",
    ],
  },
  {
    color: CLR.brics,
    label: "BRICS Feed",
    icon: <Satellite size={14} />,
    what: "Cross-border pollution events from partner nodes (China, Brazil, Russia, South Africa).",
    how: [
      "Login as BRICS Coordinator",
      "The BRICS panel on the right shows federated events from partner countries",
      "A correlated signal from China adds confidence to the Indian hotspot prediction",
      "Demonstrates trans-boundary pollution intelligence sharing at scale",
    ],
  },
];

const FLOW_STEPS = [
  { icon: <FileText size={13} />, color: CLR.citizen,    label: "Citizen reports",    desc: "Voice / photo / text in 6 Indian languages → Gemini extracts pollution type, severity, location" },
  { icon: <Satellite size={13} />, color: CLR.blue,      label: "Satellite fusion",   desc: "Sentinel-5P aerosol index from Google Earth Engine overlaid on the same H3 grid" },
  { icon: <Radio size={13} />,     color: CLR.openaq,    label: "Ground sensors",     desc: "Live PM2.5 from OpenAQ / CPCB — sparse but precise where they exist" },
  { icon: <MapPin size={13} />,    color: CLR.hidden,    label: "Evidence fusion",    desc: "6-factor weighted confidence score (satellite 32% · citizen 24% · history 16% · sensor 12% · weather 10% · coverage 6%)" },
  { icon: <Wind size={13} />,      color: CLR.blue,      label: "Plume forecast",     desc: "Wind-aware 12h PM2.5 trajectory — predicts downwind schools, clinics, and colonies at risk" },
  { icon: <TrendingUp size={13} />, color: CLR.verified, label: "Action queue",       desc: "Ranked hotspots sent to verifiers and authorities → acknowledge → issue advisory" },
];

/* ── Collapsible section ── */
function Section({ title, icon, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[#dde3ea] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#f9fafb] hover:bg-[#f1f4f8] transition-colors"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-[#1a1f2e]">
          <span className="text-[#1a73e8]">{icon}</span>
          {title}
        </div>
        {open ? <ChevronUp size={14} className="text-[#7b8fa1]" /> : <ChevronDown size={14} className="text-[#7b8fa1]" />}
      </button>
      {open && <div className="px-4 py-3 bg-white space-y-3">{children}</div>}
    </div>
  );
}

/* ── Severity dot ── */
function Dot({ color }) {
  return <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0 mt-0.5" style={{ background: color }} />;
}

export default function DemoTour({ onClose }) {
  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-3"
      style={{ background: "rgba(15,20,35,0.65)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl max-h-[90vh] rounded-2xl border border-[#dde3ea] bg-white shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#dde3ea] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(26,115,232,0.1)" }}>
              <BookOpen size={14} color="#1a73e8" />
            </div>
            <div>
              <p className="text-xs font-medium text-[#7b8fa1] uppercase tracking-widest leading-none mb-0.5">How to use</p>
              <h2 className="text-sm font-bold text-[#1a1f2e]">AirGrid — User Manual</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-[#7b8fa1] hover:text-[#1a1f2e] hover:bg-[#f1f4f8] transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-4 py-4 space-y-3">

          {/* What AirGrid does — always visible */}
          <div className="rounded-xl p-4" style={{ background: "linear-gradient(135deg, rgba(26,115,232,0.06) 0%, rgba(168,112,232,0.06) 100%)", border: "1px solid rgba(26,115,232,0.15)" }}>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#1a73e8] mb-1">What AirGrid does</p>
            <p className="text-sm leading-relaxed text-[#314154]">
              India has fewer than 500 air quality stations for 1.4 billion people. AirGrid fuses{" "}
              <strong>citizen reports</strong>, <strong>satellite imagery</strong>, and{" "}
              <strong>ground sensors</strong> to detect pollution hotspots that are completely invisible
              to official monitoring — especially in industrial corridors with no sensors nearby.
            </p>
          </div>

          {/* How the loop works */}
          <Section title="How it works — the detection loop" icon={<TrendingUp size={14} />} defaultOpen={true}>
            <div className="space-y-2">
              {FLOW_STEPS.map((s, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-lg shrink-0 flex items-center justify-center mt-0.5"
                    style={{ background: `${s.color}18`, color: s.color }}>
                    {s.icon}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#1a1f2e]">
                      <span className="text-[#7b8fa1] mr-1">{i + 1}.</span>{s.label}
                    </p>
                    <p className="text-[11px] text-[#5f6f86] leading-relaxed">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Hotspot types */}
          <Section title="What the colours on the map mean" icon={<MapPin size={14} />} defaultOpen={true}>
            <div className="space-y-3">
              {SEVERITIES.map((s) => (
                <div key={s.label} className="flex items-start gap-3">
                  <Dot color={s.dot} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      {s.icon}
                      <span className="text-xs font-bold text-[#1a1f2e]">{s.label}</span>
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                        style={{ background: `${s.dot}18`, color: s.dot }}>
                        {s.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#5f6f86] leading-relaxed">{s.meaning}</p>
                    <p className="text-[10px] text-[#7b8fa1] mt-0.5 italic">e.g. {s.example}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Roles */}
          <Section title="Roles — who does what" icon={<Users size={14} />}>
            <div className="space-y-4">
              {ROLES.map((r) => (
                <div key={r.label}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                      style={{ background: `${r.color}18`, color: r.color }}>
                      {r.icon}
                    </div>
                    <span className="text-xs font-bold text-[#1a1f2e]">{r.label}</span>
                  </div>
                  <p className="text-[11px] text-[#5f6f86] mb-1.5 leading-relaxed">{r.what}</p>
                  <ul className="space-y-0.5">
                    {r.how.map((h, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11px] text-[#314154]">
                        <span className="text-[#7b8fa1] shrink-0 mt-0.5">→</span>
                        {h}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Section>

          {/* Reporting */}
          <Section title="How to submit a report" icon={<Mic size={14} />}>
            <div className="space-y-2">
              {[
                { icon: <FileText size={12} />, label: "Text", desc: "Type what you see in the Report Incident box. Gemini translates and extracts pollution details automatically." },
                { icon: <Mic size={12} />, label: "Voice", desc: "Click the mic icon and speak in Hindi, Bengali, Kannada, Marathi, Malayalam, or English. Gemini transcribes and classifies." },
                { icon: <Camera size={12} />, label: "Photo", desc: "Attach a photo of the smoke or haze. Gemini performs visual analysis — smoke density, plume source, visibility score." },
              ].map((m) => (
                <div key={m.label} className="flex items-start gap-2.5 rounded-lg p-2.5" style={{ background: "#f9fafb", border: "1px solid #eef1f5" }}>
                  <div className="w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5" style={{ background: "rgba(26,115,232,0.1)", color: "#1a73e8" }}>
                    {m.icon}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#1a1f2e]">{m.label}</p>
                    <p className="text-[11px] text-[#5f6f86] leading-relaxed">{m.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Evidence panel tip */}
          <Section title="Reading the Evidence Panel" icon={<Eye size={14} />}>
            <div className="space-y-2 text-[11px] text-[#5f6f86] leading-relaxed">
              <p>Click any hotspot hexagon on the map to open the Evidence Panel. It shows:</p>
              <ul className="space-y-1.5">
                {[
                  ["Confidence score", "0–100% weighted score combining all data sources. Above 60% = strong evidence."],
                  ["Evidence checklist", "Which signals fired — satellite ✓, citizen reports ✓, historical baseline ✓, sensor ✓."],
                  ["12-hour forecast", "Predicted PM2.5 trajectory. Dashed red line = India health threshold (60 µg/m³)."],
                  ["Plume corridor", "Downwind propagation — which communities, schools, hospitals are in the smoke path."],
                  ["Gemini AI analysis", "Natural-language explanation grounded strictly in the live data — every claim cites a number."],
                  ["Recommendation", "Specific actions for the authority — advisory text, scope, urgency level."],
                ].map(([t, d]) => (
                  <li key={t} className="flex items-start gap-1.5">
                    <span className="text-[#1a73e8] shrink-0 mt-0.5">→</span>
                    <span><strong className="text-[#314154]">{t}:</strong> {d}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Section>

          {/* Quick start */}
          <div className="rounded-xl p-4" style={{ background: "rgba(79,184,172,0.06)", border: "1px solid rgba(79,184,172,0.2)" }}>
            <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: CLR.citizen }}>Quick start</p>
            <ol className="space-y-1">
              {[
                "Click Seed demo (top right) to populate 5 Indian regions with realistic reports",
                "Watch the map — purple Hidden Hotspots appear in sensor-free industrial zones",
                "Click any hotspot → read the Evidence Panel and Gemini AI analysis",
                "Switch to Citizen → submit a voice or photo report → see it appear on the map",
                "Switch to Verifier → open Action Queue → acknowledge a hotspot",
                "Switch to Authority → issue a public health advisory",
              ].map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px] text-[#314154]">
                  <span className="w-4 h-4 rounded-full text-white text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: CLR.citizen }}>{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#dde3ea] shrink-0 flex items-center justify-between">
          <p className="text-[10px] text-[#7b8fa1]">AirGrid · Community Environmental Intelligence</p>
          <button
            onClick={onClose}
            className="rounded-full px-4 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: "#1a73e8" }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
