import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const sourceRoot = new URL("../src/", import.meta.url);

async function compile(relativePath, cache = new Map()) {
  if (cache.has(relativePath)) return cache.get(relativePath);
  const source = await readFile(new URL(relativePath, sourceRoot), "utf8");
  let { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const specs = [...new Set([...outputText.matchAll(/from\s+["'](\.\/[^"']+)["']/g)].map((match) => match[1]))];
  for (const spec of specs) {
    const dep = `${spec.replace(/^\.\//, "").replace(/\.js$/, "")}.ts`;
    const url = await compile(dep, cache);
    outputText = outputText.replaceAll(`"${spec}"`, `"${url}"`).replaceAll(`'${spec}'`, `'${url}'`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
  cache.set(relativePath, url);
  return url;
}

async function loadGoWindow() {
  return import(await compile("gowindow.ts"));
}

const location = { lat: 13.0827, lon: 80.2707 };
const profile = { activity: "running", ageGroup: "adult", sensitivity: "general" };

function windowResult(overrides = {}) {
  return {
    start: "2026-11-25T02:30:00.000Z",
    end: "2026-11-25T03:15:00.000Z",
    timezone: "Asia/Kolkata",
    activity: "running",
    durationMinutes: 45,
    exposureRecommendation: "suitable",
    recommendationLabel: "Suitable based on available forecast data",
    aqi: { minimum: 30, maximum: 42, minimumCategory: "Good", maximumCategory: "Good", scale: "US AQI" },
    pm25: { minimum: 8, maximum: 11, minimumLabel: "Low", maximumLabel: "Low", unit: "µg/m³" },
    weather: {
      temperatureC: { minimum: 29, maximum: 31 },
      windSpeedKmh: { minimum: 12, maximum: 14 },
      relativeHumidityPercent: { minimum: 60, maximum: 64 },
    },
    rankReason: "Ranked 1 for this activity.",
    dataFreshness: { state: "fresh", ageMs: 60000, label: "Observed 1 min ago." },
    limitations: "Forecast recommendations are model estimates, not measurements.",
    estimate: true,
    ...overrides,
  };
}

test("GoWindow requests contain only the selected location, profile, and duration", async () => {
  const { buildGoWindowRequest, DEFAULT_GO_WINDOW_DURATION, DEFAULT_TIME_PREFERENCE, GO_WINDOW_DURATIONS } = await loadGoWindow();
  assert.equal(DEFAULT_TIME_PREFERENCE, "daytime");
  const request = buildGoWindowRequest(location, profile, DEFAULT_GO_WINDOW_DURATION);
  assert.deepEqual(Object.keys(request).sort(), ["activity", "durationMinutes", "latitude", "longitude", "profile", "timePreference"]);
  assert.deepEqual(request, {
    latitude: 13.0827,
    longitude: 80.2707,
    activity: "running",
    profile: { activity: "running", ageGroup: "adult", sensitivity: "general" },
    durationMinutes: 45,
    timePreference: "daytime",
  });
  assert.equal(DEFAULT_GO_WINDOW_DURATION, 45);
  assert.deepEqual(GO_WINDOW_DURATIONS, [15, 30, 45, 60, 90, 120]);
  const changed = buildGoWindowRequest({ lat: 40.71, lon: -74.01 }, { ...profile, activity: "cycling", sensitivity: "respiratory sensitivity" }, 120);
  assert.equal(changed.latitude, 40.71);
  assert.equal(changed.activity, "cycling");
  assert.equal(changed.profile.sensitivity, "respiratory sensitivity");
  assert.equal(changed.durationMinutes, 120);
});

test("suitable windows render ranked forecast context without fabricated fields", async () => {
  const { presentGoWindow, formatWindowClock } = await loadGoWindow();
  const second = windowResult({
    start: "2026-11-25T05:00:00.000Z",
    end: "2026-11-25T05:45:00.000Z",
    rankReason: "Ranked 2 for this activity.",
  });
  const view = presentGoWindow({
    status: "suitable_windows",
    activity: "running",
    durationMinutes: 45,
    timezone: "Asia/Kolkata",
    evaluatedAt: "2026-11-25T02:30:00.000Z",
    forecastFreshness: { state: "fresh", ageMs: 60000, label: "Observed 1 min ago." },
    windows: [windowResult(), second, windowResult(), windowResult()],
    reason: "Up to three windows.",
    limitations: "Forecast recommendations are model estimates, not measurements.",
    estimate: true,
  });
  assert.equal(view.state, "suitable_windows");
  assert.equal(view.windows.length, 3);
  assert.equal(view.windows[0].best, true);
  assert.equal(view.windows[0].time, `${formatWindowClock("2026-11-25T02:30:00.000Z", "Asia/Kolkata")} – ${formatWindowClock("2026-11-25T03:15:00.000Z", "Asia/Kolkata")}`);
  assert.equal(view.windows[0].aqi, "US AQI 30–42 · Good");
  assert.equal(view.windows[0].pm25, "PM2.5 8–11 µg/m³ · Low");
  assert.match(view.windows[0].weather, /29–31°C/);
  assert.match(view.windows[0].weather, /Wind 12–14 km\/h/);
  assert.equal(view.windows[0].recommendationLabel, "Suitable based on available forecast data.");
  assert.match(view.windows[0].freshness, /Observed 1 min ago/);
  assert.equal(view.windows[2].best, false);
  assert.equal(view.windows[0].alternative, false);
});

test("GoWindow card timing ages from retrievedAt at display time, not from valid time", async () => {
  const { presentGoWindow } = await loadGoWindow();
  const result = {
    status: "suitable_windows",
    activity: "running",
    durationMinutes: 45,
    timezone: "Asia/Kolkata",
    evaluatedAt: "2026-11-25T02:30:00.000Z",
    forecastFreshness: { state: "fresh", ageMs: 0, label: "server label" },
    metadata: { timestamps: { forecastValidAt: "2026-11-25T01:00:00.000Z", retrievedAt: "2026-11-25T02:29:00.000Z", modelInitializedAt: null } },
    windows: [windowResult()],
    reason: "One window.",
    limitations: "Forecast recommendations are model estimates.",
    estimate: true,
  };
  const soon = presentGoWindow(result, Date.parse("2026-11-25T02:30:00.000Z"));
  assert.match(soon.windows[0].freshness, /Forecast valid for/);
  assert.match(soon.windows[0].freshness, /\(1 min ago\)/);
  assert.match(soon.windows[0].freshness, /Model run age unavailable/);
  const later = presentGoWindow(result, Date.parse("2026-11-25T03:29:00.000Z"));
  assert.match(later.windows[0].freshness, /\(1h ago\)/);
  assert.doesNotMatch(later.windows[0].freshness, /OUTDATED|server label/);
});

test("each source's retrieval age is shown separately and an old source stays visible", async () => {
  const { presentGoWindow } = await loadGoWindow();
  const now = Date.parse("2026-11-25T02:30:00.000Z");
  const policy = {
    basis: "retrievedAt",
    freshWithinMs: 30 * 60 * 1000,
    staleAfterMs: 3 * 60 * 60 * 1000,
    clockSkewToleranceMs: 5 * 60 * 1000,
    note: "The 30-minute and 3-hour retrieval limits are AirSense policy thresholds, not provider guarantees.",
  };
  const staleWeather = presentGoWindow({
    status: "insufficient_data",
    activity: "running",
    durationMinutes: 45,
    timezone: "Asia/Kolkata",
    evaluatedAt: "2026-11-25T02:30:00.000Z",
    forecastFreshness: { state: "stale", ageMs: null, label: "combined" },
    sourceFreshness: {
      air: { source: "air", state: "fresh", ageMs: 60000, timestamp: "2026-11-25T02:29:00.000Z", label: "Air-quality data retrieved 1 min ago.", basis: "retrievedAt", modelRunAgeMs: null },
      weather: { source: "weather", state: "stale", ageMs: 4 * 3600000, timestamp: "2026-11-24T22:30:00.000Z", label: "Weather data retrieved 4h ago.", basis: "retrievedAt", modelRunAgeMs: null },
    },
    freshnessPolicy: policy,
    windows: [],
    reason: "Retrieved weather data is too old for a reliable scheduling decision.",
    limitations: "Forecast recommendations are model estimates.",
    estimate: true,
  }, now);
  assert.equal(staleWeather.state, "insufficient_data");
  assert.deepEqual(staleWeather.retrievalLines, [
    { source: "air", tone: "fresh", text: "Air quality: Retrieved 1 min ago · recent" },
    { source: "weather", tone: "stale", text: "Weather: Retrieved 4h ago · old" },
  ]);
  assert.match(staleWeather.policyNote, /not provider guarantees/);
  assert.doesNotMatch(staleWeather.retrievalLines.map((line) => line.text).join(" "), /model/i);

  const missingWeather = presentGoWindow({
    status: "insufficient_data",
    activity: "running",
    durationMinutes: 45,
    timezone: "UTC",
    evaluatedAt: "2026-11-25T02:30:00.000Z",
    forecastFreshness: { state: "unknown", ageMs: null, label: "combined" },
    sourceFreshness: {
      air: { source: "air", state: "fresh", ageMs: 0, timestamp: "2026-11-25T02:30:00.000Z", label: "recent", basis: "retrievedAt", modelRunAgeMs: null },
      weather: { source: "weather", state: "unknown", ageMs: null, timestamp: null, label: "Weather data retrieval time unavailable.", basis: "retrievedAt", modelRunAgeMs: null },
    },
    freshnessPolicy: policy,
    windows: [],
    reason: "The weather retrieval time is missing, invalid, or in the future.",
    limitations: "Forecast recommendations are model estimates.",
    estimate: true,
  }, now);
  assert.deepEqual(missingWeather.retrievalLines[1], { source: "weather", tone: "unknown", text: "Weather: Retrieval time unavailable · unavailable" });
});

test("a 2 AM alternative is not presented as the best daytime window", async () => {
  const { presentGoWindow, formatWindowClock } = await loadGoWindow();
  const overnight = "2026-11-25T20:30:00.000Z";
  const view = presentGoWindow({
    status: "outside_preference",
    activity: "daily activities",
    durationMinutes: 45,
    timezone: "Asia/Kolkata",
    timePreference: "daytime",
    preference: { id: "daytime", label: "Daytime", rangeLabel: "5 AM–10 PM", timezone: "Asia/Kolkata", outcome: "outside" },
    evaluatedAt: overnight,
    forecastFreshness: { state: "fresh", ageMs: 0, label: "Observed 0 min ago." },
    windows: [windowResult({
      start: overnight,
      end: "2026-11-25T21:15:00.000Z",
      placement: "alternative",
      rankReason: "Alternative 1 outside Daytime (5 AM–10 PM).",
    })],
    reason: "No suitable window was found within Daytime (5 AM–10 PM in Asia/Kolkata).",
    limitations: "Alternative windows are outside the selected time preference.",
    estimate: true,
  });
  assert.equal(view.state, "outside_preference");
  assert.equal(view.alternatives[0].best, false);
  assert.equal(view.alternatives[0].alternative, true);
  assert.match(view.message, /No suitable window was found within Daytime \(5 AM–10 PM\)/);
  assert.equal(view.alternatives[0].time.startsWith(formatWindowClock(overnight, "Asia/Kolkata")), true);
  assert.notEqual(formatWindowClock(overnight, "Asia/Kolkata"), formatWindowClock(overnight, "UTC"));
  assert.equal(view.windows, undefined);
});

test("missing PM2.5 and weather stay unavailable", async () => {
  const { presentGoWindow } = await loadGoWindow();
  const view = presentGoWindow({
    status: "suitable_windows",
    activity: "daily activities",
    durationMinutes: 30,
    timezone: "UTC",
    evaluatedAt: "2026-11-25T02:30:00.000Z",
    forecastFreshness: { state: "fresh", ageMs: 0, label: "Observed 0 min ago." },
    windows: [windowResult({ pm25: null, weather: null, activity: "daily activities", durationMinutes: 30 })],
    reason: "One window.",
    limitations: "PM2.5 was unavailable and was not interpreted as clean air.",
    estimate: true,
  });
  assert.equal(view.windows[0].pm25, "PM2.5 unavailable");
  assert.equal(view.windows[0].weather, "Weather unavailable");
  assert.doesNotMatch(JSON.stringify(view), /PM2\.5 0|Wind 0|clean air was assumed/);
});

test("no suitable window and insufficient data do not invent alternatives", async () => {
  const { presentGoWindow } = await loadGoWindow();
  const none = presentGoWindow({
    status: "no_suitable_window",
    activity: "running",
    durationMinutes: 45,
    timezone: "Asia/Kolkata",
    evaluatedAt: "2026-11-25T02:30:00.000Z",
    forecastFreshness: { state: "fresh", ageMs: 0, label: "Observed 0 min ago." },
    windows: [],
    reason: "The available forecast does not contain a suitable interval for this activity and profile.",
    limitations: "Forecast recommendations are model estimates.",
    estimate: true,
  });
  assert.equal(none.state, "no_suitable_window");
  assert.match(none.message, /No suitable interval was identified/);
  assert.match(none.guidance, /does not change that guidance/);
  assert.equal(none.windows, undefined);

  const missing = presentGoWindow({
    status: "insufficient_data",
    activity: "running",
    durationMinutes: 45,
    timezone: "Asia/Kolkata",
    evaluatedAt: null,
    forecastFreshness: { state: "unknown", ageMs: null, label: "Forecast issue time unknown." },
    windows: [],
    reason: "The forecast does not contain enough valid US AQI data to schedule an activity.",
    limitations: "Unavailable pollutant data was not treated as clean air.",
    estimate: true,
  });
  assert.equal(missing.state, "insufficient_data");
  assert.match(missing.message, /forecast information is unavailable/);
  assert.match(missing.detail, /US AQI/);
  assert.match(missing.guidance, /No alternative times are suggested/);
  assert.equal(missing.windows, undefined);
});

test("request keys protect stale schedules when location, activity, or duration changes", async () => {
  const { goWindowRequestKey } = await loadGoWindow();
  const original = goWindowRequestKey(location, profile, 45);
  assert.notEqual(goWindowRequestKey({ ...location, lat: 51.5 }, profile, 45), original);
  assert.notEqual(goWindowRequestKey(location, { ...profile, activity: "cycling" }, 45), original);
  assert.notEqual(goWindowRequestKey(location, profile, 90), original);
  assert.notEqual(goWindowRequestKey(location, profile, 45, "evening"), original);
  assert.equal(goWindowRequestKey(location, profile, 45), goWindowRequestKey(location, profile, 45, "daytime"));
});

test("frontend and backend time-preference registries stay in parity", async () => {
  const { GO_WINDOW_TIME_PREFERENCES } = await loadGoWindow();
  const { TIME_PREFERENCES } = await import("./gowindow.js");
  assert.deepEqual(
    GO_WINDOW_TIME_PREFERENCES.map((item) => item.id).sort(),
    Object.keys(TIME_PREFERENCES).sort(),
  );
  for (const item of GO_WINDOW_TIME_PREFERENCES) {
    const server = TIME_PREFERENCES[item.id];
    assert.equal(item.startMinute, server.startMinute, item.id);
    assert.equal(item.endMinute, server.endMinute, item.id);
    assert.equal(item.rangeLabel, server.rangeLabel, item.id);
  }
});

test("dashboard wiring prevents duplicate submissions and stale GoWindow responses", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../src/api.ts", import.meta.url), "utf8");
  const panel = await readFile(new URL("../src/GoWindowPanel.tsx", import.meta.url), "utf8");
  const helper = await readFile(new URL("../src/gowindow.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/design-system.css", import.meta.url), "utf8");
  assert.match(app, /if \(scheduleLoading \|\| goWindowPendingRef\.current\) return/);
  assert.match(app, /goWindowPendingRef\.current = true/);
  assert.match(app, /goWindowAbortRef\.current\?\.abort\(\)/);
  assert.match(app, /isLatestRequest\(requestId, goWindowRequestRef\.current\)/);
  assert.match(app, /result=\{scheduleKey === scheduleRequestKey \? schedule : null\}/);
  assert.match(app, /disabled=\{scheduleLoading && scheduleKey === ""\}|disabled=\{loading\}/);
  assert.match(panel, /disabled=\{loading\}/);
  assert.match(panel, /Finding your best time/);
  assert.match(panel, /Find my best time/);
  assert.match(panel, /Preferred time of day/);
  assert.match(helper, /Daytime \(5 AM–10 PM\)/);
  assert.match(helper, /DEFAULT_TIME_PREFERENCE: GoWindowTimePreference = "daytime"|DEFAULT_TIME_PREFERENCE = "daytime"/);
  assert.match(panel, /Alternative window/);
  assert.match(app, /DEFAULT_TIME_PREFERENCE/);
  assert.match(panel, /Activity window unavailable/);
  assert.match(panel, /role="alert"/);
  assert.match(panel, /aria-live="polite"/);
  assert.match(helper, /Suitable based on available forecast data\./);
  assert.match(panel, /window\.recommendationLabel/);
  assert.match(panel, /aria-label="Retrieval times"/);
  assert.match(panel, /gowindow-retrieval/);
  assert.match(app, /setSchedule\(null\)/);
  assert.match(app, /setScheduleError/);
  assert.match(api, /JSON\.stringify\(request\)/);
  assert.doesNotMatch(api.slice(api.indexOf("findGoWindow"), api.indexOf("searchLocations")), /aqi|pm25|weather|forecast/i);
  assert.match(css, /\.gowindow-card\.best/);
  assert.match(css, /\.gowindow-panel \.gowindow-controls/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.primary-btn \{ min-height: 44px; \}/);
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.doesNotMatch(css.slice(css.indexOf(".gowindow-section"), css.indexOf(".assistant-section")), /backdrop-filter|#[0-9a-f]{3,8}/i);
});
