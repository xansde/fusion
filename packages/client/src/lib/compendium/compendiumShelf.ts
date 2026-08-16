/**
 * compendiumShelf.ts — the view model of the shelf body (spec 43 §5.3).
 *
 * The shelf is what the Compendium tab shows when nothing was asked: every pack
 * the caller may see, grouped by document type, each group collapsible and
 * counting its packs (REQ-CPD-020), each pack naming itself with its label, its
 * document count and its LICENSE (REQ-CPD-021).
 *
 * Two rules shape the model rather than the markup:
 *
 *  - **The license is not decoration** (DEC-CPD-07). It is the reason this
 *    project is clean-room, so it is a required field of every row — never
 *    optional, never absent, and the one thing the body may not truncate. The
 *    row carries the identifier (`license`) separately from the long prose
 *    (`licenseDetail`) precisely so the short, load-bearing half can always be
 *    drawn whole while the prose degrades into a tooltip.
 *  - **A world pack is not a different kind of shelf** (REQ-CPD-025). Packs made
 *    by the world sit in the same groups as the system's, and what tells them
 *    apart is the license they show — so this model has no "origin" field to
 *    segregate them by.
 *
 * `gmOnly` (REQ-CPD-022) is a display mark for the privileged shelf only. The
 * audience itself is enforced on the server (DEC-CPD-04): a `gm` pack never
 * reaches a player's list. Marking it here is so the GM knows what the table
 * does not see — which is worth nothing to a player, and would be a leak if a
 * pack ever slipped through, hence the explicit `viewerIsPrivileged` gate.
 *
 * Pure TS (the collapse store aside), so Vitest can exercise it without a DOM.
 */

import type { PackManifest, LicenseKind } from "@fusion/shared";
import { groupPacksByType, documentTypeLabelKey } from "./compendiumBrowser.js";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/** One pack on the shelf. */
export interface ShelfPackRow {
  readonly id: string;
  readonly label: string;
  /** How many documents the pack holds (REQ-CPD-021). */
  readonly documentCount: number;
  /**
   * The license identifier of the pack, e.g. `"ORC"`. Short by construction and
   * never empty — the field the shelf must always be able to show in full.
   */
  readonly license: LicenseKind;
  /**
   * Attribution and reserved-material notice, for the row's tooltip. May be
   * empty when the pack declares neither; the identifier above never is.
   */
  readonly licenseDetail: string;
  /** True only on the privileged shelf, for a pack of audience `"gm"`. */
  readonly gmOnly: boolean;
}

/** One collapsible group of the shelf: all packs of a document type. */
export interface ShelfGroup {
  readonly documentType: string;
  /** i18n key for the heading, resolved by the component. */
  readonly labelKey: string;
  /** How many PACKS are in the group (REQ-CPD-020) — not how many documents. */
  readonly packCount: number;
  /** Whether the group is currently collapsed (REQ-CPD-023). */
  readonly collapsed: boolean;
  /** Always the full list: collapsing is a drawing decision, not a filter. */
  readonly packs: readonly ShelfPackRow[];
}

/** What the shelf needs to know beyond the packs themselves. */
export interface ShelfViewOptions {
  /** `isRolePrivileged` of the viewer — the gate of the `gm` mark (REQ-CPD-022). */
  readonly viewerIsPrivileged: boolean;
  /** Document types currently collapsed (REQ-CPD-023). */
  readonly collapsed: ReadonlySet<string>;
}

/**
 * Build the shelf: the visible packs, grouped by document type.
 *
 * Grouping and ordering are `groupPacksByType`'s — one place decides how the
 * collection is laid out, whether the caller is the shelf or anything else.
 */
export function buildShelfGroups(
  packs: readonly PackManifest[],
  options: ShelfViewOptions,
): ShelfGroup[] {
  return groupPacksByType([...packs]).map((group) => ({
    documentType: group.documentType,
    labelKey: documentTypeLabelKey(group.documentType),
    packCount: group.packs.length,
    collapsed: options.collapsed.has(group.documentType),
    packs: group.packs.map((pack) => buildShelfPackRow(pack, options.viewerIsPrivileged)),
  }));
}

function buildShelfPackRow(pack: PackManifest, viewerIsPrivileged: boolean): ShelfPackRow {
  return {
    id: pack.id,
    label: pack.label,
    documentCount: pack.documentCount,
    license: pack.license.license,
    licenseDetail: licenseDetail(pack),
    gmOnly: viewerIsPrivileged && pack.audience === "gm",
  };
}

/** Attribution + reserved-material notice, joined; empty when the pack has neither. */
function licenseDetail(pack: PackManifest): string {
  return [pack.license.attribution, pack.license.reservedNotice]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" — ");
}

// ---------------------------------------------------------------------------
// Collapsed groups — on the device, per world and per user (REQ-CPD-023)
// ---------------------------------------------------------------------------

/**
 * Spec 43 §7: collapsed groups are a local ergonomic preference (DEC-UIF-10),
 * kept per world and per user. Unlike the scope and the search text — which are
 * session-scoped and belong to G096 — this one survives closing the browser:
 * a shelf the user tidied should still be tidy tomorrow.
 */
const COLLAPSE_STORAGE_PREFIX = "fusion:compendiumShelfCollapsed";

/** The one place the key is composed, so no caller invents a second scheme. */
export function shelfCollapseStorageKey(worldId: string, userId: string): string {
  return `${COLLAPSE_STORAGE_PREFIX}:${worldId}:${userId}`;
}

/**
 * Read the collapsed document types back. Anything unreadable — no storage, bad
 * JSON, a shape from an older build — means "nothing is collapsed": an open
 * shelf is always a correct shelf, and losing a preference must never cost the
 * user the body itself.
 */
export function loadCollapsedGroups(worldId: string, userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(shelfCollapseStorageKey(worldId, userId));
    if (raw === null) return new Set<string>();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    /* localStorage unavailable (tests, private mode) or corrupt value. */
    return new Set<string>();
  }
}

/** Persist the collapsed document types for this world and user. */
export function saveCollapsedGroups(
  worldId: string,
  userId: string,
  collapsed: ReadonlySet<string>,
): void {
  try {
    localStorage.setItem(shelfCollapseStorageKey(worldId, userId), JSON.stringify([...collapsed]));
  } catch {
    /* ignore — a preference that cannot be written is not an error to report. */
  }
}

/** Collapse or expand one group, returning a new set (the old one is untouched). */
export function toggleCollapsedGroup(
  collapsed: ReadonlySet<string>,
  documentType: string,
): Set<string> {
  const next = new Set(collapsed);
  if (!next.delete(documentType)) next.add(documentType);
  return next;
}
