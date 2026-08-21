import { useState } from "react";
import { Shield, Loader2, User, Search, Building2, FlaskConical, Globe2 } from "lucide-react";

const ROLES = [
  {
    username: "citizen.demo",
    password: "demo123",
    label: "Citizen",
    name: "Asha Rao",
    role: "citizen",
    icon: User,
    description: "Report smoke, haze, or industrial emissions",
  },
  {
    username: "verifier.demo",
    password: "demo123",
    label: "City Verifier",
    name: "Rohan Mehta",
    role: "verifier",
    icon: Search,
    description: "Review and acknowledge incoming signals",
  },
  {
    username: "authority.demo",
    password: "demo123",
    label: "Authority",
    name: "Dr. Neha Iyer",
    role: "authority",
    icon: Building2,
    description: "Issue public alerts and coordinate response",
  },
  {
    username: "researcher.demo",
    password: "demo123",
    label: "Researcher",
    name: "Dr. Priya Sharma",
    role: "researcher",
    icon: FlaskConical,
    description: "Analyze trends and policy impact data",
  },
  {
    username: "brics.demo",
    password: "demo123",
    label: "BRICS Coordinator",
    name: "BRICS Node",
    role: "coordinator",
    icon: Globe2,
    description: "Federate events across partner countries",
  },
];

export default function LoginPage({ onLogin, authError }) {
  const [selected, setSelected] = useState(null);
  const [signing, setSigning] = useState(false);

  async function handleRoleSelect(profile) {
    setSelected(profile.username);
    setSigning(true);
    await onLogin(profile);
    setSigning(false);
    setSelected(null);
  }

  return (
    <div className="min-h-screen flex">
      {/* Left — problem context */}
      <div className="hidden lg:flex lg:w-[42%] flex-col justify-center px-12 xl:px-16 bg-white border-r border-[#dde3ea]">
        <div className="flex items-center gap-3 mb-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(26,115,232,0.1)]">
            <Shield size={20} className="text-[#1a73e8]" />
          </div>
          <span className="text-xl font-bold text-[#16202c]" style={{ fontFamily: "Manrope, sans-serif" }}>
            VIGIL
          </span>
        </div>

        <p className="text-xs font-semibold uppercase tracking-widest text-[#1a73e8] mb-3">
          Clean Air & Climate Resilience
        </p>
        <h1 className="text-2xl font-bold text-[#16202c] leading-snug mb-4" style={{ fontFamily: "Manrope, sans-serif" }}>
          Hyperlocal pollution detection for Indian cities
        </h1>
        <p className="text-sm text-[#5f6f86] leading-relaxed mb-6">
          Official sensors miss industrial emissions, agricultural burning, and seasonal smog at the neighborhood level. VIGIL fuses citizen reports, satellite data, and ground sensors to find pollution hotspots before they spread.
        </p>

        <div className="space-y-3 text-sm text-[#314154]">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgba(26,115,232,0.1)] text-[10px] font-bold text-[#1a73e8]">1</span>
            <span>Citizens report smoke via text, voice, or photo</span>
          </div>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgba(26,115,232,0.1)] text-[10px] font-bold text-[#1a73e8]">2</span>
            <span>System detects blind-spot hotspots with fused evidence</span>
          </div>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgba(26,115,232,0.1)] text-[10px] font-bold text-[#1a73e8]">3</span>
            <span>Authorities verify and issue targeted public alerts</span>
          </div>
        </div>
      </div>

      {/* Right — role picker */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 bg-[#f0f4f9]">
        <div className="lg:hidden mb-8 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(26,115,232,0.1)]">
            <Shield size={22} className="text-[#1a73e8]" />
          </div>
          <h1 className="text-2xl font-bold text-[#16202c]" style={{ fontFamily: "Manrope, sans-serif" }}>VIGIL</h1>
          <p className="text-sm text-[#5f6f86]">Hyperlocal Air Intelligence</p>
        </div>

        <div className="w-full max-w-md">
          <h2 className="text-base font-semibold text-[#16202c] mb-1">Sign in to demo</h2>
          <p className="text-sm text-[#5f6f86] mb-5">Pick a role — one account per role, password: demo123</p>

          <div className="space-y-2">
            {ROLES.map((role) => {
              const Icon = role.icon;
              const isLoading = signing && selected === role.username;
              const isActive = selected === role.username;
              return (
                <button
                  key={role.username}
                  onClick={() => handleRoleSelect(role)}
                  disabled={signing}
                  className="group flex w-full items-center gap-3 rounded-xl border bg-white px-4 py-3.5 text-left transition-all disabled:cursor-not-allowed hover:border-[#1a73e8] hover:shadow-sm"
                  style={{
                    borderColor: isActive ? "#1a73e8" : "#dde3ea",
                    opacity: signing && !isActive ? 0.6 : 1,
                  }}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f0f4f9]">
                    <Icon size={16} className="text-[#1a73e8]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-[#16202c]">{role.label}</span>
                      <span className="text-[10px] text-[#7b8fa1]">{role.name}</span>
                    </div>
                    <p className="text-xs text-[#5f6f86] truncate">{role.description}</p>
                  </div>
                  {isLoading && <Loader2 size={16} className="animate-spin text-[#1a73e8] shrink-0" />}
                </button>
              );
            })}
          </div>

          {authError && (
            <div className="mt-4 rounded-xl border border-[rgba(224,82,74,0.2)] bg-[rgba(224,82,74,0.06)] px-4 py-3 text-sm text-[#e0524a]">
              {authError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
