export type ProviderCell = {
  latitude: number;
  longitude: number;
  elevationMeters: number | null;
  cellKey: string;
};

export type ForecastMetadata = {
  dataClass: "modelled_estimate";
  isModelledEstimate: boolean;
  isStationObservation: boolean;
  provider: string;
  providerCell: ProviderCell | null;
  model: {
    id: string | null;
    name: string | null;
    providerSupplied: boolean;
    basis: string;
  };
  spatialResolution: {
    nominalDegrees: number | null;
    approximateKm: number | null;
    verified: boolean;
    label: string | null;
    servingCellBehavior: string | null;
  };
  timestamps: {
    forecastValidAt: string | null;
    modelInitializedAt: string | null;
    retrievedAt: string | null;
  };
  modelRunAge: {
    available: boolean;
    ageMs: number | null;
    label: string;
  };
  disclosure: string;
  accuracyNotice: string;
};

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
  weatherRetrievedAt?: string | null;
  location: { latitude: number; longitude: number; timezone: string };
  hourly: { time: string; aqi: number | null; pm25: number | null; pm10: number | null }[];
  observedAt: string | null;
  forecastValidAt?: string | null;
  retrievedAt?: string | null;
  modelInitializedAt?: string | null;
  metadata?: ForecastMetadata;
  source: string;
  attribution: string;
};
export type Profile = { activity: string; ageGroup: string; sensitivity: string };

export type LocationResult = {
  name: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
};

export type ExposureDecision = {
  overallRisk: "low" | "moderate" | "high" | "very_high" | "unknown";
  activityRecommendation: "suitable" | "caution" | "avoid" | "insufficient_data";
  recommendedAction: string;
  reasoning: string;
  sensitiveGroupAdvice: string;
  alternativeActivity: string;
  dataFreshness: { state: string; ageMs: number | null; label: string };
  wind?: {
    applied: boolean;
    points: number;
    state: string;
    windSpeedKmh: number | null;
    disclosure: string;
    basis?: "weatherRetrievedAt";
    freshness?: { state: string; ageMs: number | null; label: string; timestamp?: string | null; basis?: string };
  };
  limitations: string;
};

export type AssistantResponse = {
  answer: string;
  mode: string;
  decision?: ExposureDecision;
  structured?: Record<string, string>;
  note?: string;
};

export type GoWindowRange = { minimum: number; maximum: number };

export type GoWindowTimePreference = "any" | "morning" | "afternoon" | "evening" | "daytime";

export type GoWindowRequest = {
  latitude: number;
  longitude: number;
  activity: string;
  profile: Profile;
  durationMinutes: number;
  timePreference?: GoWindowTimePreference;
};

export type GoWindowPreference = {
  id: GoWindowTimePreference;
  label: string;
  rangeLabel: string;
  timezone: string | null;
  outcome: "within" | "outside" | "any" | null;
};

export type GoWindowFreshness = {
  state: string;
  ageMs: number | null;
  label: string;
  basis?: "retrievedAt";
  timestamp?: string | null;
  modelRunAgeMs?: number | null;
  source?: "air" | "weather";
};

export type GoWindowFreshnessPolicy = {
  basis: "retrievedAt";
  freshWithinMs: number;
  staleAfterMs: number;
  clockSkewToleranceMs: number;
  note: string;
};

export type GoWindowResult = {
  start: string;
  end: string;
  timezone: string | null;
  activity: string;
  durationMinutes: number;
  exposureRecommendation: "suitable";
  recommendationLabel: string;
  aqi: GoWindowRange & {
    minimumCategory: string;
    maximumCategory: string;
    scale: string;
  };
  pm25: (GoWindowRange & {
    minimumLabel: string;
    maximumLabel: string;
    unit: string;
  }) | null;
  weather: {
    windSpeedKmh?: GoWindowRange;
    temperatureC?: GoWindowRange;
    relativeHumidityPercent?: GoWindowRange;
  } | null;
  placement?: "preferred" | "alternative";
  rankReason: string;
  dataFreshness: GoWindowFreshness;
  limitations: string;
  estimate: true;
};

export type GoWindowAssessment = {
  futureHours: number;
  suitableHours: number;
  unsuitableHours: number;
  unavailableHours: number;
};

export type GoWindowResponse = {
  status: "suitable_windows" | "no_suitable_window" | "insufficient_data" | "outside_preference";
  activity: string;
  durationMinutes: number | null;
  timezone: string | null;
  timePreference?: GoWindowTimePreference | null;
  preference?: GoWindowPreference | null;
  evaluatedAt: string | null;
  forecastFreshness: GoWindowFreshness;
  sourceFreshness?: {
    air: GoWindowFreshness;
    weather: GoWindowFreshness;
  };
  freshnessPolicy?: GoWindowFreshnessPolicy;
  metadata?: ForecastMetadata;
  windows: GoWindowResult[];
  assessment?: GoWindowAssessment;
  reason: string;
  limitations: string;
  estimate: true;
};
