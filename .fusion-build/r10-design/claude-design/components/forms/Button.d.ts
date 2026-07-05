import * as React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. `primary` is the only accent-filled variant. */
  variant?: "primary" | "secondary" | "ghost" | "subtle" | "danger";
  /** Padding / font-size preset. */
  size?: "tiny" | "sm" | "md" | "lg";
  disabled?: boolean;
  /** Stretch to container width (used in the plan-column "Subir de nível"). */
  fullWidth?: boolean;
  children?: React.ReactNode;
}

/**
 * Primary action control for Fusion VTT.
 * @startingPoint section="Forms" subtitle="Button variants & sizes" viewport="700x140"
 */
export declare function Button(props: ButtonProps): JSX.Element;
