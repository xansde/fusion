import * as React from "react";

export interface ChipProps {
  children?: React.ReactNode;
  /** Selected state — accent wash + border + text. */
  active?: boolean;
  /** Non-interactive context filter (dashed border, e.g. "Tradição: Arcana"). */
  fixed?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

/** Rounded pill for sub-tabs (spell origins) and compendium filters. */
export declare function Chip(props: ChipProps): JSX.Element;
