/**
 * favoriteKeys.ts — the twelve keys of the Favorites row (BAR-F1-04, BAR-F1-05; spec 53 REQ-BAR-048,
 * DEC-BAR-07).
 *
 * One table for the three things that must agree: the SEAL drawn on the slot (`label`), the
 * `aria-keyshortcuts` of its button (`shortcut`) and the physical key the shortcut listens to
 * (`code`). The position in the table is the position of the slot: the key 1 runs the first
 * favourite, the minus the eleventh, the equals sign the twelfth.
 *
 * `code`, not `key`: a slot answers to the PHYSICAL key, whatever the layout writes on it (the
 * digits of an AZERTY row need Shift to type a digit, and they must run a slot all the same).
 */

export interface FavoriteKey {
  /** `KeyboardEvent.code` of the physical key. */
  readonly code: string;
  /** What the slot's key seal says. The minus is the typographic one, as in the prototype. */
  readonly label: string;
  /** The `aria-keyshortcuts` token. */
  readonly shortcut: string;
}

export const FAVORITE_KEYS: readonly FavoriteKey[] = [
  { code: "Digit1", label: "1", shortcut: "1" },
  { code: "Digit2", label: "2", shortcut: "2" },
  { code: "Digit3", label: "3", shortcut: "3" },
  { code: "Digit4", label: "4", shortcut: "4" },
  { code: "Digit5", label: "5", shortcut: "5" },
  { code: "Digit6", label: "6", shortcut: "6" },
  { code: "Digit7", label: "7", shortcut: "7" },
  { code: "Digit8", label: "8", shortcut: "8" },
  { code: "Digit9", label: "9", shortcut: "9" },
  { code: "Digit0", label: "0", shortcut: "0" },
  { code: "Minus", label: "\u2212", shortcut: "-" },
  { code: "Equal", label: "=", shortcut: "=" },
];
