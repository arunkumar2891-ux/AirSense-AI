import test from "node:test";
import assert from "node:assert/strict";

// Set test env BEFORE importing the app module.
process.env.NODE_ENV = "test";

// Save the real fetch to use for HTTP calls to our own test server.
const REAL_FETCH = globalThis.fetch;

// Track Open-Meteo calls made by the app (which go through global fetch).
let upstreamCalls = [];

// Wrap global fetch: real fetch for localhost, mock for upstream Open-Meteo.
globalThis.fetch = async (url, options) => {
  const u = String(url);
  if (u.includes("127.0.0.1") || u.includes("localhost")) {
    return REAL_FETCH(url, options);
  }
  upstreamCalls.push(u);
  if (u.includes("air-quality-api.open-meteo.com")) {
    return {
      ok: true,
      json: async () => ({
        current: {
          time: "2026-11-25T15:00",
          us_aqi: 172, // authoritative server-side value
          pm2_5: 55.4, pm10: 88.1, ozone: 40.2,
          nitrogen_dioxide: 21.0, carbon_monoxide: 300.0, sulphur_dioxide: 5.1,
        },
        hourly: { time: ["2026-11-25T15:00"], us_aqi: [172], pm2_5: [55.4], pm10: [88.1] },
        timezone: "Asia/Kolkata",
      }),
    };
  }
  // Weather endpoint
  return { ok: true, json: async () => ({ current: { temperature_2m: 28 } }) };
};

const { app, rateBuckets } = await import("./index.js");

function request(appInstance, { method = "GET", url, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const server = appInstance.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      REAL_FETCH(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.10", ...headers },
        body: body ? JSON.stringify(body) : undefined,
      })
        .then(async (res) => {
          const text = await res.text();
          server.close();
          resolve({ status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

test.beforeEach(() => {
  upstreamCalls = [];
  rateBuckets.clear();
});

test.after(() => {
  globalThis.fetch = REAL_FETCH;
});

test("assistant rejects invalid coordinates", async () => {
  const res = await request(app, {
    method: "POST", url: "/api/assistant",
    body: { question: "Is it safe to run?", profile: {}, latitude: 999, longitude: 77 },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /latitude and longitude/i);
});

test("assistant rejects non-numeric coordinates", async () => {
  const res = await request(app, {
    method: "POST", url: "/api/assistant",
    body: { question: "Is it safe to run?", profile: {}, latitude: "abc", longitude: 77 },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /latitude and longitude/i);
});

test("assistant rejects invalid profile activity (allowlist)", async () => {
  const res = await request(app, {
    method: "POST", url: "/api/assistant",
    body: { question: "Is it safe to run?", profile: { activity: "skateboarding", ageGroup: "adult", sensitivity: "general" }, latitude: 17.385, longitude: 78.4867 },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /activity/i);
});

test("assistant rejects question over 1200 chars", async () => {
  const res = await request(app, {
    method: "POST", url: "/api/assistant",
    body: { question: "x".repeat(1201), profile: {}, latitude: 17.385, longitude: 78.4867 },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /1200/);
});

test("assistant uses server-fetched AQI, not client-supplied fake AQI", async () => {
  const res = await request(app, {
    method: "POST", url: "/api/assistant",
    body: {
      question: "Can I go for a run?",
      profile: { activity: "running", ageGroup: "adult", sensitivity: "general" },
      latitude: 17.385, longitude: 78.4867,
      air: { aqi: 12, aqiScale: "US AQI", pollutants: { pm25: 1 } }, // attacker-forged
    },
  });
  assert.equal(res.status, 200);
  // Server mock returns us_aqi 172; client tried 12. Context must reflect 172.
  assert.equal(res.body.context.aqi, 172);
  assert.match(res.body.answer, /172/);
  assert.ok(upstreamCalls.some((u) => u.includes("air-quality-api.open-meteo.com")), "server fetched Open-Meteo");
});

test("air-quality endpoint returns consistent JSON error on bad coords", async () => {
  const res = await request(app, { method: "GET", url: "/api/air-quality?lat=999&lon=77" });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /latitude and longitude/i);
});

test("rate limit returns 429 after configured max", async () => {
  let last;
  for (let i = 0; i < 21; i++) {
    last = await request(app, {
      method: "POST", url: "/api/assistant",
      headers: { "x-forwarded-for": "203.0.113.50" },
      body: { question: "Is the air ok?", profile: {}, latitude: 17.385, longitude: 78.4867 },
    });
  }
  assert.equal(last.status, 429);
  assert.match(last.body.error, /too many/i);
  assert.ok(last.headers.get("retry-after"));
});
