import { useEffect, useState, useCallback, useRef } from "react";
import { Shield, RadioTower, Loader2, Zap, WifiOff } from "lucide-react";
import SummaryCards from "./components/SummaryCards";
import HotspotMap from "./components/HotspotMap";
import AlertQueue from "./components/AlertQueue";
import ReportPanel from "./components/ReportPanel";
import EvidencePanel from "./components/EvidencePanel";

const POLL_INTERVAL_MS = 8000;
const HOTSPOT_TIMEOUT_MS = 12000;
const HEALTH_TIMEOUT_MS = 5000;
const OFFLINE_FAIL_THRESHOLD = 2;

function App() {
  const [hotspots, setHotspots] = useState([]);
  const [selectedCell, setSelectedCell] = useState(null);
  const [evidenceCell, setEvidenceCell] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [backendOk, setBackendOk] = useState(null);
  const [seedStatus, setSeedStatus] = useState("");
  const autoSeedAttempted = useRef(false);
  const consecutiveFailures = useRef(0);

  const checkBackendHealth = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const res = await fetch("/api/health", { signal: controller.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HOTSPOT_TIMEOUT_MS);
      const res = await fetch("/api/hotspots", { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      setHotspots(data.hotspots ?? []);
      setLastUpdated(new Date());
      setError(null);
      setBackendOk(true);
      consecutiveFailures.current = 0;
      return data.hotspots ?? [];
    } catch {
      consecutiveFailures.current += 1;
      const healthy = await checkBackendHealth();
      if (healthy) {
        setBackendOk(true);
        setError("Live feed delayed. Retrying...");
        return null;
      }

      if (consecutiveFailures.current >= OFFLINE_FAIL_THRESHOLD) {
        setError("Backend offline. Start backend on port 8000.");
        setBackendOk(false);
      } else {
        setError("Reconnecting to backend...");
      }
      return null;
    }
  }, [checkBackendHealth]);

  useEffect(() => {
    async function init() {
      const spots = await refresh();
      // If backend is up but empty (e.g. auto-seed disabled), seed once.
      if (Array.isArray(spots) && spots.length === 0 && !autoSeedAttempted.current) {
        autoSeedAttempted.current = true;
        try {
          const health = await fetch("/api/health");
          if (health.ok) {
            await fetch("/api/demo/seed", { method: "POST" });
            await refresh();
          }
        } catch { /* ignore */ }
      }
    }
    init();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  async function handleAcknowledge(h3Cell, actionTaken) {
    await fetch("/api/hotspots/acknowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ h3_cell: h3Cell, action_taken: actionTaken }),
    });
    refresh();
  }

  async function seedDemo() {
    setSeeding(true);
    setSeedStatus("");
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch("/api/demo/seed", { method: "POST", signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`seed status ${res.status}`);
      const seeded = await res.json();
      await refresh();
      setSeedStatus(`Seeded ${seeded?.seeded ?? 0} demo reports`);
    } finally {
      setSeeding(false);
    }
  }

  const hiddenCount = hotspots.filter((h) => h.severity === "hidden").length;

  return (
    <div className="min-h-screen bg-[var(--color-ink-950)]">
      {/* Header */}
      <header className="border-b border-[var(--color-ink-700)] px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Shield size={22} className="text-[var(--color-clear-400)]" />
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-xl text-[var(--color-mist-50)] leading-tight tracking-tight">
              VIGIL
            </h1>
            <p className="text-[10px] text-[var(--color-mist-400)] tracking-wide uppercase">
              Environmental intelligence before exposure
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs text-[var(--color-mist-400)]">
          {hiddenCount > 0 && (
            <span
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
              style={{ backgroundColor: "color-mix(in srgb, var(--color-sev-hidden) 18%, transparent)" }}
            >
              <RadioTower size={12} style={{ color: "var(--color-sev-hidden)" }} />
              {hiddenCount} hidden hotspot{hiddenCount === 1 ? "" : "s"}
            </span>
          )}

          <button
            onClick={seedDemo}
            disabled={seeding}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 border border-[var(--color-ink-600)] hover:border-[var(--color-clear-500)] transition-colors disabled:opacity-40"
          >
            {seeding ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
            Seed demo
          </button>

          {error ? (
            <span className="text-[var(--color-sev-confirmed)]">{error}</span>
          ) : (
            lastUpdated && (
              <span>Updated {lastUpdated.toLocaleTimeString()}</span>
            )
          )}
          {!error && seedStatus && (
            <span className="text-[var(--color-clear-400)]">{seedStatus}</span>
          )}
        </div>
      </header>

      {/* Summary Cards */}
      <div className="px-6 pt-4">
        {backendOk === false && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--color-sev-confirmed)] bg-[rgba(224,82,74,0.1)] px-4 py-2.5 text-sm text-[var(--color-mist-200)]">
            <WifiOff size={16} className="text-[var(--color-sev-confirmed)] shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <SummaryCards backendOk={backendOk} />
      </div>

      {/* Main content */}
      <main className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-5 p-6 pt-4">
        <div className="space-y-5">
          <HotspotMap
            hotspots={hotspots}
            selectedCell={selectedCell}
            onSelectCell={setSelectedCell}
            onOpenEvidence={setEvidenceCell}
          />
          <ReportPanel onReportSubmitted={refresh} />
        </div>

        <AlertQueue
          hotspots={hotspots}
          selectedCell={selectedCell}
          onSelectCell={setSelectedCell}
          onAcknowledge={handleAcknowledge}
          onOpenEvidence={setEvidenceCell}
        />
      </main>

      {/* Evidence Panel (slides in from right) */}
      {evidenceCell && (
        <EvidencePanel
          h3Cell={evidenceCell}
          onClose={() => setEvidenceCell(null)}
        />
      )}
    </div>
  );
}

export default App;
