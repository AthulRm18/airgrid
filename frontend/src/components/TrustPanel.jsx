import { Database, Globe2, Radar, ShieldCheck } from "lucide-react";

export default function TrustPanel({ bricsStatus }) {
  const sourceRows = [
    { label: "Ground sensors", value: "OpenAQ · mock fallback", icon: Database },
    { label: "Weather", value: "IMD · mock fallback", icon: Radar },
    { label: "Gemini AI", value: "Gemini 2.5 Flash", icon: ShieldCheck },
    { label: "BRICS exchange", value: "enabled", icon: Globe2 },
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-[28px] border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-5 shadow-[0_18px_48px_rgba(60,64,67,0.08)]">
        <h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--color-mist-50)]">Why this helps people</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <ReasonCard
            title="Citizens fill sensor gaps"
            body="OpenAQ is excellent where stations exist. AirGrid captures smoke, smell, and symptoms where official monitoring is absent or too coarse."
          />
          <ReasonCard
            title="Authorities act on one screen"
            body="Each hotspot carries supporting evidence, likely spread path, exposed population, and next-step guidance instead of just a raw PM2.5 number."
          />
          <ReasonCard
            title="BRICS nodes share intelligence"
            body="Countries keep local control of data but exchange interoperable hotspot summaries, model metadata, and resource requests."
          />
        </div>
      </div>

      <div className="rounded-[28px] border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-5 shadow-[0_18px_48px_rgba(60,64,67,0.08)]">
        <h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--color-mist-50)]">System status</h2>
        <div className="mt-4 space-y-3">
          {sourceRows.map((row) => (
            <div key={row.label} className="flex items-center gap-3 rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-800)] px-4 py-3">
              <div className="rounded-xl bg-[rgba(26,115,232,0.08)] p-2">
                <row.icon size={14} className="text-[var(--color-clear-500)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--color-mist-50)]">{row.label}</p>
                <p className="text-xs uppercase tracking-[0.12em] text-[var(--color-mist-400)]">{row.value}</p>
              </div>
            </div>
          ))}
        </div>
        {bricsStatus && (
          <div className="mt-4 rounded-2xl bg-[var(--color-ink-800)] px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--color-mist-400)]">Federation overview</p>
            <p className="mt-2 text-sm leading-6 text-[var(--color-mist-200)]">
              Local node: {bricsStatus.local_country} · Federated events received: {bricsStatus.federated_events_received} · Shared models: {bricsStatus.shared_models}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ReasonCard({ title, body }) {
  return (
    <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-800)] px-4 py-4 shadow-sm">
      <p className="font-[family-name:var(--font-display)] text-base text-[var(--color-mist-50)]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[var(--color-mist-400)]">{body}</p>
    </div>
  );
}