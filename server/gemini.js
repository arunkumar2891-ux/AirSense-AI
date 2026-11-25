import { GoogleGenAI } from "@google/genai";

// ---------- Configuration ----------
export const AI_CONFIG = {
  provider: (process.env.AI_PROVIDER || "gemini").toLowerCase(),
  apiKey: process.env.AI_API_KEY || "",
  sleep: null, // test hook: set to a no-op to skip real backoff delays
  model: process.env.AI_MODEL || "gemini-3.8-flash",
  timeoutMs: Math.max(1000, Number(process.env.AI_TIMEOUT_MS) || 18000),
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
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING", description: "One-sentence plain-language summary of current air quality." },
    airQualityAssessment: { type: "STRING", description: "Assessment of the observed AQI and pollutant readings." },
    recommendedAction: { type: "STRING", description: "Primary practical action for the user's profile and question." },
    reasoning: { type: "STRING", description: "Brief reasoning grounded only in the supplied facts." },
    activityAdvice: { type: "STRING", description: "Advice specific to the user's planned activity." },
    precautions: { type: "STRING", description: "Comma-separated or short precautions for sensitive groups." },
    confidence: { type: "STRING", description: "high | medium | low, with a one-clause rationale." },
    dataLimitations: { type: "STRING", description: "Caveats: modelled data, spatial resolution, not a station reading." },
  },
  required: ["summary", "airQualityAssessment", "recommendedAction", "reasoning", "activityAdvice", "precautions", "confidence", "dataLimitations"],
  propertyOrdering: ["summary", "airQualityAssessment", "recommendedAction", "reasoning", "activityAdvice", "precautions", "confidence", "dataLimitations"],
};

// ---------- Safety system prompt ----------
function buildSystemPrompt(context, decision) {
  const { aqi, category, activity, sensitivity, ageGroup, answer } = context;
  const lines = [
    "You are AirSense AI, a cautious urban air-quality assistant.",
    "You MUST ground every statement in the supplied facts only.",
    "Rules you must never break:",
    "- Never fabricate readings or invent forecasts.",
    "- Never confuse US AQI with European AQI; the value supplied is US AQI.",
    "- Never make medical diagnoses or claims of medical certainty.",
    "- Never claim a location or route is safer without supporting measurements.",
    "- Clearly distinguish observed data from modelled forecast.",
    "Deterministic baseline advice (follow it, do not contradict it):",
    answer,
  ];
  if (decision) {
    lines.push(
      "",
      "Deterministic exposure decision (authoritative — explain it, do not contradict it):",
      `  overallRisk: ${decision.overallRisk}`,
      `  activityRecommendation: ${decision.activityRecommendation}`,
      `  recommendedAction: ${decision.recommendedAction}`,
      `  reasoning: ${decision.reasoning}`,
      "Your explanation MUST agree with the activityRecommendation and overallRisk above.",
      "If you find yourself disagreeing, restate the deterministic recommendation instead.",
    );
  }
  lines.push(
    `Supplied facts: US AQI=${aqi} (${category}), activity=${activity}, ageGroup=${ageGroup}, sensitivity=${sensitivity}.`,
    "Return only JSON matching the required schema. Keep each field concise (1–2 sentences).",
  );
  return lines.join("\n");
}

function buildUserPrompt(question, context, trusted) {
  return JSON.stringify({
    question,
    observed: {
      aqi: trusted.aqi,
      aqiScale: trusted.aqiScale,
      category: context.category,
      pollutants: {
        pm25: trusted.pollutants.pm25,
        pm10: trusted.pollutants.pm10,
        ozone: trusted.pollutants.ozone,
        nitrogenDioxide: trusted.pollutants.nitrogenDioxide,
        carbonMonoxide: trusted.pollutants.carbonMonoxide,
        sulphurDioxide: trusted.pollutants.sulphurDioxide,
      },
      weather: trusted.weather,
      observedAt: trusted.observedAt,
      source: trusted.source,
    },
    profile: { activity: context.activity, ageGroup: context.ageGroup, sensitivity: context.sensitivity },
  });
}

// ---------- Response parsing & validation ----------
function parseStructuredResponse(text) {
  if (!text || typeof text !== "string") throw new Error("Empty model response");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Model returned non-JSON output");
  }
  const required = ["summary", "airQualityAssessment", "recommendedAction", "reasoning", "activityAdvice", "precautions", "confidence", "dataLimitations"];
  for (const key of required) {
    if (typeof parsed[key] !== "string" || !parsed[key].trim()) {
      throw new Error(`Model response missing or invalid field: ${key}`);
    }
  }
  return parsed;
}

function formatStructuredAnswer(parsed) {
  return [
    parsed.summary,
    parsed.airQualityAssessment,
    `Recommended: ${parsed.recommendedAction}`,
    parsed.activityAdvice,
    parsed.precautions ? `Precautions: ${parsed.precautions}` : "",
    `Confidence: ${parsed.confidence}. ${parsed.dataLimitations}`,
  ].filter(Boolean).join("\n\n");
}

// ---------- Contradiction detection ----------
const RECOMMENDATION_KEYWORDS = {
  avoid: ["avoid", "do not", "stay indoors", "not recommended", "discourage", "skip", "postpone", "cancel", "indoor"],
  caution: ["caution", "reduce", "limit", "shorten", "lower intensity", "moderate", "careful", "consider indoor"],
  suitable: ["suitable", "safe", "favorable", "ok to", "good to", "enjoy", "proceed"],
};

function contradictsDecision(structured, decision) {
  if (!structured || !decision) return false;
  const detRec = decision.activityRecommendation;
  if (detRec === "insufficient_data") return false; // no contradiction possible

  // Combine the fields where a recommendation would appear
  const text = [structured.recommendedAction, structured.activityAdvice, structured.summary].join(" ").toLowerCase();

  const detKeywords = RECOMMENDATION_KEYWORDS[detRec] || [];
  // Check if the AI text clearly signals a DIFFERENT recommendation category
  for (const [category, keywords] of Object.entries(RECOMMENDATION_KEYWORDS)) {
    if (category === detRec) continue; // same category is fine
    // "suitable" text contradicting "avoid"/"caution" is the dangerous direction
    if (category === "suitable" && (detRec === "avoid" || detRec === "caution")) {
      if (keywords.some((k) => text.includes(k)) && !detKeywords.some((k) => text.includes(k))) {
        return true; // AI says "safe" but rules say avoid/caution and no rule keywords present
      }
    }
    // "avoid" text contradicting "suitable" is less dangerous but still a mismatch
    if (category === "avoid" && detRec === "suitable") {
      if (keywords.some((k) => text.includes(k)) && !RECOMMENDATION_KEYWORDS.suitable.some((k) => text.includes(k))) {
        return true;
      }
    }
  }
  return false;
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
export async function askGemini(question, context, trusted, decision = null) {
  if (!AI_CONFIG.apiKey) {
    return { answer: context.answer, mode: "rules", structured: null, decision };
  }

  const system = buildSystemPrompt(context, decision);
  const userPrompt = buildUserPrompt(question, context, trusted);
  const ai = getClient();

  let lastError;
  for (let attempt = 0; attempt <= AI_CONFIG.maxRetries; attempt++) {
    const start = Date.now();
    try {
      const response = await ai.models.generateContent({
        model: AI_CONFIG.model,
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.25,
          maxOutputTokens: AI_CONFIG.maxOutputTokens,
        },
      });
      const latencyMs = Date.now() - start;
      const text = response?.text;
      const structured = parseStructuredResponse(text);
      // Check for contradiction with deterministic decision
      if (decision && contradictsDecision(structured, decision)) {
        logAI({ model: AI_CONFIG.model, latencyMs, success: true, mode: "ai-overridden", attempt });
        return {
          answer: formatStructuredAnswer(structured) + "\n\nNote: This explanation was adjusted to align with the safety rules engine.",
          mode: "ai",
          structured: null,
          decision,
        };
      }
      logAI({ model: AI_CONFIG.model, latencyMs, success: true, mode: "ai", attempt });
      return { answer: formatStructuredAnswer(structured), mode: "ai", structured, decision };
    } catch (err) {
      const latencyMs = Date.now() - start;
      lastError = err;
      const errorType = err?.name || "Error";
      logAI({ model: AI_CONFIG.model, latencyMs, success: false, mode: "ai", attempt, errorType });
      if (attempt < AI_CONFIG.maxRetries && isTransient(err)) {
        const baseDelay = 500 * 2 ** attempt;
        const jitter = Math.random() * baseDelay;
        await (AI_CONFIG.sleep || sleep)(baseDelay + jitter);
        continue;
      }
      break;
    }
  }

  // Deterministic fallback
  logAI({ model: AI_CONFIG.model, latencyMs: 0, success: false, mode: "rules-fallback", attempt: AI_CONFIG.maxRetries });
  return {
    answer: context.answer,
    mode: "rules-fallback",
    structured: null,
    decision,
    note: "AI provider unavailable; using the local safety guidance engine.",
  };
}
