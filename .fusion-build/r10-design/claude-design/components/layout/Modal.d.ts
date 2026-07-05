import * as React from "react";

export interface ModalProps {
  title?: React.ReactNode;
  /** Called on backdrop click and the × button. */
  onClose?: () => void;
  /** Small muted note at the footer's left (e.g. clean-room disclaimer). */
  footerNote?: React.ReactNode;
  /** Footer action buttons (right-aligned). */
  footer?: React.ReactNode;
  width?: number;
  maxHeight?: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/** Centered dialog on a dimmed backdrop — the spell compendium picker. */
export declare function Modal(props: ModalProps): JSX.Element;
