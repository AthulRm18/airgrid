import { useState } from "react";
import { Bell, CheckCircle2, Eye, Loader2, Shield, TrendingUp, XCircle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { SEVERITY, SEVERITY_ORDER } from "../lib/severity";

const REGION_FILTERS = [
  { id: "all", label: "All" },
  { id: "delhi", label: "Delhi", test: (h) => h.lat >= 28 && h.lat <= 29 && h.lng >= 76.5 && h.lng <= 77.8 },
  { id: "kerala", label: "Kerala", test: (h) => h.lat >= 8.2 && h.lat <= 12.5 && h.lng >= 75.0 && h.lng <= 77.8 },
  { id: "mumbai", label: "Mumbai", test: (h) => h.lat >= 18.5 && h.lat <= 19.5 && h.lng >= 72.5 && h.lng <= 73.5 },
  { id: "bengaluru", label: "BLR", test: (h) => h.lat >= 12.5 && h.lat <= 13.5 && h.lng >= 77.2 && h.lng <= 78.0 },
  { id: "kolkata", label: "Kolkata", test: (h) => h.lat >= 22.0 && h.lat <= 23.0 && h.lng >= 88.0 && h.lng <= 89.0 },
];

export default function AlertQueue({
  hotspots,
  selectedCell,
  onSelectCell,
  onAcknowledge,
  onOpenEvidence,
  onRefresh,
  session,
  sessionToken,
  activeRegion = "all",
  onRegionChange,
}) {
  const currentRegion = activeRegion || "all";
  const regionFilter = REGION_FILTERS.find((r) => r.id === currentRegion);
  const filteredHotspots = hotspots.filter((h) => {
    if (!regionFilter || regionFilter.id === "all") return true;
    return regionFilter.test ? regionFilter.test(h) : true;
  });

  const sorted = [...filteredHotspots].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  );

  const actionable = sorted.filter((h) => h.severity !== "unverified" && !h.dismissed);
  const unverified = sorted.filter((h) => h.severity === "unverified" && !h.dismissed);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className="shrink-0 border-b border-[#dde3ea] px-4 py-2">
        <div className="flex items-center justify-between mb-1.5">
          <h2 className="text-sm font-semibold text-[#1a1f2e]">Action queue</h2>
          <span className="text-[11px] text-[#7b8fa1]">
            {actionable.length} actionable · {unverified.length} pending
          </span>
        </div>
        {/* Region filter pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          {REGION_FILTERS.map((r) => (
            <button
              key={r.id}
              onClick={() => onRegionChange?.(r.id)}
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                currentRegion === r.id
                  ? "bg-[#1a73e8] text-white"
                  : "bg-[#f0f4f9] text-[#5f6f86] hover:bg-[#e4ebf5]"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-[#eef1f5]">
        {actionable.map((hotspot, index) => (
          <AlertRow
            key={hotspot.h3_cell}
            hotspot={hotspot}
            index={index + 1}
            selected={selectedCell === hotspot.h3_cell}
            onSelect={() => onSelectCell(hotspot.h3_cell)}
            onAcknowledge={onAcknowledge}
            onOpenEvidence={onOpenEvidence}
            onRefresh={onRefresh}
            session={session}
            sessionToken={sessionToken}
          />
        ))}

        {unverified.length > 0 && (
          <div className="bg-[#f9fafb] px-4 py-1 text-[10px] uppercase tracking-wider text-[#7b8fa1]">
            Gathering evidence
          </div>
        )}
        {unverified.slice(0, 5).map((hotspot, index) => (
          <AlertRow
            key={hotspot.h3_cell}
            hotspot={hotspot}
            index={actionable.length + index + 1}
            selected={selectedCell === hotspot.h3_cell}
            onSelect={() => onSelectCell(hotspot.h3_cell)}
            onAcknowledge={onAcknowledge}
            onOpenEvidence={onOpenEvidence}
            onRefresh={onRefresh}
            session={session}
            sessionToken={sessionToken}
            compact
          />
        ))}

        {sorted.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-[#7b8fa1]">
            No incidents detected. Click <strong className="text-[#1a1f2e]">Seed demo</strong>.
          </div>
        )}
      </div>
    </div>
  );
}

function AlertRow({ hotspot, index, selected, onSelect, onAcknowledge, onOpenEvidence, onRefresh, session, sessionToken, compact }) {
  const [expanded, setExpanded] = useState(false);
  const [forecastData, setForecastData] = useState(null);
  const [loadingForecast, setLoadingForecast] = useState(false);
  const [action, setAction] = useState("");
  const [issuingAlert, setIssuingAlert] = useState(false);
  const [actionError, setActionError] = useState("");

  const acknowledged = hotspot.acknowledged;
  const alertIssued = hotspot.alert_issued;
  const dismissed = hotspot.dismissed;

  const sev = SEVERITY[hotspot.severity] ?? SEVERITY.unverified;
  const confidence = Math.round((hotspot.confidence_score || 0) * 100);
  const canVerify = session && (session.role === "verifier" || session.role === "authority");
  const canIssue = session && session.role === "authority";

  function buildFallbackForecast() {
    const base = hotspot.sensor_pm25 ?? hotspot.aqi_estimate ?? 80;
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getTime() + (i + 1) * 3600 * 1000);
      return {
        time: d.toLocaleTimeString([], { hour: "2-digit" }),
        pm25: Math.max(10, Math.round(base * (0.98 + (i + 1) / 200))),
      };
    });
  }

  async function handleExpand() {
    const next = !expanded;
    setExpanded(next);
    onSelect();
    if (next && !forecastData) {
      setLoadingForecast(true);
      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`/api/forecast/${hotspot.h3_cell}?hours=12`, { signal: controller.signal });
        if (!res.ok) { setForecastData(buildFallbackForecast()); return; }
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

  async function handleAcknowledgeClick() {
    if (!action.trim()) return;
    setActionError("");
    try {
      await onAcknowledge(hotspot.h3_cell, action.trim());
      setAction("");
      onRefresh?.();
    } catch (err) {
      setActionError(err.message || "Acknowledge failed — sign in as Verifier or Authority");
    }
  }

  async function handleIssueAlert() {
    setIssuingAlert(true);
    try {
      await fetch("/api/alerts/issue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sessionToken ? { "X-Session-Token": sessionToken } : {}),
        },
        body: JSON.stringify({ h3_cell: hotspot.h3_cell, alert_type: "public_advisory" }),
      });
      onRefresh?.();
    } finally {
      setIssuingAlert(false);
    }
  }

  async function handleDismiss() {
    await fetch("/api/alerts/dismiss", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(sessionToken ? { "X-Session-Token": sessionToken } : {}),
      },
      body: JSON.stringify({ h3_cell: hotspot.h3_cell, reason: "False positive / resolved" }),
    });
    onRefresh?.();
  }

  if (dismissed) return null;

  return (
    <div className={`px-4 py-2.5 transition-colors ${selected ? "bg-[#f0f6ff]" : "hover:bg-[#f9fafb]"} ${compact ? "py-2" : ""}`}>
      <button onClick={handleExpand} className="flex w-full items-center gap-2.5 text-left">
        <div className="flex shrink-0 flex-col items-center">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: sev.rawColor }} />
          <span className="text-[9px] text-[#7b8fa1]">#{index}</span>
        </div>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium text-[#1a1f2e]">{sev.label}</span>
            {confidence > 0 && (
              <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={{ color: sev.rawColor, backgroundColor: `${sev.rawColor}18` }}>
                {confidence}%
              </span>
            )}
            {alertIssued && (
              <span className="rounded-full bg-[rgba(224,82,74,0.1)] px-1.5 py-0.5 text-[10px] font-medium text-[#e0524a]">
                Alert issued
              </span>
            )}
            {acknowledged && !alertIssued && (
              <span className="rounded-full bg-[rgba(26,115,232,0.1)] px-1.5 py-0.5 text-[10px] font-medium text-[#1a73e8]">
                Acknowledged
              </span>
            )}
          </span>
          <span className="block truncate font-mono text-[10px] text-[#7b8fa1]">
            {hotspot.h3_cell.slice(0, 14)}…
            {hotspot.aqi_estimate != null && ` · ~${Math.round(hotspot.aqi_estimate)} µg/m³`}
            {hotspot.citizen_report_count > 0 && ` · ${hotspot.citizen_report_count} report${hotspot.citizen_report_count > 1 ? "s" : ""}`}
          </span>
        </span>
        {alertIssued && <Bell size={12} className="text-[#e0524a] shrink-0" />}
        {acknowledged && !alertIssued && <CheckCircle2 size={12} className="text-[#1a73e8] shrink-0" />}
      </button>

      {expanded && !compact && (
        <div className="mt-3 space-y-2.5 pl-4 animate-fade-in">
          {hotspot.explanation && (
            <p className="text-xs leading-relaxed text-[#5f6f86]">{hotspot.explanation}</p>
          )}

          <div className="rounded-lg border border-[#dde3ea] bg-[#f9fafb] px-3 py-2">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-[#1a73e8]">
              <TrendingUp size={11} /> 12h forecast
            </div>
            {loadingForecast ? (
              <div className="flex h-14 items-center gap-2 text-[10px] text-[#7b8fa1]">
                <Loader2 size={11} className="animate-spin" /> Loading…
              </div>
            ) : forecastData?.length ? (
              <ResponsiveContainer width="100%" height={70}>
                <LineChart data={forecastData} margin={{ top: 2, right: 4, bottom: 0, left: -30 }}>
                  <XAxis dataKey="time" tick={{ fill: "#7b8fa1", fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#7b8fa1", fontSize: 9 }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip
                    contentStyle={{ background: "#fff", border: "1px solid #dde3ea", borderRadius: 8, fontSize: 11 }}
                    formatter={(v) => [`${v} µg/m³`, "PM2.5"]}
                  />
                  <ReferenceLine y={120} stroke="#e0524a" strokeDasharray="4 4" strokeWidth={1} />
                  <Line type="monotone" dataKey="pm25" stroke="#1a73e8" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-[10px] text-[#7b8fa1]">Forecast unavailable</p>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => onOpenEvidence?.(hotspot.h3_cell)}
              className="flex items-center gap-1 rounded-full border border-[#dde3ea] px-2.5 py-1 text-[11px] text-[#314154] hover:border-[#1a73e8]"
            >
              <Eye size={11} /> Evidence
            </button>
            {canVerify && !acknowledged && !alertIssued && (
              <button
                onClick={handleDismiss}
                className="flex items-center gap-1 rounded-full border border-[#dde3ea] px-2.5 py-1 text-[11px] text-[#7b8fa1] hover:border-[#e0524a] hover:text-[#e0524a]"
              >
                <XCircle size={11} /> Dismiss
              </button>
            )}
          </div>

          {alertIssued ? (
            <div className="flex items-center gap-2 rounded-lg bg-[rgba(224,82,74,0.06)] px-3 py-2 text-xs text-[#314154]">
              <Bell size={12} className="text-[#e0524a]" />
              Public alert active
            </div>
          ) : acknowledged ? (
            <div className="space-y-2">
              {canIssue && (
                <button
                  onClick={handleIssueAlert}
                  disabled={issuingAlert}
                  className="w-full rounded-lg bg-[#e0524a] px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
                >
                  {issuingAlert ? <Loader2 size={12} className="mr-1 inline animate-spin" /> : <Bell size={12} className="mr-1 inline" />}
                  Issue public alert
                </button>
              )}
            </div>
          ) : canVerify ? (
            <div className="space-y-1.5">
              <div className="flex gap-1.5">
                <input
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                  placeholder="Action taken, e.g. field team dispatched"
                  className="flex-1 rounded-lg border border-[#dde3ea] bg-white px-2.5 py-1.5 text-xs text-[#1a1f2e] placeholder:text-[#7b8fa1] focus:border-[#1a73e8] focus:outline-none"
                />
                <button
                  onClick={handleAcknowledgeClick}
                  disabled={!action.trim()}
                  className="rounded-lg bg-[#1a73e8] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  <Shield size={12} className="mr-0.5 inline" /> Ack
                </button>
              </div>
              {actionError && <p className="text-[10px] text-[#e0524a]">{actionError}</p>}
            </div>
          ) : (
            <p className="text-[10px] text-[#7b8fa1]">
              Log in as <strong>Verifier</strong> or <strong>Authority</strong> to acknowledge hotspots.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
