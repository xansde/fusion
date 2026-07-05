import React from "react";

const RANKS = {
  U: { color: "var(--fusion-prof-u)", bg: "var(--fusion-prof-u-bg)", border: "var(--fusion-prof-u-border)", label: "Destreinado" },
  T: { color: "var(--fusion-accent)", bg: "var(--fusion-prof-t-bg)", border: "var(--fusion-prof-t-border)", label: "Treinado" },
  E: { color: "var(--fusion-prof-e)", bg: "var(--fusion-prof-e-bg)", border: "var(--fusion-prof-e-border)", label: "Expert" },
  M: { color: "var(--fusion-prof-m)", bg: "var(--fusion-prof-m-bg)", border: "var(--fusion-prof-m-border)", label: "Mestre" },
  L: { color: "var(--fusion-prof-l)", bg: "var(--fusion-prof-l-bg)", border: "var(--fusion-prof-l-border)", label: "Lendário" },
};

/**
 * TEML proficiency badge. Two visual weights:
 *  - "outline" (default, used in skill rows): coloured letter + coloured border, no fill.
 *  - "filled" (specimen / spell stat bar): tinted fill + coloured border.
 */
export function ProficiencyBadge({ rank = "U", variant = "outline", size = 18, style, title }) {
  const r = RANKS[rank] || RANKS.U;
  const filled = variant === "filled";
  return (
    <span
      title={title ?? r.label}
      style={{
        width: size,
        height: size,
        borderRadius: "var(--fusion-radius-sm)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: Math.round(size * 0.56),
        fontFamily: "var(--fusion-font)",
        color: filled && rank === "T" ? "var(--fusion-accent-hover)" : r.color,
        background: filled ? r.bg : "transparent",
        border: `1px solid ${rank === "U" && !filled ? "var(--fusion-border)" : r.border}`,
        flexShrink: 0,
        ...style,
      }}
    >
      {rank}
    </span>
  );
}
