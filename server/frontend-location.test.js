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
    const dep = `${spec.replace(/^\.\//, "").replace(/\.js$/, "")}.ts`;
    const url = await compile(dep, cache);
    outputText = outputText.replaceAll(`"${spec}"`, `"${url}"`).replaceAll(`'${spec}'`, `'${url}'`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
  cache.set(relativePath, url);
  return url;
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
  const session = await import(await compile("location-session.ts"));
  const storage = memoryStorage({ [session.GPS_LOCATION_KEY]: JSON.stringify(gps) });
  assert.deepEqual(session.locationForSession(storage), gps);
  assert.equal(session.locationForSession(memoryStorage()), null);
  assert.equal(session.locationForSession(null), null);
});

test("a searched place still wins over the saved GPS fix", async () => {
  const session = await import(await compile("location-session.ts"));
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

test("a closed tab keeps the saved place until it is cleared", async () => {
  const session = await import(await compile("location-session.ts"));
  const store = await import(await compile("browser-store.ts"));
  const local = memoryStorage();
  const tab = memoryStorage({ [session.GPS_LOCATION_KEY]: JSON.stringify(gps) });
  assert.deepEqual(session.locationForSession(local, tab), gps);
  assert.equal(local.getItem(session.GPS_LOCATION_KEY), JSON.stringify(gps));
  assert.equal(tab.getItem(session.GPS_LOCATION_KEY), null);
  const nextTab = memoryStorage();
  assert.deepEqual(session.locationForSession(local, nextTab), gps);
  store.removePreference(local, nextTab, session.GPS_LOCATION_KEY);
  store.removePreference(local, nextTab, session.MANUAL_LOCATION_KEY);
  assert.equal(session.locationForSession(local, nextTab), null);
});

test("the dashboard restores a saved place before Chennai and the mobile menu wraps", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/design-system.css", import.meta.url), "utf8");
  assert.match(app, /locationForSession\(localStorage, sessionStorage\)/);
  assert.match(app, /Clear saved place/);
  assert.match(app, /if \(saved\) applyLocation\(saved, false\)/);
  assert.match(app, /else refresh\(fallbackCity\.lat, fallbackCity\.lon\)/);
  assert.match(app, /if \(saved\?\.source === "manual"\) return/);
  assert.match(app, /if \(state === "granted"\) \{\s*requestGps\(\);/);
  assert.doesNotMatch(app, /if \(saved \|\| asked\) return/);
  const mobile = css.slice(css.indexOf("@media (max-width: 760px)"));
  const navRule = mobile.match(/\.primary-nav \{[^}]+\}/)?.[0] || "";
  assert.match(navRule, /grid-template-columns: repeat\(auto-fit, minmax\(148px, 1fr\)\)/);
  assert.match(navRule, /overflow: visible/);
  assert.doesNotMatch(navRule, /overflow-x:\s*auto/);
});
