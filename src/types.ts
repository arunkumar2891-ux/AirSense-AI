export type AirData = {
  aqi: number | null;
  aqiScale: string;
  status: { label: string; color: string; level: number; advice: string };
  pollutants: {
    pm25: number | null;
    pm10: number | null;
    ozone: number | null;
    nitrogenDioxide: number | null;
    carbonMonoxide: number | null;
    sulphurDioxide: number | null;
  };
  weather: Record<string, number | string>;
  hourly: { time: string; aqi: number | null; pm25: number | null; pm10: number | null }[];
  observedAt: string;
  source: string;
  attribution: string;
};
export type Profile = { activity: string; ageGroup: string; sensitivity: string };

export type ExposureDecision = {
  overallRisk: "low" | "moderate" | "high" | "very_high" | "unknown";
  activityRecommendation: "suitable" | "caution" | "avoid" | "insufficient_data";
  recommendedAction: string;
  reasoning: string;
  sensitiveGroupAdvice: string;
  alternativeActivity: string;
  dataFreshness: { state: string; ageMs: number | null; label: string };
  limitations: string;
};

export type AssistantResponse = {
  answer: string;
  mode: string;
  decision?: ExposureDecision;
  structured?: Record<string, string>;
  note?: string;
};
