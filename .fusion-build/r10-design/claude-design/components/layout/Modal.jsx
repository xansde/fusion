import React from "react";

/**
 * Centered modal dialog on a dimmed backdrop. Header (title + close),
 * scrollable body, optional footer with a note + actions. Used for the
 * spell compendium picker.
 */
export function Modal({ title, onClose, footerNote, footer, width = 680, maxHeight = 720, children, style }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          maxHeight,
          background: "var(--fusion-surface)",
          border: "1px solid var(--fusion-border)",
          borderRadius: "var(--fusion-radius-lg)",
          boxShadow: "var(--fusion-shadow-modal)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          ...style,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: "1px solid var(--fusion-border)",
            flexShrink: 0,
          }}
        >
          <h2 style={{ fontSize: "15px", fontWeight: 600, margin: 0, color: "var(--fusion-text)" }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--fusion-danger)"; e.currentTarget.style.color = "var(--fusion-danger)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--fusion-border)"; e.currentTarget.style.color = "var(--fusion-text-muted)"; }}
            style={{
              width: 24,
              height: 24,
              borderRadius: "var(--fusion-radius-sm)",
              border: "1px solid var(--fusion-border)",
              background: "transparent",
              color: "var(--fusion-text-muted)",
              cursor: "pointer",
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--fusion-font)",
            }}
          >
            {"\u00D7"}
          </button>
        </div>

        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: "12px", overflowY: "auto" }}>
          {children}
        </div>

        {(footer || footerNote) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              padding: "12px 18px",
              borderTop: "1px solid var(--fusion-border)",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: "10.5px", color: "var(--fusion-text-subtle)" }}>{footerNote}</span>
            <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>{footer}</div>
          </div>
        )}
      </div>
    </div>
  );
}
