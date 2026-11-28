# AirSense AI

**Understand the air you have. Choose a time that fits the activity.**

AirSense AI is an urban air-quality assistant for families and communities. It assesses outdoor exposure from modelled environmental data and keeps that decision in a rule engine. The current reading answers what to do now. GoWindow searches later forecast hours for a suitable outdoor activity window. The Family Assistant plans one household outing, including child-aware outdoor play, and gives separate recommendations for walking and cycling. An optional Gemini call can explain a question or a family plan. Every explanation is checked against the engine. A failed check falls back to the deterministic text and cannot replace the decision or the measurements.

## Project overview

People usually see one AQI number and still have to decide whether a run, a commute, or outdoor play makes sense. AirSense keeps that decision in a rule engine. The current reading answers "what should I do now?" GoWindow answers "when, in the next 12 hours, does this activity have a long enough suitable interval?" A better hour later does not change the current recommendation. The Family Assistant answers a household question with the same engine: one shared outing, plus walking and cycling judged on their own.

The dashboard opens on Chennai without an account. On a first visit it explains optional browser location and continues immediately. If this browser has already allowed location, the current place loads automatically with no extra prompt. Search, optional browser location, activity, age group, and sensitivity change the same deterministic result. Gemini is optional. With no API key, the assistant and the Family Assistant still return the engine's recommendation.

The saved place, the family household form, and the GoWindow activity profile, duration, and time preference stay in `localStorage` until you clear them. Closing the tab does not remove them. Use **Clear saved place**, **Reset household**, or **Reset activity settings** to return those choices to the defaults. Forecast results, air-quality readings, family plans, and explanations are not stored in the browser.

The current modelled air quality, weather, location, and alert banners stay open, and so do the 12-hour hourly forecast and the pollutant breakdown. They cannot be collapsed. The pollutant breakdown sits above the **Plan your day** cards. Two cards choose what to plan, and nothing is shown until you click one: **Plan the day for you** shows only GoWindow, and **Plan the day for your entire family** shows only the Family air plan. The choice is not saved, so every page load starts with neither planner shown. The GoWindow and Family navigation links switch to their card. The chosen planner and Ask AirSense AI start collapsed. Each header opens and closes that section, and the choice is kept in `sessionStorage` for the browser tab under `airsense.sections`. A floating **Back to top** button appears after the page has scrolled 480 pixels. It scrolls smoothly, or jumps when the browser asks for reduced motion.

## Problem

An AQI category does not say whether a particular outdoor activity is suitable, how old the underlying fetch is, or whether a later hour is actually long enough. Generic chatbots can also rewrite a cautious result into a more reassuring one. AirSense separates the decision from the explanation and labels modelled estimates as estimates.

## What makes AirSense different

- **The decision is deterministic.** US AQI, PM2.5, activity, age, sensitivity, eligible wind, and retrieval freshness produce `overallRisk`, `activityRecommendation`, and `recommendedAction` in `server/logic.js`. Gemini cannot replace those fields.
- **GoWindow is the scheduling feature.** It searches the next 12 forecast hours for up to three non-overlapping windows that cover the requested duration. It uses the same exposure engine and never calls Gemini.
- **Now and later stay separate.** The overview decision uses the current air reading. GoWindow evaluates future hours on their own. A suitable window does not make the current recommendation more favorable.
- **Missing data stays missing.** A missing US AQI is unavailable, not clean. Missing PM2.5, missing weather, and conflicting duplicate hours are disclosed and are not treated as favorable.
- **US AQI stays on the US scale.** European AQI is requested from the provider only so it can be ignored. It is never displayed or converted.
- **Time preferences filter windows after the safety decision.** Morning, afternoon, evening, and daytime do not relax an exposure threshold.
- **A household does not get a second score.** Every age group present (children, older adults, adults) is scored by the existing engine at the shared outing, and the household takes the most protective result. Young children and older children both use the existing child profile. Walking and cycling are scored for every group present and follow the most protective one. An adult result is not permission for a child.

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

Guidance is informational and is not medical advice or a treatment recommendation. AirSense does not diagnose anyone. Local public-health advisories take precedence. Alerts, saved profiles, multi-stop routes, and long-term personal exposure tracking are not part of this demo.

## Safety and limitations

The current exposure assessment and a future GoWindow schedule answer different questions. The overview and the Family Assistant's current decision use the current air reading and its retrieval time. GoWindow classifies later forecast hours. A suitable window does not make the current recommendation more favorable, and the current recommendation does not rewrite a later hour.

Missing or stale data stays unfavorable. A missing US AQI is unavailable, not clean. Stale or unknown air data returns `insufficient_data` for the current decision. Stale or unknown air or weather data returns `insufficient_data` for a GoWindow schedule and does not invent a window. The same rule applies to the household outing, walking, and cycling.

The Family Assistant also keeps these limits:

- Indoor air quality is not measured. The plan says so, and ventilation guidance follows the outdoor decision. It does not report an indoor concentration.
- Emissions guidance is qualitative. The plan sets `emissionsSavingsQuantified` to false and does not calculate a saving.
- No household field accepts a name, date of birth, address, or medical history. Sensitivity uses the existing exposure profiles.
- The safety decision stays with the exposure engine. An explanation describes the plan. It does not choose the recommendation, the schedule, or the walking and cycling results.

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

On the dashboard, the activity profile, duration, and time preference are remembered in `localStorage` under `airsense.gowindow` until **Reset activity settings**. A returned schedule is not saved. Changing the place or the profile clears any on-screen schedule so a stale result is not shown.

## Family Assistant

The Family Assistant builds one household plan from the selected location. The browser sends coordinates and the household. It does not send air or weather readings, and extra fields are rejected. The server fetches the forecast itself and runs the same exposure engine used everywhere else.

A household lists age-band counts, one sensitivity, up to four routines, and one shared outing of 15 to 180 minutes. Age bands are `young_child`, `older_child`, `adult`, and `older_adult`. Both child bands use the engine's child profile. There is no separate child score. When a child is present, the shared outing is children's outdoor play. An adult-only household uses the first configured routine in the existing priority order. Commuting, when selected, is an adult-only result and does not apply to children.

Walking and cycling are independent of that outing. Walking is scored as `daily activities` and cycling as `cycling` for every age group present, and the most protective result applies. Each is eligible only when that result is `suitable` or `caution`. `avoid` and `insufficient_data` are not eligible. The response includes a `members` list with each group's recommendation and which group governs (`basis.householdRule` is `most_protective_member`), and the Family panel shows that list. An unknown result counts as the most protective.

Every plan reports indoor air as not measured and emissions as qualitative. At-home guidance, routine recommendations, and short explanations of why those actions can help are included from the same plan. Missing or stale data does not turn that guidance into a favorable outing.

The household counts, sensitivity, routines, outing duration, and time preference are remembered in `localStorage` under `airsense.family.household` until **Reset household**. Personal fields such as names, dates of birth, addresses, and diagnoses are not collected or stored.

### Explain using AI

**Get the Latest Plan** asks for the deterministic plan. The dashboard shows the household decision, activity recommendations, and schedule, and it does not show an explanation yet. **Explain using AI** sends the same household with `explain: true`.

The explanation object has only `mode` and `text`:

| Mode | What the dashboard shows |
|---|---|
| `ai` | The accepted Gemini text, labelled **AI-generated**. |
| `rules` | The deterministic explanation, with no origin label. This is also the result when `AI_API_KEY` is unset, and Gemini is not called. |
| `rules-fallback` | The same deterministic explanation, with no origin label. The explanation was requested, but it was not accepted: the provider call failed, the reply failed validation, or the local gate declined it before Gemini. |

The interface does not badge the deterministic text as AI-generated. Above the explanation text, a short disclaimer says the explanation describes the plan and does not choose the safety decision. A failed network request leaves the plan in place, reports that the AI explanation is unavailable, and does not substitute a local explanation. Changing the household or updating the plan clears the explanation that was on screen. The family explanation is one Gemini attempt. It does not retry.

### Request

```http
POST /api/family-plan
Content-Type: application/json

{
  "latitude": 13.0827,
  "longitude": 80.2707,
  "explain": false,
  "household": {
    "members": [{ "ageBand": "young_child", "count": 1 }],
    "sensitivity": "general",
    "routines": ["children's outdoor play"],
    "outing": { "durationMinutes": 45, "timePreference": "daytime" }
  }
}
```

`explain` may be omitted. Only `true` asks Gemini to explain the plan the engine already built. Invalid input returns HTTP 400 and does not call the provider. A forecast timeout returns HTTP 504, and another forecast failure returns HTTP 502, both with `Forecast data is temporarily unavailable.` The default limit is 30 family-plan requests per minute per client IP, separate from GoWindow and the assistant.

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

Browser geolocation is optional. On a first visit the dashboard explains the request and continues on Chennai immediately. If this browser has already allowed location, the current place is loaded automatically and the permission question is not shown again. Otherwise, granting permission loads local air and weather. The browser may ask BigDataCloud directly for a city, region, and country. That request does not pass through the AirSense server. Denying or dismissing location keeps Chennai and does not ask again in this browser. A searched city overrides GPS on a new visit and stays until **Clear saved place** or **Back to my location**.

Client-side storage, all in this browser only and not written to a database:

| Key | Storage | What it holds |
|---|---|---|
| `airsense.manual` | `localStorage` | A searched place (coordinates and label). |
| `airsense.gps` | `localStorage` | The saved GPS fix (coordinates and label). |
| `airsense.family.household` | `localStorage` | The family household form (counts, sensitivity, routines, outing duration, time preference). |
| `airsense.gowindow` | `localStorage` | GoWindow activity profile, duration, and time preference. |
| `airsense.geoAsked` | `localStorage` | Whether the location prompt was already shown or dismissed in this browser. |
| `airsense.theme` | `localStorage` | Light, dark, or system theme. |
| `airsense.sections` | `sessionStorage` | Which of GoWindow, the Family air plan, and Ask AirSense AI are open or collapsed in the current tab. |

A value that still lived only in `sessionStorage` from an older tab is copied into `localStorage` once when the dashboard reads it, then the tab copy is removed.

The assistant and GoWindow send coordinates, the question, and the profile. They do not send air or weather readings. The server fetches Open-Meteo itself and ignores client-supplied measurements. Coordinates are rounded to two decimal places, about 1 km, before the bounded cache key is formed. Forecast results, air-quality readings, family plans, and explanations are not stored in the browser.

API protections:

- Helmet security headers. Browser connections are limited to this origin and `https://api.bigdatacloud.net`.
- JSON bodies are limited to 30 KB.
- Production (`NODE_ENV=production`) allows same-origin requests and origins listed in `ALLOWED_ORIGINS`. Development allows local origins so the Vite server can call the API.
- Default per-IP limits are 60 air-quality requests per minute, 60 GoWindow requests per minute, 30 family-plan requests per minute, 30 geocoding requests per minute, and 20 assistant requests per minute. The air-quality, GoWindow, and family-plan limits are separate. `/api/health` is not rate-limited.
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
  |-- POST /api/family-plan     household plan, then an optional validated explanation
  |-- POST /api/assistant       deterministic decision and trace, then optional Gemini explanation
  |-- GET  /api/health
  v
Open-Meteo air quality and forecast
  v
server/logic.js  ->  recommendation
server/gowindow.js  ->  window status
server/family-plan.js  ->  household decision, schedule, walking, and cycling
server/family-guidance.js  ->  indoor, routine, and qualitative emissions guidance
server/gemini.js  ->  validated explanation plus claim IDs, or rules / rules-fallback
```

In production, Express serves the Vite build from `dist/` and the API on the same origin. The client calls relative `/api` routes, so the built frontend does not embed an API host. Development runs Vite at `http://localhost:5173` and proxies `/api` to `http://localhost:10000`.

## Demo walkthrough

1. Install and start the app with the commands in [Run locally](#run-locally). Leave `AI_API_KEY` empty for the deterministic path.
2. Open `http://localhost:5173`. Chennai loads without granting location on a first visit. If this browser has already allowed location, the current place appears with a GPS badge and no permission banner. The overview shows a modelled US AQI estimate, retrieval timing, and activity guidance. The hourly forecast and pollutant breakdown are always open. No planner card is selected, and Ask AirSense AI starts collapsed.
3. Under **Plan your day**, choose **Plan the day for you** and open GoWindow from its header or the navigation link. Only GoWindow is shown. Change activity, duration, or time preference, then choose a duration from 15 to 180 minutes and request windows. Compare a returned window with the current overview: the window does not rewrite the current recommendation.
4. Choose **Plan the day for your entire family** and open Family air plan. Only the Family air plan is shown. Reload and confirm no card is selected. The default household is one young child, children's outdoor play, 45 minutes, and daytime. Change a count or routine, then choose **Get the Latest Plan**. The decision, outing windows, and walking and cycling results appear. No explanation is shown yet.
5. Choose **Explain using AI**. With no API key, the deterministic explanation appears without an origin label. With a key, an accepted reply is labelled **AI-generated**. A reply that fails validation is replaced by the deterministic explanation and is not labelled as AI-generated. The household decision on screen stays the one the exposure engine returned.
6. Scroll down until **Back to top** appears at the bottom-right, then use it to return to the overview. Collapse a section you opened. Reload the tab and confirm that section choice is still there. Close the tab and open the app again: the saved place, household, and GoWindow activity settings should still be there. The forecast itself is fetched again.
7. Use **Clear saved place**, **Reset household**, or **Reset activity settings** when those controls appear. Reload and confirm Chennai, the default household, and the default GoWindow profile return.
8. Search another city and confirm the dashboard shows a SELECTED badge. Choose **Back to my location** when a GPS fix is saved. Deny location on a first visit and confirm the dashboard stays honest when data cannot be loaded.

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

Observed on `main` at `d15dbc6` (27 November 2026). This README describes the dashboard through that commit, including durable place, household, and GoWindow preferences and automatic loading when location permission is already granted.

- [x] Public GitHub repository
- [x] Exactly one branch (`main`)
- [x] Repository under 10 MB. GitHub reported 885 KB. `node_modules` and `dist` are uncommitted
- [x] `.env` and API keys excluded. `.env.example` has an empty `AI_API_KEY`
- [x] `npm test` passes. `npm run check` passed on this application tree (341 tests, typecheck, and production build)
- [x] `npm run build` passes, as part of that same `npm run check`
- [x] README included
- [ ] Demo screenshots included

No screenshot files are in this repository, so the screenshot item stays open.

## License

Hackathon demonstration project. Review upstream API terms and attribution requirements before public or commercial use.
