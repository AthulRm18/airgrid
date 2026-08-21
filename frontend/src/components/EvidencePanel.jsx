/**
 * EvidencePanel — "Why this alert?" side drawer.
 *
 * Strategy: show all non-AI data INSTANTLY from the hotspot data
 * already in memory. Then fetch full evidence (with Gemini) in the
 * background and fill in the AI sections when ready.
 *
 * This eliminates the full-screen spinner the user sees today.
 */
import { useState, useEffect } from "react";
import {
  X, Loader2, CheckCircle2, Shield, TrendingUp, Users,
  Wind, AlertTriangle, Clock, MapPin,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

const EVIDENCE_TIMEOUT = 45000;

export default function EvidencePanel({ h3Cell, hotspot, onClose }) {
  const [full, setFull] = useState(null);       // full Gemini-enriched payload
  const [aiLoading, setAiLoading] = useState(true);
  const [aiError, setAiError] = useState(false);

  // Fetch full evidence asynchronously — show baseline from `hotspot` prop immediately
  useEffect(() => {
    if (!h3Cell) return;
    let cancelled = false;
    setFull(null);
    setAiLoading(true);
    setAiError(false);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EVIDENCE_TIMEOUT);

    fetch(`/api/hotspots/${h3Cell}/evidence`, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((data) => { if (!cancelled) setFull(data); })
      .catch(() => { if (!cancelled) setAiError(true); })
      .finally(() => { clearTimeout(timeout); if (!cancelled) setAiLoading(false); });

    return () => { cancelled = true; clearTimeout(timeout); };
  }, [h3Cell]);

  if (!h3Cell) return null;

  // Use full data if available, otherwise fall back to hotspot prop
  const data = full ?? hotspot;
  const confidence = Math.round((data?.confidence_score ?? 0) * 100);
  const sev = data?.severity ?? "unknown";
  const sevColor = {
    confirmed: "var(--color-sev-confirmed)",
    hidden: "var(--color-sev-hidden)",
    corroborated: "var(--color-sev-corroborated)",
    unverified: "var(--color-mist-400)",
  }[sev] ?? "var(--color-mist-400)";

  return (
    <div className="fixed inset-0 z-[1000] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative flex h-full w-full max-w-[480px] flex-col bg-[var(--color-ink-900)] border-l border-[var(--color-ink-700)] overflow-hidden animate-slide-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-ink-700)] px-5 py-4">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-base font-semibold text-[var(--color-mist-50)]">
              Evidence — {sev.charAt(0).toUpperCase() + sev.slice(1)}
            </h2>
            <p className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mist-400)]">
              {h3Cell}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--color-mist-400)] hover:text-[var(--color-mist-50)] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {/* Confidence + severity — instant from hotspot prop */}
          <div className="flex items-center gap-4 rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-800)] px-4 py-4">
            <div className="relative h-16 w-16 shrink-0">
              <svg viewBox="0 0 60 60" className="h-full w-full -rotate-90">
                <circle cx="30" cy="30" r="26" fill="none" stroke="var(--color-ink-600)" strokeWidth="5" />
                <circle
                  cx="30" cy="30" r="26" fill="none"
                  stroke={sevColor} strokeWidth="5"
                  strokeDasharray={`${2 * Math.PI * 26}`}
                  strokeDashoffset={`${2 * Math.PI * 26 * (1 - confidence / 100)}`}
                  strokeLinecap="round"
                />
              </svg>
              <span
                className="absolute inset-0 flex items-center justify-center font-[family-name:var(--font-display)] text-base font-bold"
                style={{ color: sevColor }}
              >
                {confidence}%
              </span>
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--color-mist-50)]">
                {confidence >= 80 ? "High confidence" : confidence >= 60 ? "Moderate confidence" : "Early signal"}
              </p>
              <p className="mt-0.5 text-xs text-[var(--color-mist-400)]">
                Fused from satellite · sensors · citizen reports · weather
              </p>
              {data?.citizen_report_count > 0 && (
                <p className="mt-1.5 text-xs" style={{ color: sevColor }}>
                  {data.citizen_report_count} citizen report{data.citizen_report_count > 1 ? "s" : ""} in zone
                </p>
              )}
            </div>
          </div>

          {/* Evidence signals checklist — instant */}
          {(data?.evidence_checklist || data?.evidence_breakdown) && (
            <Section title="Evidence signals" icon={Shield}>
              {data.evidence_checklist?.map((item, i) => (
                <div key={i} className="flex items-start gap-2 py-1">
                  {item.active
                    ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-[var(--color-clear-500)]" />
                    : <div className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border border-[var(--color-ink-600)]" />
                  }
                  <span className={`text-sm ${item.active ? "text-[var(--color-mist-200)]" : "text-[var(--color-mist-400)]"}`}>
                    {item.check}
                  </span>
                </div>
              ))}
              {!data?.evidence_checklist && data?.evidence_breakdown && (
                <BreakdownBars breakdown={data.evidence_breakdown} />
              )}
            </Section>
          )}

          {/* Impact — instant from full data */}
          {full?.impact && (
            <Section title="People at risk" icon={Users}>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Population" value={full.impact.population?.toLocaleString()} color="var(--color-prop-near)" />
                <Stat label="Schools" value={full.impact.schools} color="var(--color-sev-corroborated)" />
                <Stat label="Hospitals" value={full.impact.hospitals} color="var(--color-sev-confirmed)" />
              </div>
              {full.impact.priority && (
                <p className="mt-2 text-xs text-[var(--color-mist-400)]">
                  Priority: <span
                    className="font-medium"
                    style={{ color: full.impact.priority === "CRITICAL" ? "var(--color-sev-confirmed)" : "var(--color-sev-corroborated)" }}
                  >{full.impact.priority}</span>
                </p>
              )}
            </Section>
          )}

          {/* Weather — from full data */}
          {full?.weather && (
            <Section title="Weather" icon={Wind}>
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <Stat label="Wind" value={`${full.weather.wind_speed_kmh} km/h`} small />
                <Stat label="Direction" value={`${full.weather.wind_direction_deg}°`} small />
                <Stat label="Temp" value={`${full.weather.temperature_c}°C`} small />
                <Stat label="Humidity" value={`${full.weather.humidity_pct}%`} small />
              </div>
            </Section>
          )}

          {/* Forecast chart — from full data */}
          {full?.forecast?.length > 0 && (
            <Section title="12-hour forecast" icon={TrendingUp}>
              {full.spike_info && (
                <div className="mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs"
                  style={{ background: "rgba(224,82,74,0.1)" }}>
                  <AlertTriangle size={13} className="shrink-0 text-[var(--color-sev-confirmed)]" />
                  <span className="text-[var(--color-mist-200)]">
                    Spike to <strong className="text-[var(--color-sev-confirmed)]">{full.spike_info.predicted_value} µg/m³</strong> predicted in {full.spike_info.hours_until}h
                  </span>
                </div>
              )}
              <ForecastChart forecast={full.forecast} />
            </Section>
          )}

          {/* AI analysis — loads async */}
          <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-800)] px-4 py-4">
            <div className="flex items-center gap-2 mb-3">
              <MapPin size={14} className="text-[var(--color-clear-500)]" />
              <span className="text-sm font-medium text-[var(--color-mist-50)]">Gemini analysis</span>
              {aiLoading && (
                <span className="flex items-center gap-1.5 text-xs text-[var(--color-mist-400)]">
                  <Loader2 size={11} className="animate-spin" /> Generating...
                </span>
              )}
            </div>

            {aiError ? (
              <p className="text-xs text-[var(--color-mist-400)]">
                AI analysis unavailable — check Gemini API key in backend .env
              </p>
            ) : full?.incident_explanation ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--color-mist-50)]">
                  {full.incident_explanation.incident_title}
                </p>
                <p className="text-sm leading-6 text-[var(--color-mist-200)]">
                  {full.incident_explanation.summary}
                </p>
                {full.incident_explanation.evidence_signals?.length > 0 && (
                  <ul className="mt-1 space-y-1">
                    {full.incident_explanation.evidence_signals.map((s, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-[var(--color-mist-400)]">
                        <span className="text-[var(--color-clear-500)]">—</span> {s}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : aiLoading ? (
              <div className="space-y-2">
                <div className="h-3 rounded bg-[var(--color-ink-700)] animate-pulse w-3/4" />
                <div className="h-3 rounded bg-[var(--color-ink-700)] animate-pulse w-full" />
                <div className="h-3 rounded bg-[var(--color-ink-700)] animate-pulse w-5/6" />
              </div>
            ) : null}
          </div>

          {/* Recommendation — from full data */}
          {full?.recommendation && (
            <Section title="Recommended response" icon={Clock}>
              {full.recommendation.urgency && (
                <span
                  className="inline-block mb-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{
                    color: full.recommendation.urgency === "IMMEDIATE" ? "var(--color-sev-confirmed)" : "var(--color-sev-corroborated)",
                    background: full.recommendation.urgency === "IMMEDIATE" ? "rgba(224,82,74,0.12)" : "rgba(232,162,61,0.12)",
                  }}
                >
                  {full.recommendation.urgency}
                </span>
              )}
              {full.recommendation.actions?.map((a, i) => (
                <div key={i} className="py-1.5">
                  <p className="text-sm text-[var(--color-mist-200)]">
                    <span className="font-medium text-[var(--color-clear-500)] mr-1">{i + 1}.</span>
                    {a.action}
                  </p>
                  {a.rationale && (
                    <p className="mt-0.5 ml-4 text-[11px] text-[var(--color-mist-400)]">{a.rationale}</p>
                  )}
                </div>
              ))}
              {full.recommendation.advisory_text && (
                <div className="mt-3 rounded-xl bg-[var(--color-ink-900)] px-3 py-2 text-xs">
                  <p className="text-[var(--color-mist-400)] mb-1">Draft advisory:</p>
                  <p className="text-[var(--color-mist-200)] italic">"{full.recommendation.advisory_text}"</p>
                </div>
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}


function Section({ title, icon: Icon, children }) {
  return (
    <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-800)] px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={14} className="text-[var(--color-clear-500)]" />
        <span className="text-sm font-medium text-[var(--color-mist-50)]">{title}</span>
      </div>
      {children}
    </div>
  );
}


function Stat({ label, value, color, small }) {
  return (
    <div className={`rounded-xl bg-[var(--color-ink-900)] px-2 py-2 text-center ${small ? "" : ""}`}>
      <p
        className={`font-[family-name:var(--font-display)] font-semibold ${small ? "text-sm" : "text-xl"} text-[var(--color-mist-50)]`}
        style={color ? { color } : {}}
      >
        {value ?? "—"}
      </p>
      <p className="text-[10px] text-[var(--color-mist-400)]">{label}</p>
    </div>
  );
}


function BreakdownBars({ breakdown }) {
  const entries = Object.entries(breakdown).sort((a, b) => b[1].contribution - a[1].contribution);
  const max = Math.max(...entries.map(([, v]) => v.contribution), 0.01);
  return (
    <div className="space-y-2">
      {entries.map(([key, val]) => (
        <div key={key}>
          <div className="flex justify-between text-[11px] text-[var(--color-mist-400)] mb-0.5">
            <span>{key.replace(/_/g, " ")}</span>
            <span>+{(val.contribution * 100).toFixed(1)}%</span>
          </div>
          <div className="h-1 rounded-full bg-[var(--color-ink-600)]">
            <div
              className="h-full rounded-full bg-[var(--color-clear-500)] transition-all duration-500"
              style={{ width: `${(val.contribution / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}


function ForecastChart({ forecast }) {
  const chartData = forecast.map((p) => ({
    time: new Date(p.timestamp).toLocaleTimeString([], { hour: "2-digit" }),
    pm25: p.predicted_pm25,
  }));
  return (
    <ResponsiveContainer width="100%" height={100}>
      <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <XAxis dataKey="time" tick={{ fill: "var(--color-mist-400)", fontSize: 10 }}
          axisLine={{ stroke: "var(--color-ink-600)" }} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fill: "var(--color-mist-400)", fontSize: 10 }}
          axisLine={false} tickLine={false} width={32} />
        <Tooltip
          contentStyle={{ background: "var(--color-ink-900)", border: "1px solid var(--color-ink-600)", borderRadius: 8, fontSize: 11 }}
          formatter={(v) => [`${v} µg/m³`, "PM2.5"]}
        />
        <ReferenceLine y={120} stroke="var(--color-sev-confirmed)" strokeDasharray="4 3" strokeWidth={1} />
        <Line type="monotone" dataKey="pm25" stroke="var(--color-clear-500)" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
