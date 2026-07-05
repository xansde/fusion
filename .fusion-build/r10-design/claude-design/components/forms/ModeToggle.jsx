import React from "react";

/**
 * Segmented two-or-more-option toggle. Used for the sheet's Jogar/Editar mode
 * switch. The active segment fills with the accent.
 */
export function ModeToggle({ options = ["Jogar", "Editar"], value, defaultValue, onChange, style }) {
  const [internal, setInternal] = React.useState(defaultValue ?? options[0]);
  const active = value !== undefined ? value : internal;

  function select(opt) {
    if (value === undefined) setInternal(opt);
    onChange && onChange(opt);
  }

  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--fusion-surface)",
        border: "1px solid var(--fusion-border)",
        borderRadius: "var(--fusion-radius)",
        padding: "2px",
        gap: "2px",
        ...style,
      }}
    >
      {options.map((opt) => {
        const isActive = opt === active;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => select(opt)}
            style={{
              border: "none",
              background: isActive ? "var(--fusion-accent)" : "transparent",
              color: isActive ? "var(--fusion-on-accent)" : "var(--fusion-text-muted)",
              fontSize: "12px",
              fontWeight: 600,
              padding: "4px 12px",
              borderRadius: "var(--fusion-radius-sm)",
              cursor: "pointer",
              fontFamily: "var(--fusion-font)",
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = "var(--fusion-text)"; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = "var(--fusion-text-muted)"; }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
