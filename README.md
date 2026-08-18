# AirGrid — Clean Air & Climate Resilience (Build with AI: Code for Communities, 2nd Edition)

Fuses citizen-reported pollution (photo/voice/text) with ground-sensor and
satellite data via H3 spatial binning, to catch pollution hotspots official
monitoring misses — and forecast spikes before they happen.

**Detect → Recommend → Notify → Acknowledge.**

## Status (Day 1)

✅ H3 binning utilities
✅ OpenAQ client (mock fallback until API key is added — see below)
✅ Hotspot fusion & severity classification (CONFIRMED / CORROBORATED / HIDDEN / UNVERIFIED)
✅ FastAPI backend — `/api/hotspots`, `/api/citizen-report`, `/api/citizen-report/photo`, tested end-to-end
✅ Gemini text classification + photo scoring wired in (`services/gemini_client.py`) — falls back to a clearly-labeled placeholder score if `GEMINI_API_KEY` isn't set yet, so nobody's blocked
✅ Alert acknowledge loop (`POST /api/hotspots/acknowledge`) — closes Detect → Recommend → Notify → Acknowledge
⬜ Earth Engine Sentinel-5P satellite integration (currently mocked deterministically per H3 cell)
⬜ LightGBM forecasting model
⬜ React dashboard / map
⬜ Cloud Run deployment
⬜ Offline-first queue on the citizen-report client

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
  -d '{"lat": 28.6469, "lng": 77.3157, "text": "bahut dhundh hai", "source": "voice"}'

curl http://127.0.0.1:8000/api/hotspots

curl -X POST http://127.0.0.1:8000/api/hotspots/acknowledge \
  -H "Content-Type: application/json" \
  -d '{"h3_cell": "873da1149ffffff", "action_taken": "dispatched field team"}'
```

Or skip curl entirely — run the server, then open http://127.0.0.1:8000/docs
for FastAPI's interactive test UI (click "Try it out" on any endpoint).

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

## Working in VS Code + pushing to GitHub

### 1. Get the code onto your machine
Open this project folder in VS Code (`File > Open Folder`), or if you're
starting from scratch on your own laptop:
```bash
git clone <your-repo-url>
cd airgrid
code .
```

### 2. Create the GitHub repo (one person does this once)
- Go to github.com → New repository → name it `airgrid` (or your real
  project name) → **do not** initialize with a README/gitignore (you
  already have both) → Create repository.
- Copy the remote URL it gives you (the `https://github.com/...` one).

### 3. Connect this local repo to GitHub and push
```bash
git remote add origin https://github.com/<your-username>/airgrid.git
git branch -M main
git push -u origin main
```
You'll be prompted to authenticate — easiest path is VS Code's built-in
GitHub sign-in (bottom-left account icon → Sign in with GitHub), which
then handles `git push` credentials for you automatically from the
integrated terminal too.

### 4. Add your teammate
GitHub repo → Settings → Collaborators → Add people → their GitHub
username. They then just:
```bash
git clone https://github.com/<your-username>/airgrid.git
```

### 5. Daily workflow (both of you)
```bash
git pull                          # get teammate's latest changes first
# ... do your work ...
git add -A
git commit -m "clear description of what changed"
git push
```
If you both touched the same file, `git pull` may show a merge conflict —
VS Code highlights these inline with "Accept Current/Incoming/Both"
buttons right above the conflicting lines. Don't panic, just resolve and
commit.

### 6. Before your FIRST commit on a fresh clone, always check
```bash
cat .gitignore   # confirm .env is listed
git status       # confirm .env is NOT in the list of files to be committed
```
The `.gitignore` in this repo already excludes `.env` and any
`*-service-account*.json` files — but always eyeball `git status` before
your first push, especially once you've added your real API keys
locally. A leaked Gemini/OpenAQ key in a public repo gets scraped and
abused within minutes.

### Suggested branch discipline (optional but recommended for 2 people)
Simplest version that won't slow you down in a week-long sprint:
- Push directly to `main` for independent files (Person A working only
  in `services/`, Person B only in `frontend/`) — low collision risk.
- For anything you're both touching (e.g. `main.py`), do a quick Slack/
  WhatsApp "pushing to main.py now, give me 5 min" instead of formal
  branches — faster than PR review for a team of two on a deadline.
