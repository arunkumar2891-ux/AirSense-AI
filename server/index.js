import "./env.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAQIStatus, buildRecommendationContext, buildExposureDecision, parseWindHypothetical, buildWindHypothetical } from "./logic.js";
import { askGemini, classifyLocalDomain, detectPromptInjection, normalizeQuestion } from "./gemini.js";
import { buildComparison, clarificationAnswer, describeLocationAnswer, extractLocationIntent, geocodeQueries, judgeGeocode, placeLabel } from "./locations.js";
import { providerTimeToEpochMs, providerTimeToIso, selectCurrentAndFutureHours } from "./time.js";
import { findGoWindows, TIME_PREFERENCES } from "./gowindow.js";
import { buildForecastMetadata } from "./metadata.js";
import { BoundedTTLCache, normalizeCoordinates } from "./cache.js";
import { createRateLimiter } from "./rate-limit.js";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
// Vercel sets this to the string "1". Render and local processes leave it unset.
const ON_VERCEL = process.env.VERCEL === "1";
const app = express();
app.disable("x-powered-by");
// Vercel is exactly one forwarding hop and overwrites X-Forwarded-For.
// Render continues to trust only private-network proxies. Local development
// trusts none, so a direct client cannot choose its rate-limit identity.
app.set(
  "trust proxy",
  ON_VERCEL ? 1 : (IS_PRODUCTION ? "loopback, linklocal, uniquelocal" : false),
);

const PORT = Number(process.env.PORT || 10000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- Security headers (Helmet) ----------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.bigdatacloud.net"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Vite build may emit cross-origin modulepreload
}));

// ---------- CORS ----------
// Same-origin production (Express serves the React build) does not need CORS.
// Development keeps Vite proxy from :5173. Additional origins can be allowlisted.
const devOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];
const extraOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map((o) => o.trim()).filter(Boolean);
const allowedOrigins = new Set(extraOrigins);

function isOriginAllowed(origin, production = IS_PRODUCTION, requestOrigin = "") {
  if (!origin) return true;
  if (requestOrigin && origin === requestOrigin) return true;
  if (allowedOrigins.has(origin)) return true;
  if (!production && devOrigins.includes(origin)) return true;
  return !production; // Keep arbitrary local dev ports/tools working.
}

app.use(cors((req, cb) => {
  const origin = req.get("origin");
  const requestOrigin = `${req.protocol}://${req.get("host")}`;
  if (isOriginAllowed(origin, IS_PRODUCTION, requestOrigin)) {
    return cb(null, { origin: true });
  }
  return cb(new Error("CORS: origin not allowed"));
}));

app.use(express.json({ limit: "30kb" }));

// ---------- Upstream caches ----------
// Environmental readings and place search are independent. Filling one cache
// must not evict the other. CACHE_MAX_ENTRIES remains the environmental bound.
// GEOCODE_CACHE_MAX_ENTRIES overrides only the geocoding bound; when unset,
// geocoding keeps the same capacity number as the environmental cache.
const CACHE_MAX_ENTRIES = Math.max(10, Number(process.env.CACHE_MAX_ENTRIES) || 500);
const GEOCODE_CACHE_MAX_ENTRIES = Math.max(10, Number(process.env.GEOCODE_CACHE_MAX_ENTRIES) || CACHE_MAX_ENTRIES);
const ENVIRONMENT_CACHE_TTL_MS = Math.max(1000, Number(process.env.ENVIRONMENT_CACHE_TTL_MS) || 10 * 60 * 1000);
const GEOCODE_CACHE_TTL_MS = Math.max(1000, Number(process.env.GEOCODE_CACHE_TTL_MS) || 24 * 60 * 60 * 1000);
const cache = new BoundedTTLCache({ maxEntries: CACHE_MAX_ENTRIES });
const geocodeCache = new BoundedTTLCache({ maxEntries: GEOCODE_CACHE_MAX_ENTRIES });

// Labels come only from the fixed host and path. Current and hourly weather
// share a host, so the hourly parameter's presence separates them. Its value
// is never read. Geocoding and any other URL stay unlabeled.
function providerEndpointClass(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  if (parsed.hostname === "air-quality-api.open-meteo.com" && parsed.pathname === "/v1/air-quality") {
    return "air-quality";
  }
  if (parsed.hostname === "api.open-meteo.com" && parsed.pathname === "/v1/forecast") {
    return parsed.searchParams.has("hourly") ? "forecast-weather" : "current-weather";
  }
  return null;
}

function providerFailureStage(error, httpStatus) {
  if (isTimeoutError(error)) return "timeout";
  if (Number.isInteger(httpStatus)) return "http";
  if (error instanceof SyntaxError || error?.message === "Invalid provider response shape") return "validation";
  return "network";
}

function sanitizedToken(value, pattern) {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

function logProviderFailure(endpointClass, elapsedMs, error, httpStatus) {
  try {
    if (endpointClass !== "air-quality" && endpointClass !== "current-weather" && endpointClass !== "forecast-weather") return;
    const entry = {
      event: "provider_request_failed",
      endpointClass,
      elapsedMs,
      errorName: sanitizedToken(error?.name, /^[A-Za-z][A-Za-z0-9_]{0,63}$/) ?? "Error",
      failureStage: providerFailureStage(error, httpStatus),
    };
    const errorCode = sanitizedToken(error?.cause?.code, /^[A-Z][A-Z0-9_]{0,63}$/);
    if (errorCode) entry.errorCode = errorCode;
    if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) entry.httpStatus = httpStatus;
    console.error(JSON.stringify(entry));
  } catch {
    // A diagnostic failure must not replace or wrap the provider error.
  }
}

async function loadCachedRecord(store, url, ttlMs = ENVIRONMENT_CACHE_TTL_MS, accept = null) {
  const key = String(url);
  return store.getOrLoad(key, ttlMs, async () => {
    const startedAt = Date.now();
    let httpStatus = null;
    try {
      const response = await fetch(key, {
        headers: { "User-Agent": "AirSenseAI/1.0" },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        httpStatus = response.status;
        throw new Error(`Data provider returned ${response.status}`);
      }
      const data = await response.json();
      const record = { data, retrievedAt: new Date().toISOString() };
      if (accept && !accept(record)) throw new Error("Invalid provider response shape");
      return record;
    } catch (error) {
      logProviderFailure(providerEndpointClass(key), Date.now() - startedAt, error, httpStatus);
      throw error;
    }
  });
}

async function cachedFetchRecord(url, ttlMs = ENVIRONMENT_CACHE_TTL_MS) {
  return loadCachedRecord(cache, url, ttlMs);
}

async function cachedFetch(url, ttlMs = GEOCODE_CACHE_TTL_MS) {
  const record = await loadCachedRecord(geocodeCache, url, ttlMs);
  return record.data;
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function omittedWeatherValue(value) {
  return value === undefined || value === null;
}

function finiteJsonNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// Wind is the only current-weather field the exposure score and decision trace
// consume. Temperature, feels-like, and humidity are displayed when present.
// weather_code is requested from the provider and is not used.
function usableWindSpeed(value) {
  return finiteJsonNumber(value) && value >= 0;
}

function usableCelsius(value) {
  return finiteJsonNumber(value);
}

function usableHumidity(value) {
  return finiteJsonNumber(value) && value >= 0 && value <= 100;
}

function optionalWeatherField(value, accept) {
  return omittedWeatherValue(value) || accept(value);
}

function usableCurrentObservation(current) {
  if (!plainObject(current)) return false;
  if (!usableWindSpeed(current.wind_speed_10m)) return false;
  if (!optionalWeatherField(current.temperature_2m, usableCelsius)) return false;
  if (!optionalWeatherField(current.apparent_temperature, usableCelsius)) return false;
  if (!optionalWeatherField(current.relative_humidity_2m, usableHumidity)) return false;
  return true;
}

function optionalWeatherSeries(values, accept) {
  if (omittedWeatherValue(values)) return true;
  return Array.isArray(values) && values.every((value) => optionalWeatherField(value, accept));
}

// GoWindow reads hourly time, wind, temperature, and humidity. Current
// observations on a forecast document are not required for that path.
function usableHourlyForecast(hourly, utcOffsetSeconds) {
  if (!plainObject(hourly) || !Array.isArray(hourly.time) || hourly.time.length === 0) return false;
  const wind = hourly.wind_speed_10m;
  if (!Array.isArray(wind) || !wind.every((value) => optionalWeatherField(value, usableWindSpeed))) return false;
  if (!optionalWeatherSeries(hourly.temperature_2m, usableCelsius)) return false;
  if (!optionalWeatherSeries(hourly.relative_humidity_2m, usableHumidity)) return false;
  return hourly.time.some((time, index) =>
    providerTimeToEpochMs(time, utcOffsetSeconds) !== null && usableWindSpeed(wind[index])
  );
}

function usableCurrentWeatherRecord(record) {
  const data = record?.data;
  return plainObject(data) && usableCurrentObservation(data.current);
}

function usableForecastWeatherRecord(record) {
  const data = record?.data;
  return plainObject(data) && usableHourlyForecast(data.hourly, data.utc_offset_seconds);
}

async function settleRecord(url, ttlMs = ENVIRONMENT_CACHE_TTL_MS, accept = null) {
  try {
    return { ok: true, record: await loadCachedRecord(cache, url, ttlMs, accept) };
  } catch (error) {
    return { ok: false, error };
  }
}

// ---------- Trusted environmental data ----------
function buildAirUrls(latitude, longitude) {
  const aqParams = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude), timezone: "auto",
    timeformat: "unixtime",
    current: "pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,us_aqi,european_aqi",
    hourly: "pm10,pm2_5,us_aqi,european_aqi",
    forecast_days: "2",
  });
  const wxParams = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude), timezone: "auto",
    timeformat: "unixtime",
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code",
  });
  return {
    airUrl: `https://air-quality-api.open-meteo.com/v1/air-quality?${aqParams}`,
    weatherUrl: `https://api.open-meteo.com/v1/forecast?${wxParams}`,
  };
}

function buildForecastWeatherUrl(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude), timezone: "auto",
    timeformat: "unixtime",
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code",
    hourly: "temperature_2m,relative_humidity_2m,wind_speed_10m",
    forecast_days: "2",
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

function finiteNonNegative(value) {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isFinite(number) && number >= 0 ? number : null;
}

async function fetchTrustedEnvironmentalData(latitude, longitude) {
  const normalized = normalizeCoordinates(latitude, longitude);
  const { airUrl, weatherUrl } = buildAirUrls(normalized.latitude, normalized.longitude);
  const [airResult, weatherResult] = await Promise.all([
    settleRecord(airUrl),
    settleRecord(weatherUrl, ENVIRONMENT_CACHE_TTL_MS, usableCurrentWeatherRecord),
  ]);
  if (!airResult.ok) throw airResult.error;
  const airRecord = airResult.record;
  const air = airRecord?.data;
  if (!plainObject(air)) throw new Error("Invalid provider response shape");
  // Weather is optional. A failure, timeout, or unusable payload leaves wind
  // unavailable. It is not replaced with a fabricated value or with the
  // air-quality retrieval time.
  const weatherRecord = weatherResult.ok ? weatherResult.record : null;
  const weather = weatherRecord ? weatherRecord.data.current : {};
  const weatherRetrievedAt = weatherRecord ? weatherRecord.retrievedAt ?? null : null;
  const current = air.current || {};
  const rawAqi = current.us_aqi == null ? NaN : Number(current.us_aqi);
  const aqi = Number.isFinite(rawAqi) && rawAqi >= 0 ? rawAqi : null;
  const status = getAQIStatus(aqi);
  const forecastValidAt = providerTimeToIso(current.time, air.utc_offset_seconds);
  const metadata = buildForecastMetadata({ air, retrievedAt: airRecord.retrievedAt });
  const hours = selectCurrentAndFutureHours(
    air.hourly,
    current.time,
    air.utc_offset_seconds,
    12,
  );
  return {
    location: { ...normalized, timezone: air.timezone || "UTC" },
    observedAt: forecastValidAt,
    forecastValidAt,
    retrievedAt: metadata.timestamps.retrievedAt,
    modelInitializedAt: metadata.timestamps.modelInitializedAt,
    metadata,
    aqi,
    aqiScale: "US AQI",
    status,
    pollutants: {
      pm25: finiteNonNegative(current.pm2_5), pm10: finiteNonNegative(current.pm10),
      ozone: finiteNonNegative(current.ozone), nitrogenDioxide: finiteNonNegative(current.nitrogen_dioxide),
      carbonMonoxide: finiteNonNegative(current.carbon_monoxide), sulphurDioxide: finiteNonNegative(current.sulphur_dioxide),
    },
    weather,
    weatherRetrievedAt,
    hourly: hours,
    source: "Open-Meteo / CAMS",
    attribution: "Air quality estimates are model-based and may differ from local regulatory monitoring stations.",
  };
}

function finiteWeatherNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hourlyWeatherByTime(weather, utcOffsetSeconds) {
  const hourly = weather?.hourly;
  if (!hourly || !Array.isArray(hourly.time)) return new Map();
  const byTime = new Map();
  hourly.time.forEach((time, index) => {
    const epochMs = providerTimeToEpochMs(time, utcOffsetSeconds);
    if (epochMs === null) return;
    const temperature = finiteWeatherNumber(hourly.temperature_2m?.[index]);
    const humidity = finiteWeatherNumber(hourly.relative_humidity_2m?.[index]);
    const wind = finiteNonNegative(hourly.wind_speed_10m?.[index]);
    const conditions = {};
    if (temperature !== null) conditions.temperature_2m = temperature;
    if (humidity !== null && humidity >= 0 && humidity <= 100) conditions.relative_humidity_2m = humidity;
    if (wind !== null) conditions.wind_speed_10m = wind;
    if (Object.keys(conditions).length) byTime.set(new Date(epochMs).toISOString(), conditions);
  });
  return byTime;
}

function toGoWindowForecast(air, weather, retrieval = {}) {
  const current = air?.current || {};
  const forecastValidAt = providerTimeToIso(current.time, air?.utc_offset_seconds);
  // retrievedAt remains the air-quality retrieval time. The weather response
  // keeps its own timestamp; a cache hit on one URL must not restamp the other.
  const airRetrievedAt = retrieval.airRetrievedAt ?? retrieval.retrievedAt ?? null;
  const weatherRetrievedAt = retrieval.weatherRetrievedAt ?? null;
  const metadata = buildForecastMetadata({ air, retrievedAt: airRetrievedAt });
  const hours = selectCurrentAndFutureHours(air?.hourly, current.time, air?.utc_offset_seconds, 12);
  const weatherOffset = weather?.utc_offset_seconds ?? air?.utc_offset_seconds;
  const weatherByTime = hourlyWeatherByTime(weather, weatherOffset);
  return {
    timezone: typeof air?.timezone === "string" ? air.timezone : null,
    forecastValidAt,
    modelInitializedAt: metadata.timestamps.modelInitializedAt,
    retrievedAt: airRetrievedAt,
    airRetrievedAt,
    weatherRetrievedAt,
    metadata,
    hourly: hours.map((hour) => {
      const conditions = weatherByTime.get(hour.time);
      return conditions ? { ...hour, weather: conditions } : hour;
    }),
  };
}

async function fetchTrustedForecast(latitude, longitude) {
  const normalized = normalizeCoordinates(latitude, longitude);
  const { airUrl } = buildAirUrls(normalized.latitude, normalized.longitude);
  const weatherUrl = buildForecastWeatherUrl(normalized.latitude, normalized.longitude);
  // GoWindow still requires both sources. A weather failure rejects the forecast
  // rather than producing a window from air quality alone.
  const [airRecord, weatherRecord] = await Promise.all([
    cachedFetchRecord(airUrl),
    loadCachedRecord(cache, weatherUrl, ENVIRONMENT_CACHE_TTL_MS, usableForecastWeatherRecord),
  ]);
  const air = airRecord?.data;
  const weather = weatherRecord?.data;
  if (!air || typeof air !== "object" || !weather || typeof weather !== "object") {
    throw new Error("Invalid provider response shape");
  }
  return toGoWindowForecast(air, weather, {
    airRetrievedAt: airRecord.retrievedAt,
    weatherRetrievedAt: weatherRecord.retrievedAt,
  });
}

// ---------- Input validation ----------
const ALLOWED_ACTIVITIES = new Set(["running", "cycling", "outdoor workout", "sports", "commuting", "daily activities", "children's outdoor play"]);
const ALLOWED_AGE_GROUPS = new Set(["adult", "child", "older adult"]);
const ALLOWED_SENSITIVITIES = new Set(["general", "respiratory sensitivity", "heart or lung condition"]);

function isGeographicInput(value) {
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim());
}

function validateCoordinates(lat, lon) {
  if (!isGeographicInput(lat) || !isGeographicInput(lon)) return null;
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function validateAssistantInput(body) {
  if (!body || typeof body !== "object") {
    return { error: "Request body must be a JSON object." };
  }
  const { question, profile, latitude, longitude } = body;
  if (typeof question !== "string") {
    return { error: "Question must be a string." };
  }
  const trimmed = question.trim();
  if (trimmed.length < 2 || trimmed.length > 1200) {
    return { error: "Please enter a question between 2 and 1200 characters." };
  }
  const coords = validateCoordinates(latitude, longitude);
  if (!coords) {
    return { error: "Valid latitude and longitude are required." };
  }
  const p = profile && typeof profile === "object" ? profile : {};
  const activity = String(p.activity ?? "daily activities");
  const ageGroup = String(p.ageGroup ?? "adult");
  const sensitivity = String(p.sensitivity ?? "general");
  if (!ALLOWED_ACTIVITIES.has(activity)) {
    return { error: `Invalid activity. Allowed: ${[...ALLOWED_ACTIVITIES].join(", ")}.` };
  }
  if (!ALLOWED_AGE_GROUPS.has(ageGroup)) {
    return { error: `Invalid age group. Allowed: ${[...ALLOWED_AGE_GROUPS].join(", ")}.` };
  }
  if (!ALLOWED_SENSITIVITIES.has(sensitivity)) {
    return { error: `Invalid sensitivity. Allowed: ${[...ALLOWED_SENSITIVITIES].join(", ")}.` };
  }
  return {
    value: {
      question: trimmed,
      profile: { activity, ageGroup, sensitivity },
      latitude: coords.latitude,
      longitude: coords.longitude,
    },
  };
}

function validateGoWindowInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be a JSON object." };
  }
  const coords = validateCoordinates(body.latitude, body.longitude);
  if (!coords) return { error: "Valid latitude and longitude are required." };
  if (typeof body.activity !== "string" || !ALLOWED_ACTIVITIES.has(body.activity)) {
    return { error: `Invalid activity. Allowed: ${[...ALLOWED_ACTIVITIES].join(", ")}.` };
  }
  if (!body.profile || typeof body.profile !== "object" || Array.isArray(body.profile)) {
    return { error: "Profile must be an object." };
  }
  const ageGroup = body.profile.ageGroup ?? "adult";
  const sensitivity = body.profile.sensitivity ?? "general";
  if (typeof ageGroup !== "string" || !ALLOWED_AGE_GROUPS.has(ageGroup)) {
    return { error: `Invalid age group. Allowed: ${[...ALLOWED_AGE_GROUPS].join(", ")}.` };
  }
  if (typeof sensitivity !== "string" || !ALLOWED_SENSITIVITIES.has(sensitivity)) {
    return { error: `Invalid sensitivity. Allowed: ${[...ALLOWED_SENSITIVITIES].join(", ")}.` };
  }
  if (body.profile.activity !== undefined && body.profile.activity !== body.activity) {
    return { error: "Activity does not match the profile activity." };
  }
  if (!Number.isInteger(body.durationMinutes) || body.durationMinutes < 15 || body.durationMinutes > 180) {
    return { error: "Duration must be a whole number of minutes from 15 to 180." };
  }
  let timePreference = null;
  if (body.timePreference !== undefined && body.timePreference !== null) {
    if (typeof body.timePreference !== "string" || !Object.hasOwn(TIME_PREFERENCES, body.timePreference)) {
      return { error: `Invalid time preference. Allowed: ${Object.keys(TIME_PREFERENCES).join(", ")}.` };
    }
    timePreference = body.timePreference;
  }
  return {
    value: {
      latitude: coords.latitude,
      longitude: coords.longitude,
      durationMinutes: body.durationMinutes,
      timePreference,
      profile: { activity: body.activity, ageGroup, sensitivity },
    },
  };
}

// ---------- Rate limiting (bounded, in-memory, per trusted client IP) ----------
const RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.ASSISTANT_RATE_LIMIT_WINDOW_MS) || 60000);
const RATE_LIMIT_MAX = Math.max(1, Number(process.env.ASSISTANT_RATE_LIMIT_MAX) || 20);
const rateLimiters = {
  airQuality: createRateLimiter({
    name: "air-quality",
    windowMs: process.env.DATA_RATE_LIMIT_WINDOW_MS || 60000,
    max: process.env.DATA_RATE_LIMIT_MAX || 60,
  }),
  geocode: createRateLimiter({
    name: "location-search",
    windowMs: process.env.GEOCODE_RATE_LIMIT_WINDOW_MS || 60000,
    max: process.env.GEOCODE_RATE_LIMIT_MAX || 30,
  }),
  reverseGeocode: createRateLimiter({
    name: "reverse-geocode",
    windowMs: process.env.GEOCODE_RATE_LIMIT_WINDOW_MS || 60000,
    max: process.env.GEOCODE_RATE_LIMIT_MAX || 30,
  }),
  assistant: createRateLimiter({
    name: "assistant",
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX,
  }),
  goWindow: createRateLimiter({
    name: "activity-window",
    windowMs: process.env.DATA_RATE_LIMIT_WINDOW_MS || 60000,
    max: process.env.DATA_RATE_LIMIT_MAX || 60,
  }),
};
const rateBuckets = rateLimiters.assistant.buckets;

// ---------- Error helpers ----------
function isTimeoutError(err) {
  return err?.name === "TimeoutError" || err?.name === "AbortError" || /timeout|timed out/i.test(String(err?.message));
}

// ---------- Routes ----------
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "airsense-ai", timestamp: new Date().toISOString() }));

async function searchPlaces(name) {
  const q = String(name || "").trim().replace(/[\x00-\x1f]/g, "");
  if (q.length < 2 || q.length > 100) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q, count: "6", language: "en", format: "json" })}`;
  const data = await cachedFetch(url, GEOCODE_CACHE_TTL_MS);
  return (Array.isArray(data?.results) ? data.results : []).map((place) => ({
    name: String(place.name || ""),
    region: place.admin1 ? String(place.admin1) : "",
    country: place.country ? String(place.country) : "",
    latitude: Number(place.latitude),
    longitude: Number(place.longitude),
    population: Number.isFinite(Number(place.population)) ? Number(place.population) : null,
  })).filter((place) => place.name && Number.isFinite(place.latitude) && Number.isFinite(place.longitude));
}

function publicLocation(location) {
  const copy = { ...location };
  delete copy.trusted;
  return copy;
}

async function resolveNamedLocation(query, profile, now) {
  const queries = geocodeQueries(query);
  const settled = await Promise.all(queries.map(async (name) => {
    try {
      return { ok: true, results: await searchPlaces(name) };
    } catch {
      return { ok: false, results: [] };
    }
  }));
  if (settled.every((item) => !item.ok)) {
    return {
      query, status: "geocoding_unavailable", source: "named", decision: null,
      note: "Location search is temporarily unavailable for this place.",
    };
  }
  const seen = new Set();
  const results = [];
  for (const place of settled.flatMap((item) => item.results)) {
    const key = `${place.name.toLowerCase()}|${place.latitude}|${place.longitude}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(place);
  }
  const judged = judgeGeocode(query, results);
  if (judged.status === "unresolved") {
    return {
      query, status: "unresolved", source: "named", decision: null,
      candidates: judged.candidates,
      note: `${query} could not be resolved to a place.`,
    };
  }
  if (judged.status === "ambiguous") {
    return {
      query, status: "ambiguous", source: "named", candidates: judged.candidates, decision: null,
      note: `${query} matches more than one place.`,
    };
  }
  const coords = validateCoordinates(judged.place.latitude, judged.place.longitude);
  if (!coords) {
    return { query, status: "unresolved", source: "named", decision: null, note: `${query} did not return usable coordinates.` };
  }
  const normalized = normalizeCoordinates(coords.latitude, coords.longitude);
  try {
    const trusted = await fetchTrustedEnvironmentalData(normalized.latitude, normalized.longitude);
    const decision = buildExposureDecision(trusted, profile, now);
    const weather = trusted.weather && typeof trusted.weather === "object" ? trusted.weather : {};
    return {
      query,
      status: "ready",
      source: "named",
      name: judged.place.name,
      region: judged.place.region,
      country: judged.place.country,
      latitude: trusted.location.latitude,
      longitude: trusted.location.longitude,
      aqi: trusted.aqi,
      aqiScale: trusted.aqiScale || "US AQI",
      pm25: trusted.pollutants?.pm25 ?? null,
      weatherAvailable: Boolean(trusted.weatherRetrievedAt) && Object.keys(weather).length > 0,
      retrievedAt: trusted.retrievedAt ?? null,
      weatherRetrievedAt: trusted.weatherRetrievedAt ?? null,
      decision,
      trusted,
    };
  } catch {
    return {
      query,
      status: "environment_data_unavailable",
      source: "named",
      name: judged.place.name,
      region: judged.place.region,
      country: judged.place.country,
      latitude: normalized.latitude,
      longitude: normalized.longitude,
      aqi: null,
      pm25: null,
      weatherAvailable: false,
      retrievedAt: null,
      weatherRetrievedAt: null,
      decision: null,
      note: "Air-quality data is temporarily unavailable for this place.",
    };
  }
}

function assistantPayload(result, decision, hypothetical, extra = {}) {
  const answered = result.mode === "ai" || result.mode === "rules" || result.mode === "rules-fallback";
  return {
    answer: result.answer,
    evidence: result.evidence || [],
    mode: result.mode,
    decision,
    ...(answered && hypothetical ? { hypothetical } : {}),
    ...(result.structured ? { structured: result.structured } : {}),
    ...(result.note ? { note: result.note } : {}),
    ...(answered ? { context: result.context } : {}),
    ...extra,
  };
}

async function answerForTrusted(question, profile, trusted, decision, place) {
  const context = buildRecommendationContext(trusted, profile, question, decision);
  if (place) context.answer = `${place}. ${context.answer}`;
  const assumedWind = parseWindHypothetical(question);
  const hypothetical = assumedWind === null ? null : buildWindHypothetical(trusted, profile, assumedWind, Date.now());
  const result = await askGemini(question, context, trusted, decision, { hypothetical, ...(place ? { place } : {}) });
  result.context = context;
  if (place && result.answer && !result.answer.includes(place.split(",")[0])) {
    result.answer = `${place}. ${result.answer}`;
  }
  return { result, hypothetical };
}

// City search (forward geocoding via Open-Meteo). Cached — place names change rarely.
app.get("/api/geocode", rateLimiters.geocode.middleware, async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().replace(/[\x00-\x1f]/g, "") : "";
  if (q.length < 2 || q.length > 100) {
    return res.status(400).json({ error: "Enter a place name between 2 and 100 characters." });
  }
  try {
    const results = (await searchPlaces(q)).map(({ name, region, country, latitude, longitude }) => ({
      name, region, country, latitude, longitude,
    }));
    return res.json({ results });
  } catch (error) {
    const code = isTimeoutError(error) ? 504 : 502;
    return res.status(code).json({ error: "Location search is temporarily unavailable." });
  }
});

// Privacy-preserving fallback. Friendly GPS labels are resolved directly in
// the browser using BigDataCloud's client-only endpoint; coordinates never
// transit this server for reverse geocoding.
app.get("/api/reverse-geocode", rateLimiters.reverseGeocode.middleware, (_req, res) => {
  return res.json({ label: "Your location", fallback: true });
});

app.get("/api/air-quality", rateLimiters.airQuality.middleware, async (req, res) => {
  const coords = validateCoordinates(req.query.lat, req.query.lon);
  if (!coords) {
    return res.status(400).json({ error: "Valid latitude and longitude are required." });
  }
  try {
    const data = await fetchTrustedEnvironmentalData(coords.latitude, coords.longitude);
    res.json(data);
  } catch (error) {
    const code = isTimeoutError(error) ? 504 : 502;
    res.status(code).json({ error: "Current environmental data is temporarily unavailable." });
  }
});

app.post("/api/gowindow", rateLimiters.goWindow.middleware, async (req, res) => {
  const parsed = validateGoWindowInput(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { latitude, longitude, profile, durationMinutes, timePreference } = parsed.value;
  try {
    const forecast = await fetchTrustedForecast(latitude, longitude);
    return res.json(findGoWindows({ forecast, profile, durationMinutes, timePreference }));
  } catch (error) {
    const code = isTimeoutError(error) ? 504 : 502;
    return res.status(code).json({ error: "Forecast data is temporarily unavailable." });
  }
});

app.post("/api/assistant", rateLimiters.assistant.middleware, async (req, res) => {
  const parsed = validateAssistantInput(req.body);
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }
  const { question, profile, latitude, longitude } = parsed.value;
  const normalized = normalizeQuestion(question);
  const local = classifyLocalDomain(normalized);
  const intent = extractLocationIntent(normalized);

  // Named places are resolved only for environmental questions. An unrelated
  // question that happens to contain "in <Name>" keeps the selected location
  // and the existing refusal. Client-supplied readings are never accepted.
  if (!detectPromptInjection(normalized) && local.category !== "unrelated" && intent.kind === "clarify") {
    return res.json({
      answer: clarificationAnswer(intent),
      evidence: [],
      mode: "location-clarification",
      locations: [],
    });
  }
  if (!detectPromptInjection(normalized) && local.category !== "unrelated" && intent.kind === "named") {
    const now = Date.now();
    const resolved = await Promise.all(intent.names.map((name) => resolveNamedLocation(name, profile, now)));
    const extra = (intent.extra || []).map((name) => ({
      query: name,
      status: "unavailable",
      source: "named",
      decision: null,
      note: "Only four places are resolved at a time. This place was not fetched.",
    }));
    const locations = [...resolved, ...extra];
    if (!intent.comparison) {
      const only = resolved[0];
      if (!only || only.status !== "ready") {
        return res.json({
          answer: describeLocationAnswer(locations, null),
          evidence: [],
          mode: "rules",
          locations: locations.map(publicLocation),
        });
      }
      const label = placeLabel(only);
      const { result, hypothetical } = await answerForTrusted(question, profile, only.trusted, only.decision, label);
      return res.json(assistantPayload(result, only.decision, hypothetical, {
        locations: locations.map(publicLocation),
      }));
    }
    const comparison = buildComparison(locations);
    return res.json({
      answer: describeLocationAnswer(locations, comparison),
      evidence: [],
      mode: "rules",
      locations: locations.map(publicLocation),
      comparison,
    });
  }

  let trusted;
  try {
    trusted = await fetchTrustedEnvironmentalData(latitude, longitude);
  } catch (error) {
    const code = isTimeoutError(error) ? 504 : 502;
    return res.status(code).json({
      error: "Trusted environmental data is temporarily unavailable. Please try again shortly.",
    });
  }
  const decision = buildExposureDecision(trusted, profile, Date.now());
  const { result, hypothetical } = await answerForTrusted(question, profile, trusted, decision);
  return res.json(assistantPayload(result, decision, hypothetical));
});

// ---------- Static frontend + SPA fallback ----------
app.use(express.static(path.join(__dirname, "../dist")));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "../dist/index.html"));
});

// ---------- Error middleware (consistent JSON, no internals) ----------
app.use((err, req, res, _next) => {
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large." });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body." });
  }
  if (err?.message === "CORS: origin not allowed") {
    return res.status(403).json({ error: "Origin not allowed." });
  }
  console.error("Unhandled error:", err?.message);
  return res.status(500).json({ error: "Unexpected server error." });
});

export {
  app,
  validateAssistantInput,
  validateGoWindowInput,
  fetchTrustedEnvironmentalData,
  fetchTrustedForecast,
  cachedFetch,
  cache,
  geocodeCache,
  CACHE_MAX_ENTRIES,
  GEOCODE_CACHE_MAX_ENTRIES,
  ENVIRONMENT_CACHE_TTL_MS,
  GEOCODE_CACHE_TTL_MS,
  rateBuckets,
  rateLimiters,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  isOriginAllowed,
};

// Vercel imports this module as a function and must not bind a port.
// Render and local `npm start` still listen. Tests set NODE_ENV=test.
if (!ON_VERCEL && process.env.NODE_ENV !== "test") {
  app.listen(PORT, "0.0.0.0", () => console.log(`AirSense AI listening on ${PORT}`));
}
