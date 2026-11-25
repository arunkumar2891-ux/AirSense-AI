import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildExposureDecision } from "./logic.js";
import { findGoWindows } from "./gowindow.js";

const NOW = Date.parse("2026-06-15T02:30:00.000Z");
const HOUR = 60 * 60 * 1000;

function at(offsetHours) {
  return new Date(NOW + offsetHours * HOUR).toISOString();
}

function forecast(hourly, overrides = {}) {
  return {
    timezone: "Asia/Kolkata",
    issuedAt: at(0),
    hourly,
    ...overrides,
  };
}

function hour(offsetHours, overrides = {}) {
  return {
    time: at(offsetHours),
    aqi: 35,
    pm25: 8,
    pm10: 12,
    weather: { wind_speed_10m: 12, temperature_2m: 30, relative_humidity_2m: 60 },
    ...overrides,
  };
}

function schedule(hourly, profile, durationMinutes, forecastOverrides = {}) {
  return findGoWindows({
    forecast: forecast(hourly, forecastOverrides),
    profile,
    durationMinutes,
    now: NOW,
  });
}

const runner = { activity: "running", ageGroup: "adult", sensitivity: "general" };
const daily = { activity: "daily activities", ageGroup: "adult", sensitivity: "general" };

function assertEstimate(result) {
  assert.equal(result.estimate, true);
  assert.doesNotMatch(JSON.stringify(result), /\bsafe\b/i);
  for (const window of result.windows) {
    assert.equal(window.recommendationLabel, "Suitable based on available forecast data");
    assert.equal(window.exposureRecommendation, "suitable");
    assert.equal(window.estimate, true);
  }
}

test("a suitable morning forecast returns ranked hour-long windows", () => {
  const result = schedule([0, 1, 2, 3].map((offset) => hour(offset, { aqi: 30 + offset })), runner, 60);
  assert.equal(result.status, "suitable_windows");
  assert.equal(result.windows.length, 3);
  assert.deepEqual(result.windows.map((window) => window.start), [at(0), at(1), at(2)]);
  assert.equal(result.windows[0].end, at(1));
  assert.equal(result.windows[0].timezone, "Asia/Kolkata");
  assert.equal(result.windows[0].activity, "running");
  assert.equal(result.windows[0].durationMinutes, 60);
  assert.equal(result.windows[0].aqi.maximum, 30);
  assert.equal(result.windows[0].pm25.maximum, 8);
  assert.equal(result.windows[0].weather.windSpeedKmh.maximum, 12);
  assert.match(result.windows[0].rankReason, /Ranked 1/);
  assert.match(result.limitations, /model estimates/i);
  assert.equal(result.forecastFreshness.state, "fresh");
  assertEstimate(result);
});

test("an unsuitable morning is skipped in favor of a suitable evening", () => {
  const result = schedule([
    hour(0, { aqi: 160, pm25: 70 }),
    hour(1, { aqi: 170, pm25: 75 }),
    hour(10, { aqi: 32, pm25: 7 }),
    hour(11, { aqi: 28, pm25: 6 }),
  ], runner, 60);
  assert.equal(result.status, "suitable_windows");
  assert.deepEqual(result.windows.map((window) => window.start), [at(11), at(10)]);
  assert.equal(result.assessment.unsuitableHours, 2);
  assert.equal(result.assessment.suitableHours, 2);
  assertEstimate(result);
});

test("no suitable window is distinct from unavailable forecast data", () => {
  const result = schedule([0, 1, 2].map((offset) => hour(offset, { aqi: 180, pm25: 80 })), runner, 60);
  assert.equal(result.status, "no_suitable_window");
  assert.equal(result.windows.length, 0);
  assert.equal(result.assessment.suitableHours, 0);
  assert.equal(result.assessment.unsuitableHours, 3);
  assert.equal(result.assessment.unavailableHours, 0);
  assert.match(result.reason, /does not contain a suitable interval/i);
  assertEstimate(result);
});

test("missing AQI yields insufficient data and does not fabricate clean air", () => {
  const result = schedule([0, 1].map((offset) => hour(offset, { aqi: null, pm25: null })), runner, 60);
  assert.equal(result.status, "insufficient_data");
  assert.equal(result.windows.length, 0);
  assert.equal(result.assessment.unavailableHours, 2);
  assert.equal(result.assessment.unsuitableHours, 0);
  assert.match(result.reason, /US AQI/i);
  assert.doesNotMatch(JSON.stringify(result.windows), /"aqi": 0/);
  assertEstimate(result);
});

test("missing PM2.5 does not outrank known PM2.5 or get described as clean", () => {
  const result = schedule([
    hour(0, { aqi: 35, pm25: null }),
    hour(1, { aqi: 35, pm25: 8 }),
    hour(2, { aqi: 35, pm25: 80 }),
  ], runner, 60);
  assert.equal(result.status, "suitable_windows");
  assert.equal(result.windows[0].start, at(1));
  assert.equal(result.windows[0].pm25.maximum, 8);
  const unknown = result.windows.find((window) => window.start === at(0));
  assert.equal(unknown.pm25, null);
  assert.match(unknown.rankReason, /not treated as clean air/i);
  assert.match(unknown.limitations, /not interpreted as clean air/i);
  assert.equal(result.windows.some((window) => window.start === at(2)), false);
  assertEstimate(result);
});

test("a stale forecast produces no scheduling decision", () => {
  const result = schedule(
    [0, 1].map((offset) => hour(offset, { aqi: 20, pm25: 5 })),
    runner,
    60,
    { issuedAt: new Date(NOW - 4 * HOUR).toISOString() },
  );
  assert.equal(result.status, "insufficient_data");
  assert.equal(result.forecastFreshness.state, "stale");
  assert.equal(result.windows.length, 0);
  assert.equal(result.assessment.suitableHours, 0);
  assert.equal(result.assessment.unsuitableHours, 0);
  assertEstimate(result);
});

test("forecast gaps prevent windows from bridging missing hours", () => {
  const result = schedule([hour(0), hour(1), hour(3)], runner, 120);
  assert.equal(result.status, "suitable_windows");
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].start, at(0));
  assert.equal(result.windows[0].end, at(2));
  assert.equal(result.assessment.suitableHours, 3);
});

test("activity intensity changes which forecast hours are schedulable", () => {
  const hourly = [hour(0, { aqi: 80, pm25: 8 }), hour(1, { aqi: 80, pm25: 8 })];
  const vigorous = schedule(hourly, runner, 60);
  const light = schedule(hourly, daily, 60);
  assert.equal(vigorous.status, "no_suitable_window");
  assert.equal(vigorous.assessment.unsuitableHours, 2);
  assert.equal(light.status, "suitable_windows");
  assert.equal(light.windows[0].activity, "daily activities");
});

test("sensitive profiles retain the stricter deterministic recommendation", () => {
  const hourly = [hour(0), hour(1)];
  const general = schedule(hourly, runner, 60);
  const sensitive = schedule(hourly, { ...runner, sensitivity: "respiratory sensitivity" }, 60);
  const child = schedule(
    [hour(0, { aqi: 120, pm25: 8 })],
    { activity: "children's outdoor play", ageGroup: "child", sensitivity: "general" },
    60,
  );
  assert.equal(general.status, "suitable_windows");
  assert.equal(sensitive.status, "no_suitable_window");
  assert.equal(sensitive.assessment.unsuitableHours, 2);
  assert.equal(child.status, "no_suitable_window");
  assert.equal(child.assessment.unsuitableHours, 1);
});

test("duration longer than every suitable interval returns no window", () => {
  const result = schedule([hour(0), hour(1)], runner, 180);
  assert.equal(result.status, "no_suitable_window");
  assert.equal(result.assessment.suitableHours, 2);
  assert.match(result.reason, /long enough/i);
  assert.equal(result.windows.length, 0);
});

test("daylight-saving transitions use absolute hourly instants", () => {
  const fallbackNow = Date.parse("2026-11-01T05:00:00.000Z");
  const fallback = findGoWindows({
    forecast: {
      timezone: "America/New_York",
      issuedAt: "2026-11-01T05:00:00.000Z",
      hourly: [
        hour(0, { time: "2026-11-01T05:00:00.000Z" }),
        hour(1, { time: "2026-11-01T06:00:00.000Z" }),
      ],
    },
    profile: runner,
    durationMinutes: 120,
    now: fallbackNow,
  });
  assert.equal(fallback.status, "suitable_windows");
  assert.equal(fallback.windows[0].start, "2026-11-01T05:00:00.000Z");
  assert.equal(fallback.windows[0].end, "2026-11-01T07:00:00.000Z");
  assert.equal(fallback.windows[0].timezone, "America/New_York");

  const springNow = Date.parse("2026-03-08T06:00:00.000Z");
  const spring = findGoWindows({
    forecast: {
      timezone: "America/New_York",
      issuedAt: "2026-03-08T06:00:00.000Z",
      hourly: [
        { time: "2026-03-08T06:00:00.000Z", aqi: 30, pm25: 8 },
        { time: "2026-03-08T07:00:00.000Z", aqi: 30, pm25: 8 },
      ],
    },
    profile: runner,
    durationMinutes: 120,
    now: springNow,
  });
  assert.equal(spring.status, "suitable_windows");
  assert.equal(spring.windows[0].end, "2026-03-08T08:00:00.000Z");

  const gap = findGoWindows({
    forecast: {
      timezone: "America/New_York",
      issuedAt: "2026-11-01T05:00:00.000Z",
      hourly: [
        { time: "2026-11-01T05:00:00.000Z", aqi: 30, pm25: 8 },
        { time: "2026-11-01T07:00:00.000Z", aqi: 30, pm25: 8 },
      ],
    },
    profile: runner,
    durationMinutes: 120,
    now: fallbackNow,
  });
  assert.equal(gap.status, "no_suitable_window");
  assert.equal(gap.assessment.suitableHours, 2);
});

test("missing weather remains usable and is not invented", () => {
  const result = schedule([
    hour(0, { weather: undefined }),
    hour(1, { weather: { temperature_2m: null, wind_speed_10m: null } }),
  ], runner, 60);
  assert.equal(result.status, "suitable_windows");
  assert.equal(result.windows[0].weather, null);
  assert.match(result.windows[0].limitations, /weather was unavailable/i);
  assertEstimate(result);
});

test("known light wind uses the existing stagnation threshold", () => {
  const calm = schedule([hour(0, { aqi: 80, pm25: 40, weather: { wind_speed_10m: 3 } })], {
    activity: "commuting", ageGroup: "adult", sensitivity: "general",
  }, 60);
  const breezy = schedule([hour(0, { aqi: 80, pm25: 40, weather: { wind_speed_10m: 12 } })], {
    activity: "commuting", ageGroup: "adult", sensitivity: "general",
  }, 60);
  const ranked = schedule([
    hour(0, { weather: { wind_speed_10m: 3, temperature_2m: 29 } }),
    hour(1, { weather: { wind_speed_10m: 12, temperature_2m: 29 } }),
  ], runner, 60);
  assert.equal(calm.status, "no_suitable_window");
  assert.equal(breezy.status, "suitable_windows");
  assert.equal(ranked.windows[0].start, at(1));
  assert.match(ranked.windows[0].rankReason, /at or above 5 km\/h/i);
});

test("past forecast hours and future conditions do not change the current decision", () => {
  const profile = runner;
  const current = {
    aqi: 42,
    pollutants: { pm25: 9 },
    weather: { wind_speed_10m: 12 },
    observedAt: at(0),
    hourly: [hour(-2, { aqi: 20 }), hour(2, { aqi: 180, pm25: 90 }), hour(3, { aqi: 30, pm25: 7 })],
  };
  const before = buildExposureDecision(current, profile, NOW);
  const result = findGoWindows({
    forecast: forecast(current.hourly),
    profile,
    durationMinutes: 60,
    now: NOW,
  });
  const after = buildExposureDecision(current, profile, NOW);
  assert.deepEqual(after, before);
  assert.equal(before.activityRecommendation, "suitable");
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].start, at(3));
  assert.equal(result.assessment.unsuitableHours, 1);
});

test("GoWindow scheduling is deterministic and independent of Gemini", async () => {
  const input = {
    forecast: forecast([hour(0), hour(1)]),
    profile: runner,
    durationMinutes: 90,
    now: NOW,
  };
  assert.deepEqual(findGoWindows(input), findGoWindows(input));
  const source = await readFile(new URL("./gowindow.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /gemini|@google\/genai|fetch\(/i);
  assert.match(source, /buildExposureDecision/);
});

test("invalid forecast time, duration, and timezone-naive timestamps are rejected", () => {
  const futureIssue = schedule([hour(1)], runner, 60, { issuedAt: new Date(NOW + HOUR).toISOString() });
  assert.equal(futureIssue.status, "insufficient_data");
  assert.equal(futureIssue.forecastFreshness.state, "unknown");

  const naive = schedule([{ time: "2026-06-15T08:00", aqi: 25, pm25: 6 }], runner, 60);
  assert.equal(naive.status, "insufficient_data");
  assert.equal(naive.assessment.futureHours, 0);

  const invalidDuration = schedule([hour(0)], runner, 0);
  assert.equal(invalidDuration.status, "insufficient_data");
  assert.match(invalidDuration.reason, /duration/i);
});

function kolkataLocal(hour, minute = 0, day = 15) {
  return new Date(Date.UTC(2026, 5, day, hour, minute) - (5 * 60 + 30) * 60 * 1000).toISOString();
}

function localMinutes(iso, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso)).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return parts.hour * 60 + parts.minute;
}

function preferenceHours(startHour, endHour, betterHours = new Set()) {
  const rows = [];
  for (let clockHour = startHour; clockHour < endHour; clockHour += 1) {
    rows.push(hour(0, {
      time: kolkataLocal(clockHour),
      aqi: betterHours.has(clockHour) ? 20 : 40,
      pm25: 8,
    }));
  }
  return rows;
}

function preferenceSchedule({ timePreference, hourly, now, timezone = "Asia/Kolkata", durationMinutes = 60 }) {
  return findGoWindows({
    forecast: { timezone, issuedAt: now, hourly },
    profile: daily,
    durationMinutes,
    timePreference,
    now: Date.parse(now),
  });
}

test("every time preference keeps windows inside its location-local range", () => {
  const cases = [
    ["morning", 5, [5 * 60, 12 * 60], 14],
    ["afternoon", 12, [12 * 60, 17 * 60], 18],
    ["evening", 17, [17 * 60, 22 * 60], 23],
    ["daytime", 5, [5 * 60, 22 * 60], 2],
    ["any", 1, null, 2],
  ];
  for (const [timePreference, nowHour, range, betterHour] of cases) {
    const result = preferenceSchedule({
      timePreference,
      now: kolkataLocal(nowHour),
      hourly: preferenceHours(nowHour, nowHour + 12, new Set([betterHour])),
    });
    assert.equal(result.status, "suitable_windows", timePreference);
    assert.ok(result.windows.length > 0, timePreference);
    for (const window of result.windows) {
      assert.equal(window.placement, "preferred", timePreference);
      if (!range) continue;
      const start = localMinutes(window.start, "Asia/Kolkata");
      const end = localMinutes(window.end, "Asia/Kolkata");
      assert.ok(start >= range[0] && start < range[1], `${timePreference} start ${window.start}`);
      assert.ok(end > start && end <= range[1], `${timePreference} end ${window.end}`);
    }
    if (timePreference !== "any" && timePreference !== "daytime") {
      assert.equal(result.windows.some((window) => window.start === kolkataLocal(betterHour)), false, timePreference);
    }
  }
});

test("daytime does not present a cleaner 2 AM window as the primary recommendation", () => {
  const hourly = [
    hour(0, { time: kolkataLocal(2), aqi: 20, pm25: 6 }),
    hour(0, { time: kolkataLocal(9), aqi: 42, pm25: 10 }),
  ];
  const now = kolkataLocal(1, 30);
  const omitted = preferenceSchedule({ hourly, now });
  const anyTime = preferenceSchedule({ timePreference: "any", hourly, now });
  const daytime = preferenceSchedule({ timePreference: "daytime", hourly, now });
  assert.equal(omitted.timePreference, null);
  assert.equal(omitted.windows[0].start, kolkataLocal(2));
  assert.equal(anyTime.windows[0].start, kolkataLocal(2));
  assert.equal(daytime.status, "suitable_windows");
  assert.equal(daytime.preference.outcome, "within");
  assert.equal(daytime.windows.length, 1);
  assert.equal(daytime.windows[0].start, kolkataLocal(9));
  assert.equal(daytime.windows[0].placement, "preferred");
  assert.equal(daytime.windows.some((window) => window.start === kolkataLocal(2)), false);
  assert.equal(localMinutes(daytime.windows[0].start, "Asia/Kolkata"), 9 * 60);
});

test("suitable windows only outside the preference are alternatives, not a primary recommendation", () => {
  const result = preferenceSchedule({
    timePreference: "daytime",
    now: kolkataLocal(1, 30),
    hourly: [hour(0, { time: kolkataLocal(2), aqi: 30, pm25: 8 })],
  });
  assert.equal(result.status, "outside_preference");
  assert.equal(result.preference.outcome, "outside");
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].placement, "alternative");
  assert.match(result.reason, /No suitable window was found within Daytime/);
  assert.match(result.windows[0].rankReason, /Alternative 1 outside Daytime/);
  assert.equal(result.windows[0].exposureRecommendation, "suitable");
  assert.doesNotMatch(result.windows[0].rankReason, /Ranked 1/);
});

test("no suitable window anywhere stays empty when a time preference is selected", () => {
  const result = preferenceSchedule({
    timePreference: "evening",
    now: kolkataLocal(17),
    hourly: preferenceHours(17, 23).map((row) => ({ ...row, aqi: 180, pm25: 80 })),
  });
  assert.equal(result.status, "no_suitable_window");
  assert.deepEqual(result.windows, []);
  assert.match(result.reason, /does not contain a suitable interval/);
});

test("windows that cross a preference boundary are not treated as inside it", () => {
  const hourly = [11, 12].map((hourOfDay) => hour(0, { time: kolkataLocal(hourOfDay), aqi: 30, pm25: 8 }));
  const now = kolkataLocal(11);
  const inside = preferenceSchedule({ timePreference: "morning", hourly, now, durationMinutes: 60 });
  const crossing = preferenceSchedule({ timePreference: "morning", hourly, now, durationMinutes: 90 });
  const daytime = preferenceSchedule({ timePreference: "daytime", hourly, now, durationMinutes: 90 });
  assert.equal(inside.status, "suitable_windows");
  assert.equal(inside.windows[0].start, kolkataLocal(11));
  assert.equal(localMinutes(inside.windows[0].end, "Asia/Kolkata"), 12 * 60);
  assert.equal(crossing.status, "outside_preference");
  assert.equal(crossing.windows.every((window) => window.placement === "alternative"), true);
  assert.equal(localMinutes(crossing.windows[0].end, "Asia/Kolkata") > 12 * 60, true);
  assert.equal(daytime.status, "suitable_windows");
  assert.equal(daytime.windows[0].placement, "preferred");
});

test("the same instant follows the selected location timezone rather than UTC", () => {
  const instant = "2026-11-25T20:30:00.000Z";
  const hourly = [hour(0, { time: instant, aqi: 30, pm25: 8 })];
  const kolkata = preferenceSchedule({ timePreference: "daytime", hourly, now: instant, timezone: "Asia/Kolkata" });
  const newYork = preferenceSchedule({ timePreference: "daytime", hourly, now: instant, timezone: "America/New_York" });
  assert.equal(localMinutes(instant, "Asia/Kolkata"), 2 * 60);
  assert.equal(localMinutes(instant, "America/New_York"), 15 * 60 + 30);
  assert.notEqual(localMinutes(instant, "UTC"), localMinutes(instant, "Asia/Kolkata"));
  assert.equal(kolkata.status, "outside_preference");
  assert.equal(kolkata.windows[0].placement, "alternative");
  assert.equal(newYork.status, "suitable_windows");
  assert.equal(newYork.windows[0].placement, "preferred");
  assert.equal(newYork.windows[0].start, instant);
});

test("daylight-saving transitions do not move a preference boundary", () => {
  const earlyFall = "2026-11-01T05:30:00.000Z";
  const daytimeFall = "2026-11-01T18:00:00.000Z";
  const fallEarly = preferenceSchedule({
    timePreference: "daytime",
    timezone: "America/New_York",
    now: earlyFall,
    hourly: [hour(0, { time: earlyFall, aqi: 30, pm25: 8 })],
  });
  const fallDay = preferenceSchedule({
    timePreference: "daytime",
    timezone: "America/New_York",
    now: daytimeFall,
    hourly: [hour(0, { time: daytimeFall, aqi: 30, pm25: 8 })],
  });
  assert.equal(localMinutes(earlyFall, "America/New_York"), 90);
  assert.equal(fallEarly.status, "outside_preference");
  assert.equal(fallDay.status, "suitable_windows");
  assert.equal(fallDay.windows[0].placement, "preferred");

  const springEarly = "2026-03-08T06:30:00.000Z";
  const springMorning = "2026-03-08T10:00:00.000Z";
  const springOutside = preferenceSchedule({
    timePreference: "morning",
    timezone: "America/New_York",
    now: springEarly,
    hourly: [hour(0, { time: springEarly, aqi: 30, pm25: 8 })],
  });
  const springInside = preferenceSchedule({
    timePreference: "morning",
    timezone: "America/New_York",
    now: springMorning,
    hourly: [hour(0, { time: springMorning, aqi: 30, pm25: 8 })],
  });
  assert.equal(localMinutes(springEarly, "America/New_York"), 90);
  assert.equal(localMinutes(springMorning, "America/New_York"), 6 * 60);
  assert.equal(springOutside.status, "outside_preference");
  assert.equal(springInside.status, "suitable_windows");
  assert.equal(springInside.windows[0].placement, "preferred");

  const crossesEvening = preferenceSchedule({
    timePreference: "evening",
    timezone: "America/New_York",
    now: "2026-11-02T01:45:00.000Z",
    durationMinutes: 90,
    hourly: [0, 1].map((offset) => hour(0, { time: new Date(Date.parse("2026-11-02T01:45:00.000Z") + offset * HOUR).toISOString(), aqi: 30, pm25: 8 })),
  });
  assert.equal(localMinutes("2026-11-02T01:45:00.000Z", "America/New_York"), 20 * 60 + 45);
  assert.equal(localMinutes("2026-11-02T03:15:00.000Z", "America/New_York"), 22 * 60 + 15);
  assert.equal(crossesEvening.status, "outside_preference");
  assert.equal(crossesEvening.windows[0].placement, "alternative");
});

test("an invalid time preference does not invent a window", () => {
  const result = preferenceSchedule({
    timePreference: "night",
    now: kolkataLocal(9),
    hourly: [hour(0, { time: kolkataLocal(9), aqi: 25, pm25: 6 })],
  });
  assert.equal(result.status, "insufficient_data");
  assert.deepEqual(result.windows, []);
  assert.match(result.reason, /time preference/i);
});

test("an aging forecast remains available and discloses its freshness", () => {
  const result = schedule([hour(1), hour(2)], daily, 60, { issuedAt: new Date(NOW - 90 * 60 * 1000).toISOString() });
  assert.equal(result.status, "suitable_windows");
  assert.equal(result.forecastFreshness.state, "aging");
  assert.match(result.windows[0].limitations, /may not reflect current conditions/i);
});
