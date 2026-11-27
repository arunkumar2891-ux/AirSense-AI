export const MANUAL_LOCATION_KEY = "airsense.manual";
export const GPS_LOCATION_KEY = "airsense.gps";

export type SessionLocation = {
  lat: number;
  lon: number;
  label: string;
  source: "gps" | "manual";
};

export function readStoredLocation(storage: Pick<Storage, "getItem"> | null, key: string): SessionLocation | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { lat?: unknown; lon?: unknown; label?: unknown; source?: unknown };
    if (!Number.isFinite(parsed?.lat) || !Number.isFinite(parsed?.lon) || typeof parsed?.label !== "string" || !parsed.label.trim()) return null;
    return {
      lat: parsed.lat as number,
      lon: parsed.lon as number,
      label: parsed.label,
      source: parsed.source === "gps" ? "gps" : "manual",
    };
  } catch {
    return null;
  }
}

// A searched place wins over the saved GPS fix. GPS is restored before the
// default city so a refresh keeps the current location chosen in this tab.
export function locationForSession(storage: Pick<Storage, "getItem"> | null): SessionLocation | null {
  const manual = readStoredLocation(storage, MANUAL_LOCATION_KEY);
  if (manual) return { ...manual, source: "manual" };
  const gps = readStoredLocation(storage, GPS_LOCATION_KEY);
  if (gps) return { ...gps, source: "gps" };
  return null;
}
