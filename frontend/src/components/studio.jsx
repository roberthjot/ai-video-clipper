// studio.jsx — Shared "Studio" UI primitives (light/dark via --st-* tokens).
// Single source of truth for the building blocks repeated across the app so a
// design tweak happens in one place. Keep these presentational (no app logic).
import { ChevronDown, RefreshCw } from "lucide-react";

// Uppercase eyebrow + optional leading icon + optional right-aligned slot.
export function StSection({ icon, children, right, style }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12, ...style }}>
      {icon && <span style={{ color: "var(--st-muted)", display: "grid" }}>{icon}</span>}
      <span className="st-eyebrow">{children}</span>
      <div style={{ flex: 1 }} />
      {right}
    </div>
  );
}

// Selectable chip / toggle button. active = accent border + soft fill.
export function StChip({ active, onClick, title, disabled, children, style }) {
  return (
    <button type="button" onClick={onClick} title={title} disabled={disabled} style={{
      fontFamily: "var(--st-ui)", fontSize: 12.5, fontWeight: 600, padding: "8px 11px", borderRadius: 9,
      cursor: disabled ? "not-allowed" : "pointer", textAlign: "center", lineHeight: 1.2,
      border: `1px solid ${active ? "var(--st-accent)" : "var(--st-border)"}`,
      background: active ? "var(--st-soft)" : "transparent",
      color: active ? "var(--st-text)" : "var(--st-muted)",
      opacity: disabled ? 0.45 : 1, transition: "all .12s", ...style,
    }}>{children}</button>
  );
}

// Labeled native range slider. onChange receives the DOM event (read
// e.target.value). Pass `display` for the mono value text, `onReset` for a
// small reset affordance.
export function StSlider({ label, display, min, max, step, value, onChange, onReset, style }) {
  return (
    <div style={{ marginBottom: 14, ...style }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--st-muted)" }}>{label}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {display != null && <span style={{ fontFamily: "var(--st-mono)", fontSize: 11.5, color: "var(--st-text)" }}>{display}</span>}
          {onReset && <span onClick={onReset} title="Reset" style={{ cursor: "pointer", color: "var(--st-faint)", display: "grid" }}><RefreshCw size={12} /></span>}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={onChange} style={{ width: "100%" }} />
    </div>
  );
}

// On/off pill toggle (knob slides). Controlled via `on` + `onClick`.
export function StToggle({ on, onClick }) {
  return (
    <div onClick={onClick} style={{ width: 40, height: 23, borderRadius: 99, background: on ? "var(--st-accent)" : "var(--st-alt)", border: `1px solid ${on ? "var(--st-accent)" : "var(--st-border)"}`, position: "relative", cursor: "pointer", flexShrink: 0, transition: "background .15s" }}>
      <div style={{ position: "absolute", top: 2, left: on ? 19 : 2, width: 17, height: 17, borderRadius: 99, background: on ? "var(--st-on-accent)" : "var(--st-surface)", transition: "left .15s", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }} />
    </div>
  );
}

// Settings-style row: label + description on the left, a control on the right.
export function StFieldRow({ label, desc, control }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 0", borderBottom: "1px solid var(--st-line)" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>{label}</div>
        {desc && <div style={{ fontSize: 12.5, color: "var(--st-muted)", lineHeight: 1.5 }}>{desc}</div>}
      </div>
      {control}
    </div>
  );
}

// Collapsible inspector row built on native <details> (no extra state). The
// summary shows icon + label + optional mono summary + a rotating chevron.
export function StRow({ icon, label, summary, children, defaultOpen }) {
  return (
    <details className="st-row" open={defaultOpen}>
      <summary>
        {icon && <span style={{ color: "var(--st-muted)", display: "grid" }}>{icon}</span>}
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--st-text)" }}>{label}</span>
        {summary != null && <span style={{ fontFamily: "var(--st-mono)", fontSize: 11, color: "var(--st-faint)", marginLeft: 8 }}>{summary}</span>}
        <ChevronDown size={15} className="st-row-chev" />
      </summary>
      <div className="st-row-body">{children}</div>
    </details>
  );
}

// Segmented control (2+ options). options = [[value, label], ...].
export function StSegmented({ options, value, onChange, disabled }) {
  return (
    <div style={{ display: "inline-flex", background: "var(--st-alt)", borderRadius: 9, padding: 3 }}>
      {options.map(([k, label]) => {
        const on = value === k;
        return (
          <span key={k} onClick={() => !disabled && onChange(k)} style={{
            fontSize: 12.5, fontWeight: on ? 600 : 500, padding: "6px 13px", borderRadius: 6,
            cursor: disabled ? "default" : "pointer", opacity: disabled && !on ? 0.5 : 1,
            background: on ? "var(--st-surface)" : "transparent", color: on ? "var(--st-text)" : "var(--st-muted)",
          }}>{label}</span>
        );
      })}
    </div>
  );
}
