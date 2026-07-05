import * as React from "react";

export type ProficiencyRank = "U" | "T" | "E" | "M" | "L";

export interface ProficiencyBadgeProps {
  /** U=Destreinado, T=Treinado, E=Expert, M=Mestre, L=Lendário. */
  rank?: ProficiencyRank;
  /** `outline` (skill rows) or `filled` (specimen / stat bars). */
  variant?: "outline" | "filled";
  /** Square side in px. Default 18. */
  size?: number;
  title?: string;
  style?: React.CSSProperties;
}

/**
 * Pathfinder 2e TEML rank badge — the signature Fusion data glyph.
 * @startingPoint section="Character" subtitle="TEML proficiency badges" viewport="700x120"
 */
export declare function ProficiencyBadge(props: ProficiencyBadgeProps): JSX.Element;
