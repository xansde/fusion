/**
 * petsVM.ts — view-model for the PF2e character sheet's "Pets" tab
 * (companions / familiars, spec 29 r16-G4).
 *
 * RESPONSIBILITIES (all pure & testable except the async pack loader):
 *   - Detect whether the master character can have a familiar: a curated feat
 *     name (Familiar / Rat Familiar / Pet) OR an embedded item carrying the
 *     `familiarAbilities` rule element (the canonical, data-driven signal).
 *   - Compute the familiar's daily-ability BUDGET from the master: 2 base +
 *     the highest `familiarAbilities` bump on the master's items (Rat Familiar
 *     upgrades to 2 → budget 4; Enhanced Familiar upgrades to 4 → budget 6).
 *   - Snapshot the master's derived stats (level / spellcasting-ability mod /
 *     AC / saves / Perception) into the shape the familiar schema's
 *     `system.master` cache expects, so the server's familiar DeriveSteps can
 *     mirror them (single-actor derivation — the familiar never reads the
 *     master doc itself; see systems/pf2e actor-familiar.ts docstring).
 *   - Build the doc:create op for a new familiar Actor (owned by the same users
 *     as the master), and doc:update / doc:delete ops for HP edits, daily
 *     ability selection, rename and removal.
 *   - Load the `familiar-abilities-core` compendium pack for the ability picker
 *     (bilingual EN/pt-BR via the server's i18n overlay), resolving the LIVE
 *     socket on demand (never a frozen prop — r10 frozen-socket lesson).
 *
 * LIMITATION (documented follow-up): the master cache is a snapshot taken when
 * this VM builds a create/refresh op. If the master levels up while no Pets tab
 * is open, the familiar's derived stats are stale until the tab is reopened and
 * `buildMasterRefreshOps` re-snapshots. A live cross-actor sync is out of the
 * MVP scope.
 *
 * Clean-room: remaster (ORC) mechanics only.
 */

import type { Socket } from "socket.io-client";
import type { PackIndexEntry } from "@fusion/shared";
import { normalizeSearchText } from "@fusion/shared";
import {
  listPacks,
  searchPack,
  requireConnectedSocket,
  SocketUnavailableError,
} from "$lib/compendium/compendiumApi.js";
import {
  localizedNameParts,
  formatIndexActionCost,
  type RowActionCost,
} from "$lib/compendium/documentDetails.js";
import type { SupportedLocale } from "$lib/i18n/i18n.js";

export const FAMILIAR_ABILITIES_PACK_SLUG = "familiar-abilities-core";

/** Base number of familiar abilities before any feat bumps (remaster). */
export const FAMILIAR_ABILITY_BASE = 2;

/**
 * Curated feat names that grant a familiar/pet. The `familiarAbilities` rule
 * element is the primary signal (detectFamiliarGrant), but a feat that grants a
 * familiar via GrantItem alone (the base "Familiar" class feat delegates the
 * counter to the granted "Pet" item) still needs to enable the tab — hence the
 * curated fallback list. Names are matched case-insensitively and exactly.
 *
 * SOURCE OF TRUTH (r17-P1): the authoritative copy of this detection lives in
 * `systems/pf2e/src/familiar-grant.ts` (`FAMILIAR_GRANTING_FEATS`,
 * `detectFamiliarGrant`, `isFamiliarAbilitiesRule`, `masterItems`) and the
 * SERVER imports it to authorize a PLAYER creating their own familiar without a
 * GM (doc:create gate, doc-handlers.ts). The client cannot import
 * `@fusion/system-pf2e` (arch boundary REQ-ARQ-005 — see planVM.ts docstring),
 * so this VM mirrors the same pure logic here for the CTA. Keep the two in
 * sync: any change to the grant rule must be applied to both files.
 */
export const FAMILIAR_GRANTING_FEATS: ReadonlySet<string> = new Set([
  "familiar",
  "rat familiar",
  "pet",
  "enhanced familiar",
  "incredible familiar",
  "leshy familiar",
  "faerie dragon familiar",
]);

// ---------------------------------------------------------------------------
// Master snapshot
// ---------------------------------------------------------------------------

/** The subset of a familiar's `system.master` cache this VM snapshots. */
export interface MasterSnapshot {
  level: number;
  abilityMod: number;
  ac: number;
  saves: { fortitude: number; reflex: number; will: number };
  perception: number;
  name: string;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function getSystem(doc: Record<string, unknown>): Record<string, unknown> {
  const sys = doc["system"];
  return sys && typeof sys === "object" ? (sys as Record<string, unknown>) : {};
}

function getDerived(doc: Record<string, unknown>): Record<string, unknown> {
  const sys = getSystem(doc);
  const d = sys["derived"];
  return d && typeof d === "object" ? (d as Record<string, unknown>) : {};
}

/** Master's embedded items array (feats/heritages/etc.), or []. */
export function masterItems(masterDoc: Record<string, unknown>): Array<Record<string, unknown>> {
  const items = masterDoc["items"];
  if (!Array.isArray(items)) return [];
  return items.filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null);
}

/**
 * The master's spellcasting/key ability modifier — the familiar's attack and
 * default trained skills key off this. Reads the derived ability-mods cache
 * keyed by `system.details.keyAbility`; falls back to 0 (a familiar with an
 * unknown key ability just gets level-only mods, never a crash).
 */
export function masterAbilityMod(masterDoc: Record<string, unknown>): number {
  const sys = getSystem(masterDoc);
  const details = sys["details"] as Record<string, unknown> | undefined;
  const keyAbility = typeof details?.["keyAbility"] === "string" ? details["keyAbility"] : "";
  const derived = getDerived(masterDoc);
  const mods = derived["abilityMods"] as Record<string, number> | undefined;
  if (keyAbility && mods && typeof mods[keyAbility] === "number") return mods[keyAbility];
  return 0;
}

/**
 * Snapshot the master's derived stats into the familiar's `system.master`
 * cache shape. Uses the derived block (AC/saves/perception totals) with a raw
 * fallback for docs not yet derived.
 */
export function buildMasterSnapshot(masterDoc: Record<string, unknown>): MasterSnapshot {
  const sys = getSystem(masterDoc);
  const derived = getDerived(masterDoc);

  const levelBlock = sys["level"] as { value?: unknown } | undefined;
  const level = num(levelBlock?.value, 1);

  const acDerived = derived["ac"] as { total?: unknown } | undefined;
  const acRaw = (sys["attributes"] as Record<string, unknown> | undefined)?.["ac"] as
    | { value?: unknown }
    | undefined;
  const ac = num(acDerived?.total, num(acRaw?.value, 10));

  const savesDerived = derived["saves"] as Record<string, { total?: unknown }> | undefined;
  const saveOf = (k: string): number => num(savesDerived?.[k]?.total, 0);

  const percDerived = derived["perception"] as { total?: unknown } | undefined;
  const perception = num(percDerived?.total, 0);

  const rawName = masterDoc["name"];

  return {
    level,
    abilityMod: masterAbilityMod(masterDoc),
    ac,
    saves: { fortitude: saveOf("fortitude"), reflex: saveOf("reflex"), will: saveOf("will") },
    perception,
    name: typeof rawName === "string" ? rawName : "",
  };
}

// ---------------------------------------------------------------------------
// Familiar-grant detection + budget
// ---------------------------------------------------------------------------

/** True when a rule element bumps `system.attributes.familiarAbilities.value`. */
function isFamiliarAbilitiesRule(rule: unknown): rule is { value?: unknown; selector?: unknown } {
  if (rule === null || typeof rule !== "object") return false;
  const r = rule as Record<string, unknown>;
  const selector = typeof r["selector"] === "string" ? r["selector"] : "";
  const path = typeof r["path"] === "string" ? r["path"] : "";
  const rawPath =
    typeof (r["raw"] as Record<string, unknown> | undefined)?.["path"] === "string"
      ? ((r["raw"] as Record<string, unknown>)["path"] as string)
      : "";
  return (
    selector.includes("familiarAbilities") ||
    path.includes("familiarAbilities") ||
    rawPath.includes("familiarAbilities")
  );
}

function itemRules(item: Record<string, unknown>): unknown[] {
  const sys = item["system"] as Record<string, unknown> | undefined;
  const rules = sys?.["rules"];
  return Array.isArray(rules) ? rules : [];
}

/**
 * Detect whether the master can have a familiar and how big its daily-ability
 * budget is. Returns `{ canHaveFamiliar, abilityBudget }`.
 *
 * Budget = FAMILIAR_ABILITY_BASE (2) + the highest `familiarAbilities` bump
 * found across the master's items (the vendor uses `mode: "upgrade"`, so the
 * max — not sum — is the effective bump). Rat Familiar upgrades to 2 → budget
 * 4; Enhanced Familiar upgrades to 4 → budget 6.
 */
export function detectFamiliarGrant(masterDoc: Record<string, unknown>): {
  canHaveFamiliar: boolean;
  abilityBudget: number;
} {
  let hasRuleSignal = false;
  let hasCuratedFeat = false;
  let maxBump = 0;

  for (const item of masterItems(masterDoc)) {
    const type = item["type"];
    const rawName = item["name"];
    const name = typeof rawName === "string" ? rawName.trim().toLowerCase() : "";

    if ((type === "feat" || type === "action") && FAMILIAR_GRANTING_FEATS.has(name)) {
      hasCuratedFeat = true;
    }

    for (const rule of itemRules(item)) {
      if (isFamiliarAbilitiesRule(rule)) {
        hasRuleSignal = true;
        const v = (rule as { value?: unknown })["value"];
        if (typeof v === "number" && v > maxBump) maxBump = v;
      }
    }
  }

  const canHaveFamiliar = hasRuleSignal || hasCuratedFeat;
  const abilityBudget = FAMILIAR_ABILITY_BASE + maxBump;
  return { canHaveFamiliar, abilityBudget };
}

// ---------------------------------------------------------------------------
// Linked familiars
// ---------------------------------------------------------------------------

/** A familiar Actor linked to the master, with the fields the card needs. */
export interface LinkedFamiliar {
  id: string;
  name: string;
  companionKind: string;
  appearance: string;
  hp: { value: number; max: number };
  ac: number;
  perception: number;
  saves: { fortitude: number; reflex: number; will: number };
  attack: number;
  speed: number;
  otherSpeeds: Array<{ type: string; value: number }>;
  abilitiesBudget: { value: number; max: number };
  selectedAbilities: string[];
  /** True when the master reference is missing/mismatched (orphan). */
  orphaned: boolean;
}

/**
 * Read a familiar Actor doc into a LinkedFamiliar (derived-first, raw
 * fallback). `expectedMasterId` flags orphans (dangling `masterActorId`).
 */
export function readFamiliar(
  doc: Record<string, unknown>,
  expectedMasterId: string,
): LinkedFamiliar {
  const sys = getSystem(doc);
  const derived = getDerived(doc);
  const attrs = sys["attributes"] as Record<string, unknown> | undefined;
  const rawHp = attrs?.["hp"] as { value?: unknown; max?: unknown } | undefined;
  const derHp = derived["hp"] as { value?: unknown; max?: unknown } | undefined;
  const derAc = derived["ac"] as { total?: unknown } | undefined;
  const derPerc = derived["perception"] as { total?: unknown } | undefined;
  const derSaves = derived["saves"] as Record<string, { total?: unknown }> | undefined;
  const derAttack = derived["attack"] as { total?: unknown } | undefined;
  const derSpeed = derived["speed"] as { value?: unknown; otherSpeeds?: unknown } | undefined;
  const budget = sys["abilitiesBudget"] as { value?: unknown; max?: unknown } | undefined;
  const selected = sys["selectedAbilities"];
  const rawName = doc["name"];
  const masterId = typeof sys["masterActorId"] === "string" ? sys["masterActorId"] : null;
  const rawOther = derSpeed?.otherSpeeds;

  return {
    id: typeof doc["_id"] === "string" ? doc["_id"] : "",
    name: typeof rawName === "string" ? rawName : "Familiar",
    companionKind: typeof sys["companionKind"] === "string" ? sys["companionKind"] : "familiar",
    appearance: typeof sys["appearance"] === "string" ? sys["appearance"] : "",
    hp: {
      value: num(derHp?.value, num(rawHp?.value, 0)),
      max: num(derHp?.max, num(rawHp?.max, 0)),
    },
    ac: num(derAc?.total, 10),
    perception: num(derPerc?.total, 0),
    saves: {
      fortitude: num(derSaves?.["fortitude"]?.total, 0),
      reflex: num(derSaves?.["reflex"]?.total, 0),
      will: num(derSaves?.["will"]?.total, 0),
    },
    attack: num(derAttack?.total, 0),
    speed: num(derSpeed?.value, 25),
    otherSpeeds: Array.isArray(rawOther)
      ? (rawOther as unknown[]).filter(
          (s): s is { type: string; value: number } =>
            typeof s === "object" &&
            s !== null &&
            typeof (s as { type?: unknown }).type === "string" &&
            typeof (s as { value?: unknown }).value === "number",
        )
      : [],
    abilitiesBudget: {
      value: num(budget?.value, FAMILIAR_ABILITY_BASE),
      max: num(budget?.max, FAMILIAR_ABILITY_BASE),
    },
    selectedAbilities: Array.isArray(selected)
      ? (selected as unknown[]).filter((s): s is string => typeof s === "string")
      : [],
    orphaned: masterId !== expectedMasterId,
  };
}

/** Every familiar Actor (from the world's actor list) linked to `masterId`. */
export function linkedFamiliars(
  allActors: Array<Record<string, unknown>>,
  masterId: string,
): LinkedFamiliar[] {
  const out: LinkedFamiliar[] = [];
  for (const actor of allActors) {
    if (actor["type"] !== "familiar") continue;
    const sys = getSystem(actor);
    if (sys["masterActorId"] !== masterId) continue;
    out.push(readFamiliar(actor, masterId));
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return out;
}

// ---------------------------------------------------------------------------
// Op builders
// ---------------------------------------------------------------------------

/** A create op for a new familiar Actor (normalized by sendOp). */
export interface CreateFamiliarOp {
  type: "doc:create";
  documentType: "Actor";
  data: Record<string, unknown>;
}

/** An update op for an existing familiar Actor. */
export interface UpdateFamiliarOp {
  type: "doc:update";
  documentType: "Actor";
  id: string;
  diff: Record<string, unknown>;
}

/** A delete op for a familiar Actor. */
export interface DeleteFamiliarOp {
  type: "doc:delete";
  documentType: "Actor";
  id: string;
}

/**
 * Build the doc:create op for a new familiar linked to the master. The familiar
 * inherits the master's ownership (so the master's owner is the familiar's
 * owner — spec 29 §ownership) and carries the snapshot + budget so the server's
 * DeriveSteps produce a full statblock immediately.
 */
export function buildCreateFamiliarOp(opts: {
  masterId: string;
  masterDoc: Record<string, unknown>;
  name: string;
  appearance?: string;
  companionKind?: "familiar" | "pet";
}): CreateFamiliarOp {
  const snapshot = buildMasterSnapshot(opts.masterDoc);
  const { abilityBudget } = detectFamiliarGrant(opts.masterDoc);
  const hpMax = Math.max(0, 5 * snapshot.level);
  const ownership = opts.masterDoc["ownership"];

  return {
    type: "doc:create",
    documentType: "Actor",
    data: {
      name: opts.name.trim() || "Familiar",
      type: "familiar",
      ...(ownership && typeof ownership === "object" ? { ownership } : {}),
      system: {
        companionKind: opts.companionKind ?? "familiar",
        masterActorId: opts.masterId,
        master: snapshot,
        appearance: opts.appearance ?? "",
        attributes: { hp: { value: hpMax, max: hpMax, temp: 0 } },
        abilitiesBudget: { value: abilityBudget, max: abilityBudget },
        selectedAbilities: [],
      },
    },
  };
}

/**
 * Re-snapshot the master onto an existing familiar (re-derive on read). Emitted
 * when the Pets tab opens so a familiar tracks a master who levelled up while
 * the tab was closed. Returns null when nothing changed (avoids a no-op write).
 */
export function buildMasterRefreshOp(
  familiar: LinkedFamiliar,
  masterId: string,
  masterDoc: Record<string, unknown>,
): UpdateFamiliarOp | null {
  const snapshot = buildMasterSnapshot(masterDoc);
  const { abilityBudget } = detectFamiliarGrant(masterDoc);
  // Cheap change check: if level, budget, and the mirrored totals are already
  // reflected in the familiar's derived stats, skip the write.
  const hpMax = Math.max(0, 5 * snapshot.level);
  const unchanged =
    familiar.abilitiesBudget.max === abilityBudget &&
    familiar.hp.max === hpMax &&
    familiar.ac === snapshot.ac &&
    familiar.perception === snapshot.perception &&
    familiar.saves.fortitude === snapshot.saves.fortitude &&
    familiar.saves.reflex === snapshot.saves.reflex &&
    familiar.saves.will === snapshot.saves.will;
  if (unchanged) return null;

  return {
    type: "doc:update",
    documentType: "Actor",
    id: familiar.id,
    diff: {
      system: {
        master: snapshot,
        abilitiesBudget: { value: abilityBudget, max: abilityBudget },
      },
    },
  };
}

/** Update a familiar's current HP (owner edit). Clamped to [0, max]. */
export function buildSetHpOp(familiar: LinkedFamiliar, value: number): UpdateFamiliarOp {
  const clamped = Math.max(0, Math.min(Math.round(value), familiar.hp.max));
  return {
    type: "doc:update",
    documentType: "Actor",
    id: familiar.id,
    diff: { system: { attributes: { hp: { value: clamped } } } },
  };
}

/** Rename a familiar. */
export function buildRenameOp(familiar: LinkedFamiliar, name: string): UpdateFamiliarOp {
  return {
    type: "doc:update",
    documentType: "Actor",
    id: familiar.id,
    diff: { name: name.trim() || "Familiar" },
  };
}

/** Set the familiar's appearance flavour text. */
export function buildSetAppearanceOp(
  familiar: LinkedFamiliar,
  appearance: string,
): UpdateFamiliarOp {
  return {
    type: "doc:update",
    documentType: "Actor",
    id: familiar.id,
    diff: { system: { appearance } },
  };
}

/**
 * Toggle a familiar ability slug in the daily selection, enforcing the budget
 * cap. Returns null when adding would exceed the cap (the UI should have
 * disabled the control, but this is the authoritative guard).
 */
export function buildToggleAbilityOp(
  familiar: LinkedFamiliar,
  slug: string,
): UpdateFamiliarOp | null {
  const current = new Set(familiar.selectedAbilities);
  if (current.has(slug)) {
    current.delete(slug);
  } else {
    if (current.size >= familiar.abilitiesBudget.max) return null;
    current.add(slug);
  }
  return {
    type: "doc:update",
    documentType: "Actor",
    id: familiar.id,
    diff: { system: { selectedAbilities: [...current] } },
  };
}

/** Delete a familiar Actor. */
export function buildDeleteOp(familiar: LinkedFamiliar): DeleteFamiliarOp {
  return { type: "doc:delete", documentType: "Actor", id: familiar.id };
}

// ---------------------------------------------------------------------------
// Error mapping (server ack → friendly pt-BR i18n key)
// ---------------------------------------------------------------------------

/**
 * Map a familiar-create failure (an OpError thrown by sendOp, carrying the
 * server's `code` + `message`) to a friendly i18n key. The server's messages
 * are technical English (e.g. "You do not own the master actor") — never shown
 * raw. The specific PERMISSION_DENIED reasons are disambiguated by matching the
 * exact server message (authorizePlayerCompanionCreate in doc-handlers.ts);
 * anything unrecognized falls back to a generic key.
 *
 * Kept string-based (not importing OpError) so this stays a pure, testable
 * helper: it reads `code`/`message` off any error-shaped value.
 */
export function familiarCreateErrorKey(err: unknown): string {
  const e = (err ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";

  if (code === "NOT_FOUND" || message.includes("master actor not found")) {
    return "FUSION.Sheet.Pets.Error.NotFound";
  }
  if (message.includes("already has a familiar")) {
    return "FUSION.Sheet.Pets.Error.Duplicate";
  }
  if (message.includes("do not own the master")) {
    return "FUSION.Sheet.Pets.Error.NotOwner";
  }
  if (message.includes("no feat that grants a familiar")) {
    return "FUSION.Sheet.Pets.Error.NoGrant";
  }
  if (code === "PERMISSION_DENIED") {
    return "FUSION.Sheet.Pets.Error.Permission";
  }
  return "FUSION.Sheet.Pets.Error.Generic";
}

// ---------------------------------------------------------------------------
// Ability picker rows (from the familiar-abilities-core pack)
// ---------------------------------------------------------------------------

/** One selectable ability row for the daily-ability picker. */
export interface AbilityRow {
  /** Stable dedupe slug (system.slug or slugified name). */
  slug: string;
  /** Display name in the active locale (pt-BR when translated, else EN). */
  name: string;
  /** EN name subtitle when a translation is shown (else null). */
  subtitleEn: string | null;
  /** Compendium UUID (for the details fetch), or null. */
  uuid: string | null;
  /**
   * Action-cost badge (◆/⟳/short text) from the server-derived
   * `index.actionCost`, or null for passive/cost-less abilities (r20-X2).
   */
  actionCost: RowActionCost | null;
  /** Search haystack (normalized name, both locales). */
  searchText: string;
}

/** Derive a slug from a pack entry (system.slug or slugified name). */
export function abilitySlug(entry: PackIndexEntry): string {
  const idx = (entry as { index?: Record<string, unknown> }).index;
  const sysSlug = idx?.["system.slug"];
  if (typeof sysSlug === "string" && sysSlug.length > 0) return sysSlug;
  return normalizeSearchText(entry.name).replace(/\s+/g, "-");
}

/** Map a pack index entry to an AbilityRow in the active locale. */
export function toAbilityRow(entry: PackIndexEntry, locale: SupportedLocale): AbilityRow {
  const parts = localizedNameParts(entry, locale);
  const slug = abilitySlug(entry);
  const enName = entry.name;
  const ptName = parts.display !== enName ? parts.display : "";
  return {
    slug,
    name: parts.display,
    subtitleEn: parts.subtitleEn,
    uuid: typeof entry.uuid === "string" ? entry.uuid : null,
    actionCost: formatIndexActionCost(entry.index["actionCost"], locale),
    searchText: normalizeSearchText(`${enName} ${ptName}`),
  };
}

/**
 * Load the familiar-abilities-core pack entries (bilingual) for the picker.
 * Resolves the LIVE socket on demand. Throws SocketUnavailableError when not
 * connected (caller shows a not-connected state with retry).
 */
export async function loadAbilityEntries(
  getSocketFn: () => Socket | null | undefined,
  systemId = "pf2e",
): Promise<PackIndexEntry[]> {
  const sock = requireConnectedSocket(getSocketFn());
  const { packs } = await listPacks(sock, { systemId, documentType: "Item" });
  const pack =
    packs.find((p) => p.id === `${systemId}.${FAMILIAR_ABILITIES_PACK_SLUG}`) ??
    packs.find((p) => p.id.endsWith(`.${FAMILIAR_ABILITIES_PACK_SLUG}`));
  if (!pack) return [];
  const { entries } = await searchPack(sock, { packId: pack.id });
  return entries;
}

/** Discriminate the not-connected error kind from any other load failure. */
export type AbilitiesLoadError = "not-connected" | "load" | null;
export function classifyAbilitiesLoadError(err: unknown): Exclude<AbilitiesLoadError, null> {
  return err instanceof SocketUnavailableError ? "not-connected" : "load";
}

/** Filter + sort ability rows for the picker (accent/case-insensitive search). */
export function filterAbilityRows(rows: AbilityRow[], search: string): AbilityRow[] {
  const q = normalizeSearchText(search);
  const filtered = q ? rows.filter((r) => r.searchText.includes(q)) : rows;
  return [...filtered].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
