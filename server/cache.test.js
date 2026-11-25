import test from "node:test";
import assert from "node:assert/strict";
import { BoundedTTLCache, normalizeCoordinates } from "./cache.js";

test("cache expires entries at TTL", () => {
  let now = 1000;
  const cache = new BoundedTTLCache({ maxEntries: 5, now: () => now });
  cache.set("a", 1, 100);
  assert.equal(cache.get("a"), 1);
  now = 1099;
  assert.equal(cache.get("a"), 1);
  now = 1100;
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.size, 0);
});

test("cache enforces maximum size and evicts least-recently-used entry", () => {
  const cache = new BoundedTTLCache({ maxEntries: 3 });
  cache.set("a", 1, 10000);
  cache.set("b", 2, 10000);
  cache.set("c", 3, 10000);
  assert.equal(cache.get("a"), 1); // a becomes most recently used
  cache.set("d", 4, 10000);
  assert.equal(cache.size, 3);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("d"), 4);
});

test("environmental coordinates normalize to approximately 1 km precision", () => {
  assert.deepEqual(normalizeCoordinates(17.384999, 78.486701), {
    latitude: 17.38,
    longitude: 78.49,
  });
  assert.deepEqual(normalizeCoordinates(17.381, 78.489), normalizeCoordinates(17.384, 78.491));
  assert.deepEqual(normalizeCoordinates(-0.001, -0.001), { latitude: 0, longitude: 0 });
});

test("concurrent identical loads share one upstream operation", async () => {
  const cache = new BoundedTTLCache({ maxEntries: 10 });
  let upstreamCalls = 0;
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const loader = async () => {
    upstreamCalls += 1;
    await wait;
    return { value: 42 };
  };

  const requests = Array.from({ length: 50 }, () => cache.getOrLoad("same-location", 10000, loader));
  await Promise.resolve();
  assert.equal(upstreamCalls, 1);
  release();
  const results = await Promise.all(requests);
  assert.equal(upstreamCalls, 1);
  assert.ok(results.every((result) => result.value === 42));
});

test("high-volume unique coordinates cannot grow cache beyond its bound", () => {
  const cache = new BoundedTTLCache({ maxEntries: 100 });
  for (let i = 0; i < 10000; i++) {
    const { latitude, longitude } = normalizeCoordinates(-50 + i * 0.01, 10 + i * 0.01);
    cache.set(`${latitude},${longitude}`, i, 600000);
  }
  assert.equal(cache.size, 100);
  assert.equal(cache.entries.has("-50,10"), false);
});
