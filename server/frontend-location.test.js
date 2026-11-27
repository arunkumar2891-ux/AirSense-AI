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
    getItem(key) { return Object.hasOwn(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; },
  };
}

const gps = { lat: 12.97, lon: 77.59, label: "Bengaluru, Karnataka, India", source: "gps" };
const manual = { lat: 19.07, lon: 72.87, label: "Mumbai, Maharashtra, India", source: "manual" };

test("a refresh keeps the current GPS location instead of the default city", async () => {
  const session = await compile("location-session.ts");
  const storage = memoryStorage({ [session.GPS_LOCATION_KEY]: JSON.stringify(gps) });
  assert.deepEqual(session.locationForSession(storage), gps);
  assert.equal(session.locationForSession(memoryStorage()), null);
  assert.equal(session.locationForSession(null), null);
});

test("a searched place still wins over the saved GPS fix", async () => {
  const session = await compile("location-session.ts");
  const storage = memoryStorage({
    [session.GPS_LOCATION_KEY]: JSON.stringify(gps),
    [session.MANUAL_LOCATION_KEY]: JSON.stringify(manual),
  });
  assert.deepEqual(session.locationForSession(storage), manual);
  const corrupt = memoryStorage({
    [session.GPS_LOCATION_KEY]: "{not json",
    [session.MANUAL_LOCATION_KEY]: JSON.stringify({ lat: "south", lon: 1, label: "Bad" }),
  });
  assert.equal(session.locationForSession(corrupt), null);
});

test("the dashboard restores a saved place before Chennai and the mobile menu wraps", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/design-system.css", import.meta.url), "utf8");
  assert.match(app, /locationForSession\(sessionStorage\)/);
  assert.match(app, /if \(saved\) applyLocation\(saved, false\)/);
  assert.match(app, /else refresh\(fallbackCity\.lat, fallbackCity\.lon\)/);
  const mobile = css.slice(css.indexOf("@media (max-width: 760px)"));
  const navRule = mobile.match(/\.primary-nav \{[^}]+\}/)?.[0] || "";
  assert.match(navRule, /grid-template-columns: repeat\(auto-fit, minmax\(148px, 1fr\)\)/);
  assert.match(navRule, /overflow: visible/);
  assert.doesNotMatch(navRule, /overflow-x:\s*auto/);
});
