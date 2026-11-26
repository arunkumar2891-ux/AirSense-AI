# AirSense AI

**Understand the air you have. Choose a time that fits the activity.**

AirSense AI is a deterministic outdoor-exposure assistant. It turns modelled air-quality and weather data into an activity-specific recommendation for right now, and it uses the same rules to find later forecast windows for a chosen activity and duration. An optional Gemini call can explain the user's question. It cannot replace the decision or the measurements.

## Project overview

People usually see one AQI number and still have to decide whether a run, a commute, or outdoor play makes sense. AirSense keeps that decision in a rule engine. The current reading answers "what should I do now?" GoWindow answers "when, in the next 12 hours, does this activity have a long enough suitable interval?" A better hour later does not change the current recommendation.

The dashboard opens on Chennai without an account or a location grant. Search, optional browser location, activity, age group, and sensitivity change the same deterministic result. Gemini is optional. With no API key, the assistant still returns the engine's recommendation.

## Problem

An AQI category does not say whether a particular outdoor activity is suitable, how old the underlying fetch is, or whether a later hour is actually long enough. Generic chatbots can also rewrite a cautious result into a more reassuring one. AirSense separates the decision from the explanation and labels modelled estimates as estimates.

## What makes AirSense different

- **The decision is deterministic.** US AQI, PM2.5, activity, age, sensitivity, eligible wind, and retrieval freshness produce `overallRisk`, `activityRecommendation`, and `recommendedAction` in `server/logic.js`. Gemini cannot replace those fields.
- **GoWindow is the scheduling feature.** It searches the next 12 forecast hours for up to three non-overlapping windows that cover the requested duration. It uses the same exposure engine and never calls Gemini.
- **Now and later stay separate.** The overview decision uses the current air reading. GoWindow evaluates future hours on their own. A suitable window does not make the current recommendation more favorable.
- **Missing data stays missing.** A missing US AQI is unavailable, not clean. Missing PM2.5, missing weather, and conflicting duplicate hours are disclosed and are not treated as favorable.
- **US AQI stays on the US scale.** European AQI is requested from the provider only so it can be ignored. It is never displayed or converted.
- **Time preferences filter windows after the safety decision.** Morning, afternoon, evening, and daytime do not relax an exposure threshold.

## Data sources and limitations

| Source | Role |
|---|---|
| [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api) | Current and hourly US AQI and pollutant fields. The displayed scale is US AQI. |
| [Open-Meteo Forecast API](https://open-meteo.com/en/docs) | Current weather, and hourly weather for GoWindow. |
| [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) | City search. Place names come from GeoNames. |
| [BigDataCloud client reverse geocoding](https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api) | Optional browser-only place name for a GPS fix. |
| Copernicus Atmosphere Monitoring Service (CAMS) | Atmospheric model behind the Open-Meteo air-quality fields. |

Air-quality values are modelled estimates, not readings from a nearby regulatory station. The app does not identify the cleanest street or route.

Resolution depends on what the provider identifies:

- Outside the CAMS Europe coverage envelope, Open-Meteo serves the CAMS global model. AirSense discloses that model at its documented nominal resolution of about 0.4°, approximately 45 km. A snapped serving-cell coordinate is not that resolution.
- Inside the envelope, a provider `model` or `domain` of `cams_europe` or `cams_global` uses that model's documented resolution. CAMS Europe's documented grid is about 0.1°, approximately 11 km.
- Inside the envelope, when the provider does not identify the serving domain, AirSense does not choose a resolution. The European and global models can both be in use, so the European resolution stays unverified.

Guidance is informational and is not medical advice. Local public-health advisories take precedence. Alerts, saved profiles, multi-stop routes, and long-term personal exposure tracking are not part of this demo.

## Freshness policy

Three timestamps mean different things:

| Field | Meaning |
|---|---|
| `forecastValidAt` | When the forecast value applies. For an hourly slot, this is the hour being labelled. It does not age the data. |
| `retrievedAt` | When AirSense fetched that provider response. This is the freshness clock for that response. |
| `modelInitializedAt` | A genuine model-initialization time, kept only when the provider response includes one. It is never inferred from generation time, the server clock, or `forecastValidAt`. |

Retrieval age is not model-run age. A window or overview label that says when data was retrieved is describing `retrievedAt`. Model-run age appears only beside a genuine `modelInitializedAt`. When that timestamp is absent, the label says the model-run age is unavailable.

These limits are AirSense policy, not a provider guarantee:

- A timestamp up to 5 minutes ahead of the evaluation clock has age zero. That allowance covers clock skew.
- A timestamp more than 5 minutes ahead is unknown.
- A missing, blank, or unparseable timestamp is unknown.
- Age through 30 minutes is fresh.
- Age through 3 hours is aging. Aging data can still support a current decision or a GoWindow result, and the age is disclosed.
- Age over 3 hours is stale. Stale or unknown air data does not support a current activity recommendation. Stale or unknown air or weather data does not support a GoWindow schedule.

Air quality, current weather, and GoWindow weather are validated separately. The air response's `retrievedAt` never stands in for `weatherRetrievedAt`, and an hour's valid time never stands in for either retrieval time. Current wind uses the current weather fetch. GoWindow requires both its air-quality retrieval time and its weather retrieval time to be fresh or aging.

## Exposure methodology

The engine in `server/logic.js` runs before any model call. US EPA category ranges classify the reported US AQI: Good through 50, Moderate through 100, Unhealthy for Sensitive Groups through 150, Unhealthy through 200, Very Unhealthy through 300, and Hazardous above that. PM2.5 can raise the score from its own concentration bands. A missing PM2.5 value cannot lower the recommendation required by the reported US AQI.

| Factor | How it contributes |
|---|---|
| US AQI | Primary risk level from the EPA bands above. |
| PM2.5 | Independent contribution. Its absence is not treated as clean air. |
| Activity | Vigorous activities (running, cycling, outdoor workout, sports) add more risk than commuting. |
| Vulnerability | Child, older adult, respiratory sensitivity, and heart or lung condition add risk. |
| Wind | See the wind rule below. Wind never uses the air-quality retrieval time. |
| Forecast trend | Reported as context. It does not change the current recommendation. |
| Retrieval freshness | Stale or unknown air data returns `insufficient_data`. |

A reported US AQI in the Unhealthy for Sensitive Groups band or worse cannot produce a `suitable` recommendation. Very Unhealthy and Hazardous cannot produce a recommendation below `avoid`. Unhealthy air together with a vigorous activity is `avoid`.

### Wind

Wind speed is eligible only when `weatherRetrievedAt` is fresh or aging.

- Below 5 km/h adds 0.5 points.
- 5 km/h or above adds zero points. The reading was considered; it does not improve the score.
- Stale weather, an unknown weather retrieval time, or a missing or invalid wind speed excludes wind from the score.
- Excluded wind is not treated as favorable. Zero points from exclusion means "not used," not "good ventilation."

## GoWindow

GoWindow finds up to three non-overlapping future windows for one outdoor activity. Scheduling is deterministic.

1. The browser sends coordinates, the activity profile, a duration, and an optional time preference. It does not send air or weather readings. Client-supplied environmental fields are ignored.
2. The server fetches the Open-Meteo air-quality and weather forecasts itself, using Unix timestamps so daylight-saving transitions stay unambiguous.
3. Both retrieval timestamps must be fresh or aging. If either is stale or unknown, the status is `insufficient_data` and no window is returned.
4. Each of the next 12 hourly instants is classified with the same exposure engine. An hour's `forecastValidAt` labels that hour. It does not determine retrieval freshness.
5. Hours classified `suitable` are chained into contiguous intervals. The whole duration must be covered. Gaps, unavailable readings, and conflicting duplicate hours break a window.
6. Candidates are ranked by lowest worst-hour US AQI, then known PM2.5 ahead of missing PM2.5, then lower known PM2.5, then fewer hours below 5 km/h, then earlier start. Missing PM2.5 does not rank as clean air.

### Request

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

`durationMinutes` must be an integer from 15 to 180. `timePreference` is `any`, `morning`, `afternoon`, `evening`, or `daytime`. Omitting it leaves the search unrestricted. The dashboard default is `daytime`. Invalid input returns HTTP 400 and does not call the provider.

| Preference | Local range in the location timezone |
|---|---|
| `any` | No restriction |
| `morning` | 5:00 AM–12:00 PM |
| `afternoon` | 12:00 PM–5:00 PM |
| `evening` | 5:00 PM–10:00 PM |
| `daytime` | 5:00 AM–10:00 PM |

A window is inside a preference only when its start and end both fall inside that range on the same local day. The location's IANA timezone is used, not the browser or server timezone.

### Response states

| Status | Meaning |
|---|---|
| `suitable_windows` | Up to three ranked windows cover the duration. With a preference, they lie fully inside it. |
| `outside_preference` | Nothing inside the preference is long enough. Returned windows are alternatives, marked `placement: "alternative"`, and are not the primary recommendation. |
| `no_suitable_window` | The forecast was usable, and no interval is long enough for the duration. This is distinct from missing data. |
| `insufficient_data` | A retrieval time is stale or unknown, US AQI is missing, or the next 12 hours do not contain usable forecast hours. `windows` is empty. |

Each window includes US AQI and PM2.5 ranges when known, weather ranges, a ranking explanation, limitations, and retrieval freshness. The planning timeline draws the next 12 local hours and the windows the server returned. Hour cells are not themselves recommendations.

## Gemini architecture

An obvious instruction override, prompt extraction, or credential request is declined before Gemini is called. The same local gate also recognizes clearly environmental, clearly unrelated, and ambiguous questions. It runs when no API key is configured and whenever the Gemini classifier fails, so an unrelated question is not answered with the exposure paragraph. Ambiguous questions receive a fixed request for a more specific environmental question.

When a key is configured, clearly unrelated and ambiguous questions are still decided locally and are not sent to Gemini. Other questions are also classified by Gemini at temperature 0, with the question passed as data and with no tools. The classifier returns `environmental`, `mixed`, or `unrelated`. An unrelated result is declined. A span is sent to the explainer only when it is an exact contiguous substring of the normalized question and the local gate still calls that span environmental. The server adds its own sentence when part of the request was left unanswered. If classification times out or the JSON is unusable, the explainer is not called and the local gate decides. An explanation that discloses the system prompt, an API key, or internal configuration is discarded.

When a question is accepted and `AI_API_KEY` is set, the server asks the Gemini SDK for JSON with three fields:

- `recommendation`: `suitable`, `caution`, `avoid`, or `insufficient_data`. It must equal the engine's `activityRecommendation`.
- `claimIds`: IDs copied from the server-built `allowedClaims` list. These sentences stay server-authored evidence.
- `explanation`: a question-specific answer. It may explain the topic, but it may not introduce a measurement, a number word, a different category, or a different recommendation.

`buildExplanationClaims` creates a claim only when its source fact exists and its freshness state allows it. A claim whose fact is missing is not offered. The IDs are:

| Claim ID | Offered when |
|---|---|
| `modelled_estimate` | The reading is a modelled estimate. |
| `us_aqi` | A valid US AQI value is present. |
| `pm25` | A valid PM2.5 value is present. |
| `wind_adjustment` | Eligible wind below 5 km/h added 0.5 points. |
| `wind_considered` | Eligible wind at 5 km/h or above added no points. |
| `wind_excluded` | Wind was missing, stale, or had an unknown retrieval time. |
| `weather_aging` | Eligible wind came from aging weather. |
| `insufficient_data` | The engine recommendation is `insufficient_data`. |
| `activity_recommendation` | The engine produced a suitable, caution, or avoid action. |
| `decision_reasoning` | The engine supplied reasoning text. |
| `not_medical_advice` | Always. This sentence is server-authored. |

The server accepts a response only when all of these hold:

- The object has no fields other than `recommendation`, `claimIds`, and `explanation`.
- The enum matches the deterministic recommendation exactly.
- `claimIds` contains 1 to 12 unique IDs, each of which was offered for this decision.
- The explanation stays within the length limit and does not add digits, number words, an unsupported current-condition claim, a mismatched category, a mismatched recommendation, excluded wind as a current fact, or an unlabeled hypothetical.

A valid explanation is the assistant answer. The selected claim sentences are returned separately as evidence. The exposure decision card is unchanged. A server-built decision trace explains the inputs, scoring factors, wind treatment, and result. Gemini does not write that trace. Coordinates are not included in the prompt.

A question of the form "what if the wind speed were 3 km/h" gets a separate hypothetical. The exposure engine scores that assumed speed. The response labels it hypothetical, and the current decision keeps the retrieved wind. Other hypotheticals are not recalculated.

| Mode | When |
|---|---|
| `rules` | No API key, and the local gate finds a clearly environmental question. The deterministic answer is returned and Gemini is not called. |
| `ai` | Gemini accepts an environmental question, or a mixed question had a valid environmental substring, and the enum, claim IDs, and explanation validate. |
| `rules-fallback` | The explainer fails, or the Gemini classifier fails and the local gate still finds the question environmental. The deterministic answer is returned. |
| `declined` | The question is an obvious injection, clearly unrelated, or a mixed question whose environmental substring cannot be isolated. The answer is a fixed refusal. No current-reading evidence is attached. |
| `ambiguous` | The question has no clear environmental or unrelated intent. The answer asks for a more specific environmental question. |

The assistant calls the Gemini SDK only when `AI_API_KEY` is set. `AI_MODEL` selects that model's id and defaults to `gemini-3.8-flash`.

Optional tuning, with the defaults shown:

```env
AI_API_KEY=
AI_MODEL=gemini-3.8-flash
AI_TIMEOUT_MS=18000
AI_MAX_RETRIES=2
AI_MAX_OUTPUT_TOKENS=1024
```

`gemini-3.8-flash` is the default model id. Put the real key only in the local `.env` or in the host's environment settings. Do not commit it.

## Privacy and security

Browser geolocation is optional. On a first visit the dashboard explains the request and continues on Chennai immediately. Granting permission loads local air and weather. The browser may ask BigDataCloud directly for a city, region, and country. That request does not pass through the AirSense server. Denying or dismissing location keeps Chennai and does not ask again in that session. A searched city overrides GPS until "Back to my location."

The assistant and GoWindow send coordinates, the question, and the profile. They do not send air or weather readings. The server fetches Open-Meteo itself and ignores client-supplied measurements. Coordinates are rounded to two decimal places, about 1 km, before the bounded cache key is formed. The selected place is kept in `sessionStorage` for the browser session and is not written to a database.

API protections:

- Helmet security headers. Browser connections are limited to this origin and `https://api.bigdatacloud.net`.
- JSON bodies are limited to 30 KB.
- Production (`NODE_ENV=production`) allows same-origin requests and origins listed in `ALLOWED_ORIGINS`. Development allows local origins so the Vite server can call the API.
- Default per-IP limits are 60 air-quality requests per minute, 60 GoWindow requests per minute, 30 geocoding requests per minute, and 20 assistant requests per minute. The air-quality and GoWindow limits are separate. `/api/health` is not rate-limited.
- Upstream responses are cached in a 500-entry LRU. Environmental responses last 10 minutes. Geocoding responses last 24 hours. Concurrent requests for the same cached URL share one upstream call.
- Provider failures return a timeout or unavailable error. They do not invent a reading.

## Architecture and decision flow

```text
Browser (React, TypeScript, Vite)
  |  relative /api requests
  v
Express
  |-- GET  /api/air-quality     current air + current weather
  |-- GET  /api/geocode         city search
  |-- GET  /api/reverse-geocode generic GPS label if the browser lookup fails
  |-- POST /api/gowindow        forecast windows
  |-- POST /api/assistant       deterministic decision and trace, then optional Gemini explanation
  |-- GET  /api/health
  v
Open-Meteo air quality and forecast
  v
server/logic.js  ->  recommendation
server/gowindow.js  ->  window status
server/gemini.js  ->  validated explanation plus claim IDs, or rules / rules-fallback
```

In production, Express serves the Vite build from `dist/` and the API on the same origin. The client calls relative `/api` routes, so the built frontend does not embed an API host. Development runs Vite at `http://localhost:5173` and proxies `/api` to `http://localhost:10000`.

## Demo

1. Install and start the app with the commands in [Run locally](#run-locally). Leave `AI_API_KEY` empty for the deterministic path.
2. Open `http://localhost:5173`. Chennai loads without granting location. The overview shows a modelled US AQI estimate, retrieval timing, and activity guidance.
3. Change activity, age group, or sensitivity and ask the assistant a short question. The recommendation matches the exposure engine. With no key, the response mode is `rules`.
4. Open GoWindow, keep the daytime preference, choose a duration from 15 to 180 minutes, and request windows. Compare a returned window with the current overview: the window does not rewrite the current recommendation.
5. Deny location, or search another city, and confirm the dashboard names the source of the place. A failed lookup stays on an honest unavailable state rather than a fabricated reading.

This repository does not include demo screenshots.

## Run locally

Requirements: Node.js 20 or newer, and npm.

```bash
npm install
cp .env.example .env
npm run dev
```

- App: `http://localhost:5173`
- API: `http://localhost:10000`

`npm run dev` runs the API and the Vite client together. An empty `AI_API_KEY` is a valid demo configuration. The variable names and defaults live in `.env.example`. Fill in `AI_API_KEY` only if you want Gemini to write a validated explanation.

## Test and build

```bash
npm test
npm run typecheck
npm run build
npm run check
```

`npm test` runs the Node test runner. `npm run typecheck` runs `tsc --noEmit`. `npm run build` writes the frontend to `dist/`. `npm run check` runs typecheck, tests, and the production build in that order.

To serve the production build locally:

```bash
npm run build
NODE_ENV=production npm start
```

`npm start` runs `node server/index.js`, binds `0.0.0.0`, and uses `PORT` or 10000. It serves `dist/` and the API together. Run the build first. Without `NODE_ENV=production`, the process stays in development CORS mode.

## Deploy to Render

1. Push the repository to a public GitHub repository with only the `main` branch.
2. In Render, choose **New → Web Service** and connect the repository. The included `render.yaml` is a Blueprint for the same service.
3. Build command: `npm install && npm run build`
4. Start command: `npm start`
5. Health check path: `/api/health`
6. Set `NODE_ENV` to `production`. The Blueprint does this. A manual service needs the same variable, because production CORS and proxy trust depend on it.
7. Set `AI_API_KEY` if the validated Gemini explanation should run. `AI_MODEL` is optional and defaults to `gemini-3.8-flash`. Leave the key unset to serve the deterministic assistant. Do not put secrets in GitHub.
8. Deploy.

Render supplies `PORT`. The server binds `0.0.0.0`. Optional rate-limit, cache, and `ALLOWED_ORIGINS` variables are listed in `.env.example`.

## Repository compliance checklist

- [ ] Public GitHub repository
- [ ] Exactly one branch (`main`)
- [ ] Repository under 10 MB, with `node_modules` and `dist` uncommitted
- [ ] `.env` and API keys excluded
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] README included
- [ ] Demo screenshots included

No screenshot files are in this repository, so the screenshot item stays open.

## License

Hackathon demonstration project. Review upstream API terms and attribution requirements before public or commercial use.
