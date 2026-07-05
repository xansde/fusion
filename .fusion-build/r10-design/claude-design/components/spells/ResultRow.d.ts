import * as React from "react";

export interface ResultRowProps {
  /** Spell rank / patamar shown in the square (0 = truque). */
  rank: React.ReactNode;
  /** Action cost label, e.g. "1A", "2A". Omit to hide. */
  actionCost?: React.ReactNode;
  name: React.ReactNode;
  /** Trait chips (Evocation, Force…). */
  traits?: string[];
  /** Source book, e.g. "Player Core". */
  source?: React.ReactNode;
  /** Highlighted selection (accent wash + border). */
  selected?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

/** One row in the spell compendium results list. */
export declare function ResultRow(props: ResultRowProps): JSX.Element;
