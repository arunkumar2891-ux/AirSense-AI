import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";

let mockBehavior = { type: "success" };
let mockCalls = [];

const VALID_STRUCTURED = {
  summary: "US AQI is 172 (Unhealthy for sensitive groups).",
  airQualityAssessment: "PM2.5 is 55.4 µg/m³, elevated.",
  recommendedAction: "Reduce prolonged outdoor exertion.",
  reasoning: "AQI 172 exceeds the moderate band.",
  activityAdvice: "Consider indoor training instead.",
  precautions: "Sensitive groups should avoid outdoor exertion.",
  confidence: "medium — modelled data only.",
  dataLimitations: "Model estimate, not a regulatory station reading.",
};

class FakeModels {
  async generateContent() {
    mockCalls.push(1);
    const b = mockBehavior.type;
    if (b === "success" || (b === "failThenSuccess" && mockCalls.length > 1)) {
      return { text: JSON.stringify(VALID_STRUCTURED) };
    }
    if (b === "invalid") return { text: "not json at all" };
    if (b === "contradiction") return { text: JSON.stringify({ ...VALID_STRUCTURED, recommendedAction: "Conditions are safe and favorable for a run.", activityAdvice: "Enjoy your outdoor run." }) };
    if (b === "timeout") { const e = new Error("Request timed out"); e.name = "TimeoutError"; throw e; }
    if (b === "rateLimit") { const e = new Error("429 Too Many Requests"); e.status = 429; throw e; }
    if (b === "failThenSuccess") { const e = new Error("503 Service Unavailable"); e.status = 503; throw e; }
    throw new Error("unknown mock");
  }
}

const { askGemini, AI_CONFIG, _setClientFactory } = await import("./gemini.js");

// Inject fake client, disable real sleep delays, and set a test API key.
_setClientFactory(() => ({ models: new FakeModels() }));
AI_CONFIG.sleep = () => Promise.resolve();
AI_CONFIG.apiKey = "test-key-SECRET-12345";

const trusted = {
  aqi: 172, aqiScale: "US AQI",
  pollutants: { pm25: 55.4, pm10: 88.1, ozone: 40.2, nitrogenDioxide: 21, carbonMonoxide: 300, sulphurDioxide: 5.1 },
  weather: { temperature_2m: 28 }, observedAt: "2026-11-25T15:00", source: "Open-Meteo / CAMS",
};
const context = {
  aqi: 172, category: "Unhealthy for sensitive groups",
  activity: "running", ageGroup: "adult", sensitivity: "general",
  answer: "Deterministic baseline: AQI 172, reduce outdoor exertion.",
};

test.beforeEach(() => {
  mockCalls = [];
  mockBehavior = { type: "success" };
});

test("valid structured response is parsed and formatted", async () => {
  const result = await askGemini("Can I run?", context, trusted);
  assert.equal(result.mode, "ai");
  assert.ok(result.structured);
  assert.equal(result.structured.summary, VALID_STRUCTURED.summary);
  assert.match(result.answer, /172/);
  assert.match(result.answer, /Recommended:/);
});

test("invalid model response falls back to deterministic", async () => {
  mockBehavior = { type: "invalid" };
  const result = await askGemini("Can I run?", context, trusted);
  assert.equal(result.mode, "rules-fallback");
  assert.equal(result.answer, context.answer);
});

test("gemini timeout falls back to deterministic", async () => {
  mockBehavior = { type: "timeout" };
  const result = await askGemini("Can I run?", context, trusted);
  assert.equal(result.mode, "rules-fallback");
  assert.equal(result.answer, context.answer);
});

test("429 rate limit is retried then falls back", async () => {
  mockBehavior = { type: "rateLimit" };
  const result = await askGemini("Can I run?", context, trusted);
  assert.equal(result.mode, "rules-fallback");
  assert.equal(mockCalls.length, 1 + AI_CONFIG.maxRetries);
});

test("transient 503 succeeds on retry", async () => {
  mockBehavior = { type: "failThenSuccess" };
  const result = await askGemini("Can I run?", context, trusted);
  assert.equal(result.mode, "ai");
  assert.ok(result.structured);
  assert.equal(mockCalls.length, 2);
});

test("no API key returns rules mode without calling Gemini", async () => {
  mockCalls = [];
  AI_CONFIG.apiKey = "";
  const result = await askGemini("Can I run?", context, trusted);
  assert.equal(result.mode, "rules");
  assert.equal(result.answer, context.answer);
  assert.equal(mockCalls.length, 0);
});

test("API key never appears in logs", async () => {
  AI_CONFIG.apiKey = "test-key-SECRET-12345";
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  mockBehavior = { type: "success" };
  await askGemini("Can I run?", context, trusted);
  console.log = origLog;
  assert.ok(!logs.join("\n").includes("test-key-SECRET-12345"), "API key must not appear in logs");
});

test("deterministic fallback preserves baseline guidance text", async () => {
  mockBehavior = { type: "timeout" };
  const result = await askGemini("Can I run?", context, trusted);
  assert.equal(result.answer, context.answer);
  assert.ok(result.note);
  assert.match(result.note, /safety guidance engine/i);
});

test("Gemini contradicting deterministic decision is overridden", async () => {
  mockBehavior = { type: "contradiction" };
  const decision = {
    overallRisk: "high", activityRecommendation: "avoid",
    recommendedAction: "Avoid outdoor running.",
    reasoning: "US AQI 172 is Unhealthy for sensitive groups.",
    sensitiveGroupAdvice: "Avoid.", alternativeActivity: "Indoor gym.",
    dataFreshness: { state: "fresh", ageMs: 300000, label: "fresh" },
    limitations: "Model data.",
  };
  const result = await askGemini("Can I run?", context, trusted, decision);
  // AI said "safe" but rules say "avoid" → contradiction detected, structured nulled
  assert.equal(result.structured, null);
  assert.match(result.answer, /adjusted to align/i);
  assert.deepEqual(result.decision, decision);
});
