import { useEffect, useState, useCallback, useRef } from "react";
import { Zap, LogOut, Loader2, WifiOff, BookOpen } from "lucide-react";
import SummaryCards from "./components/SummaryCards";
import HotspotMap from "./components/HotspotMap";
import AlertQueue from "./components/AlertQueue";
import ReportPanel from "./components/ReportPanel";
import EvidencePanel from "./components/EvidencePanel";
import DemoTour from "./components/DemoTour";
import LoginPage from "./components/LoginPage";
import BricsPanel from "./components/BricsPanel";
import ResearchPanel from "./components/ResearchPanel";
import ReportsFeed from "./components/ReportsFeed";
import VigilLogo from "./components/VigilLogo";
import StatusToast, { SEVERITY_TOAST } from "./components/StatusToast";

const POLL_MS = 8000;
const HOTSPOT_TIMEOUT = 20000;

function App() {
  const [hotspots, setHotspots] = useState([]);
  const [selectedCell, setSelectedCell] = useState(null);
  const [evidenceCell, setEvidenceCell] = useState(null);
  const [evidenceHotspot, setEvidenceHotspot] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState("");
  const [backendOk, setBackendOk] = useState(true);
  const [session, setSession] = useState(null);
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem("vigil_token") || "");
  const [authError, setAuthError] = useState("");
  const [authChecking, setAuthChecking] = useState(!!localStorage.getItem("vigil_token"));
  const [bricsCount, setBricsCount] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);
  const [reportsBump, setReportsBump] = useState(0);
  const [pendingReport, setPendingReport] = useState(null);
  const [bricsEvents, setBricsEvents] = useState([]);
  const [flashCells, setFlashCells] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [dataSources, setDataSources] = useState(null);
  const [showTour, setShowTour] = useState(false);
  const autoSeeded = useRef(false);
  const healthFails = useRef(0);
  const hotspotFails = useRef(0);
  const lastHotspots = useRef([]);
  const prevSeverity = useRef({});
  const toastId = useRef(0);

  const headers = useCallback(() => {
    const h = {};
    if (sessionToken) h["X-Session-Token"] = sessionToken;
    return h;
  }, [sessionToken]);

  const refreshBrics = useCallback(async () => {
    try {
      const [st, fed] = await Promise.all([
        fetch("/api/brics/status").then((r) => r.ok ? r.json() : null),
        fetch("/api/brics/hotspots/federated").then((r) => r.ok ? r.json() : { events: [] }),
      ]);
      if (st) setBricsCount(st.federated_events_received ?? 0);
      setBricsEvents(fed?.events ?? []);
    } catch { /* best effort */ }
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch("/api/health", { signal: ctrl.signal });
      if (!res.ok) throw new Error();
      healthFails.current = 0;
      setBackendOk(true);
      setError(null);
      return true;
    } catch {
      healthFails.current += 1;
      if (healthFails.current >= 3) {
        setBackendOk(false);
        setError("Backend offline — start it on port 8000");
      }
      return false;
    }
  }, []);

  const refreshHotspots = useCallback(async () => {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), HOTSPOT_TIMEOUT);
      const res = await fetch("/api/hotspots", { signal: ctrl.signal });
      if (!res.ok) throw new Error();
      const d = await res.json();
      const list = d.hotspots ?? [];

      const order = ["unverified", "corroborated", "hidden", "confirmed"];
      for (const h of list) {
        const prev = prevSeverity.current[h.h3_cell];
        const cur = h.severity;
        if (prev && prev !== cur && order.indexOf(cur) > order.indexOf(prev)) {
          const meta = SEVERITY_TOAST[cur] || SEVERITY_TOAST.unverified;
          const id = ++toastId.current;
          setToasts((t) => [...t.slice(-2), { id, h3_cell: h.h3_cell, ...meta }]);
          setFlashCells((f) => [...new Set([...f, h.h3_cell])]);
          setTimeout(() => {
            setToasts((t) => t.filter((x) => x.id !== id));
            setFlashCells((f) => f.filter((c) => c !== h.h3_cell));
          }, 8000);
        }
        prevSeverity.current[h.h3_cell] = cur;
      }

      lastHotspots.current = list;
      setHotspots(list);
      setLastUpdated(new Date());
      hotspotFails.current = 0;
      setRefreshToken((t) => t + 1);
    } catch {
      hotspotFails.current += 1;
      if (lastHotspots.current.length > 0) {
        setHotspots(lastHotspots.current);
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    await checkHealth();
    await refreshHotspots();
    await refreshBrics();
  }, [checkHealth, refreshHotspots, refreshBrics]);

  useEffect(() => {
    refresh();
    fetch("/api/data-sources").then((r) => r.ok ? r.json() : null).then(setDataSources).catch(() => {});
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

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

  useEffect(() => {
    if (hotspots.length === 0 && backendOk && !autoSeeded.current && session) {
      autoSeeded.current = true;
      fetch("/api/demo/seed", { method: "POST" })
        .then(() => refresh())
        .catch(() => {});
    }
  }, [hotspots.length, backendOk, refresh, session]);

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
    setSeedMsg("Seeding…");
    try {
      const res = await fetch("/api/demo/seed", { method: "POST" });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setSeedMsg(`${d.seeded} reports · ${d.brics_events} BRICS events`);
      setReportsBump((b) => b + 1);
      // Poll until hotspots appear (seed no longer blocks on recalc)
      for (let i = 0; i < 8; i++) {
        await refreshHotspots();
        await refreshBrics();
        if (lastHotspots.current.length > 0) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
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
    const res = await fetch("/api/hotspots/acknowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers() },
      body: JSON.stringify({ h3_cell: cell, action_taken: action }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed (${res.status})`);
    }
    await refreshHotspots();
  }

  function handleReportSubmitted(result) {
    const optimistic = {
      id: result?.id || result?.incident_id || `opt-${Date.now()}`,
      text: result?.text || result?.location_hint || "New report",
      source: result?.source || "text",
      submitted_at: result?.submitted_at || new Date().toISOString(),
      location_hint: result?.location_hint,
      h3_cell: result?.h3_cell,
      lat: result?.lat,
      lng: result?.lng,
      _optimistic: true,
    };
    setPendingReport(optimistic);
    setReportsBump((b) => b + 1);
    const meta = SEVERITY_TOAST.unverified;
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, ...meta, h3_cell: result?.h3_cell }]);
    if (result?.h3_cell) {
      setFlashCells((f) => [...new Set([...f, result.h3_cell])]);
      setSelectedCell(result.h3_cell);
      setTimeout(() => setFlashCells((f) => f.filter((c) => c !== result.h3_cell)), 6000);
    }
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 7000);
    // Refresh feed + map immediately, then again after fusion settles
    refreshHotspots();
    setTimeout(() => {
      setReportsBump((b) => b + 1);
      refreshHotspots();
      setPendingReport(null);
    }, 2500);
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

  const showBrics = session.role === "coordinator";
  const showResearch = session.role === "researcher";
  const canReport = session.role === "citizen";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f0f4f9] text-[#16202c]">
      <header className="flex shrink-0 items-center justify-between border-b border-[#dde3ea] bg-white px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <VigilLogo size={28} />
          <div>
            <span className="text-sm font-bold text-[#1a1f2e]">VIGIL</span>
            <span className="ml-2 text-[11px] text-[#7b8fa1]">India node · BRICS</span>
            {dataSources && (
              <span className="ml-1 text-[9px] text-[#7b8fa1]">
                · {dataSources.openaq === "configured" ? "OpenAQ live" : "OpenAQ demo"}
                · {dataSources.gemini === "configured" ? "Gemini live" : "Gemini demo"}
                · {dataSources.earth_engine === "enabled" ? "EE live" : "EE off"}
              </span>
            )}
          </div>
        </div>

        <SummaryCards backendOk={backendOk} refreshToken={refreshToken} inline />

        <div className="flex items-center gap-2">
          {bricsCount > 0 && (
            <span className="rounded-full border border-[#a870e8]/30 bg-[#a870e8]/8 px-2 py-0.5 text-[10px] font-medium text-[#7b5ea8]">
              BRICS {bricsCount}
            </span>
          )}

          <button onClick={() => setShowTour(true)}
            className="flex items-center gap-1 rounded-full border border-[#dde3ea] px-2.5 py-1 text-[11px] text-[#314154] hover:border-[#1a73e8]">
            <BookOpen size={11} /> Guide
          </button>

          <button onClick={seedDemo} disabled={seeding}
            className="flex items-center gap-1 rounded-full bg-[#1a73e8] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50">
            {seeding ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
            Seed demo
          </button>

          <div className="flex items-center gap-1.5 rounded-full border border-[#dde3ea] px-2.5 py-1">
            <span className="text-[11px] text-[#314154]">{session.name}</span>
            <span className="rounded-full bg-[rgba(26,115,232,0.1)] px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[#1a73e8]">
              {session.role}
            </span>
            <button onClick={handleLogout} className="text-[#7b8fa1] hover:text-[#314154]" title="Logout">
              <LogOut size={11} />
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[rgba(224,82,74,0.2)] bg-[rgba(224,82,74,0.06)] px-4 py-1.5 text-xs text-[#e0524a]">
          <WifiOff size={11} /> {error}
        </div>
      )}
      {seedMsg && !error && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[rgba(26,115,232,0.2)] bg-[rgba(26,115,232,0.06)] px-4 py-1.5 text-xs text-[#1a73e8]">
          <Zap size={11} /> {seedMsg}
          {lastUpdated && <span className="ml-auto text-[#7b8fa1]">{lastUpdated.toLocaleTimeString()}</span>}
        </div>
      )}

      <main className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden border-r border-[#dde3ea]">
          <HotspotMap
            hotspots={hotspots}
            selectedCell={selectedCell}
            onSelectCell={setSelectedCell}
            onOpenEvidence={openEvidence}
            refreshToken={refreshToken}
            flashCells={flashCells}
            bricsEvents={bricsEvents}
          />
          <ReportsFeed refreshToken={refreshToken} reportsBump={reportsBump} pendingReport={pendingReport} />
        </div>

        <div className="flex w-[340px] shrink-0 flex-col overflow-hidden border-r border-[#dde3ea]">
          {canReport && (
            <div className="shrink-0 border-b border-[#dde3ea]">
              <ReportPanel
                onReportSubmitted={handleReportSubmitted}
                session={session}
                sessionToken={sessionToken}
              />
            </div>
          )}
          {!canReport && session.role !== "citizen" && (
            <div className="shrink-0 border-b border-[#dde3ea] bg-[#f9fafb] px-4 py-2 text-[11px] text-[#5f6f86]">
              {session.role === "verifier" || session.role === "authority"
                ? "⚡ Authority Action Mode: Click on an incident or hotspot to take immediate action."
                : "Read-only view — switch role to take action."}
            </div>
          )}
          <div className="flex-1 overflow-hidden">
            <AlertQueue
              hotspots={hotspots}
              selectedCell={selectedCell}
              onSelectCell={setSelectedCell}
              onAcknowledge={handleAcknowledge}
              onOpenEvidence={openEvidence}
              onRefresh={refreshHotspots}
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
        {showResearch && (
          <div className="flex w-[300px] shrink-0 flex-col overflow-hidden">
            <ResearchPanel hotspots={hotspots} refreshToken={refreshToken} />
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

      <StatusToast
        toasts={toasts}
        onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))}
        onActionClick={(cell) => {
          setSelectedCell(cell);
          openEvidence(cell);
        }}
        role={session?.role}
      />
    </div>
  );
}

export default App;
