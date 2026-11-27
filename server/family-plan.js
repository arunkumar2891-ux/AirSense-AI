import { buildExposureDecision } from "./logic.js";
import { findGoWindows, TIME_PREFERENCES } from "./gowindow.js";

// Household bands are planner inputs. The exposure engine still has only
// child, adult, and older adult. Both child bands use that one child profile.
const AGE_BAND_TO_GROUP = Object.freeze({
  young_child: "child",
  older_child: "child",
  adult: "adult",
  older_adult: "older adult",
});

const SENSITIVITIES = new Set(["general", "respiratory sensitivity", "heart or lung condition"]);
const ROUTINES = new Set([
  "running",
  "cycling",
  "outdoor workout",
  "sports",
  "commuting",
  "daily activities",
  "children's outdoor play",
]);
const CHILD_ACTIVITY = "children's outdoor play";
const GENERAL_ACTIVITY = "daily activities";
const WALKING_ACTIVITY = "daily activities";
const CYCLING_ACTIVITY = "cycling";
// Vigorous routines share one existing weight. The first configured one is a
// stable choice and is stricter than daily activities. Commuting stays on the
// separate adult-only result. Children's outdoor play is never an adult outing.
const SHARED_ROUTINE_PRIORITY = Object.freeze([
  "running",
  "cycling",
  "outdoor workout",
  "sports",
  "daily activities",
]);
const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 180;
const MAX_MEMBER_COUNT = 8;
const MAX_HOUSEHOLD_COUNT = 12;
const MAX_ROUTINES = 4;
const RECOMMENDATION_RANK = { suitable: 0, caution: 1, avoid: 2 };

const HOUSEHOLD_KEYS = new Set(["members", "sensitivity", "routines", "outing"]);
const MEMBER_KEYS = new Set(["ageBand", "count"]);
const OUTING_KEYS = new Set(["activity", "durationMinutes", "timePreference"]);

function invalid(error) {
  return { ok: false, error };
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unknownKeys(value, allowed) {
  return Object.keys(value).filter((key) => !allowed.has(key));
}

function lessRestrictive(other, governing) {
  if (!Object.hasOwn(RECOMMENDATION_RANK, other) || !Object.hasOwn(RECOMMENDATION_RANK, governing)) return false;
  return RECOMMENDATION_RANK[other] < RECOMMENDATION_RANK[governing];
}

function eligible(decision) {
  const recommendation = decision?.activityRecommendation;
  return recommendation === "suitable" || recommendation === "caution";
}

function validateMembers(members) {
  if (!Array.isArray(members) || members.length === 0 || members.length > Object.keys(AGE_BAND_TO_GROUP).length) {
    return { error: "Household members must list at least one age band." };
  }
  const counts = { young_child: 0, older_child: 0, adult: 0, older_adult: 0 };
  const seen = new Set();
  for (const member of members) {
    if (!plainObject(member) || unknownKeys(member, MEMBER_KEYS).length > 0) {
      return { error: "Household members cannot include names or other personal details." };
    }
    if (!Object.hasOwn(AGE_BAND_TO_GROUP, member.ageBand)) {
      return { error: "Age band must be young_child, older_child, adult, or older_adult." };
    }
    if (seen.has(member.ageBand)) return { error: "Each age band can be listed only once." };
    if (!Number.isInteger(member.count) || member.count < 1 || member.count > MAX_MEMBER_COUNT) {
      return { error: "Each age band count must be a whole number from 1 to 8." };
    }
    seen.add(member.ageBand);
    counts[member.ageBand] = member.count;
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total > MAX_HOUSEHOLD_COUNT) return { error: "Household size cannot exceed 12 people." };
  return { counts };
}

function validateHousehold(household) {
  if (!plainObject(household) || unknownKeys(household, HOUSEHOLD_KEYS).length > 0) {
    return { error: "Household configuration has an unsupported field." };
  }
  const members = validateMembers(household.members);
  if (members.error) return members;
  if (!SENSITIVITIES.has(household.sensitivity)) {
    return { error: "Sensitivity must be general, respiratory sensitivity, or heart or lung condition." };
  }
  if (!Array.isArray(household.routines) || household.routines.length > MAX_ROUTINES) {
    return { error: "Household routines must be a list of at most 4 activities." };
  }
  const routines = [];
  for (const routine of household.routines) {
    if (!ROUTINES.has(routine) || routines.includes(routine)) {
      return { error: "Each routine must be one of the existing activities, listed once." };
    }
    routines.push(routine);
  }
  if (!plainObject(household.outing) || unknownKeys(household.outing, OUTING_KEYS).length > 0) {
    return { error: "The shared outing has an unsupported field." };
  }
  if (!Number.isInteger(household.outing.durationMinutes)
    || household.outing.durationMinutes < MIN_DURATION_MINUTES
    || household.outing.durationMinutes > MAX_DURATION_MINUTES) {
    return { error: "Outing duration must be a whole number of minutes from 15 to 180." };
  }
  const timePreference = household.outing.timePreference;
  if (timePreference !== undefined && timePreference !== null && !Object.hasOwn(TIME_PREFERENCES, timePreference)) {
    return { error: "Time preference must be any, morning, afternoon, evening, or daytime." };
  }
  const childPresent = members.counts.young_child + members.counts.older_child > 0;
  const shared = selectSharedActivity(childPresent, routines);
  if (household.outing.activity !== undefined && household.outing.activity !== shared.activity) {
    return { error: "The shared outing activity does not match this household." };
  }
  return {
    counts: members.counts,
    sensitivity: household.sensitivity,
    routines,
    durationMinutes: household.outing.durationMinutes,
    timePreference: timePreference === null ? undefined : timePreference,
    shared,
  };
}

function selectSharedActivity(childPresent, routines) {
  if (childPresent) return { activity: CHILD_ACTIVITY, source: "child_present" };
  const configured = SHARED_ROUTINE_PRIORITY.find((activity) => routines.includes(activity));
  if (configured) return { activity: configured, source: "routine" };
  return { activity: GENERAL_ACTIVITY, source: "general_default" };
}

function governingAge(counts) {
  const childCount = counts.young_child + counts.older_child;
  if (childCount > 0) {
    return { ageGroup: "child", reason: "child_present" };
  }
  if (counts.older_adult > 0) {
    return { ageGroup: "older adult", reason: "older_adult_present" };
  }
  return { ageGroup: "adult", reason: "adult_only" };
}

function currentReading(forecast) {
  // Hourly rows describe later hours. They are never copied into the current
  // decision, including when the current reading is missing.
  return plainObject(forecast?.current) ? forecast.current : {};
}

function travelResult(current, profile, activity, now) {
  const traveler = { ...profile, activity };
  const decision = buildExposureDecision(current, traveler, now);
  return {
    engineActivity: activity,
    profile: traveler,
    decision,
    eligible: eligible(decision),
  };
}

function sentenceIds({ childPresent, decision, schedule, walking, cycling, commute }) {
  const recommendation = decision.activityRecommendation;
  const known = recommendation === "suitable" || recommendation === "caution" || recommendation === "avoid";
  const ids = [];
  if (childPresent) ids.push("household_child_rule");
  ids.push(`outing_${recommendation}`);
  ids.push(`schedule_${schedule.status}`);
  ids.push("indoor_unmeasured");
  if (!known) ids.push("indoor_guidance_withheld");
  if (recommendation === "caution" || recommendation === "avoid") ids.push("indoor_limit_outdoor_air");
  if (recommendation === "suitable") ids.push("indoor_ventilation_when_outdoor_suitable");
  if (known) ids.push("indoor_source_control");
  ids.push("emissions_unquantified");
  if (known) ids.push("shared_trip");
  ids.push(walking.eligible ? "active_travel_walking" : "active_travel_walking_withheld");
  ids.push(cycling.eligible ? "active_travel_cycling" : "active_travel_cycling_withheld");
  if (commute) {
    ids.push("adult_only_commute", "adult_only_not_for_children", `adult_commute_${commute.decision.activityRecommendation}`);
  }
  ids.push("not_medical_advice");
  return ids;
}

/**
 * Plan one household from an already fetched forecast and a household
 * configuration. This function does not fetch data, score with new weights,
 * or call Gemini. Shared outdoor time uses the existing exposure engine and
 * GoWindow. A child profile is never replaced by an adult result.
 */
/** Returns the household unchanged when it matches the planner allowlist. */
export function validateHouseholdPlan(household) {
  const parsed = validateHousehold(household);
  if (parsed.error) return { error: parsed.error };
  return { value: household };
}

export function buildHouseholdPlan({ forecast, household, now } = {}) {
  if (!plainObject(forecast)) return invalid("A forecast object is required.");
  const parsed = validateHousehold(household);
  if (parsed.error) return invalid(parsed.error);

  const childPresent = parsed.counts.young_child + parsed.counts.older_child > 0;
  const age = governingAge(parsed.counts);
  const governingProfile = {
    activity: parsed.shared.activity,
    ageGroup: age.ageGroup,
    sensitivity: parsed.sensitivity,
  };
  const current = currentReading(forecast);
  const decision = buildExposureDecision(current, governingProfile, now);
  const schedule = findGoWindows({
    forecast,
    profile: governingProfile,
    durationMinutes: parsed.durationMinutes,
    timePreference: parsed.timePreference,
    now,
  });

  let adultSharedOutdoor = null;
  if (childPresent) {
    const adultProfile = {
      activity: CHILD_ACTIVITY,
      ageGroup: "adult",
      sensitivity: parsed.sensitivity,
    };
    const adultDecision = buildExposureDecision(current, adultProfile, now);
    adultSharedOutdoor = {
      usedForHouseholdDecision: false,
      profile: adultProfile,
      activityRecommendation: adultDecision.activityRecommendation,
      lessRestrictiveThanGoverning: lessRestrictive(adultDecision.activityRecommendation, decision.activityRecommendation),
    };
  }

  const adultOnlyCommute = parsed.routines.includes("commuting")
    ? {
      audience: "adult-only",
      appliesToChildren: false,
      profile: { activity: "commuting", ageGroup: "adult", sensitivity: parsed.sensitivity },
      decision: buildExposureDecision(current, {
        activity: "commuting",
        ageGroup: "adult",
        sensitivity: parsed.sensitivity,
      }, now),
    }
    : null;

  const activeTravel = {
    travelerUsesGoverningProfile: true,
    walking: travelResult(current, governingProfile, WALKING_ACTIVITY, now),
    cycling: travelResult(current, governingProfile, CYCLING_ACTIVITY, now),
  };

  return {
    ok: true,
    governingProfile,
    basis: {
      childPresent,
      counts: parsed.counts,
      childBandsUseEngineAgeGroup: "child",
      governingReason: age.reason,
      sensitivity: parsed.sensitivity,
      sharedActivity: parsed.shared.activity,
      activitySource: parsed.shared.source,
      adultSharedOutdoor,
    },
    decision,
    schedule,
    adultOnlyCommute,
    activeTravel,
    sentences: sentenceIds({
      childPresent,
      decision,
      schedule,
      walking: activeTravel.walking,
      cycling: activeTravel.cycling,
      commute: adultOnlyCommute,
    }),
    indoorAirUnmeasured: true,
    emissionsSavingsQuantified: false,
  };
}
