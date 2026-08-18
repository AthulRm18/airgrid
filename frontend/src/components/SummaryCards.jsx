import { useEffect, useState } from "react";
import {
  Activity, Eye, AlertTriangle, Users, Bell
} from "lucide-react";

export default function SummaryCards({ backendOk }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/summary");
        if (res.ok) {
          setData(await res.json());
          setLoadError(false);
        } else {
          setLoadError(true);
        }
      } catch {
        setLoadError(true);
      }
    };
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  if (loadError || backendOk === false) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] px-4 py-3 opacity-40">
            <p className="text-xs text-[var(--color-mist-400)]">—</p>
            <p className="text-2xl text-[var(--color-mist-400)]">—</p>
          </div>
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] px-4 py-3 animate-pulse">
            <div className="h-3 w-20 bg-[var(--color-ink-700)] rounded mb-2" />
            <div className="h-7 w-10 bg-[var(--color-ink-700)] rounded" />
          </div>
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: "Active Hotspots",
      value: data.active_hotspots,
      icon: Activity,
      color: "var(--color-sev-confirmed)",
      bgColor: "rgba(224, 82, 74, 0.12)",
    },
    {
      label: "Hidden Hotspots",
      value: data.hidden_hotspots,
      icon: Eye,
      color: "var(--color-sev-hidden)",
      bgColor: "rgba(168, 112, 232, 0.12)",
      subtitle: "No official sensor coverage",
    },
    {
      label: "Predicted Spikes",
      value: data.high_confidence_cells,
      icon: AlertTriangle,
      color: "var(--color-sev-corroborated)",
      bgColor: "rgba(232, 162, 61, 0.12)",
    },
    {
      label: "Population at Risk",
      value: data.population_at_risk?.toLocaleString() ?? "—",
      icon: Users,
      color: "var(--color-prop-near)",
      bgColor: "rgba(232, 125, 58, 0.12)",
    },
    {
      label: "Pending Alerts",
      value: data.pending_alerts,
      icon: Bell,
      color: data.pending_alerts > 0 ? "var(--color-sev-confirmed)" : "var(--color-clear-400)",
      bgColor: data.pending_alerts > 0 ? "rgba(224, 82, 74, 0.12)" : "rgba(79, 184, 172, 0.12)",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] px-4 py-3 animate-fade-in"
        >
          <div className="flex items-center gap-2 mb-2">
            <div
              className="rounded-lg p-1.5"
              style={{ backgroundColor: card.bgColor }}
            >
              <card.icon size={14} style={{ color: card.color }} />
            </div>
            <span className="text-xs text-[var(--color-mist-400)] leading-tight">
              {card.label}
            </span>
          </div>
          <p
            className="font-[family-name:var(--font-display)] text-2xl font-semibold animate-count"
            style={{ color: card.color }}
          >
            {card.value}
          </p>
          {card.subtitle && (
            <p className="text-[10px] text-[var(--color-mist-400)] mt-0.5">
              {card.subtitle}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
