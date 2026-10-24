/**
 * targetMode.ts — how a right-click / an area release changes the user's aim. Pure.
 *
 * The aim (`combat:target`) used to be additive only: aiming a token never un-aimed the others. Two gestures now
 * decide per click:
 *  - "single" (default): the click REPLACES the aim; Shift accumulates;
 *  - "multi": the click accumulates; Shift replaces.
 * Replacing on the token that is already the ONLY aim clears it (the second click undoes the first).
 * An area release replaces the aim with the tokens inside it; Shift on release adds them to what is aimed.
 */

import { templateCells, type AreaTemplate, type CellOffset, type SquareGrid } from "@fusion/shared";

export type TargetMode = "single" | "multi";

export const TARGET_MODES: ReadonlyArray<{ mode: TargetMode; label: string }> = [
  { mode: "single", label: "Um alvo" },
  { mode: "multi", label: "Vários" },
];

export const DEFAULT_TARGET_MODE: TargetMode = "single";

export function isTargetMode(v: unknown): v is TargetMode {
  return v === "single" || v === "multi";
}

/** The aim wanted after a right-click on `tokenId`, given the current aim. */
export function resolveTargetClick(
  mode: TargetMode,
  shift: boolean,
  tokenId: string,
  current: readonly string[],
): string[] {
  const replace = (mode === "single") !== shift;
  const aimed = current.includes(tokenId);
  if (replace) {
    return aimed && current.length === 1 ? [] : [tokenId];
  }
  return aimed ? current.filter((id) => id !== tokenId) : [...current, tokenId];
}

/** A token as the area selector sees it: its id and the squares it covers. */
export interface AreaSelectable {
  readonly id: string;
  readonly i: number;
  readonly j: number;
  readonly width: number;
  readonly height: number;
}

/** Whether the area selector may take a token: a hidden token is invisible to everyone but the GM. */
export function areaSelectable(token: { readonly hidden?: boolean }, isGm: boolean): boolean {
  return isGm || token.hidden !== true;
}

/** Ids of the tokens with at least one square inside `cells`, in input order. */
export function tokenIdsInCells(
  cells: ReadonlyArray<CellOffset>,
  tokens: ReadonlyArray<AreaSelectable>,
): string[] {
  const set = new Set(cells.map((c) => `${String(c.i)},${String(c.j)}`));
  const ids: string[] = [];
  for (const t of tokens) {
    let hit = false;
    for (let j = t.j; j < t.j + t.height && !hit; j++) {
      for (let i = t.i; i < t.i + t.width; i++) {
        if (set.has(`${String(i)},${String(j)}`)) {
          hit = true;
          break;
        }
      }
    }
    if (hit) ids.push(t.id);
  }
  return ids;
}

/** The aim wanted after releasing an area over `inArea`: replaces, or (Shift) adds to the current aim. */
export function resolveAreaRelease(
  shift: boolean,
  current: readonly string[],
  inArea: readonly string[],
): string[] {
  if (!shift) return [...inArea];
  return [...current, ...inArea.filter((id) => !current.includes(id))];
}

/**
 * The aim wanted after the area selector is released: every token whose squares touch the template's squares
 * (allies included), replacing the current aim or, with Shift, added to it.
 */
export function areaSelection(
  template: AreaTemplate,
  grid: SquareGrid,
  tokens: ReadonlyArray<AreaSelectable>,
  current: readonly string[],
  shift: boolean,
): string[] {
  const inArea = tokenIdsInCells(templateCells(template, grid), tokens);
  return resolveAreaRelease(shift, current, inArea);
}

// ---------------------------------------------------------------------------
// Persistence — the chosen mode is per user, in this browser
// ---------------------------------------------------------------------------

const STORAGE_KEY = "fusion.targetMode";

export function loadTargetMode(): TargetMode {
  try {
    const v = globalThis.localStorage.getItem(STORAGE_KEY);
    return isTargetMode(v) ? v : DEFAULT_TARGET_MODE;
  } catch {
    return DEFAULT_TARGET_MODE;
  }
}

export function saveTargetMode(mode: TargetMode): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Storage blocked (private window): the mode just does not survive a reload.
  }
}
