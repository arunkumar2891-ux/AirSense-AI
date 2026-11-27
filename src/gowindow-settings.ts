import { DEFAULT_GO_WINDOW_DURATION, DEFAULT_TIME_PREFERENCE, GO_WINDOW_DURATIONS, GO_WINDOW_TIME_PREFERENCES } from "./gowindow";
import type { GoWindowTimePreference, Profile } from "./types";

export const GO_WINDOW_SETTINGS_KEY = "airsense.gowindow";

const ACTIVITIES = new Set([
  "running", "cycling", "outdoor workout", "sports", "commuting", "daily activities", "children's outdoor play",
]);
const AGE_GROUPS = new Set(["adult", "child", "older adult"]);
const SENSITIVITIES = new Set(["general", "respiratory sensitivity", "heart or lung condition"]);
const TIME_PREFERENCES = new Set(GO_WINDOW_TIME_PREFERENCES.map((item) => item.id));
const DURATIONS = new Set<number>(GO_WINDOW_DURATIONS);

export type GoWindowSettings = {
  profile: Profile;
  durationMinutes: number;
  timePreference: GoWindowTimePreference;
};

export function defaultGoWindowSettings(): GoWindowSettings {
  return {
    profile: { activity: "running", ageGroup: "adult", sensitivity: "general" },
    durationMinutes: DEFAULT_GO_WINDOW_DURATION,
    timePreference: DEFAULT_TIME_PREFERENCE,
  };
}

export function isDefaultGoWindowSettings(settings: GoWindowSettings) {
  const fallback = defaultGoWindowSettings();
  return settings.profile.activity === fallback.profile.activity
    && settings.profile.ageGroup === fallback.profile.ageGroup
    && settings.profile.sensitivity === fallback.profile.sensitivity
    && settings.durationMinutes === fallback.durationMinutes
    && settings.timePreference === fallback.timePreference;
}

export function readGoWindowSettings(raw: string | null): GoWindowSettings {
  const fallback = defaultGoWindowSettings();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as { profile?: Profile; durationMinutes?: unknown; timePreference?: unknown };
    const profile = parsed?.profile;
    if (!profile || typeof profile !== "object") return fallback;
    if (!ACTIVITIES.has(profile.activity) || !AGE_GROUPS.has(profile.ageGroup) || !SENSITIVITIES.has(profile.sensitivity)) return fallback;
    if (typeof parsed.durationMinutes !== "number" || !DURATIONS.has(parsed.durationMinutes)) return fallback;
    if (typeof parsed.timePreference !== "string" || !TIME_PREFERENCES.has(parsed.timePreference as GoWindowTimePreference)) return fallback;
    return {
      profile: { activity: profile.activity, ageGroup: profile.ageGroup, sensitivity: profile.sensitivity },
      durationMinutes: parsed.durationMinutes,
      timePreference: parsed.timePreference as GoWindowTimePreference,
    };
  } catch {
    return fallback;
  }
}

export function serializeGoWindowSettings(settings: GoWindowSettings) {
  const stored = readGoWindowSettings(JSON.stringify({
    profile: settings.profile,
    durationMinutes: settings.durationMinutes,
    timePreference: settings.timePreference,
  }));
  if (stored.profile.activity !== settings.profile.activity
    || stored.profile.ageGroup !== settings.profile.ageGroup
    || stored.profile.sensitivity !== settings.profile.sensitivity
    || stored.durationMinutes !== settings.durationMinutes
    || stored.timePreference !== settings.timePreference) return null;
  return JSON.stringify(stored);
}
