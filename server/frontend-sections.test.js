import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const sourceRoot = new URL("../src/", import.meta.url);

async function compile(relativePath) {
  const source = await readFile(new URL(relativePath, sourceRoot), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem(key) { return Object.hasOwn(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
  };
}

test("secondary dashboard sections start collapsed and stay remembered for the session", async () => {
  const sections = await compile("sections.ts");
  assert.deepEqual(sections.DEFAULT_SECTION_EXPANDED, {
    hourly: false,
    gowindow: false,
    family: false,
    pollutants: false,
    assistant: false,
  });
  assert.deepEqual(sections.readSectionExpanded(null), sections.DEFAULT_SECTION_EXPANDED);
  assert.deepEqual(sections.readSectionExpanded(memoryStorage()), sections.DEFAULT_SECTION_EXPANDED);

  const storage = memoryStorage();
  const opened = sections.toggleSection(sections.DEFAULT_SECTION_EXPANDED, "family");
  assert.equal(opened.family, true);
  assert.equal(opened.gowindow, false);
  sections.writeSectionExpanded(storage, opened);
  assert.deepEqual(sections.readSectionExpanded(storage), opened);

  const collapsed = sections.toggleSection(opened, "family");
  sections.writeSectionExpanded(storage, collapsed);
  assert.equal(sections.readSectionExpanded(storage).family, false);
  assert.equal(sections.expandSection(collapsed, "pollutants").pollutants, true);
  assert.equal(sections.expandSection(opened, "family"), opened);
});

test("invalid section storage falls back to the collapsed defaults", async () => {
  const sections = await compile("sections.ts");
  const storage = memoryStorage({ [sections.SECTION_STORAGE_KEY]: "{not json" });
  assert.deepEqual(sections.readSectionExpanded(storage), sections.DEFAULT_SECTION_EXPANDED);
  const partial = memoryStorage({
    [sections.SECTION_STORAGE_KEY]: JSON.stringify({ hourly: true, family: "yes", extra: true }),
  });
  const read = sections.readSectionExpanded(partial);
  assert.equal(read.hourly, true);
  assert.equal(read.family, false);
  assert.equal(read.assistant, false);
  assert.equal(sections.sectionFromHash("#family"), "family");
  assert.equal(sections.sectionFromHash("#overview"), null);
  assert.equal(sections.sectionFromHash("assistant"), "assistant");
});

test("the back-to-top control waits for a real scroll and respects reduced motion", async () => {
  const sections = await compile("sections.ts");
  assert.equal(sections.backToTopVisible(0), false);
  assert.equal(sections.backToTopVisible(sections.BACK_TO_TOP_THRESHOLD_PX - 1), false);
  assert.equal(sections.backToTopVisible(sections.BACK_TO_TOP_THRESHOLD_PX), true);
  assert.equal(sections.backToTopVisible(Number.NaN), false);
  assert.equal(sections.scrollTopBehavior(false), "smooth");
  assert.equal(sections.scrollTopBehavior(true), "auto");
});

test("primary safety information stays outside collapsed sections", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../src/CollapsibleSection.tsx", import.meta.url), "utf8");
  const back = await readFile(new URL("../src/BackToTop.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/design-system.css", import.meta.url), "utf8");
  const overview = app.slice(app.indexOf('id="overview"'), app.indexOf('id="hourly"'));
  assert.match(overview, /aqi-card/);
  assert.match(overview, /error-banner/);
  assert.match(overview, /geo-banner/);
  assert.match(overview, /notice-banner/);
  assert.match(overview, /context-strip/);
  assert.doesNotMatch(overview, /hidden=\{!/);
  for (const id of ["hourly", "gowindow", "family", "pollutants", "assistant"]) {
    assert.match(app, new RegExp(`expanded=\\{sections\\.${id}\\}`));
    assert.match(app, new RegExp(`"${id}"`));
  }
  assert.match(app, /readSectionExpanded\(sessionStorage\)/);
  assert.match(app, /SECTION_STORAGE_KEY|airsense\.sections|writeSectionExpanded/);
  assert.match(panel, /aria-expanded=\{expanded\}/);
  assert.match(panel, /aria-labelledby=\{titleId\}/);
  assert.match(panel, /aria-controls=\{`\$\{id\}-panel`\}/);
  assert.match(panel, /hidden=\{!expanded\}/);
  assert.match(panel, /ChevronDown/);
  assert.match(panel, /ChevronRight/);
  assert.match(panel, /type="button"/);
  assert.match(back, /aria-label="Back to top"/);
  assert.match(back, /prefers-reduced-motion: reduce/);
  assert.match(back, /scrollTopBehavior/);
  assert.match(back, /backToTopVisible/);
  assert.match(back, /ChevronUp/);
  assert.match(css, /\.back-to-top \{[\s\S]*border-radius: 50%/);
  assert.match(css, /\.back-to-top \{[\s\S]*width: 44px/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*\.back-to-top \{ right: 12px; bottom: 12px; \}/);
  assert.match(css, /\.insight-card\.is-collapsed \{ min-height: 0; height: auto; align-self: start; \}/);
  assert.match(css, /button:focus-visible/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /prefers-reduced-motion: no-preference/);
});
