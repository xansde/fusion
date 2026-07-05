import React from "react";

/**
 * Surface-alt card with optional heading and header actions. The workhorse
 * container for sheet sections (Perícias, Magias, stat blocks).
 */
export function Panel({ title, actions, padding = 12, children, style }) {
  return (
    <div
      style={{
        background: "var(--fusion-surface-alt)",
        border: "1px solid var(--fusion-border)",
        borderRadius: "var(--fusion-radius)",
        padding,
        ...style,
      }}
    >
      {(title || actions) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "8px",
          }}
        >
          {title && (
            <h3 style={{ fontSize: "13px", fontWeight: 600, margin: 0, color: "var(--fusion-text)" }}>{title}</h3>
          )}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
