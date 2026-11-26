import test from "node:test";
import assert from "node:assert/strict";
import {
  areSameProviderCell,
  buildForecastMetadata,
  describeCellComparison,
  extractGenuineModelInitTime,
  extractProviderCell,
  formatModelRunAge,
} from "./metadata.js";
import { buildExposureDecision } from "./logic.js";
import { findGoWindows } from "./gowindow.js";

const NOW = Date.parse("2026-11-25T21:10:00.000Z");
const VALID_SECONDS = Math.floor(Date.parse("2026-11-25T21:00:00.000Z") / 1000);
const RETRIEVED_AT = "2026-11-25T21:07:00.000Z";

function chennaiOpenMeteoPayload(overrides = {}) {
  return {
    latitude: 13.099998,
    longitude: 80.30002,
    elevation: 10.0,
    generationtime_ms: 0.66,
    utc_offset_seconds: 19800,
    timezone: "Asia/Kolkata",
    timezone_abbreviation: "GMT+5:30",
    current: { time: VALID_SECONDS, interval: 3600, us_aqi: 39, pm2_5: 12.5 },
    hourly: { time: [VALID_SECONDS, VALID_SECONDS + 3600], us_aqi: [39, 41], pm2_5: [12.5, 13.0] },
    ...overrides,
  };
}

test("preserves exact provider-returned cell coordinates and elevation", () => {
  const cell = extractProviderCell(chennaiOpenMeteoPayload());
  assert.deepEqual(cell, {
    latitude: 13.099998,
    longitude: 80.30002,
    elevationMeters: 10,
    cellKey: "13.1000,80.3000",
  });

  assert.equal(extractProviderCell({ latitude: 95, longitude: 80 }), null);
  assert.equal(extractProviderCell({ latitude: 13.1 }), null);
  assert.equal(extractProviderCell(null), null);
});

test("verifies CAMS global nominal resolution outside Europe and distinguishes serving-cell snapping", () => {
  const meta = buildForecastMetadata({
    air: chennaiOpenMeteoPayload(),
    retrievedAt: RETRIEVED_AT,
    now: NOW,
  });
  assert.equal(meta.dataClass, "modelled_estimate");
  assert.equal(meta.isModelledEstimate, true);
  assert.equal(meta.isStationObservation, false);
  assert.equal(meta.providerCell.latitude, 13.099998);
  assert.equal(meta.providerCell.longitude, 80.30002);
  assert.equal(meta.model.id, "cams_global");
  assert.equal(meta.model.name, "CAMS global model");
  assert.equal(meta.model.providerSupplied, false);
  assert.equal(meta.spatialResolution.verified, true);
  assert.equal(meta.spatialResolution.nominalDegrees, 0.4);
  assert.equal(meta.spatialResolution.approximateKm, 45);
  assert.equal(meta.spatialResolution.label, "Approx. 45 km nominal resolution");
  assert.match(meta.spatialResolution.servingCellBehavior, /0\.1°/);
  assert.match(meta.spatialResolution.servingCellBehavior, /not the official/i);
  assert.equal(meta.disclosure, "Modelled air-quality estimate · CAMS global model · Approx. 45 km nominal resolution.");
});

test("missing or unverified model metadata never fabricates resolution", () => {
  const missingCoords = buildForecastMetadata({
    air: { current: { time: VALID_SECONDS }, utc_offset_seconds: 0 },
    retrievedAt: RETRIEVED_AT,
    now: NOW,
  });
  assert.equal(missingCoords.providerCell, null);
  assert.equal(missingCoords.model.id, null);
  assert.equal(missingCoords.spatialResolution.verified, false);
  assert.equal(missingCoords.spatialResolution.nominalDegrees, null);
  assert.equal(missingCoords.spatialResolution.approximateKm, null);
  assert.equal(missingCoords.spatialResolution.label, null);
  assert.doesNotMatch(missingCoords.disclosure, /45 km|11 km/);
  assert.match(missingCoords.disclosure, /Not a local station observation/i);

  // Inside Europe under Open-Meteo auto-domain without a provider-supplied model field,
  // cams_europe and cams_global are blended so nominal resolution cannot be claimed as verified.
  const berlinAuto = buildForecastMetadata({
    air: chennaiOpenMeteoPayload({ latitude: 52.5, longitude: 13.400002, timezone: "Europe/Berlin", utc_offset_seconds: 3600 }),
    retrievedAt: RETRIEVED_AT,
    now: NOW,
  });
  assert.equal(berlinAuto.model.id, null);
  assert.equal(berlinAuto.spatialResolution.verified, false);
  assert.equal(berlinAuto.spatialResolution.approximateKm, null);
  assert.doesNotMatch(berlinAuto.disclosure, /45 km|11 km/);

  // Explicit provider-supplied CAMS Europe model IS verified.
  const berlinExplicit = buildForecastMetadata({
    air: chennaiOpenMeteoPayload({ latitude: 52.5, longitude: 13.400002, model: "cams_europe" }),
    retrievedAt: RETRIEVED_AT,
    now: NOW,
  });
  assert.equal(berlinExplicit.model.id, "cams_europe");
  assert.equal(berlinExplicit.model.providerSupplied, true);
  assert.equal(berlinExplicit.spatialResolution.verified, true);
  assert.equal(berlinExplicit.spatialResolution.approximateKm, 11);
  assert.equal(berlinExplicit.disclosure, "Modelled air-quality estimate · CAMS European model · Approx. 11 km nominal resolution.");

  // Unrecognized explicit model preserves the id without fabricating resolution.
  const customModel = buildForecastMetadata({
    air: chennaiOpenMeteoPayload({ model: "custom_experimental_v2" }),
    retrievedAt: RETRIEVED_AT,
    now: NOW,
  });
  assert.equal(customModel.model.id, "custom_experimental_v2");
  assert.equal(customModel.spatialResolution.verified, false);
  assert.equal(customModel.spatialResolution.approximateKm, null);
});

test("never infers missing model initialization timestamp from generationtime, current time, or forecast timestamps", () => {
  const payload = chennaiOpenMeteoPayload();
  assert.equal(extractGenuineModelInitTime(payload), null);

  const meta = buildForecastMetadata({ air: payload, retrievedAt: RETRIEVED_AT, now: NOW });
  assert.equal(meta.timestamps.forecastValidAt, "2026-11-25T21:00:00.000Z");
  assert.equal(meta.timestamps.retrievedAt, RETRIEVED_AT);
  assert.equal(meta.timestamps.modelInitializedAt, null);
  assert.notEqual(meta.timestamps.forecastValidAt, meta.timestamps.retrievedAt);
  assert.equal(meta.modelRunAge.available, false);
  assert.equal(meta.modelRunAge.ageMs, null);
  assert.equal(meta.modelRunAge.label, "Model run age unavailable");
});

test("calculates real model run age when a genuine initialization timestamp is supplied", () => {
  const initAt = "2026-11-25T17:10:00.000Z"; // 4 hours before NOW
  const meta = buildForecastMetadata({
    air: chennaiOpenMeteoPayload({ model_initialized_at: initAt }),
    retrievedAt: RETRIEVED_AT,
    now: NOW,
  });
  assert.equal(meta.timestamps.modelInitializedAt, initAt);
  assert.equal(meta.modelRunAge.available, true);
  assert.equal(meta.modelRunAge.ageMs, 4 * 60 * 60 * 1000);
  assert.equal(meta.modelRunAge.label, "Model run 4h ago");

  // Future initialization timestamp is treated as unavailable.
  const futureRun = formatModelRunAge("2026-11-25T23:00:00.000Z", NOW);
  assert.equal(futureRun.available, false);
  assert.equal(futureRun.ageMs, null);
  assert.equal(futureRun.label, "Model run age unavailable");
});

test("same-cell detection groundwork handles identical cells, float32 drift, different serving cells, and missing cells", () => {
  const cellA = buildForecastMetadata({
    air: chennaiOpenMeteoPayload({ latitude: 13.099998, longitude: 80.30002 }),
    retrievedAt: RETRIEVED_AT,
    now: NOW,
  });
  const cellAFloatDrift = buildForecastMetadata({
    air: chennaiOpenMeteoPayload({ latitude: 13.100001, longitude: 80.300018 }),
    retrievedAt: RETRIEVED_AT,
    now: NOW,
  });
  const cellB = buildForecastMetadata({
    air: chennaiOpenMeteoPayload({ latitude: 13.200005, longitude: 80.30002 }),
    retrievedAt: RETRIEVED_AT,
    now: NOW,
  });
  const missing = buildForecastMetadata({
    air: { current: { time: VALID_SECONDS }, utc_offset_seconds: 0 },
    retrievedAt: RETRIEVED_AT,
    now: NOW,
  });

  assert.equal(areSameProviderCell({ metadata: cellA }, { metadata: cellAFloatDrift }), true);
  assert.equal(areSameProviderCell({ metadata: cellA }, { metadata: cellB }), false);
  assert.equal(areSameProviderCell({ metadata: cellA }, { metadata: missing }), null);

  const sameComparison = describeCellComparison({ metadata: cellA }, { metadata: cellAFloatDrift });
  assert.equal(sameComparison.sameProviderCell, true);
  assert.equal(sameComparison.distinctEnvironmentalDataProven, false);

  // Different serving coordinates alone must NOT be treated as proven distinct neighborhood data.
  const diffComparison = describeCellComparison({ metadata: cellA }, { metadata: cellB });
  assert.equal(diffComparison.sameProviderCell, false);
  assert.equal(diffComparison.distinctEnvironmentalDataProven, false);
  assert.match(diffComparison.note, /does not by itself prove/i);

  const missingComparison = describeCellComparison({ metadata: cellA }, { metadata: missing });
  assert.equal(missingComparison.sameProviderCell, null);
  assert.equal(missingComparison.distinctEnvironmentalDataProven, false);
});

test("modelled exposure decisions preserve identical recommendations while removing misleading Observed labels", () => {
  const validAt = "2026-11-25T21:00:00.000Z";
  const profile = { activity: "running", ageGroup: "adult", sensitivity: "general" };
  const baseAir = {
    aqi: 39,
    aqiScale: "US AQI",
    pollutants: { pm25: 12.5, pm10: 17.2 },
    weather: { wind_speed_10m: 12 },
    observedAt: validAt,
    hourly: [{ time: validAt, aqi: 39, pm25: 12.5, pm10: 17.2 }],
  };
  const withMetadata = {
    ...baseAir,
    forecastValidAt: validAt,
    retrievedAt: RETRIEVED_AT,
    modelInitializedAt: null,
    metadata: buildForecastMetadata({ air: chennaiOpenMeteoPayload(), retrievedAt: RETRIEVED_AT, now: NOW }),
  };

  const legacyDecision = buildExposureDecision(baseAir, profile, NOW);
  const metaDecision = buildExposureDecision(withMetadata, profile, NOW);

  assert.equal(metaDecision.overallRisk, legacyDecision.overallRisk);
  assert.equal(metaDecision.activityRecommendation, legacyDecision.activityRecommendation);
  assert.equal(metaDecision.recommendedAction, legacyDecision.recommendedAction);
  assert.equal(metaDecision.dataFreshness.state, legacyDecision.dataFreshness.state);
  assert.doesNotMatch(metaDecision.dataFreshness.label, /^Observed/i);
  assert.match(metaDecision.dataFreshness.label, /model run age unavailable/i);
});

test("GoWindow scheduling behavior remains unchanged with honest forecastValidAt and metadata", () => {
  const profile = { activity: "running", ageGroup: "adult", sensitivity: "general" };
  const hours = [0, 1, 2, 3].map((offset) => ({
    time: new Date(NOW + offset * 3600000).toISOString(),
    aqi: 30 + offset * 2,
    pm25: 8,
    pm10: 12,
    weather: { wind_speed_10m: 12, temperature_2m: 28, relative_humidity_2m: 60 },
  }));
  const validAt = new Date(NOW).toISOString();
  const metadata = buildForecastMetadata({
    air: chennaiOpenMeteoPayload({ current: { time: Math.floor(NOW / 1000) } }),
    retrievedAt: RETRIEVED_AT,
    now: NOW,
  });

  const legacy = findGoWindows({
    forecast: { timezone: "Asia/Kolkata", airRetrievedAt: RETRIEVED_AT, weatherRetrievedAt: RETRIEVED_AT, retrievedAt: RETRIEVED_AT, hourly: hours },
    profile,
    durationMinutes: 60,
    now: NOW,
  });
  const honest = findGoWindows({
    forecast: {
      timezone: "Asia/Kolkata",
      forecastValidAt: validAt,
      modelInitializedAt: null,
      airRetrievedAt: RETRIEVED_AT,
      weatherRetrievedAt: RETRIEVED_AT,
      retrievedAt: RETRIEVED_AT,
      metadata,
      hourly: hours,
    },
    profile,
    durationMinutes: 60,
    now: NOW,
  });

  assert.equal(honest.status, legacy.status);
  assert.deepEqual(
    honest.windows.map((w) => [w.start, w.end, w.aqi, w.pm25]),
    legacy.windows.map((w) => [w.start, w.end, w.aqi, w.pm25]),
  );
  assert.equal(honest.forecastFreshness.state, legacy.forecastFreshness.state);
  assert.doesNotMatch(honest.forecastFreshness.label, /^Observed/i);
  assert.match(honest.forecastFreshness.label, /model run age unavailable/i);
  assert.equal(honest.metadata.providerCell.latitude, 13.099998);
  assert.equal(honest.metadata.timestamps.modelInitializedAt, null);
  assert.equal(honest.forecastFreshness.basis, "retrievedAt");
  assert.equal(honest.sourceFreshness.air.timestamp, RETRIEVED_AT);
  assert.equal(honest.sourceFreshness.weather.timestamp, RETRIEVED_AT);
  assert.match(honest.freshnessPolicy.note, /AirSense policy thresholds, not provider guarantees/);
});

const MIN = 60000;
const iso = (offsetMinutes) => new Date(NOW + offsetMinutes * MIN).toISOString();
const runner = { activity: "running", ageGroup: "adult", sensitivity: "general" };

function modelledAir(overrides = {}) {
  const { validAt, retrievedAt, modelInitializedAt } = { validAt: iso(-10), retrievedAt: iso(-3), modelInitializedAt: null, ...overrides };
  return {
    aqi: 39,
    aqiScale: "US AQI",
    pollutants: { pm25: 12.5, pm10: 17.2 },
    weather: { wind_speed_10m: 12 },
    observedAt: validAt,
    forecastValidAt: validAt,
    retrievedAt,
    modelInitializedAt,
    metadata: { isModelledEstimate: true },
    hourly: [],
  };
}

test("exposure freshness for modelled data is decided by retrievedAt, never forecast valid time", () => {
  // Valid time 45 min in the past, retrieved 2 min ago: usable estimate, not aging.
  const pastValid = buildExposureDecision(modelledAir({ validAt: iso(-45), retrievedAt: iso(-2) }), runner, NOW);
  assert.equal(pastValid.dataFreshness.state, "fresh");
  assert.equal(pastValid.dataFreshness.basis, "retrievedAt");
  assert.equal(pastValid.dataFreshness.timestamp, iso(-2));
  assert.notEqual(pastValid.activityRecommendation, "insufficient_data");

  // Valid time 5 h in the past but retrieved just now: still not stale.
  const veryPastValid = buildExposureDecision(modelledAir({ validAt: iso(-300), retrievedAt: iso(-1) }), runner, NOW);
  assert.equal(veryPastValid.dataFreshness.state, "fresh");
  assert.notEqual(veryPastValid.activityRecommendation, "insufficient_data");

  // Valid time in the future, retrieved 4 h ago: stale retrieved data.
  const futureValidOld = buildExposureDecision(modelledAir({ validAt: iso(60), retrievedAt: iso(-240) }), runner, NOW);
  assert.equal(futureValidOld.dataFreshness.state, "stale");
  assert.equal(futureValidOld.activityRecommendation, "insufficient_data");
  assert.match(futureValidOld.dataFreshness.label, /Retrieved data is 4h old/);
  assert.match(futureValidOld.reasoning, /retrieved 4 hours ago/);
  assert.doesNotMatch(futureValidOld.dataFreshness.label, /model run (is|was) .*old|valid time is/i);

  // Recent retrieval with unknown model initialization.
  const recentUnknown = buildExposureDecision(modelledAir({ retrievedAt: iso(-10) }), runner, NOW);
  assert.equal(recentUnknown.dataFreshness.state, "fresh");
  assert.equal(recentUnknown.dataFreshness.modelRunAgeMs, null);
  assert.match(recentUnknown.dataFreshness.label, /Model run age unavailable/);

  // Aging retrieval stays available.
  const aging = buildExposureDecision(modelledAir({ retrievedAt: iso(-90) }), runner, NOW);
  assert.equal(aging.dataFreshness.state, "aging");
  assert.notEqual(aging.activityRecommendation, "insufficient_data");

  // Old retrieval with unknown model initialization.
  const oldUnknown = buildExposureDecision(modelledAir({ retrievedAt: iso(-181) }), runner, NOW);
  assert.equal(oldUnknown.dataFreshness.state, "stale");
  assert.equal(oldUnknown.activityRecommendation, "insufficient_data");
  assert.match(oldUnknown.dataFreshness.label, /Model run age unavailable/);
});

test("missing or invalid retrievedAt never falls back to forecast valid time", () => {
  for (const retrievedAt of [null, undefined, "", "not-a-time", iso(30)]) {
    const decision = buildExposureDecision(modelledAir({ validAt: iso(-5), retrievedAt }), runner, NOW);
    assert.equal(decision.dataFreshness.state, "unknown", String(retrievedAt));
    assert.equal(decision.dataFreshness.basis, "retrievedAt");
    assert.equal(decision.activityRecommendation, "insufficient_data", String(retrievedAt));
    assert.match(decision.recommendedAction, /retrieval time/);
  }
  const missingValid = buildExposureDecision(modelledAir({ validAt: null, retrievedAt: iso(-2) }), runner, NOW);
  assert.equal(missingValid.dataFreshness.state, "unknown");
  assert.equal(missingValid.activityRecommendation, "insufficient_data");
});

test("genuine model initialization is reported separately and never gates decisions", () => {
  const genuine = buildExposureDecision(modelledAir({ retrievedAt: iso(-5), modelInitializedAt: iso(-9 * 60) }), runner, NOW);
  assert.equal(genuine.dataFreshness.state, "fresh");
  assert.equal(genuine.dataFreshness.modelRunAgeMs, 9 * 60 * MIN);
  assert.match(genuine.dataFreshness.label, /Model run initialized 9h ago/);
  const veryOldInit = buildExposureDecision(modelledAir({ retrievedAt: iso(-5), modelInitializedAt: iso(-48 * 60) }), runner, NOW);
  assert.equal(veryOldInit.dataFreshness.state, "fresh");
  assert.notEqual(veryOldInit.activityRecommendation, "insufficient_data");
  const futureInit = buildExposureDecision(modelledAir({ retrievedAt: iso(-5), modelInitializedAt: iso(60) }), runner, NOW);
  assert.equal(futureInit.dataFreshness.modelRunAgeMs, null);
  assert.match(futureInit.dataFreshness.label, /Model run age unavailable/);
});

test("offset-qualified timestamps are compared as absolute instants", () => {
  const ist = buildExposureDecision(modelledAir({ validAt: "2026-11-26T02:30:00+05:30", retrievedAt: "2026-11-26T02:37:00+05:30" }), runner, NOW);
  const utc = buildExposureDecision(modelledAir({ validAt: "2026-11-25T21:00:00Z", retrievedAt: "2026-11-25T21:07:00Z" }), runner, NOW);
  assert.equal(ist.dataFreshness.ageMs, 3 * MIN);
  assert.equal(ist.dataFreshness.ageMs, utc.dataFreshness.ageMs);
  assert.equal(ist.dataFreshness.timestamp, "2026-11-25T21:07:00.000Z");
});

test("GoWindow rejects stale retrieved data and missing retrieval times, never using valid time", () => {
  const hours = [0, 1, 2, 3].map((offset) => ({
    time: new Date(NOW + offset * 3600000).toISOString(),
    aqi: 30,
    pm25: 8,
    pm10: 12,
    weather: { wind_speed_10m: 12, temperature_2m: 28, relative_humidity_2m: 60 },
  }));
  const run = (forecast) => findGoWindows({ forecast: { timezone: "Asia/Kolkata", hourly: hours, ...forecast }, profile: runner, durationMinutes: 60, now: NOW });

  const stale = run({ forecastValidAt: iso(0), airRetrievedAt: iso(-181), weatherRetrievedAt: iso(-181) });
  assert.equal(stale.status, "insufficient_data");
  assert.deepEqual(stale.windows, []);
  assert.equal(stale.forecastFreshness.state, "stale");
  assert.equal(stale.sourceFreshness.air.timestamp, iso(-181));
  assert.equal(stale.sourceFreshness.weather.timestamp, iso(-181));
  assert.match(stale.reason, /air-quality data is too old/);
  assert.match(stale.reason, /weather data is too old/);

  // Valid time 45 min in the past with both sources retrieved recently still schedules.
  const pastValid = run({ forecastValidAt: iso(-45), airRetrievedAt: iso(-2), weatherRetrievedAt: iso(-4) });
  assert.equal(pastValid.status, "suitable_windows");
  assert.equal(pastValid.forecastFreshness.basis, "retrievedAt");
  assert.equal(pastValid.sourceFreshness.air.timestamp, iso(-2));
  assert.equal(pastValid.sourceFreshness.weather.timestamp, iso(-4));

  // A recent valid time cannot rescue a missing, invalid, or future air retrieval time.
  for (const airRetrievedAt of [null, undefined, "nope", iso(30)]) {
    const result = run({ forecastValidAt: iso(0), airRetrievedAt, weatherRetrievedAt: iso(-2) });
    assert.equal(result.status, "insufficient_data", String(airRetrievedAt));
    assert.deepEqual(result.windows, []);
    assert.match(result.reason, /air-quality retrieval time is missing, invalid, or in the future/);
    assert.equal(result.sourceFreshness.weather.state, "fresh");
  }
  // A legacy issuedAt is not treated as a retrieval time for either source.
  assert.equal(run({ issuedAt: iso(0) }).status, "insufficient_data");

  // The air metadata timestamp is the air retrieval time only. Weather still needs its own.
  const viaMetadata = run({
    weatherRetrievedAt: iso(-4),
    metadata: { timestamps: { retrievedAt: iso(-5), forecastValidAt: iso(0), modelInitializedAt: null } },
  });
  assert.equal(viaMetadata.status, "suitable_windows");
  assert.equal(viaMetadata.sourceFreshness.air.timestamp, iso(-5));
  assert.equal(viaMetadata.sourceFreshness.weather.timestamp, iso(-4));
  const metadataAirOnly = run({ metadata: { timestamps: { retrievedAt: iso(-5), modelInitializedAt: null } } });
  assert.equal(metadataAirOnly.status, "insufficient_data");
  assert.equal(metadataAirOnly.sourceFreshness.air.state, "fresh");
  assert.equal(metadataAirOnly.sourceFreshness.weather.state, "unknown");

  // A genuine but old model initialization does not reject fresh retrieved data.
  const oldInit = run({ airRetrievedAt: iso(-5), weatherRetrievedAt: iso(-5), modelInitializedAt: iso(-30 * 60) });
  assert.equal(oldInit.status, "suitable_windows");
  assert.equal(oldInit.sourceFreshness.air.modelRunAgeMs, 30 * 60 * MIN);
  assert.equal(oldInit.sourceFreshness.weather.modelRunAgeMs, null);
  assert.doesNotMatch(oldInit.sourceFreshness.weather.label, /model run/i);
});
