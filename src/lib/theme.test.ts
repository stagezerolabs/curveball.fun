import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  getInitialTheme,
  isTheme,
  persistTheme,
  readStoredTheme,
} from "./theme";

describe("theme preferences", () => {
  test("accepts only supported persisted themes", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("system")).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  test("defaults new visitors to the reference light theme", () => {
    expect(getInitialTheme(null)).toBe("light");
  });

  test("restores a persisted theme", () => {
    expect(getInitialTheme("dark")).toBe("dark");
    expect(getInitialTheme("light")).toBe("light");
  });

  test("falls back safely when browser storage is unavailable", () => {
    const unavailableReader = {
      getItem() {
        throw new DOMException("Access denied", "SecurityError");
      },
    };
    const unavailableWriter = {
      setItem() {
        throw new DOMException("Access denied", "SecurityError");
      },
    };

    expect(readStoredTheme(unavailableReader)).toBe("light");
    expect(() => persistTheme("dark", unavailableWriter)).not.toThrow();
  });

  test("bootstraps the theme in the document head before the app renders", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    const bootstrap = html.indexOf("document.documentElement.dataset.theme");
    const appRoot = html.indexOf('<div id="root">');

    expect(bootstrap).toBeGreaterThan(-1);
    expect(bootstrap).toBeLessThan(appRoot);
    expect(html).toContain('let theme = "light"');
    expect(html).toContain('localStorage.getItem("curveball-theme")');
  });
});
