import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Mic, MicOff, Send, UploadCloud, MapPin } from "lucide-react";

const LOCATIONS = [
  { label: "Anand Vihar, Delhi", lat: 28.6469, lng: 77.3157 },
  { label: "Rohini, Delhi", lat: 28.7041, lng: 77.1025 },
  { label: "Noida Sector 62", lat: 28.628, lng: 77.364 },
  { label: "Ghaziabad Industrial", lat: 28.669, lng: 77.453 },
  { label: "Connaught Place", lat: 28.6315, lng: 77.2167 },
];

export default function ReportPanel({ onReportSubmitted, session, sessionToken }) {
  const [text, setText] = useState("");
  const [locationHint, setLocationHint] = useState("");
  const [photo, setPhoto] = useState(null);
  const [locationIdx, setLocationIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [lastResult, setLastResult] = useState(null);
  const [recording, setRecording] = useState(false);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const recognitionRef = useRef(null);

  const coords = LOCATIONS[locationIdx];
  const canSubmit = useMemo(() => Boolean(text.trim() || photo), [text, photo]);

  function startVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice input requires Chrome.");
      return;
    }
    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = false;
    recognitionRef.current = rec;
    rec.onstart = () => setRecording(true);
    rec.onend = () => setRecording(false);
    rec.onresult = async (event) => {
      const transcript = event.results[0][0].transcript;
      setVoiceProcessing(true);
      try {
        const res = await fetch("/api/voice-transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript }),
        });
        if (res.ok) {
          const data = await res.json();
          setText(data.translated || transcript);
          if (data.extracted_location_hint && !locationHint) {
            setLocationHint(data.extracted_location_hint);
          }
        } else {
          setText(transcript);
        }
      } catch {
        setText(transcript);
      } finally {
        setVoiceProcessing(false);
      }
    };
    rec.onerror = () => setRecording(false);
    rec.start();
  }

  function stopVoice() {
    recognitionRef.current?.stop();
    setRecording(false);
  }

  async function submitIncident() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError("");
    setLastResult(null);

    const form = new FormData();
    form.append("lat", String(coords.lat));
    form.append("lng", String(coords.lng));
    form.append("text", text.trim());
    form.append("location_hint", locationHint.trim() || coords.label);
    form.append("country_code", session?.country_code || "IN");
    if (photo) form.append("file", photo);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const headers = sessionToken ? { "X-Session-Token": sessionToken } : undefined;
      const res = await fetch("/api/incidents/report", {
        method: "POST", body: form, headers, signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`Submit failed (${res.status})`);
      const data = await res.json();
      setLastResult(data);
      setText("");
      setLocationHint("");
      setPhoto(null);
      onReportSubmitted();
    } catch (err) {
      setSubmitError(err?.message || "Could not submit. Please retry.");
    } finally {
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
            onChange={(e) => setText(e.target.value)}
            placeholder="Describe smoke, haze, or smell…"
            rows={2}
            className="w-full rounded-lg border border-[#dde3ea] px-3 py-2 pr-10 text-sm text-[#1a1f2e] placeholder:text-[#7b8fa1] focus:border-[#1a73e8] focus:outline-none resize-none"
          />
          <button
            type="button"
            onClick={recording ? stopVoice : startVoice}
            disabled={voiceProcessing}
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#f0f4f9] disabled:opacity-40"
            title={recording ? "Stop" : "Voice"}
          >
            {voiceProcessing ? (
              <Loader2 size={12} className="animate-spin text-[#1a73e8]" />
            ) : recording ? (
              <MicOff size={12} className="text-[#e0524a]" />
            ) : (
              <Mic size={12} className="text-[#1a73e8]" />
            )}
          </button>
        </div>

        <select
          value={locationIdx}
          onChange={(e) => setLocationIdx(Number(e.target.value))}
          className="w-full rounded-lg border border-[#dde3ea] bg-[#f9fafb] px-3 py-2 text-sm text-[#1a1f2e] focus:border-[#1a73e8] focus:outline-none"
        >
          {LOCATIONS.map((loc, i) => (
            <option key={loc.label} value={i}>{loc.label}</option>
          ))}
        </select>

        <div className="flex items-center gap-1.5 text-[10px] text-[#7b8fa1]">
          <MapPin size={10} className="text-[#1a73e8]" />
          <span>{coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</span>
        </div>

        <input
          value={locationHint}
          onChange={(e) => setLocationHint(e.target.value)}
          placeholder="Landmark detail (optional)"
          className="w-full rounded-lg border border-[#dde3ea] bg-[#f9fafb] px-3 py-1.5 text-xs text-[#1a1f2e] placeholder:text-[#7b8fa1] focus:border-[#1a73e8] focus:outline-none"
        />

        <label className="block rounded-lg border border-dashed border-[#dde3ea] bg-[#f9fafb] px-3 py-1.5 cursor-pointer hover:border-[#1a73e8]">
          <span className="flex items-center gap-2 text-[11px] text-[#7b8fa1]">
            <UploadCloud size={12} />
            {photo ? <span className="text-[#1a73e8]">{photo.name}</span> : "Attach photo"}
          </span>
          <input type="file" accept="image/*" className="hidden"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
      </div>

      <div className="mt-2 flex items-center justify-end">
        <button
          onClick={submitIncident}
          disabled={submitting || !canSubmit}
          className="inline-flex items-center gap-1 rounded-full bg-[#1a73e8] px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {submitting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
          Submit
        </button>
      </div>

      {submitError && <p className="mt-2 text-xs text-[#e0524a]">{submitError}</p>}
      {lastResult && (
        <div className="mt-2 rounded-lg border border-[rgba(26,115,232,0.2)] bg-[rgba(26,115,232,0.06)] px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-[#1a73e8]">
            <CheckCircle2 size={12} /> Report submitted
          </p>
          <p className="mt-0.5 text-[10px] text-[#5f6f86]">
            Zone {lastResult.h3_cell?.slice(0, 10)}…
            {lastResult.combined_haze_score != null && ` · ${Math.round(lastResult.combined_haze_score * 100)}% haze`}
          </p>
        </div>
      )}
    </div>
  );
}
