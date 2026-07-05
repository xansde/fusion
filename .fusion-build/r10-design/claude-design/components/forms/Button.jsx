import React from "react";

/**
 * Fusion VTT button. The violet accent is reserved for the primary variant
 * and interactive/hover states only.
 */
export function Button({
  variant = "primary",
  size = "md",
  disabled = false,
  fullWidth = false,
  children,
  style,
  ...rest
}) {
  const sizes = {
    tiny: { padding: "3px 9px", fontSize: "11px", radius: "var(--fusion-radius-sm)" },
    sm: { padding: "5px 11px", fontSize: "12px", radius: "var(--fusion-radius-sm)" },
    md: { padding: "7px 14px", fontSize: "13px", radius: "var(--fusion-radius)" },
    lg: { padding: "10px 16px", fontSize: "13px", radius: "var(--fusion-radius)" },
  };
  const s = sizes[size] || sizes.md;

  const variants = {
    primary: {
      background: "var(--fusion-accent)",
      color: "var(--fusion-on-accent)",
      border: "1px solid var(--fusion-accent)",
    },
    secondary: {
      background: "transparent",
      color: "var(--fusion-text-muted)",
      border: "1px solid var(--fusion-border)",
    },
    ghost: {
      background: "transparent",
      color: "var(--fusion-text)",
      border: "1px solid var(--fusion-border)",
    },
    subtle: {
      background: "var(--fusion-surface-alt)",
      color: "var(--fusion-text-muted)",
      border: "1px solid var(--fusion-border)",
    },
    danger: {
      background: "transparent",
      color: "var(--fusion-danger)",
      border: "1px solid var(--fusion-danger)",
    },
  };
  const v = variants[variant] || variants.primary;

  const [hover, setHover] = React.useState(false);
  const hoverStyle = !disabled && hover ? hoverFor(variant) : null;

  return (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        fontFamily: "var(--fusion-font)",
        fontWeight: variant === "primary" || variant === "danger" ? 600 : 600,
        lineHeight: 1.2,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        width: fullWidth ? "100%" : undefined,
        padding: s.padding,
        fontSize: s.fontSize,
        borderRadius: s.radius,
        transition: "background 0.12s, border-color 0.12s, color 0.12s",
        ...v,
        ...hoverStyle,
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

function hoverFor(variant) {
  switch (variant) {
    case "primary":
      return { background: "var(--fusion-accent-hover)", borderColor: "var(--fusion-accent-hover)" };
    case "secondary":
      return { borderColor: "var(--fusion-text-muted)", color: "var(--fusion-text)" };
    case "ghost":
      return { borderColor: "var(--fusion-accent)", color: "var(--fusion-text)" };
    case "subtle":
      return { color: "var(--fusion-text)" };
    case "danger":
      return { background: "var(--fusion-danger-dim)" };
    default:
      return null;
  }
}
