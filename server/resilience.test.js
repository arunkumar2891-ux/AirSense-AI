import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { BoundedTTLCache } from "./cache.js";
import { buildExposureDecision } from "./logic.js";
import { findGoWindows } from "./gowindow.js";

process.env.NODE_ENV = "test";

const REAL_FETCH = globalThis.fetch;
let upstreamCalls = [];
let weatherMode = "ok";
let airMode = "ok";
let weatherBody = null;
let forecastBody = null;

function timeoutError() {
  const error = new Error("upstream timed out");
  error.name = "TimeoutError";
  return error;
}

function airPayload() {
  const observed = Math.floor(Date.parse("2026-11-25T15:00:00Z") / 1000);
  return {
    latitude: 17.400002,
    longitude: 78.50001,
    elevation: 505,
    timezone: "Asia/Kolkata",
    utc_offset_seconds: 19800,
    current: {
      time: observed,
      us_aqi: 80,
      pm2_5: 20,
      pm10: 40,
      ozone: 30,
      nitrogen_dioxide: 10,
      carbon_monoxide: 200,
      sulphur_dioxide: 4,
    },
    hourly: { time: [observed], us_aqi: [80], pm2_5: [20], pm10: [40] },
  };
}

function weatherPayload(wind = 12) {
  return { current: { temperature_2m: 28, wind_speed_10m: wind } };
}

globalThis.fetch = async (url, options) => {
  const target = String(url);
  if (target.includes("127.0.0.1") || target.includes("localhost")) return REAL_FETCH(url, options);
  upstreamCalls.push(target);
  if (target.includes("air-quality-api.open-meteo.com")) {
    if (airMode === "timeout") throw timeoutError();
    if (airMode === "http") return { ok: false, status: 500, json: async () => ({ detail: "secret air failure" }) };
    return { ok: true, json: async () => airPayload() };
  }
  if (target.includes("api.open-meteo.com/v1/forecast")) {
    if (weatherMode === "timeout") throw timeoutError();
    if (weatherMode === "http") return { ok: false, status: 500, json: async () => ({ detail: "secret weather failure" }) };
    if (weatherMode === "malformed") return { ok: true, json: async () => ({ error: "not a forecast" }) };
    if (weatherMode === "null") return { ok: true, json: async () => null };
    if (target.includes("hourly=") && forecastBody) return { ok: true, json: async () => forecastBody };
    if (weatherBody) return { ok: true, json: async () => weatherBody };
    return { ok: true, json: async () => weatherPayload() };
  }
  if (target.includes("geocoding-api.open-meteo.com")) {
    return { ok: true, json: async () => ({ results: [{ name: "Hyderabad", latitude: 17.38, longitude: 78.48, admin1: "Telangana", country: "India" }] }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const {
  app,
  cache,
  geocodeCache,
  CACHE_MAX_ENTRIES,
  GEOCODE_CACHE_MAX_ENTRIES,
  ENVIRONMENT_CACHE_TTL_MS,
  GEOCODE_CACHE_TTL_MS,
  fetchTrustedEnvironmentalData,
  fetchTrustedForecast,
} = await import("./index.js");

const profile = { activity: "daily activities", ageGroup: "adult", sensitivity: "general" };
const latitude = 64.1466;
const longitude = -21.9426;

function request(appInstance, { method = "GET", url, body }) {
  return new Promise((resolve, reject) => {
    const server = appInstance.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      REAL_FETCH(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      })
        .then(async (response) => {
          const text = await response.text();
          server.close();
          resolve({ status: response.status, body: text ? JSON.parse(text) : null });
        })
        .catch((error) => { server.close(); reject(error); });
    });
  });
}

function windContribution(decision) {
  const factor = decision.trace.factors.find((item) => item.factor === "Wind");
  return factor ? factor.contribution : decision.wind.points;
}

describe("cache isolation and weather outages", { concurrency: 1 }, () => {
test.beforeEach(() => {
  upstreamCalls = [];
  weatherMode = "ok";
  airMode = "ok";
  weatherBody = null;
  forecastBody = null;
  for (const key of [...cache.entries.keys()]) {
    if (key.includes("latitude=64.15") || key.includes("latitude=64.14")) cache.entries.delete(key);
  }
});

test.after(() => {
  globalThis.fetch = REAL_FETCH;
});

test("geocoding and environmental caches evict independently", async () => {
  assert.notEqual(cache, geocodeCache);
  assert.equal(cache.maxEntries, CACHE_MAX_ENTRIES);
  assert.equal(geocodeCache.maxEntries, GEOCODE_CACHE_MAX_ENTRIES);
  assert.ok(ENVIRONMENT_CACHE_TTL_MS < GEOCODE_CACHE_TTL_MS);

  const environmentalCache = new BoundedTTLCache({ maxEntries: 2 });
  const placeCache = new BoundedTTLCache({ maxEntries: 2 });
  const environmental = { data: { marker: "env" }, retrievedAt: "2026-11-25T00:00:00.000Z" };
  const geocoded = { data: { marker: "geo" }, retrievedAt: "2026-11-25T00:00:00.000Z" };
  environmentalCache.set("env-keep", environmental, ENVIRONMENT_CACHE_TTL_MS);
  for (let i = 0; i < placeCache.maxEntries + 5; i += 1) {
    placeCache.set(`geo-${i}`, { data: { i }, retrievedAt: geocoded.retrievedAt }, GEOCODE_CACHE_TTL_MS);
  }
  assert.equal(placeCache.size, placeCache.maxEntries);
  assert.equal(environmentalCache.get("env-keep").data.marker, "env");
  assert.equal(environmentalCache.get("env-keep").retrievedAt, environmental.retrievedAt);

  placeCache.set("geo-keep", geocoded, GEOCODE_CACHE_TTL_MS);
  for (let i = 0; i < environmentalCache.maxEntries + 5; i += 1) {
    environmentalCache.set(`env-${i}`, { data: { i }, retrievedAt: environmental.retrievedAt }, ENVIRONMENT_CACHE_TTL_MS);
  }
  assert.equal(environmentalCache.size, environmentalCache.maxEntries);
  assert.equal(environmentalCache.get("env-keep"), undefined);
  assert.equal(placeCache.get("geo-keep").data.marker, "geo");
  assert.equal(placeCache.get("geo-keep").retrievedAt, geocoded.retrievedAt);

  environmentalCache.set("env-ttl", environmental, 1);
  placeCache.set("geo-ttl", geocoded, GEOCODE_CACHE_TTL_MS);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(environmentalCache.get("env-ttl"), undefined);
  assert.equal(placeCache.get("geo-ttl").data.marker, "geo");

  environmentalCache.set("env-long", environmental, ENVIRONMENT_CACHE_TTL_MS);
  placeCache.set("geo-short", geocoded, 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(placeCache.get("geo-short"), undefined);
  assert.equal(environmentalCache.get("env-long").data.marker, "env");

  const addedEnvironmental = ["env-keep-live"];
  const addedGeocode = [];
  try {
    cache.set("env-keep-live", environmental, ENVIRONMENT_CACHE_TTL_MS);
    for (let i = 0; i < GEOCODE_CACHE_MAX_ENTRIES + 5; i += 1) {
      const key = `geo-live-${i}`;
      geocodeCache.set(key, { data: { i }, retrievedAt: geocoded.retrievedAt }, GEOCODE_CACHE_TTL_MS);
      addedGeocode.push(key);
    }
    assert.equal(geocodeCache.size, GEOCODE_CACHE_MAX_ENTRIES);
    assert.equal(cache.get("env-keep-live").retrievedAt, environmental.retrievedAt);

    geocodeCache.set("geo-keep-live", geocoded, GEOCODE_CACHE_TTL_MS);
    addedGeocode.push("geo-keep-live");
    for (let i = 0; i < CACHE_MAX_ENTRIES + 5; i += 1) {
      const key = `env-live-${i}`;
      cache.set(key, { data: { i }, retrievedAt: environmental.retrievedAt }, ENVIRONMENT_CACHE_TTL_MS);
      addedEnvironmental.push(key);
    }
    assert.equal(cache.size, CACHE_MAX_ENTRIES);
    assert.equal(cache.get("env-keep-live"), undefined);
    assert.equal(geocodeCache.get("geo-keep-live").retrievedAt, geocoded.retrievedAt);
  } finally {
    for (const key of addedEnvironmental) cache.entries.delete(key);
    for (const key of addedGeocode) geocodeCache.entries.delete(key);
  }
});

test("each cache keeps its own single-flight loader", async () => {
  const environmentalCache = new BoundedTTLCache({ maxEntries: CACHE_MAX_ENTRIES });
  const placeCache = new BoundedTTLCache({ maxEntries: GEOCODE_CACHE_MAX_ENTRIES });
  let environmentalLoads = 0;
  let geocodeLoads = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = environmentalCache.getOrLoad("shared-air", ENVIRONMENT_CACHE_TTL_MS, async () => {
    environmentalLoads += 1;
    await gate;
    return { data: { source: "air" }, retrievedAt: "2026-11-25T00:00:00.000Z" };
  });
  const second = environmentalCache.getOrLoad("shared-air", ENVIRONMENT_CACHE_TTL_MS, async () => {
    environmentalLoads += 1;
    return { data: { source: "duplicate" }, retrievedAt: "2026-11-25T00:00:00.000Z" };
  });
  const geocode = placeCache.getOrLoad("shared-place", GEOCODE_CACHE_TTL_MS, async () => {
    geocodeLoads += 1;
    return { data: { source: "place" }, retrievedAt: "2026-11-25T00:00:00.000Z" };
  });
  await Promise.resolve();
  assert.equal(environmentalLoads, 1);
  assert.equal(geocodeLoads, 1);
  release();
  const [left, right, place] = await Promise.all([first, second, geocode]);
  assert.equal(left.data.source, "air");
  assert.equal(right.data.source, "air");
  assert.equal(place.data.source, "place");
  assert.equal(environmentalLoads, 1);
  assert.equal(environmentalCache.inflight.size, 0);
  assert.equal(placeCache.inflight.size, 0);
});

test("concurrent air-quality reads share one fetch per source", async () => {
  const path = `/api/air-quality?lat=${latitude}&lon=${longitude}`;
  const [left, right] = await Promise.all([
    request(app, { url: path }),
    request(app, { url: path }),
  ]);
  assert.equal(left.status, 200);
  assert.equal(right.status, 200);
  assert.equal(left.body.aqi, 80);
  assert.equal(right.body.aqi, 80);
  assert.equal(left.body.weather.wind_speed_10m, 12);
  const airCalls = upstreamCalls.filter((url) => url.includes("air-quality-api.open-meteo.com") && url.includes("latitude=64.15"));
  const weatherCalls = upstreamCalls.filter((url) => url.includes("api.open-meteo.com/v1/forecast") && url.includes("latitude=64.15"));
  assert.equal(airCalls.length, 1);
  assert.equal(weatherCalls.length, 1);
  assert.equal(left.body.retrievedAt, right.body.retrievedAt);
  assert.equal(left.body.weatherRetrievedAt, right.body.weatherRetrievedAt);
});

async function readAir() {
  return request(app, { url: `/api/air-quality?lat=${latitude}&lon=${longitude}` });
}

test("air quality succeeds when weather returns HTTP 500, times out, or is malformed", async () => {
  for (const mode of ["http", "timeout", "malformed", "null"]) {
    weatherMode = mode;
    airMode = "ok";
    upstreamCalls = [];
    const response = await readAir();
    assert.equal(response.status, 200, mode);
    assert.equal(response.body.aqi, 80, mode);
    assert.deepEqual(response.body.weather, {}, mode);
    assert.equal(response.body.weatherRetrievedAt, null, mode);
    assert.notEqual(response.body.retrievedAt, null, mode);
    assert.equal(response.body.weatherRetrievedAt, null, mode);
    assert.equal("detail" in response.body, false, mode);
    const decision = buildExposureDecision(response.body, profile, Date.now());
    assert.equal(decision.wind.points, 0, mode);
    assert.equal(decision.wind.state, "excluded_missing_wind", mode);
    assert.match(decision.wind.disclosure, /unavailable/i, mode);
    assert.match(decision.wind.disclosure, /not used/i, mode);
    assert.match(decision.trace.wind.disclosure, /unavailable/i, mode);
    assert.equal(decision.trace.wind.points, 0, mode);
    assert.equal(decision.trace.wind.state, "excluded_missing_wind", mode);
    assert.equal(decision.trace.weather.windSpeedKmh, null, mode);
    assert.ok(decision.trace.unavailable.some((line) => /unavailable/i.test(line) && /not used/i.test(line)), mode);
    assert.equal(windContribution(decision), 0, mode);
  }
});

test("missing weather does not improve the exposure score and stale air still stops the decision", async () => {
  weatherMode = "http";
  const response = await readAir();
  assert.equal(response.status, 200);
  const now = Date.now();
  const missing = buildExposureDecision(response.body, profile, now);
  const noAdjustment = buildExposureDecision({
    ...response.body,
    weather: { wind_speed_10m: 12 },
    weatherRetrievedAt: response.body.retrievedAt,
  }, profile, now);
  assert.equal(missing.wind.points, 0);
  assert.equal(noAdjustment.wind.points, 0);
  assert.equal(missing.activityRecommendation, noAdjustment.activityRecommendation);
  assert.equal(missing.overallRisk, noAdjustment.overallRisk);
  assert.doesNotMatch(missing.reasoning, /increased the exposure score/);
  assert.equal(missing.trace.scoringApplied, true);

  const stale = buildExposureDecision({
    ...response.body,
    retrievedAt: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
  }, profile, now);
  assert.equal(stale.activityRecommendation, "insufficient_data");
  assert.equal(stale.trace.scoringApplied, false);
  assert.equal(stale.wind.points, 0);
});

test("an expired weather cache entry is not reused when weather is down", async () => {
  weatherMode = "ok";
  const first = await readAir();
  assert.equal(first.status, 200);
  assert.equal(first.body.weather.wind_speed_10m, 12);
  const weatherKey = [...cache.entries.keys()].find((key) => key.includes("latitude=64.15") && key.includes("api.open-meteo.com/v1/forecast") && !key.includes("hourly="));
  assert.ok(weatherKey);
  cache.entries.get(weatherKey).expiresAt = Date.now() - 1;
  weatherMode = "http";
  upstreamCalls = [];
  const second = await readAir();
  assert.equal(second.status, 200);
  assert.deepEqual(second.body.weather, {});
  assert.equal(second.body.weatherRetrievedAt, null);
  assert.equal(second.body.aqi, first.body.aqi);
  assert.equal(second.body.retrievedAt, first.body.retrievedAt);
  assert.equal(upstreamCalls.some((url) => url.includes("api.open-meteo.com/v1/forecast")), true);
  assert.equal(upstreamCalls.some((url) => url.includes("air-quality-api.open-meteo.com")), false);
});

test("a failed or malformed weather response is not cached as an empty success", async () => {
  for (const mode of ["http", "malformed"]) {
    weatherMode = mode;
    for (const key of [...cache.entries.keys()]) {
      if (key.includes("latitude=64.15")) cache.entries.delete(key);
    }
    const failed = await readAir();
    assert.equal(failed.body.weatherRetrievedAt, null, mode);
    weatherMode = "ok";
    upstreamCalls = [];
    const recovered = await readAir();
    assert.equal(recovered.status, 200, mode);
    assert.equal(recovered.body.weather.wind_speed_10m, 12, mode);
    assert.ok(recovered.body.weatherRetrievedAt, mode);
    assert.equal(upstreamCalls.some((url) => url.includes("api.open-meteo.com/v1/forecast")), true, mode);
  }
});

test("air-quality failure stays a safe error when weather succeeds", async () => {
  weatherMode = "ok";
  airMode = "http";
  const failed = await readAir();
  assert.equal(failed.status, 502);
  assert.match(failed.body.error, /temporarily unavailable/i);
  assert.equal(failed.body.aqi, undefined);
  assert.equal(failed.body.activityRecommendation, undefined);
  assert.equal(JSON.stringify(failed.body).includes("secret"), false);

  for (const key of [...cache.entries.keys()]) {
    if (key.includes("latitude=64.15")) cache.entries.delete(key);
  }
  airMode = "timeout";
  const timedOut = await readAir();
  assert.equal(timedOut.status, 504);
  assert.equal(timedOut.body.aqi, undefined);
  for (const key of [...cache.entries.keys()]) {
    if (key.includes("latitude=64.15")) cache.entries.delete(key);
  }
});

test("both sources succeed and keep separate retrieval timestamps", async () => {
  const response = await readAir();
  assert.equal(response.status, 200);
  assert.equal(response.body.aqi, 80);
  assert.equal(response.body.weather.wind_speed_10m, 12);
  assert.equal(response.body.weather.temperature_2m, 28);
  assert.ok(response.body.retrievedAt);
  assert.ok(response.body.weatherRetrievedAt);
  const direct = await fetchTrustedEnvironmentalData(latitude, longitude);
  assert.equal(direct.retrievedAt, response.body.retrievedAt);
  assert.equal(direct.weatherRetrievedAt, response.body.weatherRetrievedAt);
  assert.equal(cache.size, 2);
  assert.equal(upstreamCalls.filter((url) => url.includes("air-quality-api")).length, 1);
});

function clearPlaceCache() {
  for (const key of [...cache.entries.keys()]) {
    if (key.includes("latitude=64.15") || key.includes("latitude=64.14")) cache.entries.delete(key);
  }
}

test("invalid current weather is not cached and a later valid observation is", async () => {
  const invalid = [
    { name: "empty current", body: { current: {} } },
    { name: "missing wind", body: { current: { temperature_2m: 28, relative_humidity_2m: 55 } } },
    { name: "string wind", body: { current: { wind_speed_10m: "12", temperature_2m: 28 } } },
    { name: "NaN wind", body: { current: { wind_speed_10m: Number.NaN, temperature_2m: 28 } } },
    { name: "infinite wind", body: { current: { wind_speed_10m: Number.POSITIVE_INFINITY, temperature_2m: 28 } } },
    { name: "negative wind", body: { current: { wind_speed_10m: -3, temperature_2m: 28 } } },
    { name: "impossible humidity", body: { current: { wind_speed_10m: 12, relative_humidity_2m: 140 } } },
  ];
  for (const item of invalid) {
    clearPlaceCache();
    weatherBody = item.body;
    upstreamCalls = [];
    const response = await readAir();
    assert.equal(response.status, 200, item.name);
    assert.equal(response.body.aqi, 80, item.name);
    assert.deepEqual(response.body.weather, {}, item.name);
    assert.equal(response.body.weatherRetrievedAt, null, item.name);
    const weatherKey = [...cache.entries.keys()].find((key) => key.includes("latitude=64.15") && key.includes("api.open-meteo.com/v1/forecast") && !key.includes("hourly="));
    assert.equal(weatherKey, undefined, item.name);
    const decision = buildExposureDecision(response.body, profile, Date.now());
    assert.equal(decision.wind.points, 0, item.name);
    assert.equal(decision.wind.state, "excluded_missing_wind", item.name);
    assert.match(decision.wind.disclosure, /unavailable/i, item.name);
    assert.match(decision.wind.disclosure, /not used/i, item.name);
    assert.ok(decision.trace.unavailable.some((line) => /unavailable/i.test(line) && /not used/i.test(line)), item.name);

    weatherBody = { current: { wind_speed_10m: 7 } };
    upstreamCalls = [];
    const recovered = await readAir();
    assert.equal(recovered.status, 200, item.name);
    assert.equal(recovered.body.weather.wind_speed_10m, 7, item.name);
    assert.equal(recovered.body.weather.temperature_2m, undefined, item.name);
    assert.equal(recovered.body.weather.apparent_temperature, undefined, item.name);
    assert.equal(recovered.body.weather.relative_humidity_2m, undefined, item.name);
    assert.equal(recovered.body.weather.weather_code, undefined, item.name);
    assert.ok(recovered.body.weatherRetrievedAt, item.name);
    assert.equal(upstreamCalls.some((url) => url.includes("api.open-meteo.com/v1/forecast") && !url.includes("hourly=")), true, item.name);
    const cachedAt = recovered.body.weatherRetrievedAt;
    upstreamCalls = [];
    const cached = await readAir();
    assert.equal(cached.body.weatherRetrievedAt, cachedAt, item.name);
    assert.equal(cached.body.weather.wind_speed_10m, 7, item.name);
    assert.equal(upstreamCalls.some((url) => url.includes("api.open-meteo.com/v1/forecast")), false, item.name);
    const stored = buildExposureDecision(cached.body, profile, Date.now());
    assert.equal(stored.wind.points, 0, item.name);
    assert.equal(stored.wind.state, "included", item.name);
  }
});

test("malformed hourly forecast weather is not cached and a later valid forecast is", async () => {
  const hour = Math.floor(Date.parse("2026-11-25T15:00:00Z") / 1000);
  const malformed = [
    { name: "empty hourly", body: { current: { wind_speed_10m: 12 }, hourly: {} } },
    { name: "time is not an array", body: { hourly: { time: hour, wind_speed_10m: [12] } } },
    { name: "string wind", body: { hourly: { time: [hour], wind_speed_10m: ["12"] } } },
    { name: "NaN wind", body: { hourly: { time: [hour], wind_speed_10m: [Number.NaN] } } },
    { name: "infinite wind", body: { hourly: { time: [hour], wind_speed_10m: [Number.POSITIVE_INFINITY] } } },
    { name: "missing wind", body: { hourly: { time: [hour], temperature_2m: [22] } } },
  ];
  for (const item of malformed) {
    clearPlaceCache();
    forecastBody = item.body;
    upstreamCalls = [];
    await assert.rejects(() => fetchTrustedForecast(latitude, longitude), /Invalid provider response shape/, item.name);
    const forecastKey = [...cache.entries.keys()].find((key) => key.includes("api.open-meteo.com/v1/forecast") && key.includes("hourly="));
    assert.equal(forecastKey, undefined, item.name);
    assert.equal(upstreamCalls.some((url) => url.includes("api.open-meteo.com/v1/forecast") && url.includes("hourly=")), true, item.name);
  }

  clearPlaceCache();
  forecastBody = { current: {}, hourly: { time: [hour], wind_speed_10m: [9] } };
  upstreamCalls = [];
  const forecast = await fetchTrustedForecast(latitude, longitude);
  assert.ok(forecast.weatherRetrievedAt);
  assert.equal(forecast.hourly.some((row) => row.weather?.wind_speed_10m === 9), true);
  const storedAt = forecast.weatherRetrievedAt;
  upstreamCalls = [];
  const cached = await fetchTrustedForecast(latitude, longitude);
  assert.equal(cached.weatherRetrievedAt, storedAt);
  assert.equal(upstreamCalls.some((url) => url.includes("api.open-meteo.com/v1/forecast") && url.includes("hourly=")), false);

  clearPlaceCache();
  forecastBody = { current: { wind_speed_10m: 12, temperature_2m: 28 }, hourly: { time: "not-an-array" } };
  const response = await request(app, {
    method: "POST",
    url: "/api/gowindow",
    body: {
      latitude,
      longitude,
      activity: "running",
      profile: { ageGroup: "adult", sensitivity: "general" },
      durationMinutes: 60,
    },
  });
  assert.equal(response.status, 502);
  assert.match(response.body.error, /temporarily unavailable/i);
  assert.equal(response.body.status, undefined);
  assert.equal(response.body.windows, undefined);
  assert.equal([...cache.entries.keys()].some((key) => key.includes("api.open-meteo.com/v1/forecast") && key.includes("hourly=")), false);
});

test("GoWindow stays insufficient when weather is missing and does not open a window on a weather outage", async () => {
  const now = Date.parse("2026-06-15T02:30:00.000Z");
  const hour = new Date(now + 60 * 60 * 1000).toISOString();
  const result = findGoWindows({
    forecast: {
      timezone: "Asia/Kolkata",
      airRetrievedAt: new Date(now).toISOString(),
      weatherRetrievedAt: null,
      retrievedAt: new Date(now).toISOString(),
      hourly: [{ time: hour, aqi: 35, pm25: 8, pm10: 12, weather: { wind_speed_10m: 12 } }],
    },
    profile: { activity: "running", ageGroup: "adult", sensitivity: "general" },
    durationMinutes: 60,
    now,
  });
  assert.equal(result.status, "insufficient_data");
  assert.deepEqual(result.windows, []);

  weatherMode = "http";
  const response = await request(app, {
    method: "POST",
    url: "/api/gowindow",
    body: {
      latitude,
      longitude,
      activity: "running",
      profile: { ageGroup: "adult", sensitivity: "general" },
      durationMinutes: 60,
    },
  });
  assert.equal(response.status, 502);
  assert.match(response.body.error, /temporarily unavailable/i);
  assert.equal(response.body.status, undefined);
  assert.equal(response.body.windows, undefined);
});
});
