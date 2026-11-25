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

test("freshness labels distinguish fresh, aging, stale, and unavailable data", async () => {
  const { getFreshnessPresentation } = await loadReliabilityModule();
  const now = Date.parse("2026-11-25T16:00:00Z");
  assert.deepEqual(getFreshnessPresentation("2026-11-25T15:45:00Z", now), {
    state: "fresh", label: "FRESH MODEL DATA", isFresh: true,
  });
  assert.equal(getFreshnessPresentation("2026-11-25T14:30:00Z", now).state, "aging");
  assert.equal(getFreshnessPresentation("2026-11-25T12:00:00Z", now).state, "stale");
  assert.equal(getFreshnessPresentation(null, now).state, "unavailable");
  assert.equal(getFreshnessPresentation("2026-11-25T17:00:00Z", now).state, "unavailable");
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
  assert.doesNotMatch(source, /LIVE DATA|> LIVE</);
});
