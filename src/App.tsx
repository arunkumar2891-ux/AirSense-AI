import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, Bot, Cloud, Compass, Crosshair, HeartPulse, Leaf, MapPin, MessageCircle, RefreshCw, Send, ShieldCheck, Wind } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { askAssistant, getAirQuality } from "./api";
import type { AirData, Profile } from "./types";

const fallbackCity = { name: "Hyderabad", lat: 17.385, lon: 78.4867 };
const prompts = ["Is it safe to go for a run?", "What precautions should my family take?", "Explain today's pollution levels"];
function App() {
  const [city, setCity] = useState(fallbackCity.name);
  const [coords, setCoords] = useState({ lat: fallbackCity.lat, lon: fallbackCity.lon });
  const [air, setAir] = useState<AirData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<Profile>({ activity: "running", ageGroup: "adult", sensitivity: "general" });
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [thinking, setThinking] = useState(false);
  const [mode, setMode] = useState("");

  async function refresh(lat = coords.lat, lon = coords.lon) {
    setLoading(true); setError("");
    try { const data = await getAirQuality(lat, lon); setAir(data); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load data."); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);
  const chartData = useMemo(() => air?.hourly.map((item) => ({ ...item, hour: new Date(item.time).toLocaleTimeString([], { hour: "numeric" }) })) || [], [air]);

  function useMyLocation() {
    if (!navigator.geolocation) { setError("Location is not supported by this browser."); return; }
    navigator.geolocation.getCurrentPosition((position) => {
      const next = { lat: position.coords.latitude, lon: position.coords.longitude };
      setCoords(next); setCity("Your location"); refresh(next.lat, next.lon);
    }, () => setError("Location permission was not granted. Showing the selected city instead."));
  }
  function selectCity(value: string) {
    const cities: Record<string, { name: string; lat: number; lon: number }> = {
      Hyderabad: fallbackCity, Delhi: { name: "Delhi", lat: 28.6139, lon: 77.209 },
      Mumbai: { name: "Mumbai", lat: 19.076, lon: 72.8777 }, Bengaluru: { name: "Bengaluru", lat: 12.9716, lon: 77.5946 },
      Chennai: { name: "Chennai", lat: 13.0827, lon: 80.2707 }, Pune: { name: "Pune", lat: 18.5204, lon: 73.8567 }
    };
    if (value === "Your location") return;
    const item = cities[value]; if (!item) return; setCity(item.name); setCoords({ lat: item.lat, lon: item.lon }); refresh(item.lat, item.lon);
  }
  async function submit(q = question) {
    if (!q.trim() || !air) return;
    setThinking(true); setAnswer("");
    try { const result = await askAssistant(q, profile, air); setAnswer(result.answer); setMode(result.mode); }
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
      <div className="sidebar-bottom"><div className="privacy"><ShieldCheck size={16}/><div><b>Privacy first</b><small>Location is used only to fetch local air data.</small></div></div><small className="version">AIRSENSE AI · HACKATHON EDITION</small></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><div className="eyebrow">WEDNESDAY, NOVEMBER 25, 2026</div><h1>Your air, decoded.</h1></div><div className="top-actions"><button className="outline-btn" onClick={useMyLocation}><Crosshair size={15}/> Use my location</button><button className="icon-btn" aria-label="Refresh air quality" onClick={() => refresh()}><RefreshCw size={17}/></button><div className="avatar">A</div></div></header>
      <section className="location-row"><div className="location-title"><MapPin size={16}/><select value={city} onChange={(e) => selectCity(e.target.value)} aria-label="Select city"><option>Hyderabad</option><option>Delhi</option><option>Mumbai</option><option>Bengaluru</option><option>Chennai</option><option>Pune</option><option>Your location</option></select><span className="live-pill"><i/> LIVE DATA</span></div><span className="muted">{air?.observedAt ? `Updated ${new Date(air.observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Waiting for data"}</span></section>
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
          <div className="profile-row"><div className="profile-heading"><HeartPulse size={17}/><b>Personalize your guidance</b></div><div className="profile-controls"><label>Activity<select value={profile.activity} onChange={e => setProfile({...profile, activity:e.target.value})}><option value="running">Running</option><option value="cycling">Cycling</option><option value="outdoor workout">Outdoor workout</option><option value="sports">Sports</option><option value="commuting">Commuting</option><option value="daily activities">Daily activities</option></select></label><label>Profile<select value={profile.ageGroup} onChange={e => setProfile({...profile, ageGroup:e.target.value})}><option value="adult">Adult</option><option value="child">Child</option><option value="older adult">Older adult</option></select></label><label>Sensitivity<select value={profile.sensitivity} onChange={e => setProfile({...profile, sensitivity:e.target.value})}><option value="general">General</option><option value="respiratory sensitivity">Respiratory sensitivity</option><option value="heart or lung condition">Heart/lung condition</option></select></label></div></div>
          <div className="prompt-list">{prompts.map(p => <button key={p} onClick={() => submit(p)}>{p}<ArrowUpRight size={13}/></button>)}</div>
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
