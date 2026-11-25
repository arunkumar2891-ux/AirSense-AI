import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAQIStatus, buildRecommendationContext } from "./logic.js";

dotenv.config();
const app = express();
const PORT = Number(process.env.PORT || 10000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(cors());
app.use(express.json({ limit: "30kb" }));

const cache = new Map();
async function cachedFetch(url, ttlMs = 10 * 60 * 1000) {
  const key = String(url);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < ttlMs) return hit.data;
  const response = await fetch(key, { headers: { "User-Agent": "AirSenseAI/1.0" }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Data provider returned ${response.status}`);
  const data = await response.json();
  cache.set(key, { time: Date.now(), data });
  return data;
}

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "airsense-ai", timestamp: new Date().toISOString() }));

app.get("/api/air-quality", async (req, res) => {
  const latitude = Number(req.query.lat);
  const longitude = Number(req.query.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return res.status(400).json({ error: "Valid latitude and longitude are required." });
  }
  try {
    const params = new URLSearchParams({
      latitude: String(latitude), longitude: String(longitude), timezone: "auto",
      current: "pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,us_aqi,european_aqi",
      hourly: "pm10,pm2_5,us_aqi,european_aqi",
      forecast_days: "2"
    });
    const [air, weather] = await Promise.all([
      cachedFetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`),
      cachedFetch(`https://api.open-meteo.com/v1/forecast?${new URLSearchParams({
        latitude: String(latitude), longitude: String(longitude), timezone: "auto",
        current: "temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code"
      })}`)
    ]);
    const current = air.current || {};
    const aqi = current.us_aqi == null ? NaN : Number(current.us_aqi);
    const status = getAQIStatus(aqi);
    const hours = (air.hourly?.time || []).slice(0, 12).map((time, i) => ({
      time, aqi: air.hourly?.us_aqi?.[i] ?? null,
      pm25: air.hourly?.pm2_5?.[i] ?? null, pm10: air.hourly?.pm10?.[i] ?? null
    }));
    res.json({
      location: { latitude, longitude, timezone: air.timezone || "local" },
      observedAt: current.time || new Date().toISOString(),
      aqi: Number.isFinite(aqi) ? aqi : null,
      aqiScale: "US AQI",
      status, pollutants: {
        pm25: current.pm2_5 ?? null, pm10: current.pm10 ?? null,
        ozone: current.ozone ?? null, nitrogenDioxide: current.nitrogen_dioxide ?? null,
        carbonMonoxide: current.carbon_monoxide ?? null, sulphurDioxide: current.sulphur_dioxide ?? null
      },
      weather: weather.current || {}, hourly: hours,
      source: "Open-Meteo / CAMS",
      attribution: "Air quality estimates are model-based and may differ from local regulatory monitoring stations."
    });
  } catch (error) {
    res.status(502).json({ error: "Live environmental data is temporarily unavailable.", detail: error.message });
  }
});

app.post("/api/assistant", async (req, res) => {
  const { question, profile = {}, air = {} } = req.body || {};
  if (typeof question !== "string" || question.trim().length < 2 || question.length > 1200) {
    return res.status(400).json({ error: "Please enter a question between 2 and 1200 characters." });
  }
  const context = buildRecommendationContext(air, profile, question);
  try {
    const answer = await askAI(question.trim(), context);
    res.json({ answer, mode: process.env.AI_API_KEY ? "ai" : "rules", context });
  } catch (error) {
    res.json({ answer: context.answer, mode: "rules-fallback", note: "AI provider unavailable; using the local safety guidance engine." });
  }
});

async function askAI(question, context) {
  if (!process.env.AI_API_KEY) return context.answer;
  const provider = (process.env.AI_PROVIDER || "groq").toLowerCase();
  const model = process.env.AI_MODEL || (provider === "gemini" ? "gemini-2.0-flash" : "llama-3.3-70b-versatile");
  const system = `You are AirSense AI, a cautious urban air quality assistant. Use ONLY the supplied environmental facts. Never invent readings, forecasts, diagnoses, or medical certainty. Do not claim a route is cleaner without route-specific data. Give concise practical advice, explain uncertainty, and recommend official local guidance for high-risk decisions. Context: ${JSON.stringify(context)}`;
  if (provider === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.AI_API_KEY)}`;
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: question }] }], generationConfig: { temperature: 0.25, maxOutputTokens: 450 } }), signal: AbortSignal.timeout(18000) });
    if (!r.ok) throw new Error(`Gemini error ${r.status}`);
    const data = await r.json();
    return data.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || context.answer;
  }
  if (provider === "groq") {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_API_KEY}` }, body: JSON.stringify({ model, temperature: 0.25, max_tokens: 450, messages: [{ role: "system", content: system }, { role: "user", content: question }] }), signal: AbortSignal.timeout(18000) });
    if (!r.ok) throw new Error(`Groq error ${r.status}`);
    const data = await r.json();
    return data.choices?.[0]?.message?.content || context.answer;
  }
  throw new Error("Unsupported AI_PROVIDER. Use gemini or groq.");
}

app.use(express.static(path.join(__dirname, "../dist")));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "../dist/index.html"));
});
app.listen(PORT, "0.0.0.0", () => console.log(`AirSense AI listening on ${PORT}`));
