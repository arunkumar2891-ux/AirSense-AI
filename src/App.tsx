import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowUpRight, Bot, Cloud, Compass, Crosshair, HeartPulse, Leaf, MapPin, MessageCircle, RefreshCw, Search, Send, ShieldCheck, Wind, X } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { askAssistant, getAirQuality, reverseGeocode, searchLocations } from "./api";
import type { AirData, ExposureDecision, LocationResult, Profile } from "./types";

const fallbackCity = { name: "Hyderabad", lat: 17.385, lon: 78.4867 };
const prompts = ["Is it safe to go for a run?", "What precautions should my family take?", "Explain today's pollution levels"];

// Session-scoped storage keys (cleared when the tab closes — precise coordinates
// are never persisted beyond the session).
const KEY_MANUAL = "airsense.manual";
const KEY_GPS = "airsense.gps";
const KEY_GEO_ASKED = "airsense.geoAsked";

type LocSource = "gps" | "manual" | "default";
type LocState = { lat: number; lon: number; label: string; source: LocSource };

function loadSession(key: string): LocState | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Number.isFinite(parsed?.lat) && Number.isFinite(parsed?.lon) && typeof parsed?.label === "string") {
      return { lat: parsed.lat, lon: parsed.lon, label: parsed.label, source: parsed.source === "gps" ? "gps" : "manual" };
    }
  } catch { /* ignore corrupt session data */ }
  return null;
}

function App() {
  const [loc, setLoc] = useState<LocState>({ lat: fallbackCity.lat, lon: fallbackCity.lon, label: fallbackCity.name, source: "default" });
  const [air, setAir] = useState<AirData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<Profile>({ activity: "running", ageGroup: "adult", sensitivity: "general" });
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [thinking, setThinking] = useState(false);
  const [mode, setMode] = useState("");
  const [decision, setDecision] = useState<ExposureDecision | null>(null);

  // Location UX state
  const [showGeoBanner, setShowGeoBanner] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoNotice, setGeoNotice] = useState("");
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<LocationResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  async function refresh(lat = loc.lat, lon = loc.lon) {
    setLoading(true); setError("");
    try { const data = await getAirQuality(lat, lon); setAir(data); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load data."); }
    finally { setLoading(false); }
  }

  function applyLocation(next: LocState, persist: boolean) {
    setLoc(next);
    if (persist) {
      try {
        if (next.source === "gps") { sessionStorage.setItem(KEY_GPS, JSON.stringify(next)); sessionStorage.removeItem(KEY_MANUAL); }
        if (next.source === "manual") { sessionStorage.setItem(KEY_MANUAL, JSON.stringify(next)); }
      } catch { /* storage unavailable — location simply won't persist for the session */ }
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
    setGeoBusy(true); setGeoNotice("");
    try { sessionStorage.setItem(KEY_GEO_ASKED, "1"); } catch { /* ignore */ }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        const label = await labelGpsLocation(lat, lon);
        setGeoBusy(false); setShowGeoBanner(false);
        applyLocation({ lat, lon, label, source: "gps" }, true);
      },
      (err) => {
        setGeoBusy(false); setShowGeoBanner(false);
        if (err.code === err.PERMISSION_DENIED) setGeoNotice("Location permission was declined. Showing the demo city — search for any place below.");
        else if (err.code === err.TIMEOUT) setGeoNotice("Location request timed out. Showing the demo city — search for any place below.");
        else setGeoNotice("Your position is currently unavailable. Showing the demo city — search for any place below.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }

  function returnToGps() {
    const saved = loadSession(KEY_GPS);
    if (saved) { sessionStorage.removeItem(KEY_MANUAL); applyLocation({ ...saved, source: "gps" }, false); return; }
    requestGps();
  }

  function selectSearchResult(item: LocationResult) {
    const label = [item.name, item.region, item.country].filter(Boolean).join(", ");
    setSearchText(""); setSearchResults([]); setSearchOpen(false); setGeoNotice("");
    applyLocation({ lat: item.latitude, lon: item.longitude, label, source: "manual" }, true);
  }

  // Initial load: never block on location. Manual selection from earlier in the
  // session wins; otherwise load the demo city immediately, then decide whether
  // to offer geolocation (with an explanation) based on the permission state.
  useEffect(() => {
    const manual = loadSession(KEY_MANUAL);
    if (manual) { setLoc({ ...manual, source: "manual" }); refresh(manual.lat, manual.lon); }
    else { refresh(fallbackCity.lat, fallbackCity.lon); }

    let asked = false;
    try { asked = sessionStorage.getItem(KEY_GEO_ASKED) === "1"; } catch { /* ignore */ }
    if (manual || asked) return;
    if (!navigator.geolocation) return;
    const permissions = (navigator as Navigator & { permissions?: { query: (d: { name: string }) => Promise<{ state: string }> } }).permissions;
    if (permissions?.query) {
      permissions.query({ name: "geolocation" }).then((status) => {
        if (status.state === "granted") requestGps(); // previously allowed — no extra explanation needed
        else if (status.state === "prompt") setShowGeoBanner(true); // explain first, then request on user action
        // "denied" → stay on demo city with the search field; never re-prompt
      }).catch(() => setShowGeoBanner(true));
    } else {
      setShowGeoBanner(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced global city search
  useEffect(() => {
    const q = searchText.trim();
    if (q.length < 2) { setSearchResults([]); setSearchOpen(false); return; }
    setSearchBusy(true);
    const t = setTimeout(async () => {
      try { const results = await searchLocations(q); setSearchResults(results); setSearchOpen(true); }
      catch { setSearchResults([]); setSearchOpen(false); }
      finally { setSearchBusy(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [searchText]);

  // Close search dropdown on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) setSearchOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const chartData = useMemo(() => air?.hourly.map((item) => ({ ...item, hour: new Date(item.time).toLocaleTimeString([], { hour: "numeric" }) })) || [], [air]);

  async function submit(q = question) {
    if (!q.trim() || !air) return;
    setThinking(true); setAnswer("");
    try { const result = await askAssistant(q, profile, { lat: loc.lat, lon: loc.lon }); setAnswer(result.answer); setMode(result.mode); setDecision(result.decision || null); }
    catch (e) { setAnswer(e instanceof Error ? e.message : "Assistant unavailable."); }
    finally { setThinking(false); setQuestion(""); }
  }
  const aqi = air?.aqi;
  const tone = air?.status.color || "slate";
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Wind size={22}/></div><div><strong>AirSense<span> AI</span></strong><small>URBAN AIR INTELLIGENCE</small></div></div>
      <div className="side-label">WORKSPACE</div>
      <a className="nav active"><Activity size={17}/> Overview</a>
      <a className="nav"><MessageCircle size={17}/> AI Assistant <span className="nav-dot"/></a>
      <a className="nav"><Compass size={17}/> Explore areas</a>
      <div className="sidebar-bottom"><div className="privacy"><ShieldCheck size={16}/><div><b>Privacy first</b><small>Location is used only to fetch local air data. Coordinates stay in this session and are never sent to the AI model.</small></div></div><small className="version">AIRSENSE AI · HACKATHON EDITION</small></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><div className="eyebrow">WEDNESDAY, NOVEMBER 25, 2026</div><h1>Your air, decoded.</h1></div><div className="top-actions"><button className="outline-btn" onClick={returnToGps} disabled={geoBusy}><Crosshair size={15}/> {loc.source === "manual" ? "Back to my location" : "Use my location"}</button><button className="icon-btn" aria-label="Refresh air quality" onClick={() => refresh()}><RefreshCw size={17}/></button><div className="avatar">A</div></div></header>

      {showGeoBanner && <div className="geo-banner" role="dialog" aria-label="Location permission">
        <MapPin size={16}/>
        <div className="geo-banner-text"><b>Use your location?</b><span>AirSense shows air quality for the place you are in. Your coordinates are used only to fetch local data, stay in this browser session, and are never sent to the AI assistant.</span></div>
        <button className="geo-allow" onClick={requestGps} disabled={geoBusy}>{geoBusy ? "Locating…" : "Allow location"}</button>
        <button className="geo-dismiss" aria-label="Dismiss" onClick={() => { setShowGeoBanner(false); setGeoNotice("No problem — showing the demo city. Search for any place below."); try { sessionStorage.setItem(KEY_GEO_ASKED, "1"); } catch { /* ignore */ } }}><X size={14}/></button>
      </div>}

      <section className="location-row">
        <div className="location-title">
          <MapPin size={16}/>
          <span className="location-name">{loc.label}</span>
          <span className={`source-badge ${loc.source}`}>{loc.source === "gps" ? "GPS" : loc.source === "manual" ? "SELECTED" : "DEMO CITY"}</span>
          <span className="live-pill"><i/> LIVE DATA</span>
          {loc.source === "manual" && <button className="return-gps" onClick={returnToGps} disabled={geoBusy}><Crosshair size={12}/> Back to my location</button>}
        </div>
        <span className="muted">{air?.observedAt ? `Updated ${new Date(air.observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Waiting for data"}</span>
      </section>

      <div className="search-row" ref={searchBoxRef}>
        <div className="search-box">
          <Search size={14}/>
          <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search any city or place worldwide…" aria-label="Search location"/>
          {searchBusy && <RefreshCw className="spin" size={13}/>}
        </div>
        {searchOpen && searchResults.length > 0 && <div className="search-results" role="listbox">
          {searchResults.map((r, i) => <button key={`${r.latitude}-${r.longitude}-${i}`} role="option" onClick={() => selectSearchResult(r)}>
            <b>{r.name}</b><span>{[r.region, r.country].filter(Boolean).join(", ")}</span>
          </button>)}
        </div>}
        {searchOpen && !searchBusy && searchResults.length === 0 && <div className="search-results"><div className="search-empty">No places found. Try a different spelling.</div></div>}
      </div>

      {geoNotice && <div className="notice-banner" role="status">{geoNotice}</div>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      <section className="hero-grid">
        <div className={`aqi-card ${tone}`}>
          <div className="card-top"><span className="section-kicker">CURRENT AIR QUALITY</span><span className="pulse"><i/> LIVE</span></div>
          <div className="aqi-main"><div><div className="aqi-number">{loading ? "—" : aqi ?? "N/A"}</div><div className="aqi-unit">{air?.aqiScale || "AQI"} INDEX</div></div><div className="aqi-ring"><div><Wind size={28}/><b>{air?.status.level ? `0${air.status.level}` : "--"}</b></div></div></div>
          <h2>{loading ? "Checking the atmosphere…" : air?.status.label || "Data unavailable"}</h2>
          <p>{air?.status.advice || "Connect to live environmental data to see local guidance."}</p>
          <div className="scale"><div className="scale-bar"><i style={{ left: `${Math.min(100, ((aqi || 0) / 300) * 100)}%` }}/></div><div className="scale-labels"><span>Good</span><span>Moderate</span><span>Poor</span><span>Severe</span></div></div>
          <div className="source-note">Source: {air?.source || "Open-Meteo"} · Model estimate</div>
        </div>
        <div className="insight-card">
          <div className="card-heading"><div><span className="section-kicker">AIR QUALITY OUTLOOK</span><h3>Next 12 hours</h3></div><span className="mini-icon"><Activity size={17}/></span></div>
          <div className="chart-wrap">{chartData.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><defs><linearGradient id="aqiFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#39d6b0" stopOpacity={0.28}/><stop offset="100%" stopColor="#39d6b0" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#203543" vertical={false}/><XAxis dataKey="hour" tick={{ fill: "#8196a5", fontSize: 10 }} axisLine={false} tickLine={false}/><YAxis width={28} tick={{ fill: "#8196a5", fontSize: 10 }} axisLine={false} tickLine={false}/><Tooltip contentStyle={{ background: "#102433", border: "1px solid #294253", borderRadius: 10, color: "#fff" }}/><Area type="monotone" dataKey="aqi" stroke="#39d6b0" strokeWidth={2.5} fill="url(#aqiFill)" connectNulls/></AreaChart></ResponsiveContainer> : <div className="chart-empty">{loading ? "Loading forecast…" : "Hourly outlook unavailable"}</div>}</div>
          <div className="chart-legend"><span><i/> AQI forecast</span><span className="muted">Model forecast · not a station reading</span></div>
        </div>
      </section>
      <section className="section-block"><div className="section-header"><div><span className="section-kicker">WHAT'S IN THE AIR</span><h2>Pollutant breakdown</h2></div><span className="muted">Concentration · µg/m³ where applicable</span></div>
        <div className="pollutant-grid">
          <Pollutant name="PM2.5" value={air?.pollutants.pm25} unit="µg/m³" icon={<Cloud/>} desc="Fine particles"/>
          <Pollutant name="PM10" value={air?.pollutants.pm10} unit="µg/m³" icon={<Wind/>} desc="Coarse particles"/>
          <Pollutant name="Ozone" value={air?.pollutants.ozone} unit="µg/m³" icon={<Activity/>} desc="Ground-level O₃"/>
          <Pollutant name="Nitrogen dioxide" value={air?.pollutants.nitrogenDioxide} unit="µg/m³" icon={<Cloud/>} desc="Traffic-related gas"/>
        </div>
      </section>
      <section className="section-block assistant-section"><div className="section-header"><div><span className="section-kicker">YOUR PERSONAL AIR GUIDE</span><h2>Ask AirSense AI</h2><p className="muted">Grounded in local readings and your activity context.</p></div><div className="ai-mark"><Bot size={20}/> AI POWERED</div></div>
        <div className="assistant-card">
          <div className="profile-row"><div className="profile-heading"><HeartPulse size={17}/><b>Personalize your guidance</b></div><div className="profile-controls"><label>Activity<select value={profile.activity} onChange={e => setProfile({...profile, activity:e.target.value})}><option value="running">Running</option><option value="cycling">Cycling</option><option value="outdoor workout">Outdoor workout</option><option value="sports">Sports</option><option value="commuting">Commuting</option><option value="daily activities">Daily activities</option><option value="children's outdoor play">Children's outdoor play</option></select></label><label>Profile<select value={profile.ageGroup} onChange={e => setProfile({...profile, ageGroup:e.target.value})}><option value="adult">Adult</option><option value="child">Child</option><option value="older adult">Older adult</option></select></label><label>Sensitivity<select value={profile.sensitivity} onChange={e => setProfile({...profile, sensitivity:e.target.value})}><option value="general">General</option><option value="respiratory sensitivity">Respiratory sensitivity</option><option value="heart or lung condition">Heart/lung condition</option></select></label></div></div>
          <div className="prompt-list">{prompts.map(p => <button key={p} onClick={() => submit(p)}>{p}<ArrowUpRight size={13}/></button>)}</div>
          {decision && <div className="decision-card">
            <div className="decision-top">
              <span className={`risk-pill ${decision.overallRisk}`}>{decision.overallRisk.replace("_", " ").toUpperCase()}</span>
              <span className={`rec-pill ${decision.activityRecommendation}`}>{decision.activityRecommendation.replace("_", " ").toUpperCase()}</span>
              <span className="muted" style={{fontSize: "0.75rem"}}>{decision.dataFreshness.label}</span>
            </div>
            <p className="decision-action">{decision.recommendedAction}</p>
            <p className="decision-reasoning">{decision.reasoning}</p>
            {decision.sensitiveGroupAdvice !== "No additional sensitivity concerns for this profile." && <p className="decision-sensitive">{decision.sensitiveGroupAdvice}</p>}
            {decision.activityRecommendation !== "suitable" && <p className="decision-alt"><b>Alternative:</b> {decision.alternativeActivity}</p>}
            <p className="decision-limitations">{decision.limitations}</p>
          </div>}
          {answer && <div className="answer-box"><div className="answer-title"><Bot size={16}/> AirSense says <span>{mode === "ai" ? "GENERATIVE AI" : "SAFETY ENGINE"}</span></div><p>{answer}</p></div>}
          <form className="chat-input" onSubmit={e => {e.preventDefault(); submit();}}><input value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask about your air quality, activities or precautions…" aria-label="Ask AirSense AI"/><button disabled={thinking || !air} aria-label="Send question">{thinking ? <RefreshCw className="spin" size={17}/> : <Send size={17}/>}</button></form>
          <div className="disclaimer">Guidance is informational, not medical advice. Follow local public-health advisories.</div>
        </div>
      </section>
      <footer><span><Leaf size={14}/> Make every breath count.</span><span>Data: Open-Meteo · Powered by CAMS · <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Data attribution</a></span></footer>
    </main>
  </div>;
}
function Pollutant({name,value,unit,icon,desc}:{name:string;value:number|null|undefined;unit:string;icon:React.ReactNode;desc:string}) {
  return <div className="pollutant-card"><div className="pollutant-top"><span className="pollutant-icon">{icon}</span><span className="muted">{desc}</span></div><div className="pollutant-value">{value == null ? "—" : Number(value).toFixed(1)} <small>{unit}</small></div><b>{name}</b></div>;
}
export default App;
