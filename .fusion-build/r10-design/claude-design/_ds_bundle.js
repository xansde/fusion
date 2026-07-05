/* @ds-bundle: {"format":4,"namespace":"FusionVTTDesignSystem_1daa5f","components":[{"name":"ACShield","sourcePath":"components/character/ACShield.jsx"},{"name":"Pip","sourcePath":"components/character/Pip.jsx"},{"name":"PipRow","sourcePath":"components/character/Pip.jsx"},{"name":"ProficiencyBadge","sourcePath":"components/character/ProficiencyBadge.jsx"},{"name":"SkillRow","sourcePath":"components/character/SkillRow.jsx"},{"name":"StatChip","sourcePath":"components/character/StatChip.jsx"},{"name":"Button","sourcePath":"components/forms/Button.jsx"},{"name":"ModeToggle","sourcePath":"components/forms/ModeToggle.jsx"},{"name":"SearchBox","sourcePath":"components/forms/SearchBox.jsx"},{"name":"Modal","sourcePath":"components/layout/Modal.jsx"},{"name":"Panel","sourcePath":"components/layout/Panel.jsx"},{"name":"Chip","sourcePath":"components/navigation/Chip.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"},{"name":"ABCCard","sourcePath":"components/plan/ABCCard.jsx"},{"name":"Slot","sourcePath":"components/plan/LevelCard.jsx"},{"name":"EmptySlot","sourcePath":"components/plan/LevelCard.jsx"},{"name":"AutoChip","sourcePath":"components/plan/LevelCard.jsx"},{"name":"LevelCard","sourcePath":"components/plan/LevelCard.jsx"},{"name":"OptionalBadge","sourcePath":"components/plan/LevelCard.jsx"},{"name":"ResultRow","sourcePath":"components/spells/ResultRow.jsx"},{"name":"SpellSlotCard","sourcePath":"components/spells/SpellSlotCard.jsx"},{"name":"SpellSlotEmpty","sourcePath":"components/spells/SpellSlotCard.jsx"},{"name":"SpellChip","sourcePath":"components/spells/SpellSlotCard.jsx"}],"sourceHashes":{"components/character/ACShield.jsx":"1dc470a1340f","components/character/Pip.jsx":"96c88dae470c","components/character/ProficiencyBadge.jsx":"9fe00cedb433","components/character/SkillRow.jsx":"760da36cd098","components/character/StatChip.jsx":"82bc84004219","components/forms/Button.jsx":"6651731ed003","components/forms/ModeToggle.jsx":"489cf8ed1b64","components/forms/SearchBox.jsx":"ba005edea919","components/layout/Modal.jsx":"06b5be08b868","components/layout/Panel.jsx":"3ea3cb5527ee","components/navigation/Chip.jsx":"532f2af822fa","components/navigation/Tabs.jsx":"400a97556bc6","components/plan/ABCCard.jsx":"20d94e83499f","components/plan/LevelCard.jsx":"fb15bf32c479","components/spells/ResultRow.jsx":"bca0bfb218a8","components/spells/SpellSlotCard.jsx":"4409d6c841f8","ui_kits/ficha-pf2e/CharacterHeader.jsx":"a165cf442155","ui_kits/ficha-pf2e/FichaApp.jsx":"be312d9d24e4","ui_kits/ficha-pf2e/MagiasTab.jsx":"c07ff416d69a","ui_kits/ficha-pf2e/PlanColumn.jsx":"33e9ee2ec1ef","ui_kits/ficha-pf2e/SkillsPanel.jsx":"549fa244f0a3","ui_kits/ficha-pf2e/SpellPicker.jsx":"ff7056c15c76","ui_kits/ficha-pf2e/data.js":"fe516612ef3b"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.FusionVTTDesignSystem_1daa5f = window.FusionVTTDesignSystem_1daa5f || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/character/ACShield.jsx
try { (() => {
/**
 * Armour-class shield glyph — the one hexagon-clipped element on the sheet.
 * Value sits large over a tiny "CA" caption.
 */
function ACShield({
  value = 10,
  label = "CA",
  width = 52,
  height = 56,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
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
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "20px",
      fontWeight: 700,
      color: "var(--fusion-text)",
      fontFamily: "var(--fusion-font-mono)",
      lineHeight: 1
    }
  }, value), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "8px",
      color: "var(--fusion-text-subtle)",
      textTransform: "uppercase",
      marginTop: "2px"
    }
  }, label));
}
Object.assign(__ds_scope, { ACShield });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/character/ACShield.jsx", error: String((e && e.message) || e) }); }

// components/character/Pip.jsx
try { (() => {
/**
 * A single resource pip (Foco / Heroísmo).
 * state: "filled" | "empty" | "locked" (hatched, above current max).
 */
function Pip({
  state = "empty",
  size = 12,
  title,
  onClick,
  style
}) {
  const base = {
    width: size,
    height: size,
    borderRadius: "50%",
    border: "1px solid var(--fusion-border)",
    background: "transparent",
    padding: 0,
    cursor: onClick ? "pointer" : "default",
    flexShrink: 0,
    boxSizing: "border-box"
  };
  const byState = {
    filled: {
      background: "var(--fusion-accent)",
      borderColor: "var(--fusion-accent)"
    },
    empty: {},
    locked: {
      background: "repeating-linear-gradient(45deg, var(--fusion-surface-alt), var(--fusion-surface-alt) 2px, transparent 2px, transparent 4px)",
      opacity: 0.4
    }
  };
  const El = onClick ? "button" : "span";
  return /*#__PURE__*/React.createElement(El, {
    type: onClick ? "button" : undefined,
    title: title,
    onClick: onClick,
    style: {
      ...base,
      ...(byState[state] || {}),
      ...style
    }
  });
}

/**
 * A labelled row of pips. `filled` are counted from the left; `max` pips beyond
 * `total` render as "locked" (hatched). e.g. Foco 1 filled, total 1, cap 3.
 */
function PipRow({
  label,
  filled = 0,
  total,
  cap,
  size = 12,
  lockedTitle,
  style
}) {
  const shown = cap ?? total;
  const pips = [];
  for (let i = 0; i < shown; i++) {
    let state = "empty";
    if (i < filled) state = "filled";else if (total != null && i >= total) state = "locked";
    pips.push(/*#__PURE__*/React.createElement(Pip, {
      key: i,
      state: state,
      size: size,
      title: state === "locked" ? lockedTitle : undefined
    }));
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "3px",
      alignItems: "flex-start",
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "9px",
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      color: "var(--fusion-text-subtle)"
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "4px"
    }
  }, pips));
}
Object.assign(__ds_scope, { Pip, PipRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/character/Pip.jsx", error: String((e && e.message) || e) }); }

// components/character/ProficiencyBadge.jsx
try { (() => {
const RANKS = {
  U: {
    color: "var(--fusion-prof-u)",
    bg: "var(--fusion-prof-u-bg)",
    border: "var(--fusion-prof-u-border)",
    label: "Destreinado"
  },
  T: {
    color: "var(--fusion-accent)",
    bg: "var(--fusion-prof-t-bg)",
    border: "var(--fusion-prof-t-border)",
    label: "Treinado"
  },
  E: {
    color: "var(--fusion-prof-e)",
    bg: "var(--fusion-prof-e-bg)",
    border: "var(--fusion-prof-e-border)",
    label: "Expert"
  },
  M: {
    color: "var(--fusion-prof-m)",
    bg: "var(--fusion-prof-m-bg)",
    border: "var(--fusion-prof-m-border)",
    label: "Mestre"
  },
  L: {
    color: "var(--fusion-prof-l)",
    bg: "var(--fusion-prof-l-bg)",
    border: "var(--fusion-prof-l-border)",
    label: "Lendário"
  }
};

/**
 * TEML proficiency badge. Two visual weights:
 *  - "outline" (default, used in skill rows): coloured letter + coloured border, no fill.
 *  - "filled" (specimen / spell stat bar): tinted fill + coloured border.
 */
function ProficiencyBadge({
  rank = "U",
  variant = "outline",
  size = 18,
  style,
  title
}) {
  const r = RANKS[rank] || RANKS.U;
  const filled = variant === "filled";
  return /*#__PURE__*/React.createElement("span", {
    title: title ?? r.label,
    style: {
      width: size,
      height: size,
      borderRadius: "var(--fusion-radius-sm)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 700,
      fontSize: Math.round(size * 0.56),
      fontFamily: "var(--fusion-font)",
      color: filled && rank === "T" ? "var(--fusion-accent-hover)" : r.color,
      background: filled ? r.bg : "transparent",
      border: `1px solid ${rank === "U" && !filled ? "var(--fusion-border)" : r.border}`,
      flexShrink: 0,
      ...style
    }
  }, rank);
}
Object.assign(__ds_scope, { ProficiencyBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/character/ProficiencyBadge.jsx", error: String((e && e.message) || e) }); }

// components/character/SkillRow.jsx
try { (() => {
/**
 * A single skill row: TEML badge, name, hover-revealed d20 roll hint, modifier.
 * Untrained rows are dimmed but always visible.
 */
function SkillRow({
  rank = "U",
  name,
  modifier,
  onRoll,
  style
}) {
  const [hover, setHover] = React.useState(false);
  const untrained = rank === "U";
  return /*#__PURE__*/React.createElement("div", {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    onClick: onRoll,
    style: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "6px 8px",
      borderRadius: "var(--fusion-radius-sm)",
      cursor: "pointer",
      opacity: untrained ? 0.75 : 1,
      background: hover ? "var(--fusion-surface)" : "transparent",
      ...style
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.ProficiencyBadge, {
    rank: rank
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: "13px",
      color: "var(--fusion-text)"
    }
  }, name), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": true,
    style: {
      fontSize: "12px",
      color: "var(--fusion-text-subtle)",
      opacity: hover ? 1 : 0,
      transition: "opacity 0.15s"
    }
  }, "\u2681"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "13px",
      fontWeight: 600,
      color: "var(--fusion-text)",
      fontFamily: "var(--fusion-font-mono)",
      minWidth: 28,
      textAlign: "right"
    }
  }, modifier));
}
Object.assign(__ds_scope, { SkillRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/character/SkillRow.jsx", error: String((e && e.message) || e) }); }

// components/character/StatChip.jsx
try { (() => {
/**
 * Small clickable stat chip: a micro-label over a value. Covers saves
 * (Fort/Ref/Von), Percepção, and attribute pills (FOR/DES/…). Hover reveals
 * the interactive intent with an accent border + wash.
 */
function StatChip({
  label,
  value,
  minWidth = 56,
  interactive = true,
  style
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      background: "var(--fusion-surface)",
      border: `1px solid ${interactive && hover ? "var(--fusion-accent)" : "var(--fusion-border)"}`,
      borderRadius: "var(--fusion-radius-sm)",
      padding: "4px 10px",
      textAlign: "center",
      minWidth,
      cursor: interactive ? "pointer" : "default",
      background: interactive && hover ? "var(--fusion-accent-dim)" : "var(--fusion-surface)",
      transition: "border-color 0.12s, background 0.12s",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "9px",
      color: "var(--fusion-text-subtle)",
      textTransform: "uppercase",
      letterSpacing: "0.04em"
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "15px",
      fontWeight: 600,
      color: "var(--fusion-text)",
      fontFamily: "var(--fusion-font-mono)"
    }
  }, value));
}
Object.assign(__ds_scope, { StatChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/character/StatChip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Fusion VTT button. The violet accent is reserved for the primary variant
 * and interactive/hover states only.
 */
function Button({
  variant = "primary",
  size = "md",
  disabled = false,
  fullWidth = false,
  children,
  style,
  ...rest
}) {
  const sizes = {
    tiny: {
      padding: "3px 9px",
      fontSize: "11px",
      radius: "var(--fusion-radius-sm)"
    },
    sm: {
      padding: "5px 11px",
      fontSize: "12px",
      radius: "var(--fusion-radius-sm)"
    },
    md: {
      padding: "7px 14px",
      fontSize: "13px",
      radius: "var(--fusion-radius)"
    },
    lg: {
      padding: "10px 16px",
      fontSize: "13px",
      radius: "var(--fusion-radius)"
    }
  };
  const s = sizes[size] || sizes.md;
  const variants = {
    primary: {
      background: "var(--fusion-accent)",
      color: "var(--fusion-on-accent)",
      border: "1px solid var(--fusion-accent)"
    },
    secondary: {
      background: "transparent",
      color: "var(--fusion-text-muted)",
      border: "1px solid var(--fusion-border)"
    },
    ghost: {
      background: "transparent",
      color: "var(--fusion-text)",
      border: "1px solid var(--fusion-border)"
    },
    subtle: {
      background: "var(--fusion-surface-alt)",
      color: "var(--fusion-text-muted)",
      border: "1px solid var(--fusion-border)"
    },
    danger: {
      background: "transparent",
      color: "var(--fusion-danger)",
      border: "1px solid var(--fusion-danger)"
    }
  };
  const v = variants[variant] || variants.primary;
  const [hover, setHover] = React.useState(false);
  const hoverStyle = !disabled && hover ? hoverFor(variant) : null;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: disabled,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
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
      ...style
    }
  }, rest), children);
}
function hoverFor(variant) {
  switch (variant) {
    case "primary":
      return {
        background: "var(--fusion-accent-hover)",
        borderColor: "var(--fusion-accent-hover)"
      };
    case "secondary":
      return {
        borderColor: "var(--fusion-text-muted)",
        color: "var(--fusion-text)"
      };
    case "ghost":
      return {
        borderColor: "var(--fusion-accent)",
        color: "var(--fusion-text)"
      };
    case "subtle":
      return {
        color: "var(--fusion-text)"
      };
    case "danger":
      return {
        background: "var(--fusion-danger-dim)"
      };
    default:
      return null;
  }
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Button.jsx", error: String((e && e.message) || e) }); }

// components/forms/ModeToggle.jsx
try { (() => {
/**
 * Segmented two-or-more-option toggle. Used for the sheet's Jogar/Editar mode
 * switch. The active segment fills with the accent.
 */
function ModeToggle({
  options = ["Jogar", "Editar"],
  value,
  defaultValue,
  onChange,
  style
}) {
  const [internal, setInternal] = React.useState(defaultValue ?? options[0]);
  const active = value !== undefined ? value : internal;
  function select(opt) {
    if (value === undefined) setInternal(opt);
    onChange && onChange(opt);
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "inline-flex",
      background: "var(--fusion-surface)",
      border: "1px solid var(--fusion-border)",
      borderRadius: "var(--fusion-radius)",
      padding: "2px",
      gap: "2px",
      ...style
    }
  }, options.map(opt => {
    const isActive = opt === active;
    return /*#__PURE__*/React.createElement("button", {
      key: opt,
      type: "button",
      onClick: () => select(opt),
      style: {
        border: "none",
        background: isActive ? "var(--fusion-accent)" : "transparent",
        color: isActive ? "var(--fusion-on-accent)" : "var(--fusion-text-muted)",
        fontSize: "12px",
        fontWeight: 600,
        padding: "4px 12px",
        borderRadius: "var(--fusion-radius-sm)",
        cursor: "pointer",
        fontFamily: "var(--fusion-font)",
        transition: "background 0.12s, color 0.12s"
      },
      onMouseEnter: e => {
        if (!isActive) e.currentTarget.style.color = "var(--fusion-text)";
      },
      onMouseLeave: e => {
        if (!isActive) e.currentTarget.style.color = "var(--fusion-text-muted)";
      }
    }, opt);
  }));
}
Object.assign(__ds_scope, { ModeToggle });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/ModeToggle.jsx", error: String((e && e.message) || e) }); }

// components/forms/SearchBox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Search input used in the compendium modal. Leading magnifier glyph,
 * surface-alt fill, accent focus ring.
 */
function SearchBox({
  placeholder = "Buscar no compêndio…",
  value,
  defaultValue,
  onChange,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      background: "var(--fusion-surface-alt)",
      border: `1px solid ${focus ? "var(--fusion-accent)" : "var(--fusion-border)"}`,
      borderRadius: "var(--fusion-radius)",
      padding: "8px 12px",
      transition: "border-color 0.12s",
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--fusion-text-subtle)",
      fontSize: "13px",
      lineHeight: 1
    },
    "aria-hidden": true
  }, "\uD83D\uDD0D"), /*#__PURE__*/React.createElement("input", _extends({
    type: "text",
    placeholder: placeholder,
    value: value,
    defaultValue: defaultValue,
    onChange: onChange,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      flex: 1,
      background: "transparent",
      border: "none",
      outline: "none",
      color: "var(--fusion-text)",
      fontSize: "13px",
      fontFamily: "var(--fusion-font)"
    }
  }, rest)));
}
Object.assign(__ds_scope, { SearchBox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SearchBox.jsx", error: String((e && e.message) || e) }); }

// components/layout/Modal.jsx
try { (() => {
/**
 * Centered modal dialog on a dimmed backdrop. Header (title + close),
 * scrollable body, optional footer with a note + actions. Used for the
 * spell compendium picker.
 */
function Modal({
  title,
  onClose,
  footerNote,
  footer,
  width = 680,
  maxHeight = 720,
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.6)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      zIndex: 100
    },
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      width,
      maxHeight,
      background: "var(--fusion-surface)",
      border: "1px solid var(--fusion-border)",
      borderRadius: "var(--fusion-radius-lg)",
      boxShadow: "var(--fusion-shadow-modal)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "14px 18px",
      borderBottom: "1px solid var(--fusion-border)",
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: "15px",
      fontWeight: 600,
      margin: 0,
      color: "var(--fusion-text)"
    }
  }, title), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClose,
    "aria-label": "Fechar",
    onMouseEnter: e => {
      e.currentTarget.style.borderColor = "var(--fusion-danger)";
      e.currentTarget.style.color = "var(--fusion-danger)";
    },
    onMouseLeave: e => {
      e.currentTarget.style.borderColor = "var(--fusion-border)";
      e.currentTarget.style.color = "var(--fusion-text-muted)";
    },
    style: {
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
      fontFamily: "var(--fusion-font)"
    }
  }, "\u00D7")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "14px 18px",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
      overflowY: "auto"
    }
  }, children), (footer || footerNote) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      padding: "12px 18px",
      borderTop: "1px solid var(--fusion-border)",
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "10.5px",
      color: "var(--fusion-text-subtle)"
    }
  }, footerNote), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "8px",
      flexShrink: 0
    }
  }, footer))));
}
Object.assign(__ds_scope, { Modal });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/Modal.jsx", error: String((e && e.message) || e) }); }

// components/layout/Panel.jsx
try { (() => {
/**
 * Surface-alt card with optional heading and header actions. The workhorse
 * container for sheet sections (Perícias, Magias, stat blocks).
 */
function Panel({
  title,
  actions,
  padding = 12,
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--fusion-surface-alt)",
      border: "1px solid var(--fusion-border)",
      borderRadius: "var(--fusion-radius)",
      padding,
      ...style
    }
  }, (title || actions) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: "8px"
    }
  }, title && /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: "13px",
      fontWeight: 600,
      margin: 0,
      color: "var(--fusion-text)"
    }
  }, title), actions), children);
}
Object.assign(__ds_scope, { Panel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/Panel.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Chip.jsx
try { (() => {
/**
 * Pill chip used for sub-tabs (spell origins) and compendium filters.
 * States: default (bordered/muted), active (accent wash + border + text),
 * fixed (dashed, non-interactive context filter like "Tradição: Arcana").
 */
function Chip({
  children,
  active = false,
  fixed = false,
  onClick,
  style
}) {
  const [hover, setHover] = React.useState(false);
  let base = {
    display: "inline-flex",
    alignItems: "center",
    fontSize: "11px",
    fontWeight: 600,
    fontFamily: "var(--fusion-font)",
    padding: "4px 11px",
    borderRadius: "var(--fusion-radius-pill)",
    border: "1px solid var(--fusion-border)",
    color: "var(--fusion-text-muted)",
    background: "transparent",
    cursor: fixed ? "default" : "pointer",
    transition: "border-color 0.12s, color 0.12s, background 0.12s"
  };
  if (fixed) {
    base = {
      ...base,
      background: "var(--fusion-surface-alt)",
      borderStyle: "dashed",
      cursor: "default"
    };
  } else if (active) {
    base = {
      ...base,
      background: "var(--fusion-accent-dim)",
      borderColor: "var(--fusion-accent)",
      color: "var(--fusion-accent)"
    };
  } else if (hover) {
    base = {
      ...base,
      borderColor: "var(--fusion-accent)",
      color: "var(--fusion-text)"
    };
  }
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: fixed ? undefined : onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      ...base,
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Chip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Chip.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
/**
 * Underlined tab bar. Active tab uses accent text + a 2px accent underline.
 * Used for the sheet's Principal/Perícias/Ações/Magias/… bar.
 */
function Tabs({
  tabs = [],
  value,
  defaultValue,
  onChange,
  style
}) {
  const [internal, setInternal] = React.useState(defaultValue ?? tabs[0]?.id ?? tabs[0]);
  const active = value !== undefined ? value : internal;
  function select(id) {
    if (value === undefined) setInternal(id);
    onChange && onChange(id);
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "2px",
      borderBottom: "1px solid var(--fusion-border)",
      ...style
    }
  }, tabs.map(t => {
    const id = t.id ?? t;
    const label = t.label ?? t;
    const isActive = id === active;
    return /*#__PURE__*/React.createElement("button", {
      key: id,
      type: "button",
      onClick: () => select(id),
      onMouseEnter: e => {
        if (!isActive) e.currentTarget.style.color = "var(--fusion-text)";
      },
      onMouseLeave: e => {
        if (!isActive) e.currentTarget.style.color = "var(--fusion-text-muted)";
      },
      style: {
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
        transition: "color 0.12s"
      }
    }, label);
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/plan/ABCCard.jsx
try { (() => {
/**
 * Ancestry/Heritage/Background/Class card in the plan column. A green check,
 * an uppercase type-label, the chosen name, and an optional sub-line.
 */
function ABCCard({
  typeLabel,
  name,
  subLine,
  done = true,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--fusion-surface-alt)",
      border: "1px solid var(--fusion-border)",
      borderRadius: "var(--fusion-radius)",
      padding: "10px 12px",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 18,
      height: 18,
      borderRadius: "50%",
      background: done ? "var(--fusion-success-dim)" : "transparent",
      border: done ? "none" : "1px dashed var(--fusion-border)",
      color: "var(--fusion-success)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "11px",
      fontWeight: 700,
      flexShrink: 0
    }
  }, done ? "\u2713" : ""), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "10px",
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      color: "var(--fusion-text-subtle)"
    }
  }, typeLabel), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "13px",
      fontWeight: 600,
      color: "var(--fusion-text)"
    }
  }, name), subLine && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "11px",
      color: "var(--fusion-text-muted)",
      marginTop: "2px"
    }
  }, subLine)));
}
Object.assign(__ds_scope, { ABCCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/plan/ABCCard.jsx", error: String((e && e.message) || e) }); }

// components/plan/LevelCard.jsx
try { (() => {
/**
 * A filled choice slot inside a level card: green check, name + type caption,
 * hover-revealed remove (×). Optional warning badge (e.g. optional-rule tag).
 */
function Slot({
  name,
  type,
  badge,
  onRemove,
  style
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "7px 8px",
      borderRadius: "var(--fusion-radius-sm)",
      background: hover ? "var(--fusion-surface)" : "transparent",
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--fusion-success)",
      fontSize: "12px",
      flexShrink: 0
    }
  }, "\u2713"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "12.5px",
      fontWeight: 600,
      color: "var(--fusion-text)"
    }
  }, name, badge), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "10px",
      color: "var(--fusion-text-subtle)"
    }
  }, type)), onRemove && /*#__PURE__*/React.createElement("span", {
    onClick: e => {
      e.stopPropagation();
      onRemove();
    },
    onMouseEnter: e => {
      e.currentTarget.style.color = "var(--fusion-danger)";
    },
    onMouseLeave: e => {
      e.currentTarget.style.color = "var(--fusion-text-subtle)";
    },
    style: {
      opacity: hover ? 1 : 0,
      transition: "opacity 0.15s",
      color: "var(--fusion-text-subtle)",
      cursor: "pointer",
      fontSize: "13px",
      padding: "2px 4px",
      flexShrink: 0
    }
  }, "\u00D7"));
}

/** Empty (unchosen) slot — dashed, accent on hover. */
function EmptySlot({
  children = "+ Escolher",
  onClick,
  style
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
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
      ...style
    }
  }, children);
}

/** Locked automatic feature chip (padlock glyph). Non-interactive. */
function AutoChip({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
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
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "9px",
      color: "var(--fusion-text-subtle)"
    }
  }, "\uD83D\uDD12"), children);
}

/**
 * A per-level card: accent-wash header ("Nível N"), a body of Slots / EmptySlots,
 * and an optional strip of locked AutoChips.
 */
function LevelCard({
  level,
  children,
  autoFeatures,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--fusion-surface-alt)",
      border: "1px solid var(--fusion-border)",
      borderRadius: "var(--fusion-radius)",
      overflow: "hidden",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--fusion-accent-dim)",
      color: "var(--fusion-accent)",
      fontSize: "12px",
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      padding: "8px 12px",
      borderBottom: "1px solid var(--fusion-border)"
    }
  }, "N\xEDvel ", level), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      padding: "8px"
    }
  }, children, autoFeatures && autoFeatures.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: "6px",
      padding: "8px",
      marginTop: "2px",
      borderTop: "1px dashed var(--fusion-border)"
    }
  }, autoFeatures.map((f, i) => /*#__PURE__*/React.createElement(AutoChip, {
    key: i
  }, f)))));
}

/** Small amber "optional-rule active" badge; drop into a Slot's `badge`. */
function OptionalBadge({
  children = "Regra opcional ativa",
  style
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
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
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Slot, EmptySlot, AutoChip, LevelCard, OptionalBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/plan/LevelCard.jsx", error: String((e && e.message) || e) }); }

// components/spells/ResultRow.jsx
try { (() => {
/**
 * A compendium result row: rank square, action-cost icon, name + trait chips,
 * source. Selected state gets an accent wash + border.
 */
function ResultRow({
  rank,
  actionCost,
  name,
  traits = [],
  source,
  selected = false,
  onClick,
  style
}) {
  const [hover, setHover] = React.useState(false);
  const bg = selected ? "var(--fusion-accent-dim)" : hover ? "var(--fusion-surface-alt)" : "transparent";
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: selected ? "7px 9px" : "8px 10px",
      borderRadius: "var(--fusion-radius-sm)",
      cursor: "pointer",
      background: bg,
      border: selected ? "1px solid var(--fusion-accent)" : "1px solid transparent",
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
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
      fontFamily: "var(--fusion-font-mono)"
    }
  }, rank), actionCost != null && /*#__PURE__*/React.createElement("span", {
    title: "Custo de a\xE7\xF5es",
    style: {
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
      fontFamily: "var(--fusion-font-mono)"
    }
  }, actionCost), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "12.5px",
      fontWeight: 600,
      color: "var(--fusion-text)"
    }
  }, name), traits.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "4px",
      marginTop: "3px",
      flexWrap: "wrap"
    }
  }, traits.map(t => /*#__PURE__*/React.createElement("span", {
    key: t,
    style: {
      fontSize: "9px",
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: "0.03em",
      color: "var(--fusion-text-subtle)",
      background: "var(--fusion-surface)",
      border: "1px solid var(--fusion-border)",
      padding: "1px 6px",
      borderRadius: "var(--fusion-radius-sm)"
    }
  }, t)))), source && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "10.5px",
      color: "var(--fusion-text-subtle)",
      flexShrink: 0
    }
  }, source));
}
Object.assign(__ds_scope, { ResultRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/spells/ResultRow.jsx", error: String((e && e.message) || e) }); }

// components/spells/SpellSlotCard.jsx
try { (() => {
/**
 * A prepared-spell slot card (per patamar). Name + optional availability pip,
 * with Lançar / Trocar actions. Or an empty dashed "Preparar magia…" slot.
 */
function SpellSlotCard({
  name,
  available = true,
  onCast,
  onSwap,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      background: "var(--fusion-surface-alt)",
      border: "1px solid var(--fusion-border)",
      borderRadius: "var(--fusion-radius)",
      padding: "10px 12px",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "13px",
      fontWeight: 600,
      color: "var(--fusion-text)"
    }
  }, name, available && /*#__PURE__*/React.createElement("span", {
    title: "Espa\xE7o de magia dispon\xEDvel",
    style: {
      width: 10,
      height: 10,
      borderRadius: "50%",
      background: "var(--fusion-accent)",
      display: "inline-block",
      marginLeft: "6px",
      verticalAlign: "middle"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "6px"
    }
  }, onCast && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onCast,
    onMouseEnter: e => e.currentTarget.style.background = "var(--fusion-accent-hover)",
    onMouseLeave: e => e.currentTarget.style.background = "var(--fusion-accent)",
    style: {
      background: "var(--fusion-accent)",
      color: "var(--fusion-on-accent)",
      border: "none",
      fontSize: "11px",
      fontWeight: 600,
      padding: "5px 11px",
      borderRadius: "var(--fusion-radius-sm)",
      cursor: "pointer",
      fontFamily: "var(--fusion-font)"
    }
  }, "Lan\xE7ar"), onSwap && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onSwap,
    onMouseEnter: e => {
      e.currentTarget.style.borderColor = "var(--fusion-accent)";
      e.currentTarget.style.color = "var(--fusion-accent-hover)";
    },
    onMouseLeave: e => {
      e.currentTarget.style.borderColor = "var(--fusion-border)";
      e.currentTarget.style.color = "var(--fusion-text-muted)";
    },
    style: {
      background: "transparent",
      border: "1px solid var(--fusion-border)",
      color: "var(--fusion-text-muted)",
      fontSize: "11px",
      padding: "5px 9px",
      borderRadius: "var(--fusion-radius-sm)",
      cursor: "pointer",
      fontFamily: "var(--fusion-font)"
    }
  }, "Trocar")));
}

/** Empty dashed spell slot ("Preparar magia…"). */
function SpellSlotEmpty({
  children = "Preparar magia\u2026",
  onClick,
  style
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
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
      ...style
    }
  }, children);
}

/** Cantrip / grimoire chip: name + a small trailing action button. */
function SpellChip({
  name,
  actionLabel = "Trocar",
  onAction,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      background: "var(--fusion-surface-alt)",
      border: "1px solid var(--fusion-border)",
      borderRadius: "var(--fusion-radius)",
      padding: "8px 10px",
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "12.5px",
      fontWeight: 600,
      color: "var(--fusion-text)"
    }
  }, name), onAction && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onAction,
    onMouseEnter: e => {
      e.currentTarget.style.borderColor = "var(--fusion-accent)";
      e.currentTarget.style.color = "var(--fusion-accent-hover)";
    },
    onMouseLeave: e => {
      e.currentTarget.style.borderColor = "var(--fusion-border)";
      e.currentTarget.style.color = "var(--fusion-text-muted)";
    },
    style: {
      background: "transparent",
      border: "1px solid var(--fusion-border)",
      color: "var(--fusion-text-muted)",
      fontSize: "11px",
      padding: "3px 9px",
      borderRadius: "var(--fusion-radius-sm)",
      cursor: "pointer",
      fontFamily: "var(--fusion-font)"
    }
  }, actionLabel));
}
Object.assign(__ds_scope, { SpellSlotCard, SpellSlotEmpty, SpellChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/spells/SpellSlotCard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/ficha-pf2e/CharacterHeader.jsx
try { (() => {
// Character header: identity + always-visible stat block.
const {
  StatChip,
  ACShield,
  PipRow
} = window.FusionVTTDesignSystem_1daa5f;
function CharacterHeader({
  c
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 20,
      alignItems: "flex-start",
      background: "var(--fusion-surface-alt)",
      border: "1px solid var(--fusion-border)",
      borderRadius: "var(--fusion-radius)",
      padding: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0,
      width: 210
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 20,
      fontWeight: 600,
      margin: "0 0 4px",
      letterSpacing: "-0.01em"
    }
  }, c.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--fusion-text-muted)",
      lineHeight: 1.5
    }
  }, c.identity)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 16,
      alignItems: "center",
      flexWrap: "wrap",
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      color: "var(--fusion-text-subtle)"
    }
  }, "HP"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("input", {
    defaultValue: c.hp.current,
    style: {
      width: 48,
      textAlign: "center",
      fontSize: 16,
      fontWeight: 600,
      background: "var(--fusion-surface)",
      border: "1px solid var(--fusion-border)",
      color: "var(--fusion-text)",
      borderRadius: "var(--fusion-radius-sm)",
      padding: "4px 2px",
      fontFamily: "var(--fusion-font-mono)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 16,
      color: "var(--fusion-text-muted)",
      fontFamily: "var(--fusion-font-mono)"
    }
  }, "/ ", c.hp.max))), /*#__PURE__*/React.createElement(ACShield, {
    value: c.ac
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6
    }
  }, c.saves.map(s => /*#__PURE__*/React.createElement(StatChip, {
    key: s.label,
    label: s.label,
    value: s.value
  })), /*#__PURE__*/React.createElement(StatChip, {
    label: "Percep\xE7\xE3o",
    value: c.perception
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6
    }
  }, c.attrs.map(a => /*#__PURE__*/React.createElement(StatChip, {
    key: a.label,
    label: a.label,
    value: a.value,
    minWidth: 42
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 16,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(PipRow, {
    label: "Hero\xEDsmo",
    filled: c.heroism.filled,
    cap: c.heroism.cap
  }), /*#__PURE__*/React.createElement(PipRow, {
    label: "Foco",
    filled: c.focus.filled,
    total: c.focus.total,
    cap: c.focus.cap,
    lockedTitle: "Al\xE9m do seu m\xE1ximo atual de Pontos de Foco (1)"
  }))));
}
window.CharacterHeader = CharacterHeader;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/ficha-pf2e/CharacterHeader.jsx", error: String((e && e.message) || e) }); }

// ui_kits/ficha-pf2e/FichaApp.jsx
try { (() => {
// Ficha PF2e — the full character-sheet window. Ties every screen together.
const {
  ModeToggle,
  Tabs,
  Panel
} = window.FusionVTTDesignSystem_1daa5f;
function FichaApp() {
  const c = window.TOBIAS;
  const [tab, setTab] = React.useState("Magias");
  const [planOpen, setPlanOpen] = React.useState(true);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const tabs = ["Principal", "Perícias", "Ações", "Magias", "Inventário", "Talentos", "Bio"];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--fusion-bg)",
      padding: 24,
      minHeight: "100vh",
      display: "flex",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 1280,
      height: 820,
      background: "var(--fusion-surface)",
      border: "1px solid var(--fusion-border)",
      borderRadius: "var(--fusion-radius-lg)",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      boxShadow: "var(--fusion-shadow-modal)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 44,
      flexShrink: 0,
      background: "var(--fusion-surface-alt)",
      borderBottom: "1px solid var(--fusion-border)",
      display: "flex",
      alignItems: "center",
      padding: "0 12px 0 16px",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      fontSize: 13
    }
  }, c.name, " \u2014 Magus 3"), /*#__PURE__*/React.createElement(ModeToggle, {
    options: ["Jogar", "Editar"],
    defaultValue: "Jogar"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), !planOpen && /*#__PURE__*/React.createElement("button", {
    onClick: () => setPlanOpen(true),
    style: {
      background: "transparent",
      border: "1px solid var(--fusion-border)",
      color: "var(--fusion-text-muted)",
      fontSize: 11,
      padding: "4px 8px",
      borderRadius: "var(--fusion-radius-sm)",
      cursor: "pointer",
      fontFamily: "var(--fusion-font)"
    }
  }, "Mostrar plano"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginLeft: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    title: "Minimizar",
    style: {
      width: 12,
      height: 12,
      borderRadius: "50%",
      background: "var(--fusion-surface)",
      border: "1px solid var(--fusion-border)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    title: "Fechar",
    style: {
      width: 12,
      height: 12,
      borderRadius: "50%",
      background: "var(--fusion-surface)",
      border: "1px solid var(--fusion-border)"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      overflow: "hidden"
    }
  }, planOpen && /*#__PURE__*/React.createElement(PlanColumn, {
    c: c,
    onHide: () => setPlanOpen(false)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: "auto",
      padding: "16px 20px",
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(CharacterHeader, {
    c: c
  }), /*#__PURE__*/React.createElement(SkillsPanel, {
    c: c
  }), /*#__PURE__*/React.createElement(Panel, null, /*#__PURE__*/React.createElement(Tabs, {
    tabs: tabs,
    value: tab,
    onChange: setTab
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      paddingTop: 14
    }
  }, tab === "Magias" ? /*#__PURE__*/React.createElement(MagiasTab, {
    c: c,
    onAddSpell: () => setPickerOpen(true)
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "40px 12px",
      textAlign: "center",
      color: "var(--fusion-text-muted)",
      fontSize: 13
    }
  }, "Aba \u201C", tab, "\u201D \u2014 conte\xFAdo de exemplo omitido nesta recria\xE7\xE3o.")))))), pickerOpen && /*#__PURE__*/React.createElement(SpellPicker, {
    results: window.COMPENDIUM,
    onClose: () => setPickerOpen(false)
  }));
}
window.FichaApp = FichaApp;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/ficha-pf2e/FichaApp.jsx", error: String((e && e.message) || e) }); }

// ui_kits/ficha-pf2e/MagiasTab.jsx
try { (() => {
// Magias tab — sub-tabs by origin (Magus / Alquimista / Foco / Rituais).
const {
  Chip,
  SpellChip,
  SpellSlotCard,
  SpellSlotEmpty,
  ProficiencyBadge,
  Button
} = window.FusionVTTDesignSystem_1daa5f;
function SectionLabel({
  children,
  hint
}) {
  return /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      color: "var(--fusion-text-muted)",
      margin: "0 0 4px",
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, children, hint && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10.5,
      fontWeight: 400,
      textTransform: "none",
      color: "var(--fusion-text-subtle)",
      letterSpacing: 0
    }
  }, hint));
}
function StatsBar({
  items
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 18,
      background: "var(--fusion-surface-alt)",
      border: "1px solid var(--fusion-border)",
      borderRadius: "var(--fusion-radius)",
      padding: "10px 14px"
    }
  }, items.map(it => /*#__PURE__*/React.createElement("div", {
    key: it.lbl,
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9,
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      color: "var(--fusion-text-subtle)"
    }
  }, it.lbl), it.badge ? /*#__PURE__*/React.createElement(ProficiencyBadge, {
    rank: it.badge,
    variant: "filled",
    size: 20
  }) : /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      color: "var(--fusion-text)",
      fontFamily: "var(--fusion-font-mono)"
    }
  }, it.val))));
}
function EmptyState({
  msg
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      padding: "60px 20px",
      color: "var(--fusion-text-muted)",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 32,
      color: "var(--fusion-text-subtle)"
    }
  }, "\u26AB"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      maxWidth: 380,
      lineHeight: 1.5
    }
  }, msg));
}
function MagiasTab({
  c,
  onAddSpell
}) {
  const [origin, setOrigin] = React.useState("Magus");
  const s = c.spells;
  const origins = ["Magus", "Alquimista (Arquétipo)", "Foco", "Rituais"];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 4,
      flexWrap: "wrap"
    }
  }, origins.map(o => /*#__PURE__*/React.createElement(Chip, {
    key: o,
    active: o === origin,
    onClick: () => setOrigin(o)
  }, o))), origin === "Magus" && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(StatsBar, {
    items: [{
      lbl: "CD de Magia",
      val: s.dc
    }, {
      lbl: "Ataque",
      val: s.attack
    }, {
      lbl: "Tradição",
      val: s.tradition
    }, {
      lbl: "Atributo",
      val: s.keyAttr
    }, {
      lbl: "Proficiência",
      badge: s.prof
    }]
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(SectionLabel, {
    hint: "elevados ao patamar 2"
  }, "Truques"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 8
    }
  }, s.cantrips.map(n => /*#__PURE__*/React.createElement(SpellChip, {
    key: n,
    name: n,
    onAction: () => {}
  })))), s.ranks.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.rank
  }, /*#__PURE__*/React.createElement(SectionLabel, null, "Patamar ", r.rank), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10
    }
  }, r.prepared.map(p => /*#__PURE__*/React.createElement(SpellSlotCard, {
    key: p.name,
    name: p.name,
    available: p.available,
    onCast: () => {},
    onSwap: () => {}
  })), Array.from({
    length: r.openSlots
  }).map((_, i) => /*#__PURE__*/React.createElement(SpellSlotEmpty, {
    key: i
  }))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement(SectionLabel, null, "Grim\xF3rio"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "sm",
    onClick: onAddSpell
  }, "+ Adicionar magia")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, s.grimoire.map(n => /*#__PURE__*/React.createElement(SpellChip, {
    key: n,
    name: n,
    actionLabel: "Preparar",
    onAction: () => {}
  }))))), origin === "Alquimista (Arquétipo)" && /*#__PURE__*/React.createElement(EmptyState, {
    msg: "Este arqu\xE9tipo n\xE3o concede magias \u2014 itens alqu\xEDmicos ficam no Invent\xE1rio."
  }), origin === "Foco" && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(StatsBar, {
    items: [{
      lbl: "Pontos de Foco",
      val: `${c.focus.filled} / máx ${c.focus.total}`
    }]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 14,
      background: "var(--fusion-surface-alt)",
      border: "1px solid var(--fusion-border)",
      borderRadius: "var(--fusion-radius)",
      padding: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600
    }
  }, s.focusSpell.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--fusion-text-subtle)",
      marginTop: 2
    }
  }, s.focusSpell.note)), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "sm"
  }, "Lan\xE7ar")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--fusion-text-muted)",
      background: "var(--fusion-surface-alt)",
      border: "1px solid var(--fusion-border)",
      borderRadius: "var(--fusion-radius-sm)",
      padding: "8px 10px"
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "var(--fusion-text)"
    }
  }, "Refocus:"), " recupere 1 Ponto de Foco ap\xF3s 10 minutos de descanso concentrando-se na pr\xE1tica da sua classe.")), origin === "Rituais" && /*#__PURE__*/React.createElement(EmptyState, {
    msg: "Nenhum ritual conhecido"
  }));
}
window.MagiasTab = MagiasTab;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/ficha-pf2e/MagiasTab.jsx", error: String((e && e.message) || e) }); }

// ui_kits/ficha-pf2e/PlanColumn.jsx
try { (() => {
// Plan column: ABC cards + level-by-level assembly (Pathbuilder style).
const {
  ABCCard,
  LevelCard,
  Slot,
  EmptySlot,
  OptionalBadge,
  Button
} = window.FusionVTTDesignSystem_1daa5f;
function PlanColumn({
  c,
  onHide
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: 300,
      flexShrink: 0,
      borderRight: "1px solid var(--fusion-border)",
      background: "var(--fusion-surface)",
      display: "flex",
      flexDirection: "column",
      overflowY: "auto",
      padding: 12,
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      margin: 0
    }
  }, "Plano"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "tiny",
    onClick: onHide
  }, "Ocultar plano")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, c.plan.abc.map(a => /*#__PURE__*/React.createElement(ABCCard, {
    key: a.typeLabel,
    typeLabel: a.typeLabel,
    name: a.name,
    subLine: a.subLine
  }))), c.plan.levels.map(lv => /*#__PURE__*/React.createElement(LevelCard, {
    key: lv.level,
    level: lv.level,
    autoFeatures: lv.auto
  }, lv.slots.map(s => /*#__PURE__*/React.createElement(Slot, {
    key: s.name,
    name: s.name,
    type: s.type,
    badge: s.optional ? /*#__PURE__*/React.createElement(OptionalBadge, null) : undefined,
    onRemove: () => {}
  })), lv.empty && /*#__PURE__*/React.createElement(EmptySlot, null, lv.empty))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "auto",
      paddingTop: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    fullWidth: true
  }, "Subir de n\xEDvel \u2192 4")));
}
window.PlanColumn = PlanColumn;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/ficha-pf2e/PlanColumn.jsx", error: String((e && e.message) || e) }); }

// ui_kits/ficha-pf2e/SkillsPanel.jsx
try { (() => {
// Perícias panel — all 17 skills in two columns, always visible.
const {
  Panel,
  SkillRow
} = window.FusionVTTDesignSystem_1daa5f;
function SkillsPanel({
  c
}) {
  const half = Math.ceil(c.skills.length / 2);
  const left = c.skills.slice(0, half);
  const right = c.skills.slice(half);
  return /*#__PURE__*/React.createElement(Panel, {
    title: "Per\xEDcias"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "0 16px"
    }
  }, /*#__PURE__*/React.createElement("div", null, left.map(s => /*#__PURE__*/React.createElement(SkillRow, {
    key: s.name,
    rank: s.rank,
    name: s.name,
    modifier: s.mod
  }))), /*#__PURE__*/React.createElement("div", null, right.map(s => /*#__PURE__*/React.createElement(SkillRow, {
    key: s.name,
    rank: s.rank,
    name: s.name,
    modifier: s.mod
  })))));
}
window.SkillsPanel = SkillsPanel;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/ficha-pf2e/SkillsPanel.jsx", error: String((e && e.message) || e) }); }

// ui_kits/ficha-pf2e/SpellPicker.jsx
try { (() => {
// Spell compendium picker modal — search, rank/trait filters, results.
const {
  Modal,
  SearchBox,
  Chip,
  ResultRow,
  Button
} = window.FusionVTTDesignSystem_1daa5f;
function SpellPicker({
  results,
  onClose
}) {
  const [query, setQuery] = React.useState("");
  const [rank, setRank] = React.useState(1);
  const [trait, setTrait] = React.useState(null);
  const [selected, setSelected] = React.useState("Rajada de Força");
  const traits = ["Evocation", "Conjuration", "Mental", "Force"];
  const filtered = results.filter(r => {
    if (query && !r.name.toLowerCase().includes(query.toLowerCase())) return false;
    if (rank != null && r.rank !== rank) return false;
    if (trait && !r.traits.includes(trait)) return false;
    return true;
  });
  return /*#__PURE__*/React.createElement(Modal, {
    title: "Adicionar magia \u2014 Magus (Arcana)",
    onClose: onClose,
    footerNote: "Dados mec\xE2nicos ORC \u2014 prosa n\xE3o inclu\xEDda (clean-room)",
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      onClick: onClose
    }, "Cancelar"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      onClick: onClose
    }, "Adicionar ao grim\xF3rio"))
  }, /*#__PURE__*/React.createElement(SearchBox, {
    value: query,
    onChange: e => setQuery(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 6,
      alignItems: "center"
    }
  }, [0, 1, 2].map(n => /*#__PURE__*/React.createElement(Chip, {
    key: n,
    active: rank === n,
    onClick: () => setRank(rank === n ? null : n)
  }, n)), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 1,
      height: 16,
      background: "var(--fusion-border)",
      margin: "0 4px"
    }
  }), /*#__PURE__*/React.createElement(Chip, {
    fixed: true
  }, "Tradi\xE7\xE3o: Arcana"), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 1,
      height: 16,
      background: "var(--fusion-border)",
      margin: "0 4px"
    }
  }), traits.map(t => /*#__PURE__*/React.createElement(Chip, {
    key: t,
    active: trait === t,
    onClick: () => setTrait(trait === t ? null : t)
  }, t))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 4,
      border: "1px solid var(--fusion-border)",
      borderRadius: "var(--fusion-radius)",
      padding: 4,
      maxHeight: 340,
      overflowY: "auto"
    }
  }, filtered.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "32px 12px",
      textAlign: "center",
      fontSize: 13,
      color: "var(--fusion-text-muted)"
    }
  }, "Nenhuma magia encontrada com esses filtros."), filtered.map(r => /*#__PURE__*/React.createElement(ResultRow, {
    key: r.name,
    rank: r.rank,
    actionCost: r.actionCost,
    name: r.name,
    traits: r.traits,
    source: r.source,
    selected: selected === r.name,
    onClick: () => setSelected(r.name)
  }))));
}
window.SpellPicker = SpellPicker;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/ficha-pf2e/SpellPicker.jsx", error: String((e && e.message) || e) }); }

// ui_kits/ficha-pf2e/data.js
try { (() => {
// Shared character data for the Ficha PF2e UI kit — Tobias, Ratfolk Magus 3.
const DS = window.FusionVTTDesignSystem_1daa5f;
const TOBIAS = {
  name: "Tobias",
  identity: "Ratfolk (Snow Rat) • Fireworks Performer • Magus 3",
  hp: {
    current: 33,
    max: 33
  },
  ac: 19,
  saves: [{
    label: "Fort",
    value: "+8"
  }, {
    label: "Reflexos",
    value: "+8"
  }, {
    label: "Vontade",
    value: "+7"
  }],
  perception: "+5",
  attrs: [{
    label: "FOR",
    value: "+0"
  }, {
    label: "DES",
    value: "+3"
  }, {
    label: "CON",
    value: "+1"
  }, {
    label: "INT",
    value: "+3"
  }, {
    label: "SAB",
    value: "+0"
  }, {
    label: "CAR",
    value: "+2"
  }],
  heroism: {
    filled: 1,
    cap: 3
  },
  focus: {
    filled: 1,
    total: 1,
    cap: 3
  },
  // All 17 PF2e skills, always visible.
  skills: [{
    rank: "U",
    name: "Acrobacia",
    mod: "+3"
  }, {
    rank: "T",
    name: "Arcanismo",
    mod: "+8"
  }, {
    rank: "U",
    name: "Atletismo",
    mod: "+0"
  }, {
    rank: "E",
    name: "Ofícios",
    mod: "+10"
  }, {
    rank: "U",
    name: "Enganação",
    mod: "+2"
  }, {
    rank: "T",
    name: "Diplomacia",
    mod: "+7"
  }, {
    rank: "U",
    name: "Intimidação",
    mod: "+2"
  }, {
    rank: "T",
    name: "Medicina",
    mod: "+5"
  }, {
    rank: "U",
    name: "Natureza",
    mod: "+0"
  }, {
    rank: "T",
    name: "Ocultismo",
    mod: "+8"
  }, {
    rank: "T",
    name: "Atuação",
    mod: "+7"
  }, {
    rank: "U",
    name: "Religião",
    mod: "+0"
  }, {
    rank: "T",
    name: "Sociedade",
    mod: "+8"
  }, {
    rank: "T",
    name: "Furtividade",
    mod: "+8"
  }, {
    rank: "U",
    name: "Sobrevivência",
    mod: "+0"
  }, {
    rank: "T",
    name: "Ladinagem",
    mod: "+8"
  }, {
    rank: "T",
    name: "Conhecimento (Fogos de Artifício)",
    mod: "+8"
  }],
  plan: {
    abc: [{
      typeLabel: "Ancestralidade",
      name: "Ratfolk"
    }, {
      typeLabel: "Herança",
      name: "Snow Rat"
    }, {
      typeLabel: "Antecedente",
      name: "Fireworks Performer"
    }, {
      typeLabel: "Classe",
      name: "Magus",
      subLine: "Estudo Híbrido: Starlit Span"
    }],
    levels: [{
      level: 1,
      slots: [{
        name: "Dádivas de Atributo",
        type: "4 aumentos de atributo"
      }, {
        name: "Tinkering Fingers",
        type: "Talento de Ancestralidade"
      }, {
        name: "Starlit Span",
        type: "Estudo Híbrido"
      }, {
        name: "Arcanismo + 5 outras",
        type: "Treinamento de Perícias"
      }],
      auto: ["Conjuração Arcana", "Golpe Feiticeiro", "Magias de Confluência"]
    }, {
      level: 2,
      slots: [{
        name: "Magus's Analysis",
        type: "Talento de Classe"
      }, {
        name: "Impressive Performance",
        type: "Talento de Perícia"
      }, {
        name: "Alchemist Dedication",
        type: "Arquétipo Livre",
        optional: true
      }]
    }, {
      level: 3,
      slots: [{
        name: "Read Lips",
        type: "Talento Geral"
      }, {
        name: "Ofícios → Especialista",
        type: "Aumento de Perícia"
      }],
      auto: ["Reação de Classe"],
      empty: "+ Escolher talento de classe"
    }]
  },
  spells: {
    dc: 18,
    attack: "+8",
    tradition: "Arcana",
    keyAttr: "INT",
    prof: "T",
    cantrips: ["Detectar Magia", "Arco Elétrico", "Escudo", "Mordida do Gelo", "Projétil Telecinético"],
    ranks: [{
      rank: 1,
      prepared: [{
        name: "Rajada de Força",
        available: true
      }],
      openSlots: 1
    }, {
      rank: 2,
      prepared: [{
        name: "Névoa Obscurecente",
        available: true
      }],
      openSlots: 0
    }],
    grimoire: ["Graxa", "Golpe Certeiro", "Tentáculos Sombrios"],
    focusSpell: {
      name: "Estrela Cadente",
      note: "Patamar 2 • consome 1 ponto de foco"
    }
  }
};

// Sample compendium results for the picker modal.
const COMPENDIUM = [{
  rank: 1,
  actionCost: "2A",
  name: "Rajada de Força",
  traits: ["Evocation", "Force"],
  source: "Player Core"
}, {
  rank: 1,
  actionCost: "1A",
  name: "Graxa",
  traits: ["Conjuration"],
  source: "Player Core"
}, {
  rank: 1,
  actionCost: "2A",
  name: "Golpe Certeiro",
  traits: ["Evocation"],
  source: "Player Core"
}, {
  rank: 1,
  actionCost: "2A",
  name: "Tentáculos Sombrios",
  traits: ["Conjuration"],
  source: "Player Core"
}, {
  rank: 1,
  actionCost: "1A",
  name: "Escudo do Feiticeiro",
  traits: ["Evocation", "Force"],
  source: "Player Core"
}, {
  rank: 2,
  actionCost: "2A",
  name: "Névoa Obscurecente",
  traits: ["Conjuration"],
  source: "Player Core"
}, {
  rank: 2,
  actionCost: "2A",
  name: "Golpe Flamejante",
  traits: ["Evocation"],
  source: "Player Core"
}, {
  rank: 0,
  actionCost: "1A",
  name: "Projétil Telecinético",
  traits: ["Evocation", "Mental"],
  source: "Player Core"
}, {
  rank: 0,
  actionCost: "2A",
  name: "Arco Elétrico",
  traits: ["Evocation"],
  source: "Player Core"
}, {
  rank: 0,
  actionCost: "1A",
  name: "Detectar Magia",
  traits: ["Conjuration"],
  source: "Player Core"
}];
window.TOBIAS = TOBIAS;
window.COMPENDIUM = COMPENDIUM;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/ficha-pf2e/data.js", error: String((e && e.message) || e) }); }

__ds_ns.ACShield = __ds_scope.ACShield;

__ds_ns.Pip = __ds_scope.Pip;

__ds_ns.PipRow = __ds_scope.PipRow;

__ds_ns.ProficiencyBadge = __ds_scope.ProficiencyBadge;

__ds_ns.SkillRow = __ds_scope.SkillRow;

__ds_ns.StatChip = __ds_scope.StatChip;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.ModeToggle = __ds_scope.ModeToggle;

__ds_ns.SearchBox = __ds_scope.SearchBox;

__ds_ns.Modal = __ds_scope.Modal;

__ds_ns.Panel = __ds_scope.Panel;

__ds_ns.Chip = __ds_scope.Chip;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.ABCCard = __ds_scope.ABCCard;

__ds_ns.Slot = __ds_scope.Slot;

__ds_ns.EmptySlot = __ds_scope.EmptySlot;

__ds_ns.AutoChip = __ds_scope.AutoChip;

__ds_ns.LevelCard = __ds_scope.LevelCard;

__ds_ns.OptionalBadge = __ds_scope.OptionalBadge;

__ds_ns.ResultRow = __ds_scope.ResultRow;

__ds_ns.SpellSlotCard = __ds_scope.SpellSlotCard;

__ds_ns.SpellSlotEmpty = __ds_scope.SpellSlotEmpty;

__ds_ns.SpellChip = __ds_scope.SpellChip;

})();
