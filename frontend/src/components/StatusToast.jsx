import { AlertTriangle, ShieldAlert, CheckCircle2, Radio, ArrowRight } from "lucide-react";

/** Toast stack for interactive status updates and authority action prompts */
export default function StatusToast({ toasts, onDismiss, onActionClick, role }) {
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[3000] flex w-full max-w-md -translate-x-1/2 flex-col gap-2.5 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex flex-col gap-2 rounded-xl border bg-white p-3.5 shadow-xl animate-fade-in"
          style={{
            borderColor: t.color || "#dde3ea",
            borderLeftWidth: 5,
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <div
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white"
                style={{ backgroundColor: t.color || "#1a73e8" }}
              >
                {t.severity === "hidden" ? (
                  <Radio size={13} className="animate-pulse" />
                ) : t.severity === "confirmed" ? (
                  <ShieldAlert size={13} />
                ) : t.severity === "corroborated" ? (
                  <AlertTriangle size={13} />
                ) : (
                  <CheckCircle2 size={13} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-[#1a1f2e]">{t.title}</p>
                <p className="mt-0.5 text-[11px] text-[#5f6f86] leading-relaxed">{t.message}</p>
              </div>
            </div>
            <button
              onClick={() => onDismiss(t.id)}
              className="shrink-0 rounded-full p-1 text-[#7b8fa1] hover:bg-[#f0f4f9] hover:text-[#1a1f2e] text-xs"
              title="Dismiss"
            >
              ✕
            </button>
          </div>

          {/* Action prompt for authorities / users */}
          {t.h3_cell && (
            <div className="flex items-center justify-between border-t border-[#f0f4f9] pt-2 mt-0.5">
              <span className="text-[10px] font-medium text-[#7b8fa1]">
                {role === "authority" ? "⚡ Authority Action Required" : "📡 Live Network Alert"}
              </span>
              <button
                onClick={() => {
                  onActionClick?.(t.h3_cell);
                  onDismiss(t.id);
                }}
                className="inline-flex items-center gap-1 rounded-full bg-[#1a73e8] px-3 py-1 text-[10px] font-medium text-white hover:bg-[#1557b0] transition"
              >
                <span>{role === "authority" ? "Take Action" : "View Evidence"}</span>
                <ArrowRight size={10} />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export const SEVERITY_TOAST = {
  hidden: {
    severity: "hidden",
    title: "Blind-spot hotspot found",
    message: "Citizen reports + satellite anomaly in a zone with no official ground sensors.",
    color: "#a870e8",
  },
  confirmed: {
    severity: "confirmed",
    title: "Hotspot confirmed",
    message: "OpenAQ sensors and citizen reports agree — hazardous air quality in this zone.",
    color: "#e0524a",
  },
  corroborated: {
    severity: "corroborated",
    title: "Signal corroborated",
    message: "Satellite and multiple citizen reports now agree on this zone.",
    color: "#e8a23d",
  },
  unverified: {
    severity: "unverified",
    title: "Citizen report logged",
    message: "Pinned to the map. Watching for sensor and satellite corroboration.",
    color: "#1a73e8",
  },
};
