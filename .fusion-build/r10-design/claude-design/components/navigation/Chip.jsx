import React from "react";

/**
 * Pill chip used for sub-tabs (spell origins) and compendium filters.
 * States: default (bordered/muted), active (accent wash + border + text),
 * fixed (dashed, non-interactive context filter like "Tradição: Arcana").
 */
export function Chip({ children, active = false, fixed = false, onClick, style }) {
  const [hover, setHover] = React.useState(false);

  let base = {
    display: "inline-flex",
    alignItems: "center",
    fontSize: "11px",
    fontWeight: 600,
    fontFamily: "var(--fusion-font)",
    padding: "4px 11px",
    borderRadius: "var(--fusion-radius-pill)",
    border: "1px solid var(--fusion-border)",
    color: "var(--fusion-text-muted)",
    background: "transparent",
    cursor: fixed ? "default" : "pointer",
    transition: "border-color 0.12s, color 0.12s, background 0.12s",
  };

  if (fixed) {
    base = { ...base, background: "var(--fusion-surface-alt)", borderStyle: "dashed", cursor: "default" };
  } else if (active) {
    base = { ...base, background: "var(--fusion-accent-dim)", borderColor: "var(--fusion-accent)", color: "var(--fusion-accent)" };
  } else if (hover) {
    base = { ...base, borderColor: "var(--fusion-accent)", color: "var(--fusion-text)" };
  }

  return (
    <button
      type="button"
      onClick={fixed ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...base, ...style }}
    >
      {children}
    </button>
  );
}
