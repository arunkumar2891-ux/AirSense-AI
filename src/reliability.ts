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

export function getFreshnessPresentation(observedAt: string | null | undefined, now = Date.now()) {
  if (!observedAt) return { state: "unavailable", label: "DATA UNAVAILABLE", isFresh: false };
  const observed = Date.parse(observedAt);
  const age = now - observed;
  if (!Number.isFinite(observed) || age < 0) {
    return { state: "unavailable", label: "TIME UNAVAILABLE", isFresh: false };
  }
  if (age <= 30 * 60 * 1000) return { state: "fresh", label: "FRESH MODEL DATA", isFresh: true };
  if (age <= 3 * 60 * 60 * 1000) return { state: "aging", label: "AGING MODEL DATA", isFresh: false };
  return { state: "stale", label: "STALE MODEL DATA", isFresh: false };
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
