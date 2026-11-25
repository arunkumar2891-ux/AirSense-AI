import test from "node:test";
import assert from "node:assert/strict";
import { getAQIStatus, buildRecommendationContext } from "./logic.js";

test("AQI bands classify boundary values correctly", () => {
  assert.equal(getAQIStatus(0).label, "Good");
  assert.equal(getAQIStatus(50).label, "Good");
  assert.equal(getAQIStatus(51).label, "Moderate");
  assert.equal(getAQIStatus(101).label, "Unhealthy for sensitive groups");
  assert.equal(getAQIStatus(151).label, "Unhealthy");
  assert.equal(getAQIStatus(201).label, "Very unhealthy");
  assert.equal(getAQIStatus(301).label, "Hazardous");
});
test("missing AQI does not produce a fabricated reading", () => {
  assert.equal(getAQIStatus(null).label, "Unavailable");
  const context = buildRecommendationContext({}, {}, "Can I go out?");
  assert.equal(context.aqi, null);
  assert.match(context.answer, /unavailable/i);
});
test("vigorous activity gets extra caution at elevated AQI", () => {
  const context = buildRecommendationContext({ aqi: 165, aqiScale: "US AQI" }, { activity: "running" }, "Can I run?");
  assert.match(context.answer, /indoor session/i);
});
test("sensitive profiles receive additional caution", () => {
  const context = buildRecommendationContext({ aqi: 125 }, { sensitivity: "respiratory sensitivity" }, "Advice?");
  assert.match(context.answer, /extra care/i);
});