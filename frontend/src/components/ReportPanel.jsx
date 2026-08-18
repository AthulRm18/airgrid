import { useState } from "react";
import { Send, Image as ImageIcon, Loader2 } from "lucide-react";

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

  async function submitText() {
    if (!text.trim()) return;
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

  return (
    <div className="rounded-2xl border border-[var(--color-ink-700)] bg-[var(--color-ink-900)] p-5">
      <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--color-mist-50)] mb-1">
        Report air quality
      </h2>
      <p className="text-xs text-[var(--color-mist-400)] mb-4">
        Citizen input — text, voice transcript, or a photo. Any language.
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

        <label className="flex items-center gap-1.5 rounded-lg border border-[var(--color-ink-600)] px-3 py-1.5 text-sm text-[var(--color-mist-200)] cursor-pointer hover:border-[var(--color-clear-500)] transition-colors">
          <ImageIcon size={14} />
          {photo ? photo.name.slice(0, 16) : "Attach photo"}
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

      {lastResult && <ResultPreview result={lastResult} />}
    </div>
  );
}

function ResultPreview({ result }) {
  const classification = result.gemini_classification;
  return (
    <div className="mt-4 rounded-lg bg-[var(--color-ink-800)] px-3 py-2.5 text-xs space-y-1">
      <p className="text-[var(--color-clear-400)] font-medium">Gemini classification</p>
      {classification?.translated_text && (
        <p className="text-[var(--color-mist-200)]">
          "{classification.translated_text}"{" "}
          <span className="text-[var(--color-mist-400)]">
            ({classification.detected_language})
          </span>
        </p>
      )}
      {classification?.notes && (
        <p className="text-[var(--color-mist-200)]">{classification.notes}</p>
      )}
      <p className="text-[var(--color-mist-400)] font-[family-name:var(--font-mono)]">
        cell {result.h3_cell} · haze {(result.haze_score ?? 0).toFixed(2)}
      </p>
    </div>
  );
}
