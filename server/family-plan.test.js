import test from "node:test";
import assert from "node:assert/strict";
import { buildExposureDecision } from "./logic.js";
import { findGoWindows } from "./gowindow.js";
import { buildHouseholdPlan } from "./family-plan.js";

const NOW = Date.parse("2026-06-15T02:30:00.000Z");
const HOUR = 60 * 60 * 1000;

function at(offsetHours) {
  return new Date(NOW + offsetHours * HOUR).toISOString();
}

function current(overrides = {}) {
  return {
    aqi: 35,
    aqiScale: "US AQI",
    pollutants: { pm25: 8, pm10: 12 },
    weather: { wind_speed_10m: 12, temperature_2m: 30 },
    forecastValidAt: at(0),
    retrievedAt: at(0),
    weatherRetrievedAt: at(0),
    metadata: { isModelledEstimate: true },
    hourly: [],
    ...overrides,
  };
}

function hour(offsetHours, overrides = {}) {
  return {
    time: at(offsetHours),
    aqi: 30,
    pm25: 8,
    pm10: 12,
    weather: { wind_speed_10m: 12, temperature_2m: 30, relative_humidity_2m: 60 },
    ...overrides,
  };
}

function forecast(overrides = {}) {
  return {
    timezone: "Asia/Kolkata",
    airRetrievedAt: at(0),
    weatherRetrievedAt: at(0),
    retrievedAt: at(0),
    hourly: [0, 1, 2, 3].map((offset) => hour(offset)),
    current: current(),
    ...overrides,
  };
}

function household(overrides = {}) {
  return {
    members: [{ ageBand: "young_child", count: 1 }, { ageBand: "adult", count: 2 }],
    sensitivity: "general",
    routines: ["children's outdoor play"],
    outing: { activity: "children's outdoor play", durationMinutes: 45, timePreference: "daytime" },
    ...overrides,
  };
}

function plan(forecastOverrides = {}, householdOverrides = {}) {
  return buildHouseholdPlan({
    forecast: forecast(forecastOverrides),
    household: household(householdOverrides),
    now: NOW,
  });
}

test("a young child uses the child profile for shared outdoor play", () => {
  const result = plan();
  assert.equal(result.ok, true);
  assert.deepEqual(result.governingProfile, {
    activity: "children's outdoor play",
    ageGroup: "child",
    sensitivity: "general",
  });
  assert.equal(result.basis.childPresent, true);
  assert.equal(result.basis.governingReason, "child_present");
  assert.equal(result.basis.childBandsUseEngineAgeGroup, "child");
  assert.deepEqual(result.decision, buildExposureDecision(current(), result.governingProfile, NOW));
  assert.equal(result.decision.activityRecommendation, "suitable");
  assert.equal(result.indoorAirUnmeasured, true);
  assert.equal(result.emissionsSavingsQuantified, false);
  assert.ok(result.sentences.includes("household_child_rule"));
  assert.ok(result.sentences.includes("indoor_unmeasured"));
  assert.ok(result.sentences.includes("emissions_unquantified"));
  assert.ok(result.sentences.includes("not_medical_advice"));
  assert.equal(result.adultOnlyCommute, null);
});

test("older_child and young_child produce the same engine decision", () => {
  const young = plan();
  const older = plan({}, { members: [{ ageBand: "older_child", count: 1 }] });
  assert.equal(older.governingProfile.ageGroup, "child");
  assert.equal(older.decision.activityRecommendation, young.decision.activityRecommendation);
  assert.equal(older.decision.overallRisk, young.decision.overallRisk);
  assert.deepEqual(older.decision.trace.factors, young.decision.trace.factors);
});

test("respiratory sensitivity adds no new weight beyond the existing child profile", () => {
  const general = plan();
  const sensitive = plan({}, { sensitivity: "respiratory sensitivity" });
  assert.equal(sensitive.governingProfile.sensitivity, "respiratory sensitivity");
  assert.deepEqual(sensitive.decision.trace.factors, general.decision.trace.factors);
  assert.equal(sensitive.decision.activityRecommendation, general.decision.activityRecommendation);
});

test("an adult shared result cannot replace a stricter child decision", () => {
  const reading = current({ aqi: 40, pollutants: { pm25: 160, pm10: 180 } });
  const result = plan({ current: reading });
  const adult = buildExposureDecision(reading, {
    activity: "children's outdoor play",
    ageGroup: "adult",
    sensitivity: "general",
  }, NOW);
  assert.equal(result.decision.activityRecommendation, "avoid");
  assert.equal(adult.activityRecommendation, "caution");
  assert.equal(result.basis.householdRule, "most_protective_member");
  assert.equal(result.basis.adultSharedOutdoor, undefined);
  const childMember = result.members.find((member) => member.ageGroup === "child");
  const adultMember = result.members.find((member) => member.ageGroup === "adult");
  assert.equal(childMember.activityRecommendation, "avoid");
  assert.equal(childMember.governs, true);
  assert.equal(adultMember.activityRecommendation, adult.activityRecommendation);
  assert.equal(adultMember.governs, false);
  assert.notEqual(result.decision.activityRecommendation, adult.activityRecommendation);
  assert.equal(result.sentences.includes("outing_avoid"), true);
  assert.equal(result.sentences.includes("indoor_limit_outdoor_air"), true);
});

test("an adult-only household uses older adult when that band is present", () => {
  const result = plan({}, {
    members: [{ ageBand: "older_adult", count: 1 }, { ageBand: "adult", count: 1 }],
    routines: ["daily activities"],
    outing: { durationMinutes: 45, timePreference: "daytime" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.basis.childPresent, false);
  assert.equal(result.governingProfile.activity, "daily activities");
  assert.equal(result.governingProfile.ageGroup, "older adult");
  assert.equal(result.basis.governingReason, "older_adult_present");
  assert.equal(result.basis.activitySource, "routine");
  assert.deepEqual(result.members.map((member) => member.ageGroup), ["older adult", "adult"]);
  assert.equal(result.sentences.includes("household_child_rule"), false);
  assert.equal(result.decision.trace.factors.some((factor) => factor.factor === "Age"), false);
});

test("the current hour is not replaced by a cleaner forecast hour", () => {
  const reading = current({ aqi: 180, pollutants: { pm25: 80, pm10: 90 } });
  const result = plan({
    current: reading,
    hourly: [0, 1, 2].map((offset) => hour(offset, { aqi: 20, pm25: 5 })),
  });
  assert.equal(result.decision.activityRecommendation, "avoid");
  assert.equal(result.schedule.status, "suitable_windows");
  assert.ok(result.schedule.windows.length > 0);
});

test("GoWindow is reused for the governing profile and does not window a caution hour", () => {
  const hourly = [
    hour(0, { aqi: 120, pm25: 8 }),
    hour(1, { aqi: 30, pm25: 8 }),
    hour(2, { aqi: 28, pm25: 7 }),
  ];
  const result = plan({ hourly }, { outing: { durationMinutes: 60, timePreference: "daytime" } });
  const direct = findGoWindows({
    forecast: forecast({ hourly }),
    profile: result.governingProfile,
    durationMinutes: 60,
    timePreference: "daytime",
    now: NOW,
  });
  assert.deepEqual(result.schedule, direct);
  assert.equal(result.schedule.activity, "children's outdoor play");
  assert.ok(result.schedule.windows.length > 0);
  assert.ok(result.schedule.windows.every((window) => window.exposureRecommendation === "suitable"));
  assert.equal(result.schedule.windows.some((window) => window.start === at(0)), false);
});

test("a time preference is passed through and is not relaxed", () => {
  const hourly = [0, 1].map((offset) => hour(offset, { aqi: 30, pm25: 8 }));
  const result = plan({ hourly }, {
    outing: { activity: "children's outdoor play", durationMinutes: 60, timePreference: "evening" },
  });
  const direct = findGoWindows({
    forecast: forecast({ hourly }),
    profile: result.governingProfile,
    durationMinutes: 60,
    timePreference: "evening",
    now: NOW,
  });
  assert.deepEqual(result.schedule, direct);
  assert.equal(result.schedule.status, "outside_preference");
  assert.ok(result.schedule.windows.every((window) => window.placement === "alternative"));
});

test("commuting is scored separately and marked adult-only", () => {
  const reading = current({ aqi: 40, pollutants: { pm25: 160, pm10: 180 } });
  const result = plan({ current: reading }, { routines: ["commuting", "children's outdoor play"] });
  const commuteProfile = { activity: "commuting", ageGroup: "adult", sensitivity: "general" };
  assert.equal(result.decision.activityRecommendation, "avoid");
  assert.equal(result.adultOnlyCommute.audience, "adult-only");
  assert.equal(result.adultOnlyCommute.appliesToChildren, false);
  assert.deepEqual(result.adultOnlyCommute.profile, commuteProfile);
  assert.deepEqual(result.adultOnlyCommute.decision, buildExposureDecision(reading, commuteProfile, NOW));
  assert.notEqual(result.adultOnlyCommute.decision.activityRecommendation, "avoid");
  assert.ok(result.sentences.includes("adult_only_commute"));
  assert.ok(result.sentences.includes("adult_only_not_for_children"));
});

test("active travel uses the governing traveler and is withheld on avoid or insufficient data", () => {
  const blocked = plan({ current: current({ aqi: 40, pollutants: { pm25: 160, pm10: 180 } }) });
  assert.equal(blocked.activeTravel.walking.engineActivity, "daily activities");
  assert.equal(blocked.activeTravel.cycling.engineActivity, "cycling");
  assert.equal(blocked.activeTravel.walking.profile.ageGroup, "child");
  assert.equal(blocked.activeTravel.cycling.profile.ageGroup, "child");
  assert.equal(blocked.activeTravel.walking.eligible, false);
  assert.equal(blocked.activeTravel.cycling.eligible, false);
  assert.equal(blocked.activeTravel.walking.decision.activityRecommendation, "avoid");
  assert.ok(blocked.sentences.includes("active_travel_walking_withheld"));
  assert.ok(blocked.sentences.includes("active_travel_cycling_withheld"));

  const missing = plan({ current: current({ aqi: null }) });
  assert.equal(missing.decision.activityRecommendation, "insufficient_data");
  assert.equal(missing.activeTravel.walking.eligible, false);
  assert.equal(missing.activeTravel.cycling.eligible, false);
  assert.ok(missing.sentences.includes("indoor_guidance_withheld"));
  assert.equal(missing.sentences.includes("shared_trip"), false);
  assert.equal(missing.sentences.includes("indoor_source_control"), false);

  const allowed = plan();
  assert.equal(allowed.activeTravel.walking.eligible, true);
  assert.equal(allowed.activeTravel.cycling.decision.activityRecommendation, "caution");
  assert.equal(allowed.activeTravel.cycling.eligible, true);
  assert.ok(allowed.sentences.includes("active_travel_walking"));
  assert.ok(allowed.sentences.includes("active_travel_cycling"));
});

test("stale air stays insufficient and does not open a window or active trip", () => {
  const stale = at(-4);
  const result = plan({
    airRetrievedAt: stale,
    weatherRetrievedAt: stale,
    retrievedAt: stale,
    current: current({ retrievedAt: stale, weatherRetrievedAt: stale }),
  });
  assert.equal(result.decision.activityRecommendation, "insufficient_data");
  assert.equal(result.decision.dataFreshness.state, "stale");
  assert.equal(result.schedule.status, "insufficient_data");
  assert.equal(result.schedule.windows.length, 0);
  assert.equal(result.activeTravel.walking.eligible, false);
  assert.equal(result.activeTravel.cycling.eligible, false);
});

test("a missing current reading is not copied from the hourly forecast", () => {
  const result = buildHouseholdPlan({
    forecast: {
      timezone: "Asia/Kolkata",
      airRetrievedAt: at(0),
      weatherRetrievedAt: at(0),
      hourly: [hour(0, { aqi: 20, pm25: 5 })],
    },
    household: household(),
    now: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.decision.activityRecommendation, "insufficient_data");
  assert.equal(result.schedule.status, "suitable_windows");
});

test("free-text member details and unsupported household fields are rejected", () => {
  const named = plan({}, { members: [{ ageBand: "young_child", count: 1, name: "Asha" }] });
  assert.equal(named.ok, false);
  assert.match(named.error, /names or other personal details/);

  const notes = plan({}, { notes: "asthma since childhood" });
  assert.equal(notes.ok, false);
  assert.match(notes.error, /unsupported field/);

  const band = plan({}, { members: [{ ageBand: "infant", count: 1 }] });
  assert.equal(band.ok, false);

  const huge = plan({}, { members: [{ ageBand: "young_child", count: 9 }] });
  assert.equal(huge.ok, false);

  const duration = plan({}, { outing: { durationMinutes: 10, timePreference: "daytime" } });
  assert.equal(duration.ok, false);
  assert.match(duration.error, /15 to 180/);

  const activity = plan({}, { outing: { activity: "running", durationMinutes: 45, timePreference: "daytime" } });
  assert.equal(activity.ok, false);
  assert.match(activity.error, /does not match this household/);
});

function ageFactor(decision) {
  return decision.trace.factors.find((factor) => factor.factor === "Age");
}

test("the reported AQI 40 and PM2.5 160 fixture avoids because PM2.5 adds four points", () => {
  const reading = current({ aqi: 40, pollutants: { pm25: 160, pm10: 180 } });
  const child = buildExposureDecision(reading, {
    activity: "children's outdoor play",
    ageGroup: "child",
    sensitivity: "general",
  }, NOW);
  const contributions = Object.fromEntries(child.trace.factors.map((factor) => [factor.factor, factor.contribution]));
  assert.equal(contributions["US AQI"], 1);
  assert.equal(contributions["PM2.5"], 4);
  assert.equal(contributions.Activity, 0);
  assert.equal(contributions.Profile, 1);
  assert.equal(contributions.Age, 0.5);
  assert.equal(contributions.Wind, 0);
  assert.equal(child.overallRisk, "very_high");
  assert.equal(child.activityRecommendation, "avoid");
  assert.equal(child.trace.categoryFloor, "suitable");
  assert.equal(child.trace.floorApplied, false);
});

test("adult-only households do not receive the child activity adjustment", () => {
  const reading = current({
    aqi: 80,
    pollutants: { pm25: 60, pm10: 70 },
    weather: { wind_speed_10m: 3, temperature_2m: 30 },
  });
  const adult = plan({ current: reading }, {
    members: [{ ageBand: "adult", count: 2 }],
    routines: ["daily activities"],
    outing: { durationMinutes: 45, timePreference: "daytime" },
  });
  const childActivity = buildExposureDecision(reading, {
    activity: "children's outdoor play",
    ageGroup: "adult",
    sensitivity: "general",
  }, NOW);
  assert.equal(adult.governingProfile.activity, "daily activities");
  assert.equal(adult.decision.activityRecommendation, "caution");
  assert.equal(ageFactor(adult.decision), undefined);
  assert.equal(childActivity.activityRecommendation, "avoid");
  assert.equal(ageFactor(childActivity).contribution, 0.5);
});

test("a vigorous routine is the adult shared activity and daily activities is the fallback", () => {
  const running = plan({}, {
    members: [{ ageBand: "adult", count: 1 }],
    routines: ["daily activities", "running", "commuting"],
    outing: { activity: "running", durationMinutes: 45, timePreference: "daytime" },
  });
  assert.equal(running.basis.activitySource, "routine");
  assert.equal(running.governingProfile.activity, "running");
  assert.equal(running.schedule.activity, "running");
  assert.equal(running.adultOnlyCommute.audience, "adult-only");
  assert.equal(running.adultOnlyCommute.appliesToChildren, false);

  const fallback = plan({}, {
    members: [{ ageBand: "adult", count: 1 }],
    routines: ["commuting", "children's outdoor play"],
    outing: { durationMinutes: 45, timePreference: "daytime" },
  });
  assert.equal(fallback.basis.activitySource, "general_default");
  assert.equal(fallback.governingProfile.activity, "daily activities");
  assert.equal(ageFactor(fallback.decision), undefined);
  assert.equal(fallback.adultOnlyCommute.profile.ageGroup, "adult");
});

test("child plus adult and child plus older adult keep the child profile", () => {
  const withAdult = plan({}, { members: [{ ageBand: "young_child", count: 1 }, { ageBand: "adult", count: 1 }] });
  const withOlder = plan({}, { members: [{ ageBand: "older_child", count: 2 }, { ageBand: "older_adult", count: 1 }] });
  assert.equal(withAdult.governingProfile.ageGroup, "child");
  assert.equal(withAdult.governingProfile.activity, "children's outdoor play");
  assert.equal(ageFactor(withAdult.decision).contribution, 0.5);
  assert.equal(withOlder.governingProfile.ageGroup, "child");
  assert.equal(withOlder.basis.counts.older_child, 2);
  assert.notEqual(withOlder.governingProfile.ageGroup, "older adult");
});

test("every age group in the household is scored and the most protective result is the decision", () => {
  const reading = current({ aqi: 40, pollutants: { pm25: 160, pm10: 180 } });
  const mixed = plan({ current: reading }, {
    members: [
      { ageBand: "young_child", count: 1 },
      { ageBand: "older_child", count: 1 },
      { ageBand: "adult", count: 2 },
      { ageBand: "older_adult", count: 1 },
    ],
  });
  assert.equal(mixed.ok, true);
  assert.deepEqual(mixed.members.map((member) => member.ageGroup), ["child", "older adult", "adult"]);
  assert.deepEqual(mixed.members.map((member) => member.count), [2, 1, 2]);
  assert.deepEqual(mixed.members[0].ageBands, [{ ageBand: "young_child", count: 1 }, { ageBand: "older_child", count: 1 }]);
  for (const member of mixed.members) {
    assert.deepEqual(member.profile, {
      activity: "children's outdoor play",
      ageGroup: member.ageGroup,
      sensitivity: "general",
    });
    assert.deepEqual(
      { recommendation: member.activityRecommendation, risk: member.overallRisk },
      (({ activityRecommendation, overallRisk }) => ({ recommendation: activityRecommendation, risk: overallRisk }))(
        buildExposureDecision(reading, member.profile, NOW),
      ),
    );
  }
  const order = { suitable: 0, caution: 1, avoid: 2, insufficient_data: 3 };
  const strictest = Math.max(...mixed.members.map((member) => order[member.activityRecommendation]));
  assert.equal(order[mixed.decision.activityRecommendation], strictest);
  assert.equal(mixed.members.filter((member) => member.governs).length, 1);
  assert.equal(mixed.basis.householdRule, "most_protective_member");
});

test("walking and cycling are scored for every member group and follow the most protective one", () => {
  const reading = current({ aqi: 80, pollutants: { pm25: 36, pm10: 40 } });
  const mixed = plan({ current: reading }, {
    members: [{ ageBand: "young_child", count: 1 }, { ageBand: "adult", count: 2 }, { ageBand: "older_adult", count: 1 }],
  });
  const order = { suitable: 0, caution: 1, avoid: 2, insufficient_data: 3 };
  for (const [name, activity] of [["walking", "daily activities"], ["cycling", "cycling"]]) {
    const travel = mixed.activeTravel[name];
    assert.deepEqual(travel.members.map((member) => member.ageGroup), ["child", "older adult", "adult"]);
    for (const member of travel.members) {
      const direct = buildExposureDecision(reading, { activity, ageGroup: member.ageGroup, sensitivity: "general" }, NOW);
      assert.equal(member.activityRecommendation, direct.activityRecommendation);
    }
    const strictest = Math.max(...travel.members.map((member) => order[member.activityRecommendation]));
    assert.equal(order[travel.decision.activityRecommendation], strictest);
    assert.equal(travel.eligible, strictest <= 1);
    assert.equal(travel.members.filter((member) => member.governs).length, 1);
  }
});

test("a child result is never less protective than an older adult or adult result for the same outing", () => {
  const order = { suitable: 0, caution: 1, avoid: 2, insufficient_data: 3 };
  const activities = ["children's outdoor play", "daily activities", "running", "cycling", "commuting"];
  const sensitivities = ["general", "respiratory sensitivity", "heart or lung condition"];
  for (const activity of activities) {
    for (const sensitivity of sensitivities) {
      for (const aqi of [10, 40, 60, 90, 110, 140, 160, 190, 220, 320]) {
        for (const pm25 of [4, 20, 40, 70, 120, 200]) {
          for (const wind of [2, 12]) {
            const reading = current({ aqi, pollutants: { pm25, pm10: pm25 + 5 }, weather: { wind_speed_10m: wind, temperature_2m: 30 } });
            const [child, older, adult] = ["child", "older adult", "adult"].map((ageGroup) =>
              order[buildExposureDecision(reading, { activity, ageGroup, sensitivity }, NOW).activityRecommendation]);
            assert.ok(child >= older, `child ${child} older ${older} for ${activity} ${sensitivity} aqi ${aqi} pm ${pm25}`);
            assert.ok(older >= adult, `older ${older} adult ${adult} for ${activity} ${sensitivity} aqi ${aqi} pm ${pm25}`);
          }
        }
      }
    }
  }
});

test("adult-only and older-adult-only profiles stay on general activities", () => {
  const adults = plan({}, {
    members: [{ ageBand: "adult", count: 3 }],
    routines: ["daily activities"],
    outing: { durationMinutes: 45, timePreference: "daytime" },
  });
  const older = plan({}, {
    members: [{ ageBand: "older_adult", count: 1 }],
    routines: [],
    outing: { durationMinutes: 30, timePreference: "any" },
  });
  assert.equal(adults.governingProfile.ageGroup, "adult");
  assert.equal(adults.basis.activitySource, "routine");
  assert.equal(ageFactor(adults.decision), undefined);
  assert.equal(older.governingProfile.ageGroup, "older adult");
  assert.equal(older.governingProfile.activity, "daily activities");
  assert.equal(older.basis.activitySource, "general_default");
  assert.equal(ageFactor(older.decision), undefined);
  assert.equal(older.decision.trace.factors.some((factor) => factor.factor === "Profile"), true);
});

test("general and non-general sensitivity follow the existing adult and child weights", () => {
  const reading = current({ aqi: 80, pollutants: { pm25: 36, pm10: 40 } });
  const general = plan({ current: reading }, {
    members: [{ ageBand: "adult", count: 1 }],
    routines: ["daily activities"],
    outing: { durationMinutes: 45, timePreference: "daytime" },
  });
  const respiratory = plan({ current: reading }, {
    members: [{ ageBand: "adult", count: 1 }],
    sensitivity: "respiratory sensitivity",
    routines: ["daily activities"],
    outing: { durationMinutes: 45, timePreference: "daytime" },
  });
  assert.equal(general.decision.activityRecommendation, "suitable");
  assert.equal(respiratory.decision.activityRecommendation, "caution");
  assert.equal(respiratory.governingProfile.sensitivity, "respiratory sensitivity");

  const childGeneral = plan({ current: reading });
  const childSensitive = plan({ current: reading }, { sensitivity: "heart or lung condition" });
  assert.deepEqual(childGeneral.decision.trace.factors, childSensitive.decision.trace.factors);
});

test("household count and routine limits are enforced", () => {
  const several = plan({}, { members: [{ ageBand: "young_child", count: 4 }] });
  assert.equal(several.ok, true);
  assert.equal(several.basis.counts.young_child, 4);

  const full = plan({}, {
    members: [{ ageBand: "young_child", count: 8 }, { ageBand: "adult", count: 4 }],
  });
  assert.equal(full.ok, true);

  const overHousehold = plan({}, {
    members: [{ ageBand: "young_child", count: 8 }, { ageBand: "adult", count: 5 }],
  });
  assert.equal(overHousehold.ok, false);
  assert.match(overHousehold.error, /12/);

  const empty = plan({}, { members: [] });
  assert.equal(empty.ok, false);
  const zero = plan({}, { members: [{ ageBand: "adult", count: 0 }] });
  assert.equal(zero.ok, false);

  const maxRoutines = plan({}, {
    routines: ["running", "cycling", "outdoor workout", "sports"],
  });
  assert.equal(maxRoutines.ok, true);
  assert.equal(maxRoutines.governingProfile.activity, "children's outdoor play");
  const tooManyRoutines = plan({}, {
    routines: ["running", "cycling", "outdoor workout", "sports", "commuting"],
  });
  assert.equal(tooManyRoutines.ok, false);
  assert.match(tooManyRoutines.error, /at most 4/);
});

test("an adult eligible for walking does not make a child eligible", () => {
  const reading = current({ aqi: 40, pollutants: { pm25: 160, pm10: 180 } });
  const childPlan = plan({ current: reading });
  const adultWalking = buildExposureDecision(reading, {
    activity: "daily activities",
    ageGroup: "adult",
    sensitivity: "general",
  }, NOW);
  assert.equal(adultWalking.activityRecommendation, "caution");
  assert.equal(childPlan.activeTravel.walking.profile.ageGroup, "child");
  assert.equal(childPlan.activeTravel.walking.engineActivity, "daily activities");
  assert.equal(childPlan.activeTravel.walking.decision.activityRecommendation, "avoid");
  assert.equal(childPlan.activeTravel.walking.eligible, false);
  assert.equal(childPlan.activeTravel.cycling.profile.ageGroup, "child");
  assert.equal(childPlan.activeTravel.cycling.engineActivity, "cycling");
  assert.equal(childPlan.activeTravel.cycling.eligible, false);

  const adultPlan = plan({ current: reading }, {
    members: [{ ageBand: "adult", count: 1 }],
    routines: ["daily activities"],
    outing: { durationMinutes: 45, timePreference: "daytime" },
  });
  assert.equal(adultPlan.activeTravel.walking.profile.ageGroup, "adult");
  assert.equal(adultPlan.activeTravel.walking.eligible, true);
  assert.equal(adultPlan.activeTravel.cycling.profile.ageGroup, "adult");
  assert.equal(adultPlan.activeTravel.cycling.eligible, false);
});

test("adult GoWindow uses the governing activity and drops avoid hours", () => {
  const hourly = [
    hour(0, { aqi: 180, pm25: 80 }),
    hour(1, { aqi: 30, pm25: 8 }),
    hour(2, { aqi: 28, pm25: 7 }),
  ];
  const result = plan({ hourly }, {
    members: [{ ageBand: "adult", count: 1 }],
    routines: ["daily activities"],
    outing: { durationMinutes: 60, timePreference: "daytime" },
  });
  const direct = findGoWindows({
    forecast: forecast({ hourly }),
    profile: result.governingProfile,
    durationMinutes: 60,
    timePreference: "daytime",
    now: NOW,
  });
  assert.deepEqual(result.schedule, direct);
  assert.equal(result.schedule.activity, "daily activities");
  assert.equal(result.schedule.windows.some((window) => window.start === at(0)), false);
  assert.ok(result.schedule.windows.every((window) => window.exposureRecommendation === "suitable"));
});

test("missing and stale forecast hours do not become windows for an adult household", () => {
  const missing = plan({
    hourly: [hour(0, { aqi: null, pm25: null }), hour(1, { aqi: null, pm25: null })],
  }, {
    members: [{ ageBand: "adult", count: 1 }],
    routines: ["daily activities"],
    outing: { durationMinutes: 60, timePreference: "daytime" },
  });
  assert.equal(missing.schedule.status, "insufficient_data");
  assert.equal(missing.schedule.windows.length, 0);

  const staleAt = at(-4);
  const stale = plan({
    airRetrievedAt: staleAt,
    weatherRetrievedAt: staleAt,
    retrievedAt: staleAt,
    current: current({ retrievedAt: staleAt, weatherRetrievedAt: staleAt }),
  }, {
    members: [{ ageBand: "older_adult", count: 1 }],
    routines: ["daily activities"],
    outing: { durationMinutes: 45, timePreference: "daytime" },
  });
  assert.equal(stale.decision.activityRecommendation, "insufficient_data");
  assert.equal(stale.schedule.status, "insufficient_data");
  assert.equal(stale.schedule.windows.length, 0);
  assert.equal(stale.activeTravel.walking.eligible, false);
  assert.equal(stale.activeTravel.cycling.eligible, false);
});
