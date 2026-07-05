/**
 * actionsVM.ts — view-model for the PF2e sheet's Actions tab (Pathbuilder-style
 * action browser).
 *
 * RESPONSIBILITIES
 *   - Load the `pf2e.actions-core` compendium pack through the SAME typed
 *     compendium socket API the pickers use (listPacks/searchPack), resolving
 *     the LIVE socket on demand via getSocket() — never a frozen prop (r10
 *     frozen-socket lesson: componentProps are captured once at window-open
 *     time and outlive socket reconnects, so a prop-held Socket goes stale and
 *     its emits are buffered forever → endless spinner). loadActions() exposes
 *     explicit loading / not-connected / load-error states with retry.
 *   - Merge in the actions GRANTED BY the actor's embedded items: any embedded
 *     feat / classFeature / action whose own system.actionType is one of
 *     {action, reaction, free} is itself a usable action and is surfaced in the
 *     list, flagged fromCharacter ("do personagem"). Dedupe is by slug: an
 *     embedded (character) action WINS over the same-slug pack action.
 *   - Provide pure, testable filter/sort helpers (group toggles, action-cost,
 *     accent/case-insensitive name search, alphabetical sort with character
 *     actions floated to the top).
 *
 * SHAPE ROBUSTNESS
 *   The importer transforms `action`-type docs through normalizeFeatSystem
 *   (transform.mjs), which FLATTENS the vendor's nested wrappers:
 *     vendor  system.actionType = { value: "reaction" }  ->  "reaction"
 *     vendor  system.actions    = { value: 2 }           ->  2
 *   Embedded actor items imported at other times, or the raw pack index built
 *   from indexFields, may still carry either shape. Every reader here therefore
 *   accepts BOTH the flattened scalar and the {value} wrapper.
 *
 *   The display GROUP (Class/Skills/Gear/Basic/…) derives from the vendor
 *   FOLDER axis, which the importer's normalize step strips (the Foundry
 *   `folder` field is removed) but re-injects as `system.fusionCategory`.
 *   resolveActionGroup() resolves it from, in order: system.fusionCategory,
 *   then legacy/alternate re-injection sites (flags.fusion.actionFolder /
 *   system.actionFolder), then the mechanical system.category axis, then
 *   "other". When the pack ships without any folder field every row lands in
 *   a coarse but non-empty group rather than breaking.
 */

import type { Socket } from "socket.io-client";
import type { PackIndexEntry } from "@fusion/shared";
import { normalizeSearchText } from "@fusion/shared";
import {
  listPacks,
  searchPack,
  requireConnectedSocket,
  SocketUnavailableError,
} from "../../compendium/compendiumApi.js";
import {
  type ActionGroup,
  ACTION_GROUPS,
  ACTION_GROUP_ORDER,
  groupFromFolder,
  groupFromMechanicalCategory,
} from "./actionCategories.js";

export const ACTIONS_PACK_SLUG = "actions-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The five action-cost kinds shown as glyphs, plus "passive"/"unknown". */
export type ActionCostKind = "1" | "2" | "3" | "reaction" | "free" | "passive" | "unknown";

/** Cost filter values selectable in the UI (passive/unknown are never filters). */
export type ActionCostFilter = "1" | "2" | "3" | "reaction" | "free";

export interface ActionCost {
  kind: ActionCostKind;
  /** Glyph string for display: ◆ / ◆◆ / ◆◆◆ / ⟳ / ◇, empty for passive/unknown. */
  glyphs: string;
}

export interface ActionRow {
  /** Compendium UUID (pack rows) or "embedded:<itemId>" (character rows). */
  key: string;
  /** Compendium UUID when loadable in the details panel, else null. */
  uuid: string | null;
  /** Canonical dedupe slug (system.slug if present, else derived from name). */
  slug: string;
  name: string;
  group: ActionGroup;
  cost: ActionCost;
  traits: string[];
  /** True when this action comes from an embedded actor item ("do personagem"). */
  fromCharacter: boolean;
}

export interface ActionFilterState {
  /** Enabled display groups. A row shows when its group is enabled. */
  groups: Set<ActionGroup>;
  /** Enabled cost filters; empty set = no cost filter (show all). */
  costs: Set<ActionCostFilter>;
  /** Free-text name query (accent/case-insensitive). */
  search: string;
}

// ---------------------------------------------------------------------------
// Glyph mapping
// ---------------------------------------------------------------------------

const COST_GLYPHS: Record<ActionCostKind, string> = {
  "1": "◆",
  "2": "◆◆",
  "3": "◆◆◆",
  reaction: "⟳",
  free: "◇",
  passive: "",
  unknown: "",
};

function cost(kind: ActionCostKind): ActionCost {
  return { kind, glyphs: COST_GLYPHS[kind] };
}

// ---------------------------------------------------------------------------
// Shape-robust field readers
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Unwrap a possibly-{value} vendor wrapper to its scalar. */
function unwrap(v: unknown): unknown {
  if (isRecord(v) && "value" in v) return v["value"];
  return v;
}

function str(v: unknown): string | null {
  const u = unwrap(v);
  return typeof u === "string" && u.trim() ? u.trim() : null;
}

/**
 * Resolve the action cost from a system-like record, accepting both the
 * flattened scalar shape and the vendor {value} wrapper for actionType/actions.
 */
export function resolveActionCost(system: Record<string, unknown>): ActionCost {
  const type = str(system["actionType"]);
  if (type === "reaction") return cost("reaction");
  if (type === "free") return cost("free");
  if (type === "passive") return cost("passive");

  const n = unwrap(system["actions"]);
  if (typeof n === "number" && n >= 1 && n <= 3) {
    return cost(String(n) as ActionCostKind);
  }
  // actionType "action" but no numeric count, or missing everything.
  if (type === "action") return cost("unknown");
  return cost("unknown");
}

/**
 * Resolve the display group for a doc/system record, trying the folder axis
 * (re-injected fields), then the mechanical category axis, then "other".
 */
export function resolveActionGroup(doc: Record<string, unknown>): ActionGroup {
  const system = isRecord(doc["system"]) ? (doc["system"] as Record<string, unknown>) : {};
  const flags = isRecord(doc["flags"]) ? (doc["flags"] as Record<string, unknown>) : {};
  const fusionFlags = isRecord(flags["fusion"]) ? (flags["fusion"] as Record<string, unknown>) : {};

  // Folder axis — several plausible re-injection sites the importer might use.
  // system.fusionCategory is the actual field the importer (agent A) writes.
  const folderCandidates = [
    system["fusionCategory"],
    fusionFlags["actionFolder"],
    fusionFlags["actionCategory"],
    system["actionFolder"],
    system["folderCategory"],
  ];
  for (const cand of folderCandidates) {
    const g = groupFromFolder(str(cand));
    if (g) return g;
  }

  // Mechanical axis (system.category = offensive/interaction/defensive/precision).
  const mech = groupFromMechanicalCategory(str(system["category"]));
  if (mech) return mech;

  return "other";
}

function traitsOf(system: Record<string, unknown>): string[] {
  const traits = system["traits"];
  if (!isRecord(traits)) return [];
  const value = traits["value"];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** Kebab-case slug derived from a name (accent-insensitive), for dedupe. */
export function slugFromName(name: string): string {
  return normalizeSearchText(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugOf(doc: Record<string, unknown>, system: Record<string, unknown>): string {
  const explicit = str(system["slug"]) ?? str(doc["slug"]);
  if (explicit) return explicit;
  const name = str(doc["name"]);
  return name ? slugFromName(name) : "";
}

// ---------------------------------------------------------------------------
// Row construction
// ---------------------------------------------------------------------------

/** Vendor/actor item types that can BE an action when their actionType qualifies. */
const ACTION_BEARING_TYPES = new Set(["action", "feat", "classFeature", "ability"]);
const GRANTED_ACTION_TYPES = new Set(["action", "reaction", "free"]);

/**
 * Build a row from a pack index entry. The pack index only carries the fields
 * declared in the manifest's indexFields, so cost/group are best-effort here
 * (the details panel fetches the full doc on click). We read both the
 * flattened and {value} shapes from the index keys.
 */
export function rowFromIndexEntry(entry: PackIndexEntry): ActionRow {
  // Reconstruct a system-like record from the flat index map so the shared
  // readers work uniformly. Index keys are dot-paths (e.g. "system.category").
  const idx = entry.index ?? {};
  const system: Record<string, unknown> = {
    actionType: idx["system.actionType.value"] ?? idx["system.actionType"],
    actions: idx["system.actions.value"] ?? idx["system.actions"],
    category: idx["system.category"],
    traits: { value: idx["system.traits.value"] ?? [] },
    fusionCategory: idx["system.fusionCategory"],
    actionFolder: idx["system.actionFolder"] ?? idx["flags.fusion.actionFolder"],
  };
  const docLike: Record<string, unknown> = { name: entry.name, system, flags: {} };

  return {
    key: entry.uuid,
    uuid: entry.uuid,
    slug: slugFromName(entry.name),
    name: entry.name,
    group: resolveActionGroup(docLike),
    cost: resolveActionCost(system),
    traits: traitsOf(system),
    fromCharacter: false,
  };
}

/**
 * Build a row from an embedded actor item, IF it qualifies as an action
 * (type is action-bearing AND its actionType is action/reaction/free).
 * Returns null for non-action embedded items (passive feats, gear, etc.).
 */
export function rowFromEmbeddedItem(item: Record<string, unknown>): ActionRow | null {
  const type = str(item["type"]);
  if (!type || !ACTION_BEARING_TYPES.has(type)) return null;

  const system = isRecord(item["system"]) ? (item["system"] as Record<string, unknown>) : {};
  const actionType = str(system["actionType"]);
  if (!actionType || !GRANTED_ACTION_TYPES.has(actionType)) return null;

  const name = str(item["name"]) ?? "Action";
  const itemId = str(item["_id"]) ?? slugFromName(name);

  return {
    key: `embedded:${itemId}`,
    uuid: null,
    slug: slugOf(item, system),
    name,
    group: resolveActionGroup(item),
    cost: resolveActionCost(system),
    traits: traitsOf(system),
    fromCharacter: true,
  };
}

/**
 * Merge pack rows with the actor's embedded action rows, deduped by slug:
 * an embedded (character) row WINS over a same-slug pack row. Rows without a
 * slug are never deduped against each other (kept as-is).
 */
export function mergeActionRows(
  packEntries: PackIndexEntry[],
  embeddedItems: Array<Record<string, unknown>>,
): ActionRow[] {
  const bySlug = new Map<string, ActionRow>();
  const noSlug: ActionRow[] = [];

  // Pack rows first (lower priority).
  for (const entry of packEntries) {
    const row = rowFromIndexEntry(entry);
    if (row.slug) bySlug.set(row.slug, row);
    else noSlug.push(row);
  }

  // Embedded (character) rows override same-slug pack rows.
  for (const item of embeddedItems) {
    const row = rowFromEmbeddedItem(item);
    if (!row) continue;
    if (row.slug) bySlug.set(row.slug, row);
    else noSlug.push(row);
  }

  return [...bySlug.values(), ...noSlug];
}

// ---------------------------------------------------------------------------
// Filtering + sorting
// ---------------------------------------------------------------------------

/** A filter state with every group enabled and no cost filter — the default. */
export function defaultFilterState(): ActionFilterState {
  return { groups: new Set(ACTION_GROUPS), costs: new Set(), search: "" };
}

export function filterActionRows(rows: ActionRow[], filter: ActionFilterState): ActionRow[] {
  const searchNorm = filter.search.trim() ? normalizeSearchText(filter.search.trim()) : null;

  return rows.filter((row) => {
    if (!filter.groups.has(row.group)) return false;

    if (filter.costs.size > 0) {
      // Only rows with a known, filterable cost kind can match a cost filter.
      if (row.cost.kind === "passive" || row.cost.kind === "unknown") return false;
      if (!filter.costs.has(row.cost.kind as ActionCostFilter)) return false;
    }

    if (searchNorm && !normalizeSearchText(row.name).includes(searchNorm)) return false;

    return true;
  });
}

/**
 * Sort rows: character actions first (task default), then alphabetically by
 * name (accent-insensitive).
 */
export function sortActionRows(rows: ActionRow[]): ActionRow[] {
  return [...rows].sort((a, b) => {
    if (a.fromCharacter !== b.fromCharacter) return a.fromCharacter ? -1 : 1;
    return normalizeSearchText(a.name).localeCompare(normalizeSearchText(b.name));
  });
}

/** The group order for rendering the filter grid. */
export const GROUP_ORDER = ACTION_GROUP_ORDER;

// ---------------------------------------------------------------------------
// Loader VM (socket-backed, on-demand)
// ---------------------------------------------------------------------------

export type ActionsLoadError = "not-connected" | "load" | null;

/**
 * Load the pf2e.actions-core pack entries via the compendium socket API.
 * Resolves the live socket on demand (never frozen). Throws Socket
 * UnavailableError when disconnected so the caller can show the specific
 * not-connected state.
 *
 * @param getSocketFn a getter for the current live socket (session.getSocket).
 * @param systemId    active system id (defaults to "pf2e").
 */
export async function loadActionEntries(
  getSocketFn: () => Socket | null | undefined,
  systemId = "pf2e",
): Promise<PackIndexEntry[]> {
  const sock = requireConnectedSocket(getSocketFn());
  const { packs } = await listPacks(sock, { systemId, documentType: "Item" });
  const pack =
    packs.find((p) => p.id === `${systemId}.${ACTIONS_PACK_SLUG}`) ??
    packs.find((p) => p.id.endsWith(`.${ACTIONS_PACK_SLUG}`));
  if (!pack) return [];
  const { entries } = await searchPack(sock, { packId: pack.id });
  return entries;
}

/** Discriminate the not-connected error kind from any other load failure. */
export function classifyLoadError(err: unknown): Exclude<ActionsLoadError, null> {
  return err instanceof SocketUnavailableError ? "not-connected" : "load";
}
