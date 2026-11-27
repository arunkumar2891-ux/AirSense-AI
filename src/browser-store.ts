export type PreferenceStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// Preferences survive a closed tab. A value already saved for this tab is
// copied across once, then the tab copy is removed.
export function readPreference(local: PreferenceStore | null, session: PreferenceStore | null, key: string): string | null {
  try {
    const saved = local?.getItem(key);
    if (typeof saved === "string") return saved;
  } catch { /* the durable store is unavailable */ }
  try {
    const older = session?.getItem(key);
    if (typeof older !== "string") return null;
    try {
      local?.setItem(key, older);
      session?.removeItem(key);
    } catch { /* keep the tab copy when durable storage cannot be written */ }
    return older;
  } catch {
    return null;
  }
}

export function writePreference(local: PreferenceStore | null, session: PreferenceStore | null, key: string, value: string) {
  try { local?.setItem(key, value); } catch { /* the choice stays in memory */ }
  try { session?.removeItem(key); } catch { /* ignore */ }
}

export function removePreference(local: PreferenceStore | null, session: PreferenceStore | null, key: string) {
  try { local?.removeItem(key); } catch { /* ignore */ }
  try { session?.removeItem(key); } catch { /* ignore */ }
}
