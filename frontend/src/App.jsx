import { useEffect, useState, useCallback, useRef } from "react";
import { Shield, Zap, LogOut, Loader2, WifiOff, BookOpen } from "lucide-react";
import SummaryCards from "./components/SummaryCards";
import HotspotMap from "./components/HotspotMap";
import AlertQueue from "./components/AlertQueue";
import ReportPanel from "./components/ReportPanel";
import EvidencePanel from "./components/EvidencePanel";
import DemoTour from "./components/DemoTour";
import LoginPage from "./components/LoginPage";
import BricsPanel from "./components/BricsPanel";
import ReportsFeed from "./components/ReportsFeed";

const POLL_MS = 6000;

function App() {
  const [hotspots, setHotspots] = useState([]);
  const [selectedCell, setSelectedCell] = useState(null);
  const [evidenceCell, setEvidenceCell] = useState(null);
  const [evidenceHotspot, setEvidenceHotspot] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState("");
  const [backendOk, setBackendOk] = useState(null);
  const [session, setSession] = useState(null);
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem("vigil_token") || "");
  const [authError, setAuthError] = useState("");
  const [authChecking, setAuthChecking] = useState(!!localStorage.getItem("vigil_token"));
  const [bricsCount, setBricsCount] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [showTour, setShowTour] = useState(false);
  const autoSeeded = useRef(false);
  const failures = useRef(0);

  const headers = useCallback(() => {
    const h = {};
    if (sessionToken) h["X-Session-Token"] = sessionToken;
    return h;
  }, [sessionToken]);

  const refreshBrics = useCallback(async () => {
    try {
      const r = await fetch("/api/brics/status");
      if (r.ok) {
        const d = await r.json();
        setBricsCount(d.federated_events_received);
      }
    } catch { /* best effort */ }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch("/api/hotspots", { signal: ctrl.signal });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setHotspots(d.hotspots ?? []);
      setLastUpdated(new Date());
      setError(null);
      setBackendOk(true);
      failures.current = 0;
      setRefreshToken((t) => t + 1);
    } catch {
      failures.current += 1;
      if (failures.current >= 2) {
        setBackendOk(false);
        setError("Backend offline — start it on port 8000");
      }
    }
  }, []);

  useEffect(() => {
    refresh();
    refreshBrics();
    const id = setInterval(() => { refresh(); refreshBrics(); }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh, refreshBrics]);

  // Restore session from backend (persisted across refresh)
  useEffect(() => {
    if (!sessionToken) { setAuthChecking(false); return; }
    fetch("/api/auth/session", { headers: headers() })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d) {
          setSession(d.user);
          localStorage.setItem("vigil_user", JSON.stringify(d.user));
        } else {
          localStorage.removeItem("vigil_token");
          localStorage.removeItem("vigil_user");
          setSessionToken("");
        }
      })
      .catch(() => {})
      .finally(() => setAuthChecking(false));
  }, [sessionToken, headers]);

  // Auto-seed once if backend is up but empty
  useEffect(() => {
    if (hotspots.length === 0 && backendOk === true && !autoSeeded.current && session) {
      autoSeeded.current = true;
      fetch("/api/demo/seed", { method: "POST" })
        .then(() => { refresh(); refreshBrics(); })
        .catch(() => {});
    }
  }, [hotspots.length, backendOk, refresh, refreshBrics, session]);

  async function handleLogin(profile) {
    setAuthError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: profile.username, password: profile.password }),
      });
      if (!res.ok) throw new Error();
      const { session_token, user } = await res.json();
      localStorage.setItem("vigil_token", session_token);
      localStorage.setItem("vigil_user", JSON.stringify(user));
      setSessionToken(session_token);
      setSession(user);
    } catch {
      setAuthError("Login failed — is the backend running on port 8000?");
    }
  }

  async function handleLogout() {
    try { await fetch("/api/auth/logout", { method: "POST", headers: headers() }); } catch { /* ok */ }
    localStorage.removeItem("vigil_token");
    localStorage.removeItem("vigil_user");
    setSessionToken("");
    setSession(null);
  }

  async function seedDemo() {
    setSeeding(true);
    setSeedMsg("");
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch("/api/demo/seed", { method: "POST", signal: ctrl.signal });
      if (!res.ok) throw new Error();
      const d = await res.json();
      await refresh();
      await refreshBrics();
      setSeedMsg(`${d.seeded} reports loaded · ${d.brics_events} BRICS event`);
    } catch {
      setSeedMsg("Seed failed — check backend is running");
    } finally {
      setSeeding(false);
    }
  }

  function openEvidence(cell) {
    const h = hotspots.find((x) => x.h3_cell === cell) ?? null;
    setEvidenceCell(cell);
    setEvidenceHotspot(h);
  }

  async function handleAcknowledge(cell, action) {
    await fetch("/api/hotspots/acknowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers() },
      body: JSON.stringify({ h3_cell: cell, action_taken: action }),
    });
    refresh();
  }

  if (authChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f0f4f9]">
        <Loader2 size={24} className="animate-spin text-[#1a73e8]" />
      </div>
    );
  }

  if (!session) {
    return <LoginPage onLogin={handleLogin} authError={authError} />;
  }

  const showBrics = session.role === "coordinator" || session.role === "researcher";
  const canReport = session.role === "citizen";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f0f4f9] text-[#16202c]">
      <header className="flex shrink-0 items-center justify-between border-b border-[#dde3ea] bg-white px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[rgba(26,115,232,0.1)]">
            <Shield size={14} className="text-[#1a73e8]" />
          </div>
          <div>
            <span className="text-sm font-bold text-[#1a1f2e]">VIGIL</span>
            <span className="ml-2 text-[11px] text-[#7b8fa1]">Delhi-NCR</span>
          </div>
        </div>

        <SummaryCards backendOk={backendOk} refreshToken={refreshToken} inline />

        <div className="flex items-center gap-2">
          {bricsCount > 0 && (
            <span className="rounded-full border border-[#dde3ea] px-2 py-0.5 text-[10px] text-[#7b8fa1]">
              BRICS {bricsCount}
            </span>
          )}

          <button
            onClick={() => setShowTour(true)}
            className="flex items-center gap-1 rounded-full border border-[#dde3ea] px-2.5 py-1 text-[11px] text-[#314154] hover:border-[#1a73e8] hover:text-[#1a73e8] transition-colors"
          >
            <BookOpen size={11} /> Guide
          </button>

          <button
            onClick={seedDemo}
            disabled={seeding}
            className="flex items-center gap-1 rounded-full bg-[#1a73e8] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
          >
            {seeding ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
            Seed demo
          </button>

          <div className="flex items-center gap-1.5 rounded-full border border-[#dde3ea] px-2.5 py-1">
            <span className="text-[11px] text-[#314154]">{session.name}</span>
            <span className="rounded-full bg-[rgba(26,115,232,0.1)] px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[#1a73e8]">
              {session.role}
            </span>
            <button onClick={handleLogout} className="text-[#7b8fa1] hover:text-[#314154]">
              <LogOut size={11} />
            </button>
          </div>
        </div>
      </header>

      {(error || seedMsg) && (
        <div
          className="flex shrink-0 items-center gap-2 border-b px-4 py-1.5 text-xs"
          style={{
            background: error ? "rgba(224,82,74,0.06)" : "rgba(26,115,232,0.06)",
            borderColor: error ? "rgba(224,82,74,0.2)" : "rgba(26,115,232,0.2)",
            color: error ? "#e0524a" : "#1a73e8",
          }}
        >
          {error ? <WifiOff size={11} /> : <Zap size={11} />}
          <span>{error || seedMsg}</span>
          {lastUpdated && !error && (
            <span className="ml-auto text-[#7b8fa1]">{lastUpdated.toLocaleTimeString()}</span>
          )}
        </div>
      )}

      <main className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden border-r border-[#dde3ea]">
          <HotspotMap
            hotspots={hotspots}
            selectedCell={selectedCell}
            onSelectCell={setSelectedCell}
            onOpenEvidence={openEvidence}
          />
          <ReportsFeed refreshToken={refreshToken} />
        </div>

        <div className="flex w-[340px] shrink-0 flex-col overflow-hidden border-r border-[#dde3ea]">
          {canReport && (
            <div className="shrink-0 border-b border-[#dde3ea]">
              <ReportPanel
                onReportSubmitted={refresh}
                session={session}
                sessionToken={sessionToken}
              />
            </div>
          )}
          <div className="flex-1 overflow-hidden">
            <AlertQueue
              hotspots={hotspots}
              selectedCell={selectedCell}
              onSelectCell={setSelectedCell}
              onAcknowledge={handleAcknowledge}
              onOpenEvidence={openEvidence}
              onRefresh={refresh}
              session={session}
              sessionToken={sessionToken}
            />
          </div>
        </div>

        {showBrics && (
          <div className="flex w-[280px] shrink-0 flex-col overflow-hidden">
            <BricsPanel refreshToken={refreshToken} />
          </div>
        )}
      </main>

      {evidenceCell && (
        <EvidencePanel
          h3Cell={evidenceCell}
          hotspot={evidenceHotspot}
          onClose={() => { setEvidenceCell(null); setEvidenceHotspot(null); }}
        />
      )}

      {showTour && <DemoTour onClose={() => setShowTour(false)} />}
    </div>
  );
}

export default App;
