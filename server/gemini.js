import { GoogleGenAI } from "@google/genai";
import { buildExplanationClaims, getAQIStatus, getPM25Status } from "./logic.js";

// ---------- Configuration ----------
const configuredTimeoutMs = Number(process.env.AI_TIMEOUT_MS);
export const AI_CONFIG = {
  apiKey: process.env.AI_API_KEY || "",
  sleep: null, // test hook: set to a no-op to skip real backoff delays
  model: process.env.AI_MODEL || "gemini-3.8-flash",
  timeoutMs: Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? Math.max(1000, configuredTimeoutMs)
    : 18000,
  maxRetries: Math.max(0, Math.min(3, Number(process.env.AI_MAX_RETRIES) || 2)),
  maxOutputTokens: Math.max(256, Number(process.env.AI_MAX_OUTPUT_TOKENS) || 1024),
};

let client = null;
let _clientFactory = null;

// Allow tests to inject a fake client factory.
export function _setClientFactory(fn) {
  _clientFactory = fn;
  client = null;
}

function getClient() {
  if (!client) {
    client = _clientFactory ? _clientFactory() : new GoogleGenAI({ apiKey: AI_CONFIG.apiKey });
  }
  return client;
}

// ---------- Structured output schema ----------
const RECOMMENDATIONS = new Set(["suitable", "caution", "avoid", "insufficient_data"]);
const MAX_CLAIM_IDS = 12;
const MAX_CLAIM_ID_LENGTH = 64;
const CLAIM_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const RESPONSE_FIELDS = new Set(["recommendation", "claimIds", "explanation"]);
const MIN_EXPLANATION_LENGTH = 40;
const MAX_EXPLANATION_LENGTH = 900;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    recommendation: {
      type: "STRING",
      enum: ["suitable", "caution", "avoid", "insufficient_data"],
      description: "Must exactly match the authoritative deterministic activityRecommendation.",
    },
    claimIds: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "IDs copied from allowedClaims. These are the only current measurements.",
    },
    explanation: {
      type: "STRING",
      description: "A direct answer to the user's question. Do not invent measurements or number words.",
    },
  },
  required: ["recommendation", "claimIds", "explanation"],
  propertyOrdering: ["recommendation", "claimIds", "explanation"],
};

const NUMBER_WORDS = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b/i;
const ABSOLUTE_CURRENT_CLAIMS = /\b(pristine|pollution-free|no pollution|zero risk|completely safe|perfectly safe|guaranteed safe|medical diagnosis|definitely safe|perfectly clean)\b/i;
const FAVORABLE_ACTIVITY = /\b(safe|suitable|favou?rable|satisfactory|clean|healthy|good to go|fine for|okay to|ok to go|no problem)\b/i;
const CURRENT_WIND_CLAIM = /\b(?:wind|breeze)\b[\s\S]{0,40}\b(?:is|are|was|were)?\s*(?:light|calm|strong|helping|dispersing|stagnant|fresh|favorable|favourable)\b|\b(?:light|calm|strong|fresh|favorable|favourable)\s+(?:wind|breeze)\b[\s\S]{0,32}\b(?:right now|currently|today|this reading)\b|\b(?:right now|currently|today|this reading|the current)\b[\s\S]{0,40}\b(?:light|calm|strong|fresh|favorable|favourable)\s+(?:wind|breeze)\b/i;
const CATEGORY_LABELS = [
  "unhealthy for sensitive groups",
  "very unhealthy",
  "hazardous",
  "unhealthy",
  "moderate",
  "good",
];
const RECOMMENDATION_WORDS = [
  ["insufficient data", "insufficient_data"],
  ["insufficient_data", "insufficient_data"],
  ["suitable", "suitable"],
  ["caution", "caution"],
  ["avoid", "avoid"],
];

function stripPollutantNames(text) {
  return text.replace(/\bpm\s*2\.5\b/gi, " ").replace(/\bpm\s*10\b/gi, " ");
}

function assertedCategories(text) {
  let rest = text.toLowerCase();
  const found = [];
  for (const label of CATEGORY_LABELS) {
    const re = new RegExp(`(?:category is|aqi is|air quality is|air is|conditions are|pollution is|reading is|classified as)\\s+${label}\\b`, "i");
    if (re.test(rest)) found.push(label);
    rest = rest.replaceAll(label, " ");
  }
  return found;
}

function assertedRecommendations(text) {
  const found = [];
  const lower = text.toLowerCase();
  for (const [phrase, value] of RECOMMENDATION_WORDS) {
    const re = new RegExp(`(?:recommendation is|result is|decision is|would be)\\s+${phrase}\\b`, "i");
    if (re.test(lower)) found.push(value);
  }
  return found;
}

function allowedCategoryLabels(air) {
  const labels = new Set();
  const aqi = validReading(air?.aqi);
  if (aqi !== null) labels.add(getAQIStatus(aqi).label.toLowerCase());
  const pm = validReading(air?.pollutants?.pm25);
  if (pm !== null) labels.add(getPM25Status(pm).label.toLowerCase());
  return labels;
}

export function validateExplanation(explanation, { air, decision, hypothetical } = {}) {
  if (typeof explanation !== "string") return "Explanation is missing.";
  const text = explanation.trim();
  if (text.length < MIN_EXPLANATION_LENGTH || text.length > MAX_EXPLANATION_LENGTH) return "Explanation length is outside the allowed range.";
  if (/\d/.test(stripPollutantNames(text))) return "Explanation contains a measurement.";
  if (NUMBER_WORDS.test(text)) return "Explanation contains a number word.";
  if (ABSOLUTE_CURRENT_CLAIMS.test(text)) return "Explanation makes an unsupported claim about current conditions.";
  const allowedCategories = allowedCategoryLabels(air);
  for (const label of assertedCategories(text)) {
    if (!allowedCategories.has(label)) return "Explanation names a category that does not match the trusted reading.";
  }
  const recommendation = decision?.activityRecommendation;
  const allowedRecommendations = new Set([recommendation]);
  if (hypothetical?.activityRecommendation) allowedRecommendations.add(hypothetical.activityRecommendation);
  for (const word of assertedRecommendations(text)) {
    if (!allowedRecommendations.has(word)) return "Explanation states a recommendation that does not match the deterministic decision.";
  }
  if (recommendation === "insufficient_data" && FAVORABLE_ACTIVITY.test(text)) {
    return "Explanation gives a favorable activity recommendation without usable current data.";
  }
  const windState = decision?.wind?.state || "";
  if (String(windState).startsWith("excluded") && CURRENT_WIND_CLAIM.test(text)) {
    return "Explanation treats excluded wind as a current condition.";
  }
  if (hypothetical) {
    if (!/\bhypothetical\b/i.test(text)) return "Explanation does not label the wind scenario as hypothetical.";
    if (/\b(retrieved|measured|observed)\b/i.test(text) && /\bwind\b/i.test(text) && !/\bnot (?:a |an )?(?:retrieved|measured|observed)\b/i.test(text)) {
      return "Explanation presents the hypothetical wind as a retrieved measurement.";
    }
  } else if (/\bwould be (suitable|caution|avoid|insufficient)\b/i.test(text)) {
    return "Explanation invents a hypothetical recommendation.";
  }
  return null;
}

function finiteTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function validReading(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function windForPrompt(decision) {
  const wind = decision?.wind;
  if (!wind || typeof wind !== "object") return null;
  const excluded = wind.state === "excluded_stale"
    || wind.state === "excluded_retrieval_time"
    || wind.state === "excluded_missing_wind";
  const assessment = {
    state: wind.state ?? null,
    eligibleForScoring: wind.state === "included" || wind.state === "included_aging",
    points: wind.points ?? 0,
    disclosure: wind.disclosure ?? null,
    freshness: wind.freshness ? {
      basis: wind.freshness.basis ?? "weatherRetrievedAt",
      state: wind.freshness.state ?? null,
      retrievalTimestamp: wind.freshness.timestamp ?? null,
      ageMs: wind.freshness.ageMs ?? null,
    } : null,
  };
  if (!excluded && Number.isFinite(wind.windSpeedKmh)) assessment.windSpeedKmh = wind.windSpeedKmh;
  return assessment;
}

// ---------- Safety system prompt ----------
function buildSystemPrompt(context, decision, claims) {
  const lines = [
    "You are AirSense AI, a cautious urban air-quality assistant.",
    "Air-quality values supplied here are modelled estimates, not station observations.",
    "You select claim IDs and write an explanation that answers the user's question.",
    "Return JSON with recommendation, claimIds, and explanation only.",
    "recommendation must equal activityRecommendation exactly.",
    "Every claimIds entry must be copied from allowedClaims. Do not invent IDs.",
    "explanation answers the question in plain language.",
    "Do not put digits or number words in explanation. Current measurements belong only in claimIds.",
    "You may name the supplied category and activityRecommendation, but you may not name a different one.",
    "A hypothetical wind scenario, when supplied, must be called hypothetical and is not a retrieved measurement.",
    "Do not invent an alternate recommendation.",
    "Do not treat excluded wind as a current measurement.",
    "Do not describe stale, missing, or unknown weather as current.",
    "Do not override the deterministic exposure decision.",
    "An insufficient_data decision is not a favorable activity recommendation.",
    "Do not make medical diagnoses or claims of medical certainty.",
    "Never confuse US AQI with European AQI.",
  ];
  if (decision) {
    lines.push(`activityRecommendation: ${decision.activityRecommendation}`);
    lines.push(`Allowed claim IDs: ${claims.map((claim) => claim.id).join(", ") || "(none)"}`);
  }
  lines.push(`Activity profile: activity=${context.activity}, ageGroup=${context.ageGroup}, sensitivity=${context.sensitivity}.`);
  return lines.join("\n");
}

function buildUserPrompt(question, context, trusted, decision, claims, hypothetical) {
  const meta = trusted.metadata || {};
  const modelInitializationTime = finiteTimestamp(
    trusted.modelInitializedAt ?? meta.timestamps?.modelInitializedAt ?? null,
  );
  const aqi = validReading(trusted.aqi);
  return JSON.stringify({
    question,
    classification: meta.dataClass || "modelled_estimate",
    airQuality: {
      scale: trusted.aqiScale || "US AQI",
      value: aqi,
      category: aqi === null ? null : context.category,
      retrievalTimestamp: finiteTimestamp(trusted.retrievedAt ?? meta.timestamps?.retrievedAt ?? null),
      forecastValidTime: finiteTimestamp(trusted.forecastValidAt ?? null),
      modelInitializationTime,
    },
    pollutants: {
      pm25: validReading(trusted.pollutants?.pm25),
    },
    weather: {
      retrievalTimestamp: finiteTimestamp(trusted.weatherRetrievedAt ?? null),
      freshness: decision?.wind?.freshness?.state ?? null,
      wind: windForPrompt(decision),
    },
    ...(meta.spatialResolution?.verified ? {
      modelName: meta.model?.name ?? null,
      nominalResolution: meta.spatialResolution.label ?? null,
    } : {}),
    source: trusted.source ?? null,
    allowedClaims: claims.map((claim) => ({ id: claim.id, text: claim.text })),
    profile: { activity: context.activity, ageGroup: context.ageGroup, sensitivity: context.sensitivity },
    ...(hypothetical ? { hypothetical } : {}),
  });
}

// ---------- Response parsing & validation ----------
function claimError(message) {
  const error = new Error(message);
  error.name = "ClaimValidation";
  return error;
}

function mismatchError() {
  const error = new Error("Recommendation mismatch");
  error.name = "RecommendationMismatch";
  return error;
}

function parseStructuredResponse(text, decision, claims, air, hypothetical) {
  if (!text || typeof text !== "string") throw claimError("Empty model response");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw claimError("Model returned non-JSON output");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw claimError("Model response is not an object");
  }
  if (Object.keys(parsed).some((key) => !RESPONSE_FIELDS.has(key))) {
    throw claimError("Model response contains unpublished text");
  }
  if (!RECOMMENDATIONS.has(parsed.recommendation)) {
    throw claimError("Model response has invalid recommendation");
  }
  if (!decision || parsed.recommendation !== decision.activityRecommendation) {
    throw mismatchError();
  }
  if (!Array.isArray(parsed.claimIds) || parsed.claimIds.length < 1 || parsed.claimIds.length > MAX_CLAIM_IDS) {
    throw claimError("Model response has an invalid number of claim IDs");
  }
  const seen = new Set();
  const allowed = new Set(claims.map((claim) => claim.id));
  for (const id of parsed.claimIds) {
    if (typeof id !== "string" || id.length > MAX_CLAIM_ID_LENGTH || !CLAIM_ID_PATTERN.test(id)) {
      throw claimError("Model response has an invalid claim ID");
    }
    if (seen.has(id)) throw claimError("Model response repeats a claim ID");
    seen.add(id);
    if (!allowed.has(id)) throw claimError("Model response cites an unknown claim ID");
  }
  const explanationError = validateExplanation(parsed.explanation, { air, decision, hypothetical });
  if (explanationError) throw claimError(explanationError);
  return { recommendation: parsed.recommendation, claimIds: [...parsed.claimIds], explanation: parsed.explanation.trim() };
}

// ---------- Retry with exponential backoff + jitter ----------
const TRANSIENT_STATUS = new Set([429, 500, 503]);

function isTransient(err) {
  const msg = String(err?.message || err);
  const status = err?.status ?? err?.httpStatus ?? (msg.match(/\b(429|500|503)\b/)?.[1]);
  if (TRANSIENT_STATUS.has(Number(status))) return true;
  if (/timeout|timed out|quota|rate.?limit|resource.?exhausted|unavailable|internal/i.test(msg)) return true;
  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function timeoutError() {
  const error = new Error("Gemini operation exceeded its configured deadline");
  error.name = "TimeoutError";
  return error;
}

function runWithDeadline(operation, remainingMs, onTimeout) {
  if (remainingMs <= 0) return Promise.reject(timeoutError());
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout?.();
      reject(timeoutError());
    }, remainingMs);

    Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}

// ---------- Logging (never keys, never personal data) ----------
function logAI(event) {
  const { model, latencyMs, success, mode, attempt, errorType } = event;
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    service: "airsense-ai",
    component: "gemini",
    model,
    latencyMs,
    success,
    mode,
    attempt,
    ...(errorType ? { errorType } : {}),
  }));
}

// ---------- Public API ----------
export async function askGemini(question, context, trusted, decision = null, options = {}) {
  const hypothetical = options.hypothetical ?? null;
  if (!AI_CONFIG.apiKey) {
    return { answer: context.answer, evidence: [], mode: "rules", structured: null, decision, hypothetical };
  }

  const claims = buildExplanationClaims(trusted, decision);
  const system = buildSystemPrompt(context, decision, claims);
  const userPrompt = buildUserPrompt(question, context, trusted, decision, claims, hypothetical);
  const ai = getClient();
  const deadlineAt = Date.now() + AI_CONFIG.timeoutMs;

  let finalAttempt = 0;
  for (let attempt = 0; attempt <= AI_CONFIG.maxRetries; attempt++) {
    finalAttempt = attempt;
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) break;
    const start = Date.now();
    const controller = new AbortController();
    try {
      const response = await runWithDeadline(
        () => ai.models.generateContent({
          model: AI_CONFIG.model,
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          config: {
            systemInstruction: system,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            temperature: 0.25,
            maxOutputTokens: AI_CONFIG.maxOutputTokens,
            httpOptions: { timeout: remainingMs },
            abortSignal: controller.signal,
          },
        }),
        remainingMs,
        () => controller.abort(),
      );
      const latencyMs = Date.now() - start;
      const text = response?.text;
      let structured;
      try {
        structured = parseStructuredResponse(text, decision, claims, trusted, hypothetical);
      } catch (err) {
        const mismatch = err?.name === "RecommendationMismatch";
        logAI({
          model: AI_CONFIG.model,
          latencyMs,
          success: false,
          mode: mismatch ? "rules-safety-fallback" : "rules-fallback",
          attempt,
          errorType: err?.name || "ClaimValidation",
        });
        return {
          answer: context.answer,
          evidence: [],
          mode: "rules-fallback",
          structured: null,
          decision,
          hypothetical,
          note: mismatch
            ? "AI explanation discarded because it did not match the deterministic exposure recommendation."
            : "AI explanation discarded because it could not be validated.",
        };
      }
      logAI({ model: AI_CONFIG.model, latencyMs, success: true, mode: "ai", attempt });
      return {
        answer: structured.explanation,
        evidence: structured.claimIds.map((id) => claims.find((claim) => claim.id === id)?.text).filter(Boolean),
        mode: "ai",
        structured,
        decision,
        hypothetical,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const errorType = err?.name || "Error";
      logAI({ model: AI_CONFIG.model, latencyMs, success: false, mode: "ai", attempt, errorType });
      if (attempt < AI_CONFIG.maxRetries && isTransient(err)) {
        const remainingAfterAttempt = deadlineAt - Date.now();
        if (remainingAfterAttempt <= 0) break;
        const baseDelay = 500 * 2 ** attempt;
        const jitter = Math.random() * baseDelay;
        try {
          await runWithDeadline(
            () => (AI_CONFIG.sleep || sleep)(baseDelay + jitter),
            remainingAfterAttempt,
          );
        } catch {
          break;
        }
        continue;
      }
      break;
    }
  }

  // Deterministic fallback
  logAI({ model: AI_CONFIG.model, latencyMs: 0, success: false, mode: "rules-fallback", attempt: finalAttempt });
  return {
    answer: context.answer,
    evidence: [],
    mode: "rules-fallback",
    structured: null,
    decision,
    hypothetical,
    note: "AI provider unavailable; using the local safety guidance engine.",
  };
}
