import { Clock, Users } from "lucide-react";
import { PLANNER_MODES, type PlannerMode } from "./planner-mode";

const ICONS = { self: Clock, family: Users } as const;

export default function PlannerModePicker({ mode, onChange }: { mode: PlannerMode | null; onChange: (mode: PlannerMode) => void }) {
  return <fieldset className="planner-picker">
    <legend className="section-kicker">PLAN YOUR DAY</legend>
    <div className="planner-cards">
      {PLANNER_MODES.map((item) => {
        const Icon = ICONS[item.id];
        const selected = item.id === mode;
        return <label key={item.id} className={`planner-card${selected ? " selected" : ""}`}>
          <input
            className="planner-radio"
            type="radio"
            name="planner-mode"
            value={item.id}
            checked={selected}
            onChange={() => onChange(item.id)}
          />
          <span className="planner-card-icon" aria-hidden="true"><Icon size={20}/></span>
          <span className="planner-card-copy">
            <b>{item.title}</b>
            <small>{item.description}</small>
          </span>
          <span className="planner-card-mark" aria-hidden="true"/>
        </label>;
      })}
    </div>
    {mode === null && <p className="planner-hint">Choose one to see its plan.</p>}
  </fieldset>;
}
