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
  /**
   * Compendium UUID of the same-slug pack doc this row deduped, if any. Only
   * set on embedded (character) rows that overrode a pack row during merge: it
   * lets the details panel heal an empty embedded description on read by
   * fetching the pack doc's description (embedded items imported before the r11
   * ORC/OGL-preservation policy carry an empty system.description). null for
   * pack rows and for embedded rows with no pack counterpart.
   */
  fallbackUuid: string | null;
  /** Canonical dedupe slug (system.slug if present, else derived from name). */
  slug: string;
  name: string;
  group: ActionGroup;
  cost: ActionCost;
  traits: string[];
  /**
   * Raw vendor folder category (system.fusionCategory) — the FINE-grained axis
   * the relevance filter keys on: class / archetype / ancestry / heritage /
   * background / familiar / spells / stamina / mythic / basic / skill /
   * exploration / downtime / equipment. null when the source carried no folder
   * field. Distinct from `group`, which collapses several of these (heritage →
   * ancestry; familiar/spells/stamina/mythic → other) for the display grid.
   */
  fusionCategory: string | null;
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

/**
 * Read the raw vendor folder category (system.fusionCategory), the fine-grained
 * axis the relevance filter keys on. Accepts the same alternate re-injection
 * sites resolveActionGroup() reads (flags.fusion.actionFolder / actionCategory,
 * system.actionFolder), lower-cased and trimmed. Returns null when absent.
 */
export function fusionCategoryOf(doc: Record<string, unknown>): string | null {
  const system = isRecord(doc["system"]) ? (doc["system"] as Record<string, unknown>) : {};
  const flags = isRecord(doc["flags"]) ? (doc["flags"] as Record<string, unknown>) : {};
  const fusionFlags = isRecord(flags["fusion"]) ? (flags["fusion"] as Record<string, unknown>) : {};
  const raw =
    str(system["fusionCategory"]) ??
    str(fusionFlags["actionFolder"]) ??
    str(fusionFlags["actionCategory"]) ??
    str(system["actionFolder"]);
  return raw ? raw.toLowerCase() : null;
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
    fallbackUuid: null,
    slug: slugFromName(entry.name),
    name: entry.name,
    group: resolveActionGroup(docLike),
    cost: resolveActionCost(system),
    traits: traitsOf(system),
    fusionCategory: fusionCategoryOf(docLike),
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
    fallbackUuid: null,
    slug: slugOf(item, system),
    name,
    group: resolveActionGroup(item),
    cost: resolveActionCost(system),
    traits: traitsOf(system),
    fusionCategory: fusionCategoryOf(item),
    fromCharacter: true,
  };
}

/**
 * Merge pack rows with the actor's embedded action rows, deduped by slug:
 * an embedded (character) row WINS over a same-slug pack row. Rows without a
 * slug are never deduped against each other (kept as-is).
 *
 * When an embedded row overrides a same-slug pack row, the overridden pack
 * row's compendium uuid is preserved on the embedded row as `fallbackUuid`,
 * so the details panel can heal an empty embedded description on read by
 * fetching the pack doc (r11 ORC/OGL descriptions live in the pack, not on
 * items embedded before that policy). Embedded rows with no pack counterpart
 * keep `fallbackUuid: null`.
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

  // Embedded (character) rows override same-slug pack rows, inheriting the
  // overridden pack row's uuid as their description fallback.
  for (const item of embeddedItems) {
    const row = rowFromEmbeddedItem(item);
    if (!row) continue;
    if (row.slug) {
      const packRow = bySlug.get(row.slug);
      if (packRow?.uuid) row.fallbackUuid = packRow.uuid;
      bySlug.set(row.slug, row);
    } else {
      noSlug.push(row);
    }
  }

  return [...bySlug.values(), ...noSlug];
}

/**
 * Normalize a possibly-{value}-wrapped rich-text field to a plain HTML string.
 * Embedded actor items carry system.description as either a flattened string
 * (post-transform shape) or the vendor `{ value: "<p>…</p>" }` wrapper. The
 * details panel's sanitizeDescriptionHtml() expects a string, so unwrap first.
 */
export function descriptionHtmlOf(system: Record<string, unknown>): string {
  const desc = unwrap(system["description"]);
  return typeof desc === "string" ? desc : "";
}

/**
 * Build a details-panel `document` from an embedded actor item so the SHARED
 * DocumentDetailsPanel can render it WITHOUT any compendium fetch (character
 * actions have no compendium uuid). The returned doc keeps the item's own
 * type/name/traits and mechanical system fields, but with system.description
 * normalized to a plain HTML string (the panel sanitizes it with the same
 * documentDetails sanitizer used for pack docs). Returns null when the item is
 * not a usable record.
 */
export function buildEmbeddedDetailsDoc(
  item: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!isRecord(item)) return null;
  const system = isRecord(item["system"]) ? { ...(item["system"] as Record<string, unknown>) } : {};
  system["description"] = descriptionHtmlOf(system);
  return {
    name: str(item["name"]) ?? "Action",
    type: str(item["type"]) ?? "action",
    system,
    flags: isRecord(item["flags"]) ? item["flags"] : {},
  };
}

/**
 * Extract a details-panel doc's `system.description` as a plain HTML string
 * (already normalized by buildEmbeddedDetailsDoc). Non-record docs and
 * non-string descriptions read as an empty string.
 */
function detailsDescriptionOf(doc: Record<string, unknown> | null | undefined): string {
  if (!isRecord(doc)) return "";
  const system = doc["system"];
  if (!isRecord(system)) return "";
  const desc = system["description"];
  return typeof desc === "string" ? desc : "";
}

/**
 * Decide whether a details-panel doc has NO usable description — true when the
 * description is missing, empty, or only whitespace/empty markup (e.g. "",
 * "   ", "<p></p>", "<p>&nbsp;</p>"). Embedded items imported before the r11
 * ORC/OGL-preservation policy carry such empty descriptions; when true AND the
 * row has a fallbackUuid, the panel fetches the pack doc's description instead.
 */
export function needsFallbackDescription(doc: Record<string, unknown> | null | undefined): boolean {
  const html = detailsDescriptionOf(doc);
  if (!html) return true;
  // Strip tags and HTML whitespace entities, then trim: bare markup with no
  // text content (e.g. "<p></p>") counts as empty.
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
  return text.length === 0;
}

/**
 * Return a copy of an embedded details doc with the compendium (pack) doc's
 * description spliced in, keeping the embedded item's own identity — name,
 * type, traits and mechanical system fields — so the panel still reads as the
 * character's action ("Do personagem" badge lives on the row, not here). Used
 * only when the embedded description is empty and a fallbackUuid resolved a
 * pack doc. Falls back to the embedded doc unchanged if either input is unusable
 * or the pack doc has no string description.
 */
export function withFallbackDescription(
  embeddedDoc: Record<string, unknown> | null,
  packDoc: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!isRecord(embeddedDoc)) return embeddedDoc;
  const packDescription = descriptionHtmlOf(
    isRecord(packDoc) && isRecord(packDoc["system"])
      ? (packDoc["system"] as Record<string, unknown>)
      : {},
  );
  if (!packDescription) return embeddedDoc;
  const system = isRecord(embeddedDoc["system"])
    ? { ...(embeddedDoc["system"] as Record<string, unknown>) }
    : {};
  system["description"] = packDescription;
  return { ...embeddedDoc, system };
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/** Client-side page size for the rendered action list (the pack has 500+). */
export const ACTIONS_PAGE_SIZE = 60;

export interface PaginationResult<T> {
  /** The slice to render (rows 0..visibleCount). */
  visible: T[];
  /** Whether a "show more" affordance should be shown. */
  hasMore: boolean;
  /** How many rows remain beyond the visible slice (for the button count). */
  remaining: number;
}

/**
 * Pure pagination helper: clamp `visibleCount` to [0, rows.length] and derive
 * the visible slice + whether more remain. Kept pure and separate from the
 * component so the "show more" arithmetic is unit-testable.
 */
export function paginate<T>(rows: T[], visibleCount: number): PaginationResult<T> {
  const clamped = Math.max(0, Math.min(visibleCount, rows.length));
  return {
    visible: rows.slice(0, clamped),
    hasMore: clamped < rows.length,
    remaining: rows.length - clamped,
  };
}

// ---------------------------------------------------------------------------
// Character relevance filter (default ON) + "show all" toggle
// ---------------------------------------------------------------------------

/**
 * The fine-grained fusionCategory values that are UNIVERSAL — every character
 * can take them regardless of class/ancestry/archetype — so they are always
 * relevant. Skill/basic/exploration/downtime actions and gear-use actions apply
 * to anyone.
 */
const UNIVERSAL_CATEGORIES = new Set(["basic", "skill", "exploration", "downtime", "equipment"]);

/**
 * Fine-grained categories HIDDEN by default (surface only via the "Mostrar
 * todas" toggle, or when a row also matches an embedded actor item →
 * fromCharacter): narrow subsystems (familiar / spells / stamina / mythic) or
 * ones the browser can't match confidently (background). Kept as documentation
 * of the intended set; the relevance switch's `default` branch enforces it (any
 * category not universal/class/ancestry/heritage/archetype is hidden).
 */

/**
 * A character's identity slugs, derived from embedded items, used to decide
 * which class/ancestry/archetype actions are relevant. All slugs are lower-cased.
 */
export interface CharacterActionProfile {
  /** Class slugs (e.g. "magus") from embedded type:"class" items. */
  classSlugs: Set<string>;
  /** Ancestry + heritage slugs (e.g. "ratfolk") from embedded type:"ancestry"/"heritage". */
  ancestrySlugs: Set<string>;
  /** Archetype slugs (e.g. "alchemist") from embedded dedication feats. */
  archetypeSlugs: Set<string>;
}

/** Lower-cased, trimmed slug from an item name, or null. */
function nameSlug(item: Record<string, unknown>): string | null {
  const name = str(item["name"]);
  return name ? name.toLowerCase() : null;
}

/**
 * Derive the archetype slug a dedication feat grants. Dedication feats carry the
 * "dedication" trait but NOT the archetype's own slug as a trait (Alchemist
 * Dedication traits are ["archetype","dedication","multiclass"]), so the slug is
 * read from the feat NAME by stripping a trailing " dedication"
 * ("Alchemist Dedication" → "alchemist"). Returns null when the item is not a
 * dedication feat.
 */
function archetypeSlugFromDedication(item: Record<string, unknown>): string | null {
  if (str(item["type"]) !== "feat") return null;
  const system = isRecord(item["system"]) ? (item["system"] as Record<string, unknown>) : {};
  const traits = traitsOf(system);
  if (!traits.includes("dedication")) return null;
  const name = str(item["name"]);
  if (!name) return null;
  const slug = name.toLowerCase().replace(/\s+dedication$/, "").trim();
  return slug || null;
}

/**
 * Build the character's relevance profile from the actor doc's embedded items:
 * class slugs (type:"class"), ancestry/heritage slugs (type:"ancestry" /
 * "heritage"), and archetype slugs (dedication feats). Pure — reads only the
 * item name/type/traits.
 */
export function deriveCharacterProfile(
  embeddedItems: Array<Record<string, unknown>>,
): CharacterActionProfile {
  const classSlugs = new Set<string>();
  const ancestrySlugs = new Set<string>();
  const archetypeSlugs = new Set<string>();

  for (const item of embeddedItems) {
    if (!isRecord(item)) continue;
    const type = str(item["type"]);
    if (type === "class") {
      const s = nameSlug(item);
      if (s) classSlugs.add(s);
    } else if (type === "ancestry" || type === "heritage") {
      const s = nameSlug(item);
      if (s) ancestrySlugs.add(s);
    }
    const arch = archetypeSlugFromDedication(item);
    if (arch) archetypeSlugs.add(arch);
  }

  return { classSlugs, ancestrySlugs, archetypeSlugs };
}

/** True when any of the row's traits is in `slugs`. */
function traitsMatchAny(row: ActionRow, slugs: Set<string>): boolean {
  if (slugs.size === 0) return false;
  return row.traits.some((t) => slugs.has(t.toLowerCase()));
}

/**
 * Decide whether an action row is relevant to the character (the default
 * filter). Policy — err toward hiding when no confident match:
 *   - embedded actor actions (fromCharacter) → always relevant.
 *   - universal categories (basic/skill/exploration/downtime/equipment) → always.
 *   - class → only if a trait matches one of the character's class slugs.
 *   - ancestry / heritage → only if a trait matches an ancestry/heritage slug.
 *   - archetype → only if a trait matches one of the character's archetype slugs.
 *   - default-hidden categories (background/familiar/spells/stamina/mythic) and
 *     anything with no/unknown category → not relevant.
 */
export function isActionRelevant(row: ActionRow, profile: CharacterActionProfile): boolean {
  if (row.fromCharacter) return true;

  const category = row.fusionCategory;
  if (category && UNIVERSAL_CATEGORIES.has(category)) return true;

  switch (category) {
    case "class":
      return traitsMatchAny(row, profile.classSlugs);
    case "ancestry":
    case "heritage":
      return traitsMatchAny(row, profile.ancestrySlugs);
    case "archetype":
      return traitsMatchAny(row, profile.archetypeSlugs);
    default:
      // background / familiar / spells / stamina / mythic (DEFAULT_HIDDEN) plus
      // any unknown/null category: hidden until "show all" (err toward hiding).
      return false;
  }
}

/**
 * Apply the character-relevance pre-filter. When `showAll` is true the rows are
 * returned unchanged (the "Mostrar todas" toggle). Otherwise only rows passing
 * {@link isActionRelevant} survive. Runs BEFORE group/cost/search filtering so
 * any group counts derived from the result reflect the relevance filter.
 */
export function filterRelevantRows(
  rows: ActionRow[],
  profile: CharacterActionProfile,
  showAll: boolean,
): ActionRow[] {
  if (showAll) return rows;
  return rows.filter((row) => isActionRelevant(row, profile));
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
