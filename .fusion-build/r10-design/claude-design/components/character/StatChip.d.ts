import * as React from "react";

export interface StatChipProps {
  /** Uppercase micro-label (Fort, Reflexos, DES…). */
  label: string;
  /** The value shown large, in mono (e.g. "+8", "19"). */
  value: React.ReactNode;
  minWidth?: number;
  /** When true (default) hover shows accent border + wash to signal a rollable stat. */
  interactive?: boolean;
  style?: React.CSSProperties;
}

/** Label-over-value chip for saves, Percepção and attribute pills. */
export declare function StatChip(props: StatChipProps): JSX.Element;
