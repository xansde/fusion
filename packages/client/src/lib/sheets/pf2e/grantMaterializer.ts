/**
 * grantMaterializer.ts — data-driven materialization of FIXED `GrantItem`
 * rule elements (B2 r14).
 *
 * The r11 builder only materialized a hand-curated table of nested feat
 * CHOICES (GRANTED_FEAT_CHOICES). Fixed grants — a `GrantItem` rule element
 * whose `uuid` points at a specific vendor document
 * (`Compendium.pf2e.<vendor>.Item.<Name>`) — never executed in the builder
 * (gap known since r12). The concrete user case: **Alchemist Dedication**
 * (`feats-core`, sourceId `CJMkxlxHiHZQYDCz`) declares two such grants —
 * `Compendium.pf2e.feats-srd.Item.Alchemical Crafting` (a feat) and
 * `Compendium.pf2e.actionspf2e.Item.Quick Alchemy` (an action) — neither of
 * which appeared on the sheet.
 *
 * This module is PURE and testable: it takes a granter's compendium document
 * (whose `system.rules` carries the fixed grants), the actor's already-
 * embedded items (for idempotency), and two INJECTED async resolvers (an
 * index searcher + a full-document fetcher — supplied by PlanColumn.svelte via
 * the compendium socket API). It returns the `doc:create` ops that materialize
 * every not-yet-present grant, recursing into the granted docs' OWN fixed
 * grants up to a bounded depth (to catch grant chains without cycling).
 *
 * Clean-room: parsing the `GrantItem` shape (Foundry rule-element schema) and
 * the vendor→Fusion pack mapping are structural facts, not copied code. The
 * granted docs themselves are Fusion's clean-room packs.
 *
 * REQ-PF2-010/011 (builder), REQ-CMP-009/013 (compendium resolution).
 * Spec: 17-sistema-pf2e.md; .fusion-build/r14-plan.md (Fase 2, B2).
 */

import type { DocCreateEmbeddedPayload, DocOpPayload, DocUpdatePayload } from "./characterSheetVM.js";

// ---------------------------------------------------------------------------
// Grant markers on materialized items (flags.fusion.*)
//
// A granted item is tagged so (a) the Plan column can render it as a locked
// nested chip under its granter, (b) removeChoice can cascade-delete it, and
// (c) re-running materialization / the on-open heal is idempotent.
//
// The granter is referenced by its STABLE `flags.fusion.sourceId` + the build
// slot that placed it — NOT by the granter's embedded `_id`, which the server
// assigns on create and is therefore unknown at op-build time (doc-handlers.ts
// always mints a fresh `_id`, ignoring any client-supplied one). sourceId is
// present on both the pack doc and the embedded copy (embeddedItemPayload
// spreads it through), and the build slot disambiguates two copies of the same
// feat in different slots.
// ---------------------------------------------------------------------------

/** The grant marker written to a materialized item's `flags.fusion`. */
export interface GrantMarker {
  /** The granter's `flags.fusion.sourceId` (stable across create). */
  grantedBy: string;
  /** The granter's build slot (`flags.fusion.build.slot`), or undefined for a non-slot granter (e.g. a class feature). */
  grantedSlot?: string;
  /** This granted item's own sourceId (join key for idempotency + nested recursion). */
  sourceId: string;
}

// ---------------------------------------------------------------------------
// GrantItem parsing (from a granter doc's system.rules)
// ---------------------------------------------------------------------------

/** A single parsed fixed grant: the vendor pack + the referenced document name. */
export interface ParsedGrant {
  /** The vendor pack segment of the uuid, e.g. "feats-srd" / "actionspf2e". */
  vendor: string;
  /** The referenced document NAME (the uuid's docId segment for these vendor uuids). */
  name: string;
  /** The original grant uuid, kept for diagnostics. */
  uuid: string;
}

/**
 * Extract every FIXED `GrantItem` from a granter's `system.rules`.
 *
 * A materializable grant is a rule with `kind === "grant-item"` (Fusion's
 * converted form) or `raw.key === "GrantItem"` (the unconverted form), whose
 * `uuid` is a compendium reference `Compendium.<system>.<vendor>.Item.<Name>`.
 * In-memory-only grants (`inMemoryOnly: true`, used by ChoiceSet placeholders
 * `{item|flags...}`) are skipped — those are handled by the GRANTED_FEAT_CHOICES
 * picker path, not by fixed materialization.
 */
export function parseGrantItems(rules: unknown): ParsedGrant[] {
  if (!Array.isArray(rules)) return [];
  const grants: ParsedGrant[] = [];
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") continue;
    const r = rule as Record<string, unknown>;
    const raw = (r["raw"] && typeof r["raw"] === "object" ? (r["raw"] as Record<string, unknown>) : {});
    const isGrant = r["kind"] === "grant-item" || raw["key"] === "GrantItem";
    if (!isGrant) continue;
    if (r["inMemoryOnly"] === true) continue;
    const uuid = typeof r["uuid"] === "string" ? r["uuid"] : typeof raw["uuid"] === "string" ? (raw["uuid"] as string) : undefined;
    if (!uuid) continue;
    const parsed = parseGrantUuid(uuid);
    if (parsed) grants.push(parsed);
  }
  return grants;
}

/**
 * Extract every FIXED-ITEM grant from a granter doc's `mechanics.grants`
 * overlay (r15 A2). A fixed-item grant names ONE concrete vendor document to
 * materialize — the same downstream shape as a `system.rules` GrantItem, but
 * recovered by tools/translate-packs from a document whose grant lives only in
 * prose (the Magus "Conflux Spell": Starlit Span → Shooting Star, etc.). The
 * server attaches this overlay to the served doc as `doc.mechanics` (see
 * CompendiumService.getDocument), so the granterDoc the caller resolves already
 * carries it — no server change needed for the client to read it.
 *
 * Non-fixed grants in the overlay (`kind: "feat-choice"`, the player-picks
 * case) are ignored here — those are handled by the GRANTED_FEAT_CHOICES /
 * mechanics feat-choice path in planVM, not by fixed materialization.
 */
export function parseMechanicsGrants(mechanics: unknown): ParsedGrant[] {
  if (!mechanics || typeof mechanics !== "object") return [];
  const grants = (mechanics as Record<string, unknown>)["grants"];
  if (!Array.isArray(grants)) return [];
  const out: ParsedGrant[] = [];
  for (const g of grants) {
    if (!g || typeof g !== "object") continue;
    const grant = g as Record<string, unknown>;
    if (grant["kind"] !== "fixed-item") continue;
    const vendor = typeof grant["vendor"] === "string" ? grant["vendor"] : undefined;
    const name = typeof grant["name"] === "string" ? grant["name"].trim() : undefined;
    if (!vendor || !name) continue;
    const uuid = typeof grant["uuid"] === "string" ? grant["uuid"] : `Compendium.pf2e.${vendor}.Item.${name}`;
    out.push({ vendor, name, uuid });
  }
  return out;
}

/**
 * Extract every grant declared by an ABC (ancestry/heritage/background) or class
 * doc's `system.items` MAP (r20-X4). Foundry-shaped ABC docs carry their
 * automatically-conceded features/feats as a map keyed by a short id:
 *
 *   system.items = { "31xm9": { uuid, name, level, img } , ... }
 *
 * — e.g. Ratfolk → Sharp Teeth, Fleshwarp → Unusual Anatomy, Fireworks
 * Performer → Fascinating Performance. This is the SAME clean-room map the r18
 * pack fix preserved (uuid/name/level). Each entry's `uuid` is a compendium
 * reference parsed exactly like a `GrantItem` uuid; entries whose uuid is an
 * in-memory placeholder / malformed are skipped (they can't be materialized).
 *
 * NOTE: some ABC-feature vendors (`ancestryfeatures`) have no clean-room Fusion
 * pack yet, so `mapVendorToFusionPack` returns a pack that doesn't hold the
 * doc → the grant simply doesn't materialize (the caller renders an INFORMATIVE
 * chip from the map metadata instead). This parser never throws on that.
 */
export function parseSystemItemsGrants(system: unknown): ParsedGrant[] {
  if (!system || typeof system !== "object") return [];
  const items = (system as Record<string, unknown>)["items"];
  if (!items || typeof items !== "object") return [];
  const out: ParsedGrant[] = [];
  for (const entry of Object.values(items as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const uuid = (entry as Record<string, unknown>)["uuid"];
    if (typeof uuid !== "string") continue;
    const parsed = parseGrantUuid(uuid);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * Parse a vendor grant uuid `Compendium.<system>.<vendor>.Item.<Name>` into
 * `{ vendor, name }`. The docId segment for these grants is the document NAME
 * (may contain spaces), so everything after ".Item." is the name. Returns null
 * for a non-compendium / non-Item / malformed uuid (e.g. an in-memory
 * `{item|...}` placeholder that slipped past the inMemoryOnly guard).
 */
export function parseGrantUuid(uuid: string): ParsedGrant | null {
  // Compendium.<system>.<vendor>.Item.<Name...>
  const marker = ".Item.";
  const at = uuid.indexOf(marker);
  if (at < 0) return null;
  if (!uuid.startsWith("Compendium.")) return null;
  const head = uuid.slice("Compendium.".length, at); // "<system>.<vendor>"
  const name = uuid.slice(at + marker.length).trim();
  if (!name || name.includes("{")) return null; // placeholder / empty → not a fixed grant
  const segs = head.split(".");
  // vendor is the LAST segment of the pack id (system may itself contain dots).
  const vendor = segs[segs.length - 1];
  if (!vendor) return null;
  return { vendor, name, uuid };
}

// ---------------------------------------------------------------------------
// Vendor → Fusion pack mapping
// ---------------------------------------------------------------------------

/**
 * Map a vendor pack segment (from a grant uuid) to the Fusion pack slug that
 * holds the clean-room equivalent. Extend as new grant vendors appear in the
 * packs. Unknown vendors return undefined → the grant is skipped (logged by
 * the caller), never crashes.
 */
export function mapVendorToFusionPack(vendor: string): string | undefined {
  switch (vendor) {
    case "feats-srd":
    case "feats":
      return "feats-core";
    case "actionspf2e":
    case "actions":
      return "actions-core";
    case "spells-srd":
    case "spells":
      return "spells-core";
    case "classfeatures":
    case "class-features":
      return "class-features-core";
    case "ancestryfeatures":
      return "class-features-core";
    case "equipment-srd":
    case "equipment":
      return "weapons-core"; // best-effort; unresolved names simply skip
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Resolvers (injected by the caller — socket-backed in production, mocked in
// tests). Kept as narrow function types so grantMaterializer never imports the
// compendium API or the socket.
// ---------------------------------------------------------------------------

/** A minimal pack-index entry the resolver returns for name→uuid resolution. */
export interface GrantIndexEntry {
  name: string;
  uuid: string;
  /** Document type ("feat" | "action" | "spell" | "classFeature" ...). */
  type?: string;
}

/** Resolve a Fusion pack slug to its index entries (accent/case-insensitive name match happens here). */
export type PackIndexResolver = (packSlug: string) => Promise<GrantIndexEntry[]>;

/** Fetch a full compendium document by uuid. */
export type GrantDocResolver = (uuid: string) => Promise<Record<string, unknown> | null>;

/** The spellcasting entries the actor has, minimally described for grant-spell placement. */
export interface GrantSpellEntry {
  id: string;
  isFocusPool: boolean;
  tradition: string;
}

export interface MaterializeContext {
  actorId: string;
  /** The actor's currently-embedded items (for idempotency — read only). */
  existingItems: Array<Record<string, unknown>>;
  /** The actor's spellcasting entries (for placing granted spells). */
  spellEntries: GrantSpellEntry[];
  resolveIndex: PackIndexResolver;
  resolveDoc: GrantDocResolver;
}

// ---------------------------------------------------------------------------
// Helpers on embedded items
// ---------------------------------------------------------------------------

function itemFusionFlags(item: Record<string, unknown>): Record<string, unknown> {
  const flags = item["flags"];
  if (!flags || typeof flags !== "object") return {};
  const fusion = (flags as Record<string, unknown>)["fusion"];
  return fusion && typeof fusion === "object" ? (fusion as Record<string, unknown>) : {};
}

function itemSourceId(item: Record<string, unknown>): string | undefined {
  const sid = itemFusionFlags(item)["sourceId"];
  return typeof sid === "string" ? sid : undefined;
}

/** Read a granter's `{ sourceId, slot }` identity off its embedded item (used to tag its grants). */
export function granterIdentity(granterItem: Record<string, unknown>): { sourceId?: string; slot?: string } {
  const fusion = itemFusionFlags(granterItem);
  const sourceId = typeof fusion["sourceId"] === "string" ? (fusion["sourceId"] as string) : undefined;
  const build = fusion["build"];
  const slot = build && typeof build === "object" ? (build as Record<string, unknown>)["slot"] : undefined;
  return {
    ...(sourceId !== undefined ? { sourceId } : {}),
    ...(typeof slot === "string" ? { slot } : {}),
  };
}

/**
 * True if the actor ALREADY has this granted item from this granter — matched
 * on granter (grantedBy) + the granted item's own sourceId. Skips duplicate
 * materialization (idempotency, incl. re-running the heal).
 */
function alreadyGranted(
  existingItems: Array<Record<string, unknown>>,
  grantedBy: string,
  grantedSourceId: string,
): boolean {
  return existingItems.some((it) => {
    const fusion = itemFusionFlags(it);
    return fusion["grantedBy"] === grantedBy && fusion["sourceId"] === grantedSourceId;
  });
}

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Find an ALREADY-EMBEDDED item on the actor that IS this granted document but
 * was added MANUALLY (no `flags.fusion.grantedBy`) — matched on the granted
 * doc's own sourceId first, then on normalized name as a fallback. Returns the
 * embedded item (which carries an `_id`) so the caller can ADOPT it (stamp
 * `grantedBy` via an update) instead of creating a duplicate.
 *
 * The concrete case (r15 A2): the real Tobias already has Shooting Star in the
 * focus pool (added by hand, no grantedBy). When Starlit Span's conflux grant
 * materializes, the heal must ADOPT that existing spell — never create a second
 * copy. Items that already carry a `grantedBy` are NOT adoptable here (they're
 * covered by `alreadyGranted`'s idempotency check).
 */
function findAdoptableItem(
  existingItems: Array<Record<string, unknown>>,
  grantedDoc: Record<string, unknown>,
  grantedSourceId: string,
): Record<string, unknown> | undefined {
  const grantedName = typeof grantedDoc["name"] === "string" ? normalizeName(grantedDoc["name"]) : undefined;
  const grantedType = grantedDoc["type"];
  return existingItems.find((it) => {
    const fusion = itemFusionFlags(it);
    if (typeof fusion["grantedBy"] === "string") return false; // already a grant — not a manual add
    if (it["type"] !== grantedType) return false;
    const sid = fusion["sourceId"];
    if (typeof sid === "string" && sid === grantedSourceId) return true;
    const name = typeof it["name"] === "string" ? normalizeName(it["name"]) : undefined;
    return grantedName !== undefined && name === grantedName;
  });
}

/**
 * Build the adoption `doc:update` op that stamps `flags.fusion.grantedBy`
 * (+ grantedSlot) onto a manually-added embedded item, so it becomes part of
 * the granter's cascade (removeChoice on the granter later removes it too) and
 * the Plan renders it as a locked nested chip. Targets the embedded item by its
 * own `_id`, with `embedded.id` = the actor (parent) — the standard embedded-
 * update wire shape (see planVM.syncSlotMaxOp / DocUpdatePayload docs).
 */
function buildAdoptOp(
  embeddedItem: Record<string, unknown>,
  marker: GrantMarker,
  actorId: string,
): DocUpdatePayload {
  const diff: Record<string, unknown> = { "flags.fusion.grantedBy": marker.grantedBy };
  if (marker.grantedSlot !== undefined) diff["flags.fusion.grantedSlot"] = marker.grantedSlot;
  return {
    type: "doc:update",
    documentType: "Item",
    id: String(embeddedItem["_id"]),
    embedded: { type: "Item", id: actorId },
    diff,
  };
}

// ---------------------------------------------------------------------------
// Core materialization
// ---------------------------------------------------------------------------

/**
 * Build the `doc:create` ops that materialize every fixed grant declared by
 * `granterDoc.system.rules`, tagging each with `flags.fusion.grantedBy =
 * <granterSourceId>` (+ grantedSlot). Recurses into each granted doc's OWN
 * fixed grants up to `maxDepth` (default 3) to catch grant chains without
 * cycling. Idempotent: a grant already present on the actor (matched by
 * grantedBy + granted sourceId) is skipped.
 *
 * `granterSourceId` / `granterSlot` identify the ROOT granter for the whole
 * subtree — every materialized item (even nested ones) is tagged as granted by
 * the root, so removeChoice on the root cascades to all of them in one pass.
 */
export async function materializeGrants(
  granterDoc: Record<string, unknown>,
  granterSourceId: string,
  granterSlot: string | undefined,
  mctx: MaterializeContext,
  maxDepth = 3,
): Promise<DocOpPayload[]> {
  const ops: DocOpPayload[] = [];
  // Track sourceIds we've already scheduled in THIS pass so nested chains that
  // re-reference the same doc (or an actor that already has it) don't duplicate.
  const scheduled = new Set<string>();
  await walk(granterDoc, 0);
  return ops;

  async function walk(doc: Record<string, unknown>, depth: number): Promise<void> {
    if (depth >= maxDepth) return;
    // Two grant sources, processed uniformly: `system.rules` GrantItem elements
    // (Foundry-shaped, e.g. Alchemist Dedication) AND `mechanics.grants` of
    // kind "fixed-item" (curated from prose, e.g. the Magus conflux spell). The
    // latter arrives on the served doc via the CompendiumService overlay.
    const system = doc["system"];
    const rules = system && typeof system === "object" ? (system as Record<string, unknown>)["rules"] : undefined;
    // Three grant sources, processed uniformly: `system.rules` GrantItem
    // elements (Foundry-shaped), `mechanics.grants` of kind "fixed-item"
    // (curated from prose), and the ABC/class `system.items` MAP of
    // auto-conceded features (r20-X4 — ancestry/heritage/background/class).
    const grants = [
      ...parseGrantItems(rules),
      ...parseMechanicsGrants(doc["mechanics"]),
      ...parseSystemItemsGrants(system),
    ];
    for (const grant of grants) {
      const packSlug = mapVendorToFusionPack(grant.vendor);
      if (!packSlug) continue; // unknown vendor → skip (caller may log)
      const grantedDoc = await resolveByName(packSlug, grant.name, mctx);
      if (!grantedDoc) continue; // no clean-room equivalent → skip
      const grantedSourceId = itemSourceId(grantedDoc) ?? `name:${normalizeName(grant.name)}`;
      if (scheduled.has(grantedSourceId)) continue;
      if (alreadyGranted(mctx.existingItems, granterSourceId, grantedSourceId)) {
        scheduled.add(grantedSourceId);
        // Still recurse: a previously-materialized grant's OWN nested grants
        // may be missing (partial prior heal) — the actor's existing items
        // guard each nested create independently.
        await walk(grantedDoc, depth + 1);
        continue;
      }
      scheduled.add(grantedSourceId);
      const marker: GrantMarker = {
        grantedBy: granterSourceId,
        ...(granterSlot !== undefined ? { grantedSlot: granterSlot } : {}),
        sourceId: grantedSourceId,
      };
      // ADOPTION (r15 A2, critical): if the actor ALREADY holds this document
      // as a MANUAL add (same sourceId/name, no grantedBy) — e.g. Shooting Star
      // added to the focus pool by hand — stamp `grantedBy` onto it instead of
      // creating a duplicate. Only when no adoptable item exists do we create.
      const adoptable = findAdoptableItem(mctx.existingItems, grantedDoc, grantedSourceId);
      if (adoptable) {
        ops.push(buildAdoptOp(adoptable, marker, mctx.actorId));
      } else {
        ops.push(buildGrantCreateOp(grantedDoc, marker, mctx));
      }
      await walk(grantedDoc, depth + 1);
    }
  }
}

/** Resolve a doc by name within a Fusion pack (accent/case-insensitive), returning its full document or null. */
async function resolveByName(
  packSlug: string,
  name: string,
  mctx: MaterializeContext,
): Promise<Record<string, unknown> | null> {
  const entries = await mctx.resolveIndex(packSlug);
  const target = normalizeName(name);
  const entry = entries.find((e) => normalizeName(e.name) === target);
  if (!entry) return null;
  return mctx.resolveDoc(entry.uuid);
}

/**
 * Build the doc:create op for a granted document. The document is stripped of
 * `_id` (server assigns a fresh one) and tagged with the grant marker. A
 * granted SPELL additionally gets `location` set to the correct spellcasting
 * entry (focus pool when the spell has the `focus` trait; else an entry
 * matching the spell's tradition; else the first non-focus entry).
 */
export function buildGrantCreateOp(
  grantedDoc: Record<string, unknown>,
  marker: GrantMarker,
  mctx: MaterializeContext,
): DocCreateEmbeddedPayload {
  const { _id: _drop, ...rest } = grantedDoc;
  const existingFlags = rest["flags"] && typeof rest["flags"] === "object" ? (rest["flags"] as Record<string, unknown>) : {};
  const existingFusion = existingFlags["fusion"] && typeof existingFlags["fusion"] === "object" ? (existingFlags["fusion"] as Record<string, unknown>) : {};

  const data: Record<string, unknown> = {
    ...rest,
    flags: {
      ...existingFlags,
      fusion: {
        ...existingFusion,
        grantedBy: marker.grantedBy,
        ...(marker.grantedSlot !== undefined ? { grantedSlot: marker.grantedSlot } : {}),
      },
    },
  };

  if (rest["type"] === "spell") {
    const entryId = pickSpellEntryId(grantedDoc, mctx.spellEntries);
    if (entryId) data["location"] = entryId;
  }

  return {
    type: "doc:create",
    documentType: "Item",
    data,
    parent: { type: "Actor", id: mctx.actorId },
  };
}

/**
 * Choose the spellcasting entry a granted spell should live in:
 *   1. focus trait → the focus pool entry (isFocusPool), if any;
 *   2. else an entry whose tradition matches the spell's tradition;
 *   3. else the first non-focus entry;
 *   4. else undefined (no entry — spell still materializes, ungrouped).
 */
export function pickSpellEntryId(
  spellDoc: Record<string, unknown>,
  entries: GrantSpellEntry[],
): string | undefined {
  const system = spellDoc["system"];
  const sys = system && typeof system === "object" ? (system as Record<string, unknown>) : {};
  const traitsObj = sys["traits"];
  const traits = traitsObj && typeof traitsObj === "object" && Array.isArray((traitsObj as Record<string, unknown>)["value"])
    ? ((traitsObj as Record<string, unknown>)["value"] as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  const traditionObj = sys["traditions"] ?? sys["tradition"];
  const spellTraditions = Array.isArray(traditionObj)
    ? traditionObj.filter((v): v is string => typeof v === "string")
    : [];

  if (traits.includes("focus")) {
    const focus = entries.find((e) => e.isFocusPool);
    if (focus) return focus.id;
  }
  const nonFocus = entries.filter((e) => !e.isFocusPool);
  const byTradition = nonFocus.find((e) => spellTraditions.includes(e.tradition));
  if (byTradition) return byTradition.id;
  return nonFocus[0]?.id;
}
