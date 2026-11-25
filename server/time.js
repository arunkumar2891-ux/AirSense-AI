const ISO_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

function finiteNonNegative(value) {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isFinite(number) && number >= 0 ? number : null;
}

// Open-Meteo is requested with timeformat=unixtime so DST transitions remain
// unambiguous. The local-time branch is retained for defensive compatibility
// and requires the provider's explicit UTC offset.
export function providerTimeToEpochMs(value, utcOffsetSeconds) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== "string" || !value.trim()) return null;

  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return providerTimeToEpochMs(Number(trimmed), utcOffsetSeconds);
  }
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(trimmed)) {
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const match = ISO_LOCAL_PATTERN.exec(trimmed);
  const offset = Number(utcOffsetSeconds);
  if (!match || !Number.isFinite(offset)) return null;
  const [, year, month, day, hour, minute, second = "0"] = match;
  const localAsUtc = Date.UTC(
    Number(year), Number(month) - 1, Number(day),
    Number(hour), Number(minute), Number(second),
  );
  const epochMs = localAsUtc - offset * 1000;
  return Number.isFinite(epochMs) ? epochMs : null;
}

export function providerTimeToIso(value, utcOffsetSeconds) {
  const epochMs = providerTimeToEpochMs(value, utcOffsetSeconds);
  return epochMs === null ? null : new Date(epochMs).toISOString();
}

export function selectCurrentAndFutureHours(hourly = {}, observedAt, utcOffsetSeconds, limit = 12) {
  const observedMs = providerTimeToEpochMs(observedAt, utcOffsetSeconds);
  if (observedMs === null || !Array.isArray(hourly.time)) return [];

  const rows = hourly.time.map((time, index) => ({
    epochMs: providerTimeToEpochMs(time, utcOffsetSeconds),
    index,
  })).filter((row) => row.epochMs !== null);

  // Include the current local-hour bucket, but no earlier bucket. Unix
  // timestamps make this correct even when DST skips or repeats a wall hour.
  const currentBucket = rows
    .filter((row) => row.epochMs <= observedMs && observedMs - row.epochMs < 60 * 60 * 1000)
    .at(-1);
  const threshold = currentBucket?.epochMs ?? observedMs;

  return rows
    .filter((row) => row.epochMs >= threshold)
    .slice(0, limit)
    .map(({ epochMs, index }) => ({
      time: new Date(epochMs).toISOString(),
      aqi: finiteNonNegative(hourly.us_aqi?.[index]),
      pm25: finiteNonNegative(hourly.pm2_5?.[index]),
      pm10: finiteNonNegative(hourly.pm10?.[index]),
    }));
}
