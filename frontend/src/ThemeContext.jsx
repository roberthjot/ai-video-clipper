import { createContext, useContext, useEffect, useState, useCallback } from "react";

const ThemeContext = createContext({ theme: "dark", toggle: () => {}, setTheme: () => {} });

export function ThemeProvider({ children }) {
  // Default to dark (matches the app's current vibe); persisted in localStorage.
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem("clipper-theme") || "dark"; } catch { return "dark"; }
  });

  // Reflect the theme on <html data-theme> so the CSS variables switch.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("clipper-theme", theme); } catch {}
  }, [theme]);

  const setTheme = useCallback((t) => setThemeState(t === "light" ? "light" : "dark"), []);
  const toggle = useCallback(() => setThemeState((t) => (t === "dark" ? "light" : "dark")), []);

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
