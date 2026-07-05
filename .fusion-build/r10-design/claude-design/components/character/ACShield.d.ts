import * as React from "react";

export interface ACShieldProps {
  /** Armour class value. */
  value?: React.ReactNode;
  /** Caption under the value. Default "CA". */
  label?: string;
  width?: number;
  height?: number;
  style?: React.CSSProperties;
}

/** Hexagon-clipped Armour Class shield — the sheet's one shaped stat. */
export declare function ACShield(props: ACShieldProps): JSX.Element;
