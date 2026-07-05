import React from "react";
import { ProficiencyBadge } from "./ProficiencyBadge.jsx";

/**
 * A single skill row: TEML badge, name, hover-revealed d20 roll hint, modifier.
 * Untrained rows are dimmed but always visible.
 */
export function SkillRow({ rank = "U", name, modifier, onRoll, style }) {
  const [hover, setHover] = React.useState(false);
  const untrained = rank === "U";
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onRoll}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 8px",
        borderRadius: "var(--fusion-radius-sm)",
        cursor: "pointer",
        opacity: untrained ? 0.75 : 1,
        background: hover ? "var(--fusion-surface)" : "transparent",
        ...style,
      }}
    >
      <ProficiencyBadge rank={rank} />
      <span style={{ flex: 1, fontSize: "13px", color: "var(--fusion-text)" }}>{name}</span>
      <span
        aria-hidden
        style={{
          fontSize: "12px",
          color: "var(--fusion-text-subtle)",
          opacity: hover ? 1 : 0,
          transition: "opacity 0.15s",
        }}
      >
        {"\u2681"}
      </span>
      <span
        style={{
          fontSize: "13px",
          fontWeight: 600,
          color: "var(--fusion-text)",
          fontFamily: "var(--fusion-font-mono)",
          minWidth: 28,
          textAlign: "right",
        }}
      >
        {modifier}
      </span>
    </div>
  );
}
