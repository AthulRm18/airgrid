import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { Loader2, FlaskConical } from "lucide-react";
import { SEVERITY } from "../lib/severity";

const COUNTRY_COLORS = { IN: "#1a73e8", CN: "#e0524a", BR: "#4fb8ac", RU: "#e8a23d", ZA: "#a870e8" };

export default function ResearchPanel({ hotspots, refreshToken }) {
  const [bricsEvents, setBricsEvents] = useState([]);
  const [reportCount, setReportCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/brics/hotspots/federated").then((r) => r.ok ? r.json() : { events: [] }),
      fetch("/api/citizen-reports").then((r) => r.ok ? r.json() : { count: 0 }),
    ])
      .then(([fed, reps]) => {
        setBricsEvents(fed.events ?? []);
        setReportCount(reps.count ?? 0);
      })
      .finally(() => setLoading(false));
  }, [refreshToken]);

  const severityData = Object.keys(SEVERITY).map((key) => ({
    name: SEVERITY[key].label,
    count: hotspots.filter((h) => h.severity === key).length,
    fill: SEVERITY[key].rawColor,
  })).filter((d) => d.count > 0);

  const countryData = [
    { name: "India (local)", value: hotspots.length, fill: COUNTRY_COLORS.IN },
    ...["CN", "BR", "RU", "ZA"].map((c) => ({
      name: c,
      value: bricsEvents.filter((e) => e.origin_country === c).length,
      fill: COUNTRY_COLORS[c],
    })).filter((d) => d.value > 0),
  ];

  const pmData = hotspots
    .filter((h) => h.sensor_pm25 != null || h.aqi_estimate != null)
    .slice(0, 8)
    .map((h) => ({
      cell: h.h3_cell.slice(0, 8),
      pm25: Math.round(h.sensor_pm25 ?? h.aqi_estimate ?? 0),
    }));

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <Loader2 size={18} className="animate-spin text-[#1a73e8]" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className="shrink-0 border-b border-[#dde3ea] px-4 py-3">
        <div className="flex items-center gap-2">
          <FlaskConical size={14} className="text-[#1a73e8]" />
          <h2 className="text-sm font-semibold text-[#1a1f2e]">Research view</h2>
        </div>
        <p className="text-[11px] text-[#7b8fa1]">{reportCount} reports · {hotspots.length} local hotspots · {bricsEvents.length} federated</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {severityData.length > 0 && (
          <ChartBlock title="Severity distribution (India node)">
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={severityData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#7b8fa1" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "#7b8fa1" }} axisLine={false} tickLine={false} width={20} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartBlock>
        )}

        {countryData.length > 0 && (
          <ChartBlock title="BRICS coverage">
            <ResponsiveContainer width="100%" height={110}>
              <PieChart>
                <Pie data={countryData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={28} outerRadius={44} paddingAngle={2}>
                  {countryData.map((d) => <Cell key={d.name} fill={d.fill} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-2 mt-1">
              {countryData.map((d) => (
                <span key={d.name} className="flex items-center gap-1 text-[10px] text-[#5f6f86]">
                  <span className="h-2 w-2 rounded-full" style={{ background: d.fill }} />
                  {d.name} ({d.value})
                </span>
              ))}
            </div>
          </ChartBlock>
        )}

        {pmData.length > 0 && (
          <ChartBlock title="PM2.5 by zone (µg/m³)">
            <ResponsiveContainer width="100%" height={90}>
              <BarChart data={pmData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <XAxis dataKey="cell" tick={{ fontSize: 8, fill: "#7b8fa1" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "#7b8fa1" }} axisLine={false} tickLine={false} width={24} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v) => [`${v} µg/m³`, "PM2.5"]} />
                <Bar dataKey="pm25" fill="#1a73e8" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartBlock>
        )}
      </div>
    </div>
  );
}

function ChartBlock({ title, children }) {
  return (
    <div className="rounded-lg border border-[#dde3ea] bg-[#f9fafb] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#7b8fa1] mb-1">{title}</p>
      {children}
    </div>
  );
}
