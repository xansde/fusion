import React from "react";

/**
 * Underlined tab bar. Active tab uses accent text + a 2px accent underline.
 * Used for the sheet's Principal/Perícias/Ações/Magias/… bar.
 */
export function Tabs({ tabs = [], value, defaultValue, onChange, style }) {
  const [internal, setInternal] = React.useState(defaultValue ?? (tabs[0]?.id ?? tabs[0]));
  const active = value !== undefined ? value : internal;

  function select(id) {
    if (value === undefined) setInternal(id);
    onChange && onChange(id);
  }

  return (
    <div
      style={{
        display: "flex",
        gap: "2px",
        borderBottom: "1px solid var(--fusion-border)",
        ...style,
      }}
    >
      {tabs.map((t) => {
        const id = t.id ?? t;
        const label = t.label ?? t;
        const isActive = id === active;
        return (
          <button
            key={id}
            type="button"
            onClick={() => select(id)}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = "var(--fusion-text)"; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = "var(--fusion-text-muted)"; }}
            style={{
              padding: "8px 14px",
              fontSize: "13px",
              fontWeight: 600,
              fontFamily: "var(--fusion-font)",
              color: isActive ? "var(--fusion-accent)" : "var(--fusion-text-muted)",
              cursor: "pointer",
              background: "transparent",
              border: "none",
              borderBottom: `2px solid ${isActive ? "var(--fusion-accent)" : "transparent"}`,
              marginBottom: "-1px",
              transition: "color 0.12s",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
