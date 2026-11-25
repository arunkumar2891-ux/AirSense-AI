import { buildExposureDecision, getAQIStatus, getDataFreshness, getPM25Status } from "./logic.js";
import { providerTimeToEpochMs } from "./time.js";

const HOUR_MS = 60 * 60 * 1000;
const FORECAST_HORIZON_MS = 12 * HOUR_MS;
const MIN_DURATION_MINUTES = 1;
const MAX_DURATION_MINUTES = 12 * 60;
const RECOMMENDATION_LABEL = "Suitable based on available forecast data";

export const TIME_PREFERENCES = Object.freeze({
  any: { label: "Any time", startMinute: null, endMinute: null, rangeLabel: "any local time" },
  morning: { label: "Morning", startMinute: 5 * 60, endMinute: 12 * 60, rangeLabel: "5 AM–12 PM" },
  afternoon: { label: "Afternoon", startMinute: 12 * 60, endMinute: 17 * 60, rangeLabel: "12 PM–5 PM" },
  evening: { label: "Evening", startMinute: 17 * 60, endMinute: 22 * 60, rangeLabel: "5 PM–10 PM" },
  daytime: { label: "Daytime", startMinute: 5 * 60, endMinute: 22 * 60, rangeLabel: "5 AM–10 PM" },
});

const BASE_LIMITATIONS = [
  "Forecast recommendations are model estimates, not measurements.",
  "A suitable window describes available forecast data only. It is not medical advice or medical clearance.",
  "Always follow official local public-health advisories.",
];

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteNonNegative(value) {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function resolveNow(now) {
  if (now === undefined) return Date.now();
  const value = now instanceof Date ? now.getTime() : Number(now);
  return Number.isFinite(value) ? value : null;
}

function resolveTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone.trim()) return null;
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return null;
  }
}

function resolveDuration(durationMinutes) {
  const duration = Number(durationMinutes);
  if (!Number.isInteger(duration) || duration < MIN_DURATION_MINUTES || duration > MAX_DURATION_MINUTES) return null;
  return duration;
}

function joinLimitations(items) {
  return [...new Set(items.filter(Boolean))].join(" ");
}

function emptyAssessment() {
  return { futureHours: 0, suitableHours: 0, unsuitableHours: 0, unavailableHours: 0 };
}

function buildResult({
  status,
  activity,
  durationMinutes,
  timezone,
  evaluatedAt,
  timePreference = null,
  preference = null,
  forecastFreshness = { state: "unknown", ageMs: null, label: "Forecast issue time unknown." },
  windows = [],
  reason,
  limitations,
  assessment = emptyAssessment(),
}) {
  return {
    status,
    activity,
    durationMinutes,
    timezone,
    evaluatedAt,
    timePreference,
    preference,
    forecastFreshness,
    windows,
    assessment,
    reason,
    limitations: joinLimitations(limitations),
    estimate: true,
  };
}

function unavailableResult(fields, reason, extraLimitations = []) {
  return buildResult({
    ...fields,
    status: "insufficient_data",
    windows: [],
    reason,
    limitations: [...BASE_LIMITATIONS, reason, ...extraLimitations],
  });
}

function normalizeWeather(weather) {
  if (!weather || typeof weather !== "object") {
    return { engine: {}, context: { wind: null, temperature: null, humidity: null } };
  }
  const wind = finiteNonNegative(weather.wind_speed_10m);
  const temperature = finiteNumber(weather.temperature_2m);
  const humidityValue = finiteNumber(weather.relative_humidity_2m);
  const humidity = humidityValue !== null && humidityValue >= 0 && humidityValue <= 100 ? humidityValue : null;
  return {
    engine: wind === null ? {} : { wind_speed_10m: wind },
    context: { wind, temperature, humidity },
  };
}

function normalizeHour(hour) {
  if (!hour || typeof hour !== "object") return null;
  const startMs = providerTimeToEpochMs(hour.time);
  if (startMs === null) return null;
  const weather = normalizeWeather(hour.weather);
  return {
    startMs,
    endMs: startMs + HOUR_MS,
    aqi: finiteNonNegative(hour.aqi),
    pm25: finiteNonNegative(hour.pm25),
    pm10: finiteNonNegative(hour.pm10),
    weather: weather.engine,
    context: weather.context,
  };
}

function sameReading(left, right) {
  return left.aqi === right.aqi && left.pm25 === right.pm25 && left.pm10 === right.pm10
    && left.context.wind === right.context.wind
    && left.context.temperature === right.context.temperature
    && left.context.humidity === right.context.humidity;
}

function dedupeHours(hours) {
  const grouped = new Map();
  for (const hour of hours) {
    const existing = grouped.get(hour.startMs) || [];
    existing.push(hour);
    grouped.set(hour.startMs, existing);
  }
  const usable = [];
  let conflictingHours = 0;
  for (const readings of grouped.values()) {
    if (readings.every((reading) => sameReading(reading, readings[0]))) usable.push(readings[0]);
    else conflictingHours += 1;
  }
  usable.sort((left, right) => left.startMs - right.startMs);
  return { hours: usable, conflictingHours };
}

function evaluateHour(hour, profile) {
  const decision = buildExposureDecision({
    aqi: hour.aqi,
    aqiScale: "US AQI",
    pollutants: { pm25: hour.pm25, pm10: hour.pm10 },
    weather: hour.weather,
    observedAt: new Date(hour.startMs).toISOString(),
    hourly: [],
  }, profile, hour.startMs);
  return decision.activityRecommendation;
}

function range(values) {
  return { minimum: Math.min(...values), maximum: Math.max(...values) };
}

function coveredHours(hours, startMs, endMs) {
  const covered = [];
  let cursor = startMs;
  for (const hour of hours) {
    if (hour.endMs <= cursor) continue;
    if (hour.startMs > cursor) return null;
    covered.push(hour);
    cursor = Math.min(endMs, hour.endMs);
    if (cursor >= endMs) return covered;
  }
  return null;
}

function overlaps(left, right) {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

function weatherContext(hours) {
  const wind = hours.map((hour) => hour.context.wind);
  const temperature = hours.map((hour) => hour.context.temperature);
  const humidity = hours.map((hour) => hour.context.humidity);
  const complete = (values) => values.every((value) => value !== null);
  const context = {};
  if (complete(wind)) context.windSpeedKmh = range(wind);
  if (complete(temperature)) context.temperatureC = range(temperature);
  if (complete(humidity)) context.relativeHumidityPercent = range(humidity);
  return Object.keys(context).length ? context : null;
}

function localClock(epochMs, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = {};
  for (const part of formatter.formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  return {
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute) + Number(parts.second) / 60,
  };
}

function resolvePreference(timePreference) {
  if (timePreference === undefined || timePreference === null) return { applied: false };
  if (typeof timePreference !== "string" || !Object.hasOwn(TIME_PREFERENCES, timePreference)) {
    return { error: "Time preference must be any, morning, afternoon, evening, or daytime." };
  }
  return { applied: true, id: timePreference, ...TIME_PREFERENCES[timePreference] };
}

function preferenceText(preference, timezone) {
  const place = timezone ? ` in ${timezone}` : "";
  return `${preference.label} (${preference.rangeLabel}${place})`;
}

function windowInsidePreference(startMs, endMs, timeZone, preference) {
  if (preference.startMinute === null) return true;
  const start = localClock(startMs, timeZone);
  const end = localClock(endMs, timeZone);
  const startsInside = start.minutes >= preference.startMinute && start.minutes < preference.endMinute;
  const endsInside = start.dayKey === end.dayKey && end.minutes > start.minutes && end.minutes <= preference.endMinute;
  return startsInside && endsInside;
}

function rankReason(candidate, rank, placement = "preferred", preference = null) {
  const parts = [
    placement === "alternative" && preference
      ? `Alternative ${rank} outside ${preference.label} (${preference.rangeLabel}).`
      : `Ranked ${rank} for this activity.`,
    `The highest forecast US AQI in the window is ${candidate.aqi.maximum} (${candidate.aqi.maximumCategory}).`,
  ];
  if (candidate.pm25) {
    parts.push(`The highest PM2.5 is ${candidate.pm25.maximum} µg/m³ (${candidate.pm25.maximumLabel}).`);
  } else {
    parts.push("PM2.5 was unavailable and was not treated as clean air.");
  }
  if (candidate.stagnantHours > 0) {
    parts.push("Known wind below 5 km/h is included using the existing stagnation threshold.");
  } else if (candidate.weather?.windSpeedKmh) {
    parts.push("Known wind stayed at or above 5 km/h.");
  } else if (!candidate.weather) {
    parts.push("Weather was unavailable and was not assumed.");
  }
  parts.push(RECOMMENDATION_LABEL + ".");
  return parts.join(" ");
}

function buildWindow({ hours, startMs, endMs, activity, durationMinutes, timezone, forecastFreshness, partialData }) {
  const aqi = range(hours.map((hour) => hour.aqi));
  const pmValues = hours.map((hour) => hour.pm25);
  const pmComplete = pmValues.every((value) => value !== null);
  const pmRange = pmComplete ? range(pmValues) : null;
  const weather = weatherContext(hours);
  const stagnantHours = hours.filter((hour) => hour.context.wind !== null && hour.context.wind < 5).length;
  const limitations = [...BASE_LIMITATIONS];
  if (!pmComplete) limitations.push("PM2.5 was unavailable for at least one hour and was not interpreted as clean air.");
  if (!weather) limitations.push("Reliable hourly weather was unavailable and no weather condition was assumed.");
  if (forecastFreshness.state === "aging") limitations.push(forecastFreshness.label);
  if (partialData) limitations.push("Forecast hours with missing, invalid, or conflicting readings were excluded.");

  return {
    startMs,
    endMs,
    aqiValues: aqi,
    pmValues: pmRange,
    stagnantHours,
    weather,
    pmKnown: pmComplete,
    window: {
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      timezone,
      activity,
      durationMinutes,
      exposureRecommendation: "suitable",
      recommendationLabel: RECOMMENDATION_LABEL,
      aqi: {
        minimum: aqi.minimum,
        maximum: aqi.maximum,
        minimumCategory: getAQIStatus(aqi.minimum).label,
        maximumCategory: getAQIStatus(aqi.maximum).label,
        scale: "US AQI",
      },
      pm25: pmRange ? {
        minimum: pmRange.minimum,
        maximum: pmRange.maximum,
        minimumLabel: getPM25Status(pmRange.minimum).label,
        maximumLabel: getPM25Status(pmRange.maximum).label,
        unit: "µg/m³",
      } : null,
      weather,
      rankReason: "",
      dataFreshness: forecastFreshness,
      limitations: "",
      estimate: true,
    },
    limitations,
  };
}

function candidateSortKey(candidate) {
  return [
    candidate.aqiValues.maximum,
    candidate.pmKnown ? 0 : 1,
    candidate.pmKnown ? candidate.pmValues.maximum : 0,
    candidate.stagnantHours,
    candidate.startMs,
  ];
}

function compareCandidates(left, right) {
  const leftKey = candidateSortKey(left);
  const rightKey = candidateSortKey(right);
  for (let index = 0; index < leftKey.length; index += 1) {
    if (leftKey[index] !== rightKey[index]) return leftKey[index] - rightKey[index];
  }
  return 0;
}

function selectWindows(candidates) {
  const selected = [];
  for (const candidate of candidates) {
    if (selected.some((existing) => overlaps(existing, candidate))) continue;
    selected.push(candidate);
    if (selected.length === 3) break;
  }
  return selected;
}

function presentWindows(selected, { timezone, placement, preference }) {
  const timezoneLimitation = timezone ? null : "A valid location timezone was not supplied; timestamps are absolute UTC instants.";
  return selected.map((candidate, index) => {
    const limitations = [...candidate.limitations];
    if (timezoneLimitation) limitations.push(timezoneLimitation);
    if (placement === "alternative" && preference) {
      limitations.push(`This window is outside ${preferenceText(preference, timezone)} and is not the primary recommendation.`);
    }
    return {
      ...candidate.window,
      placement,
      rankReason: rankReason({ ...candidate.window, stagnantHours: candidate.stagnantHours }, index + 1, placement, preference),
      limitations: joinLimitations(limitations),
    };
  });
}

/**
 * Find up to three future outdoor windows for a requested activity duration.
 * Every hour is classified by the existing deterministic exposure engine.
 * Forecast data never changes a current exposure decision because this module
 * does not call or alter that decision for the current observation.
 * An optional time preference filters eligible windows in the location timezone
 * after that classification. It does not change exposure thresholds.
 */
export function findGoWindows({ forecast = {}, profile = {}, durationMinutes, timePreference, now } = {}) {
  const evaluatedAtMs = resolveNow(now);
  const evaluatedAt = evaluatedAtMs === null ? null : new Date(evaluatedAtMs).toISOString();
  const activity = String(profile.activity || "daily activities");
  const duration = resolveDuration(durationMinutes);
  const timezone = resolveTimeZone(forecast.timezone);
  const preference = resolvePreference(timePreference);
  const fields = {
    activity,
    durationMinutes: duration,
    timezone,
    evaluatedAt,
    timePreference: preference.applied ? preference.id : null,
    preference: preference.applied ? {
      id: preference.id,
      label: preference.label,
      rangeLabel: preference.rangeLabel,
      timezone,
      outcome: preference.id === "any" ? "any" : null,
    } : null,
  };
  const restricted = preference.applied && preference.id !== "any";

  if (evaluatedAtMs === null) {
    return unavailableResult(fields, "A valid evaluation time is required.");
  }
  if (duration === null) {
    return unavailableResult(fields, "Activity duration must be a whole number of minutes from 1 to 720.");
  }
  if (preference.error) return unavailableResult(fields, preference.error);
  if (restricted && !timezone) {
    return unavailableResult(fields, "A location timezone is required to apply a time preference.");
  }

  const issuedMs = providerTimeToEpochMs(forecast?.issuedAt);
  const forecastFreshness = issuedMs === null
    ? { state: "unknown", ageMs: null, label: "Forecast issue time unknown." }
    : getDataFreshness(new Date(issuedMs).toISOString(), evaluatedAtMs);
  if (forecastFreshness.state === "stale" || forecastFreshness.state === "unknown") {
    return unavailableResult(
      { ...fields, forecastFreshness },
      forecastFreshness.state === "stale"
        ? "The forecast is too old for a reliable scheduling decision."
        : "The forecast issue time is missing, invalid, or in the future.",
    );
  }

  const normalized = (Array.isArray(forecast.hourly) ? forecast.hourly : []).map(normalizeHour).filter(Boolean);
  const { hours: uniqueHours, conflictingHours } = dedupeHours(normalized);
  const futureHours = uniqueHours.filter((hour) => hour.endMs > evaluatedAtMs && hour.startMs < evaluatedAtMs + FORECAST_HORIZON_MS);
  const assessment = emptyAssessment();
  assessment.futureHours = futureHours.length;
  assessment.unavailableHours += conflictingHours;

  const suitableHours = [];
  for (const hour of futureHours) {
    const recommendation = evaluateHour(hour, profile);
    if (recommendation === "suitable") {
      assessment.suitableHours += 1;
      suitableHours.push(hour);
    } else if (recommendation === "insufficient_data") assessment.unavailableHours += 1;
    else assessment.unsuitableHours += 1;
  }

  const partialData = assessment.unavailableHours > 0 || normalized.length !== (forecast.hourly || []).length;
  const durationMs = duration * 60 * 1000;
  const starts = [];
  for (const hour of suitableHours) {
    if (hour.startMs >= evaluatedAtMs) starts.push(hour.startMs);
    else if (hour.startMs < evaluatedAtMs && evaluatedAtMs < hour.endMs) starts.push(evaluatedAtMs);
  }

  const candidates = [];
  for (const startMs of starts) {
    const covered = coveredHours(suitableHours, startMs, startMs + durationMs);
    if (!covered) continue;
    candidates.push(buildWindow({
      hours: covered,
      startMs,
      endMs: startMs + durationMs,
      activity,
      durationMinutes: duration,
      timezone,
      forecastFreshness,
      partialData,
    }));
  }
  candidates.sort(compareCandidates);
  const inside = (candidate) => !restricted || windowInsidePreference(candidate.startMs, candidate.endMs, timezone, preference);
  const preferred = selectWindows(candidates.filter(inside));
  const sharedLimitations = [
    ...BASE_LIMITATIONS,
    forecastFreshness.state === "aging" ? forecastFreshness.label : null,
    partialData ? "Forecast hours with missing, invalid, or conflicting readings were excluded." : null,
    timezone ? null : "A valid location timezone was not supplied; timestamps are absolute UTC instants.",
  ];

  if (preferred.length) {
    const outcome = restricted ? "within" : preference.applied ? "any" : null;
    return buildResult({
      ...fields,
      preference: fields.preference ? { ...fields.preference, outcome: outcome || "any" } : null,
      status: "suitable_windows",
      forecastFreshness,
      windows: presentWindows(preferred, { timezone, placement: "preferred", preference: restricted ? preference : null }),
      assessment,
      reason: restricted
        ? `Up to three non-overlapping windows were ranked from suitable forecast hours within ${preferenceText(preference, timezone)}. ${RECOMMENDATION_LABEL}.`
        : "Up to three non-overlapping windows were ranked from suitable forecast hours. " + RECOMMENDATION_LABEL + ".",
      limitations: sharedLimitations,
    });
  }

  const alternatives = restricted ? selectWindows(candidates.filter((candidate) => !inside(candidate))) : [];
  if (alternatives.length) {
    return buildResult({
      ...fields,
      preference: { ...fields.preference, outcome: "outside" },
      status: "outside_preference",
      forecastFreshness,
      windows: presentWindows(alternatives, { timezone, placement: "alternative", preference }),
      assessment,
      reason: `No suitable window was found within ${preferenceText(preference, timezone)}. The listed windows are alternatives outside that preference and are not the primary recommendation.`,
      limitations: [...sharedLimitations, "Alternative windows are outside the selected time preference."],
    });
  }

  if (assessment.suitableHours > 0) {
    return buildResult({
      ...fields,
      status: "no_suitable_window",
      forecastFreshness,
      assessment,
      reason: restricted
        ? `Suitable forecast hours exist, but none form a contiguous interval long enough for the requested duration within ${preferenceText(preference, timezone)} or outside it.`
        : "Suitable forecast hours exist, but none form a contiguous interval long enough for the requested duration.",
      limitations: [...BASE_LIMITATIONS, "Gaps, unsuitable hours, and unavailable readings break a scheduling window."],
    });
  }
  if (assessment.unsuitableHours > 0) {
    return buildResult({
      ...fields,
      status: "no_suitable_window",
      forecastFreshness,
      assessment,
      reason: restricted
        ? `The available forecast does not contain a suitable interval for this activity and profile within ${preferenceText(preference, timezone)} or outside it.`
        : "The available forecast does not contain a suitable interval for this activity and profile.",
      limitations: [...BASE_LIMITATIONS, "Unsuitable conditions are distinct from hours whose readings are unavailable."],
    });
  }
  return unavailableResult(
    { ...fields, forecastFreshness, assessment },
    futureHours.length
      ? "The forecast does not contain enough valid US AQI data to schedule an activity."
      : "No forecast intervals are available within the next 12 hours.",
    assessment.unavailableHours ? ["Unavailable pollutant data was not treated as clean air."] : [],
  );
}
