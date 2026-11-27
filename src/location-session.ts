import { readPreference, type PreferenceStore } from "./browser-store";

export const MANUAL_LOCATION_KEY = "airsense.manual";
export const GPS_LOCATION_KEY = "airsense.gps";

export type SessionLocation = {
  lat: number;
  lon: number;
  label: string;
  source: "gps" | "manual";
};

function parseStoredLocation(raw: string | null, key: string): SessionLocation | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { lat?: unknown; lon?: unknown; label?: unknown };
    if (!Number.isFinite(parsed?.lat) || !Number.isFinite(parsed?.lon) || typeof parsed?.label !== "string" || !parsed.label.trim()) return null;
    return {
      lat: parsed.lat as number,
      lon: parsed.lon as number,
      label: parsed.label,
      source: key === GPS_LOCATION_KEY ? "gps" : "manual",
    };
  } catch {
    return null;
  }
}

export function readStoredLocation(local: PreferenceStore | null, session: PreferenceStore | null, key: string): SessionLocation | null {
  return parseStoredLocation(readPreference(local, session, key), key);
}

// A searched place wins over the saved GPS fix. Both stay in this browser
// until the user clears them. Closing the tab does not return to Chennai.
export function locationForSession(local: PreferenceStore | null, session: PreferenceStore | null = null): SessionLocation | null {
  const manual = readStoredLocation(local, session, MANUAL_LOCATION_KEY);
  if (manual) return { ...manual, source: "manual" };
  const gps = readStoredLocation(local, session, GPS_LOCATION_KEY);
  if (gps) return { ...gps, source: "gps" };
  return null;
}
