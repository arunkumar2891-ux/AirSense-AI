import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";

let mockBehavior = { type: "success" };
let mockCalls = [];
let lastPrompt = "";

const VALID_STRUCTURED = {
  summary: "US AQI is 172 (Unhealthy for sensitive groups).",
  airQualityAssessment: "PM2.5 is 55.4 µg/m³, elevated.",
  recommendation: "avoid",
  reasoning: "AQI 172 exceeds the moderate band.",
  confidence: "medium — modelled data only.",
  dataLimitations: "Model estimate, not a regulatory station reading.",
};

class FakeModels {
  async generateContent(args) {
    mockCalls.push(1);
    lastPrompt = JSON.stringify(args);
    const b = mockBehavior.type;
    if (b === "success" || (b === "failThenSuccess" && mockCalls.length > 1)) {
      return { text: JSON.stringify(VALID_STRUCTURED) };
    }
    if (b === "invalid") return { text: "not json at all" };
    if (b === "contradiction") return { text: JSON.stringify({ ...VALID_STRUCTURED, recommendation: "suitable", summary: "Conditions are safe and favorable for a run." }) };
    if (b === "semanticContradiction") return { text: JSON.stringify({ ...VALID_STRUCTURED, recommendation: "suitable", summary: "Nothing in these conditions should alter the planned outing." }) };
    if (b === "invalidRecommendation") return { text: JSON.stringify({ ...VALID_STRUCTURED, recommendation: "go_ahead" }) };
    if (b === "timeout") { const e = new Error("Request timed out"); e.name = "TimeoutError"; throw e; }
    if (b === "rateLimit") { const e = new Error("429 Too Many Requests"); e.status = 429; throw e; }
    if (b === "failThenSuccess") { const e = new Error("503 Service Unavailable"); e.status = 503; throw e; }
    throw new Error("unknown mock");
  }
}

const { askGemini, AI_CONFIG, _setClientFactory } = await import("./gemini.js");
const { buildExposureDecision, buildRecommendationContext } = await import("./logic.js");

// Inject fake client, disable real sleep delays, and set a test API key.
_setClientFactory(() => ({ models: new FakeModels() }));
AI_CONFIG.sleep = () => Promise.resolve();
AI_CONFIG.apiKey = "test-key-SECRET-12345";

const trusted = {
  aqi: 172, aqiScale: "US AQI",
  location: { latitude: 17.385, longitude: 78.4867, timezone: "Asia/Kolkata" },
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
  assert.match(result.answer, /AI explanation:/);
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

test("no-key fallback answer communicates the same recommendation as the decision", async () => {
  AI_CONFIG.apiKey = "";
  const air = { ...trusted, observedAt: new Date().toISOString() };
  const profile = { activity: "running", ageGroup: "adult", sensitivity: "general" };
  const decision = buildExposureDecision(air, profile);
  const deterministicContext = buildRecommendationContext(air, profile, "Can I run?", decision);
  const result = await askGemini("Can I run?", deterministicContext, air, decision);
  assert.equal(result.mode, "rules");
  assert.equal(result.decision.activityRecommendation, decision.activityRecommendation);
  assert.match(result.answer, new RegExp(`recommendation: ${decision.activityRecommendation.replace("_", " ")}`, "i"));
  assert.match(result.answer, /not medical advice/i);
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

test("Gemini prompt never contains precise coordinates", async () => {
  mockBehavior = { type: "success" };
  await askGemini("Can I run?", context, trusted);
  assert.ok(!lastPrompt.includes("78.4867"), "longitude must not reach Gemini");
  assert.ok(!lastPrompt.includes("17.385"), "latitude must not reach Gemini");
  assert.ok(!lastPrompt.includes("longitude"), "no location keys in prompt");
  assert.ok(!lastPrompt.includes("latitude"), "no location keys in prompt");
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
  // AI enum said "suitable" but rules say "avoid" → response discarded.
  assert.equal(result.structured, null);
  assert.equal(result.mode, "rules-fallback");
  assert.equal(result.answer, context.answer);
  assert.match(result.note, /discarded/i);
  assert.deepEqual(result.decision, decision);
});

test("semantic contradiction without obvious keywords is discarded by enum mismatch", async () => {
  mockBehavior = { type: "semanticContradiction" };
  const decision = {
    overallRisk: "very_high", activityRecommendation: "avoid",
    recommendedAction: "Avoid outdoor running.",
    reasoning: "US AQI is unhealthy.",
    sensitiveGroupAdvice: "Follow official guidance.", alternativeActivity: "Indoor exercise.",
    dataFreshness: { state: "fresh", ageMs: 1000, label: "fresh" },
    limitations: "Modelled data; not medical advice.",
  };
  const result = await askGemini("Can I run?", context, trusted, decision);
  assert.equal(result.mode, "rules-fallback");
  assert.equal(result.answer, context.answer);
  assert.equal(result.structured, null);
});

test("invalid recommendation enum is rejected as malformed", async () => {
  mockBehavior = { type: "invalidRecommendation" };
  const result = await askGemini("Can I run?", context, trusted);
  assert.equal(result.mode, "rules-fallback");
  assert.equal(result.answer, context.answer);
});
