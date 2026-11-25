import type { GoWindowRequest, GoWindowResponse, GoWindowResult, GoWindowTimePreference, Profile } from "./types";

export const GO_WINDOW_DURATIONS = [15, 30, 45, 60, 90, 120] as const;
export const DEFAULT_GO_WINDOW_DURATION = 45;
export const DEFAULT_TIME_PREFERENCE: GoWindowTimePreference = "daytime";
export const GO_WINDOW_TIME_PREFERENCES = [
  { id: "any", label: "Any time", optionLabel: "Any time", rangeLabel: "any local time", startMinute: null, endMinute: null },
  { id: "morning", label: "Morning", optionLabel: "Morning (5 AM–12 PM)", rangeLabel: "5 AM–12 PM", startMinute: 5 * 60, endMinute: 12 * 60 },
  { id: "afternoon", label: "Afternoon", optionLabel: "Afternoon (12 PM–5 PM)", rangeLabel: "12 PM–5 PM", startMinute: 12 * 60, endMinute: 17 * 60 },
  { id: "evening", label: "Evening", optionLabel: "Evening (5 PM–10 PM)", rangeLabel: "5 PM–10 PM", startMinute: 17 * 60, endMinute: 22 * 60 },
  { id: "daytime", label: "Daytime", optionLabel: "Daytime (5 AM–10 PM)", rangeLabel: "5 AM–10 PM", startMinute: 5 * 60, endMinute: 22 * 60 },
] as const;
export const SUITABLE_FORECAST_LABEL = "Suitable based on available forecast data.";

const NO_SUITABLE_COPY = "No suitable interval was identified in the available forecast period.";
const INSUFFICIENT_COPY = "A reliable activity window cannot be identified because the required forecast information is unavailable.";

type ScheduleLocation = { lat: number; lon: number };

export function buildGoWindowRequest(
  location: ScheduleLocation,
  profile: Profile,
  durationMinutes: number,
  timePreference: GoWindowTimePreference = DEFAULT_TIME_PREFERENCE,
): GoWindowRequest {
  return {
    latitude: location.lat,
    longitude: location.lon,
    activity: profile.activity,
    profile: {
      activity: profile.activity,
      ageGroup: profile.ageGroup,
      sensitivity: profile.sensitivity,
    },
    durationMinutes,
    timePreference,
  };
}

export function goWindowRequestKey(
  location: ScheduleLocation,
  profile: Profile,
  durationMinutes: number,
  timePreference: GoWindowTimePreference = DEFAULT_TIME_PREFERENCE,
) {
  return JSON.stringify(buildGoWindowRequest(location, profile, durationMinutes, timePreference));
}

export function formatWindowClock(value: string, timeZone: string | null, locale?: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unavailable";
  const options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  try {
    return new Intl.DateTimeFormat(locale, timeZone ? { ...options, timeZone } : { ...options, timeZone: "UTC", timeZoneName: "short" }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC", timeZoneName: "short" }).format(date);
  }
}

function formatSpan(minimum: number, maximum: number, suffix: string) {
  const left = Number.isInteger(minimum) ? String(minimum) : String(Math.round(minimum * 10) / 10);
  const right = Number.isInteger(maximum) ? String(maximum) : String(Math.round(maximum * 10) / 10);
  return minimum === maximum ? `${left}${suffix}` : `${left}–${right}${suffix}`;
}

export function formatForecastAqi(window: GoWindowResult) {
  const category = window.aqi.minimumCategory === window.aqi.maximumCategory
    ? window.aqi.maximumCategory
    : `${window.aqi.minimumCategory} to ${window.aqi.maximumCategory}`;
  return `US AQI ${formatSpan(window.aqi.minimum, window.aqi.maximum, "")} · ${category}`;
}

export function formatForecastPm25(window: GoWindowResult) {
  if (!window.pm25) return "PM2.5 unavailable";
  const label = window.pm25.minimumLabel === window.pm25.maximumLabel
    ? window.pm25.maximumLabel
    : `${window.pm25.minimumLabel} to ${window.pm25.maximumLabel}`;
  return `PM2.5 ${formatSpan(window.pm25.minimum, window.pm25.maximum, ` ${window.pm25.unit}`)} · ${label}`;
}

export function recommendationSentence(label: string) {
  const text = label.trim();
  if (!text) return "Recommendation unavailable";
  return text.endsWith(".") ? text : `${text}.`;
}

export function formatForecastWeather(window: GoWindowResult) {
  const weather = window.weather;
  if (!weather) return "Weather unavailable";
  const parts = [
    weather.temperatureC ? formatSpan(weather.temperatureC.minimum, weather.temperatureC.maximum, "°C") : "",
    weather.windSpeedKmh ? `Wind ${formatSpan(weather.windSpeedKmh.minimum, weather.windSpeedKmh.maximum, " km/h")}` : "",
    weather.relativeHumidityPercent ? `Humidity ${formatSpan(weather.relativeHumidityPercent.minimum, weather.relativeHumidityPercent.maximum, "%")}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Weather unavailable";
}

type GoWindowCard = {
  rank: number;
  best: boolean;
  alternative: boolean;
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
};

function preferencePhrase(result: GoWindowResponse) {
  if (!result.preference || result.preference.outcome === "any") return "";
  return `${result.preference.label} (${result.preference.rangeLabel})`;
}

function viewWindow(window: GoWindowResult, result: GoWindowResponse, index: number, alternative: boolean): GoWindowCard {
  return {
    rank: index + 1,
    best: !alternative && index === 0,
    alternative,
    time: `${formatWindowClock(window.start, window.timezone || result.timezone)} – ${formatWindowClock(window.end, window.timezone || result.timezone)}`,
    activity: window.activity,
    durationMinutes: window.durationMinutes,
    aqi: formatForecastAqi(window),
    pm25: formatForecastPm25(window),
    weather: formatForecastWeather(window),
    rankReason: window.rankReason,
    recommendationLabel: recommendationSentence(window.recommendationLabel),
    freshness: window.dataFreshness?.label || result.forecastFreshness?.label || "Forecast age unavailable",
    limitations: window.limitations || result.limitations,
  };
}

export type GoWindowDisplay =
  | {
      state: "suitable_windows";
      preferenceLabel: string;
      windows: GoWindowCard[];
      limitations: string;
    }
  | {
      state: "outside_preference";
      title: string;
      message: string;
      detail: string;
      guidance: string;
      preferenceLabel: string;
      alternatives: GoWindowCard[];
      limitations: string;
    }
  | { state: "no_suitable_window"; title: string; message: string; detail: string; guidance: string; limitations: string }
  | { state: "insufficient_data"; title: string; message: string; detail: string; guidance: string; limitations: string }
  | { state: "invalid"; message: string };

export function presentGoWindow(result: GoWindowResponse | null): GoWindowDisplay | null {
  if (!result) return null;
  const preferenceLabel = preferencePhrase(result);
  const alternatives = Array.isArray(result.windows)
    ? result.windows.filter((window) => window.placement === "alternative").slice(0, 3)
    : [];
  const preferred = Array.isArray(result.windows)
    ? result.windows.filter((window) => window.placement !== "alternative").slice(0, 3)
    : [];
  if ((result.status === "outside_preference" || (result.status === "suitable_windows" && preferred.length === 0)) && alternatives.length > 0) {
    const label = result.preference?.label || "the selected time";
    const range = result.preference?.rangeLabel;
    return {
      state: "outside_preference",
      title: `No suitable window in ${label}`,
      message: range
        ? `No suitable window was found within ${label} (${range}).`
        : "No suitable window was found within the selected time preference.",
      detail: result.reason,
      guidance: "These alternatives are outside the selected preference and are not the primary recommendation. The current air-quality reading and exposure guidance remain available above.",
      preferenceLabel,
      alternatives: alternatives.map((window, index) => viewWindow(window, result, index, true)),
      limitations: result.limitations,
    };
  }
  if (result.status === "suitable_windows" && preferred.length > 0) {
    return {
      state: "suitable_windows",
      preferenceLabel,
      limitations: result.limitations,
      windows: preferred.map((window, index) => viewWindow(window, result, index, false)),
    };
  }
  if (result.status === "no_suitable_window") {
    return {
      state: "no_suitable_window",
      title: "No suitable window",
      message: NO_SUITABLE_COPY,
      detail: result.reason,
      guidance: "The current air-quality reading and exposure guidance remain available above. This forecast does not change that guidance.",
      limitations: result.limitations,
    };
  }
  if (result.status === "insufficient_data") {
    return {
      state: "insufficient_data",
      title: "Forecast data is insufficient",
      message: INSUFFICIENT_COPY,
      detail: result.reason,
      guidance: "No alternative times are suggested when forecast data is insufficient.",
      limitations: result.limitations,
    };
  }
  return { state: "invalid", message: "The activity window response could not be shown." };
}
