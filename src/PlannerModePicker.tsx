import { Clock, Users } from "lucide-react";
import { PLANNER_MODES, type PlannerMode } from "./planner-mode";

const ICONS = { self: Clock, family: Users } as const;

export default function PlannerModePicker({ mode, onChange }: { mode: PlannerMode | null; onChange: (mode: PlannerMode) => void }) {
  return <section className="planner-picker" aria-labelledby="planner-title">
    <h2 className="section-kicker" id="planner-title">PLAN YOUR DAY</h2>
    <div className="planner-cards">
      {PLANNER_MODES.map((item) => {
        const Icon = ICONS[item.id];
        const selected = item.id === mode;
        return <button
          key={item.id}
          type="button"
          className={`planner-card${selected ? " selected" : ""}`}
          aria-pressed={selected}
          onClick={() => onChange(item.id)}
        >
          <span className="planner-card-icon" aria-hidden="true"><Icon size={20}/></span>
          <span className="planner-card-copy">
            <b>{item.title}</b>
            <small>{item.description}</small>
          </span>
        </button>;
      })}
    </div>
    {mode === null && <p className="planner-hint">Choose a card to see its plan.</p>}
  </section>;
}
