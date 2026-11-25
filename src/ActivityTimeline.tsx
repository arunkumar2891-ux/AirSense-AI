import { useMemo, useState, type KeyboardEvent } from "react";
import type { GoWindowResponse, GoWindowTimePreference } from "./types";
import { buildActivityTimeline, type TimelineHourReading } from "./timeline";

type Props = {
  hourly: TimelineHourReading[];
  timezone: string | null;
  timePreference: GoWindowTimePreference;
  result: GoWindowResponse | null;
};

const LEGEND = [
  ["good", "Good"],
  ["caution", "Moderate or sensitive"],
  ["high", "Unhealthy or higher"],
  ["missing", "No forecast"],
  ["preference", "Preferred time"],
  ["recommended", "Recommended window"],
  ["alternative", "Alternative window"],
  ["now", "Current time"],
] as const;

export default function ActivityTimeline({ hourly, timezone, timePreference, result }: Props) {
  const minute = Math.floor(Date.now() / 60000);
  const timeline = useMemo(
    () => buildActivityTimeline({ hourly, timezone, timePreference, result, now: minute * 60000 }),
    [hourly, timezone, timePreference, result, minute],
  );
  const resultKey = result
    ? `${result.status}|${result.evaluatedAt}|${result.timePreference}|${(result.windows || []).map((window) => `${window.placement || "preferred"}:${window.start}`).join(",")}`
    : "";
  const [seenKey, setSeenKey] = useState(resultKey);
  const [pickedId, setPickedId] = useState<string | null>(null);
  if (seenKey !== resultKey) {
    setSeenKey(resultKey);
    setPickedId(null);
  }
  if (!timeline) {
    return <p className="gowindow-status">The activity timeline could not be drawn for this forecast.</p>;
  }
  const model = timeline;
  const selected = model.windows.find((window) => window.id === pickedId)
    || model.windows.find((window) => window.placement === "preferred")
    || null;

  function moveSelection(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
    if (!direction || model.windows.length === 0) return;
    event.preventDefault();
    const next = model.windows[(index + direction + model.windows.length) % model.windows.length];
    setPickedId(next.id);
    document.getElementById(next.domId)?.focus();
  }

  return <section className="activity-timeline" aria-labelledby="activity-timeline-title">
    <div className="timeline-heading">
      <h3 id="activity-timeline-title">Next 12 hours</h3>
      <p>{timeline.summary}</p>
      <p>{timeline.preferenceCaption}</p>
      <p className="timeline-now-text">{timeline.nowDescription}</p>
    </div>
    <ul className="timeline-legend" aria-label="Timeline legend">
      {LEGEND.map(([tone, label]) => <li key={tone}><i className={`timeline-swatch ${tone}`} aria-hidden="true" />{label}</li>)}
    </ul>
    <div className="timeline-scroll" tabIndex={0} role="region" aria-label={`12-hour forecast timeline in ${timeline.timezone}. Scroll horizontally for later hours.`}>
      <div className="timeline-board">
        <div className="timeline-scale">
        <ol className="timeline-hours">
          {timeline.hours.map((hour) => <li
            key={hour.start}
            className={`timeline-hour ${hour.tone} ${hour.forecastState} ${hour.inPreference ? "in-preference" : "outside-preference"} role-${hour.windowRole}`}
          >
            {hour.showDate && <span className="timeline-date">{hour.dateLabel}</span>}
            <span className="timeline-clock">{hour.label}</span>
            <span className="timeline-category">{hour.categoryLabel}</span>
            {hour.forecastState === "available" && hour.aqi !== null && <span className="timeline-value">US AQI {Number.isInteger(hour.aqi) ? hour.aqi : Math.round(hour.aqi * 10) / 10}</span>}
            <span className="timeline-pm">{hour.forecastState === "missing" ? "Not estimated" : hour.pm25Text}</span>
            {timePreference !== "any" && <span className="timeline-range">{hour.inPreference ? "In range" : "Outside range"}</span>}
            {hour.windowRole === "preferred" && <span className="timeline-mark">Recommended</span>}
            {hour.windowRole === "alternative" && <span className="timeline-mark alt">Alternative</span>}
            {hour.windowRole === "both" && <span className="timeline-mark">Recommended and alternative</span>}
            {hour.windowRole === "none" && <span className="sr-only">No recommended window was returned for this hour.</span>}
          </li>)}
        </ol>
        <div className="timeline-now" style={{ left: `${timeline.nowPercent}%` }} aria-hidden="true"><span>Now</span></div>
        <div className="timeline-lane" aria-hidden="true">
          {timeline.windows.filter((window) => window.visible).map((window) => <span
            key={window.id}
            className={`timeline-span ${window.placement} ${window.best ? "best" : ""} ${selected?.id === window.id ? "is-selected" : ""}`}
            style={{ left: `${window.leftPercent}%`, width: `${window.widthPercent}%` }}
          >
            <span>{window.shortLabel}</span>
          </span>)}
        </div>
        </div>
      </div>
    </div>
    <div className="timeline-picker-block">
      <h4>{timeline.windows.some((window) => window.placement === "preferred") ? "Windows returned by the forecast" : timeline.windows.length ? "Alternatives returned by the forecast" : "Scheduler windows"}</h4>
      {timeline.windows.length === 0
        ? <p>{timeline.emptyWindowsMessage}</p>
        : <ul className="timeline-picker">
          {timeline.windows.map((window, index) => <li key={window.id}><button
            id={window.domId}
            type="button"
            className={`timeline-pick ${window.placement} ${window.best ? "best" : ""}`}
            aria-pressed={selected?.id === window.id}
            aria-controls="timeline-detail"
            aria-label={window.buttonLabel}
            onClick={() => setPickedId(window.id)}
            onKeyDown={(event) => moveSelection(event, index)}
          >
            <span className={window.best ? "rank-mark best" : "rank-mark"}>{window.shortLabel}</span>
            <b>{window.time}</b>
            {!window.visible && <span className="timeline-offscreen">Outside the displayed 12 hours</span>}
          </button></li>)}
        </ul>}
    </div>
    <div id="timeline-detail" className="timeline-detail" aria-live="polite">
      {selected ? <article className={selected.placement === "alternative" ? "gowindow-card alternative" : selected.best ? "gowindow-card best" : "gowindow-card"} aria-label={`${selected.shortLabel} details`}>
        <div className="gowindow-card-top">
          <span className={selected.best ? "rank-mark best" : "rank-mark"}>{selected.shortLabel}</span>
          <b>{selected.time}</b>
        </div>
        <p>{selected.activity} · {selected.durationMinutes} minutes</p>
        {selected.caveat && <p className="timeline-caveat">{selected.caveat}</p>}
        <dl>
          <div><dt>Start and end</dt><dd>{selected.time}</dd></div>
          <div><dt>Duration</dt><dd>{selected.durationMinutes} minutes</dd></div>
          <div><dt>Forecast AQI</dt><dd>{selected.aqi}</dd></div>
          <div><dt>PM2.5</dt><dd>{selected.pm25}</dd></div>
          <div><dt>Weather</dt><dd>{selected.weather}</dd></div>
        </dl>
        <p className="gowindow-reason">{selected.rankReason}</p>
        <p className="recommendation-label">{selected.recommendationLabel}</p>
        <p className="muted">{selected.freshness}</p>
        <p className="gowindow-limitations">{selected.limitations}</p>
      </article> : <p>Select a recommended window to see its start, end, duration, forecast US AQI, PM2.5, weather, and ranking explanation. Hours cannot be selected as activities unless the scheduler returned a window.</p>}
    </div>
  </section>;
}
