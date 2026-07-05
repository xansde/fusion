import React from "react";

/**
 * Search input used in the compendium modal. Leading magnifier glyph,
 * surface-alt fill, accent focus ring.
 */
export function SearchBox({ placeholder = "Buscar no compêndio…", value, defaultValue, onChange, style, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        background: "var(--fusion-surface-alt)",
        border: `1px solid ${focus ? "var(--fusion-accent)" : "var(--fusion-border)"}`,
        borderRadius: "var(--fusion-radius)",
        padding: "8px 12px",
        transition: "border-color 0.12s",
        ...style,
      }}
    >
      <span style={{ color: "var(--fusion-text-subtle)", fontSize: "13px", lineHeight: 1 }} aria-hidden>
        {"\uD83D\uDD0D"}
      </span>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--fusion-text)",
          fontSize: "13px",
          fontFamily: "var(--fusion-font)",
        }}
        {...rest}
      />
    </div>
  );
}
