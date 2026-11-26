import type { GoWindowResponse, GoWindowResult, GoWindowTimePreference } from "./types";
import { formatTimingDisclosure, getAqiPresentation, getRetrievalAge } from "./reliability";
import {
  GO_WINDOW_TIME_PREFERENCES,
  formatForecastAqi,
  formatForecastPm25,
  formatForecastWeather,
  formatWindowClock,
  recommendationSentence,
} from "./gowindow";

const HOUR_MS = 60 * 60 * 1000;
const TIMELINE_HOURS = 12;

export type TimelineHourReading = {
  time: string;
  aqi: number | null;
  pm25: number | null;
  pm10?: number | null;
};

export type TimelineTone = "good" | "caution" | "high" | "missing";

export type TimelineHour = {
  start: string;
  end: string;
  startMs: number;
  endMs: number;
  label: string;
  dateLabel: string;
  dayKey: string;
  showDate: boolean;
  aqi: number | null;
  pm25: number | null;
  aqiText: string;
  pm25Text: string;
  categoryLabel: string;
  tone: TimelineTone;
  forecastState: "available" | "missing" | "conflict";
  inPreference: boolean;
  preferenceText: string;
  windowRole: "none" | "preferred" | "alternative" | "both";
  selectable: false;
  description: string;
};

export type TimelineWindowView = {
  id: string;
  domId: string;
  placement: "preferred" | "alternative";
  best: boolean;
  rank: number;
  shortLabel: string;
  buttonLabel: string;
  time: string;
  activity: string;
  durationMinutes: number;
  aqi: string;
  pm25: string;
  weather: string;
  rankReason: string;
  recommendationLabel: string;
  freshness: string;
  limitations: string;
  caveat: string;
  startMs: number;
  endMs: number;
  leftPercent: number;
  widthPercent: number;
  visible: boolean;
  selectable: true;
};

export type ActivityTimeline = {
  timezone: string;
  timezoneNote: string;
  preferenceLabel: string;
  preferenceCaption: string;
  summary: string;
  freshness: string;
  nowLabel: string;
  nowPercent: number;
  nowDescription: string;
  hours: TimelineHour[];
  windows: TimelineWindowView[];
  emptyWindowsMessage: string;
};

type BuildInput = {
  hourly?: TimelineHourReading[] | null;
  timezone?: string | null;
  timePreference?: GoWindowTimePreference | null;
  result?: GoWindowResponse | null;
  now?: number;
};

function weatherRetrievalText(result: GoWindowResponse | null | undefined, now: number) {
  const weather = result?.sourceFreshness?.weather;
  if (!weather) return "";
  const age = getRetrievalAge(weather.timestamp, now);
  const timing = age.valid ? age.label : "retrieval time unavailable";
  const tone = weather.state === "stale" ? "old" : weather.state === "unknown" ? "unavailable" : weather.state === "aging" ? "aging" : "recent";
  return ` Weather: ${timing} · ${tone}.`;
}

type Clock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function finiteReading(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeSpace(value: string) {
  return value.replace(/[\u202f\u00a0]/g, " ");
}

export function resolveTimelineZone(timeZone?: string | null) {
  if (typeof timeZone === "string" && timeZone.trim()) {
    try {
      Intl.DateTimeFormat("en-US", { timeZone });
      return { timeZone, fallback: false };
    } catch {
      /* use the explicit UTC label below */
    }
  }
  return { timeZone: "UTC", fallback: true };
}

export function localClock(epochMs: number, timeZone: string): Clock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(epochMs));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const hour = read("hour");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: hour === 24 ? 0 : hour,
    minute: read("minute"),
    second: read("second"),
  };
}

export function startOfLocalHour(epochMs: number, timeZone: string) {
  const clock = localClock(epochMs, timeZone);
  const intoHour = ((clock.minute * 60) + clock.second) * 1000 + (Math.abs(epochMs) % 1000);
  return epochMs - intoHour;
}

function dayKey(clock: Clock) {
  return `${clock.year}-${String(clock.month).padStart(2, "0")}-${String(clock.day).padStart(2, "0")}`;
}

function hourLabel(epochMs: number, timeZone: string, withZone: boolean) {
  return normalizeSpace(new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h12",
    timeZoneName: withZone ? "short" : undefined,
  }).format(new Date(epochMs)));
}

function dateLabel(epochMs: number, timeZone: string) {
  return normalizeSpace(new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(new Date(epochMs)));
}

function formatQuantity(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function toneForAqi(value: number | null): TimelineTone {
  if (value === null) return "missing";
  const presentation = getAqiPresentation(value);
  if (presentation.value === null || presentation.level <= 0) return "missing";
  if (presentation.level <= 1) return "good";
  if (presentation.level <= 3) return "caution";
  return "high";
}

function preferenceById(id?: GoWindowTimePreference | null) {
  return GO_WINDOW_TIME_PREFERENCES.find((item) => item.id === (id || "daytime")) || GO_WINDOW_TIME_PREFERENCES[4];
}

function hourInPreference(epochMs: number, timeZone: string, preference: (typeof GO_WINDOW_TIME_PREFERENCES)[number]) {
  if (preference.startMinute === null || preference.endMinute === null) return true;
  const clock = localClock(epochMs, timeZone);
  const minute = clock.hour * 60 + clock.minute;
  return minute >= preference.startMinute && minute < preference.endMinute;
}

function overlaps(start: number, end: number, otherStart: number, otherEnd: number) {
  return start < otherEnd && otherStart < end;
}

type ParsedReading = { timeMs: number; aqi: number | null; pm25: number | null };

function parseReadings(hourly?: TimelineHourReading[] | null): ParsedReading[] {
  if (!Array.isArray(hourly)) return [];
  const parsed: ParsedReading[] = [];
  for (const reading of hourly) {
    if (!reading || typeof reading.time !== "string") continue;
    const timeMs = Date.parse(reading.time);
    if (!Number.isFinite(timeMs)) continue;
    parsed.push({
      timeMs,
      aqi: finiteReading(reading.aqi),
      pm25: finiteReading(reading.pm25),
    });
  }
  return parsed;
}

function readingForHour(readings: ParsedReading[], startMs: number, endMs: number) {
  const inside = readings.filter((reading) => reading.timeMs >= startMs && reading.timeMs < endMs);
  if (inside.length === 0) return { state: "missing" as const, aqi: null, pm25: null };
  const first = inside[0];
  const agrees = inside.every((reading) => reading.aqi === first.aqi && reading.pm25 === first.pm25);
  if (!agrees) return { state: "conflict" as const, aqi: null, pm25: null };
  return { state: "available" as const, aqi: first.aqi, pm25: first.pm25 };
}

function windowZone(window: GoWindowResult, fallback: string) {
  const candidate = window.timezone || fallback;
  return resolveTimelineZone(candidate).timeZone;
}

export function buildActivityTimeline(input: BuildInput): ActivityTimeline | null {
  const now = input.now === undefined ? Date.now() : Number(input.now);
  if (!Number.isFinite(now)) return null;
  const zone = resolveTimelineZone(input.timezone || input.result?.timezone);
  const timeZone = zone.timeZone;
  const preference = preferenceById(input.result?.timePreference || input.timePreference);
  const origin = startOfLocalHour(now, timeZone);
  const span = TIMELINE_HOURS * HOUR_MS;
  const readings = parseReadings(input.hourly);
  const returned = Array.isArray(input.result?.windows) ? input.result.windows : [];
  const preferredSource = returned.filter((window) => window.placement !== "alternative").slice(0, 3);
  const alternativeSource = returned.filter((window) => window.placement === "alternative").slice(0, 3);

  const toView = (window: GoWindowResult, index: number, placement: "preferred" | "alternative"): TimelineWindowView | null => {
    const startMs = Date.parse(window.start);
    const endMs = Date.parse(window.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
    const zoneName = windowZone(window, timeZone);
    const visibleStart = Math.max(startMs, origin);
    const visibleEnd = Math.min(endMs, origin + span);
    const visible = visibleEnd > visibleStart;
    const time = `${formatWindowClock(window.start, zoneName)} – ${formatWindowClock(window.end, zoneName)}`;
    const best = placement === "preferred" && index === 0;
    const shortLabel = placement === "alternative" ? `Alternative ${index + 1}` : best ? "Best" : `Rank ${index + 1}`;
    const caveat = placement === "alternative"
      ? "Outside the preferred time. Not the primary recommendation."
      : "";
    return {
      id: `${placement}:${window.start}:${window.end}`,
      domId: "",
      placement,
      best,
      rank: index + 1,
      shortLabel,
      buttonLabel: "",
      time,
      activity: window.activity,
      durationMinutes: window.durationMinutes,
      aqi: formatForecastAqi(window),
      pm25: formatForecastPm25(window),
      weather: formatForecastWeather(window),
      rankReason: window.rankReason,
      recommendationLabel: recommendationSentence(window.recommendationLabel),
      freshness: `${input.result?.metadata?.timestamps
        ? `${formatTimingDisclosure({
          forecastValidAt: input.result.metadata.timestamps.forecastValidAt,
          modelInitializedAt: input.result.metadata.timestamps.modelInitializedAt,
          retrievedAt: input.result.metadata.timestamps.retrievedAt,
          timezone: window.timezone || timeZone,
          now,
        }).summary}.`
        : window.dataFreshness?.label || input.result?.forecastFreshness?.label || "Model run age unavailable."}${weatherRetrievalText(input.result, now)}`,
      limitations: window.limitations || input.result?.limitations || "",
      caveat,
      startMs,
      endMs,
      leftPercent: visible ? ((visibleStart - origin) / span) * 100 : 0,
      widthPercent: visible ? ((visibleEnd - visibleStart) / span) * 100 : 0,
      visible,
      selectable: true,
    };
  };

  const windows = [
    ...preferredSource.map((window, index) => toView(window, index, "preferred")),
    ...alternativeSource.map((window, index) => toView(window, index, "alternative")),
  ].filter((window): window is TimelineWindowView => window !== null)
    .map((window, index) => {
      const outside = window.visible ? "" : " Outside the displayed 12 hours.";
      const buttonLabel = `${window.shortLabel}, ${window.time}, ${window.durationMinutes} minutes. ${window.aqi}. ${window.pm25}. ${window.weather}. ${window.caveat}${outside}`.replace(/\s+/g, " ").trim();
      return { ...window, domId: `timeline-window-${index}`, buttonLabel };
    });

  const draftHours = Array.from({ length: TIMELINE_HOURS }, (_, index) => {
    const startMs = origin + index * HOUR_MS;
    const endMs = startMs + HOUR_MS;
    const clock = localClock(startMs, timeZone);
    const reading = readingForHour(readings, startMs, endMs);
    const presentation = reading.aqi === null ? null : getAqiPresentation(reading.aqi);
    const categoryLabel = reading.state === "conflict"
      ? "Forecast conflict"
      : reading.state === "missing"
        ? "No forecast"
        : presentation && presentation.value !== null
          ? presentation.label
          : "US AQI unavailable";
    const aqiText = reading.state === "conflict"
      ? "Forecast conflict — readings were not combined"
      : reading.aqi === null
        ? "US AQI unavailable"
        : `US AQI ${formatQuantity(reading.aqi)} · ${categoryLabel}`;
    const pm25Text = reading.state === "conflict"
      ? "PM2.5 unavailable"
      : reading.pm25 === null
        ? "PM2.5 unavailable"
        : `PM2.5 ${formatQuantity(reading.pm25)} µg/m³`;
    const inPreference = hourInPreference(startMs, timeZone, preference);
    return {
      startMs,
      endMs,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      label: hourLabel(startMs, timeZone, false),
      zonedLabel: hourLabel(startMs, timeZone, true),
      dateLabel: dateLabel(startMs, timeZone),
      dayKey: dayKey(clock),
      aqi: reading.state === "available" ? reading.aqi : null,
      pm25: reading.state === "available" ? reading.pm25 : null,
      aqiText,
      pm25Text,
      categoryLabel,
      tone: reading.state === "available" ? toneForAqi(reading.aqi) : "missing",
      forecastState: reading.state,
      inPreference,
    };
  });

  const labelCounts = new Map<string, number>();
  for (const hour of draftHours) labelCounts.set(hour.label, (labelCounts.get(hour.label) || 0) + 1);

  const hours: TimelineHour[] = draftHours.map((hour, index) => {
    const covering = windows.filter((window) => overlaps(hour.startMs, hour.endMs, window.startMs, window.endMs));
    const hasPreferred = covering.some((window) => window.placement === "preferred");
    const hasAlternative = covering.some((window) => window.placement === "alternative");
    const windowRole = hasPreferred && hasAlternative ? "both" : hasPreferred ? "preferred" : hasAlternative ? "alternative" : "none";
    const repeated = (labelCounts.get(hour.label) || 0) > 1;
    const label = repeated ? hour.zonedLabel : hour.label;
    const showDate = index === 0 || hour.dayKey !== draftHours[index - 1].dayKey;
    const preferenceText = preference.id === "any"
      ? "Inside the Any time range"
      : hour.inPreference
        ? `Inside preferred time, ${preference.optionLabel}`
        : `Outside preferred time, ${preference.optionLabel}`;
    const coverageText = covering.length
      ? covering.map((window) => window.placement === "alternative"
        ? `Overlaps alternative window ${window.time}. Not the primary recommendation.`
        : `Overlaps recommended window ${window.time}.`).join(" ")
      : "No recommended window was returned for this hour.";
    const missingText = hour.forecastState === "missing" ? "Missing forecast readings are not estimated." : "";
    const description = [label, showDate ? hour.dateLabel : "", hour.aqiText, hour.pm25Text, preferenceText, coverageText, missingText]
      .filter(Boolean)
      .join(". ");
    return {
      start: hour.start,
      end: hour.end,
      startMs: hour.startMs,
      endMs: hour.endMs,
      label,
      dateLabel: hour.dateLabel,
      dayKey: hour.dayKey,
      showDate,
      aqi: hour.aqi,
      pm25: hour.pm25,
      aqiText: hour.aqiText,
      pm25Text: hour.pm25Text,
      categoryLabel: hour.categoryLabel,
      tone: hour.tone,
      forecastState: hour.forecastState,
      inPreference: hour.inPreference,
      preferenceText,
      windowRole,
      selectable: false,
      description,
    };
  });

  const nowLabel = hourLabel(now, timeZone, false);
  const nowPercent = Math.min(100, Math.max(0, ((now - origin) / span) * 100));
  const freshness = `${input.result?.metadata?.timestamps
    ? `${formatTimingDisclosure({
      forecastValidAt: input.result.metadata.timestamps.forecastValidAt,
      modelInitializedAt: input.result.metadata.timestamps.modelInitializedAt,
      retrievedAt: input.result.metadata.timestamps.retrievedAt,
      timezone: timeZone,
      now,
    }).summary}.`
    : input.result?.forecastFreshness?.label || "Model run age unavailable."}${weatherRetrievalText(input.result, now)}`;
  const timezoneNote = zone.fallback
    ? "The location timezone was unavailable, so these hour labels use UTC."
    : `Times use ${timeZone}.`;
  const preferenceCaption = preference.id === "any"
    ? "Preferred time: Any time. The shaded range is the full 12 hours and is not an activity recommendation."
    : `Preferred time: ${preference.optionLabel}. Shading marks that local range and is not an activity recommendation.`;
  const emptyWindowsMessage = input.result
    ? "No recommended window was returned for this forecast. Hours stay informational and cannot be selected as activities."
    : "Find a time to place scheduler windows on this timeline. Hours show the forecast only and cannot be selected as activities.";

  return {
    timezone: timeZone,
    timezoneNote,
    preferenceLabel: preference.optionLabel,
    preferenceCaption,
    summary: `${timezoneNote} ${freshness} Forecast model estimate. This timeline does not change the current air-quality reading. Hour colors describe the forecast US AQI category and do not decide a recommendation.`,
    freshness,
    nowLabel,
    nowPercent,
    nowDescription: `Current local time is ${nowLabel}.`,
    hours,
    windows,
    emptyWindowsMessage,
  };
}
