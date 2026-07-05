import * as React from "react";

export interface SlotProps {
  name: React.ReactNode;
  /** Category caption, e.g. "Talento de Classe". */
  type?: React.ReactNode;
  /** Inline badge after the name (e.g. <OptionalBadge/>). */
  badge?: React.ReactNode;
  /** Show a hover-revealed remove × and fire this. */
  onRemove?: () => void;
  style?: React.CSSProperties;
}

export interface EmptySlotProps {
  children?: React.ReactNode;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export interface AutoChipProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export interface OptionalBadgeProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export interface LevelCardProps {
  /** Level number shown in the header. */
  level: number | string;
  /** Slots / EmptySlots. */
  children?: React.ReactNode;
  /** Locked automatic features, rendered as padlock AutoChips under a divider. */
  autoFeatures?: React.ReactNode[];
  style?: React.CSSProperties;
}

/**
 * Per-level assembly card (Pathbuilder-style) for the plan column.
 * @startingPoint section="Plan" subtitle="Level card with choice slots" viewport="380x320"
 */
export declare function LevelCard(props: LevelCardProps): JSX.Element;
/** A filled choice slot. */
export declare function Slot(props: SlotProps): JSX.Element;
/** An empty, dashed choice slot. */
export declare function EmptySlot(props: EmptySlotProps): JSX.Element;
/** A locked automatic-feature chip. */
export declare function AutoChip(props: AutoChipProps): JSX.Element;
/** Amber optional-rule badge for a slot. */
export declare function OptionalBadge(props: OptionalBadgeProps): JSX.Element;
