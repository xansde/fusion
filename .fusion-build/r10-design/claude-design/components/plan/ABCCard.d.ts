import * as React from "react";

export interface ABCCardProps {
  /** Uppercase category, e.g. "Ancestralidade", "Classe". */
  typeLabel: React.ReactNode;
  /** Chosen option name. */
  name: React.ReactNode;
  /** Optional secondary line (e.g. "Estudo Híbrido: Starlit Span"). */
  subLine?: React.ReactNode;
  /** Filled green check when done; dashed empty circle otherwise. */
  done?: boolean;
  style?: React.CSSProperties;
}

/** Ancestry / Heritage / Background / Class summary card for the plan column. */
export declare function ABCCard(props: ABCCardProps): JSX.Element;
