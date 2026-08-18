import { useState } from "react";
import { CheckCircle2, Loader2, MessageSquare, TrendingUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { SEVERITY, SEVERITY_ORDER } from "../lib/severity";

export default function AlertQueue({ hotspots, selectedCell, onSelectCell, onAcknowledge }) {
  const sorted = [...hotspots].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  );

  return (
    <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] flex flex-col max-h-[560px]">
      <div className="px-5 pt-5 pb-3 border-b border-[var(--color-ink-700)]">
        <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--color-mist-50)]">
          Alert queue
        </h2>
        <p className="text-xs text-[var(--color-mist-400)] mt-0.5">
          {sorted.length} active cell{sorted.length === 1 ? "" : "s"}, ranked by urgency
        </p>
      </div>

      <div className="overflow-y-auto flex-1 divide-y divide-[var(--color-ink-700)]">
        {sorted.map((h) => (
          <AlertRow
            key={h.h3_cell}
            hotspot={h}
            selected={selectedCell === h.h3_cell}
            onSelect={() => onSelectCell(h.h3_cell)}
            onAcknowledge={onAcknowledge}
          />
        ))}
        {sorted.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-[var(--color-mist-400)]">
            No active alerts.
          </p>
        )}
      </div>
    </div>
  );
}

function AlertRow({ hotspot, selected, onSelect, onAcknowledge }) {
  const [expanded, setExpanded] = useState(false);
  const [recommendation, setRecommendation] = useState(null);
  const [loadingRec, setLoadingRec] = useState(false);
  const [forecastData, setForecastData] = useState(null);
  const [loadingForecast, setLoadingForecast] = useState(false);
  const [action, setAction] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const sev = SEVERITY[hotspot.severity] ?? SEVERITY.unverified;

  async function handleExpand() {
    const next = !expanded;
    setExpanded(next);
    onSelect();
    if (next && !recommendation) {
      setLoadingRec(true);
      try {
        const res = await fetch(`/api/hotspots/${hotspot.h3_cell}/recommendation`);
        const data = await res.json();
        setRecommendation(data.recommendation);
      } catch {
        setRecommendation("Could not reach the recommendation service.");
      } finally {
        setLoadingRec(false);
      }
    }
    if (next && !forecastData) {
      setLoadingForecast(true);
      try {
        const res = await fetch(`/api/forecast/${hotspot.h3_cell}?hours=12`);
        const data = await res.json();
        setForecastData(
          data.predictions.map((p) => ({
            time: new Date(p.timestamp).toLocaleTimeString([], { hour: "2-digit" }),
            pm25: p.predicted_pm25,
          }))
        );
      } catch {
        setForecastData([]);
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

  return (
    <div className={`px-5 py-3 ${selected ? "bg-[var(--color-ink-800)]" : ""}`}>
      <button
        onClick={handleExpand}
        className="w-full flex items-center gap-3 text-left"
      >
        <span
          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: sev.color }}
        />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-[var(--color-mist-50)]">
            {sev.label}
          </span>
          <span className="block font-[family-name:var(--font-mono)] text-xs text-[var(--color-mist-400)] truncate">
            {hotspot.h3_cell}
            {hotspot.aqi_estimate != null && ` · ~${Math.round(hotspot.aqi_estimate)} µg/m³`}
          </span>
        </span>
        {acknowledged && (
          <CheckCircle2 size={16} className="text-[var(--color-clear-400)] shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="mt-3 pl-5.5 space-y-3">
          <p className="text-sm text-[var(--color-mist-200)]">{hotspot.explanation}</p>

          <div className="rounded-lg bg-[var(--color-ink-800)] px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs text-[var(--color-clear-400)] mb-2">
              <TrendingUp size={12} />
              12h forecast
            </div>
            {loadingForecast ? (
              <div className="flex items-center gap-2 text-xs text-[var(--color-mist-400)] h-16">
                <Loader2 size={12} className="animate-spin" /> Forecasting…
              </div>
            ) : forecastData && forecastData.length > 0 ? (
              <ResponsiveContainer width="100%" height={80}>
                <LineChart data={forecastData} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                  <XAxis
                    dataKey="time"
                    tick={{ fill: "var(--color-mist-400)", fontSize: 10 }}
                    axisLine={{ stroke: "var(--color-ink-600)" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "var(--color-mist-400)", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={32}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-ink-900)",
                      border: "1px solid var(--color-ink-600)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "var(--color-mist-200)" }}
                    formatter={(value) => [`${value} µg/m³`, "PM2.5"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="pm25"
                    stroke="var(--color-clear-400)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-[var(--color-mist-400)]">Forecast unavailable for this cell.</p>
            )}
          </div>

          <div className="rounded-lg bg-[var(--color-ink-800)] px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs text-[var(--color-clear-400)] mb-1">
              <MessageSquare size={12} />
              Recommended action
            </div>
            {loadingRec ? (
              <div className="flex items-center gap-2 text-xs text-[var(--color-mist-400)]">
                <Loader2 size={12} className="animate-spin" /> Generating brief…
              </div>
            ) : (
              <p className="text-sm text-[var(--color-mist-200)]">{recommendation}</p>
            )}
          </div>

          {!acknowledged ? (
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
          ) : (
            <p className="text-xs text-[var(--color-clear-400)] flex items-center gap-1.5">
              <CheckCircle2 size={12} /> Acknowledged — action logged
            </p>
          )}
        </div>
      )}
    </div>
  );
}
