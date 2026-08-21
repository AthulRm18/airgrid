# CONFLUX — Community Environmental Intelligence & Early Warning

> **Build with AI: Code for Communities — Second Edition (Google / Hack2Skill)**  
> *Hyperlocal pollution intelligence before exposure: fusing citizen reports, satellite aerosol anomalies, and ground sensors into actionable community defense.*

---

## Executive Summary

Official air quality monitoring infrastructure in India and across the Global South is sparse, coarse, and concentrated in affluent metropolitan centers. Millions of citizens living in industrial corridors, peri-urban clusters, and rural agricultural belts breathe hazardous air from localized episodic events—crop residue burning, unpermitted industrial venting, and illegal waste incineration—that never register on distant regulatory monitors.

**CONFLUX** bridges this critical surveillance gap. It is an end-to-end community environmental intelligence platform that:
1. **Empowers Citizens**: Low-barrier, regional-language reporting via voice, photo, and text processed by **Google Gemini 2.5**.
2. **Fuses Multi-Modal Signals**: Combines citizen evidence, **Sentinel-5P / Google Earth Engine** satellite aerosol anomalies, and **OpenAQ / CPCB** ground sensors using Uber H3 spatial indexing.
3. **Discovers Blind-Spot Hotspots**: Statistically separates normal diurnal variation from hidden localized spikes, classifying threats as *Hidden*, *Corroborated*, *Confirmed*, or *Unverified*.
4. **Predicts Propagation Corridors**: Wind-aware plume modeling forecasts downwind exposure paths and identifies vulnerable community infrastructure (schools, clinics, densely populated colonies) hours before smoke arrives.
5. **Enables Action & Accountability**: Closes the loop from *Detect → Recommend → Notify → Acknowledge*, providing municipal authorities with pre-drafted vernacular advisories and verifiers with field dispatch checklists.

---

## Core Problem Statement

- **Sensor Desertification**: Fewer than 500 continuous ambient air quality stations (CAAQMS) cover a country of 1.4 billion people.
- **Episodic Invisibility**: Ground sensors are placed kilometers apart; an industrial boiler exhaust or trash burning site 800 meters away will disperse before reaching the nearest monitor.
- **Language & Literacy Barriers**: Affected communities often cannot read technical English AQI dashboards or interpret particulate curves.
- **Delayed Intervention**: Without early spatial propagation modeling, public health advisories are issued hours *after* peak community exposure has already occurred.

---

## High-Level Architecture

```
                                  [ Citizen Reports ]
                      (Voice / Photo / Text in Hindi, Malayalam,
                        Bengali, Marathi, Kannada, English)
                                        │
                                        ▼
                          [ Google Gemini 2.5 Multi-Modal ]
                   (Speech Transcription, Translation, Image Severity,
                         Structured Incident Feature Extraction)
                                        │
[ Sentinel-5P / Earth Engine ]          │          [ OpenAQ / CPCB Sensors ]
   (Aerosol Index Anomaly)              │          (Live Hourly PM2.5 Grid)
            │                           │                     │
            └───────────────────────────┼─────────────────────┘
                                        ▼
                          [ Spatial H3 Hexagonal Grid ]
                               (Resolution 7 & 8)
                                        │
                                        ▼
                       [ Evidence-Fusion Engine & LightGBM ]
                   - Multi-source weighted confidence scoring
                   - Baseline anomaly deviation (Z-score)
                   - Severity: HIDDEN | CORROBORATED | CONFIRMED
                                        │
                                        ▼
                     [ Wind-Aware Propagation & Demographics ]
                   - Downwind plume trajectory forecasting
                   - Population at risk & vulnerable facility count
                                        │
                                        ▼
                             [ Role-Based Workflows ]
             ┌──────────────────────────┼──────────────────────────┐
             ▼                          ▼                          ▼
      [ Public Citizen ]         [ City Verifier ]        [ District Authority ]
      (Advisories, Voice)       (Field Team Dispatch)    (Targeted Broadcasts)
```

---

## Google Cloud & Google AI Integrations

| Google Technology | Specific Architectural Role | Why It Is Essential |
| :--- | :--- | :--- |
| **Gemini 2.5 Flash Lite** | Multi-lingual audio transcription, vernacular translation, and computer vision severity analysis. | Extracts structured pollution parameters from unstructured citizen inputs in 6 Indian languages in < 1.2s. |
| **Google Earth Engine (Sentinel-5P)** | Offline & live retrieval of Copernicus Sentinel-5P NRTI absorbing aerosol index. | Provides top-down satellite verification over rural and peri-urban zones where ground sensors are non-existent. |
| **Firebase Firestore** | Real-time state persistence for incidents, alerts, acknowledgments, and federated event logs. | Guarantees instant synchronization across citizen and authority dashboards with offline local JSON fallback. |
| **Google Maps Platform / Leaflet** | Geospatial rendering of H3 hexagons, plume propagation vectors, and school/hospital POIs. | Intuitive spatial map with zero camera jitter during background 8-second polling cycles. |
| **Google Cloud Run** | Serverless containerized deployment with automated HTTPS and scale-to-zero efficiency. | Production-grade hosting for FastAPI backend and built Vite SPA within a single container. |

---

## Key Features

### 1. Multi-Modal Citizen Voice & Photo Reporting
- Supports voice recordings in **Hindi, Malayalam, Bengali, Marathi, Kannada, and English**.
- Gemini extracts pollutant type, estimated visibility, health symptoms (cough, eye burn), and location landmarks.
- Image classification detects smoke density, plume source (biomass vs industrial), and confidence ratings.

### 2. Multi-Source Evidence Fusion (Hotspot Severity Matrix)
- **Hidden Hotspot** (Purple Hex): Strong citizen reports + satellite aerosol anomaly, but zero official ground sensors in range. *(The core differentiator of CONFLUX)*.
- **Confirmed Hotspot** (Red Hex): Ground sensor confirms hazardous PM2.5 exceedance (> 120 µg/m³).
- **Corroborated Hotspot** (Orange Hex): Sensor readings align with elevated citizen reports.
- **Unverified Hotspot** (Yellow Hex): Single isolated report awaiting spatial or satellite corroboration.

### 3. Downwind Propagation & Impact Corridor
- Integrates live meteorological wind direction and velocity to model hourly plume propagation across neighboring H3 rings.
- Calculates total exposed population, schools, clinics, and residential colonies within the forecasted corridor.

### 4. Closed-Loop Incident Management
- **Verifier Dashboard**: Review citizen evidence, inspect satellite anomaly maps, and dispatch local inspection teams.
- **Authority Advisory Generator**: Gemini drafts targeted public health alerts in regional languages with actionable advisories (e.g. N95 guidance, school outdoor activity suspension).
- **Audit Trail**: Every acknowledgment is logged with timestamp, authority credentials, and remedial actions taken.

### 5. Multi-State Nationwide Demo Coverage
- Pre-scripted high-fidelity scenarios across 5 distinct regions:
  - **Delhi-NCR**: Anand Vihar industrial smoke event & Rohini biomass burning.
  - **Kerala**: Eloor chemical belt & Kochi port emissions (Malayalam voice report).
  - **Mumbai MMR**: Chembur refinery corridor (Marathi/Hindi reports).
  - **Bengaluru**: Peenya industrial manufacturing belt (Kannada report).
  - **Kolkata**: Howrah brick kiln & transit corridor (Bengali report).

---

## Quickstart & Local Setup

### Prerequisites
- **Python 3.10+**
- **Node.js 18+**
- **Google Gemini API Key** (from [Google AI Studio](https://aistudio.google.com/))
- *(Optional)* OpenAQ API Key (from [explore.openaq.org](https://explore.openaq.org/register))

### 1. Clone & Configure Backend
```bash
git clone https://github.com/AthulRm18/airgrid.git
cd airgrid/backend

# Copy environment template
cp .env.example .env
```

Edit `backend/.env`:
```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-flash-lite-latest
OPENAQ_API_KEY=your_openaq_key_or_leave_blank_for_mock_grid
USE_EARTH_ENGINE=false
```

Install backend dependencies and run:
```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 2. Configure & Run Frontend
In a new terminal:
```bash
cd airgrid/frontend
npm install
npm run dev
```

Open **`http://localhost:5173`** in your browser.

---

## Test & Verification

Run the full automated system audit:
```bash
python scratch/system_audit.py
```
This tests:
- `/api/data-sources` (Health & live configuration)
- `/api/demo/seed` (Multi-state incident population)
- `/api/sensors` (Nationwide sensor network)
- `/api/hotspots` (Evidence fusion across all regions)
- `/api/hotspots/{h3_cell}/evidence` (Forecasting, demographics & corridor calculation)
- `/api/summary` (Aggregate threat overview)

---

## Deployment Guide

### Deploy to Google Cloud Run (Recommended)

```bash
# 1. Build and submit container image
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/conflux

# 2. Deploy to Cloud Run
gcloud run deploy conflux \
  --image gcr.io/YOUR_PROJECT_ID/conflux \
  --platform managed \
  --region asia-south1 \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY="your_key",DEMO_AUTO_SEED="true"
```

### Deploy to Render
1. Create a new **Web Service** on [Render.com](https://render.com).
2. Connect your GitHub repository.
3. Select **Docker** environment (uses the root `Dockerfile`).
4. Set environment variables: `GEMINI_API_KEY`, `OPENAQ_API_KEY`.

---

## License & Ethics
Built for public good under the MIT License. CONFLUX complies with responsible AI guidelines: all AI-generated public advisories require explicit human authorization before broadcast, and satellite/sensor data sources are transparently cited in every evidence bundle.
