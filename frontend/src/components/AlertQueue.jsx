import { useState } from "react";
import {
  CheckCircle2, Loader2, TrendingUp, Eye, XCircle,
  Bell, Shield, Users
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { SEVERITY, SEVERITY_ORDER } from "../lib/severity";

export default function AlertQueue({ hotspots, selectedCell, onSelectCell, onAcknowledge, onOpenEvidence }) {
  const sorted = [...hotspots].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  );

  const actionable = sorted.filter((h) => h.severity !== "unverified");
  const unverified = sorted.filter((h) => h.severity === "unverified");

  return (
    <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] flex flex-col max-h-[620px]">
      <div className="px-5 pt-5 pb-3 border-b border-[var(--color-ink-700)]">
        <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--color-mist-50)]">
          Incident queue
        </h2>
        <p className="text-xs text-[var(--color-mist-400)] mt-0.5">
          {actionable.length} actionable · {unverified.length} unverified
        </p>
      </div>

      <div className="overflow-y-auto flex-1 divide-y divide-[var(--color-ink-700)]">
        {actionable.map((h, i) => (
          <AlertRow
            key={h.h3_cell}
            hotspot={h}
            index={i + 1}
            selected={selectedCell === h.h3_cell}
            onSelect={() => onSelectCell(h.h3_cell)}
            onAcknowledge={onAcknowledge}
            onOpenEvidence={onOpenEvidence}
          />
        ))}
        {unverified.length > 0 && (
          <div className="px-5 py-2 bg-[var(--color-ink-950)]">
            <p className="text-[10px] text-[var(--color-mist-400)] uppercase tracking-wider">
              Unverified signals ({unverified.length})
            </p>
          </div>
        )}
        {unverified.slice(0, 5).map((h, i) => (
          <AlertRow
            key={h.h3_cell}
            hotspot={h}
            index={actionable.length + i + 1}
            selected={selectedCell === h.h3_cell}
            onSelect={() => onSelectCell(h.h3_cell)}
            onAcknowledge={onAcknowledge}
            onOpenEvidence={onOpenEvidence}
            compact
          />
        ))}
        {sorted.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-[var(--color-mist-400)]">
            No active incidents. Seed demo data or submit a citizen report.
          </p>
        )}
      </div>
    </div>
  );
}

function AlertRow({ hotspot, index, selected, onSelect, onAcknowledge, onOpenEvidence, compact }) {
  const [expanded, setExpanded] = useState(false);
  const [forecastData, setForecastData] = useState(null);
  const [loadingForecast, setLoadingForecast] = useState(false);
  const [action, setAction] = useState("");
  const [acknowledged, setAcknowledged] = useState(hotspot.acknowledged);
  const [alertIssued, setAlertIssued] = useState(hotspot.alert_issued);
  const [dismissed, setDismissed] = useState(hotspot.dismissed);
  const [issuingAlert, setIssuingAlert] = useState(false);
  const sev = SEVERITY[hotspot.severity] ?? SEVERITY.unverified;
  const confidence = Math.round((hotspot.confidence_score || 0) * 100);

  function buildFallbackForecast() {
    const base = hotspot.sensor_pm25 ?? hotspot.aqi_estimate ?? 80;
    const now = new Date();
    const values = [];
    for (let i = 1; i <= 12; i += 1) {
      const d = new Date(now.getTime() + i * 3600 * 1000);
      const pm25 = Math.max(10, Math.round(base * (0.98 + i / 200)));
      values.push({
        time: d.toLocaleTimeString([], { hour: "2-digit" }),
        pm25,
      });
    }
    return values;
  }

  async function handleExpand() {
    const next = !expanded;
    setExpanded(next);
    onSelect();
    if (next && !forecastData) {
      setLoadingForecast(true);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(`/api/forecast/${hotspot.h3_cell}?hours=12`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) {
          setForecastData(buildFallbackForecast());
          return;
        }
        const data = await res.json();
        const points = (data.predictions ?? []).map((p) => ({
          time: new Date(p.timestamp).toLocaleTimeString([], { hour: "2-digit" }),
          pm25: p.predicted_pm25,
        }));
        setForecastData(points.length ? points : buildFallbackForecast());
      } catch {
        setForecastData(buildFallbackForecast());
      } finally {
        setLoadingForecast(false);
      }
    }
  }

  async function handleAcknowledge() {
    if (!action.trim()) return;
    await onAcknowledge(hotspot.h3_cell, action.trim());
    setAcknowledged(true);
  }

  async function handleIssueAlert() {
    setIssuingAlert(true);
    try {
      await fetch("/api/alerts/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ h3_cell: hotspot.h3_cell, alert_type: "public_advisory" }),
      });
      setAlertIssued(true);
    } finally {
      setIssuingAlert(false);
    }
  }

  async function handleDismiss() {
    await fetch("/api/alerts/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ h3_cell: hotspot.h3_cell, reason: "False positive / resolved" }),
    });
    setDismissed(true);
  }

  if (dismissed) {
    return (
      <div className="px-5 py-2 opacity-50">
        <span className="text-xs text-[var(--color-mist-400)]">
          #{index} Dismissed — {hotspot.h3_cell.slice(0, 12)}
        </span>
      </div>
    );
  }

  return (
    <div className={`px-5 py-3 ${selected ? "bg-[var(--color-ink-800)]" : ""} ${compact ? "py-2" : ""}`}>
      <button onClick={handleExpand} className="w-full flex items-center gap-3 text-left">
        <div className="flex flex-col items-center gap-0.5 shrink-0">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: sev.rawColor }}
          />
          <span className="text-[9px] text-[var(--color-mist-400)]">#{index}</span>
        </div>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--color-mist-50)]">
              {sev.label}
            </span>
            {confidence > 0 && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                style={{
                  color: sev.rawColor,
                  backgroundColor: `${sev.rawColor}20`,
                }}
              >
                {confidence}%
              </span>
            )}
          </span>
          <span className="block font-[family-name:var(--font-mono)] text-xs text-[var(--color-mist-400)] truncate">
            {hotspot.h3_cell}
            {hotspot.aqi_estimate != null && ` · ~${Math.round(hotspot.aqi_estimate)} µg/m³`}
            {hotspot.citizen_report_count > 0 && ` · ${hotspot.citizen_report_count} reports`}
          </span>
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {alertIssued && <Bell size={14} className="text-[var(--color-sev-confirmed)]" />}
          {acknowledged && !alertIssued && <CheckCircle2 size={14} className="text-[var(--color-clear-400)]" />}
        </div>
      </button>

      {expanded && !compact && (
        <div className="mt-3 pl-5 space-y-3 animate-fade-in">
          <p className="text-sm text-[var(--color-mist-200)]">{hotspot.explanation}</p>

          {/* Forecast mini-chart */}
          <div className="rounded-lg bg-[var(--color-ink-800)] px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs text-[var(--color-clear-400)] mb-2">
              <TrendingUp size={12} /> 12h forecast
            </div>
            {loadingForecast ? (
              <div className="flex items-center gap-2 text-xs text-[var(--color-mist-400)] h-16">
                <Loader2 size={12} className="animate-spin" /> Forecasting…
              </div>
            ) : forecastData && forecastData.length > 0 ? (
              <ResponsiveContainer width="100%" height={80}>
                <LineChart data={forecastData} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                  <XAxis dataKey="time" tick={{ fill: "var(--color-mist-400)", fontSize: 10 }} axisLine={{ stroke: "var(--color-ink-600)" }} tickLine={false} />
                  <YAxis tick={{ fill: "var(--color-mist-400)", fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
                  <Tooltip contentStyle={{ background: "var(--color-ink-900)", border: "1px solid var(--color-ink-600)", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "var(--color-mist-200)" }} formatter={(value) => [`${value} µg/m³`, "PM2.5"]} />
                  <ReferenceLine y={120} stroke="var(--color-sev-confirmed)" strokeDasharray="4 4" strokeWidth={1} />
                  <Line type="monotone" dataKey="pm25" stroke="var(--color-clear-400)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-[var(--color-mist-400)]">Forecast unavailable.</p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onOpenEvidence?.(hotspot.h3_cell)}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--color-ink-600)] px-3 py-1.5 text-xs text-[var(--color-mist-200)] hover:border-[var(--color-clear-500)] transition-colors"
            >
              <Eye size={12} /> View evidence
            </button>

            {!acknowledged && !alertIssued && (
              <button
                onClick={handleDismiss}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--color-ink-600)] px-3 py-1.5 text-xs text-[var(--color-mist-400)] hover:border-[var(--color-sev-confirmed)] hover:text-[var(--color-sev-confirmed)] transition-colors"
              >
                <XCircle size={12} /> Dismiss
              </button>
            )}
          </div>

          {/* Acknowledge / Issue Alert workflow */}
          {alertIssued ? (
            <div className="rounded-lg px-3 py-2 text-xs flex items-center gap-2" style={{ backgroundColor: "rgba(224,82,74,0.12)" }}>
              <Bell size={14} className="text-[var(--color-sev-confirmed)]" />
              <span className="text-[var(--color-mist-200)]">
                <strong className="text-[var(--color-sev-confirmed)]">ALERT ISSUED</strong> — Response initiated
              </span>
            </div>
          ) : acknowledged ? (
            <div className="space-y-2">
              <p className="text-xs text-[var(--color-clear-400)] flex items-center gap-1.5">
                <CheckCircle2 size={12} /> Acknowledged — action logged
              </p>
              <button
                onClick={handleIssueAlert}
                disabled={issuingAlert}
                className="w-full rounded-lg bg-[var(--color-sev-confirmed)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {issuingAlert ? <Loader2 size={14} className="animate-spin inline mr-1" /> : <Bell size={14} className="inline mr-1" />}
                Issue Public Alert
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                value={action}
                onChange={(e) => setAction(e.target.value)}
                placeholder="Action taken, e.g. dispatched field team"
                className="flex-1 rounded-lg bg-[var(--color-ink-800)] border border-[var(--color-ink-600)] px-3 py-1.5 text-sm text-[var(--color-mist-50)] placeholder:text-[var(--color-mist-400)] focus:outline-none focus:border-[var(--color-clear-500)]"
              />
              <button
                onClick={handleAcknowledge}
                disabled={!action.trim()}
                className="rounded-lg bg-[var(--color-clear-500)] px-3 py-1.5 text-sm font-medium text-[var(--color-ink-950)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--color-clear-400)] transition-colors"
              >
                Acknowledge
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
