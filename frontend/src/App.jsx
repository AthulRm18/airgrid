import { useEffect, useState, useCallback } from "react";
import { Wind, RadioTower } from "lucide-react";
import HotspotMap from "./components/HotspotMap";
import AlertQueue from "./components/AlertQueue";
import ReportPanel from "./components/ReportPanel";

const POLL_INTERVAL_MS = 8000;

function App() {
  const [hotspots, setHotspots] = useState([]);
  const [selectedCell, setSelectedCell] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/hotspots");
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      setHotspots(data.hotspots ?? []);
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      setError("Can't reach the backend — is uvicorn running on :8000?");
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  async function handleAcknowledge(h3Cell, actionTaken) {
    await fetch("/api/hotspots/acknowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ h3_cell: h3Cell, action_taken: actionTaken }),
    });
  }

  const hiddenCount = hotspots.filter((h) => h.severity === "hidden").length;

  return (
    <div className="min-h-screen bg-[var(--color-ink-950)]">
      <header className="border-b border-[var(--color-ink-700)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Wind size={22} className="text-[var(--color-clear-400)]" />
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-xl text-[var(--color-mist-50)] leading-tight">
              AirGrid
            </h1>
            <p className="text-xs text-[var(--color-mist-400)]">
              Clean Air &amp; Climate Resilience — District Command Centre
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
              {hiddenCount} hidden hotspot{hiddenCount === 1 ? "" : "s"} — no official sensor coverage
            </span>
          )}
          {error ? (
            <span className="text-[var(--color-sev-confirmed)]">{error}</span>
          ) : (
            lastUpdated && (
              <span>Updated {lastUpdated.toLocaleTimeString()}</span>
            )
          )}
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5 p-6">
        <div className="space-y-5">
          <HotspotMap
            hotspots={hotspots}
            selectedCell={selectedCell}
            onSelectCell={setSelectedCell}
          />
          <ReportPanel onReportSubmitted={refresh} />
        </div>

        <AlertQueue
          hotspots={hotspots}
          selectedCell={selectedCell}
          onSelectCell={setSelectedCell}
          onAcknowledge={handleAcknowledge}
        />
      </main>
    </div>
  );
}

export default App;
