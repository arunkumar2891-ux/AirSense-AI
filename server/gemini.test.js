import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";

let mockBehavior = { type: "success" };
let mockCalls = [];
let lastPrompt = "";
let lastGenerateArgs = null;

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
    lastGenerateArgs = args;
    lastPrompt = JSON.stringify(args);
    const b = mockBehavior.type;
    if (b === "success" || (b === "failThenSuccess" && mockCalls.length > 1)) {
      return { text: JSON.stringify(mockBehavior.body ?? { ...VALID_STRUCTURED, claimIds: ["us_aqi"] }) };
    }
    if (b === "invalid") return { text: "not json at all" };
    if (b === "contradiction") return { text: JSON.stringify({ ...VALID_STRUCTURED, recommendation: "suitable", summary: "Conditions are safe and favorable for a run." }) };
    if (b === "semanticContradiction") return { text: JSON.stringify({ ...VALID_STRUCTURED, recommendation: "suitable", summary: "Nothing in these conditions should alter the planned outing." }) };
    if (b === "invalidRecommendation") return { text: JSON.stringify({ ...VALID_STRUCTURED, recommendation: "go_ahead" }) };
    if (b === "timeout") { const e = new Error("Request timed out"); e.name = "TimeoutError"; throw e; }
    if (b === "hang") return new Promise(() => {});
    if (b === "timeoutOnRetry") {
      if (mockCalls.length === 1) { const e = new Error("503 Service Unavailable"); e.status = 503; throw e; }
      return new Promise(() => {});
    }
    if (b === "alwaysTransient") { const e = new Error("503 Service Unavailable"); e.status = 503; throw e; }
    if (b === "rateLimit") { const e = new Error("429 Too Many Requests"); e.status = 429; throw e; }
    if (b === "failThenSuccess") { const e = new Error("503 Service Unavailable"); e.status = 503; throw e; }
    throw new Error("unknown mock");
  }
}

const { askGemini, AI_CONFIG, _setClientFactory } = await import("./gemini.js");
const { buildExposureDecision, buildExplanationClaims, buildRecommendationContext, buildDeterministicAnswer } = await import("./logic.js");

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
const profile = { activity: "running", ageGroup: "adult", sensitivity: "general" };

function armValidClaims(air = trusted, selectedProfile = profile, now) {
  const decision = buildExposureDecision(air, selectedProfile, now);
  const claims = buildExplanationClaims(air, decision);
  const deterministicContext = buildRecommendationContext(air, selectedProfile, "Can I run?", decision);
  mockBehavior.body = {
    recommendation: decision.activityRecommendation,
    claimIds: claims.map((claim) => claim.id),
  };
  return { decision, claims, context: deterministicContext, air };
}

test.beforeEach(() => {
  mockCalls = [];
  lastGenerateArgs = null;
  mockBehavior = { type: "success" };
  AI_CONFIG.apiKey = "test-key-SECRET-12345";
  AI_CONFIG.timeoutMs = 18000;
  AI_CONFIG.maxRetries = 2;
  AI_CONFIG.sleep = () => Promise.resolve();
});

test("valid claim IDs and the matching recommendation are assembled from server text", async () => {
  const now = Date.parse("2026-11-25T15:10:00.000Z");
  const air = {
    ...trusted,
    observedAt: "2026-11-25T15:00:00.000Z",
    forecastValidAt: "2026-11-25T15:00:00.000Z",
    retrievedAt: "2026-11-25T15:05:00.000Z",
    weatherRetrievedAt: "2026-11-25T15:06:00.000Z",
    weather: { wind_speed_10m: 4.9 },
    metadata: { isModelledEstimate: true, dataClass: "modelled_estimate" },
  };
  const { decision, claims, context: deterministicContext } = armValidClaims(air, profile, now);
  const selected = ["wind_adjustment", "us_aqi"];
  mockBehavior.body = { recommendation: decision.activityRecommendation, claimIds: selected };
  const result = await askGemini("Can I run?", deterministicContext, air, decision);
  const text = new Map(claims.map((claim) => [claim.id, claim.text]));
  assert.equal(result.mode, "ai");
  assert.deepEqual(result.structured, { recommendation: decision.activityRecommendation, claimIds: selected });
  assert.equal(result.answer, selected.map((id) => text.get(id)).join(" "));
  assert.equal(text.get("wind_adjustment"), decision.wind.disclosure);
  assert.match(result.answer, /increased the exposure score by 0\.5 points/);
  assert.doesNotMatch(result.answer, /AI explanation|summary|favorable wind/i);
  assert.equal(deterministicContext.answer, buildDeterministicAnswer(air, decision));
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

test("passes the remaining AI_TIMEOUT_MS budget to SDK httpOptions.timeout", async () => {
  AI_CONFIG.timeoutMs = 1000;
  await askGemini("Can I run?", context, trusted);
  assert.ok(lastGenerateArgs.config.httpOptions.timeout > 0);
  assert.ok(lastGenerateArgs.config.httpOptions.timeout <= 1000);
  assert.ok(lastGenerateArgs.config.abortSignal instanceof AbortSignal);
});

test("a hanging SDK request is bounded by the configured timeout", async () => {
  AI_CONFIG.timeoutMs = 40;
  AI_CONFIG.maxRetries = 0;
  mockBehavior = { type: "hang" };
  const started = Date.now();
  const result = await askGemini("Can I run?", context, trusted);
  const elapsed = Date.now() - started;
  assert.equal(result.mode, "rules-fallback");
  assert.equal(result.answer, context.answer);
  assert.ok(elapsed >= 25 && elapsed < 500, `elapsed ${elapsed}ms`);
  assert.ok(lastGenerateArgs.config.httpOptions.timeout > 0 && lastGenerateArgs.config.httpOptions.timeout <= 40);
  assert.equal(lastGenerateArgs.config.abortSignal.aborted, true);
});

test("timeout preserves the complete deterministic exposure decision", async () => {
  AI_CONFIG.timeoutMs = 30;
  AI_CONFIG.maxRetries = 0;
  mockBehavior = { type: "hang" };
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
  assert.deepEqual(result.decision, decision);
  assert.doesNotMatch(result.note, /timeout|provider error|deadline/i);
});

test("timeout during a retry stops further attempts and falls back", async () => {
  AI_CONFIG.timeoutMs = 50;
  AI_CONFIG.maxRetries = 3;
  mockBehavior = { type: "timeoutOnRetry" };
  const result = await askGemini("Can I run?", context, trusted);
  assert.equal(mockCalls.length, 2);
  assert.equal(result.mode, "rules-fallback");
  assert.equal(result.answer, context.answer);
});

test("overall deadline bounds multiple retries and backoff", async () => {
  AI_CONFIG.timeoutMs = 70;
  AI_CONFIG.maxRetries = 3;
  AI_CONFIG.sleep = () => new Promise((resolve) => setTimeout(resolve, 25));
  mockBehavior = { type: "alwaysTransient" };
  const started = Date.now();
  const result = await askGemini("Can I run?", context, trusted);
  const elapsed = Date.now() - started;
  assert.equal(result.mode, "rules-fallback");
  assert.ok(mockCalls.length >= 2 && mockCalls.length < 4, `attempts ${mockCalls.length}`);
  assert.ok(elapsed >= 50 && elapsed < 500, `elapsed ${elapsed}ms`);
});

test("timeout logs contain no API key, coordinates, or provider error details", async () => {
  AI_CONFIG.timeoutMs = 30;
  AI_CONFIG.maxRetries = 0;
  mockBehavior = { type: "hang" };
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await askGemini("Can I run?", context, trusted);
  } finally {
    console.log = origLog;
  }
  const output = logs.join("\n");
  assert.ok(!output.includes(AI_CONFIG.apiKey));
  assert.ok(!output.includes("17.385"));
  assert.ok(!output.includes("78.4867"));
  assert.ok(!output.includes("exceeded its configured deadline"));
  assert.match(output, /TimeoutError/);
});

test("429 rate limit is retried then falls back", async () => {
  mockBehavior = { type: "rateLimit" };
  const result = await askGemini("Can I run?", context, trusted);
  assert.equal(result.mode, "rules-fallback");
  assert.equal(mockCalls.length, 1 + AI_CONFIG.maxRetries);
});

test("transient 503 succeeds on retry", async () => {
  const { decision, context: deterministicContext, air } = armValidClaims();
  mockBehavior.type = "failThenSuccess";
  const result = await askGemini("Can I run?", deterministicContext, air, decision);
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

test("Gemini receives weather provenance and is told not to override the decision", async () => {
  const air = {
    ...trusted,
    weather: { wind_speed_10m: 4.9 },
    observedAt: "2026-11-25T21:00:00.000Z",
    forecastValidAt: "2026-11-25T20:45:00.000Z",
    retrievedAt: "2026-11-25T20:58:00.000Z",
    weatherRetrievedAt: "2026-11-25T17:00:00.000Z",
    metadata: { isModelledEstimate: true },
  };
  const decision = buildExposureDecision(air, { activity: "running", ageGroup: "adult", sensitivity: "general" }, Date.parse("2026-11-25T21:00:00.000Z"));
  assert.equal(decision.wind.state, "excluded_stale");
  await askGemini("Can I run?", context, air, decision);
  assert.match(lastPrompt, /2026-11-25T17:00:00.000Z/);
  assert.match(lastPrompt, /2026-11-25T20:58:00.000Z/);
  assert.ok(lastPrompt.indexOf("2026-11-25T20:58:00.000Z") < lastPrompt.indexOf("2026-11-25T17:00:00.000Z"));
  assert.match(lastPrompt, /excluded_stale/);
  assert.match(lastPrompt, /Wind of 4\.9 km\/h was excluded from scoring because the weather data is too old/);
  assert.match(lastPrompt, /eligibleForScoring\\":false/);
  assert.doesNotMatch(lastPrompt, /wind_speed_10m|windSpeedKmh|observedAt|"observed"/);
  assert.match(lastPrompt, /forecastValidTime/);
  assert.match(lastPrompt, /retrievalTimestamp/);
  assert.match(lastPrompt, /modelled_estimate/);
  assert.match(lastPrompt, /Do not treat excluded wind as a current measurement/);
  assert.match(lastPrompt, /Do not describe stale, missing, or unknown weather as current/);
  assert.match(lastPrompt, /Do not override the deterministic exposure decision/);
  assert.match(lastPrompt, /insufficient_data decision is not a favorable activity recommendation/);
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

const NOW = Date.parse("2026-11-25T21:00:00.000Z");

function modelledAir(overrides = {}) {
  return {
    aqi: 41,
    aqiScale: "US AQI",
    pollutants: { pm25: 13 },
    weather: { wind_speed_10m: 4.9 },
    forecastValidAt: "2026-11-25T20:45:00.000Z",
    retrievedAt: "2026-11-25T20:58:00.000Z",
    weatherRetrievedAt: "2026-11-25T20:58:00.000Z",
    metadata: { isModelledEstimate: true, dataClass: "modelled_estimate" },
    source: "Open-Meteo / CAMS",
    ...overrides,
  };
}

async function expectDiscarded(air, body, phrase) {
  const decision = buildExposureDecision(air, profile, NOW);
  const deterministicContext = buildRecommendationContext(air, profile, "Can I run?", decision);
  mockBehavior.body = { recommendation: decision.activityRecommendation, ...body };
  const result = await askGemini("Can I run?", deterministicContext, air, decision);
  assert.equal(result.mode, "rules-fallback");
  assert.equal(result.structured, null);
  assert.equal(result.answer, deterministicContext.answer);
  assert.equal(result.answer, buildDeterministicAnswer(air, decision));
  assert.equal(result.answer.includes(phrase), false);
  assert.match(result.note, /discarded/i);
  return { decision, result };
}

test("correct recommendation plus fabricated wind prose is discarded", async () => {
  const air = modelledAir();
  await expectDiscarded(air, {
    summary: "A favorable breeze makes this an excellent running hour.",
    claimIds: ["wind_adjustment"],
  }, "excellent running hour");
});

test("correct recommendation plus fabricated PM2.5 prose is discarded", async () => {
  const air = modelledAir({ pollutants: { pm25: null } });
  await expectDiscarded(air, {
    airQualityAssessment: "PM2.5 is a healthy 4 µg/m³.",
    claimIds: ["us_aqi"],
  }, "healthy 4");
});

test("correct recommendation plus a favorable stale-weather claim is discarded", async () => {
  const air = modelledAir({ weatherRetrievedAt: "2026-11-25T17:00:00.000Z" });
  const { decision } = await expectDiscarded(air, {
    reasoning: "Weather conditions are suitable right now.",
    claimIds: ["wind_excluded"],
  }, "suitable right now");
  assert.equal(decision.wind.state, "excluded_stale");
  assert.match(decision.wind.disclosure, /excluded from scoring because the weather data is too old/);
});

test("correct recommendation contradicting excluded wind is discarded", async () => {
  const air = modelledAir({ weather: { wind_speed_10m: null }, weatherRetrievedAt: "2026-11-25T20:58:00.000Z" });
  const { decision } = await expectDiscarded(air, {
    summary: "Light wind improved the exposure score.",
    claimIds: ["wind_excluded"],
  }, "improved the exposure score");
  assert.equal(decision.wind.state, "excluded_missing_wind");
  assert.match(decision.wind.disclosure, /was not used/);
});

test("insufficient data plus favorable generated prose is discarded", async () => {
  const air = modelledAir({ retrievedAt: "2026-11-25T16:00:00.000Z" });
  const { decision } = await expectDiscarded(air, {
    summary: "Air quality is Good and safe for a long outdoor run.",
    reasoning: "Conditions are generally satisfactory for outdoor activities.",
    claimIds: ["us_aqi"],
  }, "safe for a long outdoor run");
  assert.equal(decision.activityRecommendation, "insufficient_data");
  const claims = buildExplanationClaims(air, decision);
  assert.equal(claims.some((claim) => claim.id === "activity_recommendation"), false);
  assert.equal(claims.some((claim) => /generally satisfactory|favorable/i.test(claim.text)), false);
  assert.ok(claims.some((claim) => claim.id === "insufficient_data"));
});

test("unknown and duplicate claim IDs fall back to the deterministic answer", async () => {
  const air = modelledAir();
  const decision = buildExposureDecision(air, profile, NOW);
  const deterministicContext = buildRecommendationContext(air, profile, "Can I run?", decision);
  mockBehavior.body = { recommendation: decision.activityRecommendation, claimIds: ["pm25_is_low"] };
  const unknown = await askGemini("Can I run?", deterministicContext, air, decision);
  assert.equal(unknown.answer, deterministicContext.answer);
  assert.equal(unknown.mode, "rules-fallback");

  mockBehavior.body = { recommendation: decision.activityRecommendation, claimIds: ["us_aqi", "us_aqi"] };
  const duplicate = await askGemini("Can I run?", deterministicContext, air, decision);
  assert.equal(duplicate.answer, deterministicContext.answer);
  assert.equal(duplicate.structured, null);

  mockBehavior.body = {
    recommendation: decision.activityRecommendation,
    claimIds: Array.from({ length: 13 }, () => "us_aqi"),
  };
  const tooMany = await askGemini("Can I run?", deterministicContext, air, decision);
  assert.equal(tooMany.answer, deterministicContext.answer);
});

test("missing PM2.5 and wind are omitted from claims and cannot be described as favorable", async () => {
  const air = modelledAir({
    pollutants: {},
    weather: {},
    weatherRetrievedAt: null,
  });
  const decision = buildExposureDecision(air, profile, NOW);
  const claims = buildExplanationClaims(air, decision);
  const ids = claims.map((claim) => claim.id);
  assert.equal(ids.includes("pm25"), false);
  assert.equal(ids.includes("wind_adjustment"), false);
  assert.equal(ids.includes("wind_considered"), false);
  assert.ok(ids.includes("wind_excluded"));
  assert.equal(claims.find((claim) => claim.id === "wind_excluded").text, decision.wind.disclosure);
  assert.equal(claims.some((claim) => /PM2\.5 is low|favorable wind/i.test(claim.text)), false);

  const deterministicContext = buildRecommendationContext(air, profile, "Can I run?", decision);
  mockBehavior.body = { recommendation: decision.activityRecommendation, claimIds: ["pm25"] };
  const rejected = await askGemini("Can I run?", deterministicContext, air, decision);
  assert.equal(rejected.answer, deterministicContext.answer);

  mockBehavior.body = { recommendation: decision.activityRecommendation, claimIds: ["us_aqi", "wind_excluded"] };
  const accepted = await askGemini("Can I run?", deterministicContext, air, decision);
  assert.equal(accepted.mode, "ai");
  assert.equal(accepted.answer.includes("PM2.5"), false);
  assert.match(accepted.answer, /Wind was unavailable and was not used/);
  assert.equal(lastPrompt.includes("windSpeedKmh"), false);
  assert.equal(lastPrompt.includes("wind_speed_10m"), false);
});

test("timeout, malformed JSON, and a conflicting recommendation keep the deterministic answer", async () => {
  const air = modelledAir({ weather: { wind_speed_10m: 12 } });
  const decision = buildExposureDecision(air, profile, NOW);
  const deterministicContext = buildRecommendationContext(air, profile, "Can I run?", decision);
  assert.equal(decision.wind.points, 0);
  assert.equal(decision.wind.state, "included");
  assert.match(decision.wind.disclosure, /no score adjustment was needed/);

  mockBehavior = { type: "timeout" };
  const timedOut = await askGemini("Can I run?", deterministicContext, air, decision);
  assert.equal(timedOut.mode, "rules-fallback");
  assert.equal(timedOut.answer, deterministicContext.answer);

  mockBehavior = { type: "invalid" };
  const malformed = await askGemini("Can I run?", deterministicContext, air, decision);
  assert.equal(malformed.answer, deterministicContext.answer);
  assert.match(malformed.note, /discarded/i);

  mockBehavior = { type: "success", body: { recommendation: "suitable", claimIds: ["activity_recommendation"] } };
  const conflict = await askGemini("Can I run?", deterministicContext, air, decision);
  assert.notEqual(decision.activityRecommendation, "suitable");
  assert.equal(conflict.mode, "rules-fallback");
  assert.equal(conflict.answer, buildDeterministicAnswer(air, decision));
  assert.match(conflict.note, /deterministic exposure recommendation/);
});
