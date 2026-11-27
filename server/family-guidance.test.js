import test from "node:test";
import assert from "node:assert/strict";
import { buildFamilyGuidance, INDOOR_NOT_MEASURED } from "./family-guidance.js";

function guidance(overrides = {}) {
  return buildFamilyGuidance({
    recommendation: "suitable",
    freshnessState: "fresh",
    scheduleStatus: "suitable_windows",
    suitableWindowCount: 1,
    routines: ["children's outdoor play"],
    childPresent: true,
    walking: { eligible: false, recommendation: "avoid" },
    cycling: { eligible: false, recommendation: "avoid" },
    ...overrides,
  });
}

function ids(list) {
  return list.map((item) => item.id);
}

function allText(result) {
  return JSON.stringify({
    indoorGuidance: result.indoorGuidance,
    routineRecommendations: result.routineRecommendations,
    impactExplanations: result.impactExplanations,
  });
}

test("suitable outdoor air allows ventilation and a suitable window, without a guarantee", () => {
  const result = guidance();
  assert.equal(result.indoorMeasurementStatus, "not_measured");
  assert.equal(result.emissionsImpactStatus, "qualitative_only");
  assert.equal(result.indoorGuidance.measurementStatement, INDOOR_NOT_MEASURED);
  const ventilation = ids(result.indoorGuidance.recommendations);
  assert.ok(ventilation.includes("ventilation_when_outdoor_suitable"));
  assert.ok(ventilation.includes("ventilation_during_suitable_window"));
  assert.equal(ventilation.includes("ventilation_limit_outdoor_intake"), false);
  const windowCard = result.indoorGuidance.recommendations.find((item) => item.id === "ventilation_during_suitable_window");
  assert.match(windowCard.description, /suitable period/);
  assert.match(windowCard.limitations, /does not guarantee indoor air/);
  assert.ok(result.indoorGuidance.recommendations.every((item) => item.limitations.includes(INDOOR_NOT_MEASURED)));
});

test("caution and avoid limit outdoor-air intake", () => {
  for (const recommendation of ["caution", "avoid"]) {
    const result = guidance({ recommendation, scheduleStatus: "no_suitable_window", suitableWindowCount: 0 });
    const ventilation = result.indoorGuidance.recommendations.find((item) => item.category === "ventilation");
    assert.equal(ventilation.id, "ventilation_limit_outdoor_intake");
    assert.match(ventilation.title, new RegExp(recommendation));
    assert.match(ventilation.description, /Avoid bringing extra outdoor air/);
    assert.equal(ids(result.indoorGuidance.recommendations).includes("ventilation_during_suitable_window"), false);
  }
});

test("missing and stale air never recommend opening windows", () => {
  const cases = [
    { recommendation: "insufficient_data", freshnessState: "unknown", scheduleStatus: "insufficient_data", suitableWindowCount: 0 },
    { recommendation: "insufficient_data", freshnessState: "stale", scheduleStatus: "insufficient_data", suitableWindowCount: 0 },
    { recommendation: "suitable", freshnessState: "stale", scheduleStatus: "suitable_windows", suitableWindowCount: 2 },
  ];
  for (const item of cases) {
    const result = guidance(item);
    const ventilation = result.indoorGuidance.recommendations.filter((card) => card.category === "ventilation");
    assert.deepEqual(ventilation.map((card) => card.id), ["ventilation_withheld"]);
    assert.match(ventilation[0].description, /does not suggest opening windows/);
    assert.equal(allText(result).includes("ventilation_during_suitable_window"), false);
  }
});

test("filtration and source control stay practical and unmeasured", () => {
  const result = guidance({ recommendation: "avoid", scheduleStatus: "no_suitable_window", suitableWindowCount: 0 });
  const indoor = result.indoorGuidance.recommendations;
  const filtration = indoor.find((item) => item.id === "particle_filtration");
  assert.match(filtration.description, /appropriately sized and maintained/);
  assert.match(filtration.limitations, /specific reduction/);
  assert.match(filtration.limitations, /Houseplants are not a substitute/);
  assert.match(filtration.limitations, /not been measured/);
  for (const id of ["cooking_exhaust", "smoking_incense", "aerosols_cleaning", "damp_dust"]) {
    assert.ok(indoor.some((item) => item.id === id), id);
  }
  const cooking = indoor.find((item) => item.id === "cooking_exhaust");
  assert.match(cooking.description, /exhaust fan|sends cooking air outdoors/);
  const smoking = indoor.find((item) => item.id === "smoking_incense");
  assert.match(smoking.description, /smoking and incense/);
  const sprays = indoor.find((item) => item.id === "aerosols_cleaning");
  assert.match(sprays.description, /aerosol sprays and harsh cleaning/);
  const dust = indoor.find((item) => item.id === "damp_dust");
  assert.match(dust.description, /damp/);
  assert.ok(indoor.every((item) => item.limitations.includes(INDOOR_NOT_MEASURED)));
});

test("commute alternatives stay qualitative and active travel follows the engine gate", () => {
  const allowed = guidance({
    childPresent: false,
    routines: ["commuting", "cycling"],
    walking: { eligible: true, recommendation: "caution" },
    cycling: { eligible: true, recommendation: "suitable" },
  });
  const allowedIds = ids(allowed.routineRecommendations);
  assert.ok(allowedIds.includes("commute_fewer_vehicle_trips"));
  assert.ok(allowedIds.includes("walking_when_engine_allows"));
  assert.ok(allowedIds.includes("cycling_when_engine_allows"));
  assert.equal(allowedIds.filter((id) => id.startsWith("cycling_")).length, 1);
  const commute = allowed.routineRecommendations.find((item) => item.id === "commute_fewer_vehicle_trips");
  assert.match(commute.description, /public transport/);
  assert.match(commute.description, /carpooling/);
  assert.match(commute.description, /combining errands/);
  assert.match(commute.limitations, /waiting outdoors/);
  assert.equal(commute.impactType, "ambient_emissions");

  const blocked = guidance({
    childPresent: true,
    recommendation: "avoid",
    scheduleStatus: "no_suitable_window",
    suitableWindowCount: 0,
    routines: ["commuting", "cycling"],
    walking: { eligible: false, recommendation: "avoid" },
    cycling: { eligible: true, recommendation: "avoid" },
  });
  const blockedIds = ids(blocked.routineRecommendations);
  assert.ok(blockedIds.includes("walking_withheld"));
  assert.ok(blockedIds.includes("cycling_withheld"));
  assert.equal(blockedIds.includes("walking_when_engine_allows"), false);
  assert.equal(blockedIds.includes("cycling_when_engine_allows"), false);
  const walking = blocked.routineRecommendations.find((item) => item.id === "walking_withheld");
  assert.match(walking.description, /not offered/);
  assert.doesNotMatch(walking.description, /can replace a short vehicle trip/);
});

test("a child decision is not replaced by an adult permission flag", () => {
  const result = guidance({
    recommendation: "avoid",
    scheduleStatus: "no_suitable_window",
    suitableWindowCount: 0,
    childPresent: true,
    routines: ["children's outdoor play", "running"],
    adultAllowsOutdoorPlay: true,
    walking: { eligible: true, recommendation: "suitable" },
  });
  const child = result.routineRecommendations.find((item) => item.id === "child_outdoor_play");
  assert.match(child.description, /avoid/);
  assert.match(child.limitations, /not permission for the child/);
  assert.equal(ids(result.routineRecommendations).includes("walking_when_engine_allows"), false);
  const running = result.routineRecommendations.find((item) => item.id === "running_follow_outdoor_decision");
  assert.match(running.description, /not suitable outdoors/);
});

test("only configured routines produce routine recommendations", () => {
  const childOnly = guidance({ routines: ["children's outdoor play"] });
  const childIds = ids(childOnly.routineRecommendations);
  assert.deepEqual(childIds, ["child_outdoor_play"]);

  const adultRun = guidance({
    childPresent: false,
    recommendation: "suitable",
    routines: ["running", "sports"],
  });
  assert.deepEqual(ids(adultRun.routineRecommendations), [
    "running_follow_outdoor_decision",
    "sports_follow_outdoor_decision",
  ]);
  assert.match(adultRun.routineRecommendations[1].description, /suitable outing window/);
  const indoorOnly = guidance({
    childPresent: false,
    routines: ["daily activities"],
    scheduleStatus: "no_suitable_window",
    suitableWindowCount: 0,
  });
  assert.deepEqual(indoorOnly.routineRecommendations, []);
});

test("guidance stays qualitative and does not claim measured indoor air", () => {
  const result = guidance({
    routines: ["commuting", "running", "outdoor workout", "sports", "cycling", "children's outdoor play"],
    walking: { eligible: true, recommendation: "suitable" },
    cycling: { eligible: true, recommendation: "caution" },
  });
  const text = allText(result);
  assert.equal(result.indoorMeasurementStatus, "not_measured");
  assert.equal(result.emissionsImpactStatus, "qualitative_only");
  assert.doesNotMatch(text, /\d|%|µg|ppm|microgram/i);
  assert.match(text, /Indoor air quality has not been measured by AirSense AI/);
  assert.match(text, /not automatically an emissions reduction/);
  const impacts = ids(result.impactExplanations);
  assert.deepEqual(impacts, ["impact_personal_exposure", "impact_indoor_sources", "impact_ambient_emissions"]);
  for (const item of [...result.indoorGuidance.recommendations, ...result.routineRecommendations, ...result.impactExplanations]) {
    for (const key of ["id", "category", "title", "description", "whyItHelps", "impactType", "limitations"]) {
      assert.equal(typeof item[key], "string", `${item.id} ${key}`);
      assert.ok(item[key].length > 0);
    }
  }
});
