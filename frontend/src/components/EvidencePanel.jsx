import { useState, useEffect } from "react";
import {
  X, Loader2, CheckCircle2, Shield, TrendingUp, Users, MapPin,
  Wind, AlertTriangle, MessageSquare, School, Hospital
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const EVIDENCE_FETCH_TIMEOUT_MS = 50000;

async function fetchEvidenceWithRetry(h3Cell, attempts = 1) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EVIDENCE_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/hotspots/${h3Cell}/evidence`, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`status ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError || new Error("Failed to load evidence");
}

export default function EvidencePanel({ h3Cell, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!h3Cell) return;
    let cancelled = false;
    setLoading(true);
    fetchEvidenceWithRetry(h3Cell)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [h3Cell]);

  if (!h3Cell) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-[var(--color-ink-900)] border-l border-[var(--color-ink-700)] overflow-y-auto animate-slide-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[var(--color-ink-900)]/95 backdrop-blur border-b border-[var(--color-ink-700)] px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--color-mist-50)]">
              Why this alert?
            </h2>
            <p className="font-[family-name:var(--font-mono)] text-xs text-[var(--color-mist-400)] mt-0.5">
              {h3Cell}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-[var(--color-ink-700)] transition-colors"
          >
            <X size={18} className="text-[var(--color-mist-400)]" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 size={24} className="animate-spin text-[var(--color-clear-400)]" />
            <span className="ml-2 text-[var(--color-mist-400)]">Loading evidence…</span>
          </div>
        ) : !data ? (
          <div className="px-6 py-12 text-center text-[var(--color-mist-400)]">
            Could not load evidence for this cell.
          </div>
        ) : (
          <div className="px-6 py-5 space-y-5">
            {/* Confidence Score Gauge */}
            <ConfidenceGauge score={data.confidence_score} severity={data.severity} />

            {/* Evidence Checklist */}
            <EvidenceChecklist items={data.evidence_checklist} />

            {/* Evidence Breakdown */}
            <EvidenceBreakdown breakdown={data.evidence_breakdown} />

            {/* Impact */}
            {data.impact && <ImpactSection impact={data.impact} corridorImpact={data.corridor_impact} />}

            {/* Weather */}
            {data.weather && <WeatherSection weather={data.weather} />}

            {/* Forecast */}
            {data.forecast && <ForecastSection forecast={data.forecast} spikeInfo={data.spike_info} />}

            {/* Incident Explanation */}
            {data.incident_explanation && <IncidentExplanation explanation={data.incident_explanation} />}

            {/* Recommendation */}
            {data.recommendation && <RecommendationSection rec={data.recommendation} />}
          </div>
        )}
      </div>
    </div>
  );
}


function ConfidenceGauge({ score, severity }) {
  const pct = Math.round((score || 0) * 100);
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (pct / 100) * circumference;
  const color = pct >= 80 ? "var(--color-sev-confirmed)" :
                pct >= 60 ? "var(--color-sev-corroborated)" :
                pct >= 40 ? "var(--color-sev-hidden)" : "var(--color-sev-unverified)";

  return (
    <div className="flex items-center gap-5 rounded-xl bg-[var(--color-ink-800)] p-5">
      <svg width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r="40" fill="none" stroke="var(--color-ink-600)" strokeWidth="6" />
        <circle
          cx="48" cy="48" r="40" fill="none"
          stroke={color} strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="confidence-ring"
          transform="rotate(-90 48 48)"
        />
        <text x="48" y="44" textAnchor="middle" fill={color} fontSize="22" fontWeight="700" fontFamily="var(--font-display)">
          {pct}%
        </text>
        <text x="48" y="60" textAnchor="middle" fill="var(--color-mist-400)" fontSize="9">
          confidence
        </text>
      </svg>
      <div>
        <p className="font-[family-name:var(--font-display)] text-lg text-[var(--color-mist-50)]">
          Hotspot Confidence
        </p>
        <p className="text-xs text-[var(--color-mist-400)] mt-1">
          Evidence-fusion weighted score combining satellite, citizen reports,
          sensor data, weather, and historical baseline.
        </p>
        <p className="text-[10px] text-[var(--color-mist-400)] mt-1 italic">
          Not a calibrated probability — a transparent scoring model.
        </p>
      </div>
    </div>
  );
}


function EvidenceChecklist({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="rounded-xl bg-[var(--color-ink-800)] p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--color-mist-50)] mb-3">
        <Shield size={14} className="text-[var(--color-clear-400)]" />
        Evidence signals
      </h3>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            {item.active ? (
              <CheckCircle2 size={16} className="text-[var(--color-clear-400)] shrink-0 mt-0.5" />
            ) : (
              <div className="w-4 h-4 rounded-full border border-[var(--color-ink-600)] shrink-0 mt-0.5" />
            )}
            <span className={item.active ? "text-[var(--color-mist-200)]" : "text-[var(--color-mist-400)]"}>
              {item.check}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}


function EvidenceBreakdown({ breakdown }) {
  if (!breakdown) return null;
  const entries = Object.entries(breakdown).sort((a, b) => b[1].contribution - a[1].contribution);
  const maxContrib = Math.max(...entries.map(([, v]) => v.contribution), 0.01);

  return (
    <div className="rounded-xl bg-[var(--color-ink-800)] p-4">
      <h3 className="text-sm font-medium text-[var(--color-mist-50)] mb-3">
        Evidence contribution breakdown
      </h3>
      <div className="space-y-2">
        {entries.map(([key, val]) => (
          <div key={key}>
            <div className="flex justify-between text-xs text-[var(--color-mist-400)] mb-1">
              <span>{key.replace(/_/g, " ")}</span>
              <span className="font-[family-name:var(--font-mono)]">
                +{(val.contribution * 100).toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--color-ink-600)]">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${(val.contribution / maxContrib) * 100}%`,
                  backgroundColor: "var(--color-clear-400)",
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function ImpactSection({ impact, corridorImpact }) {
  return (
    <div className="rounded-xl bg-[var(--color-ink-800)] p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--color-mist-50)] mb-3">
        <Users size={14} className="text-[var(--color-prop-near)]" />
        Impact assessment
      </h3>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <StatCard label="Population" value={impact.population?.toLocaleString()} icon={Users} color="var(--color-prop-near)" />
        <StatCard label="Schools" value={impact.schools} icon={School} color="var(--color-sev-corroborated)" />
        <StatCard label="Hospitals" value={impact.hospitals} icon={Hospital} color="var(--color-sev-confirmed)" />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--color-mist-400)]">Impact score</span>
        <span
          className="font-medium px-2 py-0.5 rounded-full text-[10px]"
          style={{
            color: impact.priority === "CRITICAL" ? "var(--color-sev-confirmed)" : "var(--color-sev-corroborated)",
            backgroundColor: impact.priority === "CRITICAL" ? "rgba(224,82,74,0.15)" : "rgba(232,162,61,0.15)",
          }}
        >
          {impact.priority}
        </span>
      </div>
      {corridorImpact && (
        <div className="mt-3 pt-3 border-t border-[var(--color-ink-600)]">
          <p className="text-xs text-[var(--color-mist-400)] mb-1">Predicted exposure corridor</p>
          <div className="flex gap-4 text-xs text-[var(--color-mist-200)]">
            <span>{corridorImpact.total_population_at_risk?.toLocaleString()} people</span>
            <span>{corridorImpact.total_schools} schools</span>
            <span>{corridorImpact.total_hospitals} hospitals</span>
          </div>
        </div>
      )}
    </div>
  );
}


function StatCard({ label, value, icon: Icon, color }) {
  return (
    <div className="rounded-lg bg-[var(--color-ink-900)] p-2.5 text-center">
      <Icon size={14} style={{ color }} className="mx-auto mb-1" />
      <p className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--color-mist-50)]">
        {value}
      </p>
      <p className="text-[10px] text-[var(--color-mist-400)]">{label}</p>
    </div>
  );
}


function WeatherSection({ weather }) {
  const windArrow = weather.wind_direction_deg ?? 0;
  return (
    <div className="rounded-xl bg-[var(--color-ink-800)] p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--color-mist-50)] mb-3">
        <Wind size={14} className="text-[var(--color-clear-400)]" />
        Weather conditions
      </h3>
      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        <div>
          <div className="flex items-center justify-center gap-1 mb-1">
            <Wind size={12} style={{ transform: `rotate(${windArrow}deg)`, color: "var(--color-clear-400)" }} />
          </div>
          <p className="text-[var(--color-mist-200)] font-medium">{weather.wind_speed_kmh} km/h</p>
          <p className="text-[var(--color-mist-400)]">Wind</p>
        </div>
        <div>
          <p className="text-[var(--color-mist-200)] font-medium mb-1">{windArrow}°</p>
          <p className="text-[var(--color-mist-400)]">Direction</p>
        </div>
        <div>
          <p className="text-[var(--color-mist-200)] font-medium mb-1">{weather.temperature_c}°C</p>
          <p className="text-[var(--color-mist-400)]">Temp</p>
        </div>
        <div>
          <p className="text-[var(--color-mist-200)] font-medium mb-1">{weather.humidity_pct}%</p>
          <p className="text-[var(--color-mist-400)]">Humidity</p>
        </div>
      </div>
      {weather.source === "mock" && (
        <p className="text-[10px] text-[var(--color-mist-400)] mt-2 italic">
          Demo weather data — not live observations
        </p>
      )}
    </div>
  );
}


function ForecastSection({ forecast, spikeInfo }) {
  if (!forecast || forecast.length === 0) return null;
  const chartData = forecast.map((p) => ({
    time: new Date(p.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    pm25: p.predicted_pm25,
  }));

  return (
    <div className="rounded-xl bg-[var(--color-ink-800)] p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--color-mist-50)] mb-1">
        <TrendingUp size={14} className="text-[var(--color-clear-400)]" />
        12-hour forecast
      </h3>
      {spikeInfo && (
        <div
          className="rounded-lg px-3 py-2 mb-3 text-xs flex items-center gap-2"
          style={{ backgroundColor: "rgba(224,82,74,0.12)" }}
        >
          <AlertTriangle size={14} className="text-[var(--color-sev-confirmed)]" />
          <span className="text-[var(--color-mist-200)]">
            Predicted spike to <strong className="text-[var(--color-sev-confirmed)]">{spikeInfo.predicted_value} µg/m³</strong> in{" "}
            <strong className="text-[var(--color-sev-confirmed)]">{spikeInfo.hours_until}h</strong>
          </span>
        </div>
      )}
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <XAxis
            dataKey="time" interval="preserveStartEnd"
            tick={{ fill: "var(--color-mist-400)", fontSize: 10 }}
            axisLine={{ stroke: "var(--color-ink-600)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "var(--color-mist-400)", fontSize: 10 }}
            axisLine={false} tickLine={false} width={36}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-ink-900)",
              border: "1px solid var(--color-ink-600)",
              borderRadius: 8, fontSize: 12,
            }}
            labelStyle={{ color: "var(--color-mist-200)" }}
            formatter={(value) => [`${value} µg/m³`, "PM2.5"]}
          />
          <ReferenceLine y={120} stroke="var(--color-sev-confirmed)" strokeDasharray="4 4" strokeWidth={1} />
          <Line
            type="monotone" dataKey="pm25"
            stroke="var(--color-clear-400)" strokeWidth={2} dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-[var(--color-mist-400)] mt-1">
        Red dashed line = unhealthy threshold (120 µg/m³). Forecast uncertainty increases with horizon.
      </p>
    </div>
  );
}


function IncidentExplanation({ explanation }) {
  return (
    <div className="rounded-xl bg-[var(--color-ink-800)] p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--color-mist-50)] mb-2">
        <MapPin size={14} className="text-[var(--color-clear-400)]" />
        {explanation.incident_title || "Incident analysis"}
      </h3>
      <p className="text-sm text-[var(--color-mist-200)] mb-3">{explanation.summary}</p>
      {explanation.evidence_signals && (
        <ul className="space-y-1 mb-2">
          {explanation.evidence_signals.map((s, i) => (
            <li key={i} className="text-xs text-[var(--color-mist-400)] flex items-start gap-1.5">
              <span className="text-[var(--color-clear-400)]">•</span> {s}
            </li>
          ))}
        </ul>
      )}
      {explanation.confidence_note && (
        <p className="text-[10px] text-[var(--color-mist-400)] italic">{explanation.confidence_note}</p>
      )}
    </div>
  );
}


function RecommendationSection({ rec }) {
  return (
    <div className="rounded-xl bg-[var(--color-ink-800)] p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--color-mist-50)] mb-3">
        <MessageSquare size={14} className="text-[var(--color-clear-400)]" />
        Recommended response
        {rec.urgency && (
          <span
            className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full"
            style={{
              color: rec.urgency === "IMMEDIATE" ? "var(--color-sev-confirmed)" : "var(--color-sev-corroborated)",
              backgroundColor: rec.urgency === "IMMEDIATE" ? "rgba(224,82,74,0.15)" : "rgba(232,162,61,0.15)",
            }}
          >
            {rec.urgency}
          </span>
        )}
      </h3>
      {rec.actions && (
        <ol className="space-y-2 mb-3">
          {rec.actions.map((a, i) => (
            <li key={i} className="text-sm">
              <span className="text-[var(--color-mist-200)]">
                <span className="text-[var(--color-clear-400)] font-medium mr-1.5">{i + 1}.</span>
                {a.action}
              </span>
              {a.rationale && (
                <p className="text-[10px] text-[var(--color-mist-400)] ml-4 mt-0.5">{a.rationale}</p>
              )}
            </li>
          ))}
        </ol>
      )}
      {rec.advisory_text && (
        <div className="rounded-lg bg-[var(--color-ink-900)] p-3 text-xs">
          <p className="text-[var(--color-mist-400)] mb-1">Draft public advisory:</p>
          <p className="text-[var(--color-mist-200)] italic">"{rec.advisory_text}"</p>
        </div>
      )}
    </div>
  );
}
