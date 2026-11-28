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
// Every age group present is scored with the existing engine. The household
// takes the most protective result, and an unknown result counts as the most
// protective. Ties go to the earliest group listed here, which is also the
// group the engine weighs most heavily.
const MEMBER_GROUP_ORDER = Object.freeze(["child", "older adult", "adult"]);
const RESTRICTION_RANK = { suitable: 0, caution: 1, avoid: 2, insufficient_data: 3 };

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

function restrictionRank(decision) {
  const recommendation = decision?.activityRecommendation;
  return Object.hasOwn(RESTRICTION_RANK, recommendation) ? RESTRICTION_RANK[recommendation] : RESTRICTION_RANK.insufficient_data;
}

function mostProtective(results) {
  return results.reduce((best, result) => (restrictionRank(result.decision) > restrictionRank(best.decision) ? result : best));
}

function memberGroups(counts) {
  const groups = [];
  for (const ageGroup of MEMBER_GROUP_ORDER) {
    const ageBands = Object.keys(AGE_BAND_TO_GROUP)
      .filter((ageBand) => AGE_BAND_TO_GROUP[ageBand] === ageGroup && counts[ageBand] > 0)
      .map((ageBand) => ({ ageBand, count: counts[ageBand] }));
    if (ageBands.length > 0) {
      groups.push({ ageGroup, ageBands, count: ageBands.reduce((sum, band) => sum + band.count, 0) });
    }
  }
  return groups;
}

function memberSummary(result, governing) {
  return {
    ageGroup: result.ageGroup,
    ageBands: result.ageBands,
    count: result.count,
    profile: result.profile,
    activityRecommendation: result.decision.activityRecommendation,
    overallRisk: result.decision.overallRisk,
    governs: result === governing,
  };
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

function governingReason(governingGroup, groups) {
  if (governingGroup === "child") return "child_present";
  if (governingGroup === "older adult") return "older_adult_present";
  return groups.length > 1 ? "adult_most_protective" : "adult_only";
}

function currentReading(forecast) {
  // Hourly rows describe later hours. They are never copied into the current
  // decision, including when the current reading is missing.
  return plainObject(forecast?.current) ? forecast.current : {};
}

function travelResult(current, groups, sensitivity, activity, now) {
  const results = groups.map((group) => {
    const profile = { activity, ageGroup: group.ageGroup, sensitivity };
    return { ageGroup: group.ageGroup, profile, decision: buildExposureDecision(current, profile, now) };
  });
  const governing = mostProtective(results);
  return {
    engineActivity: activity,
    profile: governing.profile,
    decision: governing.decision,
    eligible: eligible(governing.decision),
    members: results.map((result) => ({
      ageGroup: result.ageGroup,
      activityRecommendation: result.decision.activityRecommendation,
      governs: result === governing,
    })),
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
 * GoWindow. Every age group present is scored, and the household takes the
 * most protective result, so an adult result never replaces a stricter one.
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
  const groups = memberGroups(parsed.counts);
  const current = currentReading(forecast);
  const evaluated = groups.map((group) => {
    const profile = { activity: parsed.shared.activity, ageGroup: group.ageGroup, sensitivity: parsed.sensitivity };
    return { ...group, profile, decision: buildExposureDecision(current, profile, now) };
  });
  const governing = mostProtective(evaluated);
  const governingProfile = governing.profile;
  const decision = governing.decision;
  const schedule = findGoWindows({
    forecast,
    profile: governingProfile,
    durationMinutes: parsed.durationMinutes,
    timePreference: parsed.timePreference,
    now,
  });

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
    walking: travelResult(current, groups, parsed.sensitivity, WALKING_ACTIVITY, now),
    cycling: travelResult(current, groups, parsed.sensitivity, CYCLING_ACTIVITY, now),
  };

  return {
    ok: true,
    governingProfile,
    basis: {
      childPresent,
      counts: parsed.counts,
      childBandsUseEngineAgeGroup: "child",
      householdRule: "most_protective_member",
      governingReason: governingReason(governing.ageGroup, groups),
      sensitivity: parsed.sensitivity,
      sharedActivity: parsed.shared.activity,
      activitySource: parsed.shared.source,
    },
    members: evaluated.map((result) => memberSummary(result, governing)),
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
