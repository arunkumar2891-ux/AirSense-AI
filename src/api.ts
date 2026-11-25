import type { AirData } from "./types";
export async function getAirQuality(lat: number, lon: number): Promise<AirData> {
  const response = await fetch(`/api/air-quality?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
  if (!response.ok) throw new Error((await response.json()).error || "Unable to load air quality.");
  return response.json();
}
export async function askAssistant(question: string, profile: object, air: object) {
  const response = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, profile, air }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Assistant request failed.");
  return data as { answer: string; mode: string };
}