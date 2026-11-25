import test from "node:test";
import assert from "node:assert/strict";
import { providerTimeToEpochMs, providerTimeToIso, selectCurrentAndFutureHours } from "./time.js";

test("converts non-UTC Open-Meteo local timestamps only with an explicit offset", () => {
  assert.equal(providerTimeToIso("2026-11-25T21:30", 19800), "2026-11-25T16:00:00.000Z"); // Hyderabad
  assert.equal(providerTimeToIso("2026-11-25T11:00", -18000), "2026-11-25T16:00:00.000Z"); // New York
  assert.equal(providerTimeToIso("2026-11-25T16:00", 0), "2026-11-25T16:00:00.000Z"); // London
  assert.equal(providerTimeToIso("2026-11-26T01:00", 32400), "2026-11-25T16:00:00.000Z"); // Tokyo
  assert.equal(providerTimeToIso("2026-11-25T11:00", undefined), null);
});

test("Unix provider times remain unambiguous across New York and London DST transitions", () => {
  // New York spring-forward: 01:00 EST is followed by 03:00 EDT.
  const nyBefore = Date.parse("2026-03-08T06:00:00Z") / 1000;
  const nyAfter = Date.parse("2026-03-08T07:00:00Z") / 1000;
  assert.equal(providerTimeToIso(nyBefore, -18000), "2026-03-08T06:00:00.000Z");
  assert.equal(providerTimeToIso(nyAfter, -14400), "2026-03-08T07:00:00.000Z");

  // London fall-back has two distinct 01:00 hours; Unix values preserve both.
  const londonFirst = Date.parse("2026-10-25T00:00:00Z") / 1000;
  const londonSecond = Date.parse("2026-10-25T01:00:00Z") / 1000;
  assert.notEqual(providerTimeToEpochMs(londonFirst, 3600), providerTimeToEpochMs(londonSecond, 0));
});

test("next-12-hours selection starts at the current local hour at 21:30", () => {
  const current = Date.parse("2026-11-25T16:00:00Z") / 1000; // 21:30 Hyderabad
  const localMidnight = Date.parse("2026-11-24T18:30:00Z") / 1000;
  const times = Array.from({ length: 48 }, (_, i) => localMidnight + i * 3600);
  const rows = selectCurrentAndFutureHours({
    time: times,
    us_aqi: times.map((_, i) => i),
    pm2_5: times.map((_, i) => i / 2),
    pm10: times.map((_, i) => i),
  }, current, 19800);
  assert.equal(rows.length, 12);
  assert.equal(rows[0].time, "2026-11-25T15:30:00.000Z"); // 21:00 local
  assert.equal(rows[0].aqi, 21);
  assert.ok(rows.every((row) => Date.parse(row.time) >= Date.parse("2026-11-25T15:30:00Z")));
});

test("forecast containing only completed past hours returns unavailable", () => {
  const current = Date.parse("2026-11-25T16:00:00Z") / 1000;
  const rows = selectCurrentAndFutureHours({
    time: [current - 10800, current - 7200],
    us_aqi: [20, 30],
  }, current, 19800);
  assert.deepEqual(rows, []);
});

test("forecast selection remains ordered across a DST boundary", () => {
  const times = [
    Date.parse("2026-03-08T06:00:00Z") / 1000,
    Date.parse("2026-03-08T07:00:00Z") / 1000,
    Date.parse("2026-03-08T08:00:00Z") / 1000,
  ];
  const rows = selectCurrentAndFutureHours(
    { time: times, us_aqi: [40, 45, 50] },
    Date.parse("2026-03-08T06:30:00Z") / 1000,
    -18000,
  );
  assert.deepEqual(rows.map((row) => row.aqi), [40, 45, 50]);
  assert.deepEqual(rows.map((row) => row.time), [
    "2026-03-08T06:00:00.000Z",
    "2026-03-08T07:00:00.000Z",
    "2026-03-08T08:00:00.000Z",
  ]);
});
