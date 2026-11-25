import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "airsense.theme";

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    // Storage can be unavailable in privacy-restricted contexts.
  }
  return "system";
}

function resolveTheme(preference: ThemePreference, prefersDark: boolean) {
  return preference === "system" ? (prefersDark ? "dark" : "light") : preference;
}

function applyTheme(preference: ThemePreference, prefersDark: boolean) {
  const resolved = resolveTheme(preference, prefersDark);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "dark" ? "#101722" : "#F4F6F9");
}

export default function ThemeSelector() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => applyTheme(preference, media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preference]);

  function chooseTheme(next: ThemePreference) {
    setPreference(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The in-memory preference still applies for this page view.
    }
  }

  const Icon = preference === "light" ? Sun : preference === "dark" ? Moon : Monitor;
  return <label className="theme-control">
    <span className="sr-only">Appearance</span>
    <Icon aria-hidden="true" size={15}/>
    <select
      aria-label="Appearance theme"
      value={preference}
      onChange={(event) => chooseTheme(event.target.value as ThemePreference)}
    >
      <option value="light">Light</option>
      <option value="dark">Dark</option>
      <option value="system">System</option>
    </select>
  </label>;
}
