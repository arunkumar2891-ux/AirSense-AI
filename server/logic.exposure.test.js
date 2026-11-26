import test from "node:test";
import assert from "node:assert/strict";
import { buildExposureDecision, buildRecommendationContext, buildWindHypothetical, getAQIStatus, getPM25Status, getDataFreshness, insufficientExposureGuidance, parseWindHypothetical } from "./logic.js";

function makeAir(overrides = {}) {
  return {
    aqi: 35,
    aqiScale: "US AQI",
    pollutants: { pm25: 8, pm10: 15, ozone: 30, nitrogenDioxide: 10, carbonMonoxide: 200, sulphurDioxide: 2 },
    weather: { wind_speed_10m: 12, temperature_2m: 25 },
    observedAt: new Date().toISOString(),
    hourly: [{ time: "t1", aqi: 35, pm25: 8, pm10: 15 }],
    ...overrides,
  };
}

function makeProfile(overrides = {}) {
  return { activity: "running", ageGroup: "adult", sensitivity: "general", ...overrides };
}

// ---------- 1. Good air + outdoor running ----------
test("good air + running → low risk, suitable", () => {
  const d = buildExposureDecision(makeAir(), makeProfile());
  assert.equal(d.overallRisk, "low");
  assert.equal(d.activityRecommendation, "suitable");
  assert.match(d.recommendedAction, /favorable/i);
});

// ---------- 2. Moderate air + sensitive child ----------
test("moderate AQI + sensitive child → elevated risk", () => {
  const d = buildExposureDecision(
    makeAir({ aqi: 85, pollutants: { pm25: 28, pm10: 40, ozone: 30, nitrogenDioxide: 10, carbonMonoxide: 200, sulphurDioxide: 2 } }),
    makeProfile({ activity: "children's outdoor play", ageGroup: "child", sensitivity: "respiratory sensitivity" }),
  );
  assert.ok(["moderate", "high"].includes(d.overallRisk), `expected moderate/high, got ${d.overallRisk}`);
  assert.ok(["suitable", "caution"].includes(d.activityRecommendation));
  assert.match(d.sensitiveGroupAdvice, /children|sensitive/i);
});

// ---------- 3. Unhealthy air + vigorous exercise ----------
test("unhealthy AQI + running → avoid", () => {
  const d = buildExposureDecision(makeAir({ aqi: 185 }), makeProfile());
  assert.equal(d.activityRecommendation, "avoid");
  assert.equal(d.overallRisk, "very_high");
  assert.match(d.recommendedAction, /avoid/i);
});

// ---------- 4. High PM2.5 despite lower AQI ----------
test("high PM2.5 with moderate AQI elevates risk", () => {
  const lowPM = buildExposureDecision(makeAir({ aqi: 80, pollutants: { pm25: 10, pm10: 15, ozone: 30, nitrogenDioxide: 10, carbonMonoxide: 200, sulphurDioxide: 2 } }), makeProfile());
  const highPM = buildExposureDecision(makeAir({ aqi: 80, pollutants: { pm25: 60, pm10: 65, ozone: 30, nitrogenDioxide: 10, carbonMonoxide: 200, sulphurDioxide: 2 } }), makeProfile());
  const riskOrder = { low: 0, moderate: 1, high: 2, very_high: 3 };
  assert.ok(riskOrder[highPM.overallRisk] > riskOrder[lowPM.overallRisk],
    `high PM should be riskier: ${highPM.overallRisk} vs ${lowPM.overallRisk}`);
  assert.match(highPM.reasoning, /PM2\.5/);
});

// ---------- 5. Missing readings ----------
test("missing AQI → insufficient_data", () => {
  const d = buildExposureDecision(makeAir({ aqi: null }), makeProfile());
  assert.equal(d.overallRisk, "unknown");
  assert.equal(d.activityRecommendation, "insufficient_data");
  assert.match(d.recommendedAction, /monitoring station/i);
});

// ---------- 6. Stale readings ----------
test("stale readings (>3h) → insufficient_data", () => {
  const stale = new Date(Date.now() - 4 * 3600000).toISOString();
  const d = buildExposureDecision(makeAir({ observedAt: stale }), makeProfile());
  assert.equal(d.overallRisk, "unknown");
  assert.equal(d.activityRecommendation, "insufficient_data");
  assert.equal(d.dataFreshness.state, "stale");
});

// ---------- 7. PM2.5 classification ----------
test("getPM25Status classifies correctly", () => {
  assert.equal(getPM25Status(5).label, "Low");
  assert.equal(getPM25Status(20).label, "Moderate");
  assert.equal(getPM25Status(45).label, "High");
  assert.equal(getPM25Status(100).label, "Very high");
  assert.equal(getPM25Status(200).label, "Severe");
  assert.equal(getPM25Status(null).label, "Unknown");
});

// ---------- 8. Data freshness ----------
test("getDataFreshness classifies correctly", () => {
  assert.equal(getDataFreshness(new Date().toISOString()).state, "fresh");
  assert.equal(getDataFreshness(new Date(Date.now() - 90 * 60000).toISOString()).state, "aging");
  assert.equal(getDataFreshness(new Date(Date.now() - 4 * 3600000).toISOString()).state, "stale");
  assert.equal(getDataFreshness(null).state, "unknown");
});

// ---------- 9. Missing forecast data ----------
test("missing forecast does not crash, limitations note it", () => {
  const d = buildExposureDecision(makeAir({ hourly: [] }), makeProfile());
  assert.ok(d.limitations.includes("No forecast data"));
  assert.notEqual(d.activityRecommendation, "insufficient_data");
});

// ---------- 10. Sensitive group advice triggers ----------
test("sensitive profile gets tailored advice at moderate+ risk", () => {
  const d = buildExposureDecision(makeAir({ aqi: 120 }), makeProfile({ sensitivity: "respiratory sensitivity" }));
  assert.ok(d.sensitiveGroupAdvice.length > 50, "should have detailed sensitive advice");
  assert.match(d.sensitiveGroupAdvice, /sensitive/i);
});

// ---------- 11. Alternative activity when avoid ----------
test("avoid recommendation includes alternative activity", () => {
  const d = buildExposureDecision(makeAir({ aqi: 210 }), makeProfile());
  assert.equal(d.activityRecommendation, "avoid");
  assert.match(d.alternativeActivity, /indoor/i);
});

// ---------- 12. Never recommends ignoring advisories ----------
test("limitations always reference official advisories", () => {
  const scenarios = [
    buildExposureDecision(makeAir(), makeProfile()),
    buildExposureDecision(makeAir({ aqi: 200 }), makeProfile()),
    buildExposureDecision(makeAir({ aqi: null }), makeProfile()),
  ];
  for (const d of scenarios) {
    assert.match(d.limitations, /official.*advisor/i, "must reference official advisories");
  }
});

test("missing, invalid, and future observation times → insufficient_data", () => {
  const cases = [null, "not-a-time", new Date(Date.now() + 60 * 60000).toISOString()];
  for (const observedAt of cases) {
    const d = buildExposureDecision(makeAir({ observedAt }), makeProfile());
    assert.equal(d.dataFreshness.state, "unknown");
    assert.equal(d.overallRisk, "unknown");
    assert.equal(d.activityRecommendation, "insufficient_data");
    assert.match(d.recommendedAction, /observation time|monitoring station/i);
  }
});

test("AQI 160 with missing PM2.5 cannot be rated suitable", () => {
  const d = buildExposureDecision(
    makeAir({ aqi: 160, pollutants: { pm25: null } }),
    makeProfile({ activity: "daily activities" }),
  );
  assert.ok(["caution", "avoid"].includes(d.activityRecommendation));
  assert.notEqual(d.overallRisk, "low");
});

test("US AQI 201–299 has a conservative avoid floor even without PM2.5", () => {
  for (const aqi of [201, 250, 299]) {
    const d = buildExposureDecision(
      makeAir({ aqi, pollutants: { pm25: null } }),
      makeProfile({ activity: "daily activities" }),
    );
    assert.equal(d.activityRecommendation, "avoid", `AQI ${aqi}`);
    assert.equal(d.overallRisk, "very_high", `AQI ${aqi}`);
  }
});

test("negative and invalid AQI values → insufficient_data", () => {
  for (const aqi of [-1, -50, "invalid", Number.NaN]) {
    const d = buildExposureDecision(makeAir({ aqi }), makeProfile());
    assert.equal(d.overallRisk, "unknown");
    assert.equal(d.activityRecommendation, "insufficient_data");
  }
});

test("forecast trend is informational and cannot change the current recommendation", () => {
  const base = makeAir({ aqi: 50, pollutants: { pm25: 8 }, hourly: [] });
  const worsening = makeAir({ ...base, hourly: [{ time: "future", aqi: 100 }] });
  const withoutForecast = buildExposureDecision(base, makeProfile());
  const withForecast = buildExposureDecision(worsening, makeProfile());
  assert.equal(withForecast.activityRecommendation, withoutForecast.activityRecommendation);
  assert.equal(withForecast.overallRisk, withoutForecast.overallRisk);
  assert.match(withForecast.reasoning, /forecast suggests/i);
});

test("all allowed activity/profile combinations produce deterministic recommendations at boundaries", () => {
  const activities = ["running", "cycling", "outdoor workout", "sports", "commuting", "daily activities", "children's outdoor play"];
  const ageGroups = ["adult", "child", "older adult"];
  const sensitivities = ["general", "respiratory sensitivity", "heart or lung condition"];
  const boundaries = [0, 50, 51, 100, 101, 150, 151, 200, 201, 299, 300, 301, 500];
  const allowed = new Set(["suitable", "caution", "avoid"]);

  for (const activity of activities) {
    for (const ageGroup of ageGroups) {
      for (const sensitivity of sensitivities) {
        for (const aqi of boundaries) {
          const profile = { activity, ageGroup, sensitivity };
          const air = makeAir({ aqi, pollutants: { pm25: null } });
          const first = buildExposureDecision(air, profile);
          const second = buildExposureDecision(air, profile);
          assert.equal(first.activityRecommendation, second.activityRecommendation);
          assert.equal(first.overallRisk, second.overallRisk);
          assert.equal(first.recommendedAction, second.recommendedAction);
          assert.equal(first.reasoning, second.reasoning);
          assert.ok(allowed.has(first.activityRecommendation), `${activity}/${ageGroup}/${sensitivity}/AQI ${aqi}`);
          assert.match(first.limitations, /not.*medical advice/i);
        }
      }
    }
  }
});

const WIND_NOW = Date.parse("2026-11-25T21:00:00.000Z");
const windAt = (minutes) => new Date(WIND_NOW + minutes * 60000).toISOString();

function windAir(overrides = {}) {
  return {
    aqi: 80,
    aqiScale: "US AQI",
    pollutants: { pm25: 8 },
    weather: { wind_speed_10m: 4.9 },
    observedAt: windAt(0),
    forecastValidAt: windAt(-15),
    retrievedAt: windAt(-2),
    weatherRetrievedAt: windAt(-3),
    metadata: { isModelledEstimate: true },
    hourly: [],
    ...overrides,
  };
}

const commute = { activity: "commuting", ageGroup: "adult", sensitivity: "general" };

test("fresh air and fresh weather apply the 0.5 wind adjustment only below 5 km/h", () => {
  const calm = buildExposureDecision(windAir(), commute, WIND_NOW);
  const threshold = buildExposureDecision(windAir({ weather: { wind_speed_10m: 5 } }), commute, WIND_NOW);
  const breezy = buildExposureDecision(windAir({ weather: { wind_speed_10m: 12 } }), commute, WIND_NOW);
  assert.equal(calm.wind.points, 0.5);
  assert.equal(calm.wind.applied, true);
  assert.equal(calm.wind.state, "included");
  assert.equal(calm.overallRisk, "moderate");
  assert.equal(calm.dataFreshness.timestamp, windAt(-2));
  assert.equal(calm.wind.freshness.timestamp, windAt(-3));
  assert.notEqual(calm.dataFreshness.timestamp, calm.wind.freshness.timestamp);
  assert.equal(calm.wind.disclosure, "Wind of 4.9 km/h increased the exposure score by 0.5 points. Retrieved 3 minutes ago.");
  assert.match(calm.reasoning, /increased the exposure score by 0\.5 points/);
  assert.equal(threshold.wind.points, 0);
  assert.equal(threshold.wind.applied, true);
  assert.equal(threshold.overallRisk, "low");
  assert.equal(threshold.wind.disclosure, "Wind of 5 km/h was considered; no score adjustment was needed. Retrieved 3 minutes ago.");
  assert.equal(breezy.wind.points, 0);
  assert.equal(breezy.overallRisk, "low");
  assert.equal(breezy.activityRecommendation, calm.activityRecommendation);
});

test("aging weather keeps the wind adjustment and discloses its age", () => {
  const decision = buildExposureDecision(windAir({ weatherRetrievedAt: windAt(-90) }), commute, WIND_NOW);
  assert.equal(decision.wind.state, "included_aging");
  assert.equal(decision.wind.points, 0.5);
  assert.equal(decision.overallRisk, "moderate");
  assert.equal(decision.wind.disclosure, "Wind of 4.9 km/h increased the exposure score by 0.5 points. Retrieved 2 hours ago. The reading may not reflect current conditions.");
  assert.equal(decision.dataFreshness.state, "fresh");
});

test("stale, missing, invalid, and future weather retrieval excludes the wind adjustment", () => {
  const stale = buildExposureDecision(windAir({ weatherRetrievedAt: windAt(-240) }), commute, WIND_NOW);
  assert.equal(stale.wind.state, "excluded_stale");
  assert.equal(stale.wind.points, 0);
  assert.equal(stale.overallRisk, "low");
  assert.equal(stale.wind.disclosure, "Wind of 4.9 km/h was excluded from scoring because the weather data is too old. Retrieved 4 hours ago.");
  assert.equal(stale.dataFreshness.state, "fresh");

  for (const weatherRetrievedAt of [null, undefined, "", "not-a-time", windAt(30)]) {
    const decision = buildExposureDecision(windAir({ weatherRetrievedAt }), commute, WIND_NOW);
    assert.equal(decision.wind.state, "excluded_retrieval_time", String(weatherRetrievedAt));
    assert.equal(decision.wind.points, 0);
    assert.equal(decision.overallRisk, "low");
    assert.match(decision.reasoning, /excluded from scoring because the weather retrieval time is missing, invalid, or in the future/);
    assert.notEqual(decision.wind.freshness.timestamp, decision.dataFreshness.timestamp);
  }

  const withinSkew = buildExposureDecision(windAir({ weatherRetrievedAt: windAt(4) }), commute, WIND_NOW);
  assert.equal(withinSkew.wind.applied, true);
  assert.equal(withinSkew.wind.points, 0.5);
  const beyondSkew = buildExposureDecision(windAir({ weatherRetrievedAt: windAt(6) }), commute, WIND_NOW);
  assert.equal(beyondSkew.wind.state, "excluded_retrieval_time");
  assert.equal(beyondSkew.wind.points, 0);
});

test("missing wind is excluded and is not described as favorable", () => {
  const decision = buildExposureDecision(windAir({ weather: {} }), commute, WIND_NOW);
  assert.equal(decision.wind.state, "excluded_missing_wind");
  assert.equal(decision.wind.points, 0);
  assert.equal(decision.wind.windSpeedKmh, null);
  assert.equal(decision.wind.disclosure, "Wind was unavailable and was not used in the exposure score. Missing wind is not treated as favorable.");
  assert.doesNotMatch(decision.wind.disclosure, /favorable wind|increased the exposure score/);
  assert.equal(decision.overallRisk, "low");
});

test("stale air still fails its own freshness gate when weather is fresh", () => {
  const decision = buildExposureDecision(windAir({ retrievedAt: windAt(-240) }), commute, WIND_NOW);
  assert.equal(decision.dataFreshness.state, "stale");
  assert.equal(decision.activityRecommendation, "insufficient_data");
  assert.equal(decision.wind.freshness.state, "fresh");
  assert.equal(decision.wind.freshness.timestamp, windAt(-3));
});

test("wind explanations distinguish a score change from a considered reading", () => {
  const justNow = buildExposureDecision(windAir({ weather: { wind_speed_10m: 5 }, weatherRetrievedAt: windAt(0) }), commute, WIND_NOW);
  assert.equal(justNow.wind.points, 0);
  assert.equal(justNow.wind.disclosure, "Wind of 5 km/h was considered; no score adjustment was needed. Retrieved just now.");

  const above = buildExposureDecision(windAir({ weather: { wind_speed_10m: 12 }, weatherRetrievedAt: windAt(-2) }), commute, WIND_NOW);
  assert.equal(above.wind.points, 0);
  assert.equal(above.wind.state, "included");
  assert.equal(above.wind.disclosure, "Wind of 12 km/h was considered; no score adjustment was needed. Retrieved 2 minutes ago.");
  assert.equal(above.overallRisk, "low");
  assert.equal(above.activityRecommendation, "suitable");

  const agingBreezy = buildExposureDecision(windAir({ weather: { wind_speed_10m: 8 }, weatherRetrievedAt: windAt(-90) }), commute, WIND_NOW);
  assert.equal(agingBreezy.wind.points, 0);
  assert.equal(agingBreezy.wind.state, "included_aging");
  assert.equal(agingBreezy.wind.disclosure, "Wind of 8 km/h was considered; no score adjustment was needed. Retrieved 2 hours ago. The reading may not reflect current conditions.");

  for (const windSpeed of ["", "fast", -1, Number.NaN]) {
    const decision = buildExposureDecision(windAir({ weather: { wind_speed_10m: windSpeed } }), commute, WIND_NOW);
    assert.equal(decision.wind.state, "excluded_missing_wind", String(windSpeed));
    assert.equal(decision.wind.points, 0);
    assert.equal(decision.wind.disclosure, "Wind was unavailable and was not used in the exposure score. Missing wind is not treated as favorable.");
    assert.equal(decision.overallRisk, "low");
  }
});

test("fresh wind at or above 5 km/h leaves existing recommendations unchanged", () => {
  const activities = ["running", "daily activities", "commuting"];
  for (const activity of activities) {
    for (const aqi of [35, 80, 120, 185]) {
      const profile = { activity, ageGroup: "adult", sensitivity: "general" };
      const fresh = buildExposureDecision(windAir({ aqi, weather: { wind_speed_10m: 12 }, weatherRetrievedAt: windAt(-1) }), profile, WIND_NOW);
      const noWind = buildExposureDecision(windAir({ aqi, weather: {}, weatherRetrievedAt: windAt(-1) }), profile, WIND_NOW);
      assert.equal(fresh.wind.points, 0);
      assert.equal(fresh.activityRecommendation, noWind.activityRecommendation, `${activity} ${aqi}`);
      assert.equal(fresh.overallRisk, noWind.overallRisk, `${activity} ${aqi}`);
      assert.equal(fresh.recommendedAction, noWind.recommendedAction, `${activity} ${aqi}`);
    }
  }
});

const FAVORABLE_ACTIVITY_ADVICE = /satisfactory|favorable for|continue usual|most people can continue/i;

test("fresh Good air keeps category advice and the existing exposure decision", () => {
  assert.equal(getAQIStatus(0).label, "Good");
  assert.equal(getAQIStatus(50).label, "Good");
  assert.equal(getAQIStatus(50).level, 1);
  assert.equal(getAQIStatus(51).label, "Moderate");
  assert.equal(getAQIStatus(101).level, 3);
  assert.equal(getAQIStatus(151).level, 4);
  assert.equal(getAQIStatus(201).level, 5);
  assert.equal(getAQIStatus(301).level, 6);
  assert.match(getAQIStatus(41).advice, /generally satisfactory/);

  const profile = { activity: "running", ageGroup: "adult", sensitivity: "general" };
  const air = windAir({ aqi: 35, pollutants: { pm25: 8 }, weather: { wind_speed_10m: 12 } });
  const decision = buildExposureDecision(air, profile, WIND_NOW);
  const context = buildRecommendationContext(air, profile, "Can I run?", decision);
  assert.equal(decision.activityRecommendation, "suitable");
  assert.equal(decision.overallRisk, "low");
  assert.match(decision.recommendedAction, /favorable for running/);
  assert.equal(context.recommendation, getAQIStatus(35).advice);
  assert.equal(context.categoryDescription, getAQIStatus(35).advice);
  assert.match(context.answer, /recommendation: suitable/i);
});

test("stale, missing, invalid, and future air retrieval cannot recommend favorable activity", () => {
  const profile = { activity: "daily activities", ageGroup: "adult", sensitivity: "general" };
  const cases = [
    ["stale", windAt(-240)],
    ["missing", null],
    ["blank", ""],
    ["invalid", "not-a-time"],
    ["future", windAt(30)],
  ];
  for (const [name, retrievedAt] of cases) {
    const air = windAir({ aqi: 41, retrievedAt });
    const decision = buildExposureDecision(air, profile, WIND_NOW);
    const context = buildRecommendationContext(air, profile, "Can I go out?", decision);
    assert.equal(decision.activityRecommendation, "insufficient_data", name);
    assert.equal(air.aqi, 41, name);
    assert.equal(getAQIStatus(air.aqi).label, "Good", name);
    assert.equal(context.category, "Good", name);
    assert.match(context.categoryDescription, /generally satisfactory/, name);
    assert.equal(context.recommendation, decision.recommendedAction, name);
    assert.equal(context.recommendation, insufficientExposureGuidance(decision.dataFreshness), name);
    assert.doesNotMatch(context.recommendation, FAVORABLE_ACTIVITY_ADVICE, name);
    assert.doesNotMatch(decision.recommendedAction, FAVORABLE_ACTIVITY_ADVICE, name);
    assert.match(context.answer, /insufficient data/i, name);
    assert.match(context.answer, new RegExp(decision.recommendedAction.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), name);
  }

  const recoveredAir = windAir({ aqi: 41 });
  const recovered = buildExposureDecision(recoveredAir, profile, WIND_NOW);
  const recoveredContext = buildRecommendationContext(recoveredAir, profile, "Can I go out?", recovered);
  assert.equal(recovered.dataFreshness.state, "fresh");
  assert.equal(recovered.activityRecommendation, "suitable");
  assert.equal(recoveredContext.recommendation, getAQIStatus(41).advice);
  assert.match(recoveredContext.recommendation, /generally satisfactory/);
});

test("decision trace matches the deterministic engine output", () => {
  const now = Date.parse("2026-11-26T12:00:00.000Z");
  const air = makeAir({
    aqi: 101,
    pollutants: { pm25: 8 },
    weather: { wind_speed_10m: 12 },
    forecastValidAt: "2026-11-26T11:00:00.000Z",
    retrievedAt: "2026-11-26T11:58:00.000Z",
    weatherRetrievedAt: "2026-11-26T11:58:00.000Z",
    metadata: { isModelledEstimate: true },
  });
  const profile = makeProfile({ activity: "running", ageGroup: "child", sensitivity: "general" });
  const decision = buildExposureDecision(air, profile, now);
  assert.equal(decision.activityRecommendation, "caution");
  assert.equal(decision.trace.scoringApplied, true);
  assert.equal(decision.trace.airQuality.value, 101);
  assert.equal(decision.trace.airQuality.category, getAQIStatus(101).label);
  assert.equal(decision.trace.pm25.value, 8);
  assert.equal(decision.trace.pm25.category, getPM25Status(8).label);
  assert.equal(decision.trace.weather.freshnessState, decision.wind.freshness.state);
  assert.equal(decision.trace.wind.points, decision.wind.points);
  assert.equal(decision.trace.wind.disclosure, decision.wind.disclosure);
  const windFactor = decision.trace.factors.find((factor) => factor.factor === "Wind");
  assert.equal(windFactor.contribution, decision.wind.points);
  assert.equal(windFactor.detail, decision.wind.disclosure);
  const sum = decision.trace.factors.reduce((total, factor) => total + factor.contribution, 0);
  assert.equal(sum, 5.5);
  assert.equal(decision.trace.result.activityRecommendation, decision.activityRecommendation);
  assert.equal(decision.trace.result.overallRisk, decision.overallRisk);
  assert.equal(decision.trace.result.recommendedAction, decision.recommendedAction);
  assert.equal(decision.trace.profile.activity, "running");
  assert.equal(decision.trace.profile.ageGroup, "child");
  assert.equal(decision.trace.unavailable.some((item) => /forecast/i.test(item)), false);
});

test("a wind hypothetical does not change the actual decision", () => {
  const now = Date.parse("2026-11-26T12:00:00.000Z");
  const air = makeAir({
    aqi: 101,
    pollutants: { pm25: 8 },
    weather: { wind_speed_10m: 12 },
    forecastValidAt: "2026-11-26T11:00:00.000Z",
    retrievedAt: "2026-11-26T11:58:00.000Z",
    weatherRetrievedAt: "2026-11-26T11:58:00.000Z",
    metadata: { isModelledEstimate: true },
  });
  const profile = makeProfile({ activity: "running", ageGroup: "child", sensitivity: "general" });
  const before = buildExposureDecision(air, profile, now);
  const snapshot = structuredClone(before);
  const hypothetical = buildWindHypothetical(air, profile, 3, now);
  assert.deepEqual(buildExposureDecision(air, profile, now), snapshot);
  assert.equal(before.activityRecommendation, "caution");
  assert.equal(hypothetical.label, "Hypothetical");
  assert.equal(hypothetical.assumedWindSpeedKmh, 3);
  assert.equal(hypothetical.activityRecommendation, "avoid");
  assert.match(hypothetical.note, /not a retrieved or current measurement/);
  assert.match(hypothetical.note, /does not change the current decision/);
  assert.match(hypothetical.windDisclosure, /Assumed wind of 3 km\/h is not a retrieved measurement/);
  assert.doesNotMatch(hypothetical.windDisclosure, /Retrieved/);
  assert.equal(parseWindHypothetical("What if the wind speed were 3 km/h instead?"), 3);
  assert.equal(parseWindHypothetical("Why does PM2.5 matter?"), null);
  assert.equal(air.weather.wind_speed_10m, 12);
});
