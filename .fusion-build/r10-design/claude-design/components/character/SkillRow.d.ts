import * as React from "react";
import type { ProficiencyRank } from "./ProficiencyBadge";

export interface SkillRowProps {
  rank?: ProficiencyRank;
  name: React.ReactNode;
  /** Total modifier, e.g. "+8". Shown in mono. */
  modifier?: React.ReactNode;
  /** Fires on click / roll. */
  onRoll?: () => void;
  style?: React.CSSProperties;
}

/** One rollable skill line: TEML badge · name · d20 hint · modifier. */
export declare function SkillRow(props: SkillRowProps): JSX.Element;
