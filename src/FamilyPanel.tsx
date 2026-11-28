import { Users } from "lucide-react";
import CollapsibleSection from "./CollapsibleSection";
import type { FamilyGuidanceCard, FamilyPlanResponse, GoWindowTimePreference } from "./types";
import {
  FAMILY_ROUTINES,
  FAMILY_SENSITIVITIES,
  impactTypeLabel,
  presentFamilyPlan,
  sharedOutingActivity,
  validateFamilyDraft,
  type FamilyDraft,
} from "./family";
import { GO_WINDOW_TIME_PREFERENCES, presentGoWindow } from "./gowindow";

type Props = {
  locationLabel: string;
  household: FamilyDraft;
  onHouseholdChange: (household: FamilyDraft) => void;
  loading: boolean;
  error: string;
  result: FamilyPlanResponse | null;
  now: number;
  onPlan: () => void;
  explainLoading: boolean;
  explainError: string;
  onExplain: () => void;
  canReset: boolean;
  onReset: () => void;
  expanded: boolean;
  onToggle: () => void;
};

function GuidanceCards({ cards, label }: { cards: FamilyGuidanceCard[]; label: string }) {
  if (!cards.length) return <p>No recommendation in this group applies to the configured routines.</p>;
  return <ul className="family-guidance" aria-label={label}>
    {cards.map((card) => <li key={card.id} className="family-guidance-card">
      <h4>{card.title}</h4>
      <p>{card.description}</p>
      <p><b>Why it may help.</b> {card.whyItHelps}</p>
      <p><b>Impact.</b> {impactTypeLabel(card.impactType)}</p>
      <p className="family-disclaimer">{card.limitations}</p>
    </li>)}
  </ul>;
}

const counts = [
  ["youngChildren", "Young children", "Young children count"],
  ["olderChildren", "Older children", "Older children count"],
  ["adults", "Adults", "Adults count"],
  ["olderAdults", "Older adults", "Older adults count"],
] as const;

export default function FamilyPanel({
  locationLabel, household, onHouseholdChange, loading, error, result, now, onPlan,
  explainLoading, explainError, onExplain, canReset, onReset, expanded, onToggle,
}: Props) {
  const validation = validateFamilyDraft(household);
  const view = presentFamilyPlan(result);
  const schedule = view.ok ? presentGoWindow(result?.schedule ?? null, now) : null;
  const routineLimitReached = household.routines.length >= 4;

  function setCount(field: typeof counts[number][0], raw: string) {
    const value = raw === "" ? 0 : Number(raw);
    onHouseholdChange({ ...household, [field]: value });
  }

  function toggleRoutine(routine: FamilyDraft["routines"][number]) {
    const selected = household.routines.includes(routine);
    const routines = selected
      ? household.routines.filter((item) => item !== routine)
      : [...household.routines, routine];
    onHouseholdChange({ ...household, routines });
  }

  return <CollapsibleSection
    id="family"
    titleId="family-title"
    className="section-block family-section"
    expanded={expanded}
    onToggle={onToggle}
    header={<>
      <span className="section-toggle-copy">
        <span className="section-kicker">HOUSEHOLD PLANNING</span>
        <span className="section-title" id="family-title">Family air plan</span>
        <span className="section-summary">Plan one shared outing for this household. It uses the selected location, {locationLabel}, and does not change the GoWindow activity profile.</span>
      </span>
      <span className="forecast-note"><Users size={15} aria-hidden="true"/> Household plan</span>
    </>}
  >
    <div className="family-panel">
      <form onSubmit={(event) => { event.preventDefault(); onPlan(); }}>
        <fieldset className="family-counts">
          <legend>Household</legend>
          <p id="family-child-profile">Young children and older children both use the existing child safety profile. There is no separate child score.</p>
          <div className="family-count-grid">
            {counts.map(([field, label, aria]) => <label key={field}>{label}
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={8}
                step={1}
                aria-label={aria}
                aria-describedby={field.includes("Children") ? "family-child-profile" : undefined}
                value={household[field]}
                onChange={(event) => setCount(field, event.target.value)}
              />
            </label>)}
          </div>
        </fieldset>
        <label className="family-field">Sensitivity
          <select
            aria-label="Sensitivity"
            value={household.sensitivity}
            onChange={(event) => onHouseholdChange({ ...household, sensitivity: event.target.value as FamilyDraft["sensitivity"] })}
          >
            {FAMILY_SENSITIVITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <small>Optional. Uses an existing exposure profile, not a diagnosis or medical history.</small>
        </label>
        <fieldset className="family-routines">
          <legend>Daily routines</legend>
          <div className="family-routine-grid">
            {FAMILY_ROUTINES.map(([value, label]) => {
              const checked = household.routines.includes(value);
              return <label key={value}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && routineLimitReached}
                  onChange={() => toggleRoutine(value)}
                />
                {label}
              </label>;
            })}
          </div>
          <small>Choose at most 4. Names, dates of birth, addresses, and medical descriptions are not collected.</small>
        </fieldset>
        <p className="family-disclaimer">Shared outing activity: {sharedOutingActivity(household)}. A household with a child uses children's outdoor play.</p>
        <div className="family-outing">
          <label>Outing duration in minutes
            <input
              type="number"
              inputMode="numeric"
              min={15}
              max={180}
              step={1}
              aria-label="Outing duration in minutes"
              value={household.durationMinutes}
              onChange={(event) => onHouseholdChange({ ...household, durationMinutes: event.target.value === "" ? 0 : Number(event.target.value) })}
            />
          </label>
          <label>Preferred time
            <select
              aria-label="Preferred time of day"
              value={household.timePreference}
              onChange={(event) => onHouseholdChange({ ...household, timePreference: event.target.value as GoWindowTimePreference })}
            >
              {GO_WINDOW_TIME_PREFERENCES.map((item) => <option key={item.id} value={item.id}>{item.optionLabel}</option>)}
            </select>
          </label>
        </div>
        {!validation.ok && <p className="family-validation" id="family-validation" role="status">{validation.error}</p>}
        <div className="family-actions">
          <button className="primary-btn" type="submit" disabled={loading || !validation.ok} aria-busy={loading}>
            {loading ? "Getting the latest plan…" : "Get the Latest Plan"}
          </button>
          {canReset && <button className="quiet-btn" type="button" onClick={onReset}>Reset household</button>}
          <p>The plan is a modelled forecast estimate. It is not medical advice or a street-level measurement.</p>
        </div>
      </form>
      <div className="family-results" aria-live="polite">
        {loading && <p className="family-status" role="status">Checking the household forecast.</p>}
        {error && <div className="family-state error" role="alert"><b>Family plan unavailable</b><span>{error}</span></div>}
        {!loading && !error && !result && <p className="family-status">Set the household, then choose Get the Latest Plan. No plan is shown until the forecast is checked.</p>}
        {!loading && !error && result && !view.ok && <div className="family-state error" role="alert"><b>Family plan unavailable</b><span>{view.message}</span></div>}
        {!loading && !error && view.ok && <>
          <section className="family-block" aria-labelledby="family-outdoor-title">
            <h3 id="family-outdoor-title">Outdoor exposure now</h3>
            <p className={`family-recommendation recommendation-${view.recommendation}`}>
              <b>{view.recommendationLabel}</b>
              <span>Risk: {view.riskLabel}</span>
            </p>
            <p>Outing: {view.outingProfile}</p>
            {view.members.length > 0 && <ul className="family-members" aria-label="Result for each household member group">
              {view.members.map((member) => <li key={member.key}>
                <b>{member.label}:</b> {member.recommendationLabel}{member.governs ? " (most protective, applies to the household)" : ""}
              </li>)}
            </ul>}
            <p>{view.action}</p>
            <p>{view.reasoning}</p>
            {view.factors.length > 0 && <ul aria-label="Decision trace">
              {view.factors.map((factor) => <li key={factor.factor}><b>{factor.factor}.</b> {factor.detail}</li>)}
            </ul>}
            <p className="family-disclaimer">{view.householdRuleNote}</p>
            {view.recommendation === "insufficient_data" && <p className="family-disclaimer">Insufficient data. No favorable outing is shown for this household.</p>}
          </section>
          <section className="family-block" aria-labelledby="family-windows-title">
            <h3 id="family-windows-title">Suitable outing windows</h3>
            {schedule?.state === "suitable_windows" && <ul className="family-windows">
              {schedule.windows.map((window) => <li key={window.rank}>
                <b>{window.best ? "Best forecast window" : `Rank ${window.rank}`}</b>
                <span>{window.time}</span>
                <span>{window.aqi}</span>
                <span>{window.pm25}</span>
                <span>{window.recommendationLabel}</span>
              </li>)}
            </ul>}
            {schedule && schedule.state !== "suitable_windows" && schedule.state !== "invalid" && <p>{schedule.title}. {schedule.message}</p>}
            {(!schedule || schedule.state === "invalid") && <p>No suitable outing window is shown.</p>}
          </section>
          {view.commute && <section className="family-block" aria-labelledby="family-commute-title">
            <h3 id="family-commute-title">{view.commute.label}</h3>
            <p>Does not apply to children.</p>
            <p><b>{view.commute.recommendationLabel}</b></p>
            <p>{view.commute.action}</p>
          </section>}
          <section className="family-block" aria-labelledby="family-travel-title">
            <h3 id="family-travel-title">Walking and cycling</h3>
            {(["walking", "cycling"] as const).map((mode) => {
              const travel = view[mode];
              return <div key={mode} className="family-travel">
                <p>{mode === "walking" ? "Walking" : "Cycling"}: {travel.eligibilityLabel}. Most protective recommendation: {travel.recommendationLabel}.</p>
                {travel.members.length > 1 && <ul className="family-members" aria-label={`${mode} result for each household member group`}>
                  {travel.members.map((member) => <li key={member.key}><b>{member.label}:</b> {member.recommendationLabel}</li>)}
                </ul>}
              </div>;
            })}
          </section>
          {view.explanation && <section className="family-block" aria-labelledby="family-explanation-title">
            <h3 id="family-explanation-title">Explanation of your family plan</h3>
            <p className="family-disclaimer">This explanation describes the family plan. It does not choose the safety decision.</p>
            {view.explanation.label && <p className="family-explanation-label">{view.explanation.label}</p>}
            <p>{view.explanation.text}</p>
          </section>}
          {explainLoading && <p className="family-status" role="status">Writing the AI explanation.</p>}
          {explainError && <div className="family-state error" role="alert"><b>AI explanation unavailable</b><span>{explainError}</span></div>}
          <div className="family-actions">
            <button className="primary-btn" type="button" onClick={onExplain} disabled={explainLoading || !validation.ok} aria-busy={explainLoading}>
              Explain using AI
            </button>
          </div>
          <section className="family-block" aria-labelledby="family-indoor-title">
            <h3 id="family-indoor-title">At-home air-quality guidance</h3>
            <p className="family-disclaimer">{view.indoor.statement}</p>
            <GuidanceCards cards={view.indoor.recommendations} label="At-home air-quality guidance" />
          </section>
          <section className="family-block" aria-labelledby="family-routines-title">
            <h3 id="family-routines-title">Daily routine recommendations</h3>
            <GuidanceCards cards={view.routines} label="Daily routine recommendations" />
          </section>
          <section className="family-block" aria-labelledby="family-sustainable-title">
            <h3 id="family-sustainable-title">Sustainable alternatives</h3>
            <p className="family-disclaimer">{view.sustainable.statement}</p>
            <GuidanceCards cards={view.sustainable.recommendations} label="Sustainable alternatives" />
          </section>
          <section className="family-block" aria-labelledby="family-impact-title">
            <h3 id="family-impact-title">Why these actions help</h3>
            <GuidanceCards cards={view.impacts} label="Why these actions help" />
          </section>
          <section className="family-block" aria-labelledby="family-limits-title">
            <h3 id="family-limits-title">Forecast limitations</h3>
            <ul className="family-limitations">
              {view.limitations.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        </>}
      </div>
    </div>
  </CollapsibleSection>;
}
