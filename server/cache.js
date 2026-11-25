export class BoundedTTLCache {
  constructor({ maxEntries = 500, now = () => Date.now() } = {}) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
    this.now = now;
    this.entries = new Map();
    this.inflight = new Map();
  }

  get size() {
    this.deleteExpired();
    return this.entries.size;
  }

  clear() {
    this.entries.clear();
    this.inflight.clear();
  }

  deleteExpired() {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Map insertion order is the LRU order; refresh this entry's position.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs) {
    this.deleteExpired();
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      this.entries.delete(oldestKey);
    }
    this.entries.set(key, {
      value,
      expiresAt: this.now() + Math.max(1, Number(ttlMs) || 1),
    });
    return value;
  }

  async getOrLoad(key, ttlMs, loader) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    if (this.inflight.has(key)) return this.inflight.get(key);

    const request = Promise.resolve()
      .then(loader)
      .then((value) => this.set(key, value, ttlMs))
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return request;
  }
}

export function normalizeCoordinates(latitude, longitude, precision = 2) {
  const factor = 10 ** precision;
  const normalize = (value) => {
    const rounded = Math.round((Number(value) + Number.EPSILON) * factor) / factor;
    return Object.is(rounded, -0) ? 0 : rounded;
  };
  return { latitude: normalize(latitude), longitude: normalize(longitude) };
}
