import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ReportsFeed({ refreshToken, reportsBump = 0, pendingReport = null }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadReports = () => {
    fetch("/api/citizen-reports")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.reports)) {
          setReports(d.reports.slice(0, 10));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadReports(); }, [refreshToken, reportsBump]);

  // Optimistic: prepend pending report immediately
  const display = pendingReport
    ? [pendingReport, ...reports.filter((r) => r.id !== pendingReport.id)].slice(0, 8)
    : reports;

  return (
    <div className="border-t border-[#dde3ea] bg-white">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#dde3ea]">
        <div className="flex items-center gap-1.5">
          <FileText size={13} className="text-[#1a73e8]" />
          <h3 className="text-xs font-semibold text-[#1a1f2e]">Recent reports</h3>
        </div>
        <span className="text-[10px] text-[#7b8fa1]">{display.length} shown</span>
      </div>

      <div className="max-h-[180px] overflow-y-auto divide-y divide-[#eef1f5]">
        {loading && display.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-4 text-xs text-[#7b8fa1]">
            <Loader2 size={12} className="animate-spin" /> Loading…
          </div>
        ) : display.length === 0 ? (
          <p className="px-4 py-4 text-xs text-[#7b8fa1] text-center">
            No reports yet. Seed demo or submit one as Citizen.
          </p>
        ) : (
          display.map((r) => (
            <div
              key={r.id || r.incident_id}
              className={`px-4 py-2 ${r._optimistic ? "bg-[#f0f6ff]" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-medium uppercase text-[#7b8fa1]">
                  {r.source || "text"}
                  {r._optimistic && " · sending"}
                </span>
                <span className="text-[10px] text-[#7b8fa1]">{timeAgo(r.submitted_at)}</span>
              </div>
              <p className="mt-0.5 text-xs text-[#314154] line-clamp-2 leading-relaxed">
                {r.text || r.location_hint || "Photo report"}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
