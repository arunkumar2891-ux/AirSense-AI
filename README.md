# AirSense AI 🌿

**Understand your air. Make smarter decisions. Breathe better.**

AirSense AI is a context-aware urban air quality assistant. It combines modeled air-quality and weather data with a lightweight decision engine and an optional LLM to turn environmental readings into practical, personalized guidance.

## Chosen vertical
Urban air quality assistant.

## Problem
People often see an AQI number but do not know what it means for their planned activity, household context, or exposure. AirSense AI translates environmental measurements into understandable guidance while clearly communicating uncertainty.

## What makes AirSense different
- **Decisions are deterministic; the LLM only explains.** Exposure guidance comes from a rule engine with explicit thresholds. Gemini receives the decision as an authoritative baseline and its response is discarded entirely if its recommendation enum does not match it exactly. Scheduling (GoWindow) never calls an LLM at all.
- **Future plans never rewrite the present.** The current exposure decision uses only the current observation. GoWindow evaluates future hours separately and is labelled as forecast estimates, so a good window later cannot make bad air now look safe.
- **Missing data is never favorable data.** A missing US AQI reading means "unavailable," not "clean." Incomplete PM2.5, weather, or conflicting duplicate hours are disclosed in limitations and excluded from scheduling rather than assumed safe.
- **US AQI and European AQI are never mixed.** The scales are not interchangeable; if US AQI is absent the app says so instead of converting.
- **Time preferences respect your day without weakening safety.** Preferred times filter already-safe windows; they never relax the thresholds that decide what is safe.

## Features
- Current modeled air-quality data and weather for selected cities or browser geolocation
- US AQI, pollutant concentrations and a 12-hour outlook
- Personalized guidance using activity, age group and sensitivity context
- GoWindow: deterministic scheduling of 15–180 minute outdoor activities with optional time-of-day preferences and a 12-hour planning timeline
- Optional Gemini or Groq conversational reasoning, with deterministic fallback
- Server-side API proxy, short-lived cache, input validation and health endpoint
- Responsive, accessible dashboard with persisted Light, Dark and System themes

## Architecture
- React + TypeScript + Vite frontend
- Express backend serves the built frontend and API endpoints
- Open-Meteo Air Quality API and Forecast API
- CAMS-based air-quality model estimates
- Rule-based decision engine; optional Gemini/Groq adapter
- `POST /api/gowindow` ranks future activity windows from server-fetched forecasts. It does not accept client-supplied readings and does not call Gemini.

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
6. `POST /api/gowindow` separately evaluates the trusted hourly forecast for a 15–180 minute activity. The dashboard sends the selected location, activity profile, duration, and an optional time preference. Preferred times use the location timezone. Suitable windows, alternatives outside that preference, no suitable window, and insufficient forecast data stay distinct and do not change the current exposure guidance. The planning timeline draws those returned windows on the next 12 local hours and does not create recommendations of its own.

## GoWindow scheduling

GoWindow finds up to three non-overlapping future windows for one outdoor activity. It is fully deterministic — no LLM is involved in scheduling.

1. The browser sends only the selected coordinates, activity profile, duration (15–180 minutes), and an optional time preference. It never sends readings, and any client-supplied environmental fields are ignored (locked by tests).
2. The server fetches the trusted Open-Meteo forecast itself, in Unix timestamps so daylight-saving transitions stay unambiguous, and evaluates each of the next 12 hourly instants with the same `server/logic.js` exposure engine that powers current guidance.
3. Hours classified `suitable` for the profile are chained into contiguous intervals. A window must be fully covered by suitable hours — gaps, unavailable readings, and conflicting duplicate hours break a window rather than being assumed safe.
4. Candidate windows are ranked by worst-hour US AQI, then known PM2.5 (windows missing PM2.5 rank below windows with known values at equal AQI and disclose it), then low-wind stagnation hours, then earliest start.
5. If a time preference is set, windows must lie fully inside it, computed in the location's IANA timezone — never the browser or server timezone. Suitable windows outside the preference may be listed as clearly labelled **alternatives**, never as the primary recommendation. If nothing anywhere is suitable, the response is an explicit `no_suitable_window` — nothing is fabricated.

### API

```http
POST /api/gowindow
Content-Type: application/json

{
  "latitude": 13.0827,
  "longitude": 80.2707,
  "activity": "running",
  "profile": { "activity": "running", "ageGroup": "adult", "sensitivity": "general" },
  "durationMinutes": 45,
  "timePreference": "daytime"
}
```

Input is validated against allowlists before any upstream call: coordinates must be finite and in range; `activity`, `ageGroup`, and `sensitivity` must be known values; `profile.activity` must match `activity`; `durationMinutes` must be an integer from 15 to 180; `timePreference` must be one of `any`, `morning`, `afternoon`, `evening`, `daytime` (omitting it preserves the original any-time behavior). Invalid input returns `400` with no upstream fetch. The endpoint is rate-limited like the other data endpoints and shares the bounded upstream cache.

Responses carry a `status` of `suitable_windows`, `outside_preference` (alternatives only), `no_suitable_window`, or `insufficient_data`, plus per-window AQI/PM2.5/weather ranges, ranking explanations, data-freshness labels, and limitations. `outside_preference` windows are marked `placement: "alternative"`.

### Time preferences

| Preference | Local range (location timezone) |
|---|---|
| `any` | No restriction |
| `morning` | 5 AM–12 PM |
| `afternoon` | 12 PM–5 PM |
| `evening` | 5 PM–10 PM |
| `daytime` | 5 AM–10 PM (dashboard default) |

A window counts as inside a preference only when its start and end both fall inside the range on the same local day. Preferences filter already-suitable windows; they never change exposure thresholds.

### Planning timeline

The dashboard draws the next 12 local hours from the same forecast data: hour labels in the location timezone (midnight and DST handled via absolute instants), per-hour forecast US AQI category and PM2.5, the selected preference range, a current-time marker, and the scheduler's returned windows. Hour cells are informational only — they are never selectable as activities. Only backend-returned windows are selectable, and selecting one shows its start/end, duration, forecast AQI, PM2.5, weather, and ranking explanation. Hours without forecast readings are shown as "No forecast" and are never interpolated. The current exposure card remains a separate decision above.

### Limitations and safety

- Windows are forecast model estimates (CAMS via Open-Meteo), not sensor readings, guarantees, or medical clearance. Official local public-health advisories always take precedence.
- Missing US AQI data yields `insufficient_data`; missing PM2.5 is disclosed and never treated as clean air; missing weather is disclosed and never assumed.
- A "suitable" window describes forecast data only. Conditions can change; the freshness label on every window says how old the underlying model run is.

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
