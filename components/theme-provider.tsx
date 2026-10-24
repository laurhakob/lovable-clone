/**
 * components/theme-provider.tsx
 *
 * Theme provider that manages dark/light/system mode.
 * Initial theme comes from the server (cookie), so there is no
 * setState-in-effect and no flash of the wrong theme.
 *
 * System mode is tracked via useSyncExternalStore over matchMedia.
 */

"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/** Supported theme values */
export type Theme = "light" | "dark" | "system";

/** localStorage and cookie key for persisting theme preference */
export const THEME_KEY = "theme";

interface ThemeContextValue {
  /** The user's setting: "light" | "dark" | "system" */
  theme: Theme;
  /** What "system" actually resolves to right now */
  resolvedTheme: "dark" | "light";
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  resolvedTheme: "dark",
  setTheme: () => {},
});

const MEDIA_QUERY = "(prefers-color-scheme: dark)";

/** Subscribe to OS theme changes. */
function subscribeToSystem(onChange: () => void) {
  const mq = window.matchMedia(MEDIA_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getSystemSnapshot(): "dark" | "light" {
  return window.matchMedia(MEDIA_QUERY).matches ? "dark" : "light";
}

/** The server cannot know the OS preference; assume dark. */
function getSystemServerSnapshot(): "dark" | "light" {
  return "dark";
}

/** Applies the resolved theme to the <html> element. */
function applyTheme(resolved: "dark" | "light") {
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

interface ThemeProviderProps {
  children: ReactNode;
  /** Theme read from the cookie in app/layout.tsx */
  initialTheme?: Theme;
}

export function ThemeProvider({
  children,
  initialTheme = "dark",
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  const systemTheme = useSyncExternalStore(
    subscribeToSystem,
    getSystemSnapshot,
    getSystemServerSnapshot,
  );

  const resolvedTheme = theme === "system" ? systemTheme : theme;

  /**
   * Sync the <html> class with the resolved theme.
   * Updating the DOM is an external system, which is what effects are for.
   */
  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem(THEME_KEY, newTheme);
    } catch {
      // storage unavailable (private mode, blocked cookies) — cookie still works
    }
    document.cookie = `${THEME_KEY}=${newTheme};path=/;max-age=31536000;SameSite=Lax`;
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}