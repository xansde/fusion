import React from "react";

/**
 * A prepared-spell slot card (per patamar). Name + optional availability pip,
 * with Lançar / Trocar actions. Or an empty dashed "Preparar magia…" slot.
 */
export function SpellSlotCard({ name, available = true, onCast, onSwap, style }) {
  return (
    <div
      style={{
        flex: 1,
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--fusion-text)" }}>
          {name}
          {available && (
            <span
              title="Espaço de magia disponível"
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "var(--fusion-accent)",
                display: "inline-block",
                marginLeft: "6px",
                verticalAlign: "middle",
              }}
            />
          )}
        </span>
      </div>
      <div style={{ display: "flex", gap: "6px" }}>
        {onCast && (
          <button
            type="button"
            onClick={onCast}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--fusion-accent-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--fusion-accent)")}
            style={{
              background: "var(--fusion-accent)",
              color: "var(--fusion-on-accent)",
              border: "none",
              fontSize: "11px",
              fontWeight: 600,
              padding: "5px 11px",
              borderRadius: "var(--fusion-radius-sm)",
              cursor: "pointer",
              fontFamily: "var(--fusion-font)",
            }}
          >
            Lançar
          </button>
        )}
        {onSwap && (
          <button
            type="button"
            onClick={onSwap}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--fusion-accent)"; e.currentTarget.style.color = "var(--fusion-accent-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--fusion-border)"; e.currentTarget.style.color = "var(--fusion-text-muted)"; }}
            style={{
              background: "transparent",
              border: "1px solid var(--fusion-border)",
              color: "var(--fusion-text-muted)",
              fontSize: "11px",
              padding: "5px 9px",
              borderRadius: "var(--fusion-radius-sm)",
              cursor: "pointer",
              fontFamily: "var(--fusion-font)",
            }}
          >
            Trocar
          </button>
        )}
      </div>
    </div>
  );
}

/** Empty dashed spell slot ("Preparar magia…"). */
export function SpellSlotEmpty({ children = "Preparar magia\u2026", onClick, style }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: `1px dashed ${hover ? "var(--fusion-accent)" : "var(--fusion-border)"}`,
        borderRadius: "var(--fusion-radius)",
        color: hover ? "var(--fusion-accent-hover)" : "var(--fusion-text-muted)",
        fontSize: "12.5px",
        padding: "14px",
        cursor: "pointer",
        transition: "border-color 0.12s, color 0.12s",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Cantrip / grimoire chip: name + a small trailing action button. */
export function SpellChip({ name, actionLabel = "Trocar", onAction, style }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        background: "var(--fusion-surface-alt)",
        border: "1px solid var(--fusion-border)",
        borderRadius: "var(--fusion-radius)",
        padding: "8px 10px",
        ...style,
      }}
    >
      <span style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--fusion-text)" }}>{name}</span>
      {onAction && (
        <button
          type="button"
          onClick={onAction}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--fusion-accent)"; e.currentTarget.style.color = "var(--fusion-accent-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--fusion-border)"; e.currentTarget.style.color = "var(--fusion-text-muted)"; }}
          style={{
            background: "transparent",
            border: "1px solid var(--fusion-border)",
            color: "var(--fusion-text-muted)",
            fontSize: "11px",
            padding: "3px 9px",
            borderRadius: "var(--fusion-radius-sm)",
            cursor: "pointer",
            fontFamily: "var(--fusion-font)",
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
