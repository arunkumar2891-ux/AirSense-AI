# AirSense AI 🌿

**Understand your air. Make smarter decisions. Breathe better.**

AirSense AI is a context-aware urban air quality assistant. It combines modeled air-quality and weather data with a lightweight decision engine and an optional LLM to turn environmental readings into practical, personalized guidance.

## Chosen vertical
Urban air quality assistant.

## Problem
People often see an AQI number but do not know what it means for their planned activity, household context, or exposure. AirSense AI translates environmental measurements into understandable guidance while clearly communicating uncertainty.

## Features
- Live modeled air-quality data and weather for selected cities or browser geolocation
- US AQI, pollutant concentrations and a 12-hour outlook
- Personalized guidance using activity, age group and sensitivity context
- Optional Gemini or Groq conversational reasoning, with deterministic fallback
- Server-side API proxy, short-lived cache, input validation and health endpoint
- Responsive dashboard and accessible form controls

## Architecture
- React + TypeScript + Vite frontend
- Express backend serves the built frontend and API endpoints
- Open-Meteo Air Quality API and Forecast API
- CAMS-based air-quality model estimates
- Rule-based decision engine; optional Gemini/Groq adapter

## How it works
1. The browser selects a preset city or requests geolocation permission.
2. The backend fetches air-quality and weather data from Open-Meteo and caches responses for 10 minutes.
3. The UI displays the reported AQI, pollutant levels and available hourly forecast.
4. The assistant combines the supplied readings with the user's activity and sensitivity profile.
5. If configured, an LLM explains the supplied facts. If the provider is unavailable or not configured, the deterministic guidance engine responds.

## Assumptions and limitations
- Open-Meteo air-quality values are model-based estimates, not guaranteed readings from a nearby regulatory station. Spatial resolution and forecast uncertainty apply.
- The MVP displays US AQI only. If the provider does not return a US AQI value, the app shows data as unavailable rather than substituting European AQI, because these scales are not interchangeable.
- The MVP uses city presets plus browser geolocation; it does not claim to identify the cleanest street or route.
- AQI bands follow the US EPA AQI category ranges when the US AQI field is available. If European AQI is returned, its category labels are approximate display guidance and should not be treated as a regulatory conversion.
- Guidance is informational and not medical advice. Follow local public-health authorities.
- Alerts, saved profiles, multi-stop route exposure and long-term personal exposure tracking are future enhancements.

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
AI_TIMEOUT_MS=18000      # request timeout
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
- Atmospheric model: Copernicus Atmosphere Monitoring Service (CAMS), as served by Open-Meteo.

## License
Hackathon demonstration project. Review upstream API terms and attribution requirements before public/commercial use.
