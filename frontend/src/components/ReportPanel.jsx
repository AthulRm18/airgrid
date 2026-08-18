import { useState, useRef } from "react";
import {
  Send, Image as ImageIcon, Loader2, Mic, MicOff,
  WifiOff, CheckCircle2, Globe
} from "lucide-react";

// Same bbox as the map — random point within it for the "use my location"
// stand-in, since the demo runs on desktop without real geolocation.
const BBOX = { minLng: 76.8, minLat: 28.4, maxLng: 77.6, maxLat: 28.9 };

function randomPointInBbox() {
  return {
    lat: BBOX.minLat + Math.random() * (BBOX.maxLat - BBOX.minLat),
    lng: BBOX.minLng + Math.random() * (BBOX.maxLng - BBOX.minLng),
  };
}

export default function ReportPanel({ onReportSubmitted }) {
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState([]);
  const [simulateOffline, setSimulateOffline] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  async function submitText() {
    if (!text.trim()) return;

    if (simulateOffline) {
      setOfflineQueue((q) => [...q, { type: "text", text: text.trim(), status: "QUEUED OFFLINE" }]);
      setText("");
      return;
    }

    setSubmitting(true);
    setLastResult(null);
    const { lat, lng } = randomPointInBbox();
    try {
      const res = await fetch("/api/citizen-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng, text: text.trim(), source: "text" }),
      });
      const data = await res.json();
      setLastResult(data);
      setText("");
      onReportSubmitted();
    } finally {
      setSubmitting(false);
    }
  }

  async function submitPhoto() {
    if (!photo) return;
    setSubmitting(true);
    setLastResult(null);
    const { lat, lng } = randomPointInBbox();
    const form = new FormData();
    form.append("lat", lat);
    form.append("lng", lng);
    form.append("file", photo);
    try {
      const res = await fetch("/api/citizen-report/photo", { method: "POST", body: form });
      const data = await res.json();
      setLastResult(data);
      setPhoto(null);
      onReportSubmitted();
    } finally {
      setSubmitting(false);
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        // For the demo, convert voice to text via a prompt
        // In production, this would use a speech-to-text API
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setText((prev) => prev || "[Voice recording captured — submit to process]");
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch {
      alert("Microphone access denied. Please allow microphone access to record voice reports.");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }

  function syncOfflineQueue() {
    setOfflineQueue((q) => q.map((item) => ({ ...item, status: "SYNCED ✓" })));
    setTimeout(() => setOfflineQueue([]), 2000);
    onReportSubmitted();
  }

  return (
    <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--color-mist-50)]">
          Report air quality
        </h2>
        {/* Offline toggle for demo */}
        <button
          onClick={() => {
            const next = !simulateOffline;
            setSimulateOffline(next);
            if (!next && offlineQueue.length > 0) syncOfflineQueue();
          }}
          className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full transition-colors ${
            simulateOffline
              ? "bg-[rgba(224,82,74,0.15)] text-[var(--color-sev-confirmed)]"
              : "text-[var(--color-mist-400)] hover:text-[var(--color-mist-200)]"
          }`}
        >
          {simulateOffline ? <WifiOff size={10} /> : null}
          {simulateOffline ? "Offline mode" : "Simulate offline"}
        </button>
      </div>
      <p className="text-xs text-[var(--color-mist-400)] mb-4">
        Citizen input — text, voice, or photo. Any language.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. bahut dhundh hai, saans lene mein takleef ho rahi hai"
        rows={2}
        className="w-full rounded-lg bg-[var(--color-ink-800)] border border-[var(--color-ink-600)] px-3 py-2 text-sm text-[var(--color-mist-50)] placeholder:text-[var(--color-mist-400)] focus:outline-none focus:border-[var(--color-clear-500)] resize-none"
      />

      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={submitText}
          disabled={submitting || !text.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--color-clear-500)] px-3 py-1.5 text-sm font-medium text-[var(--color-ink-950)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--color-clear-400)] transition-colors"
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Submit
        </button>

        {/* Voice recording */}
        <button
          onClick={isRecording ? stopRecording : startRecording}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
            isRecording
              ? "border-[var(--color-sev-confirmed)] text-[var(--color-sev-confirmed)] bg-[rgba(224,82,74,0.1)]"
              : "border-[var(--color-ink-600)] text-[var(--color-mist-200)] hover:border-[var(--color-clear-500)]"
          }`}
        >
          {isRecording ? <MicOff size={14} /> : <Mic size={14} />}
          {isRecording ? "Stop" : "Voice"}
        </button>

        <label className="flex items-center gap-1.5 rounded-lg border border-[var(--color-ink-600)] px-3 py-1.5 text-sm text-[var(--color-mist-200)] cursor-pointer hover:border-[var(--color-clear-500)] transition-colors">
          <ImageIcon size={14} />
          {photo ? photo.name.slice(0, 16) : "Photo"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
        </label>

        {photo && (
          <button
            onClick={submitPhoto}
            disabled={submitting}
            className="text-sm text-[var(--color-clear-400)] hover:underline disabled:opacity-40"
          >
            Send photo
          </button>
        )}
      </div>

      {/* Offline queue */}
      {offlineQueue.length > 0 && (
        <div className="mt-3 space-y-1">
          {offlineQueue.map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-xs rounded-lg bg-[var(--color-ink-800)] px-3 py-1.5">
              {item.status === "QUEUED OFFLINE" ? (
                <WifiOff size={12} className="text-[var(--color-sev-corroborated)]" />
              ) : (
                <CheckCircle2 size={12} className="text-[var(--color-clear-400)]" />
              )}
              <span className="text-[var(--color-mist-200)] truncate flex-1">{item.text}</span>
              <span className={`font-[family-name:var(--font-mono)] text-[10px] ${
                item.status === "SYNCED ✓" ? "text-[var(--color-clear-400)]" : "text-[var(--color-sev-corroborated)]"
              }`}>
                {item.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {lastResult && <ResultPreview result={lastResult} />}
    </div>
  );
}

function ResultPreview({ result }) {
  const classification = result.gemini_classification;
  return (
    <div className="mt-4 rounded-lg bg-[var(--color-ink-800)] px-3 py-2.5 text-xs space-y-1.5 animate-fade-in">
      <p className="text-[var(--color-clear-400)] font-medium flex items-center gap-1.5">
        <CheckCircle2 size={12} /> Gemini classification
      </p>
      {classification?.translated_text && (
        <p className="text-[var(--color-mist-200)]">
          "{classification.translated_text}"{" "}
          <span className="text-[var(--color-mist-400)] inline-flex items-center gap-1">
            <Globe size={10} /> {classification.detected_language}
          </span>
        </p>
      )}
      {classification?.event_type && (
        <p className="text-[var(--color-mist-400)]">
          Event: <span className="text-[var(--color-mist-200)]">{classification.event_type}</span>
          {classification.severity && <> · Severity: <span className="text-[var(--color-mist-200)]">{classification.severity}</span></>}
          {classification.possible_source && <> · Source: <span className="text-[var(--color-mist-200)]">{classification.possible_source}</span></>}
        </p>
      )}
      {classification?.notes && (
        <p className="text-[var(--color-mist-200)]">{classification.notes}</p>
      )}
      <p className="text-[var(--color-mist-400)] font-[family-name:var(--font-mono)]">
        cell {result.h3_cell} · haze {(result.haze_score ?? 0).toFixed(2)}
        {classification?.confidence != null && ` · confidence ${classification.confidence.toFixed(2)}`}
      </p>
    </div>
  );
}
