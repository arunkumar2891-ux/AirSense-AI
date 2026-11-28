import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const sourceRoot = new URL("../src/", import.meta.url);

async function compile(relativePath, cache = new Map()) {
  if (cache.has(relativePath)) return cache.get(relativePath);
  const source = await readFile(new URL(relativePath, sourceRoot), "utf8");
  let { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const specs = [...new Set([...outputText.matchAll(/from\s+["'](\.\/[^"']+)["']/g)].map((match) => match[1]))];
  for (const spec of specs) {
    const url = await compile(`${spec.replace(/^\.\//, "").replace(/\.js$/, "")}.ts`, cache);
    outputText = outputText.replaceAll(`"${spec}"`, `"${url}"`).replaceAll(`'${spec}'`, `'${url}'`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
  cache.set(relativePath, url);
  return url;
}

test("planner mode defaults to GoWindow and ignores unknown saved values", async () => {
  const { readPlannerMode, DEFAULT_PLANNER_MODE } = await import(await compile("planner-mode.ts"));
  assert.equal(DEFAULT_PLANNER_MODE, "self");
  assert.equal(readPlannerMode(null), "self");
  assert.equal(readPlannerMode(undefined), "self");
  assert.equal(readPlannerMode(""), "self");
  assert.equal(readPlannerMode("both"), "self");
  assert.equal(readPlannerMode("self"), "self");
  assert.equal(readPlannerMode("family"), "family");
});

test("each planner mode maps to exactly one dashboard section", async () => {
  const { PLANNER_MODES, plannerModeForSection, plannerSectionForMode } = await import(await compile("planner-mode.ts"));
  assert.deepEqual(PLANNER_MODES.map((mode) => mode.title), ["Plan the day for you", "Plan the day for your entire family"]);
  assert.equal(plannerSectionForMode("self"), "gowindow");
  assert.equal(plannerSectionForMode("family"), "family");
  assert.equal(plannerModeForSection("gowindow"), "self");
  assert.equal(plannerModeForSection("family"), "family");
  for (const section of ["hourly", "pollutants", "assistant"]) assert.equal(plannerModeForSection(section), null);
});

test("the dashboard shows only the chosen planner and keeps the choice", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const picker = await readFile(new URL("../src/PlannerModePicker.tsx", import.meta.url), "utf8");
  assert.match(app, /plannerMode === "self" && <GoWindowPanel/);
  assert.match(app, /plannerMode === "family" && <FamilyPanel/);
  assert.match(app, /writePreference\(localStorage, sessionStorage, PLANNER_MODE_KEY/);
  assert.match(app, /readPlannerMode\(readPreference\(localStorage, sessionStorage, PLANNER_MODE_KEY\)\)/);
  assert.match(app, /const mode = plannerModeForSection\(id\)/);
  assert.match(picker, /type="radio"/);
  assert.match(picker, /name="planner-mode"/);
});
