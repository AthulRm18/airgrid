import { useMemo, useRef, useState, useEffect } from "react";
import { CheckCircle2, Loader2, Mic, MicOff, Send, UploadCloud, MapPin, Navigation, X, AlertTriangle, Eye, Flame, Wind, CloudRain } from "lucide-react";

// Supported regional languages for voice input
const VOICE_LANGS = [
  { label: "हिंदी (Hindi)",      code: "hi-IN" },
  { label: "മലയാളം (Malayalam)", code: "ml-IN" },
  { label: "தமிழ் (Tamil)",      code: "ta-IN" },
  { label: "বাংলা (Bengali)",    code: "bn-IN" },
  { label: "English",             code: "en-IN" },
];

const LOCATIONS = [
  // Delhi-NCR
  { label: "Anand Vihar, Delhi", lat: 28.6469, lng: 77.3157, region: "Delhi-NCR" },
  { label: "Rohini, Delhi", lat: 28.7041, lng: 77.1025, region: "Delhi-NCR" },
  { label: "Noida Sector 62, UP", lat: 28.628, lng: 77.364, region: "Delhi-NCR" },
  { label: "Ghaziabad Industrial, UP", lat: 28.669, lng: 77.453, region: "Delhi-NCR" },
  { label: "Connaught Place, Delhi", lat: 28.6315, lng: 77.2167, region: "Delhi-NCR" },
  // Kerala / South
  { label: "Eloor Industrial, Kochi (Kerala)", lat: 10.0760, lng: 76.2990, region: "Kerala" },
  { label: "Brahmapuram, Kochi (Kerala)", lat: 9.9880, lng: 76.3620, region: "Kerala" },
  { label: "Vyttila Hub, Kochi (Kerala)", lat: 9.9656, lng: 76.3219, region: "Kerala" },
  { label: "Pattom, Thiruvananthapuram", lat: 8.5241, lng: 76.9366, region: "Kerala" },
  // Mumbai / West
  { label: "Chembur Industrial, Mumbai", lat: 19.0522, lng: 72.9005, region: "Mumbai" },
  { label: "Bandra Kurla Complex, Mumbai", lat: 19.0657, lng: 72.8687, region: "Mumbai" },
  { label: "Navi Mumbai Industrial", lat: 19.1075, lng: 73.0033, region: "Mumbai" },
  // Bengaluru
  { label: "Peenya Industrial, Bengaluru", lat: 13.0285, lng: 77.5197, region: "Bengaluru" },
  { label: "Whitefield, Bengaluru", lat: 12.9698, lng: 77.7500, region: "Bengaluru" },
  // Kolkata
  { label: "Howrah Industrial, Kolkata", lat: 22.5958, lng: 88.2636, region: "Kolkata" },
  { label: "Salt Lake Sector V, Kolkata", lat: 22.5804, lng: 88.4378, region: "Kolkata" },
  // Hyderabad & Chennai
  { label: "Sanathnagar, Hyderabad", lat: 17.4565, lng: 78.4439, region: "Hyderabad" },
  { label: "Manali Petrochemical, Chennai", lat: 13.1667, lng: 80.2667, region: "Chennai" },
];

export default function ReportPanel({
  onReportSubmitted,
  session,
  sessionToken,
  onLocationChange,
  activeRegion = "all",
  onRegionChange,
}) {
  const [text, setText] = useState("");
  const [locationHint, setLocationHint] = useState("");
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [locationIdx, setLocationIdx] = useState(0);
  const [gpsCoords, setGpsCoords] = useState(null);
  const [gettingGps, setGettingGps] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [lastResult, setLastResult] = useState(null);
  const [recording, setRecording] = useState(false);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [voiceLang, setVoiceLang] = useState("hi-IN");
  const [voiceMeta, setVoiceMeta] = useState(null);
  const recognitionRef = useRef(null);
  const submitAbortRef = useRef(null);

  // Sync dropdown when activeRegion changes (e.g. from map city click)
  useEffect(() => {
    if (!activeRegion || activeRegion === "all") return;
    const regionMap = {
      delhi: "Delhi-NCR",
      kerala: "Kerala",
      mumbai: "Mumbai",
      bengaluru: "Bengaluru",
      kolkata: "Kolkata",
      hyderabad: "Hyderabad",
      chennai: "Chennai",
    };
    const targetRegion = regionMap[activeRegion];
    if (targetRegion) {
      const foundIdx = LOCATIONS.findIndex((l) => l.region === targetRegion);
      if (foundIdx !== -1) {
        setLocationIdx(foundIdx);
        setGpsCoords(null);
      }
    }
  }, [activeRegion]);

  const coords = gpsCoords || LOCATIONS[locationIdx] || LOCATIONS[0];
  const canSubmit = useMemo(
    () => Boolean(text.trim() || photo) && !submitting && !recording,
    [text, photo, submitting, recording],
  );

  function handleUseGps() {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }
    setGettingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const custom = {
          label: `GPS (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})`,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          region: "Current Location",
        };
        setGpsCoords(custom);
        setGettingGps(false);
        onLocationChange?.(custom);
      },
      (err) => {
        setGettingGps(false);
        alert("Could not retrieve GPS: " + (err.message || "Permission denied"));
      },
      { timeout: 10000 }
    );
  }

  function startVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice input requires Chrome or Edge.");
      return;
    }
    setSubmitError("");
    setLastResult(null);
    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = voiceLang;
    recognitionRef.current = rec;
    rec.onstart = () => setRecording(true);
    rec.onend = () => setRecording(false);
    rec.onresult = async (event) => {
      const transcript = event.results[0][0].transcript;
      setText(transcript);
      setLastResult(null);
      setVoiceProcessing(true);
      try {
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), 18000);
        const res = await fetch("/api/voice-transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript, lang: voiceLang }),
          signal: ctrl.signal,
        });
        if (res.ok) {
          const data = await res.json();
          setText(data.translated || transcript);
          setVoiceMeta({
            haze_score: data.haze_score,
            event_type: data.event_type,
            severity: data.severity,
          });
          if (data.extracted_location_hint) {
            setLocationHint(data.extracted_location_hint);
          }
        }
      } catch {
        setVoiceMeta(null);
      } finally {
        setVoiceProcessing(false);
      }
    };
    rec.onerror = () => {
      setRecording(false);
      setVoiceProcessing(false);
    };
    rec.start();
  }

  function stopVoice() {
    recognitionRef.current?.stop();
    setRecording(false);
  }

  function cancelSubmit() {
    submitAbortRef.current?.abort();
    setSubmitting(false);
    setSubmitError("Submit cancelled — try again");
  }

  async function submitIncident() {
    if (!text.trim() && !photo) return;
    if (submitting) return;

    submitAbortRef.current?.abort();
    const controller = new AbortController();
    submitAbortRef.current = controller;

    const submittedText = text.trim();
    setSubmitting(true);
    setSubmitError("");
    setLastResult(null);

    const form = new FormData();
    form.append("lat", String(coords.lat));
    form.append("lng", String(coords.lng));
    form.append("text", submittedText);
    form.append("location_hint", locationHint.trim() || coords.label);
    form.append("country_code", session?.country_code || "IN");
    // Reuse voice Gemini result so submit doesn't wait on a second Gemini call
    if (voiceMeta?.haze_score != null) {
      form.append("haze_score", String(voiceMeta.haze_score));
      form.append("skip_gemini", "true");
    }
    if (photo) form.append("file", photo);

    const timeoutId = setTimeout(() => controller.abort(), 45000);

    try {
      const headers = sessionToken ? { "X-Session-Token": sessionToken } : undefined;
      const res = await fetch("/api/incidents/report", {
        method: "POST", body: form, headers, signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`Submit failed (${res.status})`);
      const data = await res.json();
      // Ensure feed gets the text even if backend omits it
      if (!data.text) data.text = submittedText;
      setLastResult(data);
      setText("");
      setLocationHint("");
      setPhoto(null);
      setPhotoPreview(null);
      setVoiceMeta(null);
      setSubmitError("");
      onReportSubmitted(data);
    } catch (err) {
      if (err.name === "AbortError") {
        setSubmitError("Request took too long — please try submitting again.");
      } else {
        setSubmitError(err?.message || "Could not submit. Please retry.");
      }
    } finally {
      clearTimeout(timeoutId);
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white px-4 py-3">
      <h2 className="text-sm font-semibold text-[#1a1f2e] mb-2">Report incident</h2>

      <div className="space-y-2">
        <div className="relative">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setVoiceMeta(null);
              if (lastResult) setLastResult(null);
              if (submitError) setSubmitError("");
            }}
            placeholder="Describe smoke, haze, or smell…"
            rows={2}
            className="w-full rounded-lg border border-[#dde3ea] px-3 py-2 pr-10 text-sm text-[#1a1f2e] placeholder:text-[#7b8fa1] focus:border-[#1a73e8] focus:outline-none resize-none"
          />
          <button
            type="button"
            onClick={recording ? stopVoice : startVoice}
            disabled={voiceProcessing || submitting}
            className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full disabled:opacity-40 transition-colors ${
              recording
                ? "bg-[#e0524a] mic-recording-pulse"
                : "bg-[#f0f4f9]"
            }`}
            title={recording ? "Stop recording" : "Start voice input"}
          >
            {voiceProcessing ? (
              <Loader2 size={12} className="animate-spin text-[#1a73e8]" />
            ) : recording ? (
              <MicOff size={12} className="text-white" />
            ) : (
              <Mic size={12} className="text-[#1a73e8]" />
            )}
          </button>
        </div>

        {/* Listening indicator */}
        {recording && (
          <div className="flex items-center gap-2 rounded-lg bg-[rgba(224,82,74,0.06)] border border-[rgba(224,82,74,0.15)] px-3 py-1.5 animate-fade-in">
            <span className="mic-recording-dot" />
            <span className="text-[11px] font-medium text-[#e0524a]">Listening…</span>
            <span className="text-[10px] text-[#7b8fa1]">speak now</span>
            <div className="ml-auto flex items-center gap-0.5">
              {[1,2,3,4,5].map((i) => (
                <span key={i} className="mic-bar" style={{ animationDelay: `${i * 0.1}s` }} />
              ))}
            </div>
          </div>
        )}

        {/* Voice language selector */}
        <div className="flex items-center gap-1.5">
          <Mic size={10} className="text-[#7b8fa1] shrink-0" />
          <select
            value={voiceLang}
            onChange={(e) => setVoiceLang(e.target.value)}
            disabled={recording || voiceProcessing}
            className="flex-1 rounded border border-[#dde3ea] bg-[#f9fafb] px-2 py-0.5 text-[10px] text-[#1a1f2e] focus:border-[#1a73e8] focus:outline-none disabled:opacity-50"
            title="Select your spoken language for voice input"
          >
            {VOICE_LANGS.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>

        {voiceProcessing && (
          <p className="text-[10px] text-[#1a73e8]">Translating with Gemini…</p>
        )}
        {voiceMeta && !voiceProcessing && (
          <p className="text-[10px] text-[#0d9488]">
            ✓ Voice classified · ready to submit
          </p>
        )}

        <div className="flex items-center gap-1.5">
          <select
            value={gpsCoords ? "gps" : String(locationIdx)}
            onChange={(e) => {
              if (e.target.value === "gps") {
                handleUseGps();
              } else {
                setGpsCoords(null);
                const idx = Number(e.target.value);
                setLocationIdx(idx);
                const loc = LOCATIONS[idx];
                if (loc) {
                  onLocationChange?.(loc);
                  const revMap = {
                    "Delhi-NCR": "delhi",
                    "Kerala": "kerala",
                    "Mumbai": "mumbai",
                    "Bengaluru": "bengaluru",
                    "Kolkata": "kolkata",
                    "Hyderabad": "hyderabad",
                    "Chennai": "chennai",
                  };
                  if (loc.region && revMap[loc.region]) {
                    onRegionChange?.(revMap[loc.region]);
                  }
                }
              }
            }}
            className="flex-1 rounded-lg border border-[#dde3ea] bg-[#f9fafb] px-3 py-1.5 text-xs text-[#1a1f2e] focus:border-[#1a73e8] focus:outline-none"
          >
            {gpsCoords && <option value="gps">📍 {gpsCoords.label}</option>}
            {Object.entries(
              LOCATIONS.reduce((acc, loc, i) => {
                const reg = loc.region || "Other";
                acc[reg] = acc[reg] || [];
                acc[reg].push({ ...loc, idx: i });
                return acc;
              }, {})
            ).map(([region, locs]) => (
              <optgroup key={region} label={region}>
                {locs.map((loc) => (
                  <option key={loc.label} value={String(loc.idx)}>{loc.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            onClick={handleUseGps}
            disabled={gettingGps}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-[#dde3ea] bg-[#f0f4f9] px-2.5 py-1.5 text-[11px] font-medium text-[#1a73e8] hover:bg-[#e4ebf5] disabled:opacity-50"
            title="Use current GPS location"
          >
            {gettingGps ? <Loader2 size={11} className="animate-spin" /> : <Navigation size={11} />}
            <span>GPS</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] text-[#7b8fa1]">
          <MapPin size={10} className="text-[#1a73e8]" />
          <span>{(coords?.lat ?? 28.6469).toFixed(4)}, {(coords?.lng ?? 77.3157).toFixed(4)} {gpsCoords ? "· Live GPS" : ""}</span>
        </div>

        <input
          value={locationHint}
          onChange={(e) => setLocationHint(e.target.value)}
          placeholder="Landmark detail (optional)"
          className="w-full rounded-lg border border-[#dde3ea] bg-[#f9fafb] px-3 py-1.5 text-xs text-[#1a1f2e] placeholder:text-[#7b8fa1] focus:border-[#1a73e8] focus:outline-none"
        />

        <label className="block cursor-pointer rounded-lg border border-dashed border-[#dde3ea] bg-[#f9fafb] px-3 py-1.5 hover:border-[#1a73e8]">
          <span className="flex items-center gap-2 text-[11px] text-[#7b8fa1]">
            <UploadCloud size={12} />
            {photo ? <span className="text-[#1a73e8]">{photo.name}</span> : "Attach photo"}
          </span>
          <input type="file" accept="image/*" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setPhoto(f);
              if (f) {
                const reader = new FileReader();
                reader.onload = (ev) => setPhotoPreview(ev.target.result);
                reader.readAsDataURL(f);
              } else {
                setPhotoPreview(null);
              }
            }} />
        </label>

        {/* Photo preview */}
        {photoPreview && (
          <div className="relative rounded-lg overflow-hidden border border-[#dde3ea] bg-[#f9fafb]">
            <img src={photoPreview} alt="Preview" className="w-full max-h-[120px] object-cover" />
            <button
              type="button"
              onClick={() => { setPhoto(null); setPhotoPreview(null); }}
              className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white/80 text-[#7b8fa1] hover:text-[#e0524a]"
            >
              <X size={10} />
            </button>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-end gap-2">
        {submitting && (
          <button type="button" onClick={cancelSubmit} className="flex items-center gap-1 text-[10px] text-[#e0524a]">
            <X size={10} /> Cancel
          </button>
        )}
        <button
          onClick={submitIncident}
          disabled={!canSubmit}
          className="inline-flex items-center gap-1 rounded-full bg-[#1a73e8] px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {submitting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </div>

      {submitError && <p className="mt-2 text-xs text-[#e0524a]">{submitError}</p>}
      {lastResult && <ClassificationResult result={lastResult} onClear={() => setLastResult(null)} />}
    </div>
  );
}

/* ── Classification Result Card (themed to app design system) ── */
function ClassificationResult({ result, onClear }) {
  const textAnalysis = result?.text_analysis;
  const photoAnalysis = result?.photo_analysis;
  const analysis = textAnalysis || photoAnalysis || {};

  const eventType = analysis.event_type || analysis.possible_source || "smoke";
  const severity = analysis.severity || (result.combined_haze_score >= 0.7 ? "high" : result.combined_haze_score >= 0.4 ? "moderate" : "low");
  const hazeScore = result.combined_haze_score ?? analysis.haze_score ?? 0;
  const description = analysis.notes || analysis.translated_text || result.text || "";
  const confidence = analysis.visual_confidence ?? analysis.confidence ?? null;

  const sevNum = severity === "high" || severity === "severe" ? 1 : severity === "moderate" ? 2 : 3;
  const sevMap = {
    1: { color: "var(--color-sev-confirmed)", bg: "rgba(224,82,74,0.06)", border: "rgba(224,82,74,0.18)" },
    2: { color: "var(--color-sev-corroborated)", bg: "rgba(232,162,61,0.06)", border: "rgba(232,162,61,0.18)" },
    3: { color: "var(--color-clear-500)", bg: "rgba(26,115,232,0.06)", border: "rgba(26,115,232,0.18)" },
  };
  const sev = sevMap[sevNum] || sevMap[2];

  const eventIcons = {
    smoke: Flame, industrial: Flame, vehicular: Wind,
    agricultural_burning: Flame, dust: CloudRain,
    construction: AlertTriangle, unclear: Eye,
  };
  const EventIcon = eventIcons[eventType] || Eye;

  return (
    <div className="mt-3 space-y-2 animate-fade-in">
      {/* Main classification card */}
      <div
        className="rounded-lg px-3 py-2.5"
        style={{ background: sev.bg, border: `1px solid ${sev.border}` }}
      >
        {/* Header row with clear button */}
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5">
            <EventIcon size={13} style={{ color: sev.color }} />
            <span
              className="text-sm font-semibold"
              style={{ color: sev.color, fontFamily: "var(--font-display)" }}
            >
              {eventType.replace(/_/g, " ")}
            </span>
            <span className="text-[10px] text-[#7b8fa1]">—</span>
            <span className="text-[10px] font-medium" style={{ color: sev.color }}>
              severity {sevNum}
            </span>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 rounded-full p-0.5 text-[#7b8fa1] hover:text-[#1a1f2e] hover:bg-[#dde3ea] transition-colors"
            title="Dismiss result"
          >
            <X size={12} />
          </button>
        </div>

        {description && (
          <p className="text-[11px] italic leading-relaxed text-[#314154] mb-2">
            {description.includes("in progress") ? (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#e8a23d] animate-pulse" />
                {description}
              </span>
            ) : description}
          </p>
        )}

        {/* Haze score bar */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-medium text-[#7b8fa1] w-10 shrink-0">Haze</span>
          <div className="flex-1 h-1 rounded-full bg-[#dde3ea] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.round(hazeScore * 100)}%`,
                background: hazeScore >= 0.7 ? "var(--color-sev-confirmed)" : hazeScore >= 0.4 ? "var(--color-sev-corroborated)" : "var(--color-clear-500)",
              }}
            />
          </div>
          <span
            className="text-[9px] font-medium w-8 text-right"
            style={{ color: sev.color, fontFamily: "var(--font-mono)" }}
          >
            {(hazeScore * 100).toFixed(0)}%
          </span>
        </div>

        {confidence != null && confidence > 0 && (
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[9px] font-medium text-[#7b8fa1] w-10 shrink-0">Conf.</span>
            <div className="flex-1 h-1 rounded-full bg-[#dde3ea] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.round(confidence * 100)}%`, background: "var(--color-clear-500)" }}
              />
            </div>
            <span
              className="text-[9px] font-medium text-[#1a73e8] w-8 text-right"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {(confidence * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      {/* Photo visual analysis */}
      {photoAnalysis && (
        <div className="rounded-lg border border-[#dde3ea] bg-[#f9fafb] px-3 py-2">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-[#7b8fa1] mb-1.5">
            Visual analysis
          </p>
          <div className="grid grid-cols-3 gap-1 text-center">
            {[
              { key: "smoke_visible", label: "Smoke", activeColor: "var(--color-sev-confirmed)", activeBg: "rgba(224,82,74,0.08)" },
              { key: "haze_visible", label: "Haze", activeColor: "var(--color-sev-corroborated)", activeBg: "rgba(232,162,61,0.08)" },
              { key: "visibility_reduced", label: "Low vis.", activeColor: "var(--color-sev-hidden)", activeBg: "rgba(168,112,232,0.08)" },
            ].map(({ key, label, activeColor, activeBg }) => (
              <div
                key={key}
                className="rounded px-1.5 py-0.5 text-[9px] font-medium"
                style={photoAnalysis[key]
                  ? { color: activeColor, background: activeBg }
                  : { color: "#7b8fa1", background: "#f0f4f9" }
                }
              >
                {photoAnalysis[key] ? "✓" : "✗"} {label}
              </div>
            ))}
          </div>
          {photoAnalysis.possible_source && photoAnalysis.possible_source !== "unclear" && (
            <p className="mt-1 text-[9px] text-[#314154]">
              <span className="font-medium text-[#7b8fa1]">Source:</span> {photoAnalysis.possible_source.replace(/_/g, " ")}
            </p>
          )}
        </div>
      )}

      {/* Success footer */}
      <div className="rounded-lg border border-[rgba(26,115,232,0.15)] bg-[rgba(26,115,232,0.04)] px-3 py-1.5">
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-[#1a73e8]">
          <CheckCircle2 size={11} /> Report submitted — will be reflected on the map within the next pipeline run.
        </p>
      </div>
    </div>
  );
}
