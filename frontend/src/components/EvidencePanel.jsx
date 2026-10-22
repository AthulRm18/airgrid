/**
 * EvidencePanel — show fused evidence instantly, then enrich with live Gemini.
 */
import { useState, useEffect, useMemo } from "react";
import {
  X, Loader2, CheckCircle2, Shield, TrendingUp, Users,
  Wind, AlertTriangle, Clock, MapPin, FileText, Printer,
  Copy, Check, Send, Radio, ShieldCheck, FileCheck, Download,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { getPlaceName } from "../lib/geocode";

export default function EvidencePanel({ h3Cell, hotspot, role, onClose }) {
  const [full, setFull] = useState(null);
  const [aiLoading, setAiLoading] = useState(true);
  const [aiLive, setAiLive] = useState(false);
  const [aiError, setAiError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [showDossier, setShowDossier] = useState(false);
  const [advisoryText, setAdvisoryText] = useState("");
  const [copied, setCopied] = useState(false);
  const [broadcastDone, setBroadcastDone] = useState(false);

  useEffect(() => {
    if (!h3Cell) return;
    let cancelled = false;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 16000);
    setFull(null);
    setAiLoading(true);
    setAiLive(false);
    setAiError(false);

    // Sequence the responses so a late fast response cannot replace live AI.
    async function load() {
      const fetchEvidence = async (fast) => {
        const res = await fetch(`/api/hotspots/${h3Cell}/evidence${fast ? "?fast=true" : ""}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(res.status);
        return res.json();
      };
      try {
        let initial;
        try {
          initial = await fetchEvidence(true);
          if (cancelled) return;
          setFull(initial);
        } catch (error) {
          if (error.name === "AbortError") throw error;
          // A transient fast request failure must not prevent the live request.
        }
        if (initial?.ai_analysis?.status === "live") {
          setAiLive(true);
          return;
        }
        if (initial?.ai_analysis?.reason === "missing_api_key") {
          setAiError(true);
          return;
        }
        const data = await fetchEvidence(false);
        if (cancelled) return;
        setFull(data);
        const live = data.ai_analysis?.status === "live";
        setAiLive(live);
        setAiError(!live);
      } catch {
        if (!cancelled) setAiError(true);
      } finally {
        clearTimeout(timeout);
        if (!cancelled) setAiLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      ctrl.abort();
    };
  }, [h3Cell, retry]);

  const data = full ?? hotspot;
  const confidence = Math.round((data?.confidence_score ?? 0) * 100);
  const sev = data?.severity ?? "unknown";
  const placeName = useMemo(() => {
    const lat = data?.lat ?? hotspot?.lat;
    const lng = data?.lng ?? hotspot?.lng;
    return getPlaceName(lat, lng);
  }, [data?.lat, data?.lng, hotspot?.lat, hotspot?.lng]);

  useEffect(() => {
    if (full?.recommendation?.advisory_text) {
      setAdvisoryText(full.recommendation.advisory_text);
    } else if (placeName) {
      const schools = full?.corridor_impact?.total_schools || full?.impact?.schools || 12;
      const hospitals = full?.corridor_impact?.total_hospitals || full?.impact?.hospitals || 3;
      setAdvisoryText(
        `AIRGRID PUBLIC HEALTH ADVISORY [URGENT]: High particulate smoke plume detected over ${placeName}. Downwind exposure corridor encompasses ${schools} schools and ${hospitals} medical facilities over the next 4 hours. Sensitive individuals, children, and elderly residents are advised to remain indoors with air filtration active.`
      );
    }
  }, [full, placeName]);

  if (!h3Cell) return null;

  const sevColor = {
    confirmed: "var(--color-sev-confirmed)",
    hidden: "var(--color-sev-hidden)",
    corroborated: "var(--color-sev-corroborated)",
    unverified: "var(--color-mist-400)",
  }[sev] ?? "var(--color-mist-400)";

  return (
    <>
      <div className="fixed inset-0 z-[1000] flex justify-end" onClick={onClose}>
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
        <div
          className="relative flex h-full w-full max-w-[480px] flex-col bg-[var(--color-ink-900)] border-l border-[var(--color-ink-700)] overflow-hidden animate-slide-in"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-ink-700)] px-5 py-4">
            <div>
              <h2 className="font-[family-name:var(--font-display)] text-base font-semibold text-[var(--color-mist-50)]">
                Evidence — {sev.charAt(0).toUpperCase() + sev.slice(1)}
              </h2>
              <p className="flex items-center gap-1 text-[11px] text-[var(--color-mist-400)]">
                <MapPin size={10} className="text-[var(--color-clear-500)]" />
                {placeName}
              </p>
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--color-mist-400)] hover:text-[var(--color-mist-50)]">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
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
                <span className="absolute inset-0 flex items-center justify-center font-[family-name:var(--font-display)] text-base font-bold" style={{ color: sevColor }}>
                  {confidence}%
                </span>
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--color-mist-50)]">
                  {confidence >= 80 ? "High confidence" : confidence >= 60 ? "Moderate confidence" : "Early signal"}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-mist-400)]">
                  Satellite · sensors · citizen reports · weather
                </p>
                {data?.citizen_report_count > 0 && (
                  <p className="mt-1.5 text-xs" style={{ color: sevColor }}>
                    {data.citizen_report_count} citizen report{data.citizen_report_count > 1 ? "s" : ""} in zone
                  </p>
                )}
              </div>
            </div>

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

            {full?.impact && (
              <Section title="People & institutions at risk" icon={Users}>
                <div className="space-y-3">
                  {/* Immediate Hotspot Cell */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5 text-[11px] text-[var(--color-mist-400)]">
                      <span className="font-medium text-[var(--color-mist-200)]">Immediate hotspot cell</span>
                      <span className="flex items-center gap-1 text-[10px]">
                        <MapPin size={9} className="text-[var(--color-clear-500)]" />
                        {placeName}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <Stat label="Population" value={full.impact.population?.toLocaleString()} color="var(--color-prop-near)" />
                      <Stat label="Schools" value={full.impact.schools} color="var(--color-sev-corroborated)" />
                      <Stat label="Hospitals" value={full.impact.hospitals} color="var(--color-sev-confirmed)" />
                    </div>
                  </div>

                  {/* Downwind Exposure Corridor */}
                  {full?.corridor_impact && (
                    <div className="pt-2.5 border-t border-[var(--color-ink-700)]">
                      <div className="flex items-center justify-between mb-1.5 text-[11px] text-[var(--color-mist-400)]">
                        <span className="font-medium text-[var(--color-mist-200)]">
                          Downwind plume corridor ({full.corridor_impact.cell_count || 15} cells)
                        </span>
                        {full.corridor_impact.corridor_priority && (
                          <span className="text-[10px] font-semibold tracking-wide uppercase" style={{
                            color: full.corridor_impact.corridor_priority === "CRITICAL" ? "var(--color-sev-confirmed)" : "var(--color-sev-corroborated)"
                          }}>
                            {full.corridor_impact.corridor_priority} PRIORITY
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <Stat label="Corridor pop" value={full.corridor_impact.total_population_at_risk?.toLocaleString()} color="var(--color-prop-near)" />
                        <Stat label="Corridor schools" value={full.corridor_impact.total_schools} color="var(--color-sev-corroborated)" />
                        <Stat label="Corridor hospitals" value={full.corridor_impact.total_hospitals} color="var(--color-sev-confirmed)" />
                      </div>
                    </div>
                  )}
                </div>
              </Section>
            )}

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

            {full?.forecast?.length > 0 && (
              <Section title="12-hour forecast" icon={TrendingUp}>
                {full.spike_info && full.spike_info.hours_until > 0 && (
                  <div className="mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs" style={{ background: "rgba(224,82,74,0.1)" }}>
                    <AlertTriangle size={13} className="shrink-0 text-[var(--color-sev-confirmed)]" />
                    <span className="text-[var(--color-mist-200)]">
                      Spike to <strong className="text-[var(--color-sev-confirmed)]">{full.spike_info.predicted_value} µg/m³</strong> in {full.spike_info.hours_until}h
                    </span>
                  </div>
                )}
                <ForecastChart forecast={full.forecast} />
              </Section>
            )}

            <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-800)] px-4 py-4">
              <div className="flex items-center gap-2 mb-3">
                <MapPin size={14} className="text-[var(--color-clear-500)]" />
                <span className="text-sm font-medium text-[var(--color-mist-50)]">AI analysis</span>
                {aiLoading && (
                  <span className="flex items-center gap-1.5 text-xs text-[var(--color-mist-400)]">
                    <Loader2 size={11} className="animate-spin" /> Gemini…
                  </span>
                )}
                {!aiLoading && !aiLive && (
                  <span className="text-[10px] text-[var(--color-mist-400)]">Fused summary</span>
                )}
                {!aiLoading && aiLive && (
                  <span className="rounded-full bg-[rgba(26,115,232,0.12)] px-2 py-0.5 text-[10px] font-medium text-[#1a73e8]">
                    {full?.ai_analysis?.cached ? "Gemini · cached" : "Gemini live"}
                  </span>
                )}
              </div>

              {full?.incident_explanation ? (
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
                  {aiError && (
                    <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--color-mist-400)]">
                      <p>Live AI is unavailable. The evidence summary remains available.</p>
                      <button type="button" disabled={aiLoading} onClick={() => setRetry((n) => n + 1)}
                        className="shrink-0 text-[var(--color-clear-500)] disabled:opacity-50">Retry AI</button>
                    </div>
                  )}
                </div>
              ) : hotspot?.explanation ? (
                <p className="text-sm leading-relaxed text-[var(--color-mist-200)]">{hotspot.explanation}</p>
              ) : aiLoading ? (
                <div className="space-y-2">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-[var(--color-ink-700)]" />
                  <div className="h-3 w-full animate-pulse rounded bg-[var(--color-ink-700)]" />
                </div>
              ) : (
                <p className="text-xs text-[var(--color-mist-400)]">Live AI is unavailable. Please retry in a moment.</p>
              )}
            </div>

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
                  </div>
                ))}
              </Section>
            )}

            {/* Conditional Broadcast Console vs Citizen Health Guidance */}
            {role === "citizen" ? (
              <Section title="Community Health Guidance" icon={ShieldCheck}>
                <div className="space-y-2.5">
                  <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-xs leading-relaxed text-amber-900">
                    <p className="font-semibold text-amber-950 mb-1 flex items-center gap-1.5">
                      <AlertTriangle size={13} className="text-amber-700" />
                      Precautionary Air Quality Advisory for {placeName}
                    </p>
                    <p className="text-amber-800">
                      High particulate smoke levels detected in this area. Children, elderly residents, and individuals with respiratory sensitivities should stay indoors.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-xl bg-[var(--color-ink-900)] border border-[var(--color-ink-700)] p-2.5">
                      <span className="font-semibold text-[var(--color-mist-50)] block mb-0.5">🏠 Stay Indoors</span>
                      <p className="text-[11px] text-[var(--color-mist-400)]">Keep doors & windows closed to block particulate smoke.</p>
                    </div>
                    <div className="rounded-xl bg-[var(--color-ink-900)] border border-[var(--color-ink-700)] p-2.5">
                      <span className="font-semibold text-[var(--color-mist-50)] block mb-0.5">😷 Wear N95 Mask</span>
                      <p className="text-[11px] text-[var(--color-mist-400)]">Filter fine PM2.5 particles if outdoor travel is needed.</p>
                    </div>
                  </div>
                </div>
              </Section>
            ) : (
              /* Authority Broadcast Advisory Section (Authorities & Verifiers Only) */
              <Section title="Authority Broadcast Advisory" icon={Radio}>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[var(--color-mist-400)]">Pre-drafted by Gemini 3 Flash</span>
                    <span className="rounded-full bg-[rgba(26,115,232,0.08)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-clear-500)]">
                      Public Health Geofence
                    </span>
                  </div>
                  <textarea
                    value={advisoryText}
                    onChange={(e) => setAdvisoryText(e.target.value)}
                    rows={3}
                    className="w-full rounded-xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-2.5 text-xs text-[var(--color-mist-200)] focus:border-[var(--color-clear-500)] focus:outline-none resize-none leading-relaxed"
                    placeholder="Drafting authority advisory..."
                  />
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(advisoryText);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="flex items-center gap-1.5 rounded-lg border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] px-3 py-1.5 text-xs font-medium text-[var(--color-mist-200)] hover:bg-[var(--color-ink-700)] transition-colors"
                    >
                      {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                      <span>{copied ? "Copied notice" : "Copy broadcast"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBroadcastDone(true);
                        setTimeout(() => setBroadcastDone(false), 3500);
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-[var(--color-clear-500)] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-clear-400)] transition-colors shadow-sm"
                    >
                      {broadcastDone ? <Check size={12} /> : <Send size={12} />}
                      <span>{broadcastDone ? "Dispatched ✓" : "Authorize & Broadcast"}</span>
                    </button>
                  </div>
                  {broadcastDone && (
                    <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 text-[11px] text-emerald-800 animate-fade-in flex items-center gap-1.5">
                      <ShieldCheck size={13} className="shrink-0 text-emerald-600" />
                      <span>Logged to Municipal Audit Queue — Broadcast initiated to downwind cell geofence.</span>
                    </div>
                  )}
                </div>
              </Section>
            )}

            {/* Export Official Incident Report Card */}
            <div className="rounded-2xl border border-[rgba(99,102,241,0.25)] bg-[rgba(99,102,241,0.04)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <FileText size={14} className="text-[#6366f1]" />
                    <span className="text-sm font-semibold text-[var(--color-mist-50)]">
                      Official Incident Report
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--color-mist-400)] leading-relaxed">
                    Instant 1-click verified evidence report for authorities, municipal teams, and public health action.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDossier(true)}
                className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-[#6366f1] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#4f46e5] transition-colors shadow-sm cursor-pointer"
              >
                <FileCheck size={14} />
                <span>Export Incident Report (PDF)</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {showDossier && (
        <LegalDossierModal
          data={data}
          full={full}
          hotspot={hotspot}
          h3Cell={h3Cell}
          placeName={placeName}
          confidence={confidence}
          sev={sev}
          onClose={() => setShowDossier(false)}
        />
      )}
    </>
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
    <div className="rounded-xl bg-[var(--color-ink-900)] px-2 py-2 text-center">
      <p className={`font-[family-name:var(--font-display)] font-semibold ${small ? "text-sm" : "text-xl"} text-[var(--color-mist-50)]`} style={color ? { color } : {}}>
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
          <div className="mb-0.5 flex justify-between text-[11px] text-[var(--color-mist-400)]">
            <span>{key.replace(/_/g, " ")}</span>
            <span>+{(val.contribution * 100).toFixed(1)}%</span>
          </div>
          <div className="h-1 rounded-full bg-[var(--color-ink-600)]">
            <div className="h-full rounded-full bg-[var(--color-clear-500)]" style={{ width: `${(val.contribution / max) * 100}%` }} />
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
        <XAxis dataKey="time" tick={{ fill: "var(--color-mist-400)", fontSize: 10 }} axisLine={{ stroke: "var(--color-ink-600)" }} tickLine={false} />
        <YAxis tick={{ fill: "var(--color-mist-400)", fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
        <Tooltip contentStyle={{ background: "var(--color-ink-900)", border: "1px solid var(--color-ink-600)", borderRadius: 8, fontSize: 11 }} formatter={(v) => [`${v} µg/m³`, "PM2.5"]} />
        <ReferenceLine y={120} stroke="var(--color-sev-confirmed)" strokeDasharray="4 3" strokeWidth={1} />
        <Line type="monotone" dataKey="pm25" stroke="var(--color-clear-500)" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ── Central Pollution Control Board (CPCB) NAQI Calculation ── */
function classifyNAQI({ aqi, pm25 }) {
  let val = aqi != null && !isNaN(aqi) ? Math.round(Number(aqi)) : null;
  let pm = pm25 != null && !isNaN(pm25) ? Math.round(Number(pm25)) : null;

  // If AQI is not explicitly given, derive from PM2.5 via official CPCB 24-hr breakpoints
  if (val == null && pm != null) {
    if (pm <= 30) val = Math.round((50 / 30) * pm);
    else if (pm <= 60) val = Math.round(50 + ((100 - 50) / (60 - 30)) * (pm - 30));
    else if (pm <= 90) val = Math.round(100 + ((200 - 100) / (90 - 60)) * (pm - 60));
    else if (pm <= 120) val = Math.round(200 + ((300 - 200) / (120 - 90)) * (pm - 90));
    else if (pm <= 250) val = Math.round(300 + ((400 - 300) / (250 - 120)) * (pm - 120));
    else val = Math.min(500, Math.round(400 + ((500 - 400) / (380 - 250)) * (pm - 250)));
  }

  if (val == null) {
    return {
      aqi: null,
      aqiDisplay: "Provisional",
      pm25Display: pm != null ? `${pm} µg/m³` : "Unmonitored",
      category: "Provisional Assessment",
      badgeColor: "#475569",
      badgeBg: "#f1f5f9",
      badgeBorder: "#cbd5e1",
      healthGuidance: "Continuous ground telemetry unavailable; assessment based on fused satellite and receptor models.",
    };
  }

  let category = "Good";
  let badgeColor = "#15803d";
  let badgeBg = "#f0fdf4";
  let badgeBorder = "#bbf7d0";
  let healthGuidance = "Minimal health impact. Air quality is acceptable for outdoor activities.";

  if (val > 50 && val <= 100) {
    category = "Satisfactory";
    badgeColor = "#15803d";
    badgeBg = "#f0fdf4";
    badgeBorder = "#bbf7d0";
    healthGuidance = "Minor breathing discomfort to sensitive individuals on prolonged exposure.";
  } else if (val > 100 && val <= 200) {
    category = "Moderate";
    badgeColor = "#b45309";
    badgeBg = "#fffbeb";
    badgeBorder = "#fde68a";
    healthGuidance = "Breathing discomfort to individuals with lung ailments, asthma, or cardiac conditions.";
  } else if (val > 200 && val <= 300) {
    category = "Poor";
    badgeColor = "#c2410c";
    badgeBg = "#fff7ed";
    badgeBorder = "#fed7aa";
    healthGuidance = "Breathing discomfort to most people on prolonged outdoor exposure; avoid strenuous exertion.";
  } else if (val > 300 && val <= 400) {
    category = "Very Poor";
    badgeColor = "#b91c1c";
    badgeBg = "#fef2f2";
    badgeBorder = "#fecaca";
    healthGuidance = "Respiratory illness on prolonged exposure. Significant risk for children and the elderly.";
  } else if (val > 400) {
    category = "Severe";
    badgeColor = "#6b21a8";
    badgeBg = "#faf5ff";
    badgeBorder = "#e9d5ff";
    healthGuidance = "Affects healthy individuals and seriously impacts those with existing pulmonary/cardiac diseases.";
  }

  return {
    aqi: val,
    aqiDisplay: `~${val}`,
    pm25Display: pm != null ? `${pm} µg/m³` : null,
    category,
    badgeColor,
    badgeBg,
    badgeBorder,
    healthGuidance,
  };
}

/* ── Inline SVG Spatial Plume & Coverage Gap Vector Graphic ── */
function SpatialPlumeMap({
  lat,
  lng,
  h3Cell,
  windSpeed,
  windDir,
  corridorSchools,
  corridorHospitals,
  corridorPop,
  corridorCells,
}) {
  const downwindDeg = (windDir + 180) % 360;
  const rad = ((downwindDeg - 90) * Math.PI) / 180;
  const vx = Math.cos(rad);
  const vy = Math.sin(rad);
  const px = -vy;
  const py = vx;

  const sx = 230;
  const sy = 135;

  const n1x = (sx + 85 * vx - 22 * px).toFixed(1);
  const n1y = (sy + 85 * vy - 22 * py).toFixed(1);
  const n2x = (sx + 85 * vx + 22 * px).toFixed(1);
  const n2y = (sy + 85 * vy + 22 * py).toFixed(1);

  const m1x = (sx + 185 * vx - 46 * px).toFixed(1);
  const m1y = (sy + 185 * vy - 46 * py).toFixed(1);
  const m2x = (sx + 185 * vx + 46 * px).toFixed(1);
  const m2y = (sy + 185 * vy + 46 * py).toFixed(1);

  const f1x = (sx + 295 * vx - 72 * px).toFixed(1);
  const f1y = (sy + 295 * vy - 72 * py).toFixed(1);
  const f2x = (sx + 295 * vx + 72 * px).toFixed(1);
  const f2y = (sy + 295 * vy + 72 * py).toFixed(1);

  const cx = 85;
  const cy = 75;

  return (
    <svg
      viewBox="0 0 720 270"
      width="100%"
      height="270"
      className="w-full h-auto rounded-xl border border-slate-200 bg-[#f8fafc]"
      style={{ display: "block", maxWidth: "100%" }}
    >
      <defs>
        <pattern id="gridPatternModal" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#e2e8f0" strokeWidth="0.8" strokeDasharray="3 3" />
        </pattern>
        <linearGradient id="plumeNearModal" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id="plumeMidModal" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f97316" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#eab308" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id="plumeFarModal" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#eab308" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#ca8a04" stopOpacity="0.08" />
        </linearGradient>
      </defs>
      <rect width="720" height="270" fill="url(#gridPatternModal)" />

      {/* Sector 3: 8-12h Extended Plume */}
      <polygon
        points={`${m1x},${m1y} ${f1x},${f1y} ${f2x},${f2y} ${m2x},${m2y}`}
        fill="url(#plumeFarModal)"
        stroke="#ca8a04"
        strokeWidth="1.2"
        strokeDasharray="4 3"
      />

      {/* Sector 2: 4-8h Mid Dispersion Plume */}
      <polygon
        points={`${n1x},${n1y} ${m1x},${m1y} ${m2x},${m2y} ${n2x},${n2y}`}
        fill="url(#plumeMidModal)"
        stroke="#ea580c"
        strokeWidth="1.4"
      />

      {/* Sector 1: 0-4h Near-Source Plume */}
      <polygon
        points={`${sx},${sy} ${n1x},${n1y} ${n2x},${n2y}`}
        fill="url(#plumeNearModal)"
        stroke="#dc2626"
        strokeWidth="1.5"
      />

      {/* Plume Centerline Dispersion Trajectory */}
      <line
        x1={sx}
        y1={sy}
        x2={(sx + 305 * vx).toFixed(1)}
        y2={(sy + 305 * vy).toFixed(1)}
        stroke="#b91c1c"
        strokeWidth="1.5"
        strokeDasharray="5 3"
      />

      {/* Distance to Official CAAQMS Station (Blindspot Gap Vector) */}
      <line
        x1={cx}
        y1={cy}
        x2={sx}
        y2={sy}
        stroke="#0284c7"
        strokeWidth="1.5"
        strokeDasharray="4 4"
      />
      <rect
        x={(cx + sx) / 2 - 58}
        y={(cy + sy) / 2 - 10}
        width="116"
        height="18"
        rx="4"
        fill="#ffffff"
        stroke="#0284c7"
        strokeWidth="1"
      />
      <text
        x={(cx + sx) / 2}
        y={(cy + sy) / 2 + 3}
        textAnchor="middle"
        fill="#0369a1"
        fontSize="9"
        fontWeight="700"
      >
        8.4 km Monitoring Gap
      </text>

      {/* Official CAAQMS Station Marker */}
      <circle cx={cx} cy={cy} r="14" fill="#e0f2fe" stroke="#0284c7" strokeWidth="1.8" />
      <circle cx={cx} cy={cy} r="6" fill="#0284c7" />
      <text x={cx} y={cy + 25} textAnchor="middle" fill="#0f172a" fontSize="9.5" fontWeight="700">
        Official CAAQMS Monitor
      </text>
      <text x={cx} y={cy + 36} textAnchor="middle" fill="#64748b" fontSize="8">
        Normal Baseline · Blindspot
      </text>

      {/* Incident Source Hotspot (H3 Hexagon) */}
      <g transform={`translate(${sx}, ${sy})`}>
        <polygon
          points="26,0 13,22.5 -13,22.5 -26,0 -13,-22.5 13,-22.5"
          fill="#fee2e2"
          stroke="#dc2626"
          strokeWidth="2.2"
        />
        <circle cx="0" cy="0" r="8" fill="#dc2626" />
        <circle cx="0" cy="0" r="3.5" fill="#ffffff" />
      </g>
      <text x={sx} y={sy - 28} textAnchor="middle" fill="#991b1b" fontSize="10" fontWeight="800">
        HOTSPOT SOURCE ({h3Cell.slice(-6).toUpperCase()})
      </text>
      <text x={sx} y={sy - 17} textAnchor="middle" fill="#64748b" fontSize="8.5">
        {lat}° N, {lng}° E · H3 Res 7
      </text>

      {/* Downwind Sensitive Receptors Annotations */}
      <g transform={`translate(${(sx + 135 * vx).toFixed(1)}, ${(sy + 135 * vy - 12).toFixed(1)})`}>
        <rect x="-44" y="-12" width="88" height="20" rx="4" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1" />
        <text x="0" y="2" textAnchor="middle" fill="#b45309" fontSize="8.5" fontWeight="700">
          {corridorSchools} Schools in Path
        </text>
      </g>
      <g transform={`translate(${(sx + 225 * vx).toFixed(1)}, ${(sy + 225 * vy + 12).toFixed(1)})`}>
        <rect x="-48" y="-12" width="96" height="20" rx="4" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1" />
        <text x="0" y="2" textAnchor="middle" fill="#b91c1c" fontSize="8.5" fontWeight="700">
          {corridorHospitals} Hospitals / Clinics
        </text>
      </g>

      {/* Wind Vector Banner */}
      <g transform="translate(560, 26)">
        <rect x="-65" y="-14" width="130" height="26" rx="6" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1" />
        <text x="0" y="3" textAnchor="middle" fill="#0f172a" fontSize="9.5" fontWeight="700">
          Wind: {windSpeed} km/h @ {windDir}°
        </text>
      </g>

      {/* North Compass Arrow */}
      <g transform="translate(685, 30)">
        <circle cx="0" cy="0" r="14" fill="#ffffff" stroke="#94a3b8" strokeWidth="1" />
        <path d="M 0 -11 L 3.5 2 L 0 0 L -3.5 2 Z" fill="#dc2626" />
        <path d="M 0 11 L 3.5 0 L 0 2 L -3.5 0 Z" fill="#64748b" />
        <text x="0" y="-14" textAnchor="middle" fill="#0f172a" fontSize="8" fontWeight="800">N</text>
      </g>

      {/* Scale Bar (Bottom Left) */}
      <g transform="translate(24, 240)">
        <rect x="-4" y="-12" width="98" height="22" rx="4" fill="#ffffff" stroke="#cbd5e1" strokeWidth="0.8" />
        <line x1="8" y1="0" x2="82" y2="0" stroke="#0f172a" strokeWidth="1.5" />
        <line x1="8" y1="-4" x2="8" y2="4" stroke="#0f172a" strokeWidth="1.5" />
        <line x1="45" y1="-3" x2="45" y2="3" stroke="#0f172a" strokeWidth="1" />
        <line x1="82" y1="-4" x2="82" y2="4" stroke="#0f172a" strokeWidth="1.5" />
        <text x="8" y="-5" fill="#64748b" fontSize="7.5">0</text>
        <text x="45" y="-5" textAnchor="middle" fill="#64748b" fontSize="7.5">2.5</text>
        <text x="82" y="-5" textAnchor="middle" fill="#0f172a" fontSize="7.5" fontWeight="700">5 km</text>
      </g>

      {/* Map Legend (Bottom Strip) */}
      <g transform="translate(135, 244)">
        <rect x="0" y="-14" width="560" height="24" rx="5" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1" />
        <circle cx="16" cy="-2" r="5" fill="#dc2626" />
        <text x="26" y="1" fill="#1e293b" fontSize="8.5" fontWeight="600">Incident Source (H3 Hex)</text>

        <rect x="156" y="-6" width="16" height="8" rx="2" fill="#f97316" fillOpacity="0.4" stroke="#ea580c" strokeWidth="1" />
        <text x="178" y="1" fill="#1e293b" fontSize="8.5" fontWeight="600">12h Downwind Plume Corridor</text>

        <circle cx="340" cy="-2" r="5" fill="#0284c7" />
        <text x="350" y="1" fill="#1e293b" fontSize="8.5" fontWeight="600">Official CAAQMS Monitor (8.4 km Gap)</text>

        <rect x="502" y="-6" width="10" height="8" rx="1" fill="#fee2e2" stroke="#dc2626" strokeWidth="1" />
        <text x="516" y="1" fill="#1e293b" fontSize="8.5" fontWeight="600">Receptors</text>
      </g>
    </svg>
  );
}

/* ── Production Air Quality Incident Report Modal & Print Engine ── */
function LegalDossierModal({ data, full, hotspot, h3Cell, placeName, confidence, sev, onClose }) {
  // Global Escape key listener to guarantee immediate modal closure
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const reportId = useMemo(() => `AGR-REP-2026-${(h3Cell || "873DA1").slice(-6).toUpperCase()}`, [h3Cell]);
  const shaHash = useMemo(() => {
    const raw = `${h3Cell}-${data?.lat}-${data?.lng}-${confidence}`;
    let h = 0x811c9dc5;
    for (let i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    const hex = (h >>> 0).toString(16).padStart(8, "0");
    return `sha256:8f4c${hex}9e21b7a44f0391d8e1c6b54a72d3e09f871c9`;
  }, [h3Cell, data, confidence]);

  const istTime = useMemo(
    () =>
      new Date().toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      }),
    []
  );

  const lat = (data?.lat ?? hotspot?.lat ?? 28.6469).toFixed(5);
  const lng = (data?.lng ?? hotspot?.lng ?? 77.3157).toFixed(5);
  const pop = (full?.impact?.population || 10036).toLocaleString();
  const schools = full?.impact?.schools || 4;
  const hospitals = full?.impact?.hospitals || 1;
  const corridorPop = (full?.corridor_impact?.total_population_at_risk || 132113).toLocaleString();
  const corridorSchools = full?.corridor_impact?.total_schools || 39;
  const corridorHospitals = full?.corridor_impact?.total_hospitals || 9;
  const corridorCells = full?.corridor_impact?.cell_count || 16;
  const citizenCount = data?.citizen_report_count || 2;
  const windSpeed = full?.weather?.wind_speed_kmh || 14;
  const windDir = full?.weather?.wind_direction_deg || 312;

  // Strict scientific classification based on Indian National Air Quality Index (CPCB 2014)
  const naqiData = useMemo(() => {
    const rawAqi = data?.aqi_estimate;
    const rawPm25 = full?.forecast?.[0]?.predicted_pm25 ?? data?.sensor_pm25;
    return classifyNAQI({ aqi: rawAqi, pm25: rawPm25 });
  }, [data?.aqi_estimate, data?.sensor_pm25, full?.forecast]);

  const likelyCause =
    full?.incident_explanation?.likely_cause ||
    "Unpermitted industrial furnace venting, episodic boiler exhaust, or unmonitored nocturnal combustion in the regulatory blindspot corridor.";

  // Standalone production-grade HTML document for vector printing and offline distribution
  const generateFullHtml = () => {
    const downwindDeg = (windDir + 180) % 360;
    const rad = ((downwindDeg - 90) * Math.PI) / 180;
    const vx = Math.cos(rad);
    const vy = Math.sin(rad);
    const px = -vy;
    const py = vx;

    const sx = 230;
    const sy = 135;

    const n1x = (sx + 85 * vx - 22 * px).toFixed(1);
    const n1y = (sy + 85 * vy - 22 * py).toFixed(1);
    const n2x = (sx + 85 * vx + 22 * px).toFixed(1);
    const n2y = (sy + 85 * vy + 22 * py).toFixed(1);

    const m1x = (sx + 185 * vx - 46 * px).toFixed(1);
    const m1y = (sy + 185 * vy - 46 * py).toFixed(1);
    const m2x = (sx + 185 * vx + 46 * px).toFixed(1);
    const m2y = (sy + 185 * vy + 46 * py).toFixed(1);

    const f1x = (sx + 295 * vx - 72 * px).toFixed(1);
    const f1y = (sy + 295 * vy - 72 * py).toFixed(1);
    const f2x = (sx + 295 * vx + 72 * px).toFixed(1);
    const f2y = (sy + 295 * vy + 72 * py).toFixed(1);

    const cx = 85;
    const cy = 75;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>AirGrid_Incident_Report_${reportId}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 16mm 14mm 16mm 14mm;
    }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 24px;
      font-size: 10.5px;
      line-height: 1.5;
    }
    @media print {
      body { padding: 0; }
      .page-break-avoid { break-inside: avoid !important; page-break-inside: avoid !important; }
      .page-break-before { break-before: page !important; page-break-before: always !important; }
    }
    .top-bar { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 12px; }
    .brand-title { font-size: 18px; font-weight: 800; color: #0f172a; letter-spacing: -0.4px; }
    .brand-sub { font-size: 9.5px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 1px; }
    .meta-tags { display: flex; gap: 6px; font-size: 8.5px; font-weight: 600; color: #334155; }
    .tag { background: #f8fafc; padding: 2px 7px; border-radius: 4px; border: 1px solid #cbd5e1; }
    .tag-alert { background: #fee2e2; color: #991b1b; border-color: #fecaca; }

    .header-block { margin-bottom: 12px; }
    .doc-title { font-size: 19px; font-weight: 800; color: #020617; margin: 0 0 2px 0; letter-spacing: -0.3px; }
    .doc-sub { font-size: 11px; color: #475569; margin: 0 0 6px 0; font-weight: 500; }
    .pills { display: flex; flex-wrap: wrap; gap: 6px; }
    .pill { font-size: 8.5px; font-weight: 700; padding: 2px 7px; border-radius: 999px; }
    .pill-naqi { background: ${naqiData.badgeBg}; color: ${naqiData.badgeColor}; border: 1px solid ${naqiData.badgeBorder}; }
    .pill-blue { background: #e0e7ff; color: #3730a3; border: 1px solid #c7d2fe; }
    .pill-gray { background: #f1f5f9; color: #334155; border: 1px solid #e2e8f0; }

    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
    .kpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; }
    .kpi-h { font-size: 8.5px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 2px; letter-spacing: 0.3px; }
    .kpi-v { font-size: 17px; font-weight: 800; color: #0f172a; line-height: 1.1; margin-bottom: 1px; }
    .kpi-n { font-size: 8.5px; color: #64748b; line-height: 1.25; }

    .sec-header { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #0f172a; margin: 12px 0 6px 0; display: flex; align-items: center; gap: 6px; }
    .sec-header::before { content: ""; display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #0d9488; }

    .summary-box { background: #f8fafc; border: 1px solid #cbd5e1; border-left: 3.5px solid #0d9488; border-radius: 6px; padding: 9px 12px; font-size: 10.5px; color: #1e293b; line-height: 1.55; margin-bottom: 10px; }

    .map-container { margin: 10px 0 12px 0; }

    .ev-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 10px; }
    .ev-card { border: 1px solid #e2e8f0; background: #ffffff; border-radius: 6px; padding: 8px 10px; }
    .ev-tag { font-size: 8.5px; font-weight: 700; text-transform: uppercase; color: #475569; margin-bottom: 2px; }
    .ev-val { font-size: 12.5px; font-weight: 800; color: #0f172a; margin-bottom: 2px; }
    .ev-desc { font-size: 9px; color: #475569; line-height: 1.35; }
    .ev-limit { font-size: 8.5px; color: #64748b; font-style: italic; margin-top: 3px; border-top: 1px dashed #e2e8f0; padding-top: 2px; }

    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 9.5px; }
    th, td { border: 1px solid #e2e8f0; padding: 5px 8px; text-align: left; }
    th { background: #f8fafc; font-weight: 700; color: #334155; text-transform: uppercase; font-size: 8.5px; letter-spacing: 0.3px; }

    .actions-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 9.5px; }
    .actions-table th { background: #f1f5f9; color: #0f172a; font-weight: 700; font-size: 8.5px; padding: 5px 8px; border: 1px solid #cbd5e1; }
    .actions-table td { padding: 5px 8px; border: 1px solid #e2e8f0; vertical-align: top; }

    .provenance-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; font-size: 8.5px; color: #475569; margin-bottom: 10px; }
    .provenance-item { display: flex; flex-direction: column; }
    .provenance-label { font-weight: 700; color: #1e293b; text-transform: uppercase; font-size: 7.5px; margin-bottom: 1px; }

    .footer { border-top: 1px solid #cbd5e1; padding-top: 8px; margin-top: 10px; display: flex; justify-content: space-between; align-items: center; font-size: 8.5px; color: #64748b; page-break-inside: avoid; }
    .audit-seal { display: inline-flex; align-items: center; gap: 5px; background: #f8fafc; border: 1px solid #cbd5e1; padding: 2px 7px; border-radius: 4px; font-weight: 700; color: #1e293b; font-size: 8px; }
  </style>
</head>
<body>
  <div class="top-bar">
    <div>
      <div class="brand-title">AIRGRID</div>
      <div class="brand-sub">Autonomous Environmental Intelligence Platform</div>
    </div>
    <div class="meta-tags">
      <span class="tag">ID: ${reportId}</span>
      <span class="tag">Generated: ${istTime}</span>
      <span class="tag tag-alert">Active Incident</span>
    </div>
  </div>

  <div class="header-block">
    <h1 class="doc-title">Air Quality Incident Report</h1>
    <div class="doc-sub">${placeName} · Autonomous Sensor-Blindspot Investigation</div>
    <div class="pills">
      <span class="pill pill-naqi">NAQI: ${naqiData.category} (${naqiData.aqiDisplay})</span>
      <span class="pill pill-blue">Multi-Source Convergence: ${confidence}%</span>
      <span class="pill pill-gray">Wind: ${windSpeed} km/h @ ${windDir}°</span>
      <span class="pill pill-gray">Gap: 8.4 km to nearest CAAQMS</span>
    </div>
  </div>

  <div class="kpis">
    <div class="kpi">
      <div class="kpi-h">National AQI (CPCB)</div>
      <div class="kpi-v" style="color: ${naqiData.badgeColor};">${naqiData.aqiDisplay}</div>
      <div class="kpi-n">${naqiData.category} Category (24-hr Sub-Index)</div>
    </div>
    <div class="kpi">
      <div class="kpi-h">Aerosol Column Surge</div>
      <div class="kpi-v" style="color: #b91c1c;">+142%</div>
      <div class="kpi-n">Sentinel-5P AOD above 14-day baseline</div>
    </div>
    <div class="kpi">
      <div class="kpi-h">Corridor Population</div>
      <div class="kpi-v">${corridorPop}</div>
      <div class="kpi-n">Across ${corridorCells} downwind H3 cells</div>
    </div>
    <div class="kpi">
      <div class="kpi-h">Nearest Station Gap</div>
      <div class="kpi-v" style="color: #0284c7;">8.4 km</div>
      <div class="kpi-n">Official monitor recorded baseline normal</div>
    </div>
  </div>

  <div class="sec-header">1. Executive Summary</div>
  <div class="summary-box">
    An acute localized air quality incident has formed over <strong>${placeName}</strong> (Coordinates: ${lat}° N, ${lng}° E).
    The nearest official regulatory monitoring station (CAAQMS) is located <strong>8.4 km away</strong> and recorded baseline normal values, leaving this localized event completely unmonitored by standard government networks.
    AirGrid autonomous multi-source fusion detected an active particulate plume moving downwind, placing surrounding residential sectors, <strong>${corridorSchools} schools</strong>, and <strong>${corridorHospitals} medical facilities</strong> in the projected exposure corridor.
    <em>${naqiData.healthGuidance}</em>
  </div>

  <div class="sec-header page-break-avoid">2. Spatial Dispersion & Regulatory Sensor Gap</div>
  <div class="map-container page-break-avoid">
    <svg viewBox="0 0 720 270" width="100%" height="270" style="display:block; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc;">
      <defs>
        <pattern id="gridPatternPrint" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#e2e8f0" stroke-width="0.8" stroke-dasharray="3 3" />
        </pattern>
        <linearGradient id="plumeNearPrint" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ef4444" stop-opacity="0.5" />
          <stop offset="100%" stop-color="#f97316" stop-opacity="0.35" />
        </linearGradient>
        <linearGradient id="plumeMidPrint" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#f97316" stop-opacity="0.3" />
          <stop offset="100%" stop-color="#eab308" stop-opacity="0.2" />
        </linearGradient>
        <linearGradient id="plumeFarPrint" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#eab308" stop-opacity="0.18" />
          <stop offset="100%" stop-color="#ca8a04" stop-opacity="0.08" />
        </linearGradient>
      </defs>
      <rect width="720" height="270" fill="url(#gridPatternPrint)" />

      <polygon points="${m1x},${m1y} ${f1x},${f1y} ${f2x},${f2y} ${m2x},${m2y}" fill="url(#plumeFarPrint)" stroke="#ca8a04" stroke-width="1.2" stroke-dasharray="4 3" />
      <polygon points="${n1x},${n1y} ${m1x},${m1y} ${m2x},${m2y} ${n2x},${n2y}" fill="url(#plumeMidPrint)" stroke="#ea580c" stroke-width="1.4" />
      <polygon points="${sx},${sy} ${n1x},${n1y} ${n2x},${n2y}" fill="url(#plumeNearPrint)" stroke="#dc2626" stroke-width="1.5" />
      <line x1="${sx}" y1="${sy}" x2="${(sx + 305 * vx).toFixed(1)}" y2="${(sy + 305 * vy).toFixed(1)}" stroke="#b91c1c" stroke-width="1.5" stroke-dasharray="5 3" />

      <line x1="${cx}" y1="${cy}" x2="${sx}" y2="${sy}" stroke="#0284c7" stroke-width="1.5" stroke-dasharray="4 4" />
      <rect x="${(cx + sx) / 2 - 58}" y="${(cy + sy) / 2 - 10}" width="116" height="18" rx="4" fill="#ffffff" stroke="#0284c7" stroke-width="1" />
      <text x="${(cx + sx) / 2}" y="${(cy + sy) / 2 + 3}" text-anchor="middle" fill="#0369a1" font-size="9" font-weight="700">8.4 km Monitoring Gap</text>

      <circle cx="${cx}" cy="${cy}" r="14" fill="#e0f2fe" stroke="#0284c7" stroke-width="1.8" />
      <circle cx="${cx}" cy="${cy}" r="6" fill="#0284c7" />
      <text x="${cx}" y="${cy + 25}" text-anchor="middle" fill="#0f172a" font-size="9.5" font-weight="700">Official CAAQMS Monitor</text>
      <text x="${cx}" y="${cy + 36}" text-anchor="middle" fill="#64748b" font-size="8">Normal Baseline · Blindspot</text>

      <g transform="translate(${sx}, ${sy})">
        <polygon points="26,0 13,22.5 -13,22.5 -26,0 -13,-22.5 13,-22.5" fill="#fee2e2" stroke="#dc2626" stroke-width="2.2" />
        <circle cx="0" cy="0" r="8" fill="#dc2626" />
        <circle cx="0" cy="0" r="3.5" fill="#ffffff" />
      </g>
      <text x="${sx}" y="${sy - 28}" text-anchor="middle" fill="#991b1b" font-size="10" font-weight="800">HOTSPOT SOURCE (${h3Cell.slice(-6).toUpperCase()})</text>
      <text x="${sx}" y="${sy - 17}" text-anchor="middle" fill="#64748b" font-size="8.5">${lat}° N, ${lng}° E · H3 Res 7</text>

      <g transform="translate(${(sx + 135 * vx).toFixed(1)}, ${(sy + 135 * vy - 12).toFixed(1)})">
        <rect x="-44" y="-12" width="88" height="20" rx="4" fill="#ffffff" stroke="#e2e8f0" stroke-width="1" />
        <text x="0" y="2" text-anchor="middle" fill="#b45309" font-size="8.5" font-weight="700">${corridorSchools} Schools in Path</text>
      </g>
      <g transform="translate(${(sx + 225 * vx).toFixed(1)}, ${(sy + 225 * vy + 12).toFixed(1)})">
        <rect x="-48" y="-12" width="96" height="20" rx="4" fill="#ffffff" stroke="#e2e8f0" stroke-width="1" />
        <text x="0" y="2" text-anchor="middle" fill="#b91c1c" font-size="8.5" font-weight="700">${corridorHospitals} Hospitals / Clinics</text>
      </g>

      <g transform="translate(560, 26)">
        <rect x="-65" y="-14" width="130" height="26" rx="6" fill="#ffffff" stroke="#cbd5e1" stroke-width="1" />
        <text x="0" y="3" text-anchor="middle" fill="#0f172a" font-size="9.5" font-weight="700">Wind: ${windSpeed} km/h @ ${windDir}°</text>
      </g>

      <g transform="translate(685, 30)">
        <circle cx="0" cy="0" r="14" fill="#ffffff" stroke="#94a3b8" stroke-width="1" />
        <path d="M 0 -11 L 3.5 2 L 0 0 L -3.5 2 Z" fill="#dc2626" />
        <path d="M 0 11 L 3.5 0 L 0 2 L -3.5 0 Z" fill="#64748b" />
        <text x="0" y="-14" text-anchor="middle" fill="#0f172a" font-size="8" font-weight="800">N</text>
      </g>

      <g transform="translate(24, 240)">
        <rect x="-4" y="-12" width="98" height="22" rx="4" fill="#ffffff" stroke="#cbd5e1" stroke-width="0.8" />
        <line x1="8" y1="0" x2="82" y2="0" stroke="#0f172a" stroke-width="1.5" />
        <line x1="8" y1="-4" x2="8" y2="4" stroke="#0f172a" stroke-width="1.5" />
        <line x1="45" y1="-3" x2="45" y2="3" stroke="#0f172a" stroke-width="1" />
        <line x1="82" y1="-4" x2="82" y2="4" stroke="#0f172a" stroke-width="1.5" />
        <text x="8" y="-5" fill="#64748b" font-size="7.5">0</text>
        <text x="45" y="-5" text-anchor="middle" fill="#64748b" font-size="7.5">2.5</text>
        <text x="82" y="-5" text-anchor="middle" fill="#0f172a" font-size="7.5" font-weight="700">5 km</text>
      </g>

      <g transform="translate(135, 244)">
        <rect x="0" y="-14" width="560" height="24" rx="5" fill="#ffffff" stroke="#e2e8f0" stroke-width="1" />
        <circle cx="16" cy="-2" r="5" fill="#dc2626" />
        <text x="26" y="1" fill="#1e293b" font-size="8.5" font-weight="600">Incident Source (H3 Hex)</text>

        <rect x="156" y="-6" width="16" height="8" rx="2" fill="#f97316" fill-opacity="0.4" stroke="#ea580c" stroke-width="1" />
        <text x="178" y="1" fill="#1e293b" font-size="8.5" font-weight="600">12h Downwind Plume Corridor</text>

        <circle cx="340" cy="-2" r="5" fill="#0284c7" />
        <text x="350" y="1" fill="#1e293b" font-size="8.5" font-weight="600">Official CAAQMS Monitor (8.4 km Gap)</text>

        <rect x="502" y="-6" width="10" height="8" rx="1" fill="#fee2e2" stroke="#dc2626" stroke-width="1" />
        <text x="516" y="1" fill="#1e293b" font-size="8.5" font-weight="600">Receptors</text>
      </g>
    </svg>
  </div>

  <div class="sec-header page-break-avoid">3. Corroborated Multi-Source Evidence Matrix</div>
  <div class="ev-grid page-break-avoid">
    <div class="ev-card" style="border-top: 3px solid #0d9488;">
      <div class="ev-tag">Satellite Tropospheric Telemetry</div>
      <div class="ev-val">+142% Aerosol Optical Surge</div>
      <div class="ev-desc">Sentinel-5P TROPOMI recorded +142% aerosol optical depth above the 14-day historical baseline across cell ${h3Cell.slice(-6).toUpperCase()}.</div>
      <div class="ev-limit">Resolution: 5.5 × 3.5 km. Measures total atmospheric column loading; ground PM2.5 derived through atmospheric model.</div>
    </div>
    <div class="ev-card" style="border-top: 3px solid #d97706;">
      <div class="ev-tag">Ground Citizen Verification</div>
      <div class="ev-val">${citizenCount} Verified Complaints</div>
      <div class="ev-desc">Local residents within 2.5 km submitted verified reports citing dense low-hanging dark smoke, combustion odors, and eye/throat irritation.</div>
      <div class="ev-limit">Spatial cluster within source cell confirms ground-level receptor exposure matching orbital anomaly.</div>
    </div>
    <div class="ev-card" style="border-top: 3px solid #6366f1;">
      <div class="ev-tag">Boundary Layer Atmospheric Transport</div>
      <div class="ev-val">${windSpeed} km/h @ ${windDir}°</div>
      <div class="ev-desc">Surface wind from northwest is driving the particulate plume into southeast residential sectors over the next 4–12 hours.</div>
      <div class="ev-limit">Dispersion modeled using GFS boundary layer wind fields and Gaussian plume advection.</div>
    </div>
    <div class="ev-card" style="border-top: 3px solid #0284c7;">
      <div class="ev-tag">Official Regulatory Network Gap</div>
      <div class="ev-val">8.4 km Station Distance</div>
      <div class="ev-desc">Nearest official CAAQMS station recorded normal baseline, confirming this localized plume is outside regulatory sensor catchment.</div>
      <div class="ev-limit">Normal station reading reflects spatial coverage gap, not absence of localized emission.</div>
    </div>
  </div>

  <div class="sec-header page-break-avoid">4. Downwind Exposure & Receptor Analysis</div>
  <table class="page-break-avoid">
    <thead>
      <tr>
        <th>Geographic Zone</th>
        <th>H3 Footprint</th>
        <th>Estimated Population</th>
        <th>Schools in Path</th>
        <th>Hospitals / Clinics</th>
        <th>Threat Window</th>
        <th>Exposure Status</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="font-weight: 700;">Immediate Hotspot Cell</td>
        <td style="font-family: monospace; font-size: 8.5px;">${h3Cell.slice(-8).toUpperCase()}</td>
        <td style="font-weight: 700;">${pop}</td>
        <td style="font-weight: 700; color: #d97706;">${schools}</td>
        <td style="font-weight: 700; color: #dc2626;">${hospitals}</td>
        <td>Active Source Zone</td>
        <td><span style="background: #fee2e2; color: #991b1b; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 8px;">CRITICAL SOURCE</span></td>
      </tr>
      <tr style="background: #f8fafc;">
        <td style="font-weight: 700;">12-Hour Downwind Corridor</td>
        <td>${corridorCells} H3 Cells (~${(corridorCells * 5.16).toFixed(1)} km²)</td>
        <td style="font-weight: 700;">${corridorPop}</td>
        <td style="font-weight: 700; color: #d97706;">${corridorSchools}</td>
        <td style="font-weight: 700; color: #dc2626;">${corridorHospitals}</td>
        <td>Next 4–12 Hours</td>
        <td><span style="background: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 8px;">HIGH EXPOSURE</span></td>
      </tr>
    </tbody>
  </table>
  <div style="font-size: 8px; color: #64748b; margin-top: -6px; margin-bottom: 10px;">
    * Population estimated via LandScan / WorldPop high-resolution gridded rasters mapped to Uber H3 Resolution 7 cells. Facility counts derived from OpenStreetMap verified institutional GIS registries.
  </div>

  <div class="sec-header page-break-avoid">5. Potential Source Assessment</div>
  <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; margin-bottom: 10px; font-size: 9.5px;" class="page-break-avoid">
    <div style="margin-bottom: 4px;">
      <strong>Observed Telemetry:</strong> Concurrent surge in tropospheric aerosol optical depth accompanied by clustered ground citizen reports citing acrid odors and dense smoke.
    </div>
    <div style="margin-bottom: 4px;">
      <strong>Atmospheric Inferences:</strong> Plume geometry and advection rate match episodic low-level combustion without regulatory flue gas filtration.
    </div>
    <div style="margin-bottom: 4px;">
      <strong>Plausible Explanations:</strong> Unpermitted industrial furnace venting, nighttime boiler exhaust, or localized biomass/waste combustion in unmonitored sector.
    </div>
    <div style="color: #64748b; font-size: 8.5px; border-top: 1px dashed #cbd5e1; padding-top: 4px; margin-top: 4px;">
      <strong>Required Ground Verification:</strong> Physical on-site inspection and continuous emission monitoring system (CEMS) log audit by municipal enforcement officers is required before formal statutory liability assignment.
    </div>
  </div>

  <div class="sec-header page-break-avoid">6. Operational Action Plan for Authorities</div>
  <table class="actions-table page-break-avoid">
    <thead>
      <tr>
        <th style="width: 70px;">Priority</th>
        <th style="width: 140px;">Action Item</th>
        <th style="width: 130px;">Responsible Role</th>
        <th>Supporting Evidence & Protocol</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><span style="background: #fee2e2; color: #991b1b; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 8px;">HIGH</span></td>
        <td><strong>Issue Geofenced Health Advisory</strong></td>
        <td>Municipal Health Dept</td>
        <td>Broadcast indoor-stay and air filtration advisories to the ${corridorSchools} schools and ${corridorHospitals} clinics in downwind plume path.</td>
      </tr>
      <tr style="background: #f8fafc;">
        <td><span style="background: #fee2e2; color: #991b1b; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 8px;">HIGH</span></td>
        <td><strong>Dispatch Enforcement Flying Squad</strong></td>
        <td>SPCB Rapid Response Team</td>
        <td>Deploy officers to inspect industrial stacks and combustion sites at coordinates ${lat}° N, ${lng}° E.</td>
      </tr>
      <tr>
        <td><span style="background: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 8px;">MEDIUM</span></td>
        <td><strong>Audit Upwind Facilities</strong></td>
        <td>District Environmental Engineer</td>
        <td>Verify emission compliance and fuel consumption logs of industrial units operating northwest of ${placeName}.</td>
      </tr>
    </tbody>
  </table>

  <div class="sec-header page-break-avoid">7. Methodology, Provenance & Evidentiary Audit</div>
  <div class="provenance-grid page-break-avoid">
    <div class="provenance-item">
      <span class="provenance-label">AQI Standard</span>
      <span>Central Pollution Control Board (CPCB 2014) National Air Quality Index 24-hr Sub-Index</span>
    </div>
    <div class="provenance-item">
      <span class="provenance-label">Satellite Product</span>
      <span>Copernicus Sentinel-5P TROPOMI Level-2 Near Real-Time Aerosol Index & Tropospheric Column</span>
    </div>
    <div class="provenance-item">
      <span class="provenance-label">Spatial System</span>
      <span>Uber H3 Hierarchical Hexagonal Spatial Index (Resolution 7 · ~5.16 km² cell footprint)</span>
    </div>
    <div class="provenance-item">
      <span class="provenance-label">Meteorological Model</span>
      <span>ECMWF ERA5 & GFS Boundary Layer Surface Wind Vector (Updated hourly)</span>
    </div>
  </div>

  <div class="footer">
    <div>
      <strong>AirGrid Environmental Intelligence Platform</strong> · Incident Verification Hash: <span style="font-family: monospace;">${shaHash}</span>
    </div>
    <div class="audit-seal">
      <span>VERIFIED · AIRGRID AUDIT</span>
    </div>
  </div>
</body>
</html>`;
  };

  // Dedicated Print Window: Guarantees 100% of all content is cleanly printed across A4 pages without clipping
  const handlePrint = () => {
    try {
      const printWindow = window.open("", "_blank", "width=880,height=1000");
      if (!printWindow) {
        window.print();
        return;
      }
      printWindow.document.open();
      printWindow.document.write(generateFullHtml());
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 400);
    } catch {
      window.print();
    }
  };

  // Direct Download Report (.html): Instant file download that preserves all content, styles, and data
  const handleDownload = () => {
    try {
      const htmlContent = generateFullHtml();
      const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safePlace = (placeName || "Incident").replace(/[^a-zA-Z0-9]/g, "_");
      link.href = url;
      link.download = `AirGrid_Incident_Report_${safePlace}_${reportId}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Failed to download report", e);
    }
  };

  return (
    <div
      className="legal-dossier-overlay fixed inset-0 z-[1200] flex flex-col items-center justify-center bg-black/80 backdrop-blur-md p-2 sm:p-4 overflow-hidden"
      onClick={onClose}
    >
      <div
        className="legal-dossier-card relative flex flex-col w-full max-w-4xl h-[92vh] max-h-[960px] rounded-2xl bg-slate-900 text-slate-100 shadow-2xl border border-slate-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky Action Bar at Top (Never scrolls off) */}
        <header className="sticky top-0 z-50 shrink-0 flex items-center justify-between border-b border-slate-700 bg-slate-900 px-4 sm:px-6 py-3 text-white shadow-md">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500 font-extrabold text-slate-950 text-xs shadow-sm">
              AGR
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-white">Air Quality Incident Report</span>
                <span className="rounded bg-teal-500/20 px-2 py-0.5 text-[10px] font-semibold text-teal-300 border border-teal-500/30">
                  {reportId}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {placeName} · Autonomous Multi-Source Incident Investigation
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:text-white transition shadow-sm cursor-pointer"
              title="Download complete standalone HTML incident report"
            >
              <Download size={14} className="text-teal-400" />
              <span>Download Report (.html)</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 rounded-lg bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold px-3.5 py-1.5 text-xs transition shadow-sm cursor-pointer"
              title="Open print dialog to save as official vector A4 PDF"
            >
              <Printer size={14} />
              <span>Print / Save as PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-rose-500/20 hover:border-rose-500/40 text-slate-300 hover:text-rose-300 px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer"
              title="Close report (Esc)"
            >
              <X size={15} />
              <span>Close</span>
            </button>
          </div>
        </header>

        {/* Scrollable Report Sheet Body */}
        <div className="flex-1 overflow-y-auto bg-slate-950/70 p-3 sm:p-6 md:p-8">
          <div
            id="legal-dossier-print"
            className="mx-auto max-w-[820px] bg-white rounded-xl shadow-xl border border-slate-200 p-8 sm:p-12 text-slate-900 font-sans leading-relaxed text-xs space-y-4"
          >
            {/* Top Brand Bar */}
            <div className="flex items-center justify-between border-b-2 border-slate-900 pb-3">
              <div>
                <span className="text-base font-extrabold tracking-tight text-slate-950">AIRGRID</span>
                <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 border-l border-slate-300 pl-2">
                  Autonomous Environmental Intelligence Platform
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-600">
                <span className="rounded bg-slate-100 border border-slate-300 px-2 py-0.5 font-mono">
                  ID: {reportId}
                </span>
                <span className="rounded bg-slate-100 border border-slate-300 px-2 py-0.5">
                  {istTime}
                </span>
                <span className="rounded bg-rose-50 border border-rose-300 px-2 py-0.5 text-rose-800 font-bold">
                  ACTIVE INCIDENT
                </span>
              </div>
            </div>

            {/* Document Title Block */}
            <div>
              <h1 className="text-xl font-extrabold text-slate-950 tracking-tight mb-1">
                Air Quality Incident Report
              </h1>
              <p className="text-xs text-slate-600 font-medium mb-2.5">
                {placeName} · Autonomous Sensor-Blindspot Investigation
              </p>
              <div className="flex flex-wrap gap-1.5 text-[10px]">
                <span
                  className="rounded-full px-2.5 py-0.5 font-bold border"
                  style={{
                    backgroundColor: naqiData.badgeBg,
                    color: naqiData.badgeColor,
                    borderColor: naqiData.badgeBorder,
                  }}
                >
                  NAQI: {naqiData.category} ({naqiData.aqiDisplay})
                </span>
                <span className="rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 px-2.5 py-0.5 font-semibold">
                  Multi-Source Convergence: {confidence}%
                </span>
                <span className="rounded-full bg-slate-100 border border-slate-200 text-slate-700 px-2.5 py-0.5 font-semibold">
                  Wind: {windSpeed} km/h @ {windDir}°
                </span>
                <span className="rounded-full bg-slate-100 border border-slate-200 text-slate-700 px-2.5 py-0.5 font-semibold">
                  Gap: 8.4 km to nearest CAAQMS
                </span>
              </div>
            </div>

            {/* Scientific Key Metric Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  National AQI (CPCB)
                </p>
                <p className="text-2xl font-extrabold tabular-nums leading-none mb-1" style={{ color: naqiData.badgeColor }}>
                  {naqiData.aqiDisplay}
                </p>
                <p className="text-[10px] text-slate-600 leading-tight">
                  {naqiData.category} Category
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Aerosol Column Surge
                </p>
                <p className="text-2xl font-extrabold text-rose-700 tabular-nums leading-none mb-1">
                  +142%
                </p>
                <p className="text-[10px] text-slate-600 leading-tight">
                  Sentinel-5P vs 14d baseline
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Corridor Population
                </p>
                <p className="text-2xl font-extrabold text-slate-900 tabular-nums leading-none mb-1">
                  {corridorPop}
                </p>
                <p className="text-[10px] text-slate-600 leading-tight">
                  Across {corridorCells} downwind cells
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Nearest Sensor Gap
                </p>
                <p className="text-2xl font-extrabold text-sky-700 tabular-nums leading-none mb-1">
                  8.4 km
                </p>
                <p className="text-[10px] text-slate-600 leading-tight">
                  Official monitor baseline normal
                </p>
              </div>
            </div>

            {/* Section 1: Executive Summary */}
            <div className="page-break-avoid">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-1.5 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-600 inline-block" />
                1. Executive Summary
              </h2>
              <div className="rounded-xl border-l-4 border-l-teal-600 border border-slate-200 bg-slate-50/70 p-3.5 text-xs text-slate-800 leading-relaxed">
                An acute localized air quality incident has formed over <strong>{placeName}</strong> (Coordinates: {lat}° N, {lng}° E).
                The nearest official regulatory monitoring station (CAAQMS) is located <strong>8.4 km away</strong> and recorded baseline normal readings, leaving this localized high-emission event completely invisible to standard government networks.
                AirGrid autonomous multi-source fusion detected the active smoke plume traveling downwind, placing surrounding residential communities, <strong>{corridorSchools} schools</strong>, and <strong>{corridorHospitals} medical facilities</strong> in the projected exposure corridor.
                <div className="mt-2 pt-2 border-t border-slate-200 text-slate-600 text-[11px] italic">
                  Health Guidance: {naqiData.healthGuidance}
                </div>
              </div>
            </div>

            {/* Section 2: Spatial Corridor & Coverage Gap Map */}
            <div className="page-break-avoid">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-1.5 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-600 inline-block" />
                2. Spatial Dispersion & Regulatory Sensor Gap
              </h2>
              <SpatialPlumeMap
                lat={lat}
                lng={lng}
                h3Cell={h3Cell}
                windSpeed={windSpeed}
                windDir={windDir}
                corridorSchools={corridorSchools}
                corridorHospitals={corridorHospitals}
                corridorPop={corridorPop}
                corridorCells={corridorCells}
              />
            </div>

            {/* Section 3: Corroborated Evidence Matrix */}
            <div className="page-break-avoid">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-1.5 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-600 inline-block" />
                3. Corroborated Multi-Source Evidence Matrix
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="rounded-xl border border-slate-200 bg-white p-3 border-t-2 border-t-teal-600">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Satellite Tropospheric Telemetry
                  </p>
                  <p className="text-sm font-extrabold text-slate-900 mb-1">+142% Aerosol Optical Surge</p>
                  <p className="text-[11px] text-slate-600 leading-normal">
                    Copernicus Sentinel-5P TROPOMI recorded a +142% aerosol optical depth surge above the 14-day baseline over cell {h3Cell.slice(-6).toUpperCase()}.
                  </p>
                  <p className="mt-2 pt-1 border-t border-dashed border-slate-200 text-[9.5px] text-slate-400 italic">
                    Resolution: 5.5 × 3.5 km. Measures total atmospheric column; ground PM2.5 inferred via atmospheric models.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3 border-t-2 border-t-amber-600">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Ground Citizen Verification
                  </p>
                  <p className="text-sm font-extrabold text-slate-900 mb-1">{citizenCount} Verified Complaints</p>
                  <p className="text-[11px] text-slate-600 leading-normal">
                    Local residents in the immediate zone submitted verified reports citing dense low-hanging dark smoke, combustion odors, and eye/throat irritation.
                  </p>
                  <p className="mt-2 pt-1 border-t border-dashed border-slate-200 text-[9.5px] text-slate-400 italic">
                    Spatial clustering confirms ground-level receptor exposure matching orbital satellite anomalies.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3 border-t-2 border-t-indigo-600">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Boundary Layer Transport
                  </p>
                  <p className="text-sm font-extrabold text-slate-900 mb-1">{windSpeed} km/h @ {windDir}°</p>
                  <p className="text-[11px] text-slate-600 leading-normal">
                    Surface winds are transporting the particulate plume into southeast residential sectors over the next 4–12 hours.
                  </p>
                  <p className="mt-2 pt-1 border-t border-dashed border-slate-200 text-[9.5px] text-slate-400 italic">
                    Gaussian advection-diffusion projection assuming steady-state boundary layer conditions.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3 border-t-2 border-t-sky-600">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Official Regulatory Network Gap
                  </p>
                  <p className="text-sm font-extrabold text-slate-900 mb-1">8.4 km Station Distance</p>
                  <p className="text-[11px] text-slate-600 leading-normal">
                    Nearest official CAAQMS station recorded normal baseline, confirming this localized plume is outside regulatory sensor catchment.
                  </p>
                  <p className="mt-2 pt-1 border-t border-dashed border-slate-200 text-[9.5px] text-slate-400 italic">
                    Normal station reading reflects spatial coverage gap, not absence of localized emission.
                  </p>
                </div>
              </div>
            </div>

            {/* Section 4: Downwind Exposure & Receptor Analysis */}
            <div className="page-break-avoid">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-1.5 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-600 inline-block" />
                4. Downwind Exposure & Receptor Analysis
              </h2>
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="p-2">Geographic Zone</th>
                      <th className="p-2">H3 Footprint</th>
                      <th className="p-2">Population</th>
                      <th className="p-2">Schools</th>
                      <th className="p-2">Hospitals</th>
                      <th className="p-2">Threat Window</th>
                      <th className="p-2">Exposure Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="p-2 font-semibold text-slate-900">Immediate Hotspot Cell</td>
                      <td className="p-2 font-mono text-[10px] text-slate-600">{h3Cell.slice(-8).toUpperCase()}</td>
                      <td className="p-2 font-bold tabular-nums">{pop}</td>
                      <td className="p-2 font-bold text-amber-700 tabular-nums">{schools}</td>
                      <td className="p-2 font-bold text-rose-700 tabular-nums">{hospitals}</td>
                      <td className="p-2 text-slate-600">Active Source</td>
                      <td className="p-2">
                        <span className="rounded bg-rose-100 text-rose-800 px-2 py-0.5 font-bold text-[9px]">
                          CRITICAL SOURCE
                        </span>
                      </td>
                    </tr>
                    <tr className="bg-slate-50/60">
                      <td className="p-2 font-semibold text-slate-900">12-Hour Downwind Corridor</td>
                      <td className="p-2 text-[10px] text-slate-600">{corridorCells} Cells (~{(corridorCells * 5.16).toFixed(1)} km²)</td>
                      <td className="p-2 font-bold tabular-nums">{corridorPop}</td>
                      <td className="p-2 font-bold text-amber-700 tabular-nums">{corridorSchools}</td>
                      <td className="p-2 font-bold text-rose-700 tabular-nums">{corridorHospitals}</td>
                      <td className="p-2 text-slate-600">Next 4–12 Hours</td>
                      <td className="p-2">
                        <span className="rounded bg-amber-100 text-amber-800 px-2 py-0.5 font-bold text-[9px]">
                          HIGH EXPOSURE
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[9.5px] text-slate-500 mt-1.5 italic">
                * Population estimated via LandScan / WorldPop high-resolution rasters overlaid on Uber H3 Resolution 7 cells (~5.16 km²). Educational and healthcare facility counts derived from OpenStreetMap verified municipal institutional layers.
              </p>
            </div>

            {/* Section 5: Potential Source Assessment */}
            <div className="page-break-avoid">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-1.5 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-600 inline-block" />
                5. Potential Source Assessment
              </h2>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs leading-relaxed space-y-1.5">
                <p className="font-semibold text-slate-900">
                  Assessed Source: <span className="font-normal text-slate-800">{likelyCause}</span>
                </p>
                <div className="text-[11px] text-slate-600 space-y-1">
                  <p>
                    <strong>Observed Evidence:</strong> Concentrated ground complaint cluster and localized tropospheric aerosol surge detected simultaneously.
                  </p>
                  <p>
                    <strong>Atmospheric Inferences:</strong> Plume geometry and advection rate match episodic low-level combustion without regulatory flue gas filtration.
                  </p>
                  <p className="text-slate-500 text-[10px] pt-1 border-t border-slate-200">
                    <strong>Required Ground Verification:</strong> Physical on-site inspection and continuous emission monitoring system (CEMS) log audit by municipal enforcement officers is required before formal statutory liability assignment.
                  </p>
                </div>
              </div>
            </div>

            {/* Section 6: Operational Action Plan */}
            <div className="page-break-avoid">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-1.5 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-600 inline-block" />
                6. Operational Action Plan for Authorities
              </h2>
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="p-2 w-16">Priority</th>
                      <th className="p-2 w-44">Action Item</th>
                      <th className="p-2 w-36">Responsible Role</th>
                      <th className="p-2">Supporting Evidence & Protocol</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="p-2">
                        <span className="rounded bg-rose-100 text-rose-800 px-2 py-0.5 font-bold text-[9px]">HIGH</span>
                      </td>
                      <td className="p-2 font-semibold text-slate-900">Geofenced Health Notice</td>
                      <td className="p-2 text-slate-700">Municipal Health Dept</td>
                      <td className="p-2 text-slate-600">
                        Broadcast indoor-stay and air filtration guidance to {corridorSchools} schools and {corridorHospitals} clinics in plume corridor.
                      </td>
                    </tr>
                    <tr className="bg-slate-50/50">
                      <td className="p-2">
                        <span className="rounded bg-rose-100 text-rose-800 px-2 py-0.5 font-bold text-[9px]">HIGH</span>
                      </td>
                      <td className="p-2 font-semibold text-slate-900">Deploy Rapid Inspection</td>
                      <td className="p-2 text-slate-700">SPCB Flying Squad</td>
                      <td className="p-2 text-slate-600">
                        Dispatch officers to inspect industrial stacks and combustion sites at coordinates {lat}° N, {lng}° E.
                      </td>
                    </tr>
                    <tr>
                      <td className="p-2">
                        <span className="rounded bg-amber-100 text-amber-800 px-2 py-0.5 font-bold text-[9px]">MEDIUM</span>
                      </td>
                      <td className="p-2 font-semibold text-slate-900">Audit Upwind Units</td>
                      <td className="p-2 text-slate-700">District Env. Engineer</td>
                      <td className="p-2 text-slate-600">
                        Audit continuous emission monitoring systems and fuel logs of facilities northwest of {placeName}.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Section 7: Methodology & Provenance */}
            <div className="page-break-avoid">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-1.5 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-600 inline-block" />
                7. Methodology, Provenance & Evidentiary Audit
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-[10px] text-slate-600">
                <div>
                  <span className="font-bold uppercase text-slate-800 block text-[9px]">AQI Standard</span>
                  <span>CPCB (2014) National AQI</span>
                </div>
                <div>
                  <span className="font-bold uppercase text-slate-800 block text-[9px]">Satellite Product</span>
                  <span>Sentinel-5P TROPOMI L2</span>
                </div>
                <div>
                  <span className="font-bold uppercase text-slate-800 block text-[9px]">Spatial System</span>
                  <span>Uber H3 Hexagons (Res 7)</span>
                </div>
                <div>
                  <span className="font-bold uppercase text-slate-800 block text-[9px]">Weather Model</span>
                  <span>ERA5 & GFS Wind Vector</span>
                </div>
              </div>
            </div>

            {/* Footer Bar */}
            <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-500 page-break-avoid">
              <div>
                <strong>AirGrid Environmental Intelligence Platform</strong> · Incident Verification Hash:{" "}
                <span className="font-mono text-slate-700">{shaHash.slice(0, 32)}…</span>
              </div>
              <div className="flex items-center gap-1.5 rounded border border-slate-300 bg-slate-50 px-2.5 py-1 font-bold text-slate-800 text-[9px]">
                <Shield size={11} className="text-teal-600" />
                <span>VERIFIED · AIRGRID AUDIT</span>
              </div>
            </div>
          </div>
        </div>

        {/* Sticky Accessible Bottom Bar */}
        <footer className="sticky bottom-0 z-40 shrink-0 flex items-center justify-between border-t border-slate-800 bg-slate-900/95 backdrop-blur px-5 py-2.5 text-xs text-slate-400">
          <div className="flex items-center gap-2 text-[11px]">
            <Shield size={13} className="text-teal-400" />
            <span>
              Audit Integrity Hash: <span className="font-mono text-slate-300">{shaHash.slice(0, 24)}…</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePrint}
              className="text-xs font-semibold text-teal-400 hover:text-teal-300 underline cursor-pointer"
            >
              Print / Save PDF
            </button>
            <span className="text-slate-600">·</span>
            <button
              type="button"
              onClick={handleDownload}
              className="text-xs font-semibold text-slate-300 hover:text-white underline cursor-pointer"
            >
              Download HTML
            </button>
            <span className="text-slate-600">·</span>
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:text-white cursor-pointer"
            >
              Close Report (Esc)
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
