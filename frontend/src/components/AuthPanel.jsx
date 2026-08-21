const DEMO_PROFILES = [
  {
    username: "citizen.demo",
    password: "demo123",
    label: "Citizen Reporter",
    subtitle: "Submit a single incident with photo, description, and place.",
  },
  {
    username: "verifier.demo",
    password: "demo123",
    label: "City Verifier",
    subtitle: "Review suspicious signals before escalation.",
  },
  {
    username: "authority.demo",
    password: "demo123",
    label: "Authority Operator",
    subtitle: "Acknowledge hotspots and issue action-ready alerts.",
  },
  {
    username: "brics.demo",
    password: "demo123",
    label: "BRICS Coordinator",
    subtitle: "Share events, models, and resource requests across partner nodes.",
  },
];

export default function AuthPanel({ session, onLogin, onLogout, authError }) {
  return (
    <div className="rounded-[28px] border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-5 shadow-[0_18px_48px_rgba(60,64,67,0.08)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--color-mist-50)]">Role access</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--color-mist-400)]">
            Switch perspective to see how one shared platform serves citizens, local operators, and BRICS coordination teams.
          </p>
        </div>
      </div>

      {session ? (
        <div className="mt-4 rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-800)] px-4 py-4">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--color-mist-400)]">Signed in</p>
          <p className="mt-2 font-[family-name:var(--font-display)] text-lg text-[var(--color-mist-50)]">{session.name}</p>
          <p className="mt-1 text-sm text-[var(--color-mist-400)]">
            {session.role} · {session.agency} · {session.country_code}
          </p>
          <button
            onClick={onLogout}
            className="mt-4 rounded-full border border-[var(--color-ink-700)] px-4 py-2 text-sm font-medium text-[var(--color-mist-200)] transition-colors hover:border-[var(--color-clear-500)]"
          >
            Sign out
          </button>
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {DEMO_PROFILES.map((profile) => (
            <button
              key={profile.username}
              onClick={() => onLogin(profile)}
              className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-800)] px-4 py-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--color-clear-500)] hover:shadow-[0_12px_30px_rgba(26,115,232,0.08)]"
            >
              <p className="font-[family-name:var(--font-display)] text-base text-[var(--color-mist-50)]">{profile.label}</p>
              <p className="mt-1 text-sm leading-6 text-[var(--color-mist-400)]">{profile.subtitle}</p>
            </button>
          ))}
        </div>
      )}

      {authError && <p className="mt-3 text-sm text-[var(--color-sev-confirmed)]">{authError}</p>}
    </div>
  );
}