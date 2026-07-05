import React from "react";

/**
 * A filled choice slot inside a level card: green check, name + type caption,
 * hover-revealed remove (×). Optional warning badge (e.g. optional-rule tag).
 */
export function Slot({ name, type, badge, onRemove, style }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "7px 8px",
        borderRadius: "var(--fusion-radius-sm)",
        background: hover ? "var(--fusion-surface)" : "transparent",
        ...style,
      }}
    >
      <span style={{ color: "var(--fusion-success)", fontSize: "12px", flexShrink: 0 }}>{"\u2713"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--fusion-text)" }}>
          {name}
          {badge}
        </div>
        <div style={{ fontSize: "10px", color: "var(--fusion-text-subtle)" }}>{type}</div>
      </div>
      {onRemove && (
        <span
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--fusion-danger)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--fusion-text-subtle)"; }}
          style={{
            opacity: hover ? 1 : 0,
            transition: "opacity 0.15s",
            color: "var(--fusion-text-subtle)",
            cursor: "pointer",
            fontSize: "13px",
            padding: "2px 4px",
            flexShrink: 0,
          }}
        >
          {"\u00D7"}
        </span>
      )}
    </div>
  );
}

/** Empty (unchosen) slot — dashed, accent on hover. */
export function EmptySlot({ children = "+ Escolher", onClick, style }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        padding: "10px 8px",
        border: `1px dashed ${hover ? "var(--fusion-accent)" : "var(--fusion-border)"}`,
        borderRadius: "var(--fusion-radius-sm)",
        color: hover ? "var(--fusion-accent-hover)" : "var(--fusion-text-muted)",
        fontSize: "12px",
        cursor: "pointer",
        transition: "border-color 0.12s, color 0.12s",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Locked automatic feature chip (padlock glyph). Non-interactive. */
export function AutoChip({ children, style }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        background: "var(--fusion-surface)",
        border: "1px solid var(--fusion-border)",
        color: "var(--fusion-text-muted)",
        fontSize: "11px",
        padding: "4px 9px",
        borderRadius: "var(--fusion-radius-pill)",
        cursor: "default",
        ...style,
      }}
    >
      <span style={{ fontSize: "9px", color: "var(--fusion-text-subtle)" }}>{"\uD83D\uDD12"}</span>
      {children}
    </div>
  );
}

/**
 * A per-level card: accent-wash header ("Nível N"), a body of Slots / EmptySlots,
 * and an optional strip of locked AutoChips.
 */
export function LevelCard({ level, children, autoFeatures, style }) {
  return (
    <div
      style={{
        background: "var(--fusion-surface-alt)",
        border: "1px solid var(--fusion-border)",
        borderRadius: "var(--fusion-radius)",
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        style={{
          background: "var(--fusion-accent-dim)",
          color: "var(--fusion-accent)",
          fontSize: "12px",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          padding: "8px 12px",
          borderBottom: "1px solid var(--fusion-border)",
        }}
      >
        Nível {level}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "8px" }}>
        {children}
        {autoFeatures && autoFeatures.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
              padding: "8px",
              marginTop: "2px",
              borderTop: "1px dashed var(--fusion-border)",
            }}
          >
            {autoFeatures.map((f, i) => (
              <AutoChip key={i}>{f}</AutoChip>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Small amber "optional-rule active" badge; drop into a Slot's `badge`. */
export function OptionalBadge({ children = "Regra opcional ativa", style }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: "9px",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        color: "var(--fusion-warning)",
        background: "var(--fusion-warning-dim)",
        border: "1px solid var(--fusion-prof-m-border)",
        padding: "1px 6px",
        borderRadius: "var(--fusion-radius-sm)",
        marginLeft: "6px",
        verticalAlign: "middle",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
