import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function loadReliabilityModule() {
  const source = await readFile(new URL("../src/reliability.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

test("US AQI presentation matches every EPA category boundary", async () => {
  const { getAqiPresentation } = await loadReliabilityModule();
  const cases = [
    [0, "Good"], [50, "Good"],
    [51, "Moderate"], [100, "Moderate"],
    [101, "Unhealthy for Sensitive Groups"], [150, "Unhealthy for Sensitive Groups"],
    [151, "Unhealthy"], [200, "Unhealthy"],
    [201, "Very Unhealthy"], [300, "Very Unhealthy"],
    [301, "Hazardous"], [500, "Hazardous"],
  ];
  for (const [value, label] of cases) {
    assert.equal(getAqiPresentation(value).label, label, `AQI ${value}`);
  }
});

test("missing and invalid AQI display as unavailable without a Good-scale marker", async () => {
  const { getAqiPresentation } = await loadReliabilityModule();
  for (const value of [null, undefined, -1, Number.NaN]) {
    const result = getAqiPresentation(value);
    assert.equal(result.value, null);
    assert.equal(result.label, "Data unavailable");
    assert.equal(result.markerPercent, null);
    assert.equal(result.level, 0);
  }
  assert.equal(getAqiPresentation(500).markerPercent, 100);
});

test("freshness labels avoid misleading FRESH MODEL DATA when model initialization time is unavailable", async () => {
  const { getFreshnessPresentation, formatTimingDisclosure, formatSourceDisclosure } = await loadReliabilityModule();
  const now = Date.parse("2026-11-25T16:00:00Z");

  // Without genuine modelInitializedAt, never claim FRESH MODEL DATA even when forecast valid time is recent.
  const estimate = getFreshnessPresentation({
    forecastValidAt: "2026-11-25T15:45:00Z",
    modelInitializedAt: null,
    retrievedAt: "2026-11-25T15:58:00Z",
  }, now);
  assert.equal(estimate.state, "estimate");
  assert.equal(estimate.label, "FORECAST ESTIMATE");
  assert.equal(estimate.isFresh, false);
  assert.equal(estimate.modelRunAgeLabel, "Model run age unavailable");

  assert.equal(getFreshnessPresentation(null, now).state, "unavailable");
  assert.equal(getFreshnessPresentation({ forecastValidAt: null, retrievedAt: "2026-11-25T15:58:00Z" }, now).label, "DATA UNAVAILABLE");
  assert.equal(getFreshnessPresentation({ forecastValidAt: "garbage", retrievedAt: "2026-11-25T15:58:00Z" }, now).label, "TIME UNAVAILABLE");

  // A genuine model initialization time is disclosed separately and never drives the badge.
  const realInit = getFreshnessPresentation({
    forecastValidAt: "2026-11-25T15:45:00Z",
    modelInitializedAt: "2026-11-25T12:00:00Z",
    retrievedAt: "2026-11-25T15:58:00Z",
  }, now);
  assert.equal(realInit.state, "estimate");
  assert.equal(realInit.label, "FORECAST ESTIMATE");
  assert.equal(realInit.isFresh, false);
  assert.equal(realInit.modelRunAgeLabel, "Model run 4h ago");
  const oldInit = getFreshnessPresentation({
    forecastValidAt: "2026-11-25T15:45:00Z",
    modelInitializedAt: "2026-11-24T00:00:00Z",
    retrievedAt: "2026-11-25T15:58:00Z",
  }, now);
  assert.equal(oldInit.state, "estimate");
  assert.equal(oldInit.modelRunAgeLabel, "Model run 40h ago");

  // Valid time, retrieval time, and model run age stay clearly separated and timezone-aware.
  const ist = formatTimingDisclosure({
    forecastValidAt: "2026-11-25T15:00:00Z",
    retrievedAt: "2026-11-25T15:58:00Z",
    modelInitializedAt: null,
    timezone: "Asia/Kolkata",
    now,
    locale: "en-US",
  });
  assert.match(ist.validTimeText, /Forecast valid for 08:30/);
  assert.equal(ist.retrievedTimeText, "Retrieved at 09:28 PM (2 min ago)");
  assert.equal(ist.modelRunText, "Model run age unavailable");
  assert.notEqual(ist.validTimeText, ist.retrievedTimeText);

  const ny = formatTimingDisclosure({
    forecastValidAt: "2026-11-25T15:00:00Z",
    retrievedAt: "2026-11-25T15:58:00Z",
    modelInitializedAt: null,
    timezone: "America/New_York",
    now,
    locale: "en-US",
  });
  assert.match(ny.validTimeText, /Forecast valid for 10:00/);
  assert.match(ny.retrievedTimeText, /Retrieved at 10:58/);

  const utcFallback = formatTimingDisclosure({
    forecastValidAt: "2026-11-25T15:00:00Z",
    retrievedAt: null,
    modelInitializedAt: null,
    timezone: "Invalid/Zone",
    now,
    locale: "en-US",
  });
  assert.match(utcFallback.validTimeText, /UTC/);
  assert.equal(utcFallback.retrievedTimeText, "Retrieval time unavailable");

  // Resolution is only displayed when verified.
  assert.equal(
    formatSourceDisclosure({
      model: { id: "cams_global", name: "CAMS global model", providerSupplied: false, basis: "documented_outside_cams_europe_coverage" },
      spatialResolution: { nominalDegrees: 0.4, approximateKm: 45, verified: true, label: "Approx. 45 km nominal resolution", servingCellBehavior: null },
    }),
    "Modelled air-quality estimate · CAMS global model · Approx. 45 km nominal resolution.",
  );
  const unverified = formatSourceDisclosure({
    model: { id: null, name: null, providerSupplied: false, basis: "unverified_auto_domain" },
    spatialResolution: { nominalDegrees: null, approximateKm: null, verified: false, label: null, servingCellBehavior: null },
  });
  assert.doesNotMatch(unverified, /45 km|11 km/);
  assert.match(unverified, /Not a local station observation/i);
});

test("forecast valid time never ages the data; only retrievedAt does", async () => {
  const { getFreshnessPresentation, formatTimingDisclosure } = await loadReliabilityModule();
  const now = Date.parse("2026-11-25T16:00:00Z");
  const minutes = (n) => new Date(now + n * 60000).toISOString();

  // Valid time 45 min in the past, retrieved recently: an estimate, not outdated.
  const pastValid = getFreshnessPresentation({ forecastValidAt: minutes(-45), retrievedAt: minutes(-2), modelInitializedAt: null }, now);
  assert.equal(pastValid.state, "estimate");
  assert.equal(pastValid.label, "FORECAST ESTIMATE");
  assert.equal(pastValid.retrievalAgeLabel, "Retrieved 2 min ago");

  // Valid time many hours in the past is still not outdated when retrieval is recent.
  const veryPastValid = getFreshnessPresentation({ forecastValidAt: minutes(-6 * 60), retrievedAt: minutes(-1) }, now);
  assert.equal(veryPastValid.state, "estimate");
  assert.notEqual(veryPastValid.label, "OUTDATED FORECAST");

  // Valid time in the future, but retrieval is old: old retrieved data.
  const futureValidOldRetrieval = getFreshnessPresentation({ forecastValidAt: minutes(60), retrievedAt: minutes(-4 * 60) }, now);
  assert.equal(futureValidOldRetrieval.state, "stale");
  assert.equal(futureValidOldRetrieval.label, "OLD RETRIEVED DATA");
  assert.equal(futureValidOldRetrieval.modelRunAgeLabel, "Model run age unavailable");

  // Recent retrieval with unknown model initialization.
  const recentUnknownInit = getFreshnessPresentation({ forecastValidAt: minutes(0), retrievedAt: minutes(-10), modelInitializedAt: null }, now);
  assert.equal(recentUnknownInit.state, "estimate");
  assert.equal(recentUnknownInit.modelRunAgeLabel, "Model run age unavailable");

  // Aging retrieval (between 30 min and 3 h) stays usable but visibly aging.
  const agingRetrieval = getFreshnessPresentation({ forecastValidAt: minutes(0), retrievedAt: minutes(-90) }, now);
  assert.equal(agingRetrieval.state, "aging");
  assert.equal(agingRetrieval.label, "FORECAST ESTIMATE");

  // Old retrieval with unknown model initialization: retrieval age, not model age, is old.
  const oldUnknownInit = getFreshnessPresentation({ forecastValidAt: minutes(0), retrievedAt: minutes(-3 * 60 - 1), modelInitializedAt: null }, now);
  assert.equal(oldUnknownInit.state, "stale");
  assert.equal(oldUnknownInit.label, "OLD RETRIEVED DATA");
  assert.equal(oldUnknownInit.modelRunAgeLabel, "Model run age unavailable");

  // Missing and invalid retrievedAt never fall back to valid time.
  for (const retrievedAt of [null, undefined, "", "not-a-time", minutes(30)]) {
    const missing = getFreshnessPresentation({ forecastValidAt: minutes(0), retrievedAt }, now);
    assert.equal(missing.state, "unavailable", String(retrievedAt));
    assert.equal(missing.label, "RETRIEVAL TIME UNAVAILABLE", String(retrievedAt));
  }
  // Small browser clock skew does not invalidate a just-retrieved response.
  assert.equal(getFreshnessPresentation({ forecastValidAt: minutes(0), retrievedAt: minutes(2) }, now).state, "estimate");

  // Genuine model initialization: separate age, no effect on retrieval state.
  const genuine = formatTimingDisclosure({
    forecastValidAt: minutes(-45),
    retrievedAt: minutes(-5),
    modelInitializedAt: minutes(-9 * 60),
    timezone: "UTC",
    now,
    locale: "en-US",
  });
  assert.match(genuine.modelRunText, /^Model run 9h ago/);
  assert.match(genuine.retrievedTimeText, /\(5 min ago\)$/);
  const futureInit = getFreshnessPresentation({ forecastValidAt: minutes(0), retrievedAt: minutes(-5), modelInitializedAt: minutes(60) }, now);
  assert.equal(futureInit.modelRunAgeLabel, "Model run age unavailable");

  // Timezone differences change displayed clocks, never ages or states.
  const zones = ["Asia/Kolkata", "America/New_York", "Pacific/Auckland", "UTC"];
  const states = zones.map((timezone) => {
    const timing = formatTimingDisclosure({ forecastValidAt: minutes(-45), retrievedAt: minutes(-20), modelInitializedAt: null, timezone, now, locale: "en-US" });
    assert.match(timing.retrievedTimeText, /\(20 min ago\)$/, timezone);
    return getFreshnessPresentation({ forecastValidAt: minutes(-45), retrievedAt: minutes(-20) }, now).state;
  });
  assert.deepEqual(new Set(states), new Set(["estimate"]));
  const kolkata = formatTimingDisclosure({ forecastValidAt: minutes(-45), retrievedAt: minutes(-20), timezone: "Asia/Kolkata", now, locale: "en-US" });
  const newYork = formatTimingDisclosure({ forecastValidAt: minutes(-45), retrievedAt: minutes(-20), timezone: "America/New_York", now, locale: "en-US" });
  assert.equal(kolkata.validTimeText, "Forecast valid for 08:45 PM");
  assert.equal(newYork.validTimeText, "Forecast valid for 10:15 AM");
  // An offset-qualified retrievedAt is the same instant as its UTC form.
  assert.equal(
    getFreshnessPresentation({ forecastValidAt: minutes(0), retrievedAt: "2026-11-25T21:10:00+05:30" }, now).retrievalAgeLabel,
    "Retrieved 20 min ago",
  );
});

test("overview activity advice follows retrieval freshness and matches the exposure engine", async () => {
  const {
    describeCurrentActivityGuidance,
    getAqiPresentation,
    getFreshnessPresentation,
    MODELLED_STALE_ACTIVITY_GUIDANCE,
    MODELLED_UNKNOWN_ACTIVITY_GUIDANCE,
  } = await loadReliabilityModule();
  const { getAQIStatus, insufficientExposureGuidance } = await import("./logic.js");
  const now = Date.parse("2026-11-25T21:00:00.000Z");
  const at = (minutes) => new Date(now + minutes * 60000).toISOString();
  const advice = getAQIStatus(41).advice;
  assert.equal(getAqiPresentation(41).value, 41);
  assert.equal(getAqiPresentation(41).label, "Good");

  const freshState = getFreshnessPresentation({ forecastValidAt: at(-15), retrievedAt: at(-2) }, now).state;
  const fresh = describeCurrentActivityGuidance({ categoryLabel: "Good", categoryAdvice: advice, freshnessState: freshState });
  assert.equal(fresh.blocked, false);
  assert.equal(fresh.guidance, advice);
  assert.match(fresh.guidance, /generally satisfactory/);

  const staleState = getFreshnessPresentation({ forecastValidAt: at(-15), retrievedAt: at(-240) }, now).state;
  const stale = describeCurrentActivityGuidance({ categoryLabel: "Good", categoryAdvice: advice, freshnessState: staleState });
  assert.equal(staleState, "stale");
  assert.equal(stale.blocked, true);
  assert.equal(stale.guidance, MODELLED_STALE_ACTIVITY_GUIDANCE);
  assert.equal(stale.guidance, insufficientExposureGuidance({ basis: "retrievedAt", state: "stale" }));
  assert.doesNotMatch(stale.guidance, /satisfactory|favorable/);
  assert.match(stale.categoryNote, /US AQI category: Good/);
  assert.match(stale.categoryNote, /not a current activity recommendation/);

  for (const retrievedAt of [null, "not-a-time", at(30)]) {
    const state = getFreshnessPresentation({ forecastValidAt: at(0), retrievedAt }, now).state;
    const copy = describeCurrentActivityGuidance({ categoryLabel: "Good", categoryAdvice: advice, freshnessState: state });
    assert.equal(state, "unavailable", String(retrievedAt));
    assert.equal(copy.guidance, MODELLED_UNKNOWN_ACTIVITY_GUIDANCE);
    assert.equal(copy.guidance, insufficientExposureGuidance({ basis: "retrievedAt", state: "unknown" }));
    assert.doesNotMatch(copy.guidance, /satisfactory|favorable/);
  }

  const recovered = describeCurrentActivityGuidance({ categoryLabel: "Good", categoryAdvice: advice, freshnessState: freshState });
  assert.equal(recovered.guidance, advice);
  assert.equal(recovered.blocked, false);

  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /describeCurrentActivityGuidance/);
  assert.match(app, /aqi-classification/);
  assert.match(app, /aqiPresentation\.value === null \? null : freshness\.state/);
});

test("current-air clock skew agrees between the overview and the exposure decision", async () => {
  const { describeCurrentActivityGuidance, getFreshnessPresentation } = await loadReliabilityModule();
  const { buildExposureDecision, getAQIStatus, insufficientExposureGuidance } = await import("./logic.js");
  const now = Date.parse("2026-11-25T21:00:00.000Z");
  const profile = { activity: "daily activities", ageGroup: "adult", sensitivity: "general" };
  const advice = getAQIStatus(41).advice;
  const validAt = "2026-11-25T20:30:00.000Z";
  const futureModelRun = "2026-11-25T23:00:00.000Z";

  function classify(retrievedAt) {
    const presentation = getFreshnessPresentation({
      forecastValidAt: validAt,
      modelInitializedAt: futureModelRun,
      retrievedAt,
    }, now);
    const decision = buildExposureDecision({
      aqi: 41,
      aqiScale: "US AQI",
      pollutants: { pm25: 8 },
      weather: { wind_speed_10m: 12 },
      forecastValidAt: validAt,
      observedAt: validAt,
      retrievedAt,
      modelInitializedAt: futureModelRun,
      weatherRetrievedAt: new Date(now - 2 * 60000).toISOString(),
      metadata: { isModelledEstimate: true },
    }, profile, now);
    const overview = presentation.state === "estimate" ? "fresh" : presentation.state === "unavailable" ? "unknown" : presentation.state;
    const guidance = describeCurrentActivityGuidance({
      categoryLabel: "Good",
      categoryAdvice: advice,
      freshnessState: presentation.state,
    });
    return { presentation, decision, overview, guidance };
  }

  for (const [label, retrievedAt] of [
    ["4 min ahead UTC", "2026-11-25T21:04:00.000Z"],
    ["4 min ahead IST", "2026-11-26T02:34:00+05:30"],
    ["exactly 5 min ahead UTC", "2026-11-25T21:05:00.000Z"],
    ["exactly 5 min ahead IST", "2026-11-26T02:35:00+05:30"],
  ]) {
    const result = classify(retrievedAt);
    assert.equal(result.overview, "fresh", label);
    assert.equal(result.decision.dataFreshness.state, "fresh", label);
    assert.equal(result.decision.dataFreshness.ageMs, 0, label);
    assert.equal(result.decision.dataFreshness.basis, "retrievedAt", label);
    assert.notEqual(result.decision.dataFreshness.timestamp, validAt, label);
    assert.equal(result.decision.activityRecommendation, "suitable", label);
    assert.equal(result.guidance.blocked, false, label);
    assert.equal(result.guidance.guidance, advice, label);
  }

  const utc = classify("2026-11-25T21:04:00.000Z");
  const ist = classify("2026-11-26T02:34:00+05:30");
  assert.equal(utc.decision.dataFreshness.ageMs, ist.decision.dataFreshness.ageMs);
  assert.equal(utc.decision.dataFreshness.timestamp, ist.decision.dataFreshness.timestamp);
  assert.equal(utc.decision.dataFreshness.timestamp, "2026-11-25T21:04:00.000Z");
  assert.equal(utc.overview, ist.overview);

  for (const [label, retrievedAt] of [
    ["6 min ahead UTC", "2026-11-25T21:06:00.000Z"],
    ["6 min ahead IST", "2026-11-26T02:36:00+05:30"],
  ]) {
    const result = classify(retrievedAt);
    assert.equal(result.overview, "unknown", label);
    assert.equal(result.decision.dataFreshness.state, "unknown", label);
    assert.equal(result.decision.activityRecommendation, "insufficient_data", label);
    assert.equal(result.guidance.blocked, true, label);
    assert.equal(result.guidance.guidance, insufficientExposureGuidance(result.decision.dataFreshness), label);
    assert.doesNotMatch(result.guidance.guidance, /satisfactory|favorable/, label);
  }

  for (const [label, retrievedAt, engine, overviewState] of [
    ["fresh", new Date(now - 2 * 60000).toISOString(), "fresh", "estimate"],
    ["aging", new Date(now - 90 * 60000).toISOString(), "aging", "aging"],
    ["stale", new Date(now - 4 * 60 * 60000).toISOString(), "stale", "stale"],
    ["missing", null, "unknown", "unavailable"],
    ["blank", "", "unknown", "unavailable"],
    ["invalid", "not-a-time", "unknown", "unavailable"],
  ]) {
    const result = classify(retrievedAt);
    assert.equal(result.decision.dataFreshness.state, engine, label);
    assert.equal(result.presentation.state, overviewState, label);
    assert.equal(result.overview, engine, label);
    if (engine === "fresh" || engine === "aging") assert.notEqual(result.decision.activityRecommendation, "insufficient_data", label);
    if (engine === "stale" || engine === "unknown") assert.equal(result.decision.activityRecommendation, "insufficient_data", label);
  }
});

test("the weather strip uses the same wind explanation as the exposure decision", async () => {
  const { describeWindUse, formatReportedWindSpeed } = await loadReliabilityModule();
  assert.equal(formatReportedWindSpeed(5.5), "5.5 km/h");
  assert.equal(formatReportedWindSpeed(6), "6 km/h");
  assert.equal(formatReportedWindSpeed(-1), "N/A");
  const { buildExposureDecision } = await import("./logic.js");
  const now = Date.parse("2026-11-25T21:00:00.000Z");
  const at = (minutes) => new Date(now + minutes * 60000).toISOString();
  const profile = { activity: "commuting", ageGroup: "adult", sensitivity: "general" };
  const cases = [
    { windSpeedKmh: 4.9, weatherRetrievedAt: at(-2), disclosure: "Wind of 4.9 km/h increased the exposure score by 0.5 points. Retrieved 2 minutes ago." },
    { windSpeedKmh: 5, weatherRetrievedAt: at(0), disclosure: "Wind of 5 km/h was considered; no score adjustment was needed. Retrieved just now." },
    { windSpeedKmh: 12, weatherRetrievedAt: at(-2), disclosure: "Wind of 12 km/h was considered; no score adjustment was needed. Retrieved 2 minutes ago." },
    { windSpeedKmh: 4.9, weatherRetrievedAt: at(-90), disclosure: "Wind of 4.9 km/h increased the exposure score by 0.5 points. Retrieved 2 hours ago. The reading may not reflect current conditions." },
    { windSpeedKmh: 4.9, weatherRetrievedAt: at(-240), disclosure: "Wind of 4.9 km/h was excluded from scoring because the weather data is too old. Retrieved 4 hours ago." },
    { windSpeedKmh: 3, weatherRetrievedAt: null, disclosure: "Wind of 3 km/h was excluded from scoring because the weather retrieval time is missing, invalid, or in the future." },
    { windSpeedKmh: "fast", weatherRetrievedAt: at(-1), disclosure: "Wind was unavailable and was not used in the exposure score. Missing wind is not treated as favorable." },
  ];
  for (const item of cases) {
    const strip = describeWindUse({ windSpeedKmh: item.windSpeedKmh, weatherRetrievedAt: item.weatherRetrievedAt }, now);
    const decision = buildExposureDecision({
      aqi: 80,
      aqiScale: "US AQI",
      pollutants: { pm25: 8 },
      weather: { wind_speed_10m: item.windSpeedKmh },
      observedAt: at(0),
      forecastValidAt: at(-15),
      retrievedAt: at(-2),
      weatherRetrievedAt: item.weatherRetrievedAt,
      metadata: { isModelledEstimate: true },
      hourly: [],
    }, profile, now);
    assert.equal(strip.text, item.disclosure, String(item.windSpeedKmh));
    assert.equal(decision.wind.disclosure, strip.text, String(item.windSpeedKmh));
    assert.doesNotMatch(strip.text, /favorable wind/);
  }
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/design-system.css", import.meta.url), "utf8");
  assert.match(app, /describeWindUse/);
  assert.match(app, /weather-note/);
  assert.match(css, /\.weather-note \{[\s\S]*overflow-wrap: anywhere/);
});

test("client freshness source has no valid-time aging or invented model thresholds", async () => {
  const source = await readFile(new URL("../src/reliability.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /OUTDATED FORECAST/);
  assert.doesNotMatch(source, /MODEL RUN \$\{/);
  assert.doesNotMatch(source, /validAge/);
  assert.doesNotMatch(source, /(6|18) \* 60 \* 60 \* 1000/);
});

test("manual location changes invalidate late GPS responses", async () => {
  const { shouldApplyGpsResult } = await loadReliabilityModule();
  assert.equal(shouldApplyGpsResult(0, 0, 1, 1), true);
  assert.equal(shouldApplyGpsResult(0, 1, 1, 1), false, "manual selection changed the location revision");
  assert.equal(shouldApplyGpsResult(0, 0, 1, 2), false, "a newer GPS request superseded this one");
});

test("only the latest environmental request may update the dashboard", async () => {
  const { isLatestRequest } = await loadReliabilityModule();
  assert.equal(isLatestRequest(4, 5), false);
  assert.equal(isLatestRequest(5, 5), true);
});

test("search and assistant controls expose practical keyboard and error semantics", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /role="combobox"/);
  assert.match(source, /aria-activedescendant/);
  assert.match(source, /e\.key === "ArrowDown"/);
  assert.match(source, /!searchOpen && searchResults\.length > 0/);
  assert.match(source, /e\.key === "Escape"/);
  assert.match(source, /searchError[\s\S]*role="alert"/);
  assert.match(source, /assistantError[\s\S]*role="alert"/);
  assert.match(source, /disabled=\{thinking \|\| !air\}/);
  assert.match(source, /setAssistantError\(""\); setDecision\(null\)/);
  assert.match(source, /className="site-header"/);
  assert.match(source, /className="primary-nav"/);
  assert.doesNotMatch(source, /className="sidebar"|className="mobile-nav"/);
  assert.match(source, /name: "Chennai, Tamil Nadu, India", lat: 13\.0827, lon: 80\.2707/);
  assert.doesNotMatch(source, /WEDNESDAY, NOVEMBER 25, 2026/);
  assert.doesNotMatch(source, /LIVE DATA|> LIVE<|FRESH MODEL DATA/);
  const reliabilitySource = await readFile(new URL("../src/reliability.ts", import.meta.url), "utf8");
  assert.doesNotMatch(reliabilitySource, /FRESH MODEL DATA|AGING MODEL DATA|STALE MODEL DATA/);
});
