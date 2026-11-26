// Deterministic place extraction. The model is not asked to invent or rewrite locations.
import { isUnrelatedClause, splitClauses } from "./gemini.js";
const PLACE_WORD = /^[\p{L}][\p{L}'’-]*$/u;
const NON_PLACE = new Set([
  "a", "an", "the", "today", "tomorrow", "tonight", "now", "currently", "please",
  "air", "airsense", "quality", "pollution", "pollutant", "pollutants", "aqi", "us", "pm",
  "weather", "wind", "humidity", "temperature", "running", "run", "cycling", "cycle",
  "outdoor", "outdoors", "outside", "walking", "walk", "exercise", "exercising", "suitable",
  "general", "this", "that", "these", "those", "my", "our", "your", "here", "there",
  "it", "is", "are", "was", "for", "to", "of", "on", "in", "at", "and", "or", "vs", "versus",
  "with", "from", "than", "better", "worse", "best", "worst", "level", "levels",
  "city", "cities", "place", "places", "location", "locations", "area", "areas",
  "how", "what", "which", "when", "where", "why", "does", "do", "did", "can", "could", "should",
  "compare", "comparison", "between", "among", "has", "have", "had",
  "current", "reading", "readings", "good", "bad", "safe", "safety",
  "children", "child", "adult", "adults", "people", "everyone",
]);

const MAX_PLACES = 4;

// Equivalent names sent to the geocoder. A result still has to match one of
// these names under the strict placeMatches rules. This is not fuzzy matching
// and it never accepts an unrelated top hit.
const CITY_ALIAS_GROUPS = [
  ["Bangalore", "Bengaluru"],
];

const NOT_A_PLACE_START = new Set([
  "write", "compose", "draft", "explain", "describe", "tell", "make", "create",
  "draw", "sketch", "summarize", "summarise", "translate", "please", "help",
  "give", "who", "what", "why", "how", "should", "could", "would", "can",
  "calculate", "solve", "code", "program", "invent", "generate",
]);

function isCityComparison(text) {
  if (/\b(?:compare|comparison|versus|vs\.?|which\s+(?:city|cities|place|places|location|locations))\b/i.test(text)) return true;
  return /\b(?:better|worse|best|worst)\b/i.test(text) && /\b(?:city|cities|between)\b/i.test(text);
}

function readWord(text, index) {
  const match = /^[\p{L}][\p{L}'’-]*/u.exec(text.slice(index));
  if (!match || !match[0]) return null;
  return { word: match[0], next: index + match[0].length };
}

function readPlace(text, index) {
  let cursor = index;
  const words = [];
  let start = -1;
  let end = index;
  if (!words.length) {
    const lead = /^\s+/.exec(text.slice(cursor));
    if (lead) cursor += lead[0].length;
  }
  while (words.length < 3) {
    if (words.length) {
      const gap = /^\s+/.exec(text.slice(cursor));
      if (!gap) break;
      cursor += gap[0].length;
    }
    const word = readWord(text, cursor);
    if (!word || !PLACE_WORD.test(word.word) || NON_PLACE.has(word.word.toLowerCase())) break;
    if (start < 0) start = cursor;
    words.push(word.word);
    end = word.next;
    cursor = end;
  }
  if (!words.length) return null;
  return { name: text.slice(start, end), next: end };
}

function orContinuesWithPlace(text, index) {
  const rest = text.slice(index).trim();
  if (!rest || isUnrelatedClause(rest)) return false;
  const word = readWord(rest, 0);
  if (!word || NOT_A_PLACE_START.has(word.word.toLowerCase())) return false;
  return Boolean(readPlace(text, index));
}

function readSeparator(text, index) {
  const match = /^\s*(?:,\s*(?:and|&|or)\s+|,\s*|and\s+|&\s+|or\s+|vs\.?\s+|versus\s+)/i.exec(text.slice(index));
  if (!match) return null;
  const next = index + match[0].length;
  if (/\bor\b/i.test(match[0]) && !orContinuesWithPlace(text, next)) return null;
  return next;
}

function parseList(text, index) {
  return consumeList(text, index).names;
}

function consumeList(text, index) {
  const names = [];
  let cursor = index;
  let end = index;
  while (names.length < 8) {
    const place = readPlace(text, cursor);
    if (!place) break;
    names.push(place.name);
    end = place.next;
    const next = readSeparator(text, place.next);
    if (next === null) break;
    cursor = next;
  }
  return { names, next: end };
}

function listsInText(text) {
  const names = [];
  let cursor = 0;
  while (cursor < text.length) {
    const lead = /^\s+/.exec(text.slice(cursor));
    if (lead) {
      cursor += lead[0].length;
      continue;
    }
    const list = consumeList(text, cursor);
    if (list.names.length >= 2) names.push(...list.names);
    const word = readWord(text, cursor);
    cursor = word ? Math.max(word.next, cursor + 1) : cursor + 1;
  }
  return names;
}

function textForPlaceExtraction(text) {
  const clauses = splitClauses(text);
  const kept = clauses.filter((clause) => !isUnrelatedClause(clause));
  if (!kept.length) return "";
  if (kept.length === clauses.length) return text;
  return kept.join(" and ");
}

function uniqueNames(names) {
  const seen = new Set();
  const unique = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  return unique;
}

export function extractLocationIntent(question) {
  const text = textForPlaceExtraction(String(question || "").replace(/\s+/g, " ").trim());
  const names = [];
  for (const match of text.matchAll(/\b(?:in|at|near|around)\s+/gi)) {
    names.push(...parseList(text, match.index + match[0].length));
  }
  for (const match of text.matchAll(/\bbetween\s+/gi)) {
    names.push(...parseList(text, match.index + match[0].length));
  }
  for (const match of text.matchAll(/\b(?:is|are)\s+/gi)) {
    const place = readPlace(text, match.index + match[0].length);
    if (place && /^\s+suitable\b/i.test(text.slice(place.next))) names.push(place.name);
  }
  names.push(...listsInText(text));
  const comparison = isCityComparison(text);
  if (comparison && names.length === 0) {
    const compareAt = /\bcompare\b/i.exec(text);
    if (compareAt) names.push(...parseList(text, compareAt.index + compareAt[0].length));
  }
  const unique = uniqueNames(names);
  if (comparison && unique.length < 2) {
    return { kind: "clarify", reason: "comparison", names: unique };
  }
  if (!unique.length) return { kind: "selected", comparison: false, names: [] };
  return {
    kind: "named",
    comparison: comparison || unique.length > 1,
    names: unique.slice(0, MAX_PLACES),
    extra: unique.slice(MAX_PLACES),
  };
}

function normalizePlace(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

// Accepted alias policy. A query matches a geocoder result only when one of
// these is true after lowercasing and stripping punctuation:
// - the names are equal ("Delhi" and "Delhi");
// - one name is the other name plus further words ("New Delhi" starts a longer
//   "New Delhi Division", or the query starts with the full result name);
// - every word of one name occurs in the other ("Delhi" matches "New Delhi"
//   because the result contains every query word).
// A different name with no shared words, such as "Zzxq" and "Wrong City",
// does not match. There is no fallback to the first geocoder hit.
function placeMatches(query, name) {
  if (!query || !name) return false;
  if (query === name) return true;
  const queryTokens = query.split(" ");
  const nameTokens = name.split(" ");
  if (name.startsWith(`${query} `) || query.startsWith(`${name} `)) return true;
  return queryTokens.every((token) => nameTokens.includes(token)) || nameTokens.every((token) => queryTokens.includes(token));
}

export function placeNamesMatch(left, right) {
  return placeMatches(normalizePlace(left), normalizePlace(right));
}

export function geocodeQueries(name) {
  const original = String(name || "").trim();
  const key = normalizePlace(original);
  const group = CITY_ALIAS_GROUPS.find((names) => names.some((item) => normalizePlace(item) === key));
  const forms = [];
  const seen = new Set();
  for (const form of [original, ...(group || [])]) {
    const normalized = normalizePlace(form);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    forms.push(String(form).trim());
  }
  return forms;
}

function matchNeedles(query) {
  return geocodeQueries(query).map((form) => normalizePlace(form)).filter(Boolean);
}

function distanceKm(left, right) {
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(right.latitude - left.latitude);
  const dLon = toRad(right.longitude - left.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(left.latitude)) * Math.cos(toRad(right.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sameArea(left, right) {
  if (left.country && right.country && left.country !== right.country) return false;
  return distanceKm(left, right) <= 100;
}

function populationOf(place) {
  return Number.isFinite(place.population) ? place.population : null;
}

function runnerUpCompetes(primary, other) {
  const first = populationOf(primary);
  const second = populationOf(other);
  if (first === null || second === null) return true;
  if (second < 20000 && first > second * 10) return false;
  return second >= first * 0.15;
}

function publicCandidate(place) {
  return {
    name: place.name,
    region: place.region || "",
    country: place.country || "",
  };
}

export function judgeGeocode(query, results) {
  const usable = (Array.isArray(results) ? results : []).filter((place) =>
    place && typeof place.name === "string" && place.name.trim()
    && Number.isFinite(Number(place.latitude)) && Number.isFinite(Number(place.longitude))
    && Math.abs(Number(place.latitude)) <= 90 && Math.abs(Number(place.longitude)) <= 180
  ).map((place) => ({
    name: place.name.trim(),
    region: place.region ? String(place.region) : "",
    country: place.country ? String(place.country) : "",
    latitude: Number(place.latitude),
    longitude: Number(place.longitude),
    population: Number.isFinite(Number(place.population)) ? Number(place.population) : null,
  }));
  if (!usable.length) return { status: "unresolved" };
  const needles = matchNeedles(query);
  const matched = usable.filter((place) => needles.some((needle) => placeMatches(needle, normalizePlace(place.name))));
  if (!matched.length) {
    return { status: "unresolved", candidates: usable.slice(0, 4).map(publicCandidate) };
  }
  const pool = matched;
  const ordered = [...pool].sort((left, right) => (populationOf(right) || 0) - (populationOf(left) || 0));
  const distinct = [];
  for (const place of ordered) {
    if (distinct.some((kept) => sameArea(kept, place))) continue;
    distinct.push(place);
  }
  const competing = distinct.filter((place, index) => index === 0 || runnerUpCompetes(distinct[0], place));
  if (competing.length > 1) {
    return { status: "ambiguous", candidates: competing.slice(0, 4).map(publicCandidate) };
  }
  const chosen = distinct[0];
  return {
    status: "resolved",
    place: {
      name: chosen.name,
      region: chosen.region,
      country: chosen.country,
      latitude: chosen.latitude,
      longitude: chosen.longitude,
    },
  };
}

export function placeLabel(place) {
  if (!place) return "";
  return [place.name, place.region, place.country].filter(Boolean).join(", ").replace(/[\u0000-\u001f]/g, " ").slice(0, 160);
}

function locationHeadline(location) {
  return location.name ? placeLabel(location) : location.query;
}

function exclusionReason(location) {
  if (location.status === "unresolved") return `${location.query} could not be resolved, so it was not compared.`;
  if (location.status === "ambiguous") return `${location.query} matches more than one place, so it was not compared.`;
  if (location.status === "geocoding_unavailable") return `${location.query} could not be searched, so it was not compared.`;
  if (location.status === "environment_data_unavailable" || location.status === "unavailable") {
    return `${location.query} has no current air-quality reading, so it was not compared.`;
  }
  if (location.decision?.activityRecommendation === "insufficient_data" || location.decision?.trace?.scoringApplied === false) {
    return `${locationHeadline(location)} is not fresh enough to compare as a current reading.`;
  }
  return `${location.query} was not compared.`;
}

export function buildComparison(locations) {
  const fresh = locations.filter((location) =>
    location.status === "ready"
    && location.aqi !== null
    && location.aqi !== undefined
    && location.decision?.trace?.scoringApplied === true
    && location.decision?.activityRecommendation !== "insufficient_data"
  );
  const excluded = locations.filter((location) => !fresh.includes(location));
  if (fresh.length < 2) {
    return {
      compared: fresh.map((location) => location.query),
      excluded: excluded.map((location) => ({ query: location.query, reason: exclusionReason(location) })),
      lowestReportedAqi: null,
      tied: false,
      statement: "A current comparison needs at least two locations with fresh US AQI data. Stale, ambiguous, and unavailable readings were not ranked.",
    };
  }
  const sorted = [...fresh].sort((left, right) => left.aqi - right.aqi || locationHeadline(left).localeCompare(locationHeadline(right)));
  const lowest = sorted[0].aqi;
  const leaders = sorted.filter((location) => location.aqi === lowest);
  const tied = leaders.length > 1;
  const leaderText = leaders.map(locationHeadline).join(" and ");
  const others = sorted.filter((location) => location.aqi !== lowest).map((location) => `${locationHeadline(location)} (${location.aqi})`).join(", ");
  const statement = tied
    ? `${leaderText} have the same reported US AQI (${lowest}). This compares reported US AQI only. It is not an activity recommendation for every person.`
    : `${leaderText} has the lowest reported US AQI in this comparison (${lowest})${others ? `, compared with ${others}` : ""}. A lower US AQI is not an activity recommendation for every person. Activity suitability is assessed separately for the selected profile.`;
  return {
    compared: fresh.map((location) => location.query),
    excluded: excluded.map((location) => ({ query: location.query, reason: exclusionReason(location) })),
    lowestReportedAqi: tied ? null : { query: leaders[0].query, aqi: lowest, name: leaders[0].name },
    tied,
    statement,
  };
}

function readingLine(location) {
  const label = locationHeadline(location);
  if (location.status === "ambiguous") {
    const choices = (location.candidates || []).map((candidate) => placeLabel(candidate)).filter(Boolean).join("; ");
    return `${location.query} matches more than one place. ${choices ? `Choose one: ${choices}.` : "Add a region or country."}`;
  }
  if (location.status === "unresolved") {
    const choices = (location.candidates || []).map((candidate) => placeLabel(candidate)).filter(Boolean).join("; ");
    const base = `${location.query} could not be resolved to a place. No air-quality reading was substituted.`;
    return choices ? `${base} These results did not match the name closely enough to use: ${choices}.` : base;
  }
  if (location.status === "geocoding_unavailable") {
    return `${location.query} could not be checked because location search is temporarily unavailable. No air-quality reading was substituted.`;
  }
  if (location.status === "environment_data_unavailable") {
    return `${label} was resolved, but its air-quality data is unavailable. No other city's reading was substituted.`;
  }
  if (location.status === "unavailable") return `${location.query} was not fetched. No other city's reading was substituted.`;
  const aqi = location.aqi === null || location.aqi === undefined ? "unavailable" : location.aqi;
  const pm = location.pm25 === null || location.pm25 === undefined ? "unavailable" : `${location.pm25} µg/m³`;
  const weather = location.weatherAvailable ? "weather was retrieved" : "weather was unavailable and was not treated as favorable";
  const recommendation = location.decision?.activityRecommendation?.replaceAll("_", " ") || "unavailable";
  return `${label}: reported US AQI ${aqi}; PM2.5 ${pm}; ${weather}; profile recommendation ${recommendation}.`;
}

export function describeLocationAnswer(locations, comparison) {
  const lines = locations.map(readingLine);
  if (comparison) lines.unshift(comparison.statement);
  return lines.join(" ");
}

export function clarificationAnswer(intent) {
  if (intent.reason === "comparison" && intent.names?.length === 1) {
    return `Name at least one more place to compare with ${intent.names[0]}. I will not compare it with the currently selected location unless you name that place too.`;
  }
  return "Name the places you want compared, for example Delhi and Bengaluru. I will not guess them from the currently selected location.";
}
