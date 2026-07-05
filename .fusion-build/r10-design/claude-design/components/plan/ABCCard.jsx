import React from "react";

/**
 * Ancestry/Heritage/Background/Class card in the plan column. A green check,
 * an uppercase type-label, the chosen name, and an optional sub-line.
 */
export function ABCCard({ typeLabel, name, subLine, done = true, style }) {
  return (
    <div
      style={{
        background: "var(--fusion-surface-alt)",
        border: "1px solid var(--fusion-border)",
        borderRadius: "var(--fusion-radius)",
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        ...style,
      }}
    >
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: done ? "var(--fusion-success-dim)" : "transparent",
          border: done ? "none" : "1px dashed var(--fusion-border)",
          color: "var(--fusion-success)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "11px",
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {done ? "\u2713" : ""}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--fusion-text-subtle)" }}>
          {typeLabel}
        </div>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--fusion-text)" }}>{name}</div>
        {subLine && <div style={{ fontSize: "11px", color: "var(--fusion-text-muted)", marginTop: "2px" }}>{subLine}</div>}
      </div>
    </div>
  );
}
