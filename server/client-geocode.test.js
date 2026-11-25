import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function loadClientApi() {
  const source = await readFile(new URL("../src/api.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

test("browser reverse geocoding uses BigDataCloud directly", async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => ({
        city: "Hyderabad",
        principalSubdivision: "Telangana",
        countryName: "India",
      }),
    };
  };
  try {
    const { reverseGeocode } = await loadClientApi();
    const result = await reverseGeocode(17.385, 78.4867);
    assert.equal(result.label, "Hyderabad, Telangana, India");
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^https:\/\/api\.bigdatacloud\.net\/data\/reverse-geocode-client/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("browser reverse-geocoding failure returns the honest server fallback", async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith("https://api.bigdatacloud.net/")) {
      return { ok: false, status: 503, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({ label: "Your location", fallback: true }) };
  };
  try {
    const { reverseGeocode } = await loadClientApi();
    const result = await reverseGeocode(17.385, 78.4867);
    assert.deepEqual(result, { label: "Your location", fallback: true });
    assert.deepEqual(calls.map((url) => url.startsWith("https://") ? "provider" : url), [
      "provider",
      "/api/reverse-geocode",
    ]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
