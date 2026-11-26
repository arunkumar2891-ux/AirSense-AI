// ---------- AQI classification (US EPA) ----------
export function getAQIStatus(value) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) || Number(value) < 0) return { label: "Unavailable", color: "slate", level: 0, advice: "Current US AQI is unavailable. Check your local monitoring authority." };
  const aqi = Number(value);
  if (aqi <= 50) return { label: "Good", color: "green", level: 1, advice: "Air quality is generally satisfactory for outdoor activities." };
  if (aqi <= 100) return { label: "Moderate", color: "yellow", level: 2, advice: "Most people can continue usual activities; unusually sensitive people should monitor symptoms." };
  if (aqi <= 150) return { label: "Unhealthy for sensitive groups", color: "orange", level: 3, advice: "Sensitive groups should reduce prolonged or heavy outdoor exertion." };
  if (aqi <= 200) return { label: "Unhealthy", color: "red", level: 4, advice: "Consider reducing prolonged outdoor exertion; sensitive groups should avoid it." };
  if (aqi <= 300) return { label: "Very unhealthy", color: "purple", level: 5, advice: "Avoid outdoor exertion where possible and follow local public-health guidance." };
  return { label: "Hazardous", color: "maroon", level: 6, advice: "Avoid outdoor activity and follow official emergency health guidance." };
}

// ---------- PM2.5 independent assessment (24-hr WHO interim + US EPA breakpoints) ----------
export function getPM25Status(ugm3) {
  if (ugm3 === null || ugm3 === undefined || !Number.isFinite(Number(ugm3))) return { label: "Unknown", level: 0 };
  const v = Number(ugm3);
  if (v <= 12) return { label: "Low", level: 1 };
  if (v <= 35.4) return { label: "Moderate", level: 2 };
  if (v <= 55.4) return { label: "High", level: 3 };
  if (v <= 150.4) return { label: "Very high", level: 4 };
  return { label: "Severe", level: 5 };
}

// ---------- Activity taxonomy ----------
const VIGOROUS_ACTIVITIES = new Set(["running", "cycling", "outdoor workout", "sports"]);
const PROLONGED_ACTIVITIES = new Set(["commuting"]);
const CHILD_ACTIVITIES = new Set(["children's outdoor play"]);

function isVigorous(activity) { return VIGOROUS_ACTIVITIES.has(activity.toLowerCase()); }
function isProlonged(activity) { return PROLONGED_ACTIVITIES.has(activity.toLowerCase()); }
function isChildActivity(activity) { return CHILD_ACTIVITIES.has(activity.toLowerCase()); }

// ---------- Data freshness ----------
// 30 minutes and 3 hours are AirSense policy thresholds, not provider
// guarantees. Open-Meteo does not document these ages. Forecast valid time is
// never an input to either threshold.
const FRESH_MS = 30 * 60 * 1000;
const STALE_MS = 3 * 60 * 60 * 1000;
export const RETRIEVAL_FRESH_MS = FRESH_MS;
export const RETRIEVAL_STALE_MS = STALE_MS;
// A retrieval timestamp stamped by another clock may sit slightly ahead.
// This matches the client allowance in src/reliability.ts. The current-air
// gate uses it unless a caller sets retrievalClockSkewToleranceMs. GoWindow
// and the wind adjustment apply the same allowance. Forecast valid time and
// model initialization time are never retrieval times.
export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

function resolveEvaluationTime(now) {
  if (now === undefined) return Date.now();
  const value = now instanceof Date ? now.getTime() : Number(now);
  return Number.isFinite(value) ? value : null;
}

function parseTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function formatAge(ageMs) {
  const minutes = Math.round(ageMs / 60000);
  return minutes < 60 ? `${minutes} min` : `${Math.round(ageMs / 3600000)}h`;
}

// Station-style observations: age is measured from the observation time.
export function getDataFreshness(observedAt, now) {
  if (!observedAt) return { state: "unknown", ageMs: null, label: "Observation time unknown." };
  const evaluatedAt = resolveEvaluationTime(now);
  if (evaluatedAt === null) return { state: "unknown", ageMs: null, label: "Observation time invalid." };
  const age = evaluatedAt - new Date(observedAt).getTime();
  if (!Number.isFinite(age) || age < 0) return { state: "unknown", ageMs: null, label: "Observation time invalid." };
  if (age <= FRESH_MS) return { state: "fresh", ageMs: age, label: `Observed ${Math.round(age / 60000)} min ago.` };
  if (age <= STALE_MS) return { state: "aging", ageMs: age, label: `Observed ${Math.round(age / 60000)} min ago — may not reflect current conditions.` };
  return { state: "stale", ageMs: age, label: `Observed ${Math.round(age / 3600000)}h ago — too old for reliable decisions.` };
}

// Modelled forecasts: age is measured only from when AirSense retrieved the
// provider response. Forecast valid time says when a value applies, not how
// old it is, and is never used to age the data. Model run age is reported
// only from a genuine provider-supplied initialization time and never gates.
function retrievalLabel({ state, ageMs, subject, modelRunText, discloseModelRun }) {
  let text;
  if (state === "missing") text = subject ? `${subject} retrieval time unavailable.` : "Retrieval time unavailable.";
  else if (state === "invalid") text = subject ? `${subject} retrieval time is invalid.` : "Retrieval time invalid.";
  else if (state === "fresh") {
    text = subject
      ? `${subject} retrieved ${formatAge(ageMs)} ago.`
      : `Forecast estimate retrieved ${formatAge(ageMs)} ago.`;
  } else if (state === "aging") {
    text = subject
      ? `${subject} retrieved ${formatAge(ageMs)} ago — may not reflect current conditions.`
      : `Forecast estimate retrieved ${formatAge(ageMs)} ago — may not reflect current conditions.`;
  } else {
    text = subject
      ? `${subject} retrieved ${formatAge(ageMs)} ago — too old for reliable decisions.`
      : `Retrieved data is ${formatAge(ageMs)} old — too old for reliable decisions.`;
  }
  if (!discloseModelRun) return text;
  return `${text} ${modelRunText}`;
}

export function getRetrievalFreshness(retrievedAt, now, {
  modelInitializedAt = null,
  clockSkewToleranceMs = 0,
  subject = null,
  discloseModelRun = true,
} = {}) {
  const base = { basis: "retrievedAt", timestamp: null, ageMs: null, modelRunAgeMs: null };
  const evaluatedAt = resolveEvaluationTime(now);
  const retrievedMs = parseTimestamp(retrievedAt);
  const initMs = parseTimestamp(modelInitializedAt);
  const modelRunAgeMs = evaluatedAt !== null && initMs !== null && evaluatedAt >= initMs ? evaluatedAt - initMs : null;
  const modelRunText = modelRunAgeMs === null
    ? "Model run age unavailable."
    : `Model run initialized ${formatAge(modelRunAgeMs)} ago.`;
  const finish = (state, extra = {}) => ({
    ...base,
    ...extra,
    modelRunAgeMs,
    state: state === "missing" || state === "invalid" ? "unknown" : state,
    label: retrievalLabel({ state, ageMs: extra.ageMs, subject, modelRunText, discloseModelRun }),
  });
  if (retrievedMs === null) return finish("missing");
  const timestamp = new Date(retrievedMs).toISOString();
  const skew = Math.max(0, Number(clockSkewToleranceMs) || 0);
  if (evaluatedAt === null || retrievedMs - evaluatedAt > skew) return finish("invalid", { timestamp });
  const ageMs = Math.max(0, evaluatedAt - retrievedMs);
  if (ageMs <= FRESH_MS) return finish("fresh", { timestamp, ageMs });
  if (ageMs <= STALE_MS) return finish("aging", { timestamp, ageMs });
  return finish("stale", { timestamp, ageMs });
}

function resolveDecisionFreshness(air, now) {
  if (!air.metadata?.isModelledEstimate) return getDataFreshness(air.observedAt, now);
  const validAt = air.forecastValidAt ?? air.metadata?.timestamps?.forecastValidAt ?? null;
  const retrievedAt = air.retrievedAt ?? air.metadata?.timestamps?.retrievedAt ?? null;
  const modelInitializedAt = air.modelInitializedAt ?? air.metadata?.timestamps?.modelInitializedAt ?? null;
  if (parseTimestamp(validAt) === null) {
    return { basis: "retrievedAt", timestamp: null, ageMs: null, modelRunAgeMs: null, state: "unknown", label: "Forecast valid time unavailable." };
  }
  return getRetrievalFreshness(retrievedAt, now, {
    modelInitializedAt,
    clockSkewToleranceMs: air.retrievalClockSkewToleranceMs ?? CLOCK_SKEW_TOLERANCE_MS,
  });
}

// The overview and the recommendation context use these same sentences when a
// reported AQI cannot support a current activity decision.
export function insufficientExposureGuidance(freshness) {
  const modelled = freshness?.basis === "retrievedAt";
  if (freshness?.state === "stale") {
    return modelled
      ? "Refresh the data or check a local monitoring station. The retrieved forecast data is too old."
      : "Refresh the data or check a local monitoring station. Available readings are too old.";
  }
  return modelled
    ? "Check a local regulatory monitoring station. The forecast valid time or retrieval time is missing, invalid, or in the future."
    : "Check a local regulatory monitoring station. The observation time is missing, invalid, or in the future.";
}

// ---------- Exposure decision engine ----------
export function buildExposureDecision(air = {}, profile = {}, now) {
  const aqi = air.aqi !== null && air.aqi !== undefined && air.aqi !== "" ? Number(air.aqi) : null;
  const aqiValid = aqi !== null && Number.isFinite(aqi) && aqi >= 0;
  const aqiStatus = getAQIStatus(aqi);
  const pm25 = air.pollutants?.pm25;
  const pm25Status = getPM25Status(pm25);
  const activity = String(profile.activity || "daily activities");
  const ageGroup = String(profile.ageGroup || "adult");
  const sensitivity = String(profile.sensitivity || "general");
  const isSensitive = sensitivity !== "general" || ageGroup === "child" || ageGroup === "older adult";
  const isChild = ageGroup === "child" || isChildActivity(activity);
  const freshness = resolveDecisionFreshness(air, now);
  const modelled = freshness.basis === "retrievedAt";
  const hourly = Array.isArray(air.hourly) && air.hourly.length > 0 ? air.hourly : null;
  const hasForecast = hourly !== null && hourly.some((h) => h.aqi !== null);

  // ---------- Gate: insufficient data ----------
  if (!aqiValid) {
    return {
      overallRisk: "unknown",
      activityRecommendation: "insufficient_data",
      recommendedAction: "Check a local regulatory monitoring station before making exposure decisions.",
      reasoning: "No valid AQI reading is available from the provider. Decisions require current data.",
      sensitiveGroupAdvice: isSensitive ? "Without current data, sensitive individuals should avoid prolonged outdoor exertion as a precaution." : "No specific guidance available without data.",
      alternativeActivity: "Consider indoor activities until current readings resume.",
      dataFreshness: freshness,
      wind: assessWind(air, now),
      limitations: "AQI unavailable from provider. No forecast or historical trend can substitute for current readings. Always follow official local public-health advisories.",
    };
  }
  if (freshness.state === "stale" || freshness.state === "unknown") {
    return {
      overallRisk: "unknown",
      activityRecommendation: "insufficient_data",
      recommendedAction: insufficientExposureGuidance(freshness),
      reasoning: freshness.state === "stale"
        ? modelled
          ? `Forecast data was retrieved ${Math.round(freshness.ageMs / 3600000)} hours ago. Air quality can change significantly within hours.`
          : `Readings are ${Math.round(freshness.ageMs / 3600000)} hours old. Air quality can change significantly within hours.`
        : modelled
          ? "A trustworthy forecast valid time and retrieval time are required before making a current environmental exposure recommendation."
          : "A trustworthy observation time is required before making a current environmental exposure recommendation.",
      sensitiveGroupAdvice: isSensitive ? "Treat unverified data with extra caution and consult official local guidance." : "Refresh for a time-verified reading.",
      alternativeActivity: "Consider indoor activities until time-verified environmental data is available.",
      dataFreshness: freshness,
      wind: assessWind(air, now),
      limitations: `Data freshness (${freshness.state}) prevents a reliable environmental exposure assessment. This is not medical advice; follow official local public-health advisories.`,
    };
  }

  // ---------- Risk scoring (higher = worse) ----------
  let riskScore = 0;

  // AQI contribution
  riskScore += aqiStatus.level; // 1-6

  // PM2.5 independent contribution — can elevate risk beyond AQI alone
  riskScore += Math.max(0, pm25Status.level - 1); // 0-4

  // Activity intensity
  if (isVigorous(activity)) riskScore += 1;
  if (isProlonged(activity)) riskScore += 0.5;

  // Vulnerability
  if (isSensitive) riskScore += 1;
  if (isChild) riskScore += 0.5;

  // Wind below 5 km/h adds 0.5 only when this weather response has its own
  // usable retrieval time. The air-quality retrievedAt is never a substitute.
  const wind = assessWind(air, now);
  if (wind.points) riskScore += wind.points;

  // Forecast trend is context only. Forecasts must never change the current
  // exposure recommendation, which is based on current observed/modelled data.
  let forecastNote = "";
  if (hasForecast && hourly) {
    const futureAQI = hourly.slice(0, 6).map((h) => h.aqi).filter((v) => v !== null);
    if (futureAQI.length > 0) {
      const maxFuture = Math.max(...futureAQI);
      if (maxFuture > aqi) { forecastNote = " Forecast suggests conditions may worsen."; }
      else if (maxFuture < aqi) { forecastNote = " Forecast suggests conditions may improve."; }
    }
  }

  // ---------- Map score to decision ----------
  // AQI level 4+ (Unhealthy) with vigorous activity is always avoid.
  let overallRisk, activityRecommendation, recommendedAction;
  if (aqiStatus.level >= 4 && isVigorous(activity)) {
    riskScore = Math.max(riskScore, 6);
  }
  if (riskScore <= 2.5) {
    overallRisk = "low";
    activityRecommendation = "suitable";
    recommendedAction = `Conditions are favorable for ${activity}.`;
  } else if (riskScore <= 4.5) {
    overallRisk = "moderate";
    activityRecommendation = isVigorous(activity) ? "caution" : "suitable";
    recommendedAction = isVigorous(activity)
      ? `${activity} is possible but consider reducing intensity or duration.`
      : `Normal ${activity} is acceptable. Monitor how you feel.`;
  } else if (riskScore <= 5.5) {
    overallRisk = "high";
    activityRecommendation = "caution";
    recommendedAction = isSensitive || isChild
      ? `Avoid prolonged ${activity}. Short, low-intensity outdoor time is acceptable if symptoms are absent.`
      : `Reduce the intensity and duration of ${activity}. Consider indoor alternatives.`;
  } else {
    overallRisk = "very_high";
    activityRecommendation = "avoid";
    recommendedAction = `Avoid outdoor ${activity}. Move indoors and follow official public-health advisories.`;
  }

  // Conservative AQI-category floors apply independently of PM2.5
  // availability. PM2.5 may elevate a recommendation but its absence cannot
  // weaken the minimum recommendation implied by the reported US AQI.
  const recommendationRank = { suitable: 0, caution: 1, avoid: 2 };
  const categoryFloor = aqiStatus.level >= 5
    ? "avoid"
    : aqiStatus.level >= 3
      ? "caution"
      : "suitable";
  if (recommendationRank[activityRecommendation] < recommendationRank[categoryFloor]) {
    activityRecommendation = categoryFloor;
    overallRisk = categoryFloor === "avoid" ? "very_high" : "high";
    recommendedAction = categoryFloor === "avoid"
      ? `Avoid outdoor ${activity}. Move indoors and follow official public-health advisories.`
      : `Reduce the intensity or duration of ${activity} and consider an indoor alternative.`;
  }

  // ---------- Sensitive group override ----------
  let sensitiveGroupAdvice = "No additional sensitivity concerns for this profile.";
  if (isSensitive && overallRisk !== "low") {
    sensitiveGroupAdvice = `${ageGroup === "child" ? "Children" : ageGroup === "older adult" ? "Older adults" : "Sensitive individuals"} face elevated risk at AQI ${aqi}. ` +
      (activityRecommendation === "avoid"
        ? "Outdoor activity is strongly discouraged."
        : "Limit outdoor exposure and watch for symptoms such as coughing or shortness of breath.");
    if (overallRisk === "very_high") {
      sensitiveGroupAdvice += " Follow official public-health guidance.";
    }
  }

  // ---------- Alternative activity ----------
  let alternativeActivity = "No alternative needed — current conditions support your plan.";
  if (activityRecommendation === "caution") {
    alternativeActivity = "Consider indoor exercise, a treadmill session, or a shorter outdoor route with lower traffic exposure.";
  } else if (activityRecommendation === "avoid") {
    alternativeActivity = "Indoor alternatives: gym, home workout, swimming, yoga. If outdoor time is essential, choose a brief low-intensity walk away from traffic.";
  }

  // ---------- Reasoning ----------
  const reasons = [
    `US AQI is ${aqi} (${aqiStatus.label}).`,
    pm25 !== null && pm25 !== undefined ? `PM2.5 is ${pm25} µg/m³ (${pm25Status.label}).` : null,
    `Activity: ${activity}${isVigorous(activity) ? " (vigorous)" : isProlonged(activity) ? " (prolonged)" : ""}.`,
    isSensitive ? "Profile indicates elevated sensitivity." : null,
    freshness.state === "aging" ? freshness.label : null,
    wind.disclosure,
    forecastNote || null,
  ].filter(Boolean);

  // ---------- Limitations ----------
  const limitations = [
    "Air quality data are modelled estimates, not regulatory station readings.",
    hasForecast ? "Forecast trend is model-based and subject to change." : "No forecast data available for this location.",
    "This assessment does not constitute medical advice.",
    "Always follow official local public-health advisories over this guidance.",
  ];

  return {
    overallRisk,
    activityRecommendation,
    recommendedAction,
    reasoning: reasons.join(" "),
    sensitiveGroupAdvice,
    alternativeActivity,
    dataFreshness: freshness,
    wind,
    limitations: limitations.join(" "),
  };
}

// AirSense policy, shared with GoWindow: fresh through 30 minutes, aging through
// 3 hours, stale after that. A weather timestamp up to 5 minutes ahead is
// clock skew. These ages are not provider guarantees.
function formatWindSpeed(windSpeedKmh) {
  const rounded = Math.round(windSpeedKmh * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatWindRetrieved(ageMs) {
  const minutes = Math.round(ageMs / 60000);
  if (minutes < 1) return "Retrieved just now.";
  if (minutes < 60) return `Retrieved ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago.`;
  const hours = Math.round(ageMs / 3600000);
  return `Retrieved ${hours} ${hours === 1 ? "hour" : "hours"} ago.`;
}

function windScoreSentence(speed, points) {
  return points > 0
    ? `Wind of ${speed} km/h increased the exposure score by 0.5 points.`
    : `Wind of ${speed} km/h was considered; no score adjustment was needed.`;
}

function assessWind(air, now) {
  const raw = air.weather?.wind_speed_10m;
  const parsed = raw === null || raw === undefined || raw === "" ? null : Number(raw);
  const windSpeedKmh = parsed !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  const freshness = getRetrievalFreshness(air.weatherRetrievedAt ?? null, now, {
    clockSkewToleranceMs: CLOCK_SKEW_TOLERANCE_MS,
    subject: "Weather data",
    discloseModelRun: false,
  });
  const base = { windSpeedKmh, freshness, basis: "weatherRetrievedAt" };
  if (windSpeedKmh === null) {
    return {
      ...base,
      applied: false,
      points: 0,
      state: "excluded_missing_wind",
      disclosure: "Wind was unavailable and was not used in the exposure score. Missing wind is not treated as favorable.",
    };
  }
  const speed = formatWindSpeed(windSpeedKmh);
  if (freshness.state === "unknown") {
    return {
      ...base,
      applied: false,
      points: 0,
      state: "excluded_retrieval_time",
      disclosure: `Wind of ${speed} km/h was excluded from scoring because the weather retrieval time is missing, invalid, or in the future.`,
    };
  }
  if (freshness.state === "stale") {
    return {
      ...base,
      applied: false,
      points: 0,
      state: "excluded_stale",
      disclosure: `Wind of ${speed} km/h was excluded from scoring because the weather data is too old. ${formatWindRetrieved(freshness.ageMs)}`,
    };
  }
  const stagnant = windSpeedKmh < 5;
  const points = stagnant ? 0.5 : 0;
  const state = freshness.state === "aging" ? "included_aging" : "included";
  const agingNote = state === "included_aging" ? " The reading may not reflect current conditions." : "";
  return {
    ...base,
    applied: true,
    points,
    state,
    disclosure: `${windScoreSentence(speed, points)} ${formatWindRetrieved(freshness.ageMs)}${agingNote}`,
  };
}

export function buildDeterministicAnswer(air = {}, decision) {
  if (!decision) return "No environmental exposure recommendation is available.";
  const aqiText = Number.isFinite(Number(air.aqi)) && Number(air.aqi) >= 0
    ? `The reported ${air.aqiScale || "AQI"} is ${Number(air.aqi)} (${getAQIStatus(air.aqi).label}).`
    : "Current air-quality data is unavailable.";
  const action = decision.recommendedAction
    ? decision.recommendedAction.charAt(0).toUpperCase() + decision.recommendedAction.slice(1)
    : "";
  return [
    aqiText,
    `Environmental exposure recommendation: ${decision.activityRecommendation.replace("_", " ")}.`,
    action,
    decision.reasoning,
    "This is an environmental exposure recommendation, not medical advice.",
  ].filter(Boolean).join(" ");
}

// ---------- Legacy compatibility (used by Gemini system prompt) ----------
export function buildRecommendationContext(air = {}, profile = {}, question = "", decision = null) {
  const aqi = Number(air.aqi);
  const status = getAQIStatus(aqi);
  const activity = String(profile.activity || "daily activities");
  const sensitivity = String(profile.sensitivity || "general");
  const ageGroup = String(profile.ageGroup || "adult");
  const valid = air.aqi !== null && air.aqi !== undefined && air.aqi !== "" && Number.isFinite(aqi) && aqi >= 0;
  let recommendation = valid ? status.advice : "I don't have a current AQI reading, so I can't make a live exposure recommendation. Check an official local monitor.";
  if (valid && aqi > 100 && ["running", "cycling", "outdoor workout", "sports"].includes(activity.toLowerCase())) {
    recommendation += " Because you plan vigorous outdoor activity, choose an indoor session or wait for a lower reading.";
  }
  if (valid && aqi > 100 && (sensitivity !== "general" || ageGroup === "child" || ageGroup === "older adult")) {
    recommendation += " Take extra care because the selected profile may be more sensitive to air pollution.";
  }
  // Category text classifies the reported number. It is not the activity
  // recommendation once the exposure engine has refused a current decision.
  if (decision?.activityRecommendation === "insufficient_data") {
    recommendation = decision.recommendedAction || insufficientExposureGuidance(decision.dataFreshness);
  }
  const answer = decision
    ? buildDeterministicAnswer(air, decision)
    : `${valid ? `The reported ${air.aqiScale || "AQI"} is ${aqi} (${status.label}).` : "Current air quality data is unavailable."} ${recommendation} ${air.pollutants?.pm25 != null ? `PM2.5 is ${air.pollutants.pm25} µg/m³.` : ""} ${air.attribution || ""}`.trim();
  return {
    aqi: valid ? aqi : null,
    category: status.label,
    categoryDescription: valid ? status.advice : null,
    activity,
    sensitivity,
    ageGroup,
    recommendation,
    question,
    answer,
  };
}

function validReading(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function claimSentence(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Server-authored explanation claims. Gemini may cite these IDs and cannot
// supply the sentences. A claim is absent whenever its source fact is missing
// or its freshness state does not allow it.
export function buildExplanationClaims(air = {}, decision = null) {
  if (!decision || typeof decision !== "object") return [];
  const claims = [];
  const insufficient = decision.activityRecommendation === "insufficient_data";
  const modelled = decision.dataFreshness?.basis === "retrievedAt" || air.metadata?.isModelledEstimate === true;
  if (modelled) {
    claims.push({
      id: "modelled_estimate",
      text: "These air-quality values are modelled estimates, not station observations.",
    });
  }

  const aqi = validReading(air.aqi);
  if (aqi !== null) {
    const status = getAQIStatus(aqi);
    const scale = air.aqiScale || "US AQI";
    const classification = `The reported ${scale} is ${aqi} (${status.label}).`;
    const readingKind = modelled ? "modelled number" : "reported number";
    claims.push({
      id: "us_aqi",
      text: insufficient
        ? `${classification} This classifies the ${readingKind} and is not a current activity recommendation.`
        : classification,
    });
  }

  const pm25 = validReading(air.pollutants?.pm25);
  if (pm25 !== null) {
    const status = getPM25Status(pm25);
    claims.push({
      id: "pm25",
      text: `PM2.5 is ${pm25} µg/m³ (${status.label}).`,
    });
  }

  const wind = decision.wind;
  const windState = wind?.state;
  if ((windState === "included" || windState === "included_aging") && wind.points > 0) {
    claims.push({ id: "wind_adjustment", text: wind.disclosure });
  } else if ((windState === "included" || windState === "included_aging") && wind.points === 0) {
    claims.push({ id: "wind_considered", text: wind.disclosure });
  } else if (windState === "excluded_stale" || windState === "excluded_retrieval_time" || windState === "excluded_missing_wind") {
    claims.push({ id: "wind_excluded", text: wind.disclosure });
  }
  if (windState === "included_aging") {
    const aging = wind.freshness?.label
      ? claimSentence(wind.freshness.label)
      : "The weather reading may not reflect current conditions.";
    claims.push({ id: "weather_aging", text: aging });
  }

  if (insufficient) {
    claims.push({
      id: "insufficient_data",
      text: claimSentence(decision.recommendedAction) || insufficientExposureGuidance(decision.dataFreshness),
    });
  } else if (decision.activityRecommendation && decision.recommendedAction) {
    const label = String(decision.activityRecommendation).replaceAll("_", " ");
    claims.push({
      id: "activity_recommendation",
      text: `Environmental exposure recommendation: ${label}. ${claimSentence(decision.recommendedAction)}`,
    });
  }

  if (typeof decision.reasoning === "string" && decision.reasoning.trim()) {
    claims.push({ id: "decision_reasoning", text: decision.reasoning.trim() });
  }
  claims.push({
    id: "not_medical_advice",
    text: "This is an environmental exposure recommendation, not medical advice.",
  });
  return claims;
}
