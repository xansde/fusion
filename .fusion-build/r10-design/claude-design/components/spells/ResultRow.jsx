import React from "react";

/**
 * A compendium result row: rank square, action-cost icon, name + trait chips,
 * source. Selected state gets an accent wash + border.
 */
export function ResultRow({ rank, actionCost, name, traits = [], source, selected = false, onClick, style }) {
  const [hover, setHover] = React.useState(false);
  const bg = selected ? "var(--fusion-accent-dim)" : hover ? "var(--fusion-surface-alt)" : "transparent";
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: selected ? "7px 9px" : "8px 10px",
        borderRadius: "var(--fusion-radius-sm)",
        cursor: "pointer",
        background: bg,
        border: selected ? "1px solid var(--fusion-accent)" : "1px solid transparent",
        ...style,
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          flexShrink: 0,
          borderRadius: "var(--fusion-radius-sm)",
          background: "var(--fusion-surface-alt)",
          border: `1px solid ${selected ? "var(--fusion-accent)" : "var(--fusion-border)"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "10px",
          fontWeight: 700,
          color: selected ? "var(--fusion-accent)" : "var(--fusion-text-muted)",
          fontFamily: "var(--fusion-font-mono)",
        }}
      >
        {rank}
      </span>
      {actionCost != null && (
        <span
          title="Custo de ações"
          style={{
            width: 20,
            height: 20,
            flexShrink: 0,
            borderRadius: "50%",
            border: "1px solid var(--fusion-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "9px",
            fontWeight: 700,
            color: "var(--fusion-text-subtle)",
            fontFamily: "var(--fusion-font-mono)",
          }}
        >
          {actionCost}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--fusion-text)" }}>{name}</div>
        {traits.length > 0 && (
          <div style={{ display: "flex", gap: "4px", marginTop: "3px", flexWrap: "wrap" }}>
            {traits.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: "9px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                  color: "var(--fusion-text-subtle)",
                  background: "var(--fusion-surface)",
                  border: "1px solid var(--fusion-border)",
                  padding: "1px 6px",
                  borderRadius: "var(--fusion-radius-sm)",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      {source && (
        <span style={{ fontSize: "10.5px", color: "var(--fusion-text-subtle)", flexShrink: 0 }}>{source}</span>
      )}
    </div>
  );
}
