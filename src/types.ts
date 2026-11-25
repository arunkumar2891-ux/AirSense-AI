export type AirData = {
  aqi: number | null; aqiScale: string; status: { label: string; color: string; level: number };
  pollutants: { pm25: number | null; pm10: number | null; ozone: number | null; nitrogenDioxide: number | null; carbonMonoxide: number | null; sulphurDioxide: number | null };
  weather: Record<string, number | string>; hourly: { time: string; aqi: number | null; pm25: number | null; pm10: number | null }[];
  observedAt: string; source: string; attribution: string;
};
export type Profile = { activity: string; ageGroup: string; sensitivity: string };