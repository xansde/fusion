import React from "react";

/**
 * Armour-class shield glyph — the one hexagon-clipped element on the sheet.
 * Value sits large over a tiny "CA" caption.
 */
export function ACShield({ value = 10, label = "CA", width = 52, height = 56, style }) {
  return (
    <div
      style={{
        width,
        height,
        background: "var(--fusion-surface)",
        border: "2px solid var(--fusion-border)",
        clipPath: "polygon(50% 0%, 100% 15%, 100% 60%, 50% 100%, 0% 60%, 0% 15%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        ...style,
      }}
    >
      <span style={{ fontSize: "20px", fontWeight: 700, color: "var(--fusion-text)", fontFamily: "var(--fusion-font-mono)", lineHeight: 1 }}>
        {value}
      </span>
      <span style={{ fontSize: "8px", color: "var(--fusion-text-subtle)", textTransform: "uppercase", marginTop: "2px" }}>
        {label}
      </span>
    </div>
  );
}
