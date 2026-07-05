import * as React from "react";

export interface ModeToggleProps {
  /** Segment labels. Defaults to the sheet's Jogar/Editar. */
  options?: string[];
  /** Controlled active label. */
  value?: string;
  /** Uncontrolled initial label. */
  defaultValue?: string;
  onChange?: (value: string) => void;
  style?: React.CSSProperties;
}

/** Segmented control; the active segment fills with the accent. */
export declare function ModeToggle(props: ModeToggleProps): JSX.Element;
