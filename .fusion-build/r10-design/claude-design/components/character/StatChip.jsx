import React from "react";

/**
 * Small clickable stat chip: a micro-label over a value. Covers saves
 * (Fort/Ref/Von), Percepção, and attribute pills (FOR/DES/…). Hover reveals
 * the interactive intent with an accent border + wash.
 */
export function StatChip({ label, value, minWidth = 56, interactive = true, style }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: "var(--fusion-surface)",
        border: `1px solid ${interactive && hover ? "var(--fusion-accent)" : "var(--fusion-border)"}`,
        borderRadius: "var(--fusion-radius-sm)",
        padding: "4px 10px",
        textAlign: "center",
        minWidth,
        cursor: interactive ? "pointer" : "default",
        background: interactive && hover ? "var(--fusion-accent-dim)" : "var(--fusion-surface)",
        transition: "border-color 0.12s, background 0.12s",
        ...style,
      }}
    >
      <div
        style={{
          fontSize: "9px",
          color: "var(--fusion-text-subtle)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--fusion-text)", fontFamily: "var(--fusion-font-mono)" }}>
        {value}
      </div>
    </div>
  );
}
