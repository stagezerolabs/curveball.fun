export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "curveball-theme";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

export function getInitialTheme(value: unknown): Theme {
  return isTheme(value) ? value : "light";
}

export function readStoredTheme(
  storage?: Pick<Storage, "getItem">,
): Theme {
  try {
    const target = storage ?? window.localStorage;
    return getInitialTheme(target.getItem(THEME_STORAGE_KEY));
  } catch {
    return "light";
  }
}

export function persistTheme(
  theme: Theme,
  storage?: Pick<Storage, "setItem">,
) {
  try {
    const target = storage ?? window.localStorage;
    target.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The theme still works in memory when storage is unavailable.
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const blocker = document.createElement("style");
  blocker.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.append(blocker);
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  persistTheme(theme);
  void root.offsetHeight;
  window.requestAnimationFrame(() => blocker.remove());
}
