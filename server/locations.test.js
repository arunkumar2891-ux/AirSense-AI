import test from "node:test";
import assert from "node:assert/strict";
import { buildComparison, extractLocationIntent, geocodeQueries, judgeGeocode } from "./locations.js";

test("location intent keeps the selected place when the question names none", () => {
  assert.deepEqual(extractLocationIntent("Why does PM2.5 matter?"), { kind: "selected", comparison: false, names: [] });
  assert.equal(extractLocationIntent("How does wind affect outdoor pollution?").kind, "selected");
});

test("location intent extracts one exact place name", () => {
  assert.deepEqual(extractLocationIntent("How is the weather in Delhi?"), {
    kind: "named", comparison: false, names: ["Delhi"], extra: [],
  });
  assert.deepEqual(extractLocationIntent("What is the AQI in Bengaluru?"), {
    kind: "named", comparison: false, names: ["Bengaluru"], extra: [],
  });
  assert.deepEqual(extractLocationIntent("Is Chennai suitable for running today?"), {
    kind: "named", comparison: false, names: ["Chennai"], extra: [],
  });
});

test("location intent extracts every named place in a comparison", () => {
  assert.deepEqual(extractLocationIntent("Compare the air quality in Delhi and Bengaluru."), {
    kind: "named", comparison: true, names: ["Delhi", "Bengaluru"], extra: [],
  });
  assert.deepEqual(extractLocationIntent("Compare pollution levels in Mumbai, Delhi and Chennai."), {
    kind: "named", comparison: true, names: ["Mumbai", "Delhi", "Chennai"], extra: [],
  });
  assert.deepEqual(extractLocationIntent("Compare Delhi and Bengaluru"), {
    kind: "named", comparison: true, names: ["Delhi", "Bengaluru"], extra: [],
  });
  assert.deepEqual(extractLocationIntent("Compare pollution levels in Mumbai, Delhi, Chennai, Bengaluru and Kolkata."), {
    kind: "named", comparison: true, names: ["Mumbai", "Delhi", "Chennai", "Bengaluru"], extra: ["Kolkata"],
  });
  assert.equal(extractLocationIntent("Is the air better today?").kind, "selected");
  assert.deepEqual(extractLocationIntent("Compare Delhi and Bengaluru air quality"), {
    kind: "named", comparison: true, names: ["Delhi", "Bengaluru"], extra: [],
  });
});

test("an unrelated task after a city is not treated as another place", () => {
  assert.deepEqual(extractLocationIntent("What is the AQI in Delhi and write a poem?"), {
    kind: "named", comparison: false, names: ["Delhi"], extra: [],
  });
  assert.deepEqual(extractLocationIntent("What is the AQI in Delhi or write a poem?"), {
    kind: "named", comparison: false, names: ["Delhi"], extra: [],
  });
  assert.equal(extractLocationIntent("Write a poem about air quality in Delhi").kind, "selected");
  assert.equal(extractLocationIntent("Who won the World Cup in Brazil or Argentina?").kind, "selected");
  assert.equal(extractLocationIntent("Is the air better today or tomorrow?").kind, "selected");
});

test("or joins two explicitly named places in an environmental comparison", () => {
  assert.deepEqual(extractLocationIntent("Which city has better air quality, Delhi or Bengaluru?"), {
    kind: "named", comparison: true, names: ["Delhi", "Bengaluru"], extra: [],
  });
  assert.deepEqual(extractLocationIntent("Is Delhi or Chennai better for running today?"), {
    kind: "named", comparison: true, names: ["Delhi", "Chennai"], extra: [],
  });
  assert.deepEqual(extractLocationIntent("Compare Delhi and Bengaluru pollution levels."), {
    kind: "named", comparison: true, names: ["Delhi", "Bengaluru"], extra: [],
  });
});

test("a comparison without explicit places asks for the places", () => {
  const intent = extractLocationIntent("Which city has better air quality today?");
  assert.equal(intent.kind, "clarify");
  assert.equal(intent.reason, "comparison");
  assert.deepEqual(intent.names, []);
  assert.equal(extractLocationIntent("Compare pollution levels").kind, "clarify");
});

test("unrelated proper nouns outside a location phrase are not places", () => {
  assert.equal(extractLocationIntent("Tell me about Shakespeare and the World Cup").kind, "selected");
  assert.equal(extractLocationIntent("Why does PM2.5 matter in general?").kind, "selected");
});

test("geocoding keeps one dominant match and asks when two places compete", () => {
  const delhi = judgeGeocode("Delhi", [
    { name: "Delhi", region: "Delhi", country: "India", latitude: 28.65, longitude: 77.23, population: 11000000 },
    { name: "Delhi", region: "Ontario", country: "Canada", latitude: 42.85, longitude: -80.5, population: 500 },
  ]);
  assert.equal(delhi.status, "resolved");
  assert.equal(delhi.place.name, "Delhi");
  assert.equal(delhi.place.country, "India");

  const springfield = judgeGeocode("Springfield", [
    { name: "Springfield", region: "Missouri", country: "United States", latitude: 37.21, longitude: -93.29, population: 169000 },
    { name: "Springfield", region: "Massachusetts", country: "United States", latitude: 42.1, longitude: -72.59, population: 155000 },
  ]);
  assert.equal(springfield.status, "ambiguous");
  assert.equal(springfield.candidates.length, 2);
  assert.equal(springfield.candidates.some((candidate) => "latitude" in candidate), false);
  assert.equal(judgeGeocode("Xylophoneville", []).status, "unresolved");

  const alias = judgeGeocode("Delhi", [
    { name: "New Delhi", region: "Delhi", country: "India", latitude: 28.61, longitude: 77.21, population: 25000000 },
  ]);
  assert.equal(alias.status, "resolved");
  assert.equal(alias.place.name, "New Delhi");
  assert.equal(alias.place.latitude, 28.61);

  const mismatch = judgeGeocode("Zzxq", [
    { name: "Wrong City", region: "New York", country: "United States", latitude: 40.71, longitude: -74, population: 8000000 },
  ]);
  assert.equal(mismatch.status, "unresolved");
  assert.equal(mismatch.place, undefined);
  assert.equal(mismatch.candidates[0].name, "Wrong City");
  assert.equal("latitude" in mismatch.candidates[0], false);

  const bengaluru = { name: "Bengaluru", region: "Karnataka", country: "India", latitude: 12.97, longitude: 77.59, population: 8400000 };
  const bangalore = { name: "Bangalore", region: "Karnataka", country: "India", latitude: 12.97, longitude: 77.59, population: 8400000 };
  assert.deepEqual(geocodeQueries("Bangalore"), ["Bangalore", "Bengaluru"]);
  assert.deepEqual(geocodeQueries("Bengaluru"), ["Bengaluru", "Bangalore"]);
  assert.equal(judgeGeocode("Bangalore", [bengaluru]).status, "resolved");
  assert.equal(judgeGeocode("Bangalore", [bengaluru]).place.name, "Bengaluru");
  assert.equal(judgeGeocode("Bengaluru", [bangalore]).status, "resolved");
  assert.equal(judgeGeocode("Bengaluru", [bangalore]).place.name, "Bangalore");
  assert.equal(judgeGeocode("Bangalore", [
    { name: "Wrong City", region: "New York", country: "United States", latitude: 40.71, longitude: -74, population: 8000000 },
  ]).status, "unresolved");
});

test("comparison ranks only fresh readings and does not call a lower AQI safer", () => {
  const ready = (query, aqi, scoringApplied = true) => ({
    query,
    status: "ready",
    name: query,
    region: "",
    country: "India",
    aqi,
    decision: { activityRecommendation: scoringApplied ? "caution" : "insufficient_data", trace: { scoringApplied } },
  });
  const ranked = buildComparison([ready("Delhi", 80), ready("Bengaluru", 150)]);
  assert.equal(ranked.lowestReportedAqi.query, "Delhi");
  assert.equal(ranked.lowestReportedAqi.aqi, 80);
  assert.equal(ranked.tied, false);
  assert.match(ranked.statement, /lowest reported US AQI/i);
  assert.match(ranked.statement, /not an activity recommendation/i);
  assert.doesNotMatch(ranked.statement, /safer/i);

  const partial = buildComparison([ready("Delhi", 80), ready("Chennai", 40, false)]);
  assert.equal(partial.lowestReportedAqi, null);
  assert.match(partial.statement, /not ranked|not fresh enough|were not ranked/i);
  assert.equal(partial.excluded.some((item) => item.query === "Chennai"), true);
});
