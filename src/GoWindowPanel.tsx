import { Clock } from "lucide-react";
import type { GoWindowResponse, GoWindowTimePreference, Profile } from "./types";
import CollapsibleSection from "./CollapsibleSection";
import { GO_WINDOW_DURATIONS, GO_WINDOW_TIME_PREFERENCES, presentGoWindow } from "./gowindow";
import ActivityTimeline from "./ActivityTimeline";
import type { TimelineHourReading } from "./timeline";

const activities = [
  ["running", "Running"], ["cycling", "Cycling"], ["outdoor workout", "Outdoor workout"],
  ["sports", "Sports"], ["commuting", "Commuting"], ["daily activities", "Daily activities"],
  ["children's outdoor play", "Children's outdoor play"],
] as const;
const ageGroups = [["adult", "Adult"], ["child", "Child"], ["older adult", "Older adult"]] as const;
const sensitivities = [
  ["general", "General"], ["respiratory sensitivity", "Respiratory sensitivity"],
  ["heart or lung condition", "Heart/lung condition"],
] as const;

type Props = {
  locationLabel: string;
  profile: Profile;
  onProfileChange: (profile: Profile) => void;
  duration: number;
  onDurationChange: (duration: number) => void;
  timePreference: GoWindowTimePreference;
  onTimePreferenceChange: (timePreference: GoWindowTimePreference) => void;
  loading: boolean;
  error: string;
  result: GoWindowResponse | null;
  hourly: TimelineHourReading[];
  timezone: string | null;
  onFind: () => void;
  canReset: boolean;
  onReset: () => void;
  expanded: boolean;
  onToggle: () => void;
};

export default function GoWindowPanel({
  locationLabel, profile, onProfileChange, duration, onDurationChange, timePreference, onTimePreferenceChange, loading, error, result, hourly, timezone, onFind, canReset, onReset, expanded, onToggle,
}: Props) {
  const display = presentGoWindow(result);
  return <CollapsibleSection
    id="gowindow"
    titleId="gowindow-title"
    className="section-block gowindow-section"
    expanded={expanded}
    onToggle={onToggle}
    header={<>
      <span className="section-toggle-copy">
        <span className="section-kicker">FORECAST PLANNING</span>
        <span className="section-title" id="gowindow-title">GoWindow – Find your best time to go outside</span>
        <span className="section-summary">Plan your outdoor activities around forecast air quality and weather.</span>
      </span>
      <span className="forecast-note"><Clock size={15} aria-hidden="true"/> Forecast estimate</span>
    </>}
  >
    <div className="gowindow-panel">
      <div className="gowindow-intro">
        <h3>When is the best time for me to go outside today?</h3>
        <p>GoWindow uses the selected location, {locationLabel}, and the activity profile below. Preferred times use that location's timezone. It does not replace the current air-quality reading.</p>
      </div>
      <div className="profile-controls gowindow-controls">
        <label>Activity
          <select aria-label="Activity" value={profile.activity} onChange={(event) => onProfileChange({ ...profile, activity: event.target.value })}>
            {activities.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Age group
          <select aria-label="Age group" value={profile.ageGroup} onChange={(event) => onProfileChange({ ...profile, ageGroup: event.target.value })}>
            {ageGroups.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Sensitivity
          <select aria-label="Sensitivity" value={profile.sensitivity} onChange={(event) => onProfileChange({ ...profile, sensitivity: event.target.value })}>
            {sensitivities.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Duration
          <select aria-label="Activity duration" value={duration} onChange={(event) => onDurationChange(Number(event.target.value))}>
            {GO_WINDOW_DURATIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
          </select>
        </label>
        <label className="time-preference">Preferred time
          <select aria-label="Preferred time of day" value={timePreference} onChange={(event) => onTimePreferenceChange(event.target.value as GoWindowTimePreference)}>
            {GO_WINDOW_TIME_PREFERENCES.map((item) => <option key={item.id} value={item.id}>{item.optionLabel}</option>)}
          </select>
        </label>
      </div>
      <div className="gowindow-actions">
        <button className="primary-btn" type="button" onClick={onFind} disabled={loading} aria-busy={loading}>
          {loading ? "Finding your best time…" : "Find my best time"}
        </button>
        {canReset && <button className="quiet-btn" type="button" onClick={onReset}>Reset activity settings</button>}
        <p>Results are forecast estimates, not guarantees or medical clearance.</p>
      </div>
      <ActivityTimeline hourly={hourly} timezone={timezone} timePreference={timePreference} result={loading ? null : result} />
      <div className="gowindow-results" aria-live="polite">
        {!loading && !error && display && display.state !== "invalid" && display.retrievalLines.length > 0 && <div className="gowindow-retrieval">
          <ul aria-label="Retrieval times">
            {display.retrievalLines.map((line) => <li key={line.source} className={`gowindow-retrieval-${line.tone}`}>{line.text}</li>)}
          </ul>
          {display.policyNote && <p className="gowindow-limitations">{display.policyNote}</p>}
        </div>}
        {loading && <p className="gowindow-status" role="status">Checking the forecast for a suitable time.</p>}
        {error && <div className="gowindow-state error" role="alert"><b>Activity window unavailable</b><span>{error}</span></div>}
        {!loading && !error && display?.state === "suitable_windows" && <>
          <p className="gowindow-status">Forecast windows for {display.windows[0].activity}, {display.windows[0].durationMinutes} minutes{display.preferenceLabel ? `, ${display.preferenceLabel}` : ""}.</p>
          <div className="gowindow-grid">
            {display.windows.map((window) => <article key={window.rank} className={window.best ? "gowindow-card best" : "gowindow-card"} aria-label={window.best ? "Best forecast window" : `Forecast window ${window.rank}`}>
              <div className="gowindow-card-top">
                <span className={window.best ? "rank-mark best" : "rank-mark"}>{window.best ? "Best forecast window" : `Rank ${window.rank}`}</span>
                <b>{window.time}</b>
              </div>
              <p>{window.activity} · {window.durationMinutes} minutes</p>
              <dl>
                <div><dt>Forecast AQI</dt><dd>{window.aqi}</dd></div>
                <div><dt>PM2.5</dt><dd>{window.pm25}</dd></div>
                <div><dt>Weather</dt><dd>{window.weather}</dd></div>
              </dl>
              <p className="gowindow-reason">{window.rankReason}</p>
              <p className="recommendation-label">{window.recommendationLabel}</p>
              <p className="muted">{window.freshness}</p>
              <p className="gowindow-limitations">{window.limitations}</p>
            </article>)}
          </div>
          {display.sourceDisclosure && <p className="gowindow-limitations">{display.sourceDisclosure}</p>}
          <p className="gowindow-limitations">{display.limitations}</p>
        </>}
        {!loading && !error && display?.state === "outside_preference" && <div className="gowindow-alternatives">
          <div className="gowindow-state" role="status">
            <b>{display.title}</b>
            <span>{display.message}</span>
            <span>{display.detail}</span>
            <span>{display.guidance}</span>
          </div>
          <h4>Alternatives outside {display.preferenceLabel || "the selected time"}</h4>
          <div className="gowindow-grid">
            {display.alternatives.map((window) => <article key={window.rank} className="gowindow-card alternative" aria-label={`Alternative window ${window.rank} outside the preferred time`}>
              <div className="gowindow-card-top">
                <span className="rank-mark">Alternative {window.rank}</span>
                <b>{window.time}</b>
              </div>
              <p>{window.activity} · {window.durationMinutes} minutes</p>
              <dl>
                <div><dt>Forecast AQI</dt><dd>{window.aqi}</dd></div>
                <div><dt>PM2.5</dt><dd>{window.pm25}</dd></div>
                <div><dt>Weather</dt><dd>{window.weather}</dd></div>
              </dl>
              <p className="gowindow-reason">{window.rankReason}</p>
              <p className="recommendation-label">{window.recommendationLabel}</p>
              <p className="muted">{window.freshness}</p>
              <p className="gowindow-limitations">{window.limitations}</p>
            </article>)}
          </div>
          {display.sourceDisclosure && <p className="gowindow-limitations">{display.sourceDisclosure}</p>}
          <p className="gowindow-limitations">{display.limitations}</p>
        </div>}
        {!loading && !error && display?.state === "no_suitable_window" && <div className="gowindow-state" role="status">
          <b>{display.title}</b>
          <span>{display.message}</span>
          <span>{display.detail}</span>
          <span>{display.guidance}</span>
          {display.sourceDisclosure && <span className="gowindow-limitations">{display.sourceDisclosure}</span>}
          <span className="gowindow-limitations">{display.limitations}</span>
        </div>}
        {!loading && !error && display?.state === "insufficient_data" && <div className="gowindow-state" role="status">
          <b>{display.title}</b>
          <span>{display.message}</span>
          <span>{display.detail}</span>
          <span>{display.guidance}</span>
          {display.sourceDisclosure && <span className="gowindow-limitations">{display.sourceDisclosure}</span>}
          <span className="gowindow-limitations">{display.limitations}</span>
        </div>}
        {!loading && !error && display?.state === "invalid" && <div className="gowindow-state error" role="alert"><b>Activity window unavailable</b><span>{display.message}</span></div>}
        {!loading && !error && !display && <p className="gowindow-status">Choose a duration, then find the best forecast window for this activity.</p>}
      </div>
    </div>
  </CollapsibleSection>;
}
