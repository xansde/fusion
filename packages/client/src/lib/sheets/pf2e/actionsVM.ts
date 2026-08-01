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
import type { PackIndexEntry, AbilityCard, ChatSendFlags } from "@fusion/shared";
import { normalizeSearchText } from "@fusion/shared";
import type { SupportedLocale } from "../../i18n/i18n.js";
import { localizedNameParts, pickLocalizedDescription } from "../../compendium/documentDetails.js";
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

/**
 * Supplementary packs whose entries enrich embedded action rows with pt-BR
 * names + description-fallback uuids (B1 r14 #4/#5). Character feats that ARE
 * actions live here, not in actions-core — without loading them, Magus's
 * Analysis / Bon Mot show raw EN name + description in the Actions tab.
 */
export const ACTION_NAME_INDEX_PACK_SLUGS = ["feats-core"];

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
  /**
   * EN name — the source-of-truth name, used for the dedupe slug, sorting and
   * as the secondary/subtitle line beside a pt-BR translation. Always present.
   */
  name: string;
  /**
   * The English name, mirrored for bilingual display (identical to {@link name}).
   * Kept as a distinct field so the display helper can decide subtitle vs. main
   * line via the SHARED localizedNameParts logic without re-reading `name`.
   */
  nameEn: string;
  /**
   * pt-BR name when the server attached a translation (pack rows carry
   * `entry.namePt` / `entry.i18n.ptBR.name`; embedded/character rows inherit it
   * from the same-slug pack row on merge). null when untranslated — the display
   * falls back to the EN name. T1.
   */
  namePt: string | null;
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
  /**
   * True when the row carries the Kineticist `impulse` trait (r19-W3). Impulse
   * rows get a distinct "Impulso" badge in the Actions tab, are always surfaced
   * for their owner even if the embedded item's actionType wasn't preserved, and
   * expose a "Usar" button that announces the impulse in chat.
   */
  isImpulse: boolean;
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

/**
 * True when a trait list carries the Kineticist `impulse` trait (r19-W3).
 * Case-insensitive. Used to flag impulse rows for the "Impulso" badge and the
 * always-surface / "Usar" affordances.
 */
export function hasImpulseTrait(traits: readonly string[]): boolean {
  return traits.some((tr) => tr.toLowerCase() === "impulse");
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
  const traits = traitsOf(system);

  return {
    key: entry.uuid,
    uuid: entry.uuid,
    fallbackUuid: null,
    slug: slugFromName(entry.name),
    name: entry.name,
    nameEn: entry.name,
    namePt: entryNamePt(entry),
    group: resolveActionGroup(docLike),
    cost: resolveActionCost(system),
    traits,
    fusionCategory: fusionCategoryOf(docLike),
    fromCharacter: false,
    isImpulse: hasImpulseTrait(traits),
  };
}

/**
 * Read the server-attached pt-BR name off a pack index entry (T1). Prefers the
 * denormalized flat `namePt`, then the nested `i18n.ptBR.name`. null when the
 * entry has no translation overlay. Mirrors how the pickers read bilingual
 * names, keeping the EN `name` as the source-of-truth fallback.
 */
function entryNamePt(entry: PackIndexEntry): string | null {
  const flat = entry.namePt;
  if (typeof flat === "string" && flat.trim()) return flat.trim();
  const nested = entry.i18n?.ptBR?.name;
  return typeof nested === "string" && nested.trim() ? nested.trim() : null;
}

/**
 * Resolve the bilingual display parts (main line + optional EN subtitle) for an
 * action row given the active locale, REUSING the shared {@link localizedNameParts}
 * decision the pickers use — so the Actions tab renders identically: pt-BR name
 * on top with the EN name as a secondary line/tooltip when translated, and just
 * the EN name (no redundant subtitle) when untranslated or on the "en" locale.
 */
export function actionRowNameParts(
  row: ActionRow,
  locale: SupportedLocale,
): { display: string; subtitleEn: string | null } {
  return localizedNameParts(
    row.namePt !== null
      ? { name: row.nameEn, i18n: { ptBR: { name: row.namePt } } }
      : { name: row.nameEn },
    locale,
  );
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
  const traits = traitsOf(system);
  const impulse = hasImpulseTrait(traits);
  const actionType = str(system["actionType"]);
  // A Kineticist impulse is always an activity: surface it even when the
  // embedded item's actionType wasn't preserved/recognized (r19-W3), so a
  // Kineticist's impulses (Four Winds, Shard Strike, …) never silently vanish
  // from the Actions tab. Other embedded items must still declare an
  // action/reaction/free cost to appear (unchanged behavior).
  if (!impulse && (!actionType || !GRANTED_ACTION_TYPES.has(actionType))) return null;

  const name = str(item["name"]) ?? "Action";
  const itemId = str(item["_id"]) ?? slugFromName(name);

  return {
    key: `embedded:${itemId}`,
    uuid: null,
    fallbackUuid: null,
    slug: slugOf(item, system),
    name,
    nameEn: name,
    // Embedded actor items are EN of birth; a pt-BR name is inherited from the
    // deduped same-slug pack row during merge (see mergeActionRows) when one
    // exists — otherwise the row stays EN.
    namePt: null,
    group: resolveActionGroup(item),
    cost: resolveActionCost(system),
    traits,
    fusionCategory: fusionCategoryOf(item),
    fromCharacter: true,
    isImpulse: impulse,
  };
}

/**
 * A minimal enrichment record for an embedded action whose translation +
 * description live in a pack the Actions tab does NOT list as rows (feats-core).
 * Keyed by name-slug (`slugFromName`). B1 r14 #4/#5: character feats that ARE
 * actions (Magus's Analysis, Bon Mot) live in `feats-core`, not `actions-core`,
 * so there is no same-slug actions-core row to inherit `namePt`/`fallbackUuid`
 * from — the panel then falls back to the embedded item's EN description.
 */
export interface ActionNameEnrichment {
  namePt: string | null;
  fallbackUuid: string | null;
}

/**
 * Build a slug→enrichment index from supplementary pack entries (feats-core),
 * so `mergeActionRows` can resolve an embedded action's pt-BR name and
 * description-fallback uuid WITHOUT turning every feat into an action row. Join
 * key is the name-slug (`slugFromName`), matching how embedded rows derive
 * their own slug (system.slug is undefined everywhere — see B1 investigation).
 * First entry per slug wins (deterministic given a stable index order).
 */
export function buildActionNameIndex(
  supplementalEntries: PackIndexEntry[],
): Map<string, ActionNameEnrichment> {
  const index = new Map<string, ActionNameEnrichment>();
  for (const entry of supplementalEntries) {
    const slug = slugFromName(entry.name);
    if (!slug || index.has(slug)) continue;
    index.set(slug, { namePt: entryNamePt(entry), fallbackUuid: entry.uuid });
  }
  return index;
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
 *
 * `nameIndex` (B1 r14 #4/#5) enriches embedded rows whose slug matched NO
 * actions-core pack row with a `namePt`/`fallbackUuid` resolved from a
 * supplementary index (feats-core) — so character feats that are actions
 * (Magus's Analysis, Bon Mot) show their pt-BR name AND their ORC/OGL
 * description (fetched via fallbackUuid) instead of raw EN. The actions-core
 * pack row (if any) still takes precedence for both fields.
 */
export function mergeActionRows(
  packEntries: PackIndexEntry[],
  embeddedItems: Array<Record<string, unknown>>,
  nameIndex?: Map<string, ActionNameEnrichment>,
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
  // overridden pack row's uuid as their description fallback AND its pt-BR name
  // so the character row displays the translated name (embedded items are EN of
  // birth; the pack row behind fallbackUuid carries the translation). T1.
  for (const item of embeddedItems) {
    const row = rowFromEmbeddedItem(item);
    if (!row) continue;
    if (row.slug) {
      const packRow = bySlug.get(row.slug);
      if (packRow?.uuid) row.fallbackUuid = packRow.uuid;
      if (packRow?.namePt) row.namePt = packRow.namePt;
      // Supplementary enrichment (feats-core) — only fills gaps the actions-core
      // pack row didn't provide, so a real same-slug action still wins.
      const enrich = nameIndex?.get(row.slug);
      if (enrich) {
        if (row.fallbackUuid === null && enrich.fallbackUuid)
          row.fallbackUuid = enrich.fallbackUuid;
        if (row.namePt === null && enrich.namePt) row.namePt = enrich.namePt;
      }
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
 * or the pack doc has no usable description.
 *
 * The spliced description is LOCALE-AWARE: when `locale` is "pt-BR" and the pack
 * doc carries `i18n.ptBR.description`, the translated prose is used (via the
 * shared {@link pickLocalizedDescription}); otherwise the EN system.description.
 * So a character action healed from its pack counterpart reads in the active
 * locale, not EN-always. T1.
 */
export function withFallbackDescription(
  embeddedDoc: Record<string, unknown> | null,
  packDoc: Record<string, unknown> | null | undefined,
  locale: SupportedLocale = "pt-BR",
): Record<string, unknown> | null {
  if (!isRecord(embeddedDoc)) return embeddedDoc;
  // Prefer the pt-BR translation (locale-aware), then the vendor {value}-wrapped
  // or flattened EN system.description.
  const localized = isRecord(packDoc) ? pickLocalizedDescription(packDoc, locale) : null;
  const packDescription =
    (typeof localized === "string" && localized.trim() ? localized : null) ??
    descriptionHtmlOf(
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
// Chat announcements — the "Usar" impulse button (r19-W3)
// ---------------------------------------------------------------------------

/**
 * A flat `chat:send` op emitted by the Actions tab (mirrors the spell-cast
 * announcement, spellCastCardVM.SpellCastChatOp, minus any structured card
 * flags — the interactive-card territory belongs to the chat feature, not this
 * tab). Consumed by makeSendOpFn / sendOp, which split `type` from the payload.
 */
export interface ActionChatOp {
  type: "chat:send";
  content: string;
  worldId: string;
  rollMode: "public";
  speakerActorId: string;
  /**
   * Optional namespaced flags (r20-X1): the impulse / blast announcement
   * carries `pf2e.abilityCard` (an interactive AbilityCard); a nested attack
   * carries `parentMessageId`. Absent on a plain (loose) roll.
   */
  flags?: ChatSendFlags;
}

/** A saving-throw cue parsed from an impulse's `@Check[...]` automation token. */
export interface ImpulseSaveCue {
  save: "fortitude" | "reflex" | "will";
  basic: boolean;
}

const SAVE_SLUGS = new Set(["fortitude", "reflex", "will"]);

/**
 * Parse the FIRST `@Check[<save>|…]` token in an impulse's description, returning
 * the save type + whether it is a basic save. Kineticist impulses that call for a
 * save encode it as e.g. `@Check[reflex|against:kineticist|basic|options:area-effect]`.
 * Returns null when the description carries no save `@Check` (attack/utility
 * impulses like Four Winds). Pure/dependency-free so the "Usar" announcement is
 * unit-testable.
 */
export function parseImpulseSaveCue(
  descriptionHtml: string | null | undefined,
): ImpulseSaveCue | null {
  if (!descriptionHtml) return null;
  const re = /@Check\[([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(descriptionHtml)) !== null) {
    const args = m[1];
    if (!args) continue;
    const parts = args.split("|").map((p) => p.trim().toLowerCase());
    const save = parts.find((p) => SAVE_SLUGS.has(p));
    if (save) return { save: save as ImpulseSaveCue["save"], basic: parts.includes("basic") };
  }
  return null;
}

/**
 * Read the actor's derived Kineticist class DC (`system.derived.classDC.dc`) —
 * the DC an impulse's saving throw is rolled against. Returns null when absent
 * (non-kineticist / pre-derived data) so the announcement simply omits the DC.
 */
export function kineticistClassDc(doc: Record<string, unknown>): number | null {
  const system = isRecord(doc["system"]) ? (doc["system"] as Record<string, unknown>) : null;
  const derived =
    system && isRecord(system["derived"]) ? (system["derived"] as Record<string, unknown>) : null;
  const classDC =
    derived && isRecord(derived["classDC"])
      ? (derived["classDC"] as Record<string, unknown>)
      : null;
  const dc = classDC?.["dc"];
  return typeof dc === "number" ? dc : null;
}

/**
 * Assemble the plain-text "Usar" announcement op for an impulse row (r19-W3).
 * content = "<verb> <name> <glyphs> (<traits>)[ — <saveLine>]" — plain text +
 * action glyphs, NO structured card (that territory is the chat feature). The
 * component supplies already-localized fragments (verb, display name, pt-BR trait
 * labels, optional save line) so this stays dependency-free/testable. Returns
 * null without a speaker actor (nothing to attribute the message to).
 */
export function buildImpulseUseAnnouncement(params: {
  verb: string;
  displayName: string;
  glyphs: string;
  traitLabels: readonly string[];
  saveLine?: string | null;
  worldId: string;
  speakerActorId: string;
}): ActionChatOp | null {
  if (!params.speakerActorId) return null;
  let content = `${params.verb} ${params.displayName}`.trim();
  if (params.glyphs) content += ` ${params.glyphs}`;
  if (params.traitLabels.length > 0) content += ` (${params.traitLabels.join(", ")})`;
  if (params.saveLine) content += ` — ${params.saveLine}`;
  return {
    type: "chat:send",
    content,
    worldId: params.worldId,
    rollMode: "public",
    speakerActorId: params.speakerActorId,
  };
}

/** A rollable damage parsed from an impulse's `@Damage[...]` automation token. */
export interface ImpulseDamage {
  /** A clean, server-rollable dice formula (e.g. "2d6", "(1d4+2)"). */
  formula: string;
  /** Damage type slug (e.g. "fire", "bludgeoning"), or null when unstated. */
  damageType: string | null;
}

/**
 * Find the index of the `]` that closes the `[` at `openIdx`, tracking nested
 * `[...]`. Returns -1 if unbalanced. Local mirror of documentDetails' helper so
 * the parser stays dependency-free/testable.
 */
function findMatchingBracket(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Damage-category markers that precede the real damage type inside `[...]`. */
const DAMAGE_MARKERS = new Set(["persistent", "precision", "splash"]);

/**
 * Parse the FIRST `@Damage[...]` token of an impulse's description into a
 * server-ROLLABLE damage (r20-X1). Kineticist impulse damage frequently scales
 * with `@actor.level` / `ternary(...)` / `ceil(...)`, which the chat:send roll
 * path CANNOT resolve (it threads no actor rollData) — so this deliberately
 * returns a formula ONLY when it is "clean": dice/number arithmetic with no
 * `@`-references and no function names. Level-scaled impulses (the common case)
 * yield null → the card simply shows the save with no damage button, which is
 * exactly the intended behavior ("parseado quando existir"). Returns null when
 * the description carries no `@Damage`, or the formula is not cleanly rollable.
 */
export function parseImpulseDamage(
  descriptionHtml: string | null | undefined,
): ImpulseDamage | null {
  if (!descriptionHtml) return null;
  const marker = "@Damage[";
  const start = descriptionHtml.indexOf(marker);
  if (start < 0) return null;
  const openIdx = start + marker.length - 1; // index of the '['
  const closeIdx = findMatchingBracket(descriptionHtml, openIdx);
  if (closeIdx < 0) return null;
  let body = descriptionHtml.slice(openIdx + 1, closeIdx);

  // Drop trailing `|options:...` / `|traits:...` flag segments (a bare `|` never
  // appears inside the formula itself).
  const pipeIdx = body.indexOf("|");
  if (pipeIdx >= 0) body = body.slice(0, pipeIdx);

  // The damage TYPE is the last top-level `[...]`; the formula is what precedes.
  let damageType: string | null = null;
  let formula = body;
  const typeOpen = body.lastIndexOf("[");
  if (typeOpen >= 0) {
    const typeClose = findMatchingBracket(body, typeOpen);
    if (typeClose > typeOpen) {
      const typeBody = body.slice(typeOpen + 1, typeClose);
      formula = body.slice(0, typeOpen);
      const parts = typeBody
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0 && !DAMAGE_MARKERS.has(s));
      damageType = parts[0] ?? null;
    }
  }

  formula = formula.trim();
  // Strip a single wrapping pair of parens for the clean-check ("(1d4+2)" is OK).
  const inner = /^\((.*)\)$/.test(formula) ? formula.slice(1, -1) : formula;
  // Clean = dice/number arithmetic only (d + digits + + - * / ( ) . space). No
  // `@` refs, no function names (ceil/max/floor/ternary carry other letters).
  const clean = /^[0-9dD+\-*/().\s]+$/.test(inner) && /\d/.test(inner) && !inner.includes("@");
  if (!clean) return null;
  return { formula, damageType };
}

/**
 * Assemble the "Usar" announcement op for an impulse as an interactive
 * AbilityCard (r20-X1) — the impulse counterpart of the spell-cast card. The
 * `content` text (for old clients) mirrors {@link buildImpulseUseAnnouncement};
 * the `flags.pf2e.abilityCard` payload carries the save (statistic + class DC +
 * basic) and, when a clean @Damage was parsed, the damage formula/type, so the
 * card renders "Fazer teste de resistência" and/or "Rolar dano" whose rolls
 * nest under the announcement. Returns null without a speaker actor.
 */
export function buildImpulseCard(params: {
  verb: string;
  displayName: string;
  nameEn?: string | null;
  glyphs: string;
  traitLabels: readonly string[];
  traitSlugs: readonly string[];
  saveCue: ImpulseSaveCue | null;
  classDc: number | null;
  saveLine?: string | null;
  damage: ImpulseDamage | null;
  worldId: string;
  speakerActorId: string;
}): ActionChatOp | null {
  if (!params.speakerActorId) return null;

  let content = `${params.verb} ${params.displayName}`.trim();
  if (params.glyphs) content += ` ${params.glyphs}`;
  if (params.traitLabels.length > 0) content += ` (${params.traitLabels.join(", ")})`;
  if (params.saveLine) content += ` — ${params.saveLine}`;

  const card: AbilityCard = {
    kind: "impulse",
    casterActorId: params.speakerActorId,
    name: params.displayName,
  };
  if (params.nameEn && params.nameEn !== params.displayName) card.nameEn = params.nameEn;
  if (params.glyphs) card.actionCost = params.glyphs;
  if (params.saveCue && params.classDc !== null) {
    card.saveType = params.saveCue.save;
    card.dcValue = params.classDc;
    if (params.saveCue.basic) card.basicSave = true;
  }
  if (params.damage) {
    card.damageFormula = params.damage.formula;
    if (params.damage.damageType) card.damageType = params.damage.damageType;
  }
  if (params.traitSlugs.length > 0) card.traits = [...params.traitSlugs];

  return {
    type: "chat:send",
    content,
    worldId: params.worldId,
    rollMode: "public",
    speakerActorId: params.speakerActorId,
    flags: { pf2e: { abilityCard: card } },
  };
}

// ---------------------------------------------------------------------------
// Elemental Blast shortcut rows (r19-W3, item 2)
// ---------------------------------------------------------------------------

/**
 * A Kineticist Elemental Blast surfaced as a shortcut row in the Actions tab.
 * Read straight from the actor's SERVER-DERIVED `system.derived.elementalBlasts`
 * (one per gate element) — the derivation itself lives server-side (r18-N2b), so
 * this only reformats already-computed values. The full attack (MAP variants) +
 * damage rolls live on the Main tab; this row is a discovery shortcut with a
 * single MAP-0 attack button.
 */
export interface BlastRowVM {
  element: string;
  damageType: string;
  /** MAP-0 attack total, for the "+N" display. */
  attackTotal: number;
  /** MAP-0 attack roll formula (server-derived), for the "Rolar ataque" button. */
  attackFormula: string;
  /** Damage roll formula, shown read-only (roll it on the Main tab). */
  damageFormula: string;
  /**
   * Pure server-rollable damage formula (no type text), e.g. "2d6+4" (r20-X1).
   * Feeds the Rajada card's "Rolar dano" button. "" when absent on the derived
   * data (older pre-migration shape) — the card then omits the damage button.
   */
  damageRoll: string;
  /** 2-action variant CON status bonus (kept for the Main-tab loose roll). */
  twoActionDamageBonus: number;
  isRanged: boolean;
  range: number | null;
}

/**
 * Extract the Kineticist Elemental Blast shortcut rows from an actor doc's
 * `system.derived.elementalBlasts`. Returns [] for non-kineticists / pre-derived
 * data. Reads defensively (structural) so a partial derived shape never throws —
 * a blast with no MAP-0 variant simply yields an empty attack formula (the row
 * still shows, its roll button is inert).
 */
export function readElementalBlasts(doc: Record<string, unknown>): BlastRowVM[] {
  const system = isRecord(doc["system"]) ? (doc["system"] as Record<string, unknown>) : null;
  const derived =
    system && isRecord(system["derived"]) ? (system["derived"] as Record<string, unknown>) : null;
  const blasts = derived?.["elementalBlasts"];
  if (!Array.isArray(blasts)) return [];

  const out: BlastRowVM[] = [];
  for (const b of blasts) {
    if (!isRecord(b)) continue;
    const element = str(b["element"]);
    if (!element) continue;
    const variants = Array.isArray(b["variants"]) ? b["variants"] : [];
    const v0 = isRecord(variants[0]) ? (variants[0] as Record<string, unknown>) : {};
    const attackTotal =
      typeof v0["total"] === "number"
        ? (v0["total"] as number)
        : typeof b["attackBonus"] === "number"
          ? (b["attackBonus"] as number)
          : 0;
    out.push({
      element,
      damageType: str(b["damageType"]) ?? "",
      attackTotal,
      attackFormula: str(v0["formula"]) ?? "",
      damageFormula: str(b["damageFormula"]) ?? "",
      damageRoll: str(b["damageRoll"]) ?? "",
      twoActionDamageBonus:
        typeof b["twoActionDamageBonus"] === "number" ? (b["twoActionDamageBonus"] as number) : 0,
      isRanged: b["isRanged"] === true,
      range: typeof b["range"] === "number" ? (b["range"] as number) : null,
    });
  }
  return out;
}

/**
 * Build the MAP-0 attack-roll chat:send op for an Elemental Blast (r19-W3). The
 * formula is the SERVER-DERIVED `variants[0].formula` (whitespace-stripped);
 * this does NOT re-derive anything — the RNG still runs on the server. `flavor`
 * is the localized "Rajada Elemental (Ar) (MAP 0)" line built by the component.
 * Returns null when the formula or speaker is missing.
 */
export function buildElementalBlastAttackOp(params: {
  attackFormula: string;
  flavor: string;
  worldId: string;
  speakerActorId: string;
}): ActionChatOp | null {
  const formula = params.attackFormula.replace(/\s+/g, "");
  if (!formula || !params.speakerActorId) return null;
  return {
    type: "chat:send",
    content: `/r ${formula} # ${params.flavor}`,
    worldId: params.worldId,
    rollMode: "public",
    speakerActorId: params.speakerActorId,
  };
}

/**
 * Build the Elemental Blast as an interactive Rajada card (r20-X1): an
 * announcement carrying `flags.pf2e.abilityCard` (kind:"impulse", damage from
 * the derived `damageRoll`) PLUS the MAP-0 attack roll to nest under it. The
 * caller sends the announcement over a live socket, awaits its id, then fires
 * the attack with `parentMessageId` so attack + (card) damage group into ONE
 * Rajada card. Returns null when the attack formula or speaker is missing.
 */
export function buildElementalBlastCard(params: {
  blast: BlastRowVM;
  cardName: string;
  attackFlavor: string;
  worldId: string;
  speakerActorId: string;
}): { announcement: ActionChatOp; attack: ActionChatOp } | null {
  const attackFormula = params.blast.attackFormula.replace(/\s+/g, "");
  if (!attackFormula || !params.speakerActorId) return null;

  const card: AbilityCard = {
    kind: "impulse",
    casterActorId: params.speakerActorId,
    name: params.cardName,
  };
  if (params.blast.damageRoll) card.damageFormula = params.blast.damageRoll;
  if (params.blast.damageType) card.damageType = params.blast.damageType;

  const announcement: ActionChatOp = {
    type: "chat:send",
    content: params.cardName,
    worldId: params.worldId,
    rollMode: "public",
    speakerActorId: params.speakerActorId,
    flags: { pf2e: { abilityCard: card } },
  };
  const attack: ActionChatOp = {
    type: "chat:send",
    content: `/r ${attackFormula} # ${params.attackFlavor}`,
    worldId: params.worldId,
    rollMode: "public",
    speakerActorId: params.speakerActorId,
  };
  return { announcement, attack };
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
  const slug = name
    .toLowerCase()
    .replace(/\s+dedication$/, "")
    .trim();
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

  // Kineticist impulses are always relevant to a Kineticist (r19-W3). Embedded
  // impulses already pass via `fromCharacter` above; this covers any pack-sourced
  // impulse row so a Kineticist sees their impulses without "Mostrar todas".
  if (row.isImpulse && profile.classSlugs.has("kineticist")) return true;

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

/**
 * Accent/case-insensitive bilingual name match: true when the query is a
 * substring of the EN name OR the pt-BR name (when translated). Lets the user
 * type either language and find the row, mirroring the pickers'
 * `matchesTextSearch`. T1.
 */
function rowMatchesSearch(row: ActionRow, searchNorm: string): boolean {
  if (normalizeSearchText(row.nameEn).includes(searchNorm)) return true;
  if (row.namePt !== null && normalizeSearchText(row.namePt).includes(searchNorm)) return true;
  return false;
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

    if (searchNorm && !rowMatchesSearch(row, searchNorm)) return false;

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

/**
 * Load the supplementary name-index pack entries (feats-core) used to enrich
 * embedded action rows with pt-BR names + description-fallback uuids (B1 r14
 * #4/#5). Best-effort: returns an empty array if a pack is missing. Uses the
 * same live-socket contract as loadActionEntries. Callers should tolerate an
 * empty result (rows just stay EN, exactly as before this enrichment existed).
 */
export async function loadActionNameIndexEntries(
  getSocketFn: () => Socket | null | undefined,
  systemId = "pf2e",
): Promise<PackIndexEntry[]> {
  const sock = requireConnectedSocket(getSocketFn());
  const { packs } = await listPacks(sock, { systemId, documentType: "Item" });
  const out: PackIndexEntry[] = [];
  for (const slug of ACTION_NAME_INDEX_PACK_SLUGS) {
    const pack =
      packs.find((p) => p.id === `${systemId}.${slug}`) ??
      packs.find((p) => p.id.endsWith(`.${slug}`));
    if (!pack) continue;
    const { entries } = await searchPack(sock, { packId: pack.id });
    out.push(...entries);
  }
  return out;
}

/** Discriminate the not-connected error kind from any other load failure. */
export function classifyLoadError(err: unknown): Exclude<ActionsLoadError, null> {
  return err instanceof SocketUnavailableError ? "not-connected" : "load";
}
