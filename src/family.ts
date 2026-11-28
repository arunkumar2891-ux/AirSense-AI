import { GO_WINDOW_TIME_PREFERENCES } from "./gowindow";
import type {
  FamilyGuidanceCard,
  FamilyAgeBand,
  FamilyHousehold,
  FamilyPlanRequest,
  FamilyPlanResponse,
  FamilyRoutine,
  FamilySensitivity,
  GoWindowTimePreference,
} from "./types";

export const FAMILY_STORAGE_KEY = "airsense.family.household";
export const INDOOR_NOT_MEASURED = "Indoor air quality has not been measured by AirSense AI.";
export const EMISSIONS_QUALITATIVE_TEXT = "Emissions guidance is qualitative only. No emissions quantity is calculated.";
export const MODELLED_LIMITATION = "Modelled estimate. Not a street-level measurement.";

export const FAMILY_SENSITIVITIES = [
  ["general", "General"],
  ["respiratory sensitivity", "Respiratory sensitivity"],
  ["heart or lung condition", "Heart or lung condition"],
] as const;

export const FAMILY_ROUTINES = [
  ["running", "Running"],
  ["cycling", "Cycling"],
  ["outdoor workout", "Outdoor workout"],
  ["sports", "Sports"],
  ["commuting", "Commuting"],
  ["daily activities", "Daily activities"],
  ["children's outdoor play", "Children's outdoor play"],
] as const;

const ROUTINE_IDS = new Set<string>(FAMILY_ROUTINES.map(([id]) => id));
const SENSITIVITY_IDS = new Set<string>(FAMILY_SENSITIVITIES.map(([id]) => id));
const TIME_IDS = new Set<string>(GO_WINDOW_TIME_PREFERENCES.map((item) => item.id));
const SHARED_ROUTINE_PRIORITY = ["running", "cycling", "outdoor workout", "sports", "daily activities"] as const;
const DRAFT_KEYS = new Set([
  "youngChildren", "olderChildren", "adults", "olderAdults", "sensitivity", "routines", "durationMinutes", "timePreference",
]);
const MAX_BAND = 8;
const MAX_HOUSEHOLD = 12;
const MAX_ROUTINES = 4;

export type FamilyDraft = {
  youngChildren: number;
  olderChildren: number;
  adults: number;
  olderAdults: number;
  sensitivity: FamilySensitivity;
  routines: FamilyRoutine[];
  durationMinutes: number;
  timePreference: GoWindowTimePreference;
};

const RECOMMENDATION_LABEL: Record<string, string> = {
  suitable: "Suitable",
  caution: "Caution",
  avoid: "Avoid",
  insufficient_data: "Insufficient data",
};

const RISK_LABEL: Record<string, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  very_high: "Very high",
  unknown: "Unknown",
};

export function defaultFamilyHousehold(): FamilyDraft {
  return {
    youngChildren: 1,
    olderChildren: 0,
    adults: 0,
    olderAdults: 0,
    sensitivity: "general",
    routines: ["children's outdoor play"],
    durationMinutes: 45,
    timePreference: "daytime",
  };
}

export function sharedOutingActivity(draft: Pick<FamilyDraft, "youngChildren" | "olderChildren" | "routines">) {
  if (draft.youngChildren > 0 || draft.olderChildren > 0) return "children's outdoor play";
  return SHARED_ROUTINE_PRIORITY.find((activity) => draft.routines.includes(activity)) ?? "daily activities";
}

function wholeCount(value: unknown) {
  return typeof value === "number" && Number.isInteger(value);
}

export function validateFamilyDraft(draft: FamilyDraft): { ok: true } | { ok: false; error: string } {
  const counts = [draft.youngChildren, draft.olderChildren, draft.adults, draft.olderAdults];
  if (counts.some((count) => !wholeCount(count) || count < 0 || count > MAX_BAND)) {
    return { ok: false, error: "Each age band count must be a whole number from 0 to 8." };
  }
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total < 1 || total > MAX_HOUSEHOLD) {
    return { ok: false, error: "Household size must be from 1 to 12 people." };
  }
  if (!SENSITIVITY_IDS.has(draft.sensitivity)) {
    return { ok: false, error: "Sensitivity must be general, respiratory sensitivity, or heart or lung condition." };
  }
  if (!Array.isArray(draft.routines) || draft.routines.length > MAX_ROUTINES) {
    return { ok: false, error: "Choose at most 4 daily routines." };
  }
  if (draft.routines.some((routine, index) => !ROUTINE_IDS.has(routine) || draft.routines.indexOf(routine) !== index)) {
    return { ok: false, error: "Each routine must be one of the existing activities, listed once." };
  }
  if (!wholeCount(draft.durationMinutes) || draft.durationMinutes < 15 || draft.durationMinutes > 180) {
    return { ok: false, error: "Outing duration must be a whole number of minutes from 15 to 180." };
  }
  if (!TIME_IDS.has(draft.timePreference)) {
    return { ok: false, error: "Time preference must be any, morning, afternoon, evening, or daytime." };
  }
  return { ok: true };
}

export function householdFromDraft(draft: FamilyDraft): { ok: true; household: FamilyHousehold } | { ok: false; error: string } {
  const parsed = validateFamilyDraft(draft);
  if (!parsed.ok) return parsed;
  const bands: [FamilyAgeBand, number][] = [
    ["young_child", draft.youngChildren],
    ["older_child", draft.olderChildren],
    ["adult", draft.adults],
    ["older_adult", draft.olderAdults],
  ];
  return {
    ok: true,
    household: {
      members: bands.filter(([, count]) => count > 0).map(([ageBand, count]) => ({ ageBand, count })),
      sensitivity: draft.sensitivity,
      routines: [...draft.routines],
      outing: {
        activity: sharedOutingActivity(draft),
        durationMinutes: draft.durationMinutes,
        timePreference: draft.timePreference,
      },
    },
  };
}

export function buildFamilyPlanRequest(
  location: { lat: number; lon: number },
  draft: FamilyDraft,
  explain = false,
): FamilyPlanRequest | null {
  const household = householdFromDraft(draft);
  if (!household.ok) return null;
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lon)) return null;
  const request: FamilyPlanRequest = { latitude: location.lat, longitude: location.lon, household: household.household };
  if (explain) request.explain = true;
  return request;
}

export function familyPlanRequestKey(location: { lat: number; lon: number }, draft: FamilyDraft) {
  const request = buildFamilyPlanRequest(location, draft);
  if (!request) {
    const parsed = validateFamilyDraft(draft);
    return `invalid:${parsed.ok ? "location" : parsed.error}`;
  }
  return JSON.stringify(request);
}

export function canStartFamilyExplanation(state: {
  explainLoading: boolean;
  explainPending: boolean;
  planLoading: boolean;
  planPending: boolean;
}) {
  return !state.explainLoading && !state.explainPending && !state.planLoading && !state.planPending;
}

export function canApplyFamilyExplanation(input: {
  requestId: number;
  latestRequestId: number;
  requestKey: string;
  currentKey: string;
}) {
  return input.requestId === input.latestRequestId && input.requestKey === input.currentKey;
}

export function familyPlanForDisplay(
  plan: FamilyPlanResponse | null | undefined,
  requestedExplanation: FamilyPlanResponse["explanation"] | null | undefined,
): FamilyPlanResponse | null {
  if (!plan) return null;
  const mode = requestedExplanation?.mode;
  const body = typeof requestedExplanation?.text === "string" ? requestedExplanation.text.trim() : "";
  const accepted = (mode === "ai" || mode === "rules" || mode === "rules-fallback") && body;
  if (!accepted) {
    const displayed = { ...plan };
    delete displayed.explanation;
    return displayed;
  }
  return { ...plan, explanation: { mode, text: body } };
}

export function serializeFamilyHousehold(draft: FamilyDraft) {
  if (!validateFamilyDraft(draft).ok) return null;
  return JSON.stringify({
    youngChildren: draft.youngChildren,
    olderChildren: draft.olderChildren,
    adults: draft.adults,
    olderAdults: draft.olderAdults,
    sensitivity: draft.sensitivity,
    routines: draft.routines,
    durationMinutes: draft.durationMinutes,
    timePreference: draft.timePreference,
  });
}

function isDraftShape(value: unknown): value is FamilyDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !DRAFT_KEYS.has(key))) return false;
  return DRAFT_KEYS.size === Object.keys(record).length;
}

export function readStoredHousehold(raw: string | null): FamilyDraft {
  const fallback = defaultFamilyHousehold();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!isDraftShape(parsed) || !validateFamilyDraft(parsed).ok) return fallback;
    return {
      youngChildren: parsed.youngChildren,
      olderChildren: parsed.olderChildren,
      adults: parsed.adults,
      olderAdults: parsed.olderAdults,
      sensitivity: parsed.sensitivity,
      routines: [...parsed.routines],
      durationMinutes: parsed.durationMinutes,
      timePreference: parsed.timePreference,
    };
  } catch {
    return fallback;
  }
}

export function loadFamilyHousehold(storage: { getItem(key: string): string | null } | null) {
  try {
    return readStoredHousehold(storage?.getItem(FAMILY_STORAGE_KEY) ?? null);
  } catch {
    return defaultFamilyHousehold();
  }
}

function recommendationLabel(value: string | undefined) {
  if (!value || !Object.prototype.hasOwnProperty.call(RECOMMENDATION_LABEL, value)) return "Insufficient data";
  return RECOMMENDATION_LABEL[value];
}

function knownRecommendation(value: string | undefined): value is "suitable" | "caution" | "avoid" | "insufficient_data" {
  return value === "suitable" || value === "caution" || value === "avoid" || value === "insufficient_data";
}

const MEMBER_GROUP_LABEL: Record<string, string> = {
  child: "Children",
  "older adult": "Older adults",
  adult: "Adults",
};

function memberGroupLabel(ageGroup: string | undefined, count: number | undefined) {
  const base = ageGroup && Object.prototype.hasOwnProperty.call(MEMBER_GROUP_LABEL, ageGroup) ? MEMBER_GROUP_LABEL[ageGroup] : "";
  if (!base) return "";
  return typeof count === "number" && Number.isInteger(count) && count > 0 ? `${base} (${count})` : base;
}

type MemberView = { key: string; label: string; recommendationLabel: string; governs: boolean };

function memberViews(members: { ageGroup?: string; count?: number; activityRecommendation?: string; governs?: boolean }[] | undefined): MemberView[] {
  if (!Array.isArray(members)) return [];
  const views = members.flatMap((member) => {
    const label = memberGroupLabel(member?.ageGroup, member?.count);
    if (!label || typeof member.ageGroup !== "string") return [];
    return [{
      key: member.ageGroup,
      label,
      recommendationLabel: recommendationLabel(member.activityRecommendation),
      governs: member.governs === true,
    }];
  });
  const differ = views.some((view) => view.recommendationLabel !== views[0].recommendationLabel);
  return views.map((view) => ({ ...view, governs: view.governs && differ }));
}

function travelView(item: NonNullable<FamilyPlanResponse["activeTravel"]>["walking"]) {
  const recommendation = item?.decision?.activityRecommendation;
  const eligible = item?.eligible === true && (recommendation === "suitable" || recommendation === "caution");
  return {
    eligible,
    eligibilityLabel: eligible ? "Eligible" : "Not eligible",
    engineActivity: item?.engineActivity || "Unavailable",
    recommendationLabel: recommendationLabel(recommendation),
    members: memberViews(item?.members),
  };
}

export type FamilyPlanView = {
  ok: true;
  recommendation: "suitable" | "caution" | "avoid" | "insufficient_data";
  recommendationLabel: string;
  riskLabel: string;
  action: string;
  reasoning: string;
  factors: { factor: string; detail: string }[];
  outingProfile: string;
  members: MemberView[];
  householdRuleNote: string;
  childPresent: boolean;
  scheduleStatus: string;
  commute: {
    label: "Adult-only commute";
    appliesToChildren: false;
    recommendationLabel: string;
    action: string;
  } | null;
  walking: ReturnType<typeof travelView>;
  cycling: ReturnType<typeof travelView>;
  indoor: { unmeasured: boolean; statement: string; recommendations: FamilyGuidanceCard[] };
  routines: FamilyGuidanceCard[];
  sustainable: { qualitative: boolean; statement: string; recommendations: FamilyGuidanceCard[] };
  impacts: FamilyGuidanceCard[];
  limitations: string[];
  explanation: {
    mode: "ai" | "rules" | "rules-fallback";
    text: string;
    label: string | null;
  } | null;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function impactTypeLabel(impactType: string) {
  if (impactType === "personal_exposure") return "Personal exposure";
  if (impactType === "indoor_pollution_sources") return "Indoor pollution sources";
  if (impactType === "ambient_emissions") return "Potential ambient emissions";
  return "Impact";
}

function guidanceCard(value: unknown): FamilyGuidanceCard | null {
  if (!value || typeof value !== "object") return null;
  const card = value as FamilyGuidanceCard;
  const fields = ["id", "category", "title", "description", "whyItHelps", "impactType", "limitations"] as const;
  if (fields.some((field) => typeof card[field] !== "string" || card[field].trim() === "")) return null;
  return {
    id: card.id,
    category: card.category,
    title: card.title,
    description: card.description,
    whyItHelps: card.whyItHelps,
    impactType: card.impactType,
    limitations: card.limitations,
  };
}

function guidanceCards(value: unknown) {
  return Array.isArray(value) ? value.map(guidanceCard).filter((card): card is FamilyGuidanceCard => card !== null) : [];
}

function presentExplanation(value: FamilyPlanResponse["explanation"]) {
  const body = text(value?.text);
  if (!body || (value?.mode !== "ai" && value?.mode !== "rules" && value?.mode !== "rules-fallback")) return null;
  return {
    mode: value.mode,
    text: body,
    label: value.mode === "ai" ? "AI-generated" : null,
  };
}

export function presentFamilyPlan(plan: FamilyPlanResponse | null | undefined): FamilyPlanView | { ok: false; message: string } {
  const decision = plan?.decision;
  const recommendation = decision?.activityRecommendation;
  if (!plan || plan.ok !== true || !decision || !knownRecommendation(recommendation) || !plan.schedule) {
    return { ok: false, message: "The family plan response could not be shown." };
  }
  const childPresent = plan.basis?.childPresent === true;
  const members = memberViews(plan.members);
  const commuteDecision = plan.adultOnlyCommute?.decision;
  const routineCards = guidanceCards(plan.routineRecommendations);
  const indoorCards = guidanceCards(plan.indoorGuidance?.recommendations);
  const indoorUnmeasured = plan.indoorMeasurementStatus === "not_measured" || plan.indoorAirUnmeasured === true;
  const limitations = [
    MODELLED_LIMITATION,
    text(decision.limitations),
    text(plan.schedule.limitations),
    text(plan.schedule.metadata?.accuracyNotice),
    text(plan.schedule.metadata?.disclosure),
    text(plan.schedule.freshnessPolicy?.note),
    text(plan.retrieval?.decisionFreshness?.label) ? `Current decision freshness: ${plan.retrieval?.decisionFreshness?.label}` : "",
    text(plan.retrieval?.forecastFreshness?.label) ? `Forecast freshness: ${plan.retrieval?.forecastFreshness?.label}` : "",
  ].filter((item, index, all) => item && all.indexOf(item) === index);
  return {
    ok: true,
    recommendation,
    recommendationLabel: recommendationLabel(recommendation),
    riskLabel: RISK_LABEL[decision.overallRisk] || "Unknown",
    action: text(decision.recommendedAction) || "No action text was returned.",
    reasoning: text(decision.reasoning) || "No reasoning text was returned.",
    factors: (decision.trace?.factors || [])
      .filter((factor) => factor && typeof factor.factor === "string")
      .map((factor) => ({ factor: factor.factor, detail: text(factor.detail) || "No detail returned." })),
    outingProfile: [plan.governingProfile?.activity, plan.governingProfile?.sensitivity].filter(Boolean).join(" · ") || "Unavailable",
    members,
    householdRuleNote: members.length > 1
      ? "Every household member group is checked. The most protective result applies to the household."
      : "The household decision uses the profile of the only member group.",
    childPresent,
    scheduleStatus: plan.schedule.status,
    commute: plan.adultOnlyCommute ? {
      label: "Adult-only commute",
      appliesToChildren: false,
      recommendationLabel: recommendationLabel(commuteDecision?.activityRecommendation),
      action: text(commuteDecision?.recommendedAction) || "No commute action was returned.",
    } : null,
    walking: travelView(plan.activeTravel?.walking),
    cycling: travelView(plan.activeTravel?.cycling),
    indoor: {
      unmeasured: indoorUnmeasured,
      statement: text(plan.indoorGuidance?.measurementStatement) || (indoorUnmeasured ? INDOOR_NOT_MEASURED : "Indoor measurement status was not confirmed."),
      recommendations: indoorCards,
    },
    routines: routineCards.filter((card) => card.category === "routine"),
    sustainable: {
      qualitative: plan.emissionsImpactStatus === "qualitative_only" || plan.emissionsSavingsQuantified === false,
      statement: plan.emissionsImpactStatus === "qualitative_only" || plan.emissionsSavingsQuantified === false
        ? EMISSIONS_QUALITATIVE_TEXT
        : "Emissions status was not confirmed.",
      recommendations: routineCards.filter((card) => card.category === "sustainable"),
    },
    impacts: guidanceCards(plan.impactExplanations),
    limitations,
    explanation: presentExplanation(plan.explanation),
  };
}
