import * as React from "react";

export interface PanelProps {
  /** Optional section heading (13px / 600). */
  title?: React.ReactNode;
  /** Right-aligned header controls (e.g. a Button). */
  actions?: React.ReactNode;
  padding?: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * Surface-alt section card — the primary content container on the sheet.
 * @startingPoint section="Layout" subtitle="Section card / panel" viewport="700x220"
 */
export declare function Panel(props: PanelProps): JSX.Element;
