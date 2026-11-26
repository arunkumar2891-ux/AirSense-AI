import { providerTimeToEpochMs, providerTimeToIso } from "./time.js";

// Conservative bounding envelope around Open-Meteo's CAMS Europe domain
// (grid lat 30.05..71.95, lon -24.95..44.95). Outside this envelope, Open-Meteo
// has no CAMS Europe coverage and serves particulate/gas air-quality forecasts
// exclusively from CAMS global (~0.4°, approx. 45 km nominal resolution).
const CAMS_EUROPE_ENVELOPE = Object.freeze({
  minLat: 29.5,
  maxLat: 72.5,
  minLon: -25.5,
  maxLon: 45.5,
});

// Float32 serialization in Open-Meteo can vary by ~1e-5 degrees for the same
// grid point; 1e-4 degrees (~11 m) safely absorbs float noise while keeping
// distinct 0.1-degree (~11 km) serving cells separate.
const SAME_CELL_TOLERANCE_DEGREES = 1e-4;

export const DOCUMENTED_MODELS = Object.freeze({
  cams_global: Object.freeze({
    id: "cams_global",
    name: "CAMS global model",
    nominalDegrees: 0.4,
    approximateKm: 45,
    label: "Approx. 45 km nominal resolution",
    servingCellBehavior: "Live provider serving coordinates may snap to ~0.1° grid steps; serving-cell snapping is not the official ~0.4° (~45 km) CAMS global model resolution.",
  }),
  cams_europe: Object.freeze({
    id: "cams_europe",
    name: "CAMS European model",
    nominalDegrees: 0.1,
    approximateKm: 11,
    label: "Approx. 11 km nominal resolution",
    servingCellBehavior: "Documented CAMS European model grid is ~0.1° (~11 km) nominal resolution and does not represent street-level or station readings.",
  }),
});

const GENUINE_INIT_TIME_KEYS = [
  "model_initialized_at",
  "model_run_time",
  "forecast_issued_at",
  "initialization_time",
  "init_time",
];

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteCoordinate(value, limit) {
  const number = finiteNumber(value);
  return number !== null && Math.abs(number) <= limit ? number : null;
}

function normalizeCellKeyPart(value) {
  const rounded = Math.round(value * 10000) / 10000;
  const zeroSafe = Object.is(rounded, -0) ? 0 : rounded;
  return zeroSafe.toFixed(4);
}

export function extractProviderCell(air) {
  if (!air || typeof air !== "object") return null;
  const latitude = finiteCoordinate(air.latitude, 90);
  const longitude = finiteCoordinate(air.longitude, 180);
  if (latitude === null || longitude === null) return null;
  const elevationMeters = finiteNumber(air.elevation);
  return {
    latitude,
    longitude,
    elevationMeters,
    cellKey: `${normalizeCellKeyPart(latitude)},${normalizeCellKeyPart(longitude)}`,
  };
}

function unwrapProviderCell(input) {
  if (!input || typeof input !== "object") return null;
  const cell = input.metadata?.providerCell ?? input.providerCell ?? input;
  const latitude = finiteCoordinate(cell?.latitude, 90);
  const longitude = finiteCoordinate(cell?.longitude, 180);
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

export function areSameProviderCell(left, right) {
  const a = unwrapProviderCell(left);
  const b = unwrapProviderCell(right);
  if (!a || !b) return null;
  return Math.abs(a.latitude - b.latitude) <= SAME_CELL_TOLERANCE_DEGREES
    && Math.abs(a.longitude - b.longitude) <= SAME_CELL_TOLERANCE_DEGREES;
}

export function describeCellComparison(left, right) {
  const sameProviderCell = areSameProviderCell(left, right);
  if (sameProviderCell === null) {
    return {
      sameProviderCell: null,
      distinctEnvironmentalDataProven: false,
      note: "Provider grid cell coordinates are unavailable for comparison.",
    };
  }
  if (sameProviderCell) {
    return {
      sameProviderCell: true,
      distinctEnvironmentalDataProven: false,
      note: "Both locations resolved to the same provider grid cell.",
    };
  }
  return {
    sameProviderCell: false,
    distinctEnvironmentalDataProven: false,
    note: "Provider serving coordinates differ, which does not by itself prove independent neighborhood-level data when nominal model resolution is coarser.",
  };
}

export function isInsideCamsEuropeEnvelope(latitude, longitude) {
  return latitude >= CAMS_EUROPE_ENVELOPE.minLat
    && latitude <= CAMS_EUROPE_ENVELOPE.maxLat
    && longitude >= CAMS_EUROPE_ENVELOPE.minLon
    && longitude <= CAMS_EUROPE_ENVELOPE.maxLon;
}

export function extractGenuineModelInitTime(air) {
  if (!air || typeof air !== "object") return null;
  for (const key of GENUINE_INIT_TIME_KEYS) {
    if (air[key] === undefined || air[key] === null || air[key] === "") continue;
    const iso = providerTimeToIso(air[key], air.utc_offset_seconds);
    if (iso !== null) return iso;
  }
  return null;
}

export function formatModelRunAge(modelInitializedAt, now = Date.now()) {
  const initMs = providerTimeToEpochMs(modelInitializedAt);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (initMs === null || !Number.isFinite(nowMs)) {
    return { available: false, ageMs: null, label: "Model run age unavailable" };
  }
  const ageMs = nowMs - initMs;
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return { available: false, ageMs: null, label: "Model run age unavailable" };
  }
  const minutes = Math.round(ageMs / 60000);
  if (minutes < 60) {
    return { available: true, ageMs, label: `Model run ${minutes} min ago` };
  }
  const hours = Math.round(ageMs / 3600000);
  return { available: true, ageMs, label: `Model run ${hours}h ago` };
}

function resolveModelAndResolution(air, providerCell) {
  const rawModel = typeof air?.model === "string" && air.model.trim()
    ? air.model.trim()
    : typeof air?.domain === "string" && air.domain.trim()
      ? air.domain.trim()
      : null;

  if (rawModel) {
    const known = DOCUMENTED_MODELS[rawModel.toLowerCase()];
    if (known) {
      return {
        model: {
          id: known.id,
          name: known.name,
          providerSupplied: true,
          basis: "provider_response",
        },
        spatialResolution: {
          nominalDegrees: known.nominalDegrees,
          approximateKm: known.approximateKm,
          verified: true,
          label: known.label,
          servingCellBehavior: known.servingCellBehavior,
        },
      };
    }
    return {
      model: {
        id: rawModel,
        name: rawModel,
        providerSupplied: true,
        basis: "provider_response_unrecognized",
      },
      spatialResolution: {
        nominalDegrees: null,
        approximateKm: null,
        verified: false,
        label: null,
        servingCellBehavior: null,
      },
    };
  }

  if (!providerCell) {
    return {
      model: {
        id: null,
        name: null,
        providerSupplied: false,
        basis: "missing_provider_metadata",
      },
      spatialResolution: {
        nominalDegrees: null,
        approximateKm: null,
        verified: false,
        label: null,
        servingCellBehavior: null,
      },
    };
  }

  if (!isInsideCamsEuropeEnvelope(providerCell.latitude, providerCell.longitude)) {
    const globalModel = DOCUMENTED_MODELS.cams_global;
    return {
      model: {
        id: globalModel.id,
        name: globalModel.name,
        providerSupplied: false,
        basis: "documented_outside_cams_europe_coverage",
      },
      spatialResolution: {
        nominalDegrees: globalModel.nominalDegrees,
        approximateKm: globalModel.approximateKm,
        verified: true,
        label: globalModel.label,
        servingCellBehavior: globalModel.servingCellBehavior,
      },
    };
  }

  return {
    model: {
      id: null,
      name: null,
      providerSupplied: false,
      basis: "unverified_auto_domain",
    },
    spatialResolution: {
      nominalDegrees: null,
      approximateKm: null,
      verified: false,
      label: null,
      servingCellBehavior: "Open-Meteo auto-domain may combine CAMS European (~0.1°) and CAMS global (~0.4°) models without identifying which domain served this response.",
    },
  };
}

export function buildForecastMetadata({ air, retrievedAt = null, now = Date.now() } = {}) {
  const providerCell = extractProviderCell(air);
  const forecastValidAt = providerTimeToIso(air?.current?.time, air?.utc_offset_seconds);
  const modelInitializedAt = extractGenuineModelInitTime(air);
  const retrievedAtIso = providerTimeToIso(retrievedAt);
  const { model, spatialResolution } = resolveModelAndResolution(air, providerCell);
  const modelRunAge = formatModelRunAge(modelInitializedAt, now);

  const disclosure = spatialResolution.verified && model.name && spatialResolution.label
    ? `Modelled air-quality estimate · ${model.name} · ${spatialResolution.label}.`
    : "Modelled air-quality estimate · Open-Meteo / CAMS · Not a local station observation.";

  return {
    dataClass: "modelled_estimate",
    isModelledEstimate: true,
    isStationObservation: false,
    provider: "Open-Meteo",
    providerCell,
    model,
    spatialResolution,
    timestamps: {
      forecastValidAt,
      modelInitializedAt,
      retrievedAt: retrievedAtIso,
    },
    modelRunAge,
    disclosure,
    accuracyNotice: "Modelled atmospheric estimate, not a local or neighborhood monitoring station observation.",
  };
}
