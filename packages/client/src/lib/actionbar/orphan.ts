/**
 * orphan.ts — a favourite whose entry left the sheet (BAR-F3-01; spec 53 REQ-BAR-066, CA-BAR-06,
 * DEC-BAR-06).
 *
 * An item was sold, a spell was swapped: the id is still pinned in the actor, but no entry answers
 * to it any more. The row keeps it — the bar never removes a favourite by itself (REQ-BAR-065) — and
 * draws it FADED as "não está mais na ficha"; the only way out is "Desafixar".
 *
 * The slot is the ordinary `Slot.svelte`, fed a stand-in entry built here. That keeps the look (a
 * faded slot with its key and its reason), the tooltip and the menu on the code every slot already
 * uses, and it is why the stand-in must be a VALID entry: the same contract a provider's entries pass.
 * It is faded with a reason, so a click on it is told "not on the sheet" by the shell, and the row
 * never asks the provider to run an entry the provider never listed.
 */

import { t } from "../i18n/i18n.js";
import { FAVORITE_SLOT_COUNT } from "./favoritesSource.js";
import type { ActionBarEntry, ActionBarEntryKind } from "./types.js";

/**
 * After the active actor changes the bar waits this long before it draws a favourite as an orphan.
 * The provider's list is not complete at once — the packs that give the basic actions arrive from the
 * server a moment after the sheet's own data — and a favourite that is only late would flash as
 * "Ausente" at every load. Past the wait, a missing entry is an orphan; a real one (a sale made
 * during the session) shows at once, because the wait is for the LOAD, not for every change.
 */
export const ORPHAN_ARM_MS = 1500;

const KINDS: readonly ActionBarEntryKind[] = [
  "strike",
  "spell",
  "action",
  "item",
  "reaction",
  "toggle",
  "check",
];

const TAB_OF_KIND: Readonly<Record<ActionBarEntryKind, ActionBarEntry["tab"]>> = {
  strike: "strikes",
  spell: "spells",
  action: "actions",
  item: "items",
  reaction: "reactions",
  toggle: "actions",
  check: "checks",
};

/** The kind the prefix of an entry id names; an id the bar does not know reads as an action. */
export function kindOfEntryId(id: string): ActionBarEntryKind {
  const prefix = id.slice(0, Math.max(0, id.indexOf(":")));
  return KINDS.find((kind) => kind === prefix) ?? "action";
}

/** The stand-in entry of an orphan: faded, with its reason, and nothing a click could run. */
export function orphanEntry(id: string): ActionBarEntry {
  const kind = kindOfEntryId(id);
  return {
    id,
    kind,
    tab: TAB_OF_KIND[kind],
    label: t("FUSION.ActionBar.Favorites.Orphan.Label"),
    shortLabel: t("FUSION.ActionBar.Favorites.Orphan.Short"),
    icon: "eyeoff",
    state: "unavailable",
    reason: t("FUSION.ActionBar.Favorites.Orphan.Reason"),
  };
}

/** What one of the twelve positions of the Favorites row draws. */
export type FavoriteCell =
  | { readonly kind: "entry"; readonly entry: ActionBarEntry }
  | { readonly kind: "orphan"; readonly entry: ActionBarEntry }
  | { readonly kind: "empty" };

/**
 * The twelve positions of the row, each as what it draws: the entry the pinned id answers to, an
 * ORPHAN when none does, or an empty box.
 *
 * A missing entry is an orphan only when two things are true, because "missing" is not yet "gone":
 *  - the bar is `armed` — the load window after the active actor changed has passed (see
 *    {@link ORPHAN_ARM_MS});
 *  - the provider gave SOMETHING. A provider that failed, or has not loaded, gives nothing, and a list
 *    that is not there says nothing about the row. (Every character has at least the fist strike, so
 *    a loaded sheet is never empty.)
 * Otherwise the position stays an empty box, exactly as before there were orphans.
 */
export function favoriteCells(
  row: ReadonlyArray<string | null>,
  entries: readonly ActionBarEntry[],
  armed: boolean,
): FavoriteCell[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
  const judge = armed && entries.length > 0;
  return Array.from({ length: FAVORITE_SLOT_COUNT }, (_, index): FavoriteCell => {
    const id = row[index] ?? null;
    if (id === null) return { kind: "empty" };
    const entry = byId.get(id);
    if (entry !== undefined) return { kind: "entry", entry };
    return judge ? { kind: "orphan", entry: orphanEntry(id) } : { kind: "empty" };
  });
}

/** The pinned ids no entry answers to, in slot order, each once. */
export function orphanIds(
  row: ReadonlyArray<string | null>,
  entries: readonly ActionBarEntry[],
): string[] {
  const known = new Set(entries.map((entry) => entry.id));
  const orphans: string[] = [];
  for (const id of row) {
    if (id !== null && !known.has(id) && !orphans.includes(id)) orphans.push(id);
  }
  return orphans;
}
