# AirSense AI 🌿

**Understand your air. Make smarter decisions. Breathe better.**

AirSense AI is a context-aware urban air quality assistant. It combines modeled air-quality and weather data with a lightweight decision engine and an optional LLM to turn environmental readings into practical, personalized guidance.

## Chosen vertical
Urban air quality assistant.

## Problem
People often see an AQI number but do not know what it means for their planned activity, household context, or exposure. AirSense AI translates environmental measurements into understandable guidance while clearly communicating uncertainty.

## Features
- Current modeled air-quality data and weather for selected cities or browser geolocation
- US AQI, pollutant concentrations and a 12-hour outlook
- Personalized guidance using activity, age group and sensitivity context
- Optional Gemini or Groq conversational reasoning, with deterministic fallback
- Server-side API proxy, short-lived cache, input validation and health endpoint
- Responsive, accessible dashboard with persisted Light, Dark and System themes

## Architecture
- React + TypeScript + Vite frontend
- Express backend serves the built frontend and API endpoints
- Open-Meteo Air Quality API and Forecast API
- CAMS-based air-quality model estimates
- Rule-based decision engine; optional Gemini/Groq adapter

## Location & privacy

The dashboard is location-first:

- On first visit the app explains why location helps, then asks for browser geolocation permission. It never blocks the dashboard while waiting — Chennai loads immediately as the default city.
- Granted permission loads local air quality and weather and asks BigDataCloud's browser-only reverse-geocoding endpoint directly for a friendly place name (city, region, country). The server never sends coordinates to BigDataCloud.
- You can search any city worldwide (`/api/geocode`, backed by Open-Meteo's geocoding API). A manually selected location takes precedence over GPS for the rest of the session, and a "Back to my location" action returns to GPS at any time.
- Permission is never re-requested: once denied or dismissed, the app stays on Chennai with the search field, marked `DEFAULT` so GPS, selected, and default locations are always clearly distinguished.
- Precise coordinates are never sent to Gemini (locked in by a test) and never persisted beyond session storage. Environmental API coordinates are rounded to two decimal places (about 1 km) before server-side caching. For GPS naming only, the browser shares the current coordinates directly with BigDataCloud under its client-side endpoint terms; failure falls back honestly to “Your location.”
- Denial, timeout, unavailable position, and geocoding failures all degrade gracefully with a visible notice — the app never fabricates a location or an environmental reading.

## How it works
1. The browser resolves a location: GPS geolocation (after an explained permission request), a searched city, or the Chennai default.
2. The backend fetches air-quality and weather data from Open-Meteo and caches responses for 10 minutes in a bounded 500-entry LRU cache. Concurrent requests for the same rounded location share one upstream request.
3. The UI displays the reported AQI, pollutant levels and the next available hourly forecast from the current local hour onward.
4. The assistant combines the supplied readings with the user's activity and sensitivity profile.
5. If configured, an LLM explains the supplied facts. If the provider is unavailable or not configured, the deterministic guidance engine responds.

## Assumptions and limitations
- Open-Meteo air-quality values are model-based estimates, not guaranteed readings from a nearby regulatory station. Spatial resolution and forecast uncertainty apply.
- The MVP displays US AQI only. If the provider does not return a US AQI value, the app shows data as unavailable rather than substituting European AQI, because these scales are not interchangeable.
- The MVP uses global city search plus browser geolocation; it does not claim to identify the cleanest street or route.
- AQI bands follow the US EPA AQI category ranges when the US AQI field is available. European AQI is never substituted or converted because the scales are not interchangeable.
- Guidance is informational and not medical advice. Follow local public-health authorities.
- Alerts, saved profiles, multi-stop route exposure and long-term personal exposure tracking are future enhancements.

## Decision-making methodology

AirSense uses a deterministic exposure intelligence engine (`server/logic.js`) before any LLM involvement. The engine combines:

| Factor | How it contributes |
|---|---|
| US AQI (EPA bands) | Primary risk driver (level 1–6) |
| PM2.5 concentration | Independent contribution — can elevate risk beyond AQI alone (WHO/EPA breakpoints) |
| Activity intensity | Vigorous (running, cycling, outdoor workout, sports) adds risk; prolonged (commuting) adds less |
| Vulnerability | Children, older adults, and respiratory/heart-lung sensitivity each add risk |
| Wind speed | Low wind (<5 km/h) adds stagnation risk |
| Forecast trend | Future-only model forecast is reported as context; it never changes the current exposure recommendation |
| Data freshness | Stale (>3h), missing, invalid, or future-dated observations return `insufficient_data` |

The engine produces a structured decision: `overallRisk`, `activityRecommendation`, `recommendedAction`, `reasoning`, `sensitiveGroupAdvice`, `alternativeActivity`, `dataFreshness`, and `limitations`.

Open-Meteo is requested with Unix timestamps so observations and forecasts remain unambiguous across locations and daylight-saving changes. The next-12-hours series starts at the current local-hour bucket; completed past hours are excluded. A missing provider timestamp is never replaced with the server clock.

When Gemini is configured, it receives this decision as an authoritative baseline. Its structured response must include a strict `recommendation` enum (`suitable`, `caution`, `avoid`, or `insufficient_data`) that exactly matches the deterministic engine. A mismatch, malformed response, or invalid enum discards the entire AI response and returns the deterministic answer. Gemini may explain supplied facts but cannot weaken or replace the exposure recommendation. The same deterministic recommendation is used when no API key is configured.

### Decision limitations

- Air quality data are modelled estimates from CAMS via Open-Meteo, not regulatory station readings.
- The engine does not make medical diagnoses or claim health outcomes.
- It never recommends ignoring official public-health advisories — limitations text always references them.
- It never invents a better time or forecast without forecast evidence from the provider.
- PM2.5 independent assessment uses 24-hour breakpoints, not real-time sub-hourly thresholds.

## Run locally
Requirements: Node.js 20+ and npm.

```bash
npm install
cp .env.example .env
npm run dev
```

Frontend: `http://localhost:5173`  
Backend: `http://localhost:10000`

## AI configuration
Set these in `.env` (never commit the real key). AirSense uses the official `@google/genai` SDK with structured JSON output.

```env
AI_PROVIDER=gemini
AI_API_KEY=your_key
AI_MODEL=gemini-3.8-flash
```

Model identifier verified against the [official Gemini API model list](https://ai.google.dev/gemini-api/docs/models). `gemini-3.8-flash` is the current stable Flash model (released September 2026).

Optional tuning:

```env
AI_TIMEOUT_MS=18000      # overall deadline, including SDK calls, retries and backoff
AI_MAX_RETRIES=2         # retries on transient errors (429, 500, 503)
AI_MAX_OUTPUT_TOKENS=1024 # keep responses concise
```

If no key is configured, AirSense uses its deterministic safety guidance engine. If Gemini fails after retries, the app falls back to the same deterministic engine and reports `mode: "rules-fallback"`.

## Test and build
```bash
npm test
npm run build
npm run check
```

## Deploy to Render
1. Push this repository to a **public GitHub repository** with only the `main` branch.
2. In Render, choose **New → Web Service** and connect the repository.
3. Build command: `npm install && npm run build`
4. Start command: `npm start`
5. Health check path: `/api/health`
6. Add `AI_PROVIDER`, `AI_API_KEY` and optional `AI_MODEL` as Render environment variables. Do not add secrets to GitHub.
7. Deploy.

The included `render.yaml` provides a Blueprint configuration. Render web services must bind to `0.0.0.0`; this app does so and uses Render's `PORT`.

Production explicitly sets `NODE_ENV=production`, so CORS permits same-origin requests and configured `ALLOWED_ORIGINS` only. Default per-IP limits are 60 air-quality requests/minute, 30 location requests/minute, and 20 assistant requests/minute. Health checks are not rate-limited. These values and cache capacity/TTLs are configurable with the variables documented in `.env.example`.

## Repository compliance checklist
- [ ] Public GitHub repository
- [ ] Exactly one branch (`main`)
- [ ] Repository under 10 MB (do not commit `node_modules` or `dist`)
- [ ] `.env` and API keys excluded
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] README and demo screenshots included
- [ ] Verify submission form and link before final submission

## Data sources and attribution
- Air quality: [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api)
- Weather: [Open-Meteo Forecast API](https://open-meteo.com/en/docs)
- City search: [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) using GeoNames data
- GPS place names: [BigDataCloud Client-side Reverse Geocoding](https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api), called directly by the browser with the current GPS coordinates; generic fallback if unavailable
- Atmospheric model: Copernicus Atmosphere Monitoring Service (CAMS), as served by Open-Meteo.

## License
Hackathon demonstration project. Review upstream API terms and attribution requirements before public/commercial use.
