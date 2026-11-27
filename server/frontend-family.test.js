import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { validateHouseholdPlan } from "./family-plan.js";

const sourceRoot = new URL("../src/", import.meta.url);

async function compile(relativePath, cache = new Map()) {
  if (cache.has(relativePath)) return cache.get(relativePath);
  const source = await readFile(new URL(relativePath, sourceRoot), "utf8");
  let { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const specs = [...new Set([...outputText.matchAll(/from\s+["'](\.\/[^"']+)["']/g)].map((match) => match[1]))];
  for (const spec of specs) {
    const dep = `${spec.replace(/^\.\//, "").replace(/\.js$/, "")}.ts`;
    const url = await compile(dep, cache);
    outputText = outputText.replaceAll(`"${spec}"`, `"${url}"`).replaceAll(`'${spec}'`, `'${url}'`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
  cache.set(relativePath, url);
  return url;
}

const location = { lat: 13.0827, lon: 80.2707 };

function decision(recommendation, overrides = {}) {
  return {
    activityRecommendation: recommendation,
    overallRisk: recommendation === "avoid" ? "very_high" : recommendation === "insufficient_data" ? "unknown" : "low",
    recommendedAction: `${recommendation} action`,
    reasoning: `${recommendation} reasoning`,
    limitations: "Modelled exposure limitation.",
    dataFreshness: { state: "fresh", ageMs: 1000, label: "Observed 1 min ago." },
    trace: { factors: [{ factor: "PM2.5", detail: "Returned by the exposure engine.", contribution: 1 }] },
    ...overrides,
  };
}

function plan(overrides = {}) {
  return {
    ok: true,
    governingProfile: { activity: "children's outdoor play", ageGroup: "child", sensitivity: "general" },
    basis: {
      childPresent: true,
      adultSharedOutdoor: { usedForHouseholdDecision: false, activityRecommendation: "suitable", lessRestrictiveThanGoverning: true },
    },
    decision: decision("avoid"),
    schedule: {
      status: "insufficient_data",
      windows: [],
      limitations: "Forecast limitation.",
      freshnessPolicy: { note: "Retrieval limits are AirSense policy thresholds." },
      metadata: { accuracyNotice: "Modelled atmospheric estimate, not a local or neighborhood monitoring station observation.", disclosure: "Modelled air-quality estimate." },
    },
    adultOnlyCommute: {
      audience: "adult-only",
      appliesToChildren: false,
      decision: decision("caution", { recommendedAction: "Adult commute action" }),
    },
    activeTravel: {
      walking: { eligible: false, engineActivity: "daily activities", profile: { ageGroup: "child", activity: "daily activities", sensitivity: "general" }, decision: decision("avoid") },
      cycling: { eligible: false, engineActivity: "cycling", profile: { ageGroup: "child", activity: "cycling", sensitivity: "general" }, decision: decision("avoid") },
    },
    sentences: ["indoor_unmeasured", "indoor_limit_outdoor_air", "emissions_unquantified", "active_travel_walking_withheld", "shared_trip"],
    indoorAirUnmeasured: true,
    emissionsSavingsQuantified: false,
    indoorMeasurementStatus: "not_measured",
    emissionsImpactStatus: "qualitative_only",
    indoorGuidance: {
      measurementStatement: "Indoor air quality has not been measured by AirSense AI.",
      recommendations: [{
        id: "ventilation_limit_outdoor_intake",
        category: "ventilation",
        title: "Limit unnecessary outdoor-air intake",
        description: "Avoid bringing extra outdoor air in.",
        whyItHelps: "This limits outdoor pollution entering the home.",
        impactType: "personal_exposure",
        limitations: "Indoor air quality has not been measured by AirSense AI.",
      }],
    },
    routineRecommendations: [{
      id: "child_outdoor_play",
      category: "routine",
      title: "Children's outdoor play follows the child decision",
      description: "Keep children's outdoor play indoors or rescheduled.",
      whyItHelps: "The child decision is not replaced by an adult result.",
      impactType: "personal_exposure",
      limitations: "An adult result is not permission for the child.",
    }],
    impactExplanations: [{
      id: "impact_personal_exposure",
      category: "impact",
      title: "Personal exposure",
      description: "These actions change outdoor exposure.",
      whyItHelps: "They use the existing outdoor decision.",
      impactType: "personal_exposure",
      limitations: "No pollutant reduction is quantified.",
    }],
    retrieval: {
      decisionFreshness: { state: "stale", label: "Observed 5h ago." },
      forecastFreshness: { state: "stale", label: "Forecast retrieved 5h ago." },
    },
    ...overrides,
  };
}

test("the family section defaults to one young child and does not use the GoWindow profile", async () => {
  const { defaultFamilyHousehold, buildFamilyPlanRequest } = await import(await compile("family.ts"));
  const draft = defaultFamilyHousehold();
  assert.equal(draft.youngChildren, 1);
  assert.equal(draft.olderChildren, 0);
  assert.equal(draft.adults, 0);
  assert.equal(draft.olderAdults, 0);
  assert.equal(draft.sensitivity, "general");
  assert.deepEqual(draft.routines, ["children's outdoor play"]);
  assert.equal(draft.durationMinutes, 45);
  assert.equal(draft.timePreference, "daytime");
  const request = buildFamilyPlanRequest(location, draft);
  assert.equal(validateHouseholdPlan(request.household).error, undefined);
  assert.equal(request.household.outing.activity, "children's outdoor play");
  assert.deepEqual(request.household.members, [{ ageBand: "young_child", count: 1 }]);
});

test("adult-only and child households build different validated requests", async () => {
  const { buildFamilyPlanRequest, defaultFamilyHousehold } = await import(await compile("family.ts"));
  const adult = {
    ...defaultFamilyHousehold(),
    youngChildren: 0,
    adults: 2,
    routines: ["daily activities", "commuting"],
  };
  const adultRequest = buildFamilyPlanRequest(location, adult);
  assert.equal(validateHouseholdPlan(adultRequest.household).error, undefined);
  assert.equal(adultRequest.household.outing.activity, "daily activities");
  assert.deepEqual(adultRequest.household.members, [{ ageBand: "adult", count: 2 }]);
  assert.deepEqual(adultRequest.household.routines, ["daily activities", "commuting"]);

  const child = {
    ...defaultFamilyHousehold(),
    adults: 1,
    routines: ["children's outdoor play", "commuting"],
  };
  const childRequest = buildFamilyPlanRequest(location, child);
  assert.equal(childRequest.household.outing.activity, "children's outdoor play");
  assert.deepEqual(childRequest.household.members.map((member) => member.ageBand), ["young_child", "adult"]);
  assert.equal(validateHouseholdPlan(childRequest.household).error, undefined);
});

test("household validation enforces size, routines, duration, and the existing sensitivity list", async () => {
  const { validateFamilyDraft, defaultFamilyHousehold, FAMILY_SENSITIVITIES } = await import(await compile("family.ts"));
  const base = defaultFamilyHousehold();
  assert.equal(validateFamilyDraft(base).ok, true);
  assert.match(validateFamilyDraft({ ...base, youngChildren: 0 }).error, /1 to 12/);
  assert.match(validateFamilyDraft({ ...base, youngChildren: 8, adults: 5 }).error, /1 to 12/);
  assert.match(validateFamilyDraft({ ...base, adults: 9 }).error, /0 to 8/);
  assert.match(validateFamilyDraft({ ...base, routines: ["running", "cycling", "sports", "commuting", "daily activities"] }).error, /at most 4/);
  assert.match(validateFamilyDraft({ ...base, durationMinutes: 14 }).error, /15 to 180/);
  assert.match(validateFamilyDraft({ ...base, durationMinutes: 181 }).error, /15 to 180/);
  assert.match(validateFamilyDraft({ ...base, timePreference: "night" }).error, /time preference/i);
  assert.deepEqual(FAMILY_SENSITIVITIES.map(([id]) => id), ["general", "respiratory sensitivity", "heart or lung condition"]);
});

test("session storage keeps a valid household and rejects invalid or personal data", async () => {
  const { readStoredHousehold, serializeFamilyHousehold, defaultFamilyHousehold, FAMILY_STORAGE_KEY } = await import(await compile("family.ts"));
  const fallback = defaultFamilyHousehold();
  assert.equal(FAMILY_STORAGE_KEY, "airsense.family.household");
  assert.deepEqual(readStoredHousehold(null), fallback);
  assert.deepEqual(readStoredHousehold("{"), fallback);
  assert.deepEqual(readStoredHousehold(JSON.stringify({ name: "Asha" })), fallback);
  const personal = { ...fallback, dateOfBirth: "2020-01-01", diagnosis: "asthma" };
  assert.deepEqual(readStoredHousehold(JSON.stringify(personal)), fallback);
  assert.equal(serializeFamilyHousehold({ ...fallback, youngChildren: 0, olderChildren: 0, adults: 0, olderAdults: 0 }), null);
  const adult = { ...fallback, youngChildren: 0, adults: 2, routines: ["daily activities"] };
  const stored = serializeFamilyHousehold(adult);
  assert.equal(stored.includes("Asha"), false);
  assert.equal(stored.includes("dateOfBirth"), false);
  assert.deepEqual(readStoredHousehold(stored), adult);
  const memory = { getItem: () => stored };
  const { loadFamilyHousehold } = await import(await compile("family.ts"));
  assert.equal(loadFamilyHousehold(memory).adults, 2);
  assert.equal(loadFamilyHousehold({ getItem: () => { throw new Error("blocked"); } }).youngChildren, 1);
});

test("the family request contains coordinates and the household only", async () => {
  const { buildFamilyPlanRequest, defaultFamilyHousehold, familyPlanRequestKey } = await import(await compile("family.ts"));
  const request = buildFamilyPlanRequest(location, defaultFamilyHousehold());
  assert.deepEqual(Object.keys(request).sort(), ["household", "latitude", "longitude"]);
  const explained = buildFamilyPlanRequest(location, defaultFamilyHousehold(), true);
  assert.deepEqual(Object.keys(explained).sort(), ["explain", "household", "latitude", "longitude"]);
  assert.equal(explained.explain, true);
  assert.equal(JSON.stringify(explained).includes("aqi"), false);
  assert.notEqual(familyPlanRequestKey(location, defaultFamilyHousehold()), JSON.stringify(explained));
  assert.equal(JSON.stringify(request).includes("aqi"), false);
  assert.equal(JSON.stringify(request).includes("pm25"), false);
  assert.equal(JSON.stringify(request).includes("weather"), false);
  assert.equal(JSON.stringify(request).includes("indoor"), false);
  const moved = familyPlanRequestKey({ lat: 51.5, lon: -0.12 }, defaultFamilyHousehold());
  const edited = familyPlanRequestKey(location, { ...defaultFamilyHousehold(), adults: 1 });
  assert.notEqual(moved, familyPlanRequestKey(location, defaultFamilyHousehold()));
  assert.notEqual(edited, familyPlanRequestKey(location, defaultFamilyHousehold()));
});

test("a child plan stays avoid when an adult result is suitable, and insufficient data stays unfavorable", async () => {
  const { presentFamilyPlan, INDOOR_NOT_MEASURED, EMISSIONS_QUALITATIVE_TEXT } = await import(await compile("family.ts"));
  const view = presentFamilyPlan(plan());
  assert.equal(view.ok, true);
  assert.equal(view.recommendation, "avoid");
  assert.equal(view.recommendationLabel, "Avoid");
  assert.notEqual(view.recommendation, "suitable");
  assert.match(view.adultComparisonNote, /not this household's decision/);
  assert.equal(view.walking.eligible, false);
  assert.equal(view.walking.ageGroup, "child");
  assert.equal(view.cycling.eligible, false);
  assert.equal(view.commute.label, "Adult-only commute");
  assert.equal(view.commute.appliesToChildren, false);
  assert.equal(view.commute.recommendationLabel, "Caution");
  assert.equal(view.indoor.unmeasured, true);
  assert.equal(view.indoor.statement, INDOOR_NOT_MEASURED);
  assert.equal(view.indoor.recommendations[0].title, "Limit unnecessary outdoor-air intake");
  assert.equal(view.indoor.recommendations[0].impactType, "personal_exposure");
  assert.equal(view.routines[0].id, "child_outdoor_play");
  assert.equal(view.sustainable.qualitative, true);
  assert.equal(view.explanation, null);
  assert.equal(view.sustainable.statement, EMISSIONS_QUALITATIVE_TEXT);
  assert.deepEqual(view.sustainable.recommendations, []);
  assert.equal(view.impacts[0].title, "Personal exposure");
  assert.equal(JSON.stringify(view).includes("indoor_unmeasured"), false);
  assert.match(view.limitations.join(" "), /Not a street-level measurement/);
  assert.match(view.limitations.join(" "), /Observed 5h ago/);
  assert.equal(view.scheduleStatus, "insufficient_data");

  const missing = presentFamilyPlan(plan({
    decision: decision("insufficient_data"),
    activeTravel: {
      walking: { eligible: true, engineActivity: "daily activities", profile: { ageGroup: "child" }, decision: decision("insufficient_data") },
      cycling: { eligible: false, engineActivity: "cycling", profile: { ageGroup: "child" }, decision: decision("insufficient_data") },
    },
  }));
  assert.equal(missing.recommendation, "insufficient_data");
  assert.equal(missing.walking.eligible, false);
  assert.equal(presentFamilyPlan({ ok: false }).ok, false);
});

test("an explanation is labeled and does not replace the household decision", async () => {
  const { presentFamilyPlan } = await import(await compile("family.ts"));
  const ai = presentFamilyPlan(plan({
    explanation: { mode: "ai", text: "The household decision is avoid. Indoor air has not been measured." },
  }));
  assert.equal(ai.recommendation, "avoid");
  assert.equal(ai.explanation.mode, "ai");
  assert.equal(ai.explanation.label, "AI-generated");
  assert.match(ai.explanation.note, /safety decision stays with the exposure engine/);
  assert.doesNotMatch(`${ai.explanation.label} ${ai.explanation.note}`, /Deterministic|Rules-based|Fallback/);
  const fallback = presentFamilyPlan(plan({
    explanation: { mode: "rules-fallback", text: "The household decision is avoid." },
  }));
  assert.equal(fallback.recommendation, "avoid");
  assert.equal(fallback.explanation.label, null);
  assert.equal(fallback.explanation.note, "The safety decision stays with the exposure engine.");
  assert.doesNotMatch(`${fallback.explanation.label ?? ""} ${fallback.explanation.note}`, /AI-generated|Generated by AI|Deterministic|Rules-based|Fallback/);
  const rules = presentFamilyPlan(plan({
    explanation: { mode: "rules", text: "The household decision is avoid." },
  }));
  assert.equal(rules.explanation.label, null);
  assert.equal(rules.explanation.note, fallback.explanation.note);
  assert.doesNotMatch(`${rules.explanation.label ?? ""} ${rules.explanation.note}`, /AI-generated|Generated by AI|Deterministic|Rules-based|Fallback/);
  assert.equal(presentFamilyPlan(plan({ explanation: { mode: "ai", text: "  " } })).explanation, null);
});

test("family controls, persistence, and stale-result handling stay in the dashboard", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../src/FamilyPanel.tsx", import.meta.url), "utf8");
  const helper = await readFile(new URL("../src/family.ts", import.meta.url), "utf8");
  const api = await readFile(new URL("../src/api.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/design-system.css", import.meta.url), "utf8");
  assert.match(app, /href="#overview"/);
  assert.match(app, /href="#gowindow"/);
  assert.match(app, /href="#family"/);
  assert.match(app, /href="#pollutants"/);
  assert.match(app, /href="#assistant"/);
  assert.match(app, /activity: "running", ageGroup: "adult", sensitivity: "general"/);
  assert.match(app, /profile=\{profile\}/);
  assert.match(app, /FAMILY_STORAGE_KEY/);
  assert.match(app, /familyAbortRef\.current\?\.abort\(\)/);
  assert.match(app, /isLatestRequest\(requestId, familyRequestRef\.current\)/);
  assert.match(app, /setFamilyPlan\(null\)/);
  assert.match(app, /result=\{familyPlanKey === familySelectionKey \? familyPlan : null\}/);
  assert.match(app, /if \(familyLoading \|\| familyPendingRef\.current\) return/);
  assert.doesNotMatch(app.slice(app.indexOf("function planHousehold"), app.indexOf("const aqi")), /getAirQuality|air\?\.aqi|pollutants/);
  const familyApi = api.slice(api.indexOf("function requestFamilyPlan"));
  assert.match(familyApi, /\/api\/family-plan/);
  assert.match(familyApi, /JSON\.stringify\(request\)/);
  assert.doesNotMatch(familyApi, /aqi|pm25|pollutant|indoor|weather/i);
  assert.match(panel, /aria-label=\{aria\}/);
  assert.match(panel, /"Young children count"/);
  assert.match(panel, /"Older children count"/);
  assert.match(panel, /"Adults count"/);
  assert.match(panel, /"Older adults count"/);
  assert.match(panel, /aria-label="Sensitivity"/);
  assert.match(panel, /aria-label="Outing duration in minutes"/);
  assert.match(panel, /aria-label="Preferred time of day"/);
  assert.match(panel, /aria-live="polite"/);
  assert.match(panel, /role="alert"/);
  assert.match(panel, /Updating the family plan/);
  assert.match(panel, /Checking the household forecast/);
  assert.match(panel, /Family plan unavailable/);
  assert.match(panel, /Insufficient data/);
  assert.match(panel, /existing child safety profile/);
  assert.match(panel, /Shared outing activity/);
  assert.match(helper, /label: "Adult-only commute"/);
  assert.match(panel, /\{view\.commute\.label\}/);
  assert.match(panel, /Does not apply to children/);
  assert.match(helper, /Indoor air quality has not been measured by AirSense AI/);
  assert.match(helper, /Emissions guidance is qualitative only/);
  assert.doesNotMatch(helper, /Temporary: detailed indoor guidance/);
  assert.match(panel, /At-home air-quality guidance/);
  assert.match(panel, /Daily routine recommendations/);
  assert.match(panel, /Sustainable alternatives/);
  assert.match(panel, /Why these actions help/);
  assert.match(panel, /Why it may help/);
  assert.match(panel, /Explanation of your family plan/);
  assert.doesNotMatch(panel, /AI explanation of your family plan|Deterministic|Rules-based|Fallback/);
  assert.match(panel, /Explain this plan/);
  assert.match(panel, /Writing the AI explanation/);
  assert.match(panel, /AI explanation unavailable/);
  assert.match(panel, /does not choose the safety decision/);
  assert.match(panel, /type="button"/);
  assert.match(helper, /AI-generated/);
  assert.doesNotMatch(helper, /Generated by AI|Deterministic guidance|Rules-based|The AI explanation was not used/);
  assert.match(app, /onExplain=\{explainHousehold\}/);
  assert.equal((app.match(/explainHousehold\(/g) || []).length, 1);
  assert.match(app, /buildFamilyPlanRequest\(loc, household, true\)/);
  const planFn = app.slice(app.indexOf("async function planHousehold"), app.indexOf("async function explainHousehold"));
  assert.doesNotMatch(planFn, /buildFamilyPlanRequest\(loc, household, true\)/);
  const explainFn = app.slice(app.indexOf("async function explainHousehold"), app.indexOf("const aqi"));
  assert.doesNotMatch(explainFn, /setFamilyPlan\(null\)/);
  assert.match(panel, /impactTypeLabel/);
  assert.match(panel, /view\.indoor\.statement/);
  assert.doesNotMatch(panel, /sentence identifiers|<code>\{id\}/);
  assert.match(panel, /type="checkbox"/);
  assert.match(panel, /type="submit"/);
  const familyCss = css.slice(css.indexOf(".family-section"));
  assert.match(familyCss, /\.family-disclaimer[\s\S]*font-size: 14px/);
  assert.doesNotMatch(familyCss, /font-size:\s*8px/);
  assert.match(familyCss, /@media \(max-width: 760px\)/);
  assert.match(css, /input:focus-visible/);
  assert.match(css, /html\[data-theme="dark"\]/);
});
