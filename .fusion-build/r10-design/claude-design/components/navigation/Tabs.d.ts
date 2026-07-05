import * as React from "react";

export interface TabItem {
  id: string;
  label: React.ReactNode;
}

export interface TabsProps {
  /** Tab list — objects {id,label} or plain strings. */
  tabs: (TabItem | string)[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  style?: React.CSSProperties;
}

/**
 * Underlined tab bar; active tab is accent text with a 2px accent underline.
 * @startingPoint section="Navigation" subtitle="Underlined tab bar" viewport="700x120"
 */
export declare function Tabs(props: TabsProps): JSX.Element;
