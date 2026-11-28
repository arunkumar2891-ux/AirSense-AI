export const SECTION_IDS = ["gowindow", "family", "assistant"] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export type SectionExpanded = Record<SectionId, boolean>;

export const SECTION_STORAGE_KEY = "airsense.sections";

export const DEFAULT_SECTION_EXPANDED: SectionExpanded = {
  gowindow: false,
  family: false,
  assistant: false,
};

export const BACK_TO_TOP_THRESHOLD_PX = 480;

export function readSectionExpanded(storage: Pick<Storage, "getItem"> | null): SectionExpanded {
  const state = { ...DEFAULT_SECTION_EXPANDED };
  if (!storage) return state;
  try {
    const raw = storage.getItem(SECTION_STORAGE_KEY);
    if (!raw) return state;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return state;
    for (const id of SECTION_IDS) {
      if (typeof parsed[id] === "boolean") state[id] = parsed[id];
    }
    return state;
  } catch {
    return { ...DEFAULT_SECTION_EXPANDED };
  }
}

export function writeSectionExpanded(storage: Pick<Storage, "setItem"> | null, state: SectionExpanded) {
  if (!storage) return;
  const stored: SectionExpanded = { ...DEFAULT_SECTION_EXPANDED };
  for (const id of SECTION_IDS) stored[id] = state[id] === true;
  try {
    storage.setItem(SECTION_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* Session storage can be unavailable. The choice still applies in memory. */
  }
}

export function toggleSection(state: SectionExpanded, id: SectionId): SectionExpanded {
  return { ...state, [id]: !state[id] };
}

export function expandSection(state: SectionExpanded, id: SectionId): SectionExpanded {
  if (state[id]) return state;
  return { ...state, [id]: true };
}

export function sectionFromHash(hash: string): SectionId | null {
  const id = hash.replace(/^#/, "");
  return (SECTION_IDS as readonly string[]).includes(id) ? id as SectionId : null;
}

export function backToTopVisible(scrollY: number) {
  return Number.isFinite(scrollY) && scrollY >= BACK_TO_TOP_THRESHOLD_PX;
}

export function scrollTopBehavior(prefersReducedMotion: boolean): ScrollBehavior {
  return prefersReducedMotion ? "auto" : "smooth";
}
