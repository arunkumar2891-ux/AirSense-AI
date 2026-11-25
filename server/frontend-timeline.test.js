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

async function loadTimeline() {
  return import(await compile("timeline.ts"));
}

function reading(time, aqi, pm25) {
  return { time, aqi, pm25 };
}

function windowResult(overrides = {}) {
  return {
    start: "2026-11-25T23:30:00.000Z",
    end: "2026-11-26T00:15:00.000Z",
    timezone: "Asia/Kolkata",
    activity: "daily activities",
    durationMinutes: 45,
    exposureRecommendation: "suitable",
    recommendationLabel: "Suitable based on available forecast data",
    aqi: { minimum: 48, maximum: 48, minimumCategory: "Good", maximumCategory: "Good", scale: "US AQI" },
    pm25: { minimum: 13.8, maximum: 13.8, minimumLabel: "Low", maximumLabel: "Low", unit: "µg/m³" },
    weather: {
      temperatureC: { minimum: 24.8, maximum: 24.8 },
      windSpeedKmh: { minimum: 6, maximum: 6 },
      relativeHumidityPercent: { minimum: 98, maximum: 98 },
    },
    placement: "preferred",
    rankReason: "Ranked 1 for this activity. The highest forecast US AQI in the window is 48.",
    dataFreshness: { state: "fresh", ageMs: 60000, label: "Observed 1 min ago." },
    limitations: "Forecast recommendations are model estimates, not measurements.",
    estimate: true,
    ...overrides,
  };
}

function schedule(overrides = {}) {
  return {
    status: "suitable_windows",
    activity: "daily activities",
    durationMinutes: 45,
    timezone: "Asia/Kolkata",
    timePreference: "daytime",
    preference: { id: "daytime", label: "Daytime", rangeLabel: "5 AM–10 PM", timezone: "Asia/Kolkata", outcome: "within" },
    evaluatedAt: "2026-11-25T21:00:00.000Z",
    forecastFreshness: { state: "fresh", ageMs: 60000, label: "Observed 1 min ago." },
    windows: [windowResult()],
    reason: "One window.",
    limitations: "Forecast recommendations are model estimates, not measurements.",
    estimate: true,
    ...overrides,
  };
}

const kolkataNight = "2026-11-25T21:00:00.000Z";

test("hour labels use the location timezone across midnight", async () => {
  const { buildActivityTimeline } = await loadTimeline();
  const timeline = buildActivityTimeline({
    timezone: "Asia/Kolkata",
    timePreference: "daytime",
    now: Date.parse(kolkataNight),
    hourly: [],
  });
  assert.equal(timeline.hours.length, 12);
  assert.equal(timeline.hours[0].label, "2 AM");
  assert.notEqual(timeline.hours[0].label, "9 PM");
  assert.equal(timeline.timezone, "Asia/Kolkata");
  assert.match(timeline.timezoneNote, /Asia\/Kolkata/);
  assert.equal(timeline.hours[0].showDate, true);
  assert.equal(timeline.hours[0].dateLabel, "Nov 26");

  const crossing = buildActivityTimeline({
    timezone: "Asia/Kolkata",
    timePreference: "evening",
    now: Date.parse("2026-11-25T16:15:00.000Z"),
    hourly: [],
  });
  assert.deepEqual(crossing.hours.slice(0, 5).map((hour) => hour.label), ["9 PM", "10 PM", "11 PM", "12 AM", "1 AM"]);
  assert.equal(crossing.hours[0].dayKey, "2026-11-25");
  assert.equal(crossing.hours[3].dayKey, "2026-11-26");
  assert.equal(crossing.hours[3].showDate, true);
  assert.equal(crossing.hours[2].showDate, false);
  assert.equal(crossing.hours[0].inPreference, true);
  assert.equal(crossing.hours[1].inPreference, false);

  const newYork = buildActivityTimeline({
    timezone: "America/New_York",
    timePreference: "evening",
    now: Date.parse("2026-11-26T04:30:00.000Z"),
    hourly: [],
  });
  assert.equal(newYork.hours[0].label, "11 PM");
  assert.equal(newYork.hours[1].label, "12 AM");
  assert.notEqual(newYork.hours[0].dayKey, newYork.hours[1].dayKey);
});

test("daylight-saving boundaries keep local hour labels on absolute hours", async () => {
  const { buildActivityTimeline } = await loadTimeline();
  const spring = buildActivityTimeline({
    timezone: "America/New_York",
    timePreference: "any",
    now: Date.parse("2026-03-08T06:30:00.000Z"),
    hourly: [],
  });
  assert.equal(spring.hours[0].label, "1 AM");
  assert.equal(spring.hours[1].label, "3 AM");
  assert.equal(spring.hours.some((hour) => hour.label === "2 AM"), false);

  const fall = buildActivityTimeline({
    timezone: "America/New_York",
    timePreference: "any",
    now: Date.parse("2026-11-01T05:30:00.000Z"),
    hourly: [],
  });
  assert.notEqual(fall.hours[0].label, fall.hours[1].label);
  assert.match(fall.hours[0].label, /1 AM/);
  assert.match(fall.hours[1].label, /1 AM/);
  assert.match(fall.hours[0].description, /1 AM/);
});

test("missing forecast hours are not filled from neighboring readings", async () => {
  const { buildActivityTimeline, startOfLocalHour } = await loadTimeline();
  const now = Date.parse(kolkataNight);
  const origin = startOfLocalHour(now, "Asia/Kolkata");
  const timeline = buildActivityTimeline({
    timezone: "Asia/Kolkata",
    timePreference: "daytime",
    now,
    hourly: [
      reading(new Date(origin).toISOString(), 12, null),
      reading(new Date(origin + 2 * 60 * 60 * 1000).toISOString(), 90, 40),
    ],
  });
  assert.equal(timeline.hours[0].forecastState, "available");
  assert.equal(timeline.hours[0].aqi, 12);
  assert.equal(timeline.hours[0].pm25, null);
  assert.equal(timeline.hours[0].pm25Text, "PM2.5 unavailable");
  assert.equal(timeline.hours[0].tone, "good");
  assert.equal(timeline.hours[1].forecastState, "missing");
  assert.equal(timeline.hours[1].aqi, null);
  assert.equal(timeline.hours[1].pm25, null);
  assert.equal(timeline.hours[1].categoryLabel, "No forecast");
  assert.match(timeline.hours[1].description, /not estimated/);
  assert.equal(timeline.hours[1].selectable, false);
  assert.doesNotMatch(timeline.hours[1].description, /US AQI 12|US AQI 90|PM2\.5 40/);
  assert.equal(timeline.hours[2].aqi, 90);
  assert.equal(timeline.hours[2].tone, "caution");
  assert.equal(timeline.hours[2].pm25Text, "PM2.5 40 µg/m³");

  const conflict = buildActivityTimeline({
    timezone: "Asia/Kolkata",
    timePreference: "daytime",
    now,
    hourly: [
      reading(new Date(origin).toISOString(), 12, 4),
      reading(new Date(origin + 30 * 60 * 1000).toISOString(), 80, 20),
    ],
  });
  assert.equal(conflict.hours[0].forecastState, "conflict");
  assert.equal(conflict.hours[0].aqi, null);
  assert.match(conflict.hours[0].aqiText, /not combined/);
});

test("only scheduler windows are recommended, including alternatives", async () => {
  const { buildActivityTimeline, startOfLocalHour } = await loadTimeline();
  const now = Date.parse(kolkataNight);
  const origin = startOfLocalHour(now, "Asia/Kolkata");
  const timeline = buildActivityTimeline({
    timezone: "Asia/Kolkata",
    timePreference: "daytime",
    now,
    hourly: [reading(new Date(origin).toISOString(), 10, 3), reading(new Date(origin + 3 * 60 * 60 * 1000).toISOString(), 48, 13.8)],
    result: schedule(),
  });
  const overnight = timeline.hours[0];
  const recommended = timeline.hours[3];
  assert.equal(overnight.label, "2 AM");
  assert.equal(overnight.inPreference, false);
  assert.equal(overnight.windowRole, "none");
  assert.equal(overnight.selectable, false);
  assert.equal(overnight.aqi, 10);
  assert.match(overnight.description, /No recommended window was returned/);
  assert.equal(recommended.label, "5 AM");
  assert.equal(recommended.inPreference, true);
  assert.equal(recommended.windowRole, "preferred");
  assert.equal(recommended.selectable, false);
  assert.equal(timeline.windows.length, 1);
  assert.equal(timeline.windows[0].selectable, true);
  assert.equal(timeline.windows[0].best, true);
  assert.equal(timeline.windows[0].placement, "preferred");
  assert.equal(timeline.windows[0].visible, true);
  assert.equal(timeline.windows[0].durationMinutes, 45);
  assert.equal(timeline.windows[0].aqi, "US AQI 48 · Good");
  assert.equal(timeline.windows[0].pm25, "PM2.5 13.8 µg/m³ · Low");
  assert.match(timeline.windows[0].weather, /24\.8°C/);
  assert.match(timeline.windows[0].weather, /Wind 6 km\/h/);
  assert.match(timeline.windows[0].rankReason, /Ranked 1/);
  assert.match(timeline.windows[0].buttonLabel, /Best/);
  assert.match(timeline.summary, /do not decide a recommendation/);

  const alternatives = buildActivityTimeline({
    timezone: "Asia/Kolkata",
    timePreference: "daytime",
    now,
    hourly: [reading(new Date(origin).toISOString(), 30, 8)],
    result: schedule({
      status: "outside_preference",
      preference: { id: "daytime", label: "Daytime", rangeLabel: "5 AM–10 PM", timezone: "Asia/Kolkata", outcome: "outside" },
      windows: [windowResult({
        start: new Date(origin).toISOString(),
        end: new Date(origin + 45 * 60 * 1000).toISOString(),
        placement: "alternative",
        rankReason: "Alternative 1 outside Daytime (5 AM–10 PM).",
      })],
    }),
  });
  assert.equal(alternatives.windows.length, 1);
  assert.equal(alternatives.windows[0].placement, "alternative");
  assert.equal(alternatives.windows[0].best, false);
  assert.equal(alternatives.windows[0].selectable, true);
  assert.match(alternatives.windows[0].caveat, /Not the primary recommendation/);
  assert.match(alternatives.windows[0].buttonLabel, /Alternative 1/);
  assert.equal(alternatives.hours[0].windowRole, "alternative");
  assert.equal(alternatives.hours[3].windowRole, "none");
  assert.equal(alternatives.hours[3].selectable, false);
  assert.equal(alternatives.hours.filter((hour) => hour.selectable).length, 0);
});

test("an invalid location timezone is labeled as UTC instead of the runtime zone", async () => {
  const { buildActivityTimeline } = await loadTimeline();
  const now = Date.parse("2026-11-25T21:00:00.000Z");
  const timeline = buildActivityTimeline({ timezone: "Not/AZone", timePreference: "daytime", now, hourly: [] });
  const utc = buildActivityTimeline({ timezone: "UTC", timePreference: "daytime", now, hourly: [] });
  assert.equal(timeline.timezone, "UTC");
  assert.match(timeline.timezoneNote, /hour labels use UTC/);
  assert.equal(timeline.hours[0].label, utc.hours[0].label);
  assert.equal(timeline.hours[0].label, "9 PM");
});

test("timeline markup stays accessible in light, dark, and mobile layouts", async () => {
  const view = await readFile(new URL("../src/ActivityTimeline.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../src/GoWindowPanel.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/design-system.css", import.meta.url), "utf8");
  const timelineCss = css.slice(css.indexOf(".activity-timeline"), css.indexOf(".assistant-section"));
  const mobile = css.slice(css.indexOf("@media (max-width: 760px)"));
  assert.match(view, /aria-pressed/);
  assert.match(view, /aria-controls="timeline-detail"/);
  assert.match(view, /aria-live="polite"/);
  assert.match(view, /aria-label=\{window\.buttonLabel\}/);
  assert.match(view, /No forecast/);
  assert.match(view, /Not estimated/);
  assert.match(view, /cannot be selected as activities/);
  assert.match(view, /ArrowRight/);
  assert.match(view, /role="region"/);
  assert.match(view, /Timeline legend/);
  assert.match(view, /In range/);
  assert.match(view, /Alternative/);
  assert.match(panel, /<ActivityTimeline /);
  assert.match(timelineCss, /\.timeline-hour\.good[\s\S]{0,220}var\(--blue/);
  assert.match(timelineCss, /\.timeline-hour\.caution[\s\S]{0,220}var\(--orange/);
  assert.match(timelineCss, /\.timeline-hour\.high[\s\S]{0,220}var\(--danger/);
  assert.match(timelineCss, /html\[data-theme="dark"\] \.activity-timeline/);
  assert.match(timelineCss, /html\[data-theme="dark"\] \.timeline-hour\.missing/);
  assert.match(css, /html\[data-theme="dark"\][\s\S]*--surface:/);
  assert.match(css, /html\[data-theme="dark"\][\s\S]*--orange-soft:/);
  assert.match(css, /html\[data-theme="dark"\][\s\S]*--blue-soft:/);
  assert.match(timelineCss, /\.timeline-scroll \{[^}]*overflow-x: auto/);
  assert.match(timelineCss, /\.timeline-scroll \{[^}]*max-width: 100%/);
  assert.match(timelineCss, /\.timeline-pick \{[^}]*min-height: 44px/);
  assert.match(mobile, /\.timeline-scroll \{ overflow-x: auto; max-width: 100%; \}/);
  assert.match(mobile, /\.timeline-picker \{ display: grid; grid-template-columns: 1fr; \}/);
  assert.match(mobile, /\.timeline-pick \{ width: 100%; min-height: 44px; \}/);
  assert.doesNotMatch(timelineCss, /backdrop-filter|#[0-9a-f]{3,8}/i);
});
