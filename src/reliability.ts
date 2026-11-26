import type { ForecastMetadata } from "./types";

export const US_AQI_CATEGORIES = [
  { min: 0, max: 50, label: "Good", shortLabel: "Good", color: "green", level: 1 },
  { min: 51, max: 100, label: "Moderate", shortLabel: "Moderate", color: "yellow", level: 2 },
  { min: 101, max: 150, label: "Unhealthy for Sensitive Groups", shortLabel: "Sensitive", color: "orange", level: 3 },
  { min: 151, max: 200, label: "Unhealthy", shortLabel: "Unhealthy", color: "red", level: 4 },
  { min: 201, max: 300, label: "Very Unhealthy", shortLabel: "Very Unhealthy", color: "purple", level: 5 },
  { min: 301, max: 500, label: "Hazardous", shortLabel: "Hazardous", color: "maroon", level: 6 },
] as const;

export function getAqiPresentation(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return { value: null, label: "Data unavailable", color: "slate", level: 0, markerPercent: null };
  }
  const category = US_AQI_CATEGORIES.find(({ max }) => value <= max) || US_AQI_CATEGORIES[US_AQI_CATEGORIES.length - 1];
  return {
    value,
    label: category.label,
    color: category.color,
    level: category.level,
    markerPercent: Math.min(100, Math.max(0, value / 500 * 100)),
  };
}

export type FreshnessInput = {
  forecastValidAt?: string | null;
  modelInitializedAt?: string | null;
  retrievedAt?: string | null;
} | null | undefined;

// Retrieval-age thresholds match the server's decision thresholds in logic.js.
export const RETRIEVAL_AGING_MS = 30 * 60 * 1000;
export const RETRIEVAL_STALE_MS = 3 * 60 * 60 * 1000;
// retrievedAt is stamped by the server clock; a browser clock running slightly
// behind must not turn a just-retrieved response into an invalid timestamp.
export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

function parseTime(value: string | null | undefined) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function relativeAge(ageMs: number) {
  const minutes = Math.round(ageMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(ageMs / 3600000)}h ago`;
}

function genuineModelRunAge(modelInitializedAt: string | null | undefined, now: number) {
  const initMs = parseTime(modelInitializedAt);
  if (initMs === null || now < initMs) return null;
  const ageMs = now - initMs;
  return { ageMs, label: `Model run ${relativeAge(ageMs)}` };
}

export function getRetrievalAge(retrievedAt: string | null | undefined, now = Date.now()) {
  const retrievedMs = parseTime(retrievedAt);
  if (retrievedMs === null) return { valid: false as const, ageMs: null, label: "Retrieval time unavailable" };
  if (retrievedMs - now > CLOCK_SKEW_TOLERANCE_MS) {
    return { valid: false as const, ageMs: null, label: "Retrieval time invalid" };
  }
  const ageMs = Math.max(0, now - retrievedMs);
  return { valid: true as const, ageMs, label: `Retrieved ${relativeAge(ageMs)}` };
}

export const MODELLED_STALE_ACTIVITY_GUIDANCE = "Refresh the data or check a local monitoring station. The retrieved forecast data is too old.";
export const MODELLED_UNKNOWN_ACTIVITY_GUIDANCE = "Check a local regulatory monitoring station. The forecast valid time or retrieval time is missing, invalid, or in the future.";

export function describeCurrentActivityGuidance(input: {
  categoryLabel?: string | null;
  categoryAdvice?: string | null;
  freshnessState?: string | null;
}) {
  const state = input.freshnessState;
  if (state !== "stale" && state !== "unavailable") {
    return { blocked: false as const, categoryNote: null, guidance: input.categoryAdvice ?? "" };
  }
  const label = input.categoryLabel && input.categoryLabel !== "Data unavailable" ? input.categoryLabel : null;
  return {
    blocked: true as const,
    categoryNote: label
      ? `US AQI category: ${label}. This classifies the reported number and is not a current activity recommendation.`
      : null,
    guidance: state === "stale" ? MODELLED_STALE_ACTIVITY_GUIDANCE : MODELLED_UNKNOWN_ACTIVITY_GUIDANCE,
  };
}

export function formatReportedWindSpeed(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "N/A";
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return "N/A";
  return `${formatWindSpeed(number)} km/h`;
}

function formatWindSpeed(windSpeedKmh: number) {
  const rounded = Math.round(windSpeedKmh * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatWindRetrieved(ageMs: number) {
  const minutes = Math.round(ageMs / 60000);
  if (minutes < 1) return "Retrieved just now.";
  if (minutes < 60) return `Retrieved ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago.`;
  const hours = Math.round(ageMs / 3600000);
  return `Retrieved ${hours} ${hours === 1 ? "hour" : "hours"} ago.`;
}

function windScoreSentence(speed: string, points: number) {
  return points > 0
    ? `Wind of ${speed} km/h increased the exposure score by 0.5 points.`
    : `Wind of ${speed} km/h was considered; no score adjustment was needed.`;
}

export function describeWindUse(input: {
  windSpeedKmh?: number | string | null;
  weatherRetrievedAt?: string | null;
} | null | undefined, now = Date.now()) {
  const raw = input?.windSpeedKmh;
  const parsed = raw === null || raw === undefined || raw === "" ? null : Number(raw);
  const windSpeedKmh = parsed !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  const retrieval = getRetrievalAge(input?.weatherRetrievedAt, now);
  if (windSpeedKmh === null) {
    return { applied: false, tone: "excluded" as const, state: "excluded_missing_wind", text: "Wind was unavailable and was not used in the exposure score. Missing wind is not treated as favorable." };
  }
  const speed = formatWindSpeed(windSpeedKmh);
  if (!retrieval.valid || retrieval.ageMs === null) {
    return { applied: false, tone: "excluded" as const, state: "excluded_retrieval_time", text: `Wind of ${speed} km/h was excluded from scoring because the weather retrieval time is missing, invalid, or in the future.` };
  }
  if (retrieval.ageMs > RETRIEVAL_STALE_MS) {
    return { applied: false, tone: "excluded" as const, state: "excluded_stale", text: `Wind of ${speed} km/h was excluded from scoring because the weather data is too old. ${formatWindRetrieved(retrieval.ageMs)}` };
  }
  const points = windSpeedKmh < 5 ? 0.5 : 0;
  const retrieved = formatWindRetrieved(retrieval.ageMs);
  if (retrieval.ageMs > RETRIEVAL_AGING_MS) {
    return { applied: true, tone: "aging" as const, state: "included_aging", text: `${windScoreSentence(speed, points)} ${retrieved} The reading may not reflect current conditions.` };
  }
  return { applied: true, tone: "fresh" as const, state: "included", text: `${windScoreSentence(speed, points)} ${retrieved}` };
}

export function getFreshnessPresentation(input: FreshnessInput, now = Date.now()) {
  const modelRun = genuineModelRunAge(input?.modelInitializedAt, now);
  const modelRunAgeLabel = modelRun ? modelRun.label : "Model run age unavailable";
  const retrieval = getRetrievalAge(input?.retrievedAt, now);
  const base = { isFresh: false, modelRunAgeLabel, retrievalAgeLabel: retrieval.label, basis: "retrievedAt" as const };

  if (!input?.forecastValidAt) return { ...base, state: "unavailable", label: "DATA UNAVAILABLE" };
  if (parseTime(input.forecastValidAt) === null) return { ...base, state: "unavailable", label: "TIME UNAVAILABLE" };
  if (!retrieval.valid) return { ...base, state: "unavailable", label: "RETRIEVAL TIME UNAVAILABLE" };
  if (retrieval.ageMs > RETRIEVAL_STALE_MS) return { ...base, state: "stale", label: "OLD RETRIEVED DATA" };
  if (retrieval.ageMs > RETRIEVAL_AGING_MS) return { ...base, state: "aging", label: "FORECAST ESTIMATE" };
  return { ...base, state: "estimate", label: "FORECAST ESTIMATE" };
}

export function formatClockInTimezone(value: string | null | undefined, timezone?: string | null, locale?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  try {
    if (timezone) {
      return new Intl.DateTimeFormat(locale, { ...options, timeZone: timezone }).format(date);
    }
  } catch {
    // Fall back to explicit UTC when the location timezone is invalid.
  }
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC", timeZoneName: "short" }).format(date);
}

export function formatTimingDisclosure(input: {
  forecastValidAt?: string | null;
  modelInitializedAt?: string | null;
  retrievedAt?: string | null;
  timezone?: string | null;
  now?: number;
  locale?: string;
}) {
  const now = input.now ?? Date.now();
  const validClock = formatClockInTimezone(input.forecastValidAt, input.timezone, input.locale);
  const retrievedClock = formatClockInTimezone(input.retrievedAt, input.timezone, input.locale);
  const initClock = formatClockInTimezone(input.modelInitializedAt, input.timezone, input.locale);
  const modelRun = genuineModelRunAge(input.modelInitializedAt, now);
  const retrieval = getRetrievalAge(input.retrievedAt, now);

  const validTimeText = validClock ? `Forecast valid for ${validClock}` : "Forecast valid time unavailable";
  const retrievedTimeText = retrievedClock && retrieval.valid
    ? `Retrieved at ${retrievedClock} (${relativeAge(retrieval.ageMs)})`
    : retrievedClock
      ? `Retrieved at ${retrievedClock}`
      : "Retrieval time unavailable";
  const modelRunText = modelRun
    ? (initClock ? `${modelRun.label} (${initClock})` : modelRun.label)
    : "Model run age unavailable";

  const summary = [validTimeText, retrievedTimeText, modelRunText].filter(Boolean).join(" · ");
  return { validTimeText, retrievedTimeText, modelRunText, summary };
}

export function formatSourceDisclosure(metadata?: ForecastMetadata | null, fallbackSource?: string) {
  if (metadata?.spatialResolution?.verified && metadata?.model?.name && metadata?.spatialResolution?.label) {
    return `Modelled air-quality estimate · ${metadata.model.name} · ${metadata.spatialResolution.label}.`;
  }
  return `Modelled air-quality estimate · ${fallbackSource || "Open-Meteo / CAMS"} · Not a local station observation.`;
}

export function shouldApplyGpsResult(
  startedLocationRevision: number,
  currentLocationRevision: number,
  requestId: number,
  latestRequestId: number,
) {
  return startedLocationRevision === currentLocationRevision && requestId === latestRequestId;
}

export function isLatestRequest(requestId: number, latestRequestId: number) {
  return requestId === latestRequestId;
}
