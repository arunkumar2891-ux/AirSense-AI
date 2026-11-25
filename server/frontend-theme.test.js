import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const initScript = await readFile(new URL("../public/theme-init.js", import.meta.url), "utf8");

function runThemeInit(saved, systemDark) {
  const themeColor = { content: "", setAttribute(_name, value) { this.content = value; } };
  const documentElement = { dataset: {}, style: {} };
  const context = {
    localStorage: { getItem: () => saved },
    window: { matchMedia: () => ({ matches: systemDark }) },
    document: {
      documentElement,
      querySelector: () => themeColor,
    },
  };
  vm.runInNewContext(initScript, context);
  return { documentElement, themeColor };
}

test("pre-render bootstrap applies a persisted light or dark theme", () => {
  const light = runThemeInit("light", true);
  assert.equal(light.documentElement.dataset.theme, "light");
  assert.equal(light.documentElement.style.colorScheme, "light");
  assert.equal(light.themeColor.content, "#F4F6F9");

  const dark = runThemeInit("dark", false);
  assert.equal(dark.documentElement.dataset.theme, "dark");
  assert.equal(dark.documentElement.style.colorScheme, "dark");
  assert.equal(dark.themeColor.content, "#101722");
});

test("pre-render System preference follows the OS color scheme", () => {
  assert.equal(runThemeInit("system", true).documentElement.dataset.theme, "dark");
  assert.equal(runThemeInit("system", false).documentElement.dataset.theme, "light");
  assert.equal(runThemeInit(null, true).documentElement.dataset.theme, "dark");
});

test("theme selector exposes Light, Dark, and System with persistence", async () => {
  const source = await readFile(new URL("../src/ThemeSelector.tsx", import.meta.url), "utf8");
  assert.match(source, /aria-label="Appearance theme"/);
  assert.match(source, /value="light">Light/);
  assert.match(source, /value="dark">Dark/);
  assert.match(source, /value="system">System/);
  assert.match(source, /localStorage\.setItem\(STORAGE_KEY, next\)/);
  assert.match(source, /prefers-color-scheme: dark/);
});

test("central design system defines both token sets without glass effects", async () => {
  const css = await readFile(new URL("../src/design-system.css", import.meta.url), "utf8");
  for (const token of ["--blue: #2563eb", "--blue-deep: #174ea6", "--orange: #f59e0b", "--bg: #f4f6f9", "--bg: #101722"]) {
    assert.ok(css.toLowerCase().includes(token), `missing ${token}`);
  }
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.doesNotMatch(css, /backdrop-filter|box-shadow:\s*0 0 \d{2,}px/i);
});
