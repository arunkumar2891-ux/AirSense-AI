// ---------- AQI classification (US EPA) ----------
export function getAQIStatus(value) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) || Number(value) < 0) return { label: "Unavailable", color: "slate", level: 0, advice: "Live AQI is unavailable. Check your local monitoring authority." };
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
const FRESH_MS = 30 * 60 * 1000; // 30 minutes
const STALE_MS = 3 * 60 * 60 * 1000; // 3 hours

export function getDataFreshness(observedAt) {
  if (!observedAt) return { state: "unknown", ageMs: null, label: "Observation time unknown." };
  const age = Date.now() - new Date(observedAt).getTime();
  if (!Number.isFinite(age) || age < 0) return { state: "unknown", ageMs: null, label: "Observation time invalid." };
  if (age <= FRESH_MS) return { state: "fresh", ageMs: age, label: `Observed ${Math.round(age / 60000)} min ago.` };
  if (age <= STALE_MS) return { state: "aging", ageMs: age, label: `Observed ${Math.round(age / 60000)} min ago — may not reflect current conditions.` };
  return { state: "stale", ageMs: age, label: `Observed ${Math.round(age / 3600000)}h ago — too old for reliable decisions.` };
}

// ---------- Exposure decision engine ----------
export function buildExposureDecision(air = {}, profile = {}) {
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
  const freshness = getDataFreshness(air.observedAt);
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
      alternativeActivity: "Indoor activities are a safe default until live readings resume.",
      dataFreshness: freshness,
      limitations: "AQI unavailable from provider. No forecast or historical trend can substitute for current readings. Always follow official local public-health advisories.",
    };
  }
  if (freshness.state === "stale" || freshness.state === "unknown") {
    return {
      overallRisk: "unknown",
      activityRecommendation: "insufficient_data",
      recommendedAction: freshness.state === "stale"
        ? "Refresh the data or check a local monitoring station. Available readings are too old."
        : "Check a local regulatory monitoring station. The observation time is missing, invalid, or in the future.",
      reasoning: freshness.state === "stale"
        ? `Readings are ${Math.round(freshness.ageMs / 3600000)} hours old. Air quality can change significantly within hours.`
        : "A trustworthy observation time is required before making a current environmental exposure recommendation.",
      sensitiveGroupAdvice: isSensitive ? "Treat unverified data with extra caution and consult official local guidance." : "Refresh for a time-verified reading.",
      alternativeActivity: "Consider indoor activities until time-verified environmental data is available.",
      dataFreshness: freshness,
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

  // Weather: low wind stagnation
  const windSpeed = Number(air.weather?.wind_speed_10m);
  if (Number.isFinite(windSpeed) && windSpeed < 5) riskScore += 0.5;

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
    limitations: limitations.join(" "),
  };
}

export function buildDeterministicAnswer(air = {}, decision) {
  if (!decision) return "No environmental exposure recommendation is available.";
  const aqiText = Number.isFinite(Number(air.aqi)) && Number(air.aqi) >= 0
    ? `The reported ${air.aqiScale || "AQI"} is ${Number(air.aqi)} (${getAQIStatus(air.aqi).label}).`
    : "Current air-quality data is unavailable.";
  return [
    aqiText,
    `Environmental exposure recommendation: ${decision.activityRecommendation.replace("_", " ")}.`,
    decision.recommendedAction,
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
  const answer = decision
    ? buildDeterministicAnswer(air, decision)
    : `${valid ? `The reported ${air.aqiScale || "AQI"} is ${aqi} (${status.label}).` : "Current air quality data is unavailable."} ${recommendation} ${air.pollutants?.pm25 != null ? `PM2.5 is ${air.pollutants.pm25} µg/m³.` : ""} ${air.attribution || ""}`.trim();
  return { aqi: valid ? aqi : null, category: status.label, activity, sensitivity, ageGroup, recommendation, question, answer };
}
