import * as React from "react";

export interface SpellSlotCardProps {
  name: React.ReactNode;
  /** Show the accent availability pip after the name. */
  available?: boolean;
  onCast?: () => void;
  onSwap?: () => void;
  style?: React.CSSProperties;
}

export interface SpellSlotEmptyProps {
  children?: React.ReactNode;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export interface SpellChipProps {
  name: React.ReactNode;
  /** Trailing button label (default "Trocar"; grimoire uses "Preparar"). */
  actionLabel?: string;
  onAction?: () => void;
  style?: React.CSSProperties;
}

/** Prepared-spell slot with Lançar / Trocar. */
export declare function SpellSlotCard(props: SpellSlotCardProps): JSX.Element;
/** Empty dashed "Preparar magia…" slot. */
export declare function SpellSlotEmpty(props: SpellSlotEmptyProps): JSX.Element;
/** Cantrip / grimoire chip with a trailing action. */
export declare function SpellChip(props: SpellChipProps): JSX.Element;
