import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAQIStatus, buildRecommendationContext, buildExposureDecision } from "./logic.js";
import { askGemini } from "./gemini.js";

dotenv.config();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const PORT = Number(process.env.PORT || 10000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// ---------- Security headers (Helmet) ----------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
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
const allowedOrigins = new Set([...devOrigins, ...extraOrigins]);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin / curl / server-to-server
    if (allowedOrigins.has(origin)) return cb(null, true);
    if (!IS_PRODUCTION) return cb(null, true); // permissive for local dev
    return cb(new Error("CORS: origin not allowed"), false);
  },
}));

app.use(express.json({ limit: "30kb" }));

// ---------- Upstream data cache (reused by air-quality + assistant) ----------
const cache = new Map();
async function cachedFetch(url, ttlMs = 10 * 60 * 1000) {
  const key = String(url);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < ttlMs) return hit.data;
  const response = await fetch(key, {
    headers: { "User-Agent": "AirSenseAI/1.0" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Data provider returned ${response.status}`);
  const data = await response.json();
  cache.set(key, { time: Date.now(), data });
  return data;
}

// ---------- Trusted environmental data ----------
function buildAirUrls(latitude, longitude) {
  const aqParams = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude), timezone: "auto",
    current: "pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,us_aqi,european_aqi",
    hourly: "pm10,pm2_5,us_aqi,european_aqi",
    forecast_days: "2",
  });
  const wxParams = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude), timezone: "auto",
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code",
  });
  return {
    airUrl: `https://air-quality-api.open-meteo.com/v1/air-quality?${aqParams}`,
    weatherUrl: `https://api.open-meteo.com/v1/forecast?${wxParams}`,
  };
}

async function fetchTrustedEnvironmentalData(latitude, longitude) {
  const { airUrl, weatherUrl } = buildAirUrls(latitude, longitude);
  const [air, weather] = await Promise.all([
    cachedFetch(airUrl),
    cachedFetch(weatherUrl),
  ]);
  if (!air || typeof air !== "object" || !weather || typeof weather !== "object") {
    throw new Error("Invalid provider response shape");
  }
  const current = air.current || {};
  const aqi = current.us_aqi == null ? NaN : Number(current.us_aqi);
  const status = getAQIStatus(aqi);
  const hours = (air.hourly?.time || []).slice(0, 12).map((time, i) => ({
    time,
    aqi: air.hourly?.us_aqi?.[i] ?? null,
    pm25: air.hourly?.pm2_5?.[i] ?? null,
    pm10: air.hourly?.pm10?.[i] ?? null,
  }));
  return {
    location: { latitude, longitude, timezone: air.timezone || "local" },
    observedAt: current.time || new Date().toISOString(),
    aqi: Number.isFinite(aqi) ? aqi : null,
    aqiScale: "US AQI",
    status,
    pollutants: {
      pm25: current.pm2_5 ?? null, pm10: current.pm10 ?? null,
      ozone: current.ozone ?? null, nitrogenDioxide: current.nitrogen_dioxide ?? null,
      carbonMonoxide: current.carbon_monoxide ?? null, sulphurDioxide: current.sulphur_dioxide ?? null,
    },
    weather: weather.current || {},
    hourly: hours,
    source: "Open-Meteo / CAMS",
    attribution: "Air quality estimates are model-based and may differ from local regulatory monitoring stations.",
  };
}

// ---------- Input validation ----------
const ALLOWED_ACTIVITIES = new Set(["running", "cycling", "outdoor workout", "sports", "commuting", "daily activities", "children's outdoor play"]);
const ALLOWED_AGE_GROUPS = new Set(["adult", "child", "older adult"]);
const ALLOWED_SENSITIVITIES = new Set(["general", "respiratory sensitivity", "heart or lung condition"]);

function validateCoordinates(lat, lon) {
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

// ---------- Rate limiting (in-memory, per IP) ----------
const RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.ASSISTANT_RATE_LIMIT_WINDOW_MS) || 60000);
const RATE_LIMIT_MAX = Math.max(1, Number(process.env.ASSISTANT_RATE_LIMIT_MAX) || 20);
const rateBuckets = new Map(); // ip -> { count, resetAt }

function assistantRateLimiter(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateBuckets.get(ip)?.count; // no-op
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  const remaining = Math.max(0, RATE_LIMIT_MAX - bucket.count);
  res.set("RateLimit-Limit", String(RATE_LIMIT_MAX));
  res.set("RateLimit-Remaining", String(remaining));
  res.set("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count > RATE_LIMIT_MAX) {
    const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
    res.set("Retry-After", String(retryAfterSec));
    return res.status(429).json({
      error: `Too many assistant requests. Limit is ${RATE_LIMIT_MAX} per ${Math.round(RATE_LIMIT_WINDOW_MS / 1000)}s. Retry in ${retryAfterSec}s.`,
    });
  }
  // Opportunistic cleanup so the map does not grow unboundedly
  if (rateBuckets.size > 5000) {
    for (const [key, b] of rateBuckets) {
      if (now >= b.resetAt) rateBuckets.delete(key);
    }
  }
  next();
}

// ---------- Error helpers ----------
function isTimeoutError(err) {
  return err?.name === "TimeoutError" || err?.name === "AbortError" || /timeout|timed out/i.test(String(err?.message));
}

// ---------- Routes ----------
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "airsense-ai", timestamp: new Date().toISOString() }));

app.get("/api/air-quality", async (req, res) => {
  const coords = validateCoordinates(req.query.lat, req.query.lon);
  if (!coords) {
    return res.status(400).json({ error: "Valid latitude and longitude are required." });
  }
  try {
    const data = await fetchTrustedEnvironmentalData(coords.latitude, coords.longitude);
    res.json(data);
  } catch (error) {
    const code = isTimeoutError(error) ? 504 : 502;
    res.status(code).json({ error: "Live environmental data is temporarily unavailable." });
  }
});

app.post("/api/assistant", assistantRateLimiter, async (req, res) => {
  const parsed = validateAssistantInput(req.body);
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }
  const { question, profile, latitude, longitude } = parsed.value;

  // Server-side fetch only. Client-supplied air measurements are ignored entirely.
  let trusted;
  try {
    trusted = await fetchTrustedEnvironmentalData(latitude, longitude);
  } catch (error) {
    const code = isTimeoutError(error) ? 504 : 502;
    return res.status(code).json({
      error: "Trusted environmental data is temporarily unavailable. Please try again shortly.",
    });
  }

  const context = buildRecommendationContext(trusted, profile, question);
  const decision = buildExposureDecision(trusted, profile);
  const result = await askGemini(question, context, trusted, decision);
  return res.json({
    answer: result.answer,
    mode: result.mode,
    decision,
    ...(result.structured ? { structured: result.structured } : {}),
    ...(result.note ? { note: result.note } : {}),
    context,
  });
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

export { app, validateAssistantInput, fetchTrustedEnvironmentalData, rateBuckets, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS };

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, "0.0.0.0", () => console.log(`AirSense AI listening on ${PORT}`));
}
