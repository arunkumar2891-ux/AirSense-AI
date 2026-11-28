import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowUpRight, Bot, Clock, Cloud, Compass, Crosshair, Leaf, MapPin, MessageCircle, RefreshCw, Search, Send, ShieldCheck, Users, Wind, X } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { askAssistant, findGoWindow, getAirQuality, requestFamilyPlan, reverseGeocode, searchLocations } from "./api";
import type { AirData, AssistantLocation, DecisionTrace, ExposureDecision, FamilyPlanResponse, GoWindowResponse, GoWindowTimePreference, LocationResult, Profile, WindHypothetical } from "./types";
import { describeCurrentActivityGuidance, describeWindUse, formatReportedWindSpeed, formatSourceDisclosure, formatTimingDisclosure, getAqiPresentation, getFreshnessPresentation, isLatestRequest, shouldApplyGpsResult, US_AQI_CATEGORIES } from "./reliability";
import { buildGoWindowRequest, DEFAULT_GO_WINDOW_DURATION, DEFAULT_TIME_PREFERENCE, goWindowRequestKey } from "./gowindow";
import { FAMILY_STORAGE_KEY, buildFamilyPlanRequest, canApplyFamilyExplanation, canStartFamilyExplanation, defaultFamilyHousehold, familyPlanForDisplay, familyPlanRequestKey, readStoredHousehold, serializeFamilyHousehold, type FamilyDraft } from "./family";
import { expandSection, readSectionExpanded, sectionFromHash, toggleSection, writeSectionExpanded, type SectionId } from "./sections";
import GoWindowPanel from "./GoWindowPanel";
import PlannerModePicker from "./PlannerModePicker";
import { LEGACY_PLANNER_MODE_KEY, plannerModeForSection, plannerSectionForMode, type PlannerMode } from "./planner-mode";
import FamilyPanel from "./FamilyPanel";
import CollapsibleSection from "./CollapsibleSection";
import BackToTop from "./BackToTop";
import ThemeSelector from "./ThemeSelector";
import { GPS_LOCATION_KEY, MANUAL_LOCATION_KEY, locationForSession, readStoredLocation } from "./location-session";
import { readPreference, removePreference, writePreference } from "./browser-store";
import { GO_WINDOW_SETTINGS_KEY, isDefaultGoWindowSettings, readGoWindowSettings, serializeGoWindowSettings } from "./gowindow-settings";

const fallbackCity = { name: "Chennai, Tamil Nadu, India", lat: 13.0827, lon: 80.2707 };
const prompts = ["Why does PM2.5 matter?", "What precautions should children take?", "Explain today's pollution levels", "How does wind affect outdoor pollution?"];

// The saved place, household, and GoWindow settings stay in this browser until
// the user clears them. Open and closed sections stay with the tab.
const KEY_GEO_ASKED = "airsense.geoAsked";

function initialHousehold(): FamilyDraft {
  try {
    return readStoredHousehold(readPreference(localStorage, sessionStorage, FAMILY_STORAGE_KEY));
  } catch {
    return defaultFamilyHousehold();
  }
}

function initialGoWindow() {
  const fallback = {
    profile: { activity: "running", ageGroup: "adult", sensitivity: "general" } as Profile,
    durationMinutes: DEFAULT_GO_WINDOW_DURATION,
    timePreference: DEFAULT_TIME_PREFERENCE,
  };
  try {
    return readGoWindowSettings(readPreference(localStorage, sessionStorage, GO_WINDOW_SETTINGS_KEY));
  } catch {
    return fallback;
  }
}

function rememberGeoAsked() {
  writePreference(localStorage, sessionStorage, KEY_GEO_ASKED, "1");
}

type LocSource = "gps" | "manual" | "default";
type LocState = { lat: number; lon: number; label: string; source: LocSource };

function formatAtLocation(value: string, timezone: string, options: Intl.DateTimeFormatOptions) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unavailable";
  try {
    return date.toLocaleTimeString([], { ...options, timeZone: timezone });
  } catch {
    return date.toLocaleTimeString([], { ...options, timeZone: "UTC", timeZoneName: "short" });
  }
}

function formatDateAtLocation(timezone?: string) {
  try {
    return new Date().toLocaleDateString([], {
      weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: timezone,
    }).toUpperCase();
  } catch {
    return new Date().toLocaleDateString([], {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    }).toUpperCase();
  }
}

function capitalizeSentence(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function formatWeatherValue(value: number | string | null | undefined, unit: string) {
  if (value === null || value === undefined || value === "") return "N/A";
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number)}${unit}` : "N/A";
}

function App() {
  const [loc, setLoc] = useState<LocState>({ lat: fallbackCity.lat, lon: fallbackCity.lon, label: fallbackCity.name, source: "default" });
  const [air, setAir] = useState<AirData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<Profile>(() => initialGoWindow().profile);
  const [question, setQuestion] = useState("");
  const [askedQuestion, setAskedQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [evidence, setEvidence] = useState<string[]>([]);
  const [hypothetical, setHypothetical] = useState<WindHypothetical | null>(null);
  const [thinking, setThinking] = useState(false);
  const [mode, setMode] = useState("");
  const [decision, setDecision] = useState<ExposureDecision | null>(null);
  const [locations, setLocations] = useState<AssistantLocation[]>([]);
  const [assistantError, setAssistantError] = useState("");
  const [duration, setDuration] = useState(() => initialGoWindow().durationMinutes);
  const [timePreference, setTimePreference] = useState<GoWindowTimePreference>(() => initialGoWindow().timePreference);
  const [schedule, setSchedule] = useState<GoWindowResponse | null>(null);
  const [scheduleKey, setScheduleKey] = useState("");
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [household, setHousehold] = useState<FamilyDraft>(initialHousehold);
  const [familyPlan, setFamilyPlan] = useState<FamilyPlanResponse | null>(null);
  const [familyPlanKey, setFamilyPlanKey] = useState("");
  const [familyLoading, setFamilyLoading] = useState(false);
  const [familyError, setFamilyError] = useState("");
  const [familyExplainLoading, setFamilyExplainLoading] = useState(false);
  const [familyExplainError, setFamilyExplainError] = useState("");
  const [familyExplanation, setFamilyExplanation] = useState<FamilyPlanResponse["explanation"] | null>(null);
  const [sections, setSections] = useState(() => {
    try { return readSectionExpanded(sessionStorage); } catch { return readSectionExpanded(null); }
  });
  const [plannerMode, setPlannerMode] = useState<PlannerMode | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());

  function choosePlannerMode(mode: PlannerMode) {
    openDashboardSection(plannerSectionForMode(mode));
  }

  function toggleDashboardSection(id: SectionId) {
    setSections((current) => {
      const next = toggleSection(current, id);
      try { writeSectionExpanded(sessionStorage, next); } catch { /* keep the choice for this render */ }
      return next;
    });
  }

  function openDashboardSection(id: SectionId) {
    const mode = plannerModeForSection(id);
    if (mode) setPlannerMode(mode);
    setSections((current) => {
      const next = expandSection(current, id);
      if (next === current) return current;
      try { writeSectionExpanded(sessionStorage, next); } catch { /* keep the choice for this render */ }
      return next;
    });
  }

  useEffect(() => {
    removePreference(localStorage, sessionStorage, LEGACY_PLANNER_MODE_KEY);
  }, []);

  useEffect(() => {
    const openHashedSection = () => {
      const id = sectionFromHash(window.location.hash);
      if (id) openDashboardSection(id);
    };
    openHashedSection();
    window.addEventListener("hashchange", openHashedSection);
    return () => window.removeEventListener("hashchange", openHashedSection);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Location UX state
  const [showGeoBanner, setShowGeoBanner] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoNotice, setGeoNotice] = useState("");
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<LocationResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const locationRevisionRef = useRef(0);
  const gpsRequestRef = useRef(0);
  const airRequestRef = useRef(0);
  const airAbortRef = useRef<AbortController | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const assistantRequestRef = useRef(0);
  const assistantAbortRef = useRef<AbortController | null>(null);
  const assistantResultRef = useRef<HTMLDivElement | null>(null);
  const goWindowRequestRef = useRef(0);
  const goWindowAbortRef = useRef<AbortController | null>(null);
  const goWindowPendingRef = useRef(false);
  const familyRequestRef = useRef(0);
  const familyAbortRef = useRef<AbortController | null>(null);
  const familyPendingRef = useRef(false);
  const familyExplainPendingRef = useRef(false);

  async function refresh(lat = loc.lat, lon = loc.lon) {
    const requestId = ++airRequestRef.current;
    airAbortRef.current?.abort();
    const controller = new AbortController();
    airAbortRef.current = controller;
    setLoading(true); setError(""); setAir(null);
    try {
      const data = await getAirQuality(lat, lon, controller.signal);
      if (isLatestRequest(requestId, airRequestRef.current)) setAir(data);
    } catch (e) {
      if (controller.signal.aborted) return;
      if (isLatestRequest(requestId, airRequestRef.current)) {
        setError(e instanceof Error ? e.message : "Unable to load environmental data.");
      }
    } finally {
      if (isLatestRequest(requestId, airRequestRef.current)) setLoading(false);
    }
  }

  function applyLocation(next: LocState, persist: boolean) {
    locationRevisionRef.current += 1;
    gpsRequestRef.current += 1;
    setGeoBusy(false);
    setLoc(next);
    assistantAbortRef.current?.abort();
    setAnswer(""); setAssistantError(""); setDecision(null); setMode("");
    if (persist) {
      try {
        if (next.source === "gps") {
          writePreference(localStorage, sessionStorage, GPS_LOCATION_KEY, JSON.stringify(next));
          removePreference(localStorage, sessionStorage, MANUAL_LOCATION_KEY);
        }
        if (next.source === "manual") writePreference(localStorage, sessionStorage, MANUAL_LOCATION_KEY, JSON.stringify(next));
      } catch { /* storage unavailable — the place stays in memory */ }
    }
    refresh(next.lat, next.lon);
  }

  async function labelGpsLocation(lat: number, lon: number): Promise<string> {
    try {
      const { label } = await reverseGeocode(lat, lon);
      return label;
    } catch {
      // Geocoding failure must never block data — fall back to a generic, honest label.
      return "Your location";
    }
  }

  function requestGps() {
    if (!navigator.geolocation) { setGeoNotice("Location is not supported by this browser. Search for a city instead."); setShowGeoBanner(false); return; }
    const requestId = ++gpsRequestRef.current;
    const startedRevision = locationRevisionRef.current;
    setGeoBusy(true); setGeoNotice("");
    try { rememberGeoAsked(); } catch { /* ignore */ }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        const label = await labelGpsLocation(lat, lon);
        if (!shouldApplyGpsResult(startedRevision, locationRevisionRef.current, requestId, gpsRequestRef.current)) return;
        setGeoBusy(false); setShowGeoBanner(false);
        applyLocation({ lat, lon, label, source: "gps" }, true);
      },
      (err) => {
        if (!shouldApplyGpsResult(startedRevision, locationRevisionRef.current, requestId, gpsRequestRef.current)) return;
        setGeoBusy(false); setShowGeoBanner(false);
        const retained = loc.source === "default" ? "Showing the default city, Chennai" : "Keeping your selected location";
        if (err.code === err.PERMISSION_DENIED) setGeoNotice(`Location permission was declined. ${retained} — search for any place above.`);
        else if (err.code === err.TIMEOUT) setGeoNotice(`Location request timed out. ${retained} — search for any place above.`);
        else setGeoNotice(`Your position is currently unavailable. ${retained} — search for any place above.`);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }

  function returnToGps() {
    const saved = readStoredLocation(localStorage, sessionStorage, GPS_LOCATION_KEY);
    if (saved) {
      removePreference(localStorage, sessionStorage, MANUAL_LOCATION_KEY);
      applyLocation({ ...saved, source: "gps" }, false);
      return;
    }
    requestGps();
  }

  function clearSavedPlace() {
    removePreference(localStorage, sessionStorage, GPS_LOCATION_KEY);
    removePreference(localStorage, sessionStorage, MANUAL_LOCATION_KEY);
    applyLocation({ lat: fallbackCity.lat, lon: fallbackCity.lon, label: fallbackCity.name, source: "default" }, false);
  }

  function selectSearchResult(item: LocationResult) {
    const label = [item.name, item.region, item.country].filter(Boolean).join(", ");
    setSearchText(""); setSearchResults([]); setSearchOpen(false); setSearchError(""); setActiveSearchIndex(-1); setGeoNotice("");
    applyLocation({ lat: item.latitude, lon: item.longitude, label, source: "manual" }, true);
  }

  // Initial load: never block on a new location prompt. A saved place is shown
  // immediately. Chennai is only the fallback when nothing has been saved.
  // A searched city stays until it is cleared. Granted location permission
  // loads the current place without another prompt.
  useEffect(() => {
    let saved: LocState | null = null;
    try { saved = locationForSession(localStorage, sessionStorage); } catch { saved = null; }
    if (saved) applyLocation(saved, false);
    else refresh(fallbackCity.lat, fallbackCity.lon);
    const initialRevision = locationRevisionRef.current;

    let asked = false;
    try { asked = readPreference(localStorage, sessionStorage, KEY_GEO_ASKED) === "1"; } catch { /* ignore */ }
    if (saved?.source === "manual") return;
    if (!navigator.geolocation) return;
    const permissions = (navigator as Navigator & { permissions?: { query: (d: { name: string }) => Promise<{ state: string }> } }).permissions;
    const adoptGrantedLocation = (state: string) => {
      if (locationRevisionRef.current !== initialRevision) return;
      if (state === "granted") {
        requestGps();
        return;
      }
      if (saved || asked || state === "denied") return;
      setShowGeoBanner(true);
    };
    if (permissions?.query) {
      permissions.query({ name: "geolocation" }).then((status) => adoptGrantedLocation(status.state)).catch(() => adoptGrantedLocation("prompt"));
    } else {
      adoptGrantedLocation("prompt");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    airAbortRef.current?.abort();
    searchAbortRef.current?.abort();
    assistantAbortRef.current?.abort();
    goWindowAbortRef.current?.abort();
    familyAbortRef.current?.abort();
  }, []);

  const scheduleRequestKey = goWindowRequestKey(loc, profile, duration, timePreference);
  useEffect(() => {
    const settings = { profile, durationMinutes: duration, timePreference };
    try {
      if (isDefaultGoWindowSettings(settings)) {
        removePreference(localStorage, sessionStorage, GO_WINDOW_SETTINGS_KEY);
        return;
      }
      const raw = serializeGoWindowSettings(settings);
      if (raw) writePreference(localStorage, sessionStorage, GO_WINDOW_SETTINGS_KEY, raw);
    } catch { /* the choice stays in memory */ }
  }, [profile, duration, timePreference]);
  useEffect(() => {
    goWindowAbortRef.current?.abort();
    goWindowRequestRef.current += 1;
    goWindowPendingRef.current = false;
    setSchedule(null);
    setScheduleKey("");
    setScheduleError("");
    setScheduleLoading(false);
  }, [scheduleRequestKey]);

  const familySelectionKey = familyPlanRequestKey(loc, household);
  useEffect(() => {
    familyAbortRef.current?.abort();
    familyRequestRef.current += 1;
    familyPendingRef.current = false;
    setFamilyPlan(null);
    setFamilyPlanKey("");
    setFamilyError("");
    setFamilyLoading(false);
    familyExplainPendingRef.current = false;
    setFamilyExplainLoading(false);
    setFamilyExplainError("");
    setFamilyExplanation(null);
  }, [familySelectionKey]);

  useEffect(() => {
    if (!thinking && (answer || assistantError)) assistantResultRef.current?.focus();
  }, [answer, assistantError, thinking]);

  // Debounced global city search
  useEffect(() => {
    const q = searchText.trim();
    searchAbortRef.current?.abort();
    if (q.length < 2) {
      setSearchResults([]); setSearchOpen(false); setSearchBusy(false); setSearchError(""); setActiveSearchIndex(-1);
      return;
    }
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearchBusy(true); setSearchOpen(true); setSearchError(""); setActiveSearchIndex(-1);
    const t = setTimeout(async () => {
      try {
        const results = await searchLocations(q, controller.signal);
        setSearchResults(results); setSearchOpen(true); setActiveSearchIndex(results.length ? 0 : -1);
      } catch (e) {
        if (controller.signal.aborted) return;
        setSearchResults([]);
        setSearchError(e instanceof Error ? e.message : "Location search is unavailable.");
        setSearchOpen(true);
      } finally {
        if (!controller.signal.aborted) setSearchBusy(false);
      }
    }, 300);
    return () => { clearTimeout(t); controller.abort(); };
  }, [searchText]);

  // Close search dropdown on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) setSearchOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setSearchOpen(false); setActiveSearchIndex(-1);
      return;
    }
    if (e.key === "ArrowDown" && !searchOpen && searchResults.length > 0) {
      e.preventDefault();
      setSearchOpen(true);
      setActiveSearchIndex(0);
      return;
    }
    if (!searchOpen || searchResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSearchIndex((current) => (current + 1) % searchResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSearchIndex((current) => current <= 0 ? searchResults.length - 1 : current - 1);
    } else if (e.key === "Enter" && activeSearchIndex >= 0) {
      e.preventDefault();
      selectSearchResult(searchResults[activeSearchIndex]);
    }
  }

  const chartData = useMemo(() => air?.hourly.map((item) => ({
    ...item,
    hour: formatAtLocation(item.time, air.location.timezone, { hour: "numeric" }),
  })) || [], [air]);

  async function submit(q = question) {
    if (!q.trim() || !air || thinking) return;
    const requestId = ++assistantRequestRef.current;
    assistantAbortRef.current?.abort();
    const controller = new AbortController();
    assistantAbortRef.current = controller;
    setThinking(true); setAnswer(""); setEvidence([]); setHypothetical(null); setAssistantError(""); setDecision(null); setLocations([]); setMode(""); setAskedQuestion(q.trim());
    try {
      const result = await askAssistant(q, profile, { lat: loc.lat, lon: loc.lon }, controller.signal);
      if (!isLatestRequest(requestId, assistantRequestRef.current)) return;
      const named = result.locations || [];
      setAnswer(result.answer); setEvidence(result.evidence || []); setHypothetical(result.hypothetical || null); setMode(result.mode); setLocations(named); setDecision(named.length ? null : (result.decision || null));
    } catch (e) {
      if (controller.signal.aborted) return;
      if (isLatestRequest(requestId, assistantRequestRef.current)) {
        setAssistantError(e instanceof Error ? e.message : "Assistant unavailable.");
      }
    } finally {
      if (isLatestRequest(requestId, assistantRequestRef.current)) {
        setThinking(false); setQuestion("");
      }
    }
  }
  async function findBestTime() {
    if (scheduleLoading || goWindowPendingRef.current) return;
    goWindowPendingRef.current = true;
    const requestId = ++goWindowRequestRef.current;
    const request = buildGoWindowRequest(loc, profile, duration, timePreference);
    const requestKey = JSON.stringify(request);
    goWindowAbortRef.current?.abort();
    const controller = new AbortController();
    goWindowAbortRef.current = controller;
    setScheduleLoading(true);
    setSchedule(null);
    setScheduleKey("");
    setScheduleError("");
    try {
      const result = await findGoWindow(request, controller.signal);
      if (!isLatestRequest(requestId, goWindowRequestRef.current)) return;
      setSchedule(result);
      setScheduleKey(requestKey);
    } catch (e) {
      if (controller.signal.aborted || !isLatestRequest(requestId, goWindowRequestRef.current)) return;
      setScheduleError(e instanceof Error ? e.message : "Activity window request failed.");
    } finally {
      if (isLatestRequest(requestId, goWindowRequestRef.current)) {
        goWindowPendingRef.current = false;
        setScheduleLoading(false);
      }
    }
  }

  function updateHousehold(next: FamilyDraft) {
    setHousehold(next);
    try {
      const stored = serializeFamilyHousehold(next);
      const fallback = serializeFamilyHousehold(defaultFamilyHousehold());
      if (stored && stored !== fallback) writePreference(localStorage, sessionStorage, FAMILY_STORAGE_KEY, stored);
      else if (stored === fallback) removePreference(localStorage, sessionStorage, FAMILY_STORAGE_KEY);
    } catch { /* storage unavailable — the household stays in memory */ }
  }

  function resetHousehold() {
    updateHousehold(defaultFamilyHousehold());
  }

  function resetGoWindow() {
    const next = {
      profile: { activity: "running", ageGroup: "adult", sensitivity: "general" } as Profile,
      durationMinutes: DEFAULT_GO_WINDOW_DURATION,
      timePreference: DEFAULT_TIME_PREFERENCE,
    };
    setProfile(next.profile);
    setDuration(next.durationMinutes);
    setTimePreference(next.timePreference);
  }

  async function planHousehold() {
    if (familyLoading || familyPendingRef.current) return;
    const request = buildFamilyPlanRequest(loc, household);
    if (!request) return;
    familyPendingRef.current = true;
    familyExplainPendingRef.current = false;
    const requestId = ++familyRequestRef.current;
    const requestKey = JSON.stringify(request);
    familyAbortRef.current?.abort();
    const controller = new AbortController();
    familyAbortRef.current = controller;
    setFamilyLoading(true);
    setFamilyExplainLoading(false);
    setFamilyExplainError("");
    setFamilyExplanation(null);
    setFamilyPlan(null);
    setFamilyPlanKey("");
    setFamilyError("");
    try {
      const result = await requestFamilyPlan(request, controller.signal);
      if (!isLatestRequest(requestId, familyRequestRef.current)) return;
      setFamilyPlan(result);
      setFamilyPlanKey(requestKey);
    } catch (e) {
      if (controller.signal.aborted || !isLatestRequest(requestId, familyRequestRef.current)) return;
      setFamilyError(e instanceof Error ? e.message : "Family plan request failed.");
    } finally {
      if (isLatestRequest(requestId, familyRequestRef.current)) {
        familyPendingRef.current = false;
        setFamilyLoading(false);
      }
    }
  }

  async function explainHousehold() {
    if (!canStartFamilyExplanation({
      explainLoading: familyExplainLoading,
      explainPending: familyExplainPendingRef.current,
      planLoading: familyLoading,
      planPending: familyPendingRef.current,
    })) return;
    const request = buildFamilyPlanRequest(loc, household, true);
    if (!request) return;
    familyExplainPendingRef.current = true;
    const requestId = ++familyRequestRef.current;
    const requestKey = familyPlanRequestKey(loc, household);
    familyAbortRef.current?.abort();
    const controller = new AbortController();
    familyAbortRef.current = controller;
    setFamilyExplainLoading(true);
    setFamilyExplainError("");
    try {
      const result = await requestFamilyPlan(request, controller.signal);
      if (controller.signal.aborted || !canApplyFamilyExplanation({
        requestId,
        latestRequestId: familyRequestRef.current,
        requestKey,
        currentKey: familyPlanRequestKey(loc, household),
      })) return;
      setFamilyPlan(result);
      setFamilyPlanKey(requestKey);
      setFamilyExplanation(result.explanation ?? null);
    } catch (e) {
      if (controller.signal.aborted || !isLatestRequest(requestId, familyRequestRef.current)) return;
      setFamilyExplainError(e instanceof Error ? e.message : "AI explanation unavailable.");
    } finally {
      if (isLatestRequest(requestId, familyRequestRef.current)) {
        familyExplainPendingRef.current = false;
        setFamilyExplainLoading(false);
      }
    }
  }

  const aqi = air?.aqi;
  const aqiPresentation = getAqiPresentation(aqi);
  const forecastValidAt = air?.forecastValidAt ?? air?.observedAt ?? null;
  const modelInitializedAt = air?.modelInitializedAt ?? air?.metadata?.timestamps?.modelInitializedAt ?? null;
  const retrievedAt = air?.retrievedAt ?? air?.metadata?.timestamps?.retrievedAt ?? null;
  const freshness = aqiPresentation.value === null
    ? { state: "unavailable", label: "DATA UNAVAILABLE" }
    : getFreshnessPresentation({ forecastValidAt, modelInitializedAt, retrievedAt }, clockNow);
  const tone = aqiPresentation.color;
  const dataStatus = loading
    ? { state: "loading", label: "LOADING ESTIMATE" }
    : error
      ? { state: "error", label: "DATA ERROR" }
      : freshness;
  const timingDisclosure = air
    ? formatTimingDisclosure({
      forecastValidAt,
      modelInitializedAt,
      retrievedAt,
      timezone: air.location.timezone,
      now: clockNow,
    })
    : null;
  const sourceDisclosure = formatSourceDisclosure(air?.metadata, air?.source);
  const windNote = air ? describeWindUse({ windSpeedKmh: air.weather?.wind_speed_10m, weatherRetrievedAt: air.weatherRetrievedAt }, clockNow) : null;
  const activityCopy = describeCurrentActivityGuidance({
    categoryLabel: aqiPresentation.label,
    categoryAdvice: air?.status.advice,
    freshnessState: aqiPresentation.value === null ? null : freshness.state,
  });
  const showNonStationSubnote = Boolean(air?.metadata?.spatialResolution?.verified);
  const displayDate = formatDateAtLocation(air?.location.timezone);
  return <div className="app-shell">
    <header className="site-header">
      <div className="nav-shell">
      <div className="brand"><div className="brand-icon"><Wind size={22}/></div><div><strong>AirSense<span> AI</span></strong><small>URBAN AIR INTELLIGENCE</small></div></div>
      <nav className="primary-nav" aria-label="Dashboard sections">
        <a className="nav" href="#overview"><Activity size={17}/> Overview</a>
        <a className="nav" href="#gowindow" onClick={() => openDashboardSection("gowindow")}><Clock size={17}/> GoWindow</a>
        <a className="nav" href="#family" onClick={() => openDashboardSection("family")}><Users size={17}/> Family</a>
        <a className="nav" href="#pollutants"><Compass size={17}/> Pollutants</a>
        <a className="nav" href="#assistant" onClick={() => openDashboardSection("assistant")}><MessageCircle size={17}/> AI Assistant</a>
      </nav>
      <div className="nav-actions">
        <div className="search-row nav-search" ref={searchBoxRef}>
          <div className="search-box">
            <Search size={14}/>
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search any city…"
              aria-label="Search location"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={searchOpen}
              aria-controls="location-search-results"
              aria-activedescendant={activeSearchIndex >= 0 ? `location-result-${activeSearchIndex}` : undefined}
            />
            {searchBusy && <RefreshCw className="spin" size={13}/>}
          </div>
          {searchOpen && searchResults.length > 0 && <div className="search-results" id="location-search-results" role="listbox" aria-label="Location suggestions">
            {searchResults.map((r, i) => <button key={`${r.latitude}-${r.longitude}-${i}`} id={`location-result-${i}`} role="option" aria-selected={i === activeSearchIndex} className={i === activeSearchIndex ? "active" : ""} onMouseEnter={() => setActiveSearchIndex(i)} onClick={() => selectSearchResult(r)}>
              <b>{r.name}</b><span>{[r.region, r.country].filter(Boolean).join(", ")}</span>
            </button>)}
          </div>}
          {searchOpen && !searchBusy && searchResults.length === 0 && <div className="search-results" id="location-search-results">{searchError ? <div className="search-error" role="alert">{searchError}</div> : <div className="search-empty">No places found. Try a different spelling.</div>}</div>}
        </div>
        <button className="location-control" aria-label={loc.source === "manual" ? "Back to my location" : "Use my location"} onClick={returnToGps} disabled={geoBusy}>
          <Crosshair size={15}/><span>{loc.source === "manual" ? "Back to my location" : "Use my location"}</span>
        </button>
        <ThemeSelector/>
      </div>
      </div>
    </header>
    <main className="main">
      <section className="topbar" id="overview"><div><div className="eyebrow">{displayDate}</div><h1>Environmental overview</h1><p>Current modelled air quality and exposure guidance for your selected location.</p></div><button className="icon-btn" aria-label="Refresh air-quality data" onClick={() => refresh()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={17}/></button></section>

      {showGeoBanner && <div className="geo-banner" role="dialog" aria-label="Location permission">
        <MapPin size={16}/>
        <div className="geo-banner-text"><b>Use your location?</b><span>AirSense uses your coordinates for local air data and shares them directly with BigDataCloud to display a place name. They stay in this browser until you clear the saved place, and are never sent to the AI assistant.</span></div>
        <button className="geo-allow" onClick={requestGps} disabled={geoBusy}>{geoBusy ? "Locating…" : "Allow location"}</button>
        <button className="geo-dismiss" aria-label="Dismiss" onClick={() => { setShowGeoBanner(false); setGeoNotice("No problem — showing the default city, Chennai. Search for any place above."); try { rememberGeoAsked(); } catch { /* ignore */ } }}><X size={14}/></button>
      </div>}

      <section className="location-row">
        <div className="location-title">
          <MapPin size={16}/>
          <span className="location-name" title={loc.label}>{loc.source === "default" ? "Default · Chennai" : loc.label}</span>
          <span className={`source-badge ${loc.source}`}>{loc.source === "gps" ? "GPS" : loc.source === "manual" ? "SELECTED" : "DEFAULT"}</span>
          {loc.source !== "default" && <button className="quiet-btn" type="button" onClick={clearSavedPlace}>Clear saved place</button>}
          <span className={`data-status ${dataStatus.state}`} role="status">{dataStatus.label}</span>
        </div>
        <span className="muted location-timing">{loading ? "Loading forecast timing…" : timingDisclosure ? timingDisclosure.summary : "Forecast timing unavailable"}</span>
      </section>

      {geoNotice && <div className="notice-banner" role="status">{geoNotice}</div>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      <section className="context-strip" aria-label="Current weather context">
        <ContextMetric label="Temperature" value={formatWeatherValue(air?.weather.temperature_2m, "°C")}/>
        <ContextMetric label="Feels like" value={formatWeatherValue(air?.weather.apparent_temperature, "°C")}/>
        <ContextMetric label="Humidity" value={formatWeatherValue(air?.weather.relative_humidity_2m, "%")}/>
        <ContextMetric label="Wind" value={formatReportedWindSpeed(air?.weather.wind_speed_10m)}/>
        {windNote && <p className={`weather-note ${windNote.tone}`}>{windNote.text}</p>}
      </section>
      <section className="hero-grid" aria-label="Current air quality">
        <div className={`aqi-card ${tone}`}>
          <div className="card-top"><span className="section-kicker">CURRENT MODELLED AIR QUALITY</span><span className={`data-status ${dataStatus.state}`}>{dataStatus.label}</span></div>
          <div className="aqi-main"><div><div className="aqi-number">{loading ? "…" : aqi ?? "N/A"}</div><div className="aqi-unit">US AQI · 0–500 SCALE</div></div><div className="aqi-ring" aria-label={`Severity level ${aqiPresentation.level || "unavailable"} of 6`}><div><Wind size={28}/><b>{aqiPresentation.level ? `${aqiPresentation.level} / 6` : "N/A"}</b></div></div></div>
          <h2>{loading ? "Loading environmental estimates…" : aqiPresentation.label}</h2>
          {activityCopy.blocked && activityCopy.categoryNote && <p className="aqi-classification">{activityCopy.categoryNote}</p>}
          <p>{error ? "Current environmental estimates could not be loaded. Try again shortly." : aqiPresentation.value === null ? "No current US AQI reading is available. Check an official local monitor." : activityCopy.guidance}</p>
          <div className="scale" aria-label="US AQI category scale from 0 to 500"><div className="scale-bar">{aqiPresentation.markerPercent !== null && <i aria-hidden="true" style={{ left: `${aqiPresentation.markerPercent}%` }}/>}</div><div className="scale-labels">{US_AQI_CATEGORIES.map((category) => <span key={category.label}><b>{category.label}</b><small>{category.min}–{category.max}</small></span>)}</div></div>
          <div className="source-disclosure">
            <span>{sourceDisclosure}</span>
            {showNonStationSubnote && <small>Not a neighborhood monitoring station observation.</small>}
          </div>
        </div>
        <section id="hourly" className="insight-card" aria-labelledby="hourly-title">
          <div className="section-header">
            <h2 className="section-heading section-static"><span className="section-toggle-copy"><span className="section-kicker">MODELLED HOURLY ESTIMATES</span><span className="section-title" id="hourly-title">Next 12 hours</span></span><span className="mini-icon"><Activity size={17}/></span></h2>
          </div>
          <div className="section-panel">
            <div className="chart-wrap">{chartData.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><defs><linearGradient id="aqiFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--blue-readable)" stopOpacity={0.2}/><stop offset="100%" stopColor="var(--blue-readable)" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="var(--chart-grid)" vertical={false}/><XAxis dataKey="hour" tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false}/><YAxis width={32} domain={[0, (maximum: number) => Math.min(500, Math.max(100, Math.ceil(maximum / 50) * 50))]} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false}/><Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }} cursor={{stroke:"var(--border-strong)"}}/><Area type="monotone" dataKey="aqi" stroke="var(--blue-readable)" strokeWidth={2.5} fill="url(#aqiFill)" connectNulls/></AreaChart></ResponsiveContainer> : <div className="chart-empty">{loading ? "Loading model forecast…" : error ? "Forecast unavailable because data could not be loaded." : "Hourly model forecast unavailable."}</div>}</div>
            <div className="chart-legend"><span><i/> US AQI forecast</span><span className="muted">Modelled forecast · not a station observation</span></div>
          </div>
        </section>
      </section>
      <section id="pollutants" className="section-block" aria-labelledby="pollutants-title">
        <div className="section-header">
          <h2 className="section-heading section-static"><span className="section-toggle-copy"><span className="section-kicker">WHAT'S IN THE AIR</span><span className="section-title" id="pollutants-title">Pollutant breakdown</span></span><span className="muted">Modelled concentration · µg/m³ where applicable</span></h2>
        </div>
        <div className="section-panel">
          <div className="pollutant-grid">
            <Pollutant name="PM2.5" value={air?.pollutants.pm25} unit="µg/m³" icon={<Cloud/>} desc="Fine particles"/>
            <Pollutant name="PM10" value={air?.pollutants.pm10} unit="µg/m³" icon={<Wind/>} desc="Coarse particles"/>
            <Pollutant name="Ozone" value={air?.pollutants.ozone} unit="µg/m³" icon={<Activity/>} desc="Ground-level O₃"/>
            <Pollutant name="Nitrogen dioxide" value={air?.pollutants.nitrogenDioxide} unit="µg/m³" icon={<Cloud/>} desc="Traffic-related gas"/>
          </div>
        </div>
      </section>
      <PlannerModePicker mode={plannerMode} onChange={choosePlannerMode}/>
      {plannerMode === "self" && <GoWindowPanel
        locationLabel={loc.source === "default" ? "Default · Chennai" : loc.label}
        profile={profile}
        onProfileChange={setProfile}
        duration={duration}
        onDurationChange={setDuration}
        timePreference={timePreference}
        onTimePreferenceChange={setTimePreference}
        loading={scheduleLoading && scheduleKey === ""}
        error={scheduleError}
        result={scheduleKey === scheduleRequestKey ? schedule : null}
        hourly={air?.hourly ?? []}
        timezone={air?.location.timezone ?? null}
        onFind={findBestTime}
        canReset={!isDefaultGoWindowSettings({ profile, durationMinutes: duration, timePreference })}
        onReset={resetGoWindow}
        expanded={sections.gowindow}
        onToggle={() => toggleDashboardSection("gowindow")}
      />}
      {plannerMode === "family" && <FamilyPanel
        locationLabel={loc.source === "default" ? "Default · Chennai" : loc.label}
        household={household}
        onHouseholdChange={updateHousehold}
        loading={familyLoading && familyPlanKey === ""}
        error={familyError}
        result={familyPlanForDisplay(familyPlanKey === familySelectionKey ? familyPlan : null, familyExplanation)}
        now={clockNow}
        onPlan={planHousehold}
        explainLoading={familyExplainLoading}
        explainError={familyExplainError}
        onExplain={explainHousehold}
        canReset={serializeFamilyHousehold(household) !== serializeFamilyHousehold(defaultFamilyHousehold())}
        onReset={resetHousehold}
        expanded={sections.family}
        onToggle={() => toggleDashboardSection("family")}
      />}
      <CollapsibleSection
        id="assistant"
        titleId="assistant-title"
        className="section-block assistant-section"
        expanded={sections.assistant}
        onToggle={() => toggleDashboardSection("assistant")}
        header={<><span className="section-toggle-copy"><span className="section-kicker">YOUR PERSONAL AIR GUIDE</span><span className="section-title" id="assistant-title">Ask AirSense AI</span><span className="section-summary">Grounded in local model estimates and your activity context.</span></span><span className="ai-mark"><Bot size={20}/> AI ASSISTED</span></>}
      >
        <div className="assistant-card">
          <div className="profile-row"><div className="profile-heading"><Bot size={17}/><b>Using the GoWindow activity profile</b></div><a className="profile-link" href="#gowindow" onClick={() => openDashboardSection("gowindow")}>Change activity or profile</a></div>
          <p className="profile-summary">{profile.activity} · {profile.ageGroup} · {profile.sensitivity}</p>
          <div className="prompt-list">{prompts.map(p => <button key={p} onClick={() => submit(p)} disabled={thinking || !air}>{p}<ArrowUpRight size={13}/></button>)}</div>
          {decision && !locations.length && <div className="decision-card">
            <p className="location-kicker">Selected location · {loc.label}</p>
            <div className="decision-top">
              <span className={`risk-pill ${decision.overallRisk}`}>{decision.overallRisk.replace("_", " ").toUpperCase()}</span>
              <span className={`rec-pill ${decision.activityRecommendation}`}>{decision.activityRecommendation.replace("_", " ").toUpperCase()}</span>
            </div>
            <p className="decision-action">{capitalizeSentence(decision.recommendedAction)}</p>
            <p className="decision-reasoning">{decision.reasoning}</p>
            {decision.sensitiveGroupAdvice !== "No additional sensitivity concerns for this profile." && <p className="decision-sensitive">{decision.sensitiveGroupAdvice}</p>}
            {decision.activityRecommendation !== "suitable" && <p className="decision-alt"><b>Alternative:</b> {decision.alternativeActivity}</p>}
            <p className="decision-limitations">{decision.limitations}</p>
          </div>}
          {(askedQuestion || answer) && <div className={`answer-box${mode === "declined" ? " declined" : mode === "ambiguous" || mode === "location-clarification" ? " ambiguous" : mode === "classification-unavailable" ? " unavailable" : ""}`} ref={assistantResultRef} tabIndex={-1}>
            <div className="answer-title"><Bot size={16}/> AirSense says <span>{mode === "ai" ? "GENERATIVE AI" : mode === "declined" ? "OUT OF SCOPE" : mode === "ambiguous" || mode === "location-clarification" ? "CLARIFICATION" : mode === "classification-unavailable" ? "EXPLANATION UNAVAILABLE" : "SAFETY ENGINE"}</span></div>
            {askedQuestion && <p className="asked-question"><b>You asked.</b> {askedQuestion}</p>}
            {answer && <p className="ai-explanation">{answer}</p>}
            {locations.length > 0 && <LocationAnswers locations={locations} />}
            {mode === "ai" && evidence.length > 0 && <div className="evidence-block"><b>Evidence from the current reading</b><ul>{evidence.map((item) => <li key={item}>{item}</li>)}</ul></div>}
            {hypothetical && <div className="hypothetical-block"><b>{hypothetical.label}</b><p>{hypothetical.note} Assumed wind {hypothetical.assumedWindSpeedKmh} km/h would be {hypothetical.activityRecommendation.replace(/_/g, " ")}. {hypothetical.recommendedAction}</p><p>{hypothetical.windDisclosure}</p></div>}
            {decision?.trace && <DecisionTracePanel trace={decision.trace} />}
          </div>}
          {assistantError && <div className="assistant-error" ref={assistantResultRef} tabIndex={-1} role="alert"><b>Assistant unavailable</b><span>{assistantError}</span></div>}
          <form className="chat-input" onSubmit={e => {e.preventDefault(); submit();}}><input value={question} onChange={e => setQuestion(e.target.value)} disabled={thinking || !air} placeholder={air ? "Ask about air quality, activities or precautions…" : "Load environmental data to ask a question"} aria-label="Ask AirSense AI"/><button disabled={thinking || !air || !question.trim()} aria-label="Send question">{thinking ? <RefreshCw className="spin" size={17}/> : <Send size={17}/>}</button></form>
          <div className="disclaimer">Guidance is informational, not medical advice. Follow local public-health advisories.</div>
        </div>
      </CollapsibleSection>
      <div className="privacy"><ShieldCheck size={16}/><div><b>Privacy first</b><small>Location is used for local air data. GPS coordinates are shared directly with BigDataCloud only to name your location, stay in this browser until you clear the saved place, and are never sent to the AI model.</small></div></div>
      <footer><span><Leaf size={14}/> Make every breath count.</span><span>Data: Open-Meteo · Powered by CAMS · <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Data attribution</a></span></footer>
    </main>
    <BackToTop />
  </div>;
}
function locationTitle(location: AssistantLocation) {
  return [location.name || location.query, location.region, location.country].filter(Boolean).join(", ");
}

function locationStatusLabel(status: AssistantLocation["status"]) {
  if (status === "ambiguous") return "Ambiguous place";
  if (status === "unresolved") return "Unresolved place";
  if (status === "geocoding_unavailable") return "Location search unavailable";
  if (status === "environment_data_unavailable") return "Air-quality data unavailable";
  if (status === "unavailable") return "Not fetched";
  return "Resolved place";
}

function LocationAnswers({ locations }: { locations: AssistantLocation[] }) {
  return <div className="location-answers">
    {locations.map((location) => <article key={`${location.query}-${location.status}`} className="location-result" data-status={location.status}>
      {location.status !== "ready" && <p className="location-kicker">{locationStatusLabel(location.status)}</p>}
      <h3>{locationTitle(location)}</h3>
      <p className="location-meta">Requested place {location.query}</p>
      {location.status === "ready" ? <>
        <p className="location-meta">Server coordinates {location.latitude}, {location.longitude}</p>
        <div className="location-metrics">
          <span>{location.aqiScale || "US AQI"} {location.aqi ?? "unavailable"}</span>
          <span>PM2.5 {location.pm25 ?? "unavailable"}</span>
          <span>{location.weatherAvailable ? "Weather retrieved" : "Weather unavailable"}</span>
          <span>{location.decision?.activityRecommendation?.replace(/_/g, " ") || "no recommendation"}</span>
        </div>
        {location.decision && <p className="decision-reasoning">{location.decision.recommendedAction}</p>}
        <p className="location-meta">Air retrieved {location.retrievedAt || "unavailable"} · Weather retrieved {location.weatherRetrievedAt || "unavailable"}</p>
        {location.decision?.trace && <DecisionTracePanel trace={location.decision.trace} />}
      </> : <>
        {location.status === "environment_data_unavailable" && location.latitude !== undefined && location.longitude !== undefined && <p className="location-meta">Matched coordinates {location.latitude}, {location.longitude}. No air-quality reading is available.</p>}
        <p className="decision-reasoning">{location.note || "This place is unavailable."}{location.candidates?.length ? ` ${location.candidates.map((candidate) => [candidate.name, candidate.region, candidate.country].filter(Boolean).join(", ")).join("; ")}` : ""}</p>
      </>}
    </article>)}
  </div>;
}

function DecisionTracePanel({ trace }: { trace: DecisionTrace }) {
  return <details className="decision-trace">
    <summary>How AirSense reached this result</summary>
    <dl>
      <div><dt>US AQI</dt><dd>{trace.airQuality.value === null ? "Unavailable" : `${trace.airQuality.value} · ${trace.airQuality.category}`}</dd></div>
      <div><dt>PM2.5</dt><dd>{trace.pm25.value === null ? "Unavailable" : `${trace.pm25.value} µg/m³ · ${trace.pm25.category}`}</dd></div>
      <div><dt>Weather</dt><dd>{trace.weather.freshnessState} · {trace.weather.windSpeedKmh === null ? "wind unavailable" : `${trace.weather.windSpeedKmh} km/h`}</dd></div>
      <div><dt>Wind score</dt><dd>{trace.wind.disclosure}</dd></div>
      <div><dt>Profile</dt><dd>{trace.profile.activity} · {trace.profile.ageGroup} · {trace.profile.sensitivity}</dd></div>
      {trace.scoringApplied && trace.factors.map((factor) => <div key={factor.factor}><dt>{factor.factor}</dt><dd>{factor.detail} Effect {factor.contribution}.</dd></div>)}
      {trace.vigorousUnhealthyFloor && <div><dt>Activity floor</dt><dd>Unhealthy air with vigorous activity cannot score below avoid.</dd></div>}
      {trace.floorApplied && <div><dt>Category floor</dt><dd>The US AQI category raised the recommendation to {trace.categoryFloor}.</dd></div>}
      <div><dt>Result</dt><dd>{trace.result.overallRisk.replace(/_/g, " ")} · {trace.result.activityRecommendation.replace(/_/g, " ")}. {trace.result.recommendedAction}</dd></div>
      {trace.unavailable.map((item) => <div key={item}><dt>Unavailable</dt><dd>{item}</dd></div>)}
    </dl>
  </details>;
}

function Pollutant({name,value,unit,icon,desc}:{name:string;value:number|null|undefined;unit:string;icon:React.ReactNode;desc:string}) {
  return <div className="pollutant-card"><div className="pollutant-top"><span className="pollutant-icon">{icon}</span><span className="muted">{desc}</span></div><div className="pollutant-value">{value == null ? "—" : Number(value).toFixed(1)} <small>{unit}</small></div><b>{name}</b></div>;
}
function ContextMetric({label,value}:{label:string;value:string}) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}
export default App;
