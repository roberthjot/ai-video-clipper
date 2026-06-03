import { createContext, useContext, useEffect, useState, useCallback } from "react";

// Global Gemini model selection. Single source of truth shared by the sidebar
// chip, Ajustes, and the Upload/Analyzer model pickers. Persisted in
// localStorage so the choice survives reloads. The model VALUE lives here; the
// human label/sub list (GEMINI_VIDEO_MODELS) stays in App.jsx.
const ModelContext = createContext({ model: "gemini-2.5-flash", setModel: () => {} });

export function ModelProvider({ children }) {
  const [model, setModelState] = useState(() => {
    try { return localStorage.getItem("clipper-model") || "gemini-2.5-flash"; } catch { return "gemini-2.5-flash"; }
  });

  useEffect(() => {
    try { localStorage.setItem("clipper-model", model); } catch {}
  }, [model]);

  const setModel = useCallback((m) => { if (m) setModelState(m); }, []);

  return (
    <ModelContext.Provider value={{ model, setModel }}>
      {children}
    </ModelContext.Provider>
  );
}

export function useModel() {
  return useContext(ModelContext);
}
