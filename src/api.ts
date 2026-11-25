import type { AirData, AssistantResponse, LocationResult, Profile } from "./types";

export async function getAirQuality(lat: number, lon: number): Promise<AirData> {
  const response = await fetch(`/api/air-quality?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
  if (!response.ok) throw new Error((await response.json()).error || "Unable to load air quality.");
  return response.json();
}

export async function askAssistant(question: string, profile: Profile, coords: { lat: number; lon: number }) {
  const response = await fetch("/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Server fetches trusted environmental data itself; only coordinates are sent.
    body: JSON.stringify({ question, profile, latitude: coords.lat, longitude: coords.lon }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Assistant request failed.");
  return data as AssistantResponse;
}

export async function searchLocations(query: string): Promise<LocationResult[]> {
  const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Location search failed.");
  return data.results as LocationResult[];
}

export async function reverseGeocode(lat: number, lon: number): Promise<{ label: string }> {
  const response = await fetch(`/api/reverse-geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Reverse geocoding failed.");
  return data as { label: string };
}
