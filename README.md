# AirGrid — Clean Air & Climate Resilience (Build with AI: Code for Communities, 2nd Edition)

Fuses citizen-reported pollution (photo/voice/text) with ground-sensor and
satellite data via H3 spatial binning, to catch pollution hotspots official
monitoring misses — and forecast spikes before they happen.

**Detect → Recommend → Notify → Acknowledge.**

## Status (Day 1)

✅ H3 binning utilities
✅ OpenAQ client (mock fallback until API key is added — see below)
✅ Hotspot fusion & severity classification (CONFIRMED / CORROBORATED / HIDDEN / UNVERIFIED)
✅ FastAPI backend with `/api/hotspots` and `/api/citizen-report`, tested end-to-end
⬜ Gemini multimodal photo scoring (currently accepts a pre-set `haze_score`)
⬜ Earth Engine Sentinel-5P satellite integration (currently mocked deterministically)
⬜ LightGBM forecasting model
⬜ React dashboard / map
⬜ Cloud Run deployment

## Quick start

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # then fill in your keys, see below
uvicorn app.main:app --reload --port 8000
```

Test it:
```bash
curl http://127.0.0.1:8000/api/health

curl -X POST http://127.0.0.1:8000/api/citizen-report \
  -H "Content-Type: application/json" \
  -d '{"lat": 28.70, "lng": 77.45, "text": "very hazy today", "haze_score": 0.85, "source": "photo"}'

curl http://127.0.0.1:8000/api/hotspots
```

## Getting API keys (do this today — don't block on it later)

- **OpenAQ**: register at https://explore.openaq.org/register (free, instant).
  Without a key, the app runs on realistic mock Delhi-NCR sensor data so you
  can keep building — swap in the real key any time, same function signatures.
- **Gemini**: get a key at https://aistudio.google.com/apikey
- **Earth Engine**: needs a Google Cloud project + Earth Engine registration
  (https://code.earthengine.google.com/register) — this one takes longest to
  approve, so register it TODAY even before you write the integration code.

## Architecture

```
backend/
  app/
    main.py                    — FastAPI app, /api/hotspots + /api/citizen-report
    services/
      h3_utils.py               — lat/lng <-> H3 cell binning, neighbor lookups
      openaq_client.py          — ground sensor data (real + mock fallback)
      hotspot_detection.py      — the core fusion/severity logic (see below)
```

### The core idea (`hotspot_detection.py`)

Every H3 cell gets classified into one of four tiers:

| Severity | Meaning |
|---|---|
| `confirmed` | Ground sensor itself reads unhealthy |
| `corroborated` | Citizen report + satellite anomaly agree, AND a sensor nearby confirms |
| `hidden` | Citizen report + satellite anomaly agree, but **no sensor nearby** — this is the "official monitoring can't see this" case, and it's the strongest evidence for your pitch |
| `unverified` | Citizen report alone, not yet corroborated |

This is what makes the demo's killer line possible: *"we caught a hotspot N
hours before/where official sensors could."*

## Next up (see plan doc / chat)
- Person A: Earth Engine integration, LightGBM forecast, historical demo dataset
- Person B: Gemini photo/voice scoring, React map dashboard, Cloud Run deploy
