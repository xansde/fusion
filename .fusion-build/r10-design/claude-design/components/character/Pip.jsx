import React from "react";

/**
 * A single resource pip (Foco / Heroísmo).
 * state: "filled" | "empty" | "locked" (hatched, above current max).
 */
export function Pip({ state = "empty", size = 12, title, onClick, style }) {
  const base = {
    width: size,
    height: size,
    borderRadius: "50%",
    border: "1px solid var(--fusion-border)",
    background: "transparent",
    padding: 0,
    cursor: onClick ? "pointer" : "default",
    flexShrink: 0,
    boxSizing: "border-box",
  };
  const byState = {
    filled: { background: "var(--fusion-accent)", borderColor: "var(--fusion-accent)" },
    empty: {},
    locked: {
      background:
        "repeating-linear-gradient(45deg, var(--fusion-surface-alt), var(--fusion-surface-alt) 2px, transparent 2px, transparent 4px)",
      opacity: 0.4,
    },
  };
  const El = onClick ? "button" : "span";
  return (
    <El
      type={onClick ? "button" : undefined}
      title={title}
      onClick={onClick}
      style={{ ...base, ...(byState[state] || {}), ...style }}
    />
  );
}

/**
 * A labelled row of pips. `filled` are counted from the left; `max` pips beyond
 * `total` render as "locked" (hatched). e.g. Foco 1 filled, total 1, cap 3.
 */
export function PipRow({ label, filled = 0, total, cap, size = 12, lockedTitle, style }) {
  const shown = cap ?? total;
  const pips = [];
  for (let i = 0; i < shown; i++) {
    let state = "empty";
    if (i < filled) state = "filled";
    else if (total != null && i >= total) state = "locked";
    pips.push(
      <Pip key={i} state={state} size={size} title={state === "locked" ? lockedTitle : undefined} />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px", alignItems: "flex-start", ...style }}>
      {label && (
        <span
          style={{
            fontSize: "9px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "var(--fusion-text-subtle)",
          }}
        >
          {label}
        </span>
      )}
      <div style={{ display: "flex", gap: "4px" }}>{pips}</div>
    </div>
  );
}
