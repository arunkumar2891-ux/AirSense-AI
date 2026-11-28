import type { SectionId } from "./sections";

export const PLANNER_MODE_KEY = "airsense.plannerMode";

export type PlannerMode = "self" | "family";

export const DEFAULT_PLANNER_MODE: PlannerMode = "self";

export const PLANNER_MODES: readonly {
  id: PlannerMode;
  title: string;
  description: string;
  sectionId: SectionId;
}[] = [
  {
    id: "self",
    title: "Plan the day for you",
    description: "Find the best time for your own outing with GoWindow.",
    sectionId: "gowindow",
  },
  {
    id: "family",
    title: "Plan the day for your entire family",
    description: "One air plan that checks every age group in your household.",
    sectionId: "family",
  },
];

export function readPlannerMode(raw: string | null | undefined): PlannerMode {
  return raw === "self" || raw === "family" ? raw : DEFAULT_PLANNER_MODE;
}

export function plannerModeForSection(id: SectionId): PlannerMode | null {
  return PLANNER_MODES.find((mode) => mode.sectionId === id)?.id ?? null;
}

export function plannerSectionForMode(mode: PlannerMode): SectionId {
  return (PLANNER_MODES.find((item) => item.id === mode) ?? PLANNER_MODES[0]).sectionId;
}
