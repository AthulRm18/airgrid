import { useEffect, useState, useCallback } from "react";
import {
  Globe2,
  ArrowDownLeft,
  Loader2,
  Cpu,
  Boxes,
  Radio,
  Plus,
  X,
  Check,
  Copy,
  RefreshCw,
  Send,
  ShieldAlert,
  Clock,
  Tag,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { SEVERITY } from "../lib/severity";

const BRICS_INFO = {
  CN: { name: "China", color: "#e0524a", flag: "🇨🇳" },
  BR: { name: "Brazil", color: "#4fb8ac", flag: "🇧🇷" },
  RU: { name: "Russia", color: "#e8a23d", flag: "🇷🇺" },
  ZA: { name: "South Africa", color: "#a870e8", flag: "🇿🇦" },
  IN: { name: "India", color: "#1a73e8", flag: "🇮🇳" },
};

const PRIORITY_STYLES = {
  urgent: { bg: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500 animate-pulse" },
  high:   { bg: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  normal: { bg: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
};

export default function BricsPanel({ refreshToken, session, sessionToken }) {
  const [activeTab, setActiveTab] = useState("hotspots"); // "hotspots" | "models" | "resources"
  const [events, setEvents] = useState([]);
  const [models, setModels] = useState([]);
  const [resources, setResources] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  // Form states
  const [showShareModal, setShowShareModal] = useState(false);
  const [showResourceModal, setShowResourceModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  // Filter states
  const [countryFilter, setCountryFilter] = useState("ALL");
  const [targetVarFilter, setTargetVarFilter] = useState("ALL");

  // New Model form state
  const [newModel, setNewModel] = useState({
    origin_country: session?.country_code || "IN",
    model_name: "Gangetic-WinterSmog-Fusion",
    model_version: "v4.3",
    target_variable: "pm25",
    horizon_hours: 24,
    training_window_days: 21,
    rmse: "6.8",
    r2: "0.93",
    tags: "h3-hex, citizen-evidence, inversion-aware",
    artifact_uri: "brics://airgrid.in/models/gangetic-fusion:v4.3",
    notes: "Multimodal fusion ensemble tuned for Indo-Gangetic plain winter inversion traps.",
  });

  // New Resource request form state
  const [newResource, setNewResource] = useState({
    country_code: session?.country_code || "IN",
    request_type: "lidar_profiler",
    priority: "urgent",
    reason: "Boundary layer aerosol profiling needed for sensor-blind industrial corridor validation.",
    requested_for_h3_cell: "873e2182bffffff",
    resources_needed: "1x Mobile Raman LIDAR Unit, 1x Boundary Layer Ceilometer",
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const [fedRes, stRes, modelsRes, reqsRes] = await Promise.all([
        fetch("/api/brics/hotspots/federated").then((r) => (r.ok ? r.json() : { events: [] })),
        fetch("/api/brics/status").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/brics/models").then((r) => (r.ok ? r.json() : { models: [] })),
        fetch("/api/brics/resources/requests").then((r) => (r.ok ? r.json() : { requests: [] })),
      ]);

      setEvents(fedRes.events ?? []);
      setStatus(stRes);
      setModels(modelsRes.models ?? []);
      setResources(reqsRes.requests ?? []);
    } catch {
      setActionError("Unable to refresh BRICS federation feed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshToken]);

  const handleCopyUri = (uri, id) => {
    if (!uri) return;
    navigator.clipboard?.writeText(uri);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleShareModel = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setActionError(null);
    setActionSuccess(null);

    const headers = {
      "Content-Type": "application/json",
      ...(sessionToken ? { "X-Session-Token": sessionToken } : {}),
    };

    const payload = {
      origin_country: newModel.origin_country,
      model_name: newModel.model_name.trim(),
      model_version: newModel.model_version.trim(),
      target_variable: newModel.target_variable,
      horizon_hours: parseInt(newModel.horizon_hours, 10) || 24,
      training_window_days: parseInt(newModel.training_window_days, 10) || 14,
      metrics: {
        rmse: parseFloat(newModel.rmse) || 7.0,
        r2: parseFloat(newModel.r2) || 0.9,
      },
      tags: newModel.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      artifact_uri: newModel.artifact_uri.trim() || undefined,
      notes: newModel.notes.trim() || undefined,
    };

    try {
      const res = await fetch("/api/brics/models/share", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to share predictive model.");
      }

      setActionSuccess(`Model "${payload.model_name}" shared to BRICS federation registry!`);
      setShowShareModal(false);
      await fetchData();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestResource = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setActionError(null);
    setActionSuccess(null);

    const headers = {
      "Content-Type": "application/json",
      ...(sessionToken ? { "X-Session-Token": sessionToken } : {}),
    };

    const payload = {
      country_code: newResource.country_code,
      request_type: newResource.request_type,
      priority: newResource.priority,
      reason: newResource.reason.trim(),
      requested_for_h3_cell: newResource.requested_for_h3_cell.trim() || undefined,
      resources_needed: newResource.resources_needed
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean),
    };

    try {
      const res = await fetch("/api/brics/resources/request", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to dispatch resource coordination request.");
      }

      setActionSuccess("Resource coordination request broadcast to BRICS partners!");
      setShowResourceModal(false);
      await fetchData();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Filtered lists
  const filteredEvents = events.filter((ev) =>
    countryFilter === "ALL" ? true : ev.origin_country === countryFilter
  );

  const filteredModels = models.filter((m) => {
    const matchCountry = countryFilter === "ALL" ? true : m.origin_country === countryFilter;
    const matchTarget = targetVarFilter === "ALL" ? true : m.target_variable?.toLowerCase() === targetVarFilter.toLowerCase();
    return matchCountry && matchTarget;
  });

  const filteredResources = resources.filter((r) =>
    countryFilter === "ALL" ? true : r.country_code === countryFilter
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* Top Header */}
      <div className="shrink-0 border-b border-[#dde3ea] px-3.5 py-2.5 bg-gradient-to-r from-slate-50 via-white to-indigo-50/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50 border border-indigo-100 text-indigo-600">
              <Globe2 size={14} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-xs font-bold text-[#1a1f2e] tracking-tight">BRICS Federation</h2>
                <span className="rounded bg-indigo-100 px-1 py-0.2 text-[9px] font-semibold text-indigo-700">
                  brics.v1
                </span>
              </div>
              <p className="text-[10px] text-[#7b8fa1]">
                Node: <strong className="text-[#314154]">{status?.local_country || "IN"}</strong> · Partners: CN, BR, RU, ZA
              </p>
            </div>
          </div>
          <button
            onClick={fetchData}
            title="Refresh BRICS Federation Feed"
            className="rounded p-1 text-[#7b8fa1] hover:bg-[#eef1f5] hover:text-[#1a1f2e] transition-colors"
          >
            <RefreshCw size={12} className={loading ? "animate-spin text-indigo-600" : ""} />
          </button>
        </div>

        {/* Status / Success Alert */}
        {actionSuccess && (
          <div className="mt-2 flex items-center justify-between rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800 border border-emerald-200">
            <span>{actionSuccess}</span>
            <button onClick={() => setActionSuccess(null)} className="text-emerald-600 hover:text-emerald-900">
              <X size={12} />
            </button>
          </div>
        )}
        {actionError && (
          <div className="mt-2 flex items-center justify-between rounded bg-red-50 px-2 py-1 text-[11px] text-red-800 border border-red-200">
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} className="text-red-600 hover:text-red-900">
              <X size={12} />
            </button>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="mt-2.5 flex rounded-lg bg-[#eef1f5] p-0.5 text-[11px]">
          <button
            onClick={() => { setActiveTab("hotspots"); setShowShareModal(false); setShowResourceModal(false); }}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1 font-medium transition-all ${
              activeTab === "hotspots"
                ? "bg-white text-[#1a1f2e] shadow-sm font-semibold"
                : "text-[#5f6f86] hover:text-[#1a1f2e]"
            }`}
          >
            <Radio size={11} className={activeTab === "hotspots" ? "text-indigo-600" : ""} />
            <span>Hotspots</span>
            <span className="rounded-full bg-slate-200/80 px-1 text-[9px] font-semibold text-slate-700">
              {events.length}
            </span>
          </button>

          <button
            onClick={() => { setActiveTab("models"); setShowShareModal(false); setShowResourceModal(false); }}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1 font-medium transition-all ${
              activeTab === "models"
                ? "bg-white text-[#1a1f2e] shadow-sm font-semibold"
                : "text-[#5f6f86] hover:text-[#1a1f2e]"
            }`}
          >
            <Cpu size={11} className={activeTab === "models" ? "text-indigo-600" : ""} />
            <span>Models</span>
            <span className="rounded-full bg-slate-200/80 px-1 text-[9px] font-semibold text-slate-700">
              {models.length}
            </span>
          </button>

          <button
            onClick={() => { setActiveTab("resources"); setShowShareModal(false); setShowResourceModal(false); }}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1 font-medium transition-all ${
              activeTab === "resources"
                ? "bg-white text-[#1a1f2e] shadow-sm font-semibold"
                : "text-[#5f6f86] hover:text-[#1a1f2e]"
            }`}
          >
            <Boxes size={11} className={activeTab === "resources" ? "text-indigo-600" : ""} />
            <span>Resources</span>
            <span className="rounded-full bg-slate-200/80 px-1 text-[9px] font-semibold text-slate-700">
              {resources.length}
            </span>
          </button>
        </div>

        {/* Secondary Sub-toolbar (Filter & Action) */}
        <div className="mt-2 flex items-center justify-between text-[10px]">
          <div className="flex items-center gap-1">
            <span className="text-[#7b8fa1]">Origin:</span>
            <select
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
              className="rounded border border-[#dde3ea] bg-white px-1.5 py-0.5 text-[10px] text-[#314154] focus:outline-none"
            >
              <option value="ALL">All BRICS</option>
              <option value="CN">🇨🇳 China</option>
              <option value="BR">🇧🇷 Brazil</option>
              <option value="RU">🇷🇺 Russia</option>
              <option value="ZA">🇿🇦 South Africa</option>
              <option value="IN">🇮🇳 India</option>
            </select>
          </div>

          {activeTab === "models" && (
            <button
              onClick={() => setShowShareModal((prev) => !prev)}
              className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-0.5 font-medium text-white hover:bg-indigo-700 transition-colors shadow-xs"
            >
              {showShareModal ? <X size={10} /> : <Plus size={10} />}
              <span>{showShareModal ? "Cancel" : "Share Model"}</span>
            </button>
          )}

          {activeTab === "resources" && (
            <button
              onClick={() => setShowResourceModal((prev) => !prev)}
              className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-0.5 font-medium text-white hover:bg-indigo-700 transition-colors shadow-xs"
            >
              {showResourceModal ? <X size={10} /> : <Plus size={10} />}
              <span>{showResourceModal ? "Cancel" : "Request Aid"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto">
        {loading && !events.length && !models.length && !resources.length ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-xs text-[#7b8fa1]">
            <Loader2 size={16} className="animate-spin text-indigo-600" />
            <span>Connecting to BRICS federation registry…</span>
          </div>
        ) : (
          <>
            {/* ------------------------------------------------------------- */}
            {/* TAB 1: TRANSBOUNDARY HOTSPOTS                                */}
            {/* ------------------------------------------------------------- */}
            {activeTab === "hotspots" && (
              <div>
                {filteredEvents.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-[#7b8fa1]">
                    No federated events match current filter. Click <strong className="text-[#1a1f2e]">Seed demo</strong> to reload cross-border signals.
                  </div>
                ) : (
                  <div className="divide-y divide-[#dde3ea]">
                    {filteredEvents.map((ev) => {
                      const sev = SEVERITY[ev.severity] ?? SEVERITY.unverified;
                      const conf = Math.round((ev.confidence_score || 0) * 100);
                      const originInfo = BRICS_INFO[ev.origin_country] || { flag: "🌐", name: ev.origin_country, color: "#a870e8" };

                      return (
                        <div
                          key={ev.dedupe_key || `${ev.origin_country}-${ev.h3_cell}-${ev.timestamp}`}
                          className="px-3.5 py-3 hover:bg-slate-50/60 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm">{originInfo.flag}</span>
                              <span
                                className="rounded px-1.5 py-0.2 text-[10px] font-bold text-white"
                                style={{ backgroundColor: originInfo.color }}
                              >
                                {ev.origin_country} → IN
                              </span>
                              <span
                                className="rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                                style={{ color: sev.rawColor, backgroundColor: `${sev.rawColor}18` }}
                              >
                                {sev.label}
                              </span>
                            </div>
                            <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.2">
                              {conf}% conf
                            </span>
                          </div>

                          <p className="mt-1 text-[11px] text-[#475569] leading-relaxed">
                            {ev.evidence_summary || "Transboundary dispersion signal detected via satellite and sensor mesh."}
                          </p>

                          <div className="mt-1.5 flex items-center justify-between text-[9px] text-[#7b8fa1]">
                            <span className="font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-600">
                              {ev.h3_cell?.slice(0, 11)}…
                            </span>
                            <span>{ev.source_system || "AirGrid Federation"}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ------------------------------------------------------------- */}
            {/* TAB 2: SHARED PREDICTIVE MODELS                              */}
            {/* ------------------------------------------------------------- */}
            {activeTab === "models" && (
              <div>
                {/* Collapsible Share Model Form */}
                {showShareModal && (
                  <form onSubmit={handleShareModel} className="border-b border-indigo-100 bg-indigo-50/40 p-3 space-y-2">
                    <div className="flex items-center justify-between pb-1 border-b border-indigo-100/60">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-950">
                        <Cpu size={12} className="text-indigo-600" />
                        <span>Publish Model to Federation</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowShareModal(false)}
                        className="text-slate-400 hover:text-slate-600"
                      >
                        <X size={12} />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div>
                        <label className="block text-[9px] font-medium text-slate-600">Publishing Node</label>
                        <select
                          value={newModel.origin_country}
                          onChange={(e) => setNewModel({ ...newModel, origin_country: e.target.value })}
                          className="w-full mt-0.5 rounded border border-[#dde3ea] bg-white p-1 text-[10px]"
                        >
                          <option value="IN">🇮🇳 India (Local)</option>
                          <option value="CN">🇨🇳 China</option>
                          <option value="BR">🇧🇷 Brazil</option>
                          <option value="RU">🇷🇺 Russia</option>
                          <option value="ZA">🇿🇦 South Africa</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[9px] font-medium text-slate-600">Target Metric</label>
                        <select
                          value={newModel.target_variable}
                          onChange={(e) => setNewModel({ ...newModel, target_variable: e.target.value })}
                          className="w-full mt-0.5 rounded border border-[#dde3ea] bg-white p-1 text-[10px]"
                        >
                          <option value="pm25">PM2.5 (Particulate)</option>
                          <option value="so2">SO₂ (Sulfur Dioxide)</option>
                          <option value="aerosol_optical_depth">AOD (Satellite)</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                      <div className="col-span-2">
                        <label className="block text-[9px] font-medium text-slate-600">Model Name</label>
                        <input
                          type="text"
                          required
                          value={newModel.model_name}
                          onChange={(e) => setNewModel({ ...newModel, model_name: e.target.value })}
                          className="w-full mt-0.5 rounded border border-[#dde3ea] bg-white p-1 text-[10px]"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-medium text-slate-600">Version</label>
                        <input
                          type="text"
                          required
                          value={newModel.model_version}
                          onChange={(e) => setNewModel({ ...newModel, model_version: e.target.value })}
                          className="w-full mt-0.5 rounded border border-[#dde3ea] bg-white p-1 text-[10px]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div>
                        <label className="block text-[9px] font-medium text-slate-600">RMSE</label>
                        <input
                          type="text"
                          value={newModel.rmse}
                          onChange={(e) => setNewModel({ ...newModel, rmse: e.target.value })}
                          className="w-full mt-0.5 rounded border border-[#dde3ea] bg-white p-1 text-[10px]"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-medium text-slate-600">R² Score</label>
                        <input
                          type="text"
                          value={newModel.r2}
                          onChange={(e) => setNewModel({ ...newModel, r2: e.target.value })}
                          className="w-full mt-0.5 rounded border border-[#dde3ea] bg-white p-1 text-[10px]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[9px] font-medium text-slate-600">Artifact URI</label>
                      <input
                        type="text"
                        value={newModel.artifact_uri}
                        onChange={(e) => setNewModel({ ...newModel, artifact_uri: e.target.value })}
                        className="w-full mt-0.5 rounded border border-[#dde3ea] bg-white p-1 text-[10px] font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[9px] font-medium text-slate-600">Notes / Scope</label>
                      <textarea
                        rows={2}
                        value={newModel.notes}
                        onChange={(e) => setNewModel({ ...newModel, notes: e.target.value })}
                        className="w-full mt-0.5 rounded border border-[#dde3ea] bg-white p-1 text-[10px]"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full flex items-center justify-center gap-1.5 rounded bg-indigo-600 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors shadow-xs"
                    >
                      {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                      <span>Broadcast to BRICS Registry</span>
                    </button>
                  </form>
                )}

                {/* Model Cards List */}
                {filteredModels.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-[#7b8fa1]">
                    No shared models registered. Click <strong className="text-[#1a1f2e]">Share Model</strong> above or reload via Seed demo.
                  </div>
                ) : (
                  <div className="divide-y divide-[#dde3ea]">
                    {filteredModels.map((m) => {
                      const originInfo = BRICS_INFO[m.origin_country] || { flag: "🌐", name: m.origin_country, color: "#6366f1" };
                      const mid = m.model_id || `${m.origin_country}:${m.model_name}:${m.model_version}`;

                      return (
                        <div key={mid} className="p-3.5 hover:bg-slate-50/60 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs">{originInfo.flag}</span>
                                <span
                                  className="rounded px-1.5 py-0.2 text-[9px] font-bold text-white"
                                  style={{ backgroundColor: originInfo.color }}
                                >
                                  {m.origin_country}
                                </span>
                                <span className="text-xs font-bold text-[#1a1f2e]">{m.model_name}</span>
                                <span className="rounded bg-slate-100 px-1 py-0.2 text-[9px] font-mono text-slate-600">
                                  {m.model_version}
                                </span>
                              </div>
                            </div>
                            <span className="rounded bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-indigo-700 shrink-0">
                              {m.target_variable || "pm25"} · {m.horizon_hours || 24}h
                            </span>
                          </div>

                          {m.notes && (
                            <p className="mt-1.5 text-[11px] text-[#475569] leading-relaxed">
                              {m.notes}
                            </p>
                          )}

                          {/* Metrics chips */}
                          {m.metrics && Object.keys(m.metrics).length > 0 && (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[9px]">
                              {m.metrics.r2 !== undefined && (
                                <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700 border border-emerald-200">
                                  R² {m.metrics.r2}
                                </span>
                              )}
                              {m.metrics.rmse !== undefined && (
                                <span className="rounded bg-blue-50 px-1.5 py-0.5 font-semibold text-blue-700 border border-blue-200">
                                  RMSE {m.metrics.rmse} µg/m³
                                </span>
                              )}
                              {m.metrics.mae !== undefined && (
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                                  MAE {m.metrics.mae}
                                </span>
                              )}
                              {m.training_window_days && (
                                <span className="text-[9px] text-[#7b8fa1]">
                                  {m.training_window_days}d training
                                </span>
                              )}
                            </div>
                          )}

                          {/* Tags */}
                          {Array.isArray(m.tags) && m.tags.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {m.tags.map((t) => (
                                <span key={t} className="rounded bg-slate-100 px-1 py-0.2 text-[8px] text-slate-600 font-medium">
                                  #{t}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Artifact URI */}
                          {m.artifact_uri && (
                            <div className="mt-2 flex items-center justify-between rounded bg-slate-50 px-2 py-1 border border-slate-200/60 text-[9px]">
                              <span className="font-mono text-slate-600 truncate mr-2" title={m.artifact_uri}>
                                {m.artifact_uri}
                              </span>
                              <button
                                onClick={() => handleCopyUri(m.artifact_uri, mid)}
                                className="flex items-center gap-0.5 text-indigo-600 hover:text-indigo-800 shrink-0 font-medium"
                              >
                                {copiedId === mid ? (
                                  <>
                                    <Check size={10} className="text-emerald-600" />
                                    <span className="text-emerald-600 text-[8px]">Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy size={10} />
                                    <span className="text-[8px]">Copy</span>
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ------------------------------------------------------------- */}
            {/* TAB 3: RESOURCE COORDINATION                                 */}
            {/* ------------------------------------------------------------- */}
            {activeTab === "resources" && (
              <div>
                {/* Collapsible Resource Request Form */}
                {showResourceModal && (
                  <form onSubmit={handleRequestResource} className="border-b border-indigo-100 bg-indigo-50/40 p-3 space-y-2">
                    <div className="flex items-center justify-between pb-1 border-b border-indigo-100/60">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-950">
                        <Boxes size={12} className="text-indigo-600" />
                        <span>Dispatch Resource Aid Request</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowResourceModal(false)}
                        className="text-slate-400 hover:text-slate-600"
                      >
                        <X size={12} />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div>
                        <label className="block text-[9px] font-medium text-slate-600">Originating Node</label>
                        <select
                          value={newResource.country_code}
                          onChange={(e) => setNewResource({ ...newResource, country_code: e.target.value })}
                          className="w-full mt-0.5 rounded border border-[#dde3ea] bg-white p-1 text-[10px]"
                        >
                          <option value="IN">🇮🇳 India (Local)</option>
                          <option value="CN">🇨🇳 China</option>
                          <option value="BR">🇧🇷 Brazil</option>
                          <option value="RU">🇷🇺 Russia</option>
                          <option value="ZA">🇿🇦 South Africa</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[9px] font-medium text-slate-600">Priority Level</label>
                        <select
                          value={newResource.priority}
                          onChange={(e) => setNewResource({ ...newResource, priority: e.target.value })}
                          className="w-full mt-0.5 rounded border border-[#dde3ea] bg-white p-1 text-[10px]"
                        >
                          <option value="urgent">🔴 Urgent</option>
                          <option value="high">🟡 High</option>
                          <option value="normal">🔵 Normal</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[9px] font-medium text-slate-600">Request Type</label>
                      <select
                        value={newResource.request_type}
                        onChange={(e) => setNewResource({ ...newResource, request_type: e.target.value })}
                        className="w-full mt-0.5 rounded border border-[#dde3ea] bg-white p-1 text-[10px]"
                      >
                        <option value="lidar_profiler">Mobile Raman LIDAR Profiler</option>
                        <option value="aerial_drone_monitoring">Multispectral Drone Sampling</option>
                        <option value="sensor_calibration_unit">Transfer Standard Calibration Unit</option>
                        <option value="satellite_tasking">Emergency Satellite Tasking</option>
                        <option value="expert_dispatch">Transboundary Modeling Taskforce</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[9px] font-medium text-slate-600">Target H3 Cell (Optional)</label>
                      <input
                        type="text"
                        value={newResource.requested_for_h3_cell}
                        onChange={(e) => setNewResource({ ...newResource, requested_for_h3_cell: e.target.value })}
                        className="w-full mt-0.5 rounded border border-[#dde3ea] bg-white p-1 text-[10px] font-mono"
                        placeholder="873e2182bffffff"
                      />
                    </div>

                    <div>
                      <label className="block text-[9px] font-medium text-slate-600">Required Hardware / Assets</label>
                      <input
                        type="text"
                        required
                        value={newResource.resources_needed}
                        onChange={(e) => setNewResource({ ...newResource, resources_needed: e.target.value })}
                        className="w-full mt-0.5 rounded border border-[#dde3ea] bg-white p-1 text-[10px]"
                        placeholder="e.g. 1x Mobile Raman LIDAR Unit, 2x Particulate Samplers"
                      />
                    </div>

                    <div>
                      <label className="block text-[9px] font-medium text-slate-600">Operational Justification</label>
                      <textarea
                        rows={2}
                        required
                        value={newResource.reason}
                        onChange={(e) => setNewResource({ ...newResource, reason: e.target.value })}
                        className="w-full mt-0.5 rounded border border-[#dde3ea] bg-white p-1 text-[10px]"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full flex items-center justify-center gap-1.5 rounded bg-indigo-600 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors shadow-xs"
                    >
                      {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                      <span>Broadcast Request to Partners</span>
                    </button>
                  </form>
                )}

                {/* Resource Requests List */}
                {filteredResources.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-[#7b8fa1]">
                    No resource coordination requests active. Click <strong className="text-[#1a1f2e]">Request Aid</strong> above.
                  </div>
                ) : (
                  <div className="divide-y divide-[#dde3ea]">
                    {filteredResources.map((req) => {
                      const originInfo = BRICS_INFO[req.country_code] || { flag: "🌐", name: req.country_code, color: "#6366f1" };
                      const priorityConfig = PRIORITY_STYLES[req.priority] || PRIORITY_STYLES.normal;

                      return (
                        <div key={req.id || `${req.country_code}-${req.request_type}`} className="p-3.5 hover:bg-slate-50/60 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs">{originInfo.flag}</span>
                              <span
                                className="rounded px-1.5 py-0.2 text-[9px] font-bold text-white"
                                style={{ backgroundColor: originInfo.color }}
                              >
                                {req.country_code}
                              </span>
                              <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider ${priorityConfig.bg}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${priorityConfig.dot}`} />
                                {req.priority}
                              </span>
                            </div>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-700 uppercase tracking-wide">
                              {req.status || "open"}
                            </span>
                          </div>

                          <h3 className="mt-1.5 text-xs font-bold text-[#1a1f2e] capitalize">
                            {req.request_type?.replace(/_/g, " ")}
                          </h3>

                          <p className="mt-1 text-[11px] text-[#475569] leading-relaxed">
                            {req.reason}
                          </p>

                          {/* Needed resources list */}
                          {Array.isArray(req.resources_needed) && req.resources_needed.length > 0 && (
                            <div className="mt-2 space-y-1">
                              <span className="text-[9px] font-medium text-slate-500">Requested Capabilities:</span>
                              <div className="flex flex-wrap gap-1">
                                {req.resources_needed.map((item, idx) => (
                                  <span
                                    key={idx}
                                    className="rounded bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 text-[9px] font-medium text-indigo-800"
                                  >
                                    {item}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="mt-2 flex items-center justify-between text-[9px] text-[#7b8fa1]">
                            {req.requested_for_h3_cell ? (
                              <span className="font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-600">
                                Cell: {req.requested_for_h3_cell.slice(0, 11)}…
                              </span>
                            ) : (
                              <span>Corridor-wide request</span>
                            )}
                            <span className="font-mono">{req.id?.slice(0, 14)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
