import test from "node:test";
import assert from "node:assert/strict";
import { buildExposureDecision, getPM25Status, getDataFreshness } from "./logic.js";

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
