import type { AirData, AssistantResponse, GoWindowRequest, GoWindowResponse, LocationResult, Profile } from "./types";

export async function getAirQuality(lat: number, lon: number, signal?: AbortSignal): Promise<AirData> {
  const response = await fetch(`/api/air-quality?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, { signal });
  if (!response.ok) throw new Error((await response.json()).error || "Unable to load air quality.");
  return response.json();
}

export async function askAssistant(question: string, profile: Profile, coords: { lat: number; lon: number }, signal?: AbortSignal) {
  const response = await fetch("/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    // Server fetches trusted environmental data itself; only coordinates are sent.
    body: JSON.stringify({ question, profile, latitude: coords.lat, longitude: coords.lon }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Assistant request failed.");
  return data as AssistantResponse;
}

export async function findGoWindow(request: GoWindowRequest, signal?: AbortSignal): Promise<GoWindowResponse> {
  const response = await fetch("/api/gowindow", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    // The server retrieves the schedule itself. Never send readings or decisions.
    body: JSON.stringify(request),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Activity window request failed.");
  return data as GoWindowResponse;
}

export async function searchLocations(query: string, signal?: AbortSignal): Promise<LocationResult[]> {
  const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Location search failed.");
  return data.results as LocationResult[];
}

export async function reverseGeocode(lat: number, lon: number): Promise<{ label: string }> {
  try {
    const query = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      localityLanguage: "en",
    });
    // BigDataCloud licenses this no-key endpoint for direct browser requests
    // using the device's current GPS position, not for server-side proxying.
    const response = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?${query}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Reverse geocoding unavailable");
    const data = await response.json();
    const city = data.city || data.locality || "";
    const label = [city, data.principalSubdivision || "", data.countryName || ""].filter(Boolean).join(", ");
    if (label) return { label };
  } catch {
    // Fall through to the server's coordinate-free, honest generic label.
  }
  try {
    const fallback = await fetch("/api/reverse-geocode");
    if (fallback.ok) return await fallback.json() as { label: string };
  } catch {
    // Offline fallback below.
  }
  return { label: "Your location" };
}
