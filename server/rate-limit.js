export function createRateLimiter({ name, windowMs, max, maxBuckets = 5000 }) {
  const buckets = new Map();
  const safeWindowMs = Math.max(1000, Number(windowMs) || 60000);
  const safeMax = Math.max(1, Number(max) || 1);

  function middleware(req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    let bucket = buckets.get(ip);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + safeWindowMs };
      buckets.set(ip, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, safeMax - bucket.count);
    const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.set("RateLimit-Policy", `${safeMax};w=${Math.ceil(safeWindowMs / 1000)}`);
    res.set("RateLimit-Limit", String(safeMax));
    res.set("RateLimit-Remaining", String(remaining));
    res.set("RateLimit-Reset", String(resetSeconds));

    if (bucket.count > safeMax) {
      res.set("Retry-After", String(resetSeconds));
      return res.status(429).json({
        error: `Too many ${name} requests. Retry in ${resetSeconds}s.`,
      });
    }

    if (buckets.size > maxBuckets) {
      for (const [key, candidate] of buckets) {
        if (now >= candidate.resetAt) buckets.delete(key);
      }
      while (buckets.size > maxBuckets) buckets.delete(buckets.keys().next().value);
    }
    next();
  }

  return { middleware, buckets, windowMs: safeWindowMs, max: safeMax };
}
