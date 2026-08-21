import { useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Mic, MicOff, Send, UploadCloud, MapPin, X } from "lucide-react";

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
  const [voiceMeta, setVoiceMeta] = useState(null);
  const recognitionRef = useRef(null);
  const submitAbortRef = useRef(null);

  const coords = LOCATIONS[locationIdx];
  const canSubmit = useMemo(
    () => Boolean(text.trim() || photo) && !submitting && !recording,
    [text, photo, submitting, recording],
  );

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
    rec.lang = "hi-IN";
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
        setTimeout(() => ctrl.abort(), 10000);
        const res = await fetch("/api/voice-transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript }),
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

    const timeoutId = setTimeout(() => controller.abort(), 20000);

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
      setVoiceMeta(null);
      onReportSubmitted(data);
    } catch (err) {
      if (err.name === "AbortError") {
        setSubmitError("Timed out — check Gemini/OpenAQ keys or try again");
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

        {voiceProcessing && (
          <p className="text-[10px] text-[#1a73e8]">Translating with Gemini…</p>
        )}
        {voiceMeta && !voiceProcessing && (
          <p className="text-[10px] text-[#0d9488]">
            Voice classified · ready to submit (no second Gemini wait)
          </p>
        )}

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

        <label className="block cursor-pointer rounded-lg border border-dashed border-[#dde3ea] bg-[#f9fafb] px-3 py-1.5 hover:border-[#1a73e8]">
          <span className="flex items-center gap-2 text-[11px] text-[#7b8fa1]">
            <UploadCloud size={12} />
            {photo ? <span className="text-[#1a73e8]">{photo.name}</span> : "Attach photo"}
          </span>
          <input type="file" accept="image/*" className="hidden"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
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
      {lastResult && (
        <div className="mt-2 rounded-lg border border-[rgba(26,115,232,0.2)] bg-[rgba(26,115,232,0.06)] px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-[#1a73e8]">
            <CheckCircle2 size={12} /> Report submitted — watch the map zone light up
          </p>
        </div>
      )}
    </div>
  );
}
