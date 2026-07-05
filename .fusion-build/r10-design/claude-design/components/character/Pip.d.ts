import * as React from "react";

export interface PipProps {
  state?: "filled" | "empty" | "locked";
  /** Diameter in px. Default 12. */
  size?: number;
  title?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export interface PipRowProps {
  /** Uppercase micro-label above the dots. */
  label?: string;
  /** Number of filled pips, counted from the left. */
  filled?: number;
  /** Current maximum; pips at index >= total render locked (hatched). */
  total?: number;
  /** How many pips to draw in total (>= total shows the locked cap). */
  cap?: number;
  size?: number;
  /** Tooltip on locked pips (e.g. "Além do seu máximo atual"). */
  lockedTitle?: string;
  style?: React.CSSProperties;
}

/** A single resource pip. */
export declare function Pip(props: PipProps): JSX.Element;
/** A labelled row of pips for Foco / Heroísmo. */
export declare function PipRow(props: PipRowProps): JSX.Element;
