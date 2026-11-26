import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

process.env.NODE_ENV = "test";

const REAL_FETCH = globalThis.fetch;
let upstreamCalls = [];
let providerMode = "suitable";
let fixture = null;

function forecastFixture(mode = providerMode) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const hourStart = nowSeconds - (nowSeconds % 3600);
  const times = Array.from({ length: 8 }, (_, index) => hourStart + index * 3600);
  const unsuitable = mode === "unsuitable";
  const missing = mode === "insufficient";
  const aqi = times.map(() => missing ? null : unsuitable ? 185 : 30);
  const pm25 = times.map(() => missing ? null : unsuitable ? 80 : 8);
  return {
    air: {
      latitude: 13.099998,
      longitude: 80.30002,
      elevation: 10.0,
      generationtime_ms: 0.65,
      timezone: "Asia/Kolkata",
      utc_offset_seconds: 19800,
      current: { time: nowSeconds, us_aqi: aqi[0], pm2_5: pm25[0], pm10: 12 },
      hourly: { time: times, us_aqi: aqi, pm2_5: pm25, pm10: pm25.map((value) => value === null ? null : value + 4) },
    },
    weather: {
      timezone: "Asia/Kolkata",
      utc_offset_seconds: 19800,
      current: { temperature_2m: 31, wind_speed_10m: 12 },
      hourly: {
        time: times,
        temperature_2m: times.map(() => 31),
        relative_humidity_2m: times.map(() => 60),
        wind_speed_10m: times.map(() => 12),
      },
    },
  };
}

globalThis.fetch = async (url, options) => {
  const target = String(url);
  if (target.includes("127.0.0.1") || target.includes("localhost")) return REAL_FETCH(url, options);
  upstreamCalls.push(target);
  if (providerMode === "timeout") {
    const error = new Error("upstream timed out with secret provider diagnostics");
    error.name = "TimeoutError";
    throw error;
  }
  if (providerMode === "failure") {
    return { ok: false, status: 503, json: async () => ({ detail: "secret upstream failure" }) };
  }
  if (!fixture) fixture = forecastFixture();
  if (target.includes("air-quality-api.open-meteo.com")) return { ok: true, json: async () => fixture.air };
  if (target.includes("api.open-meteo.com/v1/forecast")) return { ok: true, json: async () => fixture.weather };
  return { ok: false, status: 404, json: async () => ({}) };
};

const { app, cache, rateLimiters } = await import("./index.js");

function request(appInstance, { method = "GET", url, body, headers = {}, rawBody = null }) {
  return new Promise((resolve, reject) => {
    const server = appInstance.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      REAL_FETCH(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
      })
        .then(async (response) => {
          const text = await response.text();
          server.close();
          resolve({ status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null });
        })
        .catch((error) => { server.close(); reject(error); });
    });
  });
}

function goWindowBody(overrides = {}) {
  return {
    latitude: 13.0827,
    longitude: 80.2707,
    activity: "running",
    profile: { ageGroup: "adult", sensitivity: "general" },
    durationMinutes: 60,
    ...overrides,
  };
}

test.beforeEach(() => {
  upstreamCalls = [];
  providerMode = "suitable";
  fixture = null;
  cache.clear();
  for (const limiter of Object.values(rateLimiters)) limiter.buckets.clear();
});

test.after(() => {
  globalThis.fetch = REAL_FETCH;
});

test("valid GoWindow request returns suitable windows from trusted forecast data", async () => {
  const response = await request(app, { method: "POST", url: "/api/gowindow", body: goWindowBody({ durationMinutes: 15 }) });
  assert.equal(response.status, 200);
  assert.equal(response.body.status, "suitable_windows");
  assert.equal(response.body.activity, "running");
  assert.equal(response.body.durationMinutes, 15);
  assert.equal(response.body.timezone, "Asia/Kolkata");
  assert.equal(response.body.forecastFreshness.state, "fresh");
  assert.doesNotMatch(response.body.forecastFreshness.label, /^Observed|FRESH MODEL DATA/i);
  assert.match(response.body.forecastFreshness.label, /model run age unavailable/i);
  assert.equal(response.body.metadata.providerCell.latitude, 13.099998);
  assert.equal(response.body.metadata.providerCell.longitude, 80.30002);
  assert.equal(response.body.metadata.timestamps.modelInitializedAt, null);
  assert.ok(response.body.metadata.timestamps.retrievedAt);
  assert.equal(response.body.metadata.spatialResolution.verified, true);
  assert.equal(response.body.metadata.spatialResolution.approximateKm, 45);
  assert.equal(response.body.timePreference, null);
  assert.ok(response.body.windows.length > 0);
  assert.equal(response.body.windows[0].exposureRecommendation, "suitable");
  assert.equal(response.body.windows[0].aqi.minimum, 30);
  assert.equal(response.body.windows[0].pm25.maximum, 8);
  assert.equal(response.body.windows[0].weather.windSpeedKmh.maximum, 12);
  assert.equal(response.body.windows[0].weather.temperatureC.maximum, 31);
  assert.match(response.body.windows[0].rankReason, /Ranked 1/);
  assert.match(response.body.limitations, /model estimates/i);
  assert.ok(upstreamCalls.some((url) => url.includes("air-quality-api.open-meteo.com")));
  assert.ok(upstreamCalls.some((url) => url.includes("hourly=temperature_2m")));
});

test("a cache hit preserves each source's own retrievedAt", async () => {
  const first = await request(app, { method: "POST", url: "/api/gowindow", body: goWindowBody({ durationMinutes: 15 }) });
  assert.equal(first.status, 200);
  assert.equal(first.body.sourceFreshness.air.basis, "retrievedAt");
  assert.equal(first.body.sourceFreshness.weather.basis, "retrievedAt");
  assert.equal(first.body.metadata.timestamps.retrievedAt, first.body.sourceFreshness.air.timestamp);
  assert.doesNotMatch(first.body.sourceFreshness.weather.label, /model run/i);

  const keys = [...cache.entries.keys()];
  const airKey = keys.find((key) => key.includes("air-quality-api"));
  const weatherKey = keys.find((key) => key.includes("/v1/forecast"));
  const airRetrievedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const weatherRetrievedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  cache.entries.get(airKey).value.retrievedAt = airRetrievedAt;
  cache.entries.get(weatherKey).value.retrievedAt = weatherRetrievedAt;
  upstreamCalls = [];
  const cached = await request(app, { method: "POST", url: "/api/gowindow", body: goWindowBody({ durationMinutes: 15 }) });
  assert.deepEqual(upstreamCalls, []);
  assert.equal(cached.body.status, "suitable_windows");
  assert.equal(cached.body.sourceFreshness.air.timestamp, airRetrievedAt);
  assert.equal(cached.body.sourceFreshness.weather.timestamp, weatherRetrievedAt);
  assert.notEqual(cached.body.sourceFreshness.air.timestamp, cached.body.sourceFreshness.weather.timestamp);
  assert.deepEqual(
    cached.body.windows.map((window) => [window.aqi, window.pm25, window.weather, window.rankReason]),
    first.body.windows.map((window) => [window.aqi, window.pm25, window.weather, window.rankReason]),
  );

  cache.entries.delete(weatherKey);
  upstreamCalls = [];
  const refreshedWeather = await request(app, { method: "POST", url: "/api/gowindow", body: goWindowBody({ durationMinutes: 15 }) });
  assert.equal(upstreamCalls.length, 1);
  assert.match(upstreamCalls[0], /\/v1\/forecast/);
  assert.equal(refreshedWeather.body.sourceFreshness.air.timestamp, airRetrievedAt);
  assert.notEqual(refreshedWeather.body.sourceFreshness.weather.timestamp, airRetrievedAt);
  assert.notEqual(refreshedWeather.body.sourceFreshness.weather.timestamp, weatherRetrievedAt);
});

test("no suitable forecast window remains distinct from insufficient data", async () => {
  providerMode = "unsuitable";
  const unsuitable = await request(app, { method: "POST", url: "/api/gowindow", body: goWindowBody() });
  assert.equal(unsuitable.status, 200);
  assert.equal(unsuitable.body.status, "no_suitable_window");
  assert.deepEqual(unsuitable.body.windows, []);
  assert.equal(unsuitable.body.assessment.unsuitableHours > 0, true);

  cache.clear();
  fixture = null;
  providerMode = "insufficient";
  const missing = await request(app, { method: "POST", url: "/api/gowindow", body: goWindowBody() });
  assert.equal(missing.status, 200);
  assert.equal(missing.body.status, "insufficient_data");
  assert.deepEqual(missing.body.windows, []);
  assert.equal(missing.body.assessment.suitableHours, 0);
  assert.match(missing.body.reason, /US AQI|forecast/i);
});

test("GoWindow rejects invalid coordinates, activity, profile, and duration", async () => {
  const cases = [
    [goWindowBody({ latitude: 999 }), /latitude and longitude/i],
    [goWindowBody({ longitude: "abc" }), /latitude and longitude/i],
    [goWindowBody({ latitude: [13.08] }), /latitude and longitude/i],
    [goWindowBody({ activity: "skateboarding" }), /activity/i],
    [goWindowBody({ profile: { ageGroup: "toddler", sensitivity: "general" } }), /age group/i],
    [goWindowBody({ profile: { ageGroup: "adult", sensitivity: "athlete" } }), /sensitivity/i],
    [goWindowBody({ profile: { activity: "cycling", ageGroup: "adult", sensitivity: "general" } }), /does not match/i],
    [goWindowBody({ profile: [] }), /profile/i],
    [goWindowBody({ durationMinutes: 14 }), /15 to 180/],
    [goWindowBody({ durationMinutes: 181 }), /15 to 180/],
    [goWindowBody({ durationMinutes: 60.5 }), /15 to 180/],
    [goWindowBody({ durationMinutes: "60" }), /15 to 180/],
    [goWindowBody({ timePreference: "night" }), /time preference/i],
    [goWindowBody({ timePreference: "Daytime" }), /time preference/i],
    [goWindowBody({ timePreference: "" }), /time preference/i],
  ];
  for (const [body, pattern] of cases) {
    const response = await request(app, { method: "POST", url: "/api/gowindow", body });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match(response.body.error, pattern);
    assert.equal(upstreamCalls.length, 0);
  }
  const malformed = await request(app, { method: "POST", url: "/api/gowindow", rawBody: "{not-json" });
  assert.equal(malformed.status, 400);
  assert.match(malformed.body.error, /invalid json/i);
});

test("client-supplied air-quality and forecast values are ignored", async () => {
  const response = await request(app, {
    method: "POST",
    url: "/api/gowindow",
    body: goWindowBody({
      aqi: 5,
      pollutants: { pm25: 1 },
      weather: { wind_speed_10m: 99, temperature_2m: 1 },
      hourly: [{ time: new Date().toISOString(), aqi: 5, pm25: 1 }],
      forecast: { hourly: [{ aqi: 5, pm25: 1 }] },
      decision: { activityRecommendation: "avoid" },
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.status, "suitable_windows");
  assert.equal(response.body.windows[0].aqi.minimum, 30);
  assert.equal(response.body.windows[0].pm25.maximum, 8);
  assert.equal(response.body.windows[0].weather.windSpeedKmh.maximum, 12);
  assert.equal(response.body.windows[0].exposureRecommendation, "suitable");
  assert.ok(upstreamCalls.every((url) => !url.includes("aqi=5") && !url.includes("pm25=1")));
  assert.ok(upstreamCalls.every((url) => !/generativelanguage|gemini/i.test(url)));
});

test("upstream timeout and provider failure return sanitized errors", async () => {
  providerMode = "timeout";
  const timeout = await request(app, { method: "POST", url: "/api/gowindow", body: goWindowBody() });
  assert.equal(timeout.status, 504);
  assert.equal(timeout.body.error, "Forecast data is temporarily unavailable.");
  assert.equal(JSON.stringify(timeout.body).includes("secret"), false);

  cache.clear();
  fixture = null;
  providerMode = "failure";
  const failure = await request(app, { method: "POST", url: "/api/gowindow", body: goWindowBody() });
  assert.equal(failure.status, 502);
  assert.equal(failure.body.error, "Forecast data is temporarily unavailable.");
  assert.equal(JSON.stringify(failure.body).includes("secret"), false);
  assert.equal(JSON.stringify(failure.body).includes("503"), false);
});

test("GoWindow is rate limited like the other environmental endpoints", async () => {
  let response;
  for (let count = 0; count <= rateLimiters.goWindow.max; count += 1) {
    response = await request(app, { method: "POST", url: "/api/gowindow", body: goWindowBody() });
  }
  assert.equal(response.status, 429);
  assert.match(response.body.error, /too many activity-window requests/i);
  assert.ok(response.headers.get("retry-after"));
  assert.equal(response.headers.get("ratelimit-limit"), String(rateLimiters.goWindow.max));
  assert.ok(response.headers.get("ratelimit-policy"));
});

test("repeated GoWindow requests reuse the bounded environmental cache", async () => {
  const first = await request(app, { method: "POST", url: "/api/gowindow", body: goWindowBody() });
  const callsAfterFirst = upstreamCalls.length;
  const second = await request(app, { method: "POST", url: "/api/gowindow", body: goWindowBody({ latitude: 13.084, longitude: 80.274 }) });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(callsAfterFirst, 2);
  assert.equal(upstreamCalls.length, callsAfterFirst);
  assert.equal(second.body.status, first.body.status);
  assert.deepEqual(
    second.body.windows.map((window) => [window.aqi, window.pm25, window.weather]),
    first.body.windows.map((window) => [window.aqi, window.pm25, window.weather]),
  );
  assert.ok(upstreamCalls.every((url) => url.includes("latitude=13.08") && url.includes("longitude=80.27")));
});

test("GoWindow route does not call Gemini", async () => {
  const source = await readFile(new URL("./index.js", import.meta.url), "utf8");
  const route = source.slice(source.indexOf('"/api/gowindow"'), source.indexOf('"/api/assistant"'));
  assert.match(route, /fetchTrustedForecast/);
  assert.match(route, /timePreference/);
  assert.doesNotMatch(route, /askGemini/);
});
