/**
 * characterSheetVM.ts — Pure view-model for the PF2e Character Sheet.
 *
 * This module is 100% testable TypeScript — no PIXI, no Svelte, no browser APIs.
 * The Svelte component (CharacterSheet.svelte) imports this and stays thin.
 *
 * Responsibilities:
 *   - Read the server-derived document (system.derived populated by M3-B steps)
 *   - Group data into the 5 sheet tabs: main, skills, actions, spells, inventory
 *   - Format display values (modifier signs, proficiency labels, etc.)
 *   - Expose typed roll actions: each returns an Envelope payload to send via sendOp
 *   - Expose condition management ops
 *   - Enforce permission gates (OBSERVER/OWNER/GM)
 *
 * Clean-room. Mechanics from ORC/OGL (Archives of Nethys).
 * REQ-PF2-110..114, REQ-UIF-021..025.
 * Spec: 17-sistema-pf2e.md §Fichas, 11-ui-framework-e-fichas.md §Sistema de Sheets.
 */

import type {
  CharacterDerived,
  DerivedStatistic,
  DerivedStrike,
  DerivedElementalBlast,
  ArchetypeClassDC,
  ClassDCEntry,
} from "./derivedTypes.js";
import type { SpellSaveType, ChatSendFlags, AbilityCard } from "@fusion/shared";
import { t, i18n } from "../../i18n/index.js";
import { skillNamePt } from "./skillNames.js";
import { isLoreSlug, loreSubject } from "./loreSlug.js";
import { translateDamageType } from "../../compendium/documentDetails.js";
import {
  effectiveSpellRank,
  computeHeightenedSpell,
  healSpellSystem,
  type SpellSurface,
  type HeightenedSpell,
} from "./spellHeightening.js";

// ---------------------------------------------------------------------------
// Re-export derived types for consumers
// ---------------------------------------------------------------------------

export type {
  CharacterDerived,
  DerivedStatistic,
  DerivedStrike,
  DerivedElementalBlast,
  ArchetypeClassDC,
  ClassDCEntry,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Format a numeric modifier with explicit sign (+3, -1, +0). */
export function fmtMod(value: number): string {
  return value >= 0 ? `+${String(value)}` : String(value);
}

/** Proficiency rank 0–4 → label. */
export function proficiencyLabel(rank: number): string {
  switch (rank) {
    case 1:
      return "T";
    case 2:
      return "E";
    case 3:
      return "M";
    case 4:
      return "L";
    default:
      return "U";
  }
}

/**
 * Canonical "equipped" predicate (contract 1 — mirrored on the server side
 * in systems/pf2e; MUST keep the same semantics on both sides).
 *
 * sys.equipped === true || sys.equipped?.value === true || sys.equipped?.inSlot === true.
 * Weapons of category "unarmed" always count as equipped (you cannot
 * unequip a bite) — callers pass isUnarmed=true for those.
 */
export function isEquippedFlag(sys: Record<string, unknown>, isUnarmed = false): boolean {
  if (isUnarmed) return true;
  const eq = sys["equipped"];
  if (eq === true) return true;
  if (typeof eq === "object" && eq !== null) {
    const e = eq as Record<string, unknown>;
    if (e["value"] === true) return true;
    if (e["inSlot"] === true) return true;
  }
  return false;
}

/** Full proficiency label. */
export function proficiencyLabelFull(rank: number): string {
  switch (rank) {
    case 1:
      return "Trained";
    case 2:
      return "Expert";
    case 3:
      return "Master";
    case 4:
      return "Legendary";
    default:
      return "Untrained";
  }
}

/**
 * English row label for a Lore proficiency, e.g. "Lore (Abyssal History)".
 *
 * The subject comes from `loreSubject`, which understands both slug
 * conventions, so a legacy `scribing-lore` renders as "Lore (Scribing)"
 * instead of leaking the raw slug. A subject-less `lore` is just "Lore".
 * Kept in EN on purpose — the pt-BR rendering is `skillNamePt`'s job.
 */
function loreLabel(slug: string): string {
  const subject = loreSubject(slug);
  if (!subject) return "Lore";
  const titled = subject.replace(
    /(^|\s)(\S)/g,
    (_m, sep: string, ch: string) => sep + ch.toUpperCase(),
  );
  return `Lore (${titled})`;
}

// ---------------------------------------------------------------------------
// Document accessor helpers
// ---------------------------------------------------------------------------

function getSystem(doc: Record<string, unknown>): Record<string, unknown> {
  const sys = doc["system"];
  return typeof sys === "object" && sys !== null ? (sys as Record<string, unknown>) : {};
}

function getDerived(doc: Record<string, unknown>): CharacterDerived | null {
  const sys = getSystem(doc);
  const derived = sys["derived"];
  if (!derived || typeof derived !== "object") return null;
  return derived as unknown as CharacterDerived;
}

/**
 * Unwrap a `{ value: string }` wrapper (the shape pf2e item schemas use for
 * enum-ish fields like tradition/prepared/ability) OR accept a flat string.
 * Returns `fallback` for anything else.
 */
function unwrapStringValue(raw: unknown, fallback: string): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const v = (raw as Record<string, unknown>)["value"];
    if (typeof v === "string") return v;
  }
  return fallback;
}

/**
 * Whether a spell `system` describes a spell ATTACK (needs a spell-attack roll).
 * Remaster spells signal this with the `"attack"` trait (see spells-core pack:
 * Ignition/Blazing Bolt carry it, Electric Arc — a save spell — does not).
 * Also honours the legacy `defense.spellAttack === true` flag for any
 * hand-authored data that used it. Reads the HEALED system (traits restored).
 */
function spellSystemHasAttack(system: Record<string, unknown>): boolean {
  const traitsBlock = system["traits"] as { value?: unknown } | undefined;
  const traits = Array.isArray(traitsBlock?.value) ? (traitsBlock.value as unknown[]) : [];
  if (traits.includes("attack")) return true;
  const defense = system["defense"] as Record<string, unknown> | undefined;
  return defense?.["spellAttack"] === true;
}

/**
 * Whether a spell DOCUMENT (compendium shape — `system.traits.value`, same
 * as `spellSystemHasAttack` reads) belongs in a focus-pool entry. Used by
 * `addSpellToEntry` (issue #8) to keep focus spells out of prepared/
 * spontaneous grimoires and vice versa.
 *
 * True for the "focus" trait, AND for the "composition" trait even without
 * "focus" (issue #6): 10/20 Bard composition spells in spells-core are
 * CANTRIPS and correctly omit "focus" per RAW (cantrips never cost a Focus
 * Point) — but they still only ever go in the Bard's focus-pool entry, never
 * a prepared/spontaneous grimoire. Without this, the picker's widened
 * `matchesTraitFilter` (issue #6) would let a player SELECT a composition
 * cantrip and this guard would then silently reject the resulting
 * `addSpellToEntry` call (op === null, no feedback).
 */
function docHasFocusTrait(doc: Record<string, unknown>): boolean {
  const system = doc["system"];
  if (typeof system !== "object" || system === null) return false;
  const traitsBlock = (system as Record<string, unknown>)["traits"] as
    | { value?: unknown }
    | undefined;
  const traits = Array.isArray(traitsBlock?.value) ? (traitsBlock.value as unknown[]) : [];
  return traits.includes("focus") || traits.includes("composition");
}

/** ◆ glyphs for an action cost value 1/2/3, reaction, or free. */
const SPELL_COST_GLYPHS: Record<string, string> = {
  "1": "◆",
  "2": "◆◆",
  "3": "◆◆◆",
  reaction: "⟳",
  free: "◇",
};

/**
 * Action-cost glyphs for a spell's cast time (r16). Reads `system.time.value`
 * (e.g. "1", "2", "2 to 2 rounds") and returns the ◆ glyph string, matching the
 * Actions tab (COST_GLYPHS). Ranges like "2 to 2 rounds" take the leading
 * number. Non-action casts (minutes/hours/blank) return "" (no glyphs shown).
 */
function spellActionGlyphs(system: Record<string, unknown>): string {
  const time = system["time"] as { value?: unknown } | undefined;
  const raw = typeof time?.["value"] === "string" ? time["value"].trim() : "";
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower.startsWith("reaction")) return SPELL_COST_GLYPHS["reaction"] ?? "";
  if (lower.startsWith("free")) return SPELL_COST_GLYPHS["free"] ?? "";
  const lead = /^(\d)/.exec(raw);
  if (lead) return SPELL_COST_GLYPHS[lead[1] ?? ""] ?? "";
  return "";
}

// ---------------------------------------------------------------------------
// Ability names
//
// R24 (#40.3): these EN maps are kept ONLY as the internal source of truth
// for the six ability slugs (iteration order) and as an EN reference/fallback
// — they are NEVER read as a display value anymore. `AbilityRow.label`/
// `.longLabel` and `SkillRow.abilityLabel` are computed at GETTER-CALL time
// via t() against FUSION.Sheet.Labels.Ability.<slug>[.full] (both keys
// already existed in the bundles, just unused). Getter-call time matters:
// unlike a top-level `const X = t(...)`, which would freeze whatever locale
// was active at MODULE IMPORT time forever, a plain class getter re-runs
// t() every time `vm.abilities`/`vm.skills` is read — same reactivity
// characteristics as calling t() directly in the Svelte template.
// ---------------------------------------------------------------------------

export const ABILITY_LABELS: Record<string, string> = {
  str: "STR",
  dex: "DEX",
  con: "CON",
  int: "INT",
  wis: "WIS",
  cha: "CHA",
};

export const ABILITY_LONG_LABELS: Record<string, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

// ---------------------------------------------------------------------------
// Sheet tab types
// ---------------------------------------------------------------------------

export type CharacterSheetTab =
  | "main"
  | "skills"
  | "actions"
  | "spells"
  | "pets"
  | "inventory"
  | "bio"
  /**
   * Isekai layer (variants/isekai) — Focus pool, spendable abilities and the
   * per-archetype trackers. Shown ONLY while the variant is on, like "pets"
   * is shown only when the character has one.
   */
  | "isekai";

// ---------------------------------------------------------------------------
// Row types for the sheet UI
// ---------------------------------------------------------------------------

export interface AbilityRow {
  slug: string;
  label: string;
  longLabel: string;
  score: number;
  mod: number;
  modFormatted: string;
}

export interface SaveRow {
  slug: string;
  label: string;
  total: number;
  totalFormatted: string;
  dc: number;
  rank: number;
  rankLabel: string;
}

export interface SkillRow {
  slug: string;
  label: string;
  total: number;
  totalFormatted: string;
  rank: number;
  rankLabel: string;
  rankLabelFull: string;
  ability: string;
  abilityLabel: string;
  isLore: boolean;
}

export interface StrikeRow {
  label: string;
  sourceId: string;
  isRanged: boolean;
  isAgile: boolean;
  damageFormula: string;
  critDamageFormula: string;
  damageType: string;
  traits: string[];
  variants: Array<{
    mapPenalty: number;
    total: number;
    totalFormatted: string;
    formula: string;
  }>;
}

/**
 * Rebuild a strike's damage formula with its trailing damage-type word
 * translated to pt-BR (R24 #40.6). The rules engine
 * (systems/pf2e/src/derivations/character.ts — out of scope here, locale-
 * agnostic by design) always renders `damageFormula` as `Nd# [+/-M] <type>`,
 * i.e. the RAW EN `damageType` is always its last token. Since `damageType`
 * is exposed as its own field, the exact trailing occurrence can be stripped
 * and swapped for translateDamageType()'s pt-BR word (documentDetails.ts)
 * without ever touching the engine. Falls back to the raw formula unchanged
 * (never throws) if the trailing text doesn't match the expected shape.
 */
export function translatedStrikeDamageFormula(
  strike: Pick<StrikeRow, "damageFormula" | "damageType">,
): string {
  const { damageFormula, damageType } = strike;
  if (!damageType || !damageFormula.endsWith(damageType)) return damageFormula;
  const translated = translateDamageType(damageType, i18n.locale);
  return damageFormula.slice(0, damageFormula.length - damageType.length) + translated;
}

export interface ConditionRow {
  slug: string;
  label: string;
  value?: number;
  /** Item _id in the embedded items array — needed for remove op. */
  itemId: string;
}

/**
 * A Kineticist Elemental Blast row for the sheet (r18-N2c). Rendered on the
 * Main tab next to strikes: attack with MAP variants + a damage button, same
 * affordance as StrikeRow. `element` keys the roll methods (there's one blast
 * per gate element). `damageRoll` is a pure rollable formula (no type text).
 */
export interface ElementalBlastRow {
  element: string;
  label: string;
  damageType: string;
  isRanged: boolean;
  range: number | null;
  damageFormula: string;
  damageRoll: string;
  /** 2-action variant adds CON to damage (status bonus). */
  twoActionDamageBonus: number;
  variants: Array<{
    mapPenalty: number;
    total: number;
    totalFormatted: string;
    formula: string;
  }>;
}

export interface SpellcastingEntryRow {
  entryId: string;
  label: string;
  tradition: string;
  prepared: string;
  ability: string;
  spellDC: number;
  /**
   * Name of the class this entry belongs to, when the server could attribute
   * it (`derived.spellcastingLevels[entryId].classKey`). Undefined for an
   * entry the server declined to attribute — with two casting classes and no
   * `classKey` flag it refuses to guess, and a wrong label is worse than none.
   */
  ownerClassLabel?: string;
  /** Levels in that class — what the entry's slot table is indexed by. */
  ownerClassLevel?: number;
  /** Rank spells from this entry are actually cast at (multiclass variant). */
  effectiveRank?: number;
  /** How much the variant lifted the entry above its class's native rank. */
  rankElevation?: number;
  spellAttack: number;
  spellAttackFormatted: string;
  /** True for focus-spell entries (isFocusPool — REQ-PF2-083); grouped into the "Focus" spellTab. */
  isFocusPool: boolean;
  /** Proficiency rank (0-4, TEML) for this entry's spell DC/attack. */
  proficiencyRank: number;
  proficiencyRankLabel: string;
  slots: Array<{
    rank: number;
    value: number;
    max: number;
    /** True for the rank-0 "slot" (cantrips have no slot consumption). */
    isCantrip: boolean;
    spells: SpellRow[];
  }>;
}

export interface SpellRow {
  id: string;
  name: string;
  level: number;
  hasAttack: boolean;
  castTime: string | null;
  /**
   * Automatic heightening at the rank this surface casts the spell (r16-G3).
   * Present for cantrips (auto → ceil(level/2)) and focus spells (idem); absent
   * (undefined) for grimoire rows, where the row is shown at its own base rank
   * and prepared-slot heightening is computed per-slot via
   * {@link CharacterSheetVM.heightenedSpell}. `null` fields when the spell has
   * no damage/heightening data.
   */
  heightening?: SpellHeighteningView;
  /**
   * True when casting this spell should spend a Focus Point (issue #36).
   * RAW: focus spells cost 1 Focus Point when Cast EXCEPT cantrips, which
   * never cost one — so this is the spell's "focus" trait minus its
   * "cantrip" trait (a cantrip never carries "focus" in spells-core; see
   * `focusSpells` below). Only populated for rows built by `focusSpells`
   * (the Focus tab is the only surface that spends the pool); absent
   * elsewhere, where casting never touches focusPoints.
   */
  costsFocusPoint?: boolean;
}

/**
 * The sheet-facing slice of a spell's heightened state at a given effective
 * rank (r16-G3) — a thin projection of {@link HeightenedSpell} carrying only
 * what the row/roll need, so the component never re-derives the math.
 */
export interface SpellHeighteningView {
  /** Effective casting rank (>= base). */
  effectiveRank: number;
  /** Base rank baseline (system.level, or 1 for cantrips). */
  baseRank: number;
  /** Ranks above base (0 = not heightened). */
  heightenedBy: number;
  /** Combined roll formula at the effective rank, or null when the spell deals no damage. */
  rollFormula: string | null;
  /** Short damage display (e.g. "3d6+2d6 electricity"), or null. */
  damageDisplay: string | null;
  /** True when a fixed heightening changes target/range/area (badge only, no formula change). */
  hasComplexHeightening: boolean;
}

/**
 * How a non-focus spellcasting entry's tab surface should render its ranked
 * slots (issue #37): `"slots"` for a PREPARED caster (Cleric/Druid/Magus/
 * Wizard) — each rank shows `max` numbered slot cards a player prepares a
 * grimoire spell INTO ahead of time, then casts from; `"known-list"` for a
 * SPONTANEOUS caster (Bard/Psychic/Sorcerer) — there is no "preparing" step,
 * the entry's embedded spells already ARE the known repertoire, and each rank
 * just shows how many of its `max` slots remain available to spend on any of
 * them. Also covers `"innate"`, defensively — no live build path creates a
 * non-focus innate entry today (focus-pool innate entries are routed to the
 * separate Focus tab via `isFocusPool`, never through this decision), but an
 * innate caster has no "preparing" step either, so it shares the same surface
 * as spontaneous rather than falling through to the prepared-slot UI.
 */
export type SpellSurfaceMode = "slots" | "known-list";

export function spellSurfaceModeFor(prepared: string): SpellSurfaceMode {
  return prepared === "prepared" ? "slots" : "known-list";
}

/**
 * A resolver that maps an embedded spell's EN name to its pt-BR display name
 * (T1 r13). Built from the spells-core pack index by the Svelte component
 * (which owns the socket) and threaded into the VM's name-resolving getters so
 * cantrips, grimoire rows, prepared slots, and focus spells all render the
 * translated name — falling back to EN when no pack match exists.
 *
 * The VM stays dependency-free: it never fetches; it only APPLIES a translator
 * the caller passes in. An absent/undefined translator is the identity
 * (everything renders EN), so existing headless tests keep working unchanged.
 */
export type SpellNameTranslator = (enName: string) => string;

/**
 * Resolve an embedded spell (by RAW name — EN or pt-BR — and optional
 * `sourceId`) to the matching spells-core pack spell's `system` object, so the
 * VM can heal scaling data (`heightening`/`damage`/`traits`/`defense`/`level`)
 * the embedded copy lost (r16 verificação viva). Built by the Svelte layer from
 * the pack docs it fetches (it owns the socket); the VM stays fetch-free and
 * only APPLIES the overlay via {@link healSpellSystem}. Absent/undefined = no
 * heal (embedded systems render as-is), so headless tests keep working.
 */
export type SpellHealResolver = (
  rawName: string,
  sourceId?: string | null,
) => Record<string, unknown> | null;

/**
 * Raw (untranslated) view of one embedded `type: "spell"` item on the actor,
 * keyed by its `_id` (r14-B4). The Spells tab uses this to open a spell's
 * details popup when the player clicks its name: `name` is the join key against
 * the spells-core pack index (RAW EN/pt-BR as stored, never a display value),
 * `sourceId` is the original Foundry id (`flags.fusion.sourceId`) kept as a
 * secondary join key, and `item` is the whole embedded record so the popup can
 * fall back to the spell's OWN embedded description when no pack doc matches.
 */
export interface EmbeddedSpellRef {
  /** Raw stored name (EN or pt-BR as copied) — the pack-index join key. */
  name: string;
  /** Original Foundry id from `flags.fusion.sourceId`, when present. */
  sourceId: string | null;
  /** The full embedded spell item (for the no-pack-match description fallback). */
  item: Record<string, unknown>;
}

/**
 * Resolve a clicked spell to the Compendium UUID of its matching spells-core
 * pack document, so the details popup can fetch the full (localized)
 * description (r14-B4). Built by {@link buildSpellDetailsResolver} from the
 * pack index the Spells tab already loads for the name translator.
 *
 * Called with the spell's RAW name (EN or pt-BR) and its optional `sourceId`;
 * returns the pack `uuid` on a match, or `null` when the spell has no pack
 * counterpart (an embedded-only / homebrew spell) — the caller then renders
 * the spell's own embedded description instead. Pure: the VM/component owns the
 * socket; this only maps identifiers to a uuid string.
 */
export type SpellDetailsResolver = (rawName: string, sourceId?: string | null) => string | null;

/**
 * One sub-tab within the Spells tab (DEC-R10-03): a non-focus spellcasting
 * entry gets its own tab (kind "entry"), all focus-pool entries + focus
 * spells collapse into a single "Foco" tab (kind "focus"), and a "Rituais"
 * tab (kind "rituals") appears only when the actor has ritual items.
 */
export interface SpellTabRow {
  key: string;
  label: string;
  kind: "entry" | "focus" | "rituals";
  entries: SpellcastingEntryRow[];
}

export interface DetailsInfo {
  ancestry: string;
  background: string;
  class: string;
  keyAbility: string;
}

export interface InventoryRow {
  id: string;
  name: string;
  subtype: string;
  quantity: number;
  bulk: number | string;
  equipped: boolean;
  img: string | null;
}

// ---------------------------------------------------------------------------
// Op payloads sent to server (type matches server envelope.payload)
// ---------------------------------------------------------------------------

export interface RollCheckPayload {
  type: "roll:check";
  formula: string;
  actorId: string;
  /** Arbitrary data forwarded to the roll engine / chat card. */
  context: Record<string, unknown>;
}

export interface DocUpdatePayload {
  type: "doc:update";
  documentType: string;
  id: string;
  diff: Record<string, unknown>;
  /**
   * When present, `id`/`diff` target an embedded document (e.g. a spell or
   * spellcastingEntry Item nested in this Actor) rather than a top-level
   * document. Semantics mirror DocUpdatePayloadSchema's `updates[].embedded`
   * (packages/shared/src/protocol.ts) as consumed by the server's
   * handleEmbeddedUpdate: the outer `id` (wire `_id`) is the EMBEDDED
   * document's own `_id`, while `embedded.id` is the PARENT document's id
   * (the Actor) — the server loads the parent by `embedded.id` and edits the
   * child `_id` inside its items[]. (Getting this backwards produces
   * "Parent not found: Actor/<itemId>" — found live in r10-C verification.)
   */
  embedded?: { type: string; id: string };
}

/**
 * doc:create op targeting an embedded document (e.g. adding a spell Item to
 * an Actor). `data` is the new document's fields (no `_id` — the server
 * assigns one); `parent` identifies the owning document. Normalized to the
 * wire's `data: [...]` array shape by sendOp's makeSendOpFn.
 */
export interface DocCreateEmbeddedPayload {
  type: "doc:create";
  documentType: string;
  data: Record<string, unknown>;
  parent: { type: string; id: string };
}

/**
 * doc:delete op targeting a single embedded document (e.g. removing a spell
 * Item from an Actor). Normalized to the wire's `ids: [...]` array shape by
 * sendOp's makeSendOpFn.
 */
export interface DocDeleteEmbeddedPayload {
  type: "doc:delete";
  documentType: string;
  id: string;
  parent: { type: string; id: string };
}

/** Union of every doc:* op payload this VM's builders can produce. */
export type DocOpPayload = DocUpdatePayload | DocCreateEmbeddedPayload | DocDeleteEmbeddedPayload;

/**
 * Wire payload for sheet rolls (contract 5, fixed with the server side).
 * Rolls from the sheet go through chat:send so they render as chat cards —
 * NOT roll:check (that type is legacy/unused by this VM going forward).
 * The VM emits "/r <formula> # <flavor>" content; makeSendOpFn splits
 * type/payload for the wire.
 */
export interface ChatRollPayload {
  type: "chat:send";
  content: string;
  worldId: string;
  rollMode: "public";
  speakerActorId: string;
  /**
   * Optional namespaced flags to attach to the resulting ChatMessage
   * (r17-P2 / r18-N1). Whitelisted server-side:
   *   - `pf2e.spellCast` — interactive spell-cast card, present on the cast
   *     announcement; absent on plain rolls (server never trusts the DC, which
   *     is coherence-checked against the caster's derived DC);
   *   - `parentMessageId` — set on the spell-attack roll so it nests under its
   *     announcement (r18-N1); the SpellsTab fills it from the announcement's
   *     ack id.
   * Typed as the shared ChatSendFlags so both paths are covered without a
   * bespoke union.
   */
  flags?: ChatSendFlags;
}

// ---------------------------------------------------------------------------
// CharacterSheetVM
// ---------------------------------------------------------------------------

/**
 * View-model for the PF2e Character Sheet.
 *
 * Constructed with the live document + caller context (ownership, userId).
 * The Svelte component creates a new VM whenever the document changes.
 *
 * The VM is intentionally stateless — each construction is cheap (<1 ms).
 * All computed values are plain getters (no caching needed at this scale).
 */
export class CharacterSheetVM {
  private readonly _doc: Record<string, unknown>;
  private readonly _actorId: string;
  private readonly _ownership: number;
  private readonly _userId: string;
  private readonly _isGm: boolean;
  private readonly _worldId: string;
  /**
   * Optional EN→pt-BR spell-name translator (T1 r13). When present, every
   * embedded spell name the VM surfaces (cantrips, grimoire, prepared slots,
   * focus spells) is passed through it so the sheet shows pt-BR names even
   * when the actor's embedded spell items were copied with EN names. Absent =
   * identity (EN names render as-is). See {@link SpellNameTranslator}.
   */
  private readonly _spellNameTranslator: SpellNameTranslator | undefined;

  /**
   * Optional pack-spell heal resolver (r16 verificação viva). When present,
   * every embedded spell `system` the VM reads is overlaid with the matching
   * pack spell's scaling data via {@link healSpellSystem}, so automatic
   * heightening (r16-G3) works even when the actor's copied spell items lost
   * their `heightening`/`damage`/`traits`. Absent = identity (no heal).
   */
  private readonly _spellHeal: SpellHealResolver | undefined;

  constructor(opts: {
    doc: Record<string, unknown>;
    actorId: string;
    ownership: number;
    userId: string;
    isGm: boolean;
    worldId?: string;
    /** EN→pt-BR spell-name resolver; omitted in headless tests. */
    spellNameTranslator?: SpellNameTranslator;
    /** Pack-spell heal resolver (heightening/damage overlay); omitted in tests. */
    spellHeal?: SpellHealResolver;
  }) {
    this._doc = opts.doc;
    this._actorId = opts.actorId;
    this._ownership = opts.ownership;
    this._userId = opts.userId;
    this._isGm = opts.isGm;
    this._worldId = opts.worldId ?? "";
    this._spellNameTranslator = opts.spellNameTranslator;
    this._spellHeal = opts.spellHeal;
  }

  /**
   * Heal an embedded spell item's `system` with pack data (r16). Reads the
   * item's RAW name + `flags.fusion.sourceId` as the join key into the heal
   * resolver; returns the embedded system untouched when no resolver or no
   * pack match. Centralizes the overlay so every spell read (cantrip rows,
   * focus rows, prepared slots, damage rolls) benefits uniformly.
   */
  private _healSpellSystem(item: Record<string, unknown>): Record<string, unknown> {
    const rawSys = item["system"];
    const embedded =
      typeof rawSys === "object" && rawSys !== null ? (rawSys as Record<string, unknown>) : {};
    if (!this._spellHeal) return embedded;
    const rawName = item["name"];
    const name = typeof rawName === "string" ? rawName : "";
    const flags = item["flags"] as Record<string, unknown> | undefined;
    const fusion = flags?.["fusion"] as Record<string, unknown> | undefined;
    const sourceId = typeof fusion?.["sourceId"] === "string" ? fusion["sourceId"] : null;
    const packSystem = this._spellHeal(name, sourceId);
    return healSpellSystem(embedded, packSystem);
  }

  /**
   * Apply the optional spell-name translator to an EN name (identity when no
   * translator was provided or the input is empty).
   */
  private _translateSpellName(enName: string): string {
    if (!enName || !this._spellNameTranslator) return enName;
    return this._spellNameTranslator(enName);
  }

  // -------------------------------------------------------------------------
  // Permission
  // -------------------------------------------------------------------------

  /** True if this user can edit the sheet (OWNER or GM). */
  get editable(): boolean {
    return this._isGm || this._ownership >= 3; // OwnershipLevel.OWNER = 3
  }

  // -------------------------------------------------------------------------
  // Document accessors
  // -------------------------------------------------------------------------

  get name(): string {
    const raw = this._doc["name"];
    return typeof raw === "string" ? raw : "Unknown Character";
  }

  get img(): string | null {
    const raw = this._doc["img"];
    return typeof raw === "string" ? raw : null;
  }

  private get _system(): Record<string, unknown> {
    return getSystem(this._doc);
  }

  private get _derived(): CharacterDerived | null {
    return getDerived(this._doc);
  }

  // -------------------------------------------------------------------------
  // Basic stats
  // -------------------------------------------------------------------------

  get level(): number {
    const lvl = this._system["level"] as { value: number } | undefined;
    return lvl?.value ?? 1;
  }

  get ancestryLabel(): string {
    const details = this._system["details"] as Record<string, unknown> | undefined;
    const raw = details?.["ancestry"];
    return typeof raw === "string" ? raw : "";
  }

  get classLabel(): string {
    const details = this._system["details"] as Record<string, unknown> | undefined;
    const raw = details?.["class"];
    return typeof raw === "string" ? raw : "";
  }

  /**
   * The character's class trait slug (e.g. "bard"), derived from the
   * embedded `type: "class"` item's name — same source and same
   * lowercase-trim rule planVM's `classSlug` uses for feat eligibility
   * (`nameToSlug(itemName(classItem))`), duplicated locally because this VM
   * is dependency-free by design (see the module doc comment) and planVM
   * already imports FROM this file, so the reverse import would cycle.
   * Undefined when no class item is embedded yet.
   *
   * Used to scope the focus-spell picker to the character's own class
   * (issue #7): spells-core's focus spells carry no `traits.traditions` at
   * all (100% empty), so the class trait on the spell itself is the only
   * signal distinguishing "Bard focus spell" from "Champion focus spell".
   */
  get classTrait(): string | undefined {
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    const classItem = items?.find((item) => item["type"] === "class");
    const name = classItem?.["name"];
    if (typeof name !== "string") return undefined;
    const slug = name.trim().toLowerCase();
    return slug || undefined;
  }

  /**
   * Highest focus-spell rank the character can currently pick from the Focus
   * picker (issue #7). RAW: focus spells are always cast at the highest rank
   * you can cast, equal to half your level rounded up — the same ceil(level/2)
   * rule this VM already applies when auto-heightening a known focus spell
   * (see `focusSpells` / `_heighteningView`). A level-1 character therefore
   * cannot reach a 10th-rank focus spell like Fatal Aria.
   */
  get maxFocusSpellRank(): number {
    return Math.ceil(this.level / 2);
  }

  // -------------------------------------------------------------------------
  // HP
  // -------------------------------------------------------------------------

  get hpCurrent(): number {
    return this._derived?.hp.value ?? this._getAttrHpValue();
  }

  get hpMax(): number {
    return this._derived?.hp.max ?? this._getAttrHpMax();
  }

  get hpTemp(): number {
    return this._derived?.hp.temp ?? 0;
  }

  private _getAttrHpValue(): number {
    const attrs = this._system["attributes"] as Record<string, unknown> | undefined;
    const hp = attrs?.["hp"] as Record<string, unknown> | undefined;
    return Number(hp?.["value"] ?? 0);
  }

  private _getAttrHpMax(): number {
    const attrs = this._system["attributes"] as Record<string, unknown> | undefined;
    const hp = attrs?.["hp"] as Record<string, unknown> | undefined;
    return Number(hp?.["max"] ?? 0);
  }

  // -------------------------------------------------------------------------
  // AC
  // -------------------------------------------------------------------------

  get ac(): number {
    return this._derived?.ac.total ?? this._getFlatAc();
  }

  private _getFlatAc(): number {
    const attrs = this._system["attributes"] as Record<string, unknown> | undefined;
    const ac = attrs?.["ac"] as Record<string, unknown> | undefined;
    return Number(ac?.["value"] ?? 10);
  }

  // -------------------------------------------------------------------------
  // Dying / Wounded / Doomed
  // -------------------------------------------------------------------------

  get dying(): number {
    const attrs = this._system["attributes"] as Record<string, unknown> | undefined;
    const d = attrs?.["dying"] as Record<string, unknown> | undefined;
    return Number(d?.["value"] ?? 0);
  }

  get dyingMax(): number {
    return this._derived?.dyingMax ?? 4;
  }

  get wounded(): number {
    const attrs = this._system["attributes"] as Record<string, unknown> | undefined;
    const w = attrs?.["wounded"] as Record<string, unknown> | undefined;
    return Number(w?.["value"] ?? 0);
  }

  get doomed(): number {
    const attrs = this._system["attributes"] as Record<string, unknown> | undefined;
    const d = attrs?.["doomed"] as Record<string, unknown> | undefined;
    return Number(d?.["value"] ?? 0);
  }

  // -------------------------------------------------------------------------
  // Speed
  // -------------------------------------------------------------------------

  get speed(): number {
    // r16-G1: prefer server-derived land speed (base + land-speed FlatModifiers
    // from feats like Fleet — stepCharSpeed writes system.derived.speed), same
    // derived-first-with-raw-fallback posture as abilityScores (r11). The raw
    // schema stores land speed at system.speed.value (NOT system.attributes.speed
    // — the old path never matched and always fell through to the 25 default).
    const derivedSpeed = this._derived?.speed;
    if (typeof derivedSpeed?.value === "number") return derivedSpeed.value;
    const s = this._system["speed"] as Record<string, unknown> | undefined;
    if (typeof s?.["value"] === "number") return s["value"];
    // Legacy fallback: some hand-authored docs nested it under attributes.
    const attrs = this._system["attributes"] as Record<string, unknown> | undefined;
    const legacy = attrs?.["speed"] as Record<string, unknown> | undefined;
    return Number(legacy?.["value"] ?? 25);
  }

  // -------------------------------------------------------------------------
  // Hero Points
  // -------------------------------------------------------------------------

  get heroPoints(): { value: number; max: number } {
    const res = this._system["resources"] as Record<string, unknown> | undefined;
    const hp = res?.["heroPoints"] as Record<string, unknown> | undefined;
    return { value: Number(hp?.["value"] ?? 0), max: Number(hp?.["max"] ?? 3) };
  }

  // -------------------------------------------------------------------------
  // Focus Points
  // -------------------------------------------------------------------------

  get focusPoints(): { value: number; max: number } {
    const res = this._system["resources"] as Record<string, unknown> | undefined;
    const fp = res?.["focusPoints"] as Record<string, unknown> | undefined;
    return { value: Number(fp?.["value"] ?? 0), max: Number(fp?.["max"] ?? 0) };
  }

  // -------------------------------------------------------------------------
  // Abilities
  // -------------------------------------------------------------------------

  get abilities(): AbilityRow[] {
    const abilities = this._system["abilities"] as
      | Record<string, { value: number; mod?: number }>
      | undefined;

    const abilityMods = this._derived?.abilityMods;
    // r11: build-driven actors have their FINAL scores in derived.abilityScores
    // (the base-phase overwrite from the boosts ledger never persists into the
    // raw doc) — prefer it; raw persisted scores are the manual-entry fallback.
    const derivedScores = (this._derived as { abilityScores?: Record<string, number> } | null)
      ?.abilityScores;

    // Issue #11: build-driven actors NEVER get `system.abilities` persisted —
    // derive-runner.ts only ever writes back `derived.abilityScores`, never
    // the raw field. Bailing out on `!abilities` alone left every build-driven
    // character's ability block empty even though `derivedScores` had the
    // real, final values. Only bail when NEITHER source has data.
    if (!abilities && !derivedScores) return [];

    return Object.entries(ABILITY_LABELS).map(([slug]) => {
      const raw = abilities?.[slug];
      const score = derivedScores?.[slug] ?? raw?.value ?? 10;
      const mod = abilityMods
        ? ((abilityMods as Record<string, number>)[slug] ?? Math.floor((score - 10) / 2))
        : Math.floor((score - 10) / 2);
      return {
        slug,
        label: t(`FUSION.Sheet.Labels.Ability.${slug}`),
        longLabel: t(`FUSION.Sheet.Labels.Ability.${slug}.full`),
        score,
        mod,
        modFormatted: fmtMod(mod),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Perception
  // -------------------------------------------------------------------------

  get perception(): {
    total: number;
    totalFormatted: string;
    dc: number;
    rank: number;
    rankLabel: string;
  } {
    const derived = this._derived;
    if (derived?.perception) {
      return {
        total: derived.perception.total,
        totalFormatted: fmtMod(derived.perception.total),
        dc: derived.perception.dc,
        rank: this._perceptionRank(),
        rankLabel: proficiencyLabel(this._perceptionRank()),
      };
    }
    const rank = this._perceptionRank();
    return { total: 0, totalFormatted: "+0", dc: 10, rank, rankLabel: proficiencyLabel(rank) };
  }

  private _perceptionRank(): number {
    // Issue #38, same contract as skills above: class-granted proficiency is
    // computed on a clone the server never writes back, so `system.perception`
    // can be silent about a rank the character really has. The derived rank
    // wins; the persisted one is the fallback for hand-set (pre-derived) ranks.
    const derivedRank = this._derived?.perception.rank;
    if (derivedRank !== undefined) return derivedRank;
    const perception = this._system["perception"] as Record<string, unknown> | undefined;
    return Number(perception?.["rank"] ?? 0);
  }

  // -------------------------------------------------------------------------
  // Saves
  // -------------------------------------------------------------------------

  // R24 (#40.3): pt-BR save labels via the existing FUSION.Sheet.Labels.Saves.*
  // keys (Fort/Ref/Will short codes, e.g. "Reflexos"). Looked up at
  // getter-call time (same reactivity rationale as the abilities getter above).
  private static readonly SAVE_LABEL_KEYS: Record<"fortitude" | "reflex" | "will", string> = {
    fortitude: "FUSION.Sheet.Labels.Saves.Fort",
    reflex: "FUSION.Sheet.Labels.Saves.Ref",
    will: "FUSION.Sheet.Labels.Saves.Will",
  };

  get saves(): SaveRow[] {
    const derived = this._derived;
    const savesSource = this._system["saves"] as Record<string, { rank?: number }> | undefined;
    const saveNames = ["fortitude", "reflex", "will"] as const;

    return saveNames.map((name) => {
      const derivedSave = derived?.saves[name];
      // Issue #38, same contract as skills and perception: the class trains
      // saves on a clone the server never persists back, so a build-driven
      // character showed "U" next to a total that already carried the trained
      // bonus. Derived rank wins; persisted is the fallback for hand-set ranks.
      const rank = derivedSave?.rank ?? savesSource?.[name]?.rank ?? 0;
      const total = derivedSave?.total ?? 0;
      return {
        slug: name,
        label: t(CharacterSheetVM.SAVE_LABEL_KEYS[name]),
        total,
        totalFormatted: fmtMod(total),
        dc: derivedSave?.dc ?? 10 + total,
        rank,
        rankLabel: proficiencyLabel(rank),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Skills tab
  // -------------------------------------------------------------------------

  /** Canonical skill → ability slug mapping (subset for display). */
  private static readonly SKILL_ABILITY: Record<string, string> = {
    acrobatics: "dex",
    arcana: "int",
    athletics: "str",
    crafting: "int",
    deception: "cha",
    diplomacy: "cha",
    intimidation: "cha",
    medicine: "wis",
    nature: "wis",
    occultism: "int",
    performance: "cha",
    religion: "wis",
    society: "int",
    stealth: "dex",
    survival: "wis",
    thievery: "dex",
  };

  private static readonly SKILL_LABELS: Record<string, string> = {
    acrobatics: "Acrobatics",
    arcana: "Arcana",
    athletics: "Athletics",
    crafting: "Crafting",
    deception: "Deception",
    diplomacy: "Diplomacy",
    intimidation: "Intimidation",
    medicine: "Medicine",
    nature: "Nature",
    occultism: "Occultism",
    performance: "Performance",
    religion: "Religion",
    society: "Society",
    stealth: "Stealth",
    survival: "Survival",
    thievery: "Thievery",
  };

  /**
   * The 16 canonical PF2e skill slugs (REQ-PF2-012). Kept as a local
   * constant — the client package does not depend on systems/pf2e — but
   * MUST stay in sync with SKILL_SLUGS (systems/pf2e/src/types.ts), which is
   * what stepCharSkills (DEC-R10-07) always derives on the server.
   */
  private static readonly CANONICAL_SKILL_SLUGS: readonly string[] = Object.keys(
    CharacterSheetVM.SKILL_LABELS,
  );

  /**
   * Skills tab rows — ALL 16 canonical skills (untrained included, rank 0)
   * plus any lore skills on the document (DEC-R10-07 / feedback item 2:
   * untrained skills are shown and rollable, never hidden).
   *
   * Prefers `derived.skills` (the server now always derives all 16 —
   * fundação R10-A) for rank/total; falls back to merging
   * CANONICAL_SKILL_SLUGS with whatever ranks are on `system.skills` for
   * older/hand-authored docs that predate that guarantee, so untrained
   * skills still render (rank 0) even without derived data.
   *
   * Rows are sorted alphabetically by `label` (design contract's SkillRow
   * ordering) — lore skills sort by their generated "Lore (X)" label.
   */
  get skills(): SkillRow[] {
    const skillsSource =
      (this._system["skills"] as Record<string, { rank?: number; lore?: boolean }> | undefined) ??
      {};
    const derivedSkills: Record<
      string,
      { total: number; dc: number; modifiers: unknown[]; rank?: number }
    > = this._derived?.skills ?? {};

    // Union of canonical slugs + whatever is present on the document (covers
    // lore skills, which have no canonical slug, and any derived-only entry).
    const slugs = new Set<string>(CharacterSheetVM.CANONICAL_SKILL_SLUGS);
    for (const slug of Object.keys(skillsSource)) slugs.add(slug);
    for (const slug of Object.keys(derivedSkills)) slugs.add(slug);

    const rows = Array.from(slugs).map((slug) => {
      const raw = skillsSource[slug];
      const derivedStat = derivedSkills[slug];
      // The derived rank wins: background/class training is computed on a clone
      // the server never writes back, so `system.skills` can be silent about a
      // proficiency the character really has. The persisted rank stays as the
      // fallback — it is the only source for hand-set (pre-derived) ranks.
      const rank = derivedStat?.rank ?? raw?.rank ?? 0;
      // `raw.lore` only exists once the Lore was persisted; a Lore that so far
      // lives only on the derived block is recognised by its slug shape.
      const isLore = raw?.lore === true || isLoreSlug(slug);
      const ability = isLore ? "int" : (CharacterSheetVM.SKILL_ABILITY[slug] ?? "int");
      const total = derivedStat?.total ?? 0;
      const label = isLore ? loreLabel(slug) : (CharacterSheetVM.SKILL_LABELS[slug] ?? slug);

      return {
        slug,
        label,
        total,
        totalFormatted: fmtMod(total),
        rank,
        rankLabel: proficiencyLabel(rank),
        rankLabelFull: proficiencyLabelFull(rank),
        ability,
        abilityLabel: t(`FUSION.Sheet.Labels.Ability.${ability}`),
        isLore,
      };
    });

    return rows.sort((a, b) => a.label.localeCompare(b.label));
  }

  // -------------------------------------------------------------------------
  // Strikes (Actions tab)
  // -------------------------------------------------------------------------

  get strikes(): StrikeRow[] {
    const derivedStrikes = this._derived?.strikes ?? [];

    return derivedStrikes.map((s) => ({
      label: s.label,
      sourceId: s.sourceId,
      isRanged: s.isRanged,
      isAgile: s.isAgile,
      damageFormula: s.damageFormula,
      critDamageFormula: s.critDamageFormula,
      damageType: s.damageType,
      traits: s.traits,
      variants: s.variants.map((v) => ({
        mapPenalty: v.mapPenalty,
        total: v.total,
        totalFormatted: fmtMod(v.total),
        formula: v.formula,
      })),
    }));
  }

  /**
   * Kineticist Elemental Blasts (r18-N2c), one per gate element, derived by
   * stepCharElementalBlasts (r18-N2b). Empty for non-kineticists. Rendered on
   * the Main tab beside strikes.
   */
  get elementalBlasts(): ElementalBlastRow[] {
    const blasts = this._derived?.elementalBlasts ?? [];
    return blasts.map((b) => ({
      element: b.element,
      label: b.label,
      damageType: b.damageType,
      isRanged: b.isRanged,
      range: b.range,
      damageFormula: b.damageFormula,
      damageRoll: b.damageRoll,
      twoActionDamageBonus: b.twoActionDamageBonus,
      variants: b.variants.map((v) => ({
        mapPenalty: v.mapPenalty,
        total: v.total,
        totalFormatted: fmtMod(v.total),
        formula: v.formula,
      })),
    }));
  }

  private _findBlast(element: string): DerivedElementalBlast | undefined {
    return this._derived?.elementalBlasts?.find((b) => b.element === element);
  }

  /**
   * Build a chat:send op for an Elemental Blast attack roll (r18-N2c).
   * Mirrors rollStrike: "/r 1d20+9 # Rajada Elemental (Ar) (MAP 0)".
   */
  rollElementalBlast(element: string, mapIndex: 0 | 1 | 2): ChatRollPayload | null {
    const blast = this._findBlast(element);
    if (!blast) return null;
    const variant = blast.variants[mapIndex];
    const label = t("FUSION.Sheet.Chat.BlastMap", {
      label: this._blastFlavor(element),
      map: mapIndex,
    });
    return this._buildChatRoll(variant.formula.replace(/\s+/g, ""), label);
  }

  /**
   * Build a chat:send op for an Elemental Blast damage roll (r18-N2c).
   * `twoAction` adds the CON status bonus (2-action blast). Flavor pt-BR
   * "Rajada Elemental (Ar) — Dano".
   */
  rollElementalBlastDamage(element: string, twoAction: boolean): ChatRollPayload | null {
    const blast = this._findBlast(element);
    if (!blast) return null;
    const bonus = twoAction && blast.twoActionDamageBonus !== 0 ? blast.twoActionDamageBonus : 0;
    const formula =
      bonus !== 0 ? `${blast.damageRoll}${bonus > 0 ? "+" : ""}${String(bonus)}` : blast.damageRoll;
    const label = t("FUSION.Sheet.Chat.BlastDamage", { label: this._blastFlavor(element) });
    return this._buildChatRoll(formula, label);
  }

  /**
   * Build an Elemental Blast as an interactive Rajada card (r20-X1): an
   * announcement carrying `flags.pf2e.abilityCard` (kind:"impulse", damage from
   * the derived `damageRoll`) PLUS the attack roll for the chosen MAP variant, so
   * attack + (card) damage nest into ONE Rajada card (same chaining as strikes).
   * The 2-action CON-bonus variant stays on the sheet's own damage buttons.
   * Returns null when the blast or its attack variant is unavailable.
   */
  blastCard(
    element: string,
    mapIndex: 0 | 1 | 2,
  ): { announcement: ChatRollPayload; attack: ChatRollPayload } | null {
    const blast = this._findBlast(element);
    if (!blast) return null;
    const attack = this.rollElementalBlast(element, mapIndex);
    if (!attack) return null;

    const cardName = this._blastFlavor(element);
    const card: AbilityCard = {
      kind: "impulse",
      casterActorId: this._actorId,
      name: cardName,
    };
    if (blast.damageRoll) card.damageFormula = blast.damageRoll;
    if (blast.damageType) card.damageType = blast.damageType;

    const content = t("FUSION.Sheet.Chat.BlastMap", { label: cardName, map: mapIndex });
    const announcement: ChatRollPayload = {
      type: "chat:send",
      content,
      worldId: this._worldId,
      rollMode: "public",
      speakerActorId: this._actorId,
      flags: { pf2e: { abilityCard: card } },
    };
    return { announcement, attack };
  }

  /** pt-BR flavor for a blast, e.g. "Rajada Elemental (Ar)". */
  private _blastFlavor(element: string): string {
    const elementLabel = t(`FUSION.Sheet.Plan.KineticGate.Element.${element}`);
    return t("FUSION.Sheet.Chat.BlastFlavor", { element: elementLabel });
  }

  // -------------------------------------------------------------------------
  // Conditions (shared across tabs)
  // -------------------------------------------------------------------------

  get conditions(): ConditionRow[] {
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    if (!items) return [];

    return items
      .filter((item) => item["type"] === "condition")
      .map((item) => {
        const sys =
          typeof item["system"] === "object" && item["system"] !== null
            ? (item["system"] as Record<string, unknown>)
            : {};
        const numValue = typeof sys["value"] === "number" ? sys["value"] : undefined;
        const rawSlug = sys["slug"];
        const rawCondName = item["name"];
        const rawCondId = item["_id"];
        const row: ConditionRow = {
          slug:
            typeof rawSlug === "string"
              ? rawSlug
              : typeof rawCondName === "string"
                ? rawCondName
                : "unknown",
          label: typeof rawCondName === "string" ? rawCondName : "Unknown",
          itemId: typeof rawCondId === "string" ? rawCondId : "",
        };
        if (numValue !== undefined) row.value = numValue;
        return row;
      });
  }

  // -------------------------------------------------------------------------
  // Inventory tab
  // -------------------------------------------------------------------------

  get inventory(): InventoryRow[] {
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    if (!items) return [];

    const inventoryTypes = new Set([
      "weapon",
      "armor",
      "shield",
      "equipment",
      "consumable",
      "treasure",
      "container",
    ]);
    return items
      .filter((item) => {
        const t = item["type"];
        return typeof t === "string" && inventoryTypes.has(t);
      })
      .map((item) => {
        const sys =
          typeof item["system"] === "object" && item["system"] !== null
            ? (item["system"] as Record<string, unknown>)
            : {};
        const rawBulk = sys["bulk"];
        const bulk: number | string =
          typeof rawBulk === "number" ? rawBulk : typeof rawBulk === "string" ? rawBulk : 0;
        const rawId = item["_id"];
        const rawName = item["name"];
        const rawType = item["type"];
        const rawQty = sys["quantity"];
        // Weapons of category "unarmed" always count as equipped (contract 1).
        const category = sys["category"];
        const isUnarmed = rawType === "weapon" && category === "unarmed";
        return {
          id: typeof rawId === "string" ? rawId : "",
          name: typeof rawName === "string" ? rawName : "",
          subtype: typeof rawType === "string" ? rawType : "",
          quantity: typeof rawQty === "number" ? rawQty : 1,
          bulk,
          equipped: isEquippedFlag(sys, isUnarmed),
          img: typeof item["img"] === "string" ? item["img"] : null,
        };
      });
  }

  /**
   * Add a compendium equipment doc (weapon/armor/equipment/consumable/…) to
   * this actor's inventory (r18-N2c — the Inventory tab had no add flow, r8
   * "drag without drop handler"). `itemDoc` is the compendium document from
   * the picker; its `_id` is stripped so the server assigns a fresh one.
   * Items start UNEQUIPPED (the player toggles them on via toggleEquipItem —
   * matches Foundry: dragging Elven Chain into inventory does not auto-don it).
   */
  addInventoryItem(itemDoc: Record<string, unknown>): DocCreateEmbeddedPayload | null {
    if (!this.editable) return null;
    const { _id: _drop, ...rest } = itemDoc;
    return {
      type: "doc:create",
      documentType: "Item",
      data: rest,
      parent: { type: "Actor", id: this._actorId },
    };
  }

  /** Remove an inventory Item from this actor. */
  removeInventoryItem(itemId: string): DocDeleteEmbeddedPayload | null {
    if (!this.editable) return null;
    return {
      type: "doc:delete",
      documentType: "Item",
      id: itemId,
      parent: { type: "Actor", id: this._actorId },
    };
  }

  /**
   * Toggle an inventory item's equipped state (r18-N2c). Writes
   * `system.equipped` as `{ value: boolean }` — the object shape
   * `isEquippedFlag` reads (and the equipment collector on the server, which
   * feeds AC/strikes: donning Elven Chain must flip the derived AC). The
   * update targets the EMBEDDED item; `embedded.id` is the parent Actor's id.
   * Unarmed weapons can't be unequipped and are simply left alone by the UI.
   */
  toggleEquipItem(itemId: string): DocUpdatePayload | null {
    if (!this.editable) return null;
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    const item = items?.find((it) => it["_id"] === itemId);
    if (!item) return null;
    const sys =
      typeof item["system"] === "object" && item["system"] !== null
        ? (item["system"] as Record<string, unknown>)
        : {};
    const currentlyEquipped = isEquippedFlag(sys);
    return {
      type: "doc:update",
      documentType: "Item",
      id: itemId,
      diff: { "system.equipped": { value: !currentlyEquipped } },
      embedded: { type: "Item", id: this._actorId },
    };
  }

  // -------------------------------------------------------------------------
  // Spells tab
  // -------------------------------------------------------------------------

  /**
   * Spellcasting entries (spells tab).
   *
   * Fixes 2 pre-existing bugs (contract 4):
   *  (a) slots were read with key "slot{N}" — the real schema (SpellSlotsMapSchema)
   *      uses keys "0".."10" directly.
   *  (b) spells were pushed into EVERY rank bucket regardless of their own
   *      level — now each spell is grouped by its own system.level (0 = cantrip)
   *      and associated to an entry via the item's root `location` field
   *      (fallback: root `spellcastingEntry` for older docs).
   */
  get spellcastingEntries(): SpellcastingEntryRow[] {
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    if (!items) return [];

    const spellcastingDerived = this._derived?.spellcasting;

    return items
      .filter((item) => item["type"] === "spellcastingEntry")
      .map((entry) => {
        const sys =
          typeof entry["system"] === "object" && entry["system"] !== null
            ? (entry["system"] as Record<string, unknown>)
            : {};
        const rawId = entry["_id"];
        const entryId = typeof rawId === "string" ? rawId : "";
        // SpellcastingEntrySystemSchema wraps these as { value } objects; a
        // flat string is also tolerated for older/hand-authored data.
        const tradition = unwrapStringValue(sys["tradition"], "arcane");
        const prepared = unwrapStringValue(sys["prepared"], "spontaneous");
        const ability = unwrapStringValue(sys["ability"], "int");
        const isFocusPool = sys["isFocusPool"] === true;

        // Spell DC and attack from derived.spellcasting[entryId] (contract 2);
        // fallback to 10/0 when derived data is absent (older doc / pre-migration).
        const derivedEntry = spellcastingDerived?.[entryId];
        const spellDC = derivedEntry?.dc ?? 10;
        // Multiclass: who owns this entry, and at which class level. Comes
        // from the server's own attribution — the client never re-guesses.
        const entryLevels = this._derived?.spellcastingLevels?.[entryId];
        const ownerClassLabel = entryLevels?.classKey
          ? (this._derived?.classDCs ?? []).find((c) => c.classKey === entryLevels.classKey)?.label
          : undefined;
        const spellAttack = derivedEntry?.attack ?? 0;
        // Proficiency rank (0-4, TEML) — prefer derived; fall back to the raw
        // document's system.proficiency.value (SpellcastingEntrySystemSchema).
        const rawProficiency = sys["proficiency"] as Record<string, unknown> | undefined;
        const proficiencyRank =
          derivedEntry?.rank ??
          (typeof rawProficiency?.["value"] === "number" ? rawProficiency["value"] : 0);

        // Slots — contract 4: keys are "0".."10", NOT "slot0".."slot10".
        const slotsRaw = sys["slots"] as
          | Record<string, { value?: number; max?: number }>
          | undefined;

        // Group every spell belonging to this entry by its own system.level.
        const spellsByRank = new Map<number, SpellRow[]>();
        for (const spItem of items) {
          if (spItem["type"] !== "spell") continue;
          // Heal against the pack so heightening/damage/traits are present even
          // when the embedded copy dropped them (r16).
          const spSys = this._healSpellSystem(spItem);
          // Contract 4: location lives on the item ROOT (fallback: root spellcastingEntry).
          const location = spItem["location"] ?? spItem["spellcastingEntry"];
          if (location !== entryId) continue;

          const rawLevel = spSys["level"];
          const spLevel = typeof rawLevel === "number" ? rawLevel : 0;
          const rawSpId = spItem["_id"];
          const rawSpName = spItem["name"];
          const hasAttack = spellSystemHasAttack(spSys);
          const rawCastTime = spSys["castTime"];

          const row: SpellRow = {
            id: typeof rawSpId === "string" ? rawSpId : "",
            name: this._translateSpellName(typeof rawSpName === "string" ? rawSpName : ""),
            level: spLevel,
            hasAttack,
            castTime: typeof rawCastTime === "string" ? rawCastTime : null,
            // Cantrips (level 0) auto-heighten to the highest castable rank
            // (ceil(level/2)); ranked grimoire rows carry no auto-heightening
            // here — prepared-slot scaling is resolved per-slot in the UI via
            // heightenedSpell(). (r16-G3) Key omitted (not set to undefined) for
            // non-cantrips — exactOptionalPropertyTypes forbids explicit undefined.
            ...(spLevel === 0
              ? { heightening: this._heighteningView(spSys, spLevel, "cantrip") }
              : {}),
          };

          const bucket = spellsByRank.get(spLevel);
          if (bucket) bucket.push(row);
          else spellsByRank.set(spLevel, [row]);
        }

        const slots: SpellcastingEntryRow["slots"] = [];
        for (let rank = 0; rank <= 10; rank++) {
          const slot = slotsRaw?.[String(rank)];
          const rankSpells = spellsByRank.get(rank) ?? [];
          // Skip ranks with neither a slot entry nor any spells (nothing to show).
          if (!slot && rankSpells.length === 0) continue;
          if (slot && slot.max === 0 && rank > 0 && rankSpells.length === 0) continue;
          slots.push({
            rank,
            value: slot?.value ?? 0,
            max: slot?.max ?? 0,
            isCantrip: rank === 0,
            spells: rankSpells,
          });
        }

        const rawEntryName = entry["name"];
        return {
          entryId,
          label: typeof rawEntryName === "string" ? rawEntryName : "Spellcasting",
          tradition,
          prepared,
          ability,
          spellDC,
          ...(ownerClassLabel !== undefined ? { ownerClassLabel } : {}),
          ...(entryLevels?.classLevel !== undefined
            ? { ownerClassLevel: entryLevels.classLevel }
            : {}),
          ...(entryLevels?.effectiveRank !== undefined
            ? { effectiveRank: entryLevels.effectiveRank }
            : {}),
          ...(entryLevels?.elevation !== undefined ? { rankElevation: entryLevels.elevation } : {}),
          spellAttack,
          spellAttackFormatted: fmtMod(spellAttack),
          isFocusPool,
          proficiencyRank,
          proficiencyRankLabel: proficiencyLabel(proficiencyRank),
          slots,
        };
      });
  }

  /**
   * Spells tab sub-tabs (DEC-R10-03): one tab per non-focus spellcasting
   * entry, a single "Foco" tab collapsing every focus-pool entry, and a
   * "Rituais" tab that appears ONLY when the actor has at least one item of
   * type "ritual" (REQ-PF2-087 is V2 — hence the conditional tab rather than
   * an always-present empty one).
   *
   * Order: non-focus entries first (in document order), then Focus, then
   * Rituals — matching the design contract's tab bar.
   */
  get spellTabs(): SpellTabRow[] {
    const entries = this.spellcastingEntries;
    const nonFocusEntries = entries.filter((e) => !e.isFocusPool);
    const focusEntries = entries.filter((e) => e.isFocusPool);

    const tabs: SpellTabRow[] = nonFocusEntries.map((entry) => ({
      key: entry.entryId,
      label: entry.label,
      kind: "entry",
      entries: [entry],
    }));

    if (focusEntries.length > 0) {
      tabs.push({
        key: "focus",
        label: "Focus",
        kind: "focus",
        entries: focusEntries,
      });
    }

    if (this._hasRitualItems()) {
      tabs.push({
        key: "rituals",
        label: "Rituals",
        kind: "rituals",
        entries: [],
      });
    }

    return tabs;
  }

  private _hasRitualItems(): boolean {
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    if (!items) return false;
    return items.some((item) => item["type"] === "ritual");
  }

  /**
   * Focus spells to show under the "Foco" tab (DEC-R12-05 / feedback b).
   *
   * The builder currently creates the focus-pool spellcasting entry but never
   * materializes the granted focus spell as an embedded item (grant-item does
   * not execute — a cross-cutting gap outside W3), and even when a focus spell
   * IS embedded its `location` can point at the wrong entry (created before an
   * ability/entry re-sync). So instead of trusting `location`, this getter
   * collects EVERY embedded spell that reads as a focus spell — i.e. carries
   * the "focus" trait — regardless of which entry (if any) it is linked to.
   * This "heal on read" recovers mislinked focus spells for display without
   * mutating the stored doc. Spells already correctly linked to an
   * isFocusPool entry are included too (deduplicated by item id).
   *
   * Returns rows sorted by name; empty when the character has no focus spells
   * embedded yet (the tab then shows only the pool + an "add" affordance).
   */
  get focusSpells(): SpellRow[] {
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    if (!items) return [];

    // Ids of spellcastingEntry items that are focus pools.
    const focusEntryIds = new Set<string>();
    for (const item of items) {
      if (item["type"] !== "spellcastingEntry") continue;
      const sys =
        typeof item["system"] === "object" && item["system"] !== null
          ? (item["system"] as Record<string, unknown>)
          : {};
      if (sys["isFocusPool"] === true) {
        const id = item["_id"];
        if (typeof id === "string") focusEntryIds.add(id);
      }
    }

    const seen = new Set<string>();
    const rows: SpellRow[] = [];
    for (const item of items) {
      if (item["type"] !== "spell") continue;
      // Heal against the pack so the focus trait (embedded copies drop it) and
      // heightening/damage are present (r16).
      const sys = this._healSpellSystem(item);

      const traitsBlock = sys["traits"] as { value?: unknown } | undefined;
      const traits = Array.isArray(traitsBlock?.value) ? (traitsBlock.value as unknown[]) : [];
      const isFocusTrait = traits.includes("focus");
      const location = item["location"] ?? item["spellcastingEntry"];
      const linkedToFocusEntry = typeof location === "string" && focusEntryIds.has(location);

      if (!isFocusTrait && !linkedToFocusEntry) continue;

      const rawId = item["_id"];
      const id = typeof rawId === "string" ? rawId : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const rawName = item["name"];
      const rawLevel = sys["level"];
      const rawCastTime = sys["castTime"];
      const spLevel = typeof rawLevel === "number" ? rawLevel : 0;
      rows.push({
        id,
        name: this._translateSpellName(typeof rawName === "string" ? rawName : ""),
        level: spLevel,
        hasAttack: spellSystemHasAttack(sys),
        castTime: typeof rawCastTime === "string" ? rawCastTime : null,
        // Focus spells auto-heighten to the highest rank you can cast (ceil/2).
        heightening: this._heighteningView(sys, spLevel, "focus"),
        // issue #36: a cantrip never spends a Focus Point, even one collected
        // here by its "composition" trait (issue #6) rather than "focus" —
        // isFocusTrait is already false for those, so this stays correct.
        costsFocusPoint: isFocusTrait,
      });
    }

    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The id of the first focus-pool spellcasting entry, if any (for add-spell wiring). */
  get focusEntryId(): string | null {
    const entry = this.spellcastingEntries.find((e) => e.isFocusPool);
    return entry?.entryId ?? null;
  }

  /**
   * Resolve a prepared-slot spell id to a display name, crossing three
   * embedded-document layers (DEC-R12-05):
   *   1. the spells grouped under the given entry (the common case);
   *   2. spells belonging to ANY spellcasting entry (heightened/mis-located);
   *   3. any embedded `type: "spell"` item on the actor, regardless of
   *      `location` (recovers a spell whose `location` link is stale/wrong).
   *
   * Returns `null` when the id matches no embedded spell item — a DANGLING
   * reference (the spell was removed from the grimoire, or the slot stored a
   * compendium id that was never materialized as an embedded item). Callers
   * MUST render an explicit "spell removed" error state for null (never the
   * raw id) and MAY then try an on-demand compendium fetch (layer 4, which
   * lives in the Svelte component since this VM is dependency-free).
   *
   * An empty/blank id resolves to null as well (unprepared-slot sentinel).
   */
  resolveSpellName(entryId: string, spellItemId: string): string | null {
    if (!spellItemId) return null;

    // Layer 1: within the entry's grouped spells.
    const entry = this.spellcastingEntries.find((e) => e.entryId === entryId);
    if (entry) {
      for (const slot of entry.slots) {
        const hit = slot.spells.find((sp) => sp.id === spellItemId);
        if (hit) return hit.name;
      }
    }

    // Layer 2: across every entry's grouped spells.
    for (const other of this.spellcastingEntries) {
      if (other.entryId === entryId) continue;
      for (const slot of other.slots) {
        const hit = slot.spells.find((sp) => sp.id === spellItemId);
        if (hit) return hit.name;
      }
    }

    // Layer 3: any embedded spell item on the actor (location-agnostic).
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    if (items) {
      for (const item of items) {
        if (item["type"] !== "spell") continue;
        if (item["_id"] !== spellItemId) continue;
        const rawName = item["name"];
        return typeof rawName === "string" ? this._translateSpellName(rawName) : null;
      }
    }

    // Dangling reference — no embedded spell matches this id.
    return null;
  }

  /**
   * Resolve a prepared-slot spell id to its raw cast-time token (r20-X6,
   * feedback: "Faltou adicionar o custo de ações na aba de magias"), mirroring
   * {@link resolveSpellName}'s three-layer lookup so a prepared slot can show
   * the SAME action-cost badge (via the canonical `formatIndexActionCost`
   * helper, r20-X2) as cantrips/grimoire/focus rows — those already carry
   * `SpellRow.castTime` directly.
   *
   * Returns the flattened `system.castTime` token (e.g. "2", "reaction",
   * "free", "1 minute"), healed against the pack for layer 3 so a heal-only
   * cast time still surfaces. `null` when the id matches no embedded spell
   * (dangling reference — caller renders no badge, same as a missing name).
   */
  resolveSpellCastTime(entryId: string, spellItemId: string): string | null {
    if (!spellItemId) return null;

    // Layer 1: within the entry's grouped spells (already healed SpellRows).
    const entry = this.spellcastingEntries.find((e) => e.entryId === entryId);
    if (entry) {
      for (const slot of entry.slots) {
        const hit = slot.spells.find((sp) => sp.id === spellItemId);
        if (hit) return hit.castTime;
      }
    }

    // Layer 2: across every entry's grouped spells.
    for (const other of this.spellcastingEntries) {
      if (other.entryId === entryId) continue;
      for (const slot of other.slots) {
        const hit = slot.spells.find((sp) => sp.id === spellItemId);
        if (hit) return hit.castTime;
      }
    }

    // Layer 3: any embedded spell item on the actor (location-agnostic),
    // healed against the pack so a pack-only time.value still surfaces.
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    if (items) {
      for (const item of items) {
        if (item["type"] !== "spell") continue;
        if (item["_id"] !== spellItemId) continue;
        const sys = this._healSpellSystem(item);
        const rawCastTime = sys["castTime"];
        return typeof rawCastTime === "string" ? rawCastTime : null;
      }
    }

    // Dangling reference — no embedded spell matches this id.
    return null;
  }

  // -------------------------------------------------------------------------
  // Spell heightening (r16-G3) — automatic level scaling on the sheet
  // -------------------------------------------------------------------------

  /**
   * Read an embedded spell item's `system` object by item id (or null), HEALED
   * against the pack (r16) so heightening/damage are present even when the
   * embedded copy dropped them.
   */
  private _readSpellSystem(spellItemId: string): Record<string, unknown> | null {
    if (!spellItemId) return null;
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    if (!items) return null;
    for (const item of items) {
      if (item["type"] !== "spell" || item["_id"] !== spellItemId) continue;
      return this._healSpellSystem(item);
    }
    return null;
  }

  /**
   * Project a spell's `system` + surface into the sheet-facing heightening view
   * at the effective rank for that surface. Pure delegation to the
   * spellHeightening helper — the VM only supplies the actor level.
   */
  private _heighteningView(
    spellSystem: Record<string, unknown>,
    baseRank: number,
    surface: SpellSurface,
    slotRank?: number,
  ): SpellHeighteningView {
    const eff = effectiveSpellRank(surface, this.level, baseRank, slotRank);
    return CharacterSheetVM._toHeighteningView(computeHeightenedSpell(spellSystem, baseRank, eff));
  }

  private static _toHeighteningView(h: HeightenedSpell): SpellHeighteningView {
    return {
      effectiveRank: h.effectiveRank,
      baseRank: h.baseRank,
      heightenedBy: h.heightenedBy,
      rollFormula: h.rollFormula,
      damageDisplay: h.damageDisplay,
      hasComplexHeightening: h.hasComplexHeightening,
    };
  }

  /**
   * Heightened view of an embedded spell for a given casting surface (r16-G3).
   * The Spells tab calls this for PREPARED slots (surface "prepared", passing
   * the slot's rank) — cantrip/focus rows already carry their view on the
   * SpellRow. Returns null when the id matches no embedded spell.
   */
  heightenedSpell(
    spellItemId: string,
    surface: SpellSurface,
    slotRank?: number,
  ): SpellHeighteningView | null {
    const sys = this._readSpellSystem(spellItemId);
    if (!sys) return null;
    const rawLevel = sys["level"];
    const baseRank = typeof rawLevel === "number" ? rawLevel : 0;
    return this._heighteningView(sys, baseRank, surface, slotRank);
  }

  /**
   * Build a chat:send op for a spell's DAMAGE roll at its effective rank
   * (r16-G3). Reads the embedded spell's damage/heightening, applies the
   * heightening for `surface`/`slotRank`, and emits "/r <formula> # <flavor>"
   * where the flavor names the spell and its effective rank in pt-BR
   * ("Ignição (nível 2)"). Returns null when the spell has no rollable damage
   * (non-damage spell, or a complex-only heightening) so the UI hides the button.
   */
  rollSpellDamage(
    spellItemId: string,
    surface: SpellSurface,
    slotRank?: number,
  ): ChatRollPayload | null {
    const sys = this._readSpellSystem(spellItemId);
    if (!sys) return null;
    const rawLevel = sys["level"];
    const baseRank = typeof rawLevel === "number" ? rawLevel : 0;
    const eff = effectiveSpellRank(surface, this.level, baseRank, slotRank);
    const heightened = computeHeightenedSpell(sys, baseRank, eff);
    if (!heightened.rollFormula) return null;

    const spellName = this._embeddedSpellDisplayName(spellItemId);
    const label =
      heightened.effectiveRank > heightened.baseRank
        ? t("FUSION.Sheet.Chat.SpellDamageHeightened", {
            name: spellName,
            rank: String(heightened.effectiveRank),
          })
        : t("FUSION.Sheet.Chat.SpellDamage", { name: spellName });
    return this._buildChatRoll(heightened.rollFormula, label);
  }

  /**
   * Build the chat card(s) for CASTING a spell (r16 verificação viva). Returns:
   *   - `announcement`: a plain-text chat:send (speaker = this actor) naming the
   *     spell in pt-BR, its effective rank, the action-cost glyphs (◆/◆◆/…), and
   *     — for save spells — the DC + save ("CD 19, Reflexos básico"). Display
   *     only; no roll.
   *   - `attack`: the spell-attack roll (via {@link rollSpellAttack}) when the
   *     spell carries the "attack" trait, else null — so one "Lançar" click both
   *     announces and rolls the attack. Damage stays on the separate Dano button.
   *
   * `entryId` locates the spell's spellcasting entry for the DC/attack lookup.
   * Returns null only when the spell id resolves to no embedded spell.
   */
  castSpell(
    spellItemId: string,
    entryId: string,
    surface: SpellSurface,
    slotRank?: number,
  ): { announcement: ChatRollPayload; attack: ChatRollPayload | null } | null {
    const sys = this._readSpellSystem(spellItemId);
    if (!sys) return null;

    const rawLevel = sys["level"];
    const baseRank = typeof rawLevel === "number" ? rawLevel : 0;
    const eff = effectiveSpellRank(surface, this.level, baseRank, slotRank);

    const name = this._embeddedSpellDisplayName(spellItemId);
    const glyphs = spellActionGlyphs(sys);
    const heightened = eff > Math.max(1, baseRank);
    const base = heightened
      ? t("FUSION.Sheet.Chat.SpellCastHeightened", { name, rank: String(eff) })
      : t("FUSION.Sheet.Chat.SpellCast", { name });

    // Save line (display only) for spells that call for a save.
    const saveLine = this._spellSaveLine(sys, entryId);
    const parts = [base];
    if (glyphs) parts.push(glyphs);
    if (saveLine) parts.push(`(${saveLine})`);
    const content = parts.join(" ");

    // Build the structured interactive card (r17-P2). The announcement text
    // stays for old clients; new clients render buttons from this flag.
    const card = this._buildSpellCastCard(sys, entryId, eff, glyphs, name, spellItemId);

    const announcement: ChatRollPayload = {
      type: "chat:send",
      content,
      worldId: this._worldId,
      rollMode: "public",
      speakerActorId: this._actorId,
      flags: { pf2e: { abilityCard: card } },
    };

    const attack = spellSystemHasAttack(sys) ? this.rollSpellAttack(entryId) : null;
    return { announcement, attack };
  }

  /**
   * Assemble the {@link AbilityCard} payload for the interactive spell-cast chat
   * card (r20-X1, generalized from r17-P2). Populates save (statistic/DC/basic
   * from `system.defense` + derived DC) and damage (ALREADY heightened to `eff`
   * via the heightening helper — never re-derived on the client render) so the
   * card's buttons ("Fazer teste de resistência" / "Rolar dano") have everything
   * they need.
   *
   * `dcValue`/`saveType`/`basicSave` are present only for save spells;
   * `damageFormula`/`damageType` only when the heightened spell deals damage.
   * The server re-validates this shape and never trusts the DC.
   */
  private _buildSpellCastCard(
    sys: Record<string, unknown>,
    entryId: string,
    eff: number,
    glyphs: string,
    displayName: string,
    spellItemId: string,
  ): AbilityCard {
    const card: AbilityCard = {
      kind: "spell",
      casterActorId: this._actorId,
      name: displayName,
      rank: eff,
    };
    if (glyphs) card.actionCost = glyphs;

    // Raw EN name (pack join key) — the untranslated stored name, when present.
    const enName = this._rawSpellName(spellItemId);
    if (enName && enName !== displayName) card.nameEn = enName;

    // Save (statistic + DC + basic) from the healed defense block.
    const defense = sys["defense"] as Record<string, unknown> | undefined;
    const save = defense?.["save"] as Record<string, unknown> | undefined;
    const statistic = typeof save?.["statistic"] === "string" ? save["statistic"] : "";
    if (statistic === "fortitude" || statistic === "reflex" || statistic === "will") {
      card.saveType = statistic satisfies SpellSaveType;
      card.dcValue = this._derived?.spellcasting?.[entryId]?.dc ?? 10;
      if (save?.["basic"] === true) card.basicSave = true;
    }

    // Damage — heightened to `eff` (r16-G3). Reuse the same helper the sheet row
    // uses so the formula matches the Dano button exactly.
    const rawLevel = sys["level"];
    const baseRank = typeof rawLevel === "number" ? rawLevel : 0;
    const heightened = computeHeightenedSpell(sys, baseRank, eff);
    if (heightened.rollFormula) {
      card.damageFormula = heightened.rollFormula;
      const dmgType = this._primaryDamageType(sys);
      if (dmgType) card.damageType = dmgType;
    }

    // Traits (display only).
    const traitsBlock = sys["traits"] as { value?: unknown } | undefined;
    if (Array.isArray(traitsBlock?.value)) {
      const traits = (traitsBlock.value as unknown[]).filter(
        (v): v is string => typeof v === "string",
      );
      if (traits.length > 0) card.traits = traits;
    }

    return card;
  }

  /** Raw (untranslated) stored name of an embedded spell item by id, or "". */
  private _rawSpellName(spellItemId: string): string {
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    if (!items) return "";
    for (const item of items) {
      if (item["type"] !== "spell" || item["_id"] !== spellItemId) continue;
      const raw = item["name"];
      return typeof raw === "string" ? raw : "";
    }
    return "";
  }

  /**
   * The primary damage type of a spell's `system.damage` map (first entry with
   * a `type`). Used only for the card badge; the roll formula itself already
   * carries the numbers (r17-P2).
   */
  private _primaryDamageType(sys: Record<string, unknown>): string | null {
    const damage = sys["damage"];
    if (!damage || typeof damage !== "object") return null;
    for (const entry of Object.values(damage as Record<string, unknown>)) {
      if (entry && typeof entry === "object") {
        const type = (entry as Record<string, unknown>)["type"];
        if (typeof type === "string" && type.length > 0) return type;
      }
    }
    return null;
  }

  /**
   * Build the "CD <dc>, <save>[ básico]" fragment for a spell that calls for a
   * save (reads the healed `system.defense.save`), or null when the spell has
   * no save. The DC comes from derived.spellcasting[entryId].dc.
   */
  private _spellSaveLine(sys: Record<string, unknown>, entryId: string): string | null {
    const defense = sys["defense"] as Record<string, unknown> | undefined;
    const save = defense?.["save"] as Record<string, unknown> | undefined;
    const statistic = typeof save?.["statistic"] === "string" ? save["statistic"] : "";
    if (!statistic) return null;
    const dc = this._derived?.spellcasting?.[entryId]?.dc ?? 10;
    const saveName = t(`FUSION.Sheet.Chat.SaveName.${statistic}`);
    const basic = save?.["basic"] === true ? t("FUSION.Sheet.Chat.SpellCastSaveBasic") : "";
    return t("FUSION.Sheet.Chat.SpellCastSave", { dc: String(dc), save: saveName, basic });
  }

  /** Translated display name of an embedded spell item by id (fallback: generic). */
  private _embeddedSpellDisplayName(spellItemId: string): string {
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    if (items) {
      for (const item of items) {
        if (item["type"] !== "spell" || item["_id"] !== spellItemId) continue;
        const raw = item["name"];
        if (typeof raw === "string" && raw.length > 0) return this._translateSpellName(raw);
      }
    }
    return t("FUSION.Sheet.Chat.SpellDamage.fallback");
  }

  /**
   * Distinct EN names of every embedded `type: "spell"` item on the actor
   * (T1 r13). The Svelte component uses this to know which names to resolve
   * against the spells-core pack index when building the spell-name
   * translator — so it only looks up names the sheet will actually show.
   *
   * Returns the RAW stored names (never translated) — this is the join key
   * against the pack index's EN `name`, not a display value.
   */
  get embeddedSpellNames(): string[] {
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    if (!items) return [];
    const seen = new Set<string>();
    for (const item of items) {
      if (item["type"] !== "spell") continue;
      const raw = item["name"];
      if (typeof raw === "string" && raw.length > 0) seen.add(raw);
    }
    return Array.from(seen);
  }

  /**
   * Lookup of every embedded `type: "spell"` item on the actor keyed by its
   * `_id` (r14-B4). The Spells tab uses it to resolve a clicked spell's details
   * popup: from the row's item id it recovers the RAW name (pack-index join
   * key), the `flags.fusion.sourceId` (secondary join key), and the whole
   * embedded item (description fallback when the spell has no pack counterpart).
   *
   * Names/ids are read RAW (never routed through the translator) — the value is
   * a resolution key, not a display string. Returns a fresh Map each read (the
   * VM is stateless by design); the component builds it once per doc snapshot.
   */
  get embeddedSpellById(): Map<string, EmbeddedSpellRef> {
    const map = new Map<string, EmbeddedSpellRef>();
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    if (!items) return map;
    for (const item of items) {
      if (item["type"] !== "spell") continue;
      const rawId = item["_id"];
      if (typeof rawId !== "string" || rawId.length === 0) continue;
      const rawName = item["name"];
      const flags =
        typeof item["flags"] === "object" && item["flags"] !== null
          ? (item["flags"] as Record<string, unknown>)
          : {};
      const fusionFlags =
        typeof flags["fusion"] === "object" && flags["fusion"] !== null
          ? (flags["fusion"] as Record<string, unknown>)
          : {};
      const sourceIdRaw = fusionFlags["sourceId"];
      map.set(rawId, {
        name: typeof rawName === "string" ? rawName : "",
        sourceId: typeof sourceIdRaw === "string" && sourceIdRaw.length > 0 ? sourceIdRaw : null,
        item,
      });
    }
    return map;
  }

  // -------------------------------------------------------------------------
  // Bio tab
  // -------------------------------------------------------------------------

  get biography(): string {
    const details = this._system["details"] as Record<string, unknown> | undefined;
    const raw = details?.["biography"];
    return typeof raw === "string" ? raw : "";
  }

  get detailsInfo(): DetailsInfo {
    const details = this._system["details"] as Record<string, unknown> | undefined;
    const rawAncestry = details?.["ancestry"];
    const rawBackground = details?.["background"];
    const rawClass = details?.["class"];
    const rawKeyAbility = details?.["keyAbility"];
    return {
      ancestry: typeof rawAncestry === "string" ? rawAncestry : "",
      background: typeof rawBackground === "string" ? rawBackground : "",
      class: typeof rawClass === "string" ? rawClass : "",
      keyAbility: typeof rawKeyAbility === "string" ? rawKeyAbility : "",
    };
  }

  // -------------------------------------------------------------------------
  // Class DC (main tab summary)
  // -------------------------------------------------------------------------

  get classDC(): { total: number; dc: number } {
    const derived = this._derived?.classDC;
    return { total: derived?.total ?? 0, dc: derived?.dc ?? 10 };
  }

  /**
   * Class DCs granted by archetype/multiclass dedications (DEC-R12-04),
   * separate from the base-class classDC. Empty array when the character has
   * none or the doc predates r12 (absent `derived.archetypeClassDCs`).
   */
  get archetypeClassDCs(): ArchetypeClassDC[] {
    return this._derived?.archetypeClassDCs ?? [];
  }

  /**
   * One class DC per class the character has (REQ-MCL-022).
   *
   * Single-class sheets get a one-entry array; the sheet only surfaces the
   * per-class strip when there is more than one, so nothing changes for a
   * character that never touched the variant.
   */
  get classDCs(): ClassDCEntry[] {
    return this._derived?.classDCs ?? [];
  }

  /** Levels per class, best-first — the "Guerreiro 3 / Magus 3" strip. */
  get classLevelSummary(): Array<{ label: string; classLevel: number; dc: number }> {
    return this.classDCs.map((entry) => ({
      label: entry.label,
      classLevel: entry.classLevel,
      dc: entry.dc,
    }));
  }

  // -------------------------------------------------------------------------
  // Senses (main tab summary)
  // -------------------------------------------------------------------------

  get senses(): string[] {
    const perception = this._system["perception"] as Record<string, unknown> | undefined;
    const raw = perception?.["senses"];
    if (!Array.isArray(raw)) return [];
    return raw
      .map((s) => {
        if (typeof s === "string") return s;
        if (typeof s === "object" && s !== null) {
          const type = (s as Record<string, unknown>)["type"];
          return typeof type === "string" ? type : null;
        }
        return null;
      })
      .filter((s): s is string => s !== null);
  }

  // -------------------------------------------------------------------------
  // Op builders — called by Svelte component to build sendOp payloads
  // -------------------------------------------------------------------------

  /**
   * Format a "1d20+N" / "1d20-N" roll formula part with a correct sign —
   * NEVER "1d20+-1" for negative totals.
   */
  private static _fmtRollFormula(base: string, total: number): string {
    return total >= 0 ? `${base}+${String(total)}` : `${base}${String(total)}`;
  }

  /**
   * Build a chat:send op (contract 5) for a skill check.
   * "/r 1d20+9 # Acrobacia" (pt-BR flavor via skillNamePt — R14 gap #15)
   */
  rollSkill(skillSlug: string): ChatRollPayload {
    const skillStat = this._derived?.skills[skillSlug];
    const total = skillStat?.total ?? 0;
    const label = skillNamePt(skillSlug);
    return this._buildChatRoll(CharacterSheetVM._fmtRollFormula("1d20", total), label);
  }

  /**
   * Build a chat:send op for a saving throw.
   * "/r 1d20+11 # Salvaguarda de Fortitude" (pt-BR flavor — R14 gap #15)
   */
  rollSave(saveName: "fortitude" | "reflex" | "will"): ChatRollPayload {
    const derivedSave = this._derived?.saves[saveName];
    const total = derivedSave?.total ?? 0;
    const label = t(`FUSION.Sheet.Chat.SaveFlavor.${saveName}`);
    return this._buildChatRoll(CharacterSheetVM._fmtRollFormula("1d20", total), label);
  }

  /**
   * Build a chat:send op for Perception.
   * "/r 1d20+8 # Percepção" (pt-BR flavor — R14 gap #15)
   */
  rollPerception(): ChatRollPayload {
    const total = this._derived?.perception.total ?? 0;
    const label = t("FUSION.Sheet.Chat.Perception");
    return this._buildChatRoll(CharacterSheetVM._fmtRollFormula("1d20", total), label);
  }

  /**
   * Build a chat:send op for a strike (attack roll).
   * "/r 1d20+13 # Longsword (MAP 0)" — strike name stays as authored on the
   * item (often EN, from pack content); "MAP" stays a technical term
   * (R14 gap #15 — untranslated by design).
   * @param strikeSourceId  The sourceId from the StrikeRow.
   * @param mapIndex        0 = first attack, 1 = second, 2 = third.
   */
  rollStrike(strikeSourceId: string, mapIndex: 0 | 1 | 2): ChatRollPayload {
    const strike = this._derived?.strikes.find((s) => s.sourceId === strikeSourceId);
    if (!strike) {
      const label = t("FUSION.Sheet.Chat.StrikeMap", { label: "Strike", map: mapIndex });
      return this._buildChatRoll("1d20", label);
    }
    const variant = strike.variants[mapIndex];
    const label = t("FUSION.Sheet.Chat.StrikeMap", { label: strike.label, map: mapIndex });
    // variant.formula is already a full "1d20 + N" style formula from derived
    // data — reuse it verbatim as the roll formula.
    return this._buildChatRoll(variant.formula.replace(/\s+/g, ""), label);
  }

  /**
   * Build a chat:send op for a strike's damage roll (new — contract 3).
   * Returns null when the derived strike lacks damageRoll/critDamageRoll
   * (older/pre-migration data) so the component can hide the button.
   * Flavor suffix is pt-BR ("Dano" / "Crítico" — R14 gap #15); the formula
   * itself is untouched.
   */
  rollStrikeDamage(strikeSourceId: string, crit: boolean): ChatRollPayload | null {
    const strike = this._derived?.strikes.find((s) => s.sourceId === strikeSourceId);
    if (!strike) return null;
    const formula = crit ? strike.critDamageRoll : strike.damageRoll;
    if (!formula) return null;
    const label = t(crit ? "FUSION.Sheet.Chat.StrikeCritical" : "FUSION.Sheet.Chat.StrikeDamage", {
      label: strike.label,
    });
    return this._buildChatRoll(formula, label);
  }

  /**
   * Build a strike as an interactive AbilityCard (r20-X1): an announcement
   * carrying `flags.pf2e.abilityCard` (kind:"strike", damage + crit from the
   * derived rollable formulas) PLUS the attack roll for the chosen MAP variant.
   * The caller sends the announcement, awaits its id, then fires the attack with
   * `parentMessageId` so the attack nests under the card and the card's
   * "Rolar dano" / "Rolar dano crítico" buttons roll INTO the same card. The MAP
   * variant is chosen on the sheet (unchanged) — no crit automation is invented.
   * Returns null when the derived strike is unavailable.
   */
  strikeCard(
    strikeSourceId: string,
    mapIndex: 0 | 1 | 2,
  ): { announcement: ChatRollPayload; attack: ChatRollPayload } | null {
    const strike = this._derived?.strikes.find((s) => s.sourceId === strikeSourceId);
    if (!strike) return null;
    const attack = this.rollStrike(strikeSourceId, mapIndex);

    const card: AbilityCard = {
      kind: "strike",
      casterActorId: this._actorId,
      name: strike.label,
    };
    if (strike.damageRoll) card.damageFormula = strike.damageRoll;
    if (strike.critDamageRoll) card.critDamageFormula = strike.critDamageRoll;
    if (strike.damageType) card.damageType = strike.damageType;
    if (strike.traits.length > 0) card.traits = [...strike.traits];

    const content = t("FUSION.Sheet.Chat.StrikeMap", { label: strike.label, map: mapIndex });
    const announcement: ChatRollPayload = {
      type: "chat:send",
      content,
      worldId: this._worldId,
      rollMode: "public",
      speakerActorId: this._actorId,
      flags: { pf2e: { abilityCard: card } },
    };
    return { announcement, attack };
  }

  /**
   * Build a chat:send op for a spell attack roll (new).
   * Returns null when derived.spellcasting[entryId] is unavailable.
   * "/r 1d20+9 # Ataque de Magia (Magias Arcanas)" (pt-BR flavor — R14 gap #15;
   * the entry name itself is whatever the actor's document already has).
   */
  rollSpellAttack(entryId: string): ChatRollPayload | null {
    const derivedEntry = this._derived?.spellcasting?.[entryId];
    if (!derivedEntry) return null;
    const entry = this.spellcastingEntries.find((e) => e.entryId === entryId);
    const entryLabel = entry?.label ?? t("FUSION.Sheet.Chat.SpellAttack.fallback");
    const label = t("FUSION.Sheet.Chat.SpellAttack", { entry: entryLabel });
    return this._buildChatRoll(
      CharacterSheetVM._fmtRollFormula("1d20", derivedEntry.attack),
      label,
    );
  }

  /** Build the wire chat:send payload: "/r <formula> # <flavor>". */
  private _buildChatRoll(formula: string, flavor: string): ChatRollPayload {
    return {
      type: "chat:send",
      content: `/r ${formula} # ${flavor}`,
      worldId: this._worldId,
      rollMode: "public",
      speakerActorId: this._actorId,
    };
  }

  /**
   * Build a doc:update op to toggle a condition on the actor.
   * Adds the condition as an embedded item if not present; removes if present.
   */
  toggleCondition(conditionSlug: string): DocUpdatePayload | null {
    if (!this.editable) return null;

    // Check if condition already active — delegate actual toggle to server
    // via embedded item CRUD (the server handles the IWR immune check).
    // Here we just produce the diff that signals the intent.
    const existing = this.conditions.find((c) => c.slug === conditionSlug);
    if (existing) {
      // Remove — mark item as deleted via a special diff flag
      return {
        type: "doc:update",
        documentType: "Actor",
        id: this._actorId,
        diff: {
          [`items.-${existing.itemId}`]: true,
        },
      };
    }

    // Add — signal to server to create an embedded condition item
    return {
      type: "doc:update",
      documentType: "Actor",
      id: this._actorId,
      diff: {
        "items.+": {
          type: "condition",
          name: conditionSlug,
          system: { slug: conditionSlug, value: null },
        },
      },
    };
  }

  /**
   * Build a doc:update op for an HP change (damage / heal).
   * Positive delta = heal; negative = damage.
   */
  applyHpDelta(delta: number): DocUpdatePayload | null {
    if (!this.editable) return null;
    const newHp = Math.max(0, Math.min(this.hpCurrent + delta, this.hpMax));
    return {
      type: "doc:update",
      documentType: "Actor",
      id: this._actorId,
      diff: { "system.attributes.hp.value": newHp },
    };
  }

  /**
   * Build a doc:update op to set a field value (autosave binding).
   * @param path  Dot-path relative to the document root (e.g. "system.attributes.hp.value").
   * @param value  New value.
   */
  fieldUpdate(path: string, value: unknown): DocUpdatePayload | null {
    if (!this.editable) return null;
    return {
      type: "doc:update",
      documentType: "Actor",
      id: this._actorId,
      diff: { [path]: value },
    };
  }

  // -------------------------------------------------------------------------
  // Hero / Focus points setters (clickable pips — REQ-UIF-023)
  // -------------------------------------------------------------------------

  /** Set Hero Points to an explicit value, clamped to [0, max]. */
  setHeroPoints(n: number): DocUpdatePayload | null {
    if (!this.editable) return null;
    const clamped = Math.max(0, Math.min(n, this.heroPoints.max));
    return this.fieldUpdate("system.resources.heroPoints.value", clamped);
  }

  /**
   * Set Focus Points to an explicit value, clamped to [0, min(3, max)].
   * The upper bound of 3 (REQ-PF2-083, DEC-R10-02) is enforced HERE in
   * addition to the schema/derivation clamp, so a stale/unclamped
   * `focusPoints.max` on an older document can never push the pip UI (or
   * this setter) past 3.
   */
  setFocusPoints(n: number): DocUpdatePayload | null {
    if (!this.editable) return null;
    const cappedMax = Math.min(3, this.focusPoints.max);
    const clamped = Math.max(0, Math.min(n, cappedMax));
    return this.fieldUpdate("system.resources.focusPoints.value", clamped);
  }

  // -------------------------------------------------------------------------
  // Edit-mode field helpers (REQ-UIF-023) — typed wrappers over fieldUpdate
  // -------------------------------------------------------------------------

  updateName(value: string): DocUpdatePayload | null {
    return this.fieldUpdate("name", value);
  }

  updateAbilityScore(slug: string, value: number): DocUpdatePayload | null {
    return this.fieldUpdate(`system.abilities.${slug}.value`, value);
  }

  updateSkillRank(slug: string, rank: number): DocUpdatePayload | null {
    return this.fieldUpdate(`system.skills.${slug}.rank`, rank);
  }

  updateSaveRank(name: "fortitude" | "reflex" | "will", rank: number): DocUpdatePayload | null {
    return this.fieldUpdate(`system.saves.${name}.rank`, rank);
  }

  updatePerceptionRank(rank: number): DocUpdatePayload | null {
    return this.fieldUpdate("system.perception.rank", rank);
  }

  updateHpMax(value: number): DocUpdatePayload | null {
    return this.fieldUpdate("system.attributes.hp.max", value);
  }

  updateSpeed(value: number): DocUpdatePayload | null {
    return this.fieldUpdate("system.attributes.speed.value", value);
  }

  /**
   * Level lives in two places on the document (system.level.value and
   * system.details.level) — update both in the SAME diff so they never
   * drift apart.
   */
  updateLevel(value: number): DocUpdatePayload | null {
    if (!this.editable) return null;
    return {
      type: "doc:update",
      documentType: "Actor",
      id: this._actorId,
      diff: {
        "system.level.value": value,
        "system.details.level": value,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Spell management ops (DEC-R10-04) — add/remove/prepare/expend
  // -------------------------------------------------------------------------

  /**
   * Add a compendium spell doc to a spellcasting entry.
   * Builds a doc:create op for an embedded Item on this Actor — `spellDoc`
   * is the compendium document (e.g. from compendium:get's `document`
   * field); its `_id` is stripped (the server assigns a fresh one) and
   * `location` is set to `entryId` so spellcastingEntries/spellTabs group it
   * correctly.
   */
  addSpellToEntry(
    entryId: string,
    spellDoc: Record<string, unknown>,
  ): DocCreateEmbeddedPayload | null {
    if (!this.editable) return null;
    // issue #8 (RAW): a focus spell only ever occupies a focus-pool
    // spellcastingEntry, and a non-focus spell never occupies one — the
    // prepared/spontaneous grimoire and the focus pool are never
    // interchangeable in PF2e core rules. Concrete case that surfaced this:
    // Cleric's domain spell (trait "focus") landing in the prepared "divine
    // Spells" grimoire (isFocusPool false), because before issue #5 the
    // Cleric had no focus entry to receive it at all. Reject silently
    // (return null) instead of materializing the invalid combination — same
    // posture as the `!this.editable` guard above. Only enforced when the
    // target entry actually exists on this actor; an unresolved/unknown
    // entryId falls through unchecked, matching pre-existing behavior.
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    const entry = items?.find((it) => it["_id"] === entryId && it["type"] === "spellcastingEntry");
    if (entry) {
      const entrySystem = entry["system"];
      const entryIsFocusPool =
        typeof entrySystem === "object" &&
        entrySystem !== null &&
        (entrySystem as Record<string, unknown>)["isFocusPool"] === true;
      if (docHasFocusTrait(spellDoc) !== entryIsFocusPool) return null;
    }
    const { _id: _drop, ...rest } = spellDoc;
    return {
      type: "doc:create",
      documentType: "Item",
      data: { ...rest, location: entryId },
      parent: { type: "Actor", id: this._actorId },
    };
  }

  /**
   * Remove a spell Item from this actor (e.g. dropping a spell from an
   * entry's repertoire).
   */
  removeSpell(spellItemId: string): DocDeleteEmbeddedPayload | null {
    if (!this.editable) return null;
    return {
      type: "doc:delete",
      documentType: "Item",
      id: spellItemId,
      parent: { type: "Actor", id: this._actorId },
    };
  }

  /**
   * Prepare a spell into a specific slot (prepared casters — DEC-R10-04).
   * Builds a doc:update op targeting the spellcastingEntry ITEM (embedded),
   * diffing `system.slots.<rank>.prepared[<slotIndex>]`.
   *
   * The slot element MUST be a `{ id, expended }` object (PreparedSpellSchema,
   * systems/pf2e/src/schema-primitives.ts) — NOT a bare spell-item-id string.
   * The server re-validates the diff-applied spellcastingEntry Item against
   * this schema (doc-handlers.ts handleEmbeddedUpdate →
   * validateEmbeddedItemForSystem), so a bare string would be rejected with
   * VALIDATION_FAILED.
   */
  prepareSpell(
    entryId: string,
    rank: number,
    slotIndex: number,
    spellItemId: string,
  ): DocUpdatePayload | null {
    if (!this.editable) return null;
    return {
      type: "doc:update",
      documentType: "Item",
      id: entryId,
      embedded: { type: "Item", id: this._actorId },
      diff: {
        [`system.slots.${String(rank)}.prepared`]: this._preparedArrayWith(
          entryId,
          rank,
          slotIndex,
          {
            id: spellItemId,
            expended: false,
          },
        ),
      },
    };
  }

  /**
   * Clear a prepared slot (the inverse of prepareSpell).
   *
   * Sets the slot element to `{ id: "", expended: false }` rather than `null`
   * — PreparedSpellSchema's array elements are non-nullable objects (see
   * prepareSpell's doc comment), so a literal `null` here would fail the
   * server's post-diff Zod re-validation. An empty `id` is this VM's "slot is
   * unprepared" sentinel; isSlotPrepared()/the UI treat a falsy id as empty.
   */
  unprepareSlot(entryId: string, rank: number, slotIndex: number): DocUpdatePayload | null {
    if (!this.editable) return null;
    return {
      type: "doc:update",
      documentType: "Item",
      id: entryId,
      embedded: { type: "Item", id: this._actorId },
      diff: {
        [`system.slots.${String(rank)}.prepared`]: this._preparedArrayWith(
          entryId,
          rank,
          slotIndex,
          {
            id: "",
            expended: false,
          },
        ),
      },
    };
  }

  /**
   * Toggle a prepared slot's expended state (spent this slot for the day).
   * Diffs `system.slots.<rank>.prepared[<slotIndex>].expended`.
   */
  toggleSlotExpended(entryId: string, rank: number, slotIndex: number): DocUpdatePayload | null {
    if (!this.editable) return null;
    const current = this.getPreparedSlot(entryId, rank, slotIndex);
    return {
      type: "doc:update",
      documentType: "Item",
      id: entryId,
      embedded: { type: "Item", id: this._actorId },
      diff: {
        [`system.slots.${String(rank)}.prepared`]: this._preparedArrayWith(
          entryId,
          rank,
          slotIndex,
          {
            id: current?.id ?? "",
            expended: !(current?.expended ?? false),
          },
        ),
      },
    };
  }

  /**
   * Clone this entry's `system.slots.<rank>.prepared` array, pad it with the
   * `{id:"",expended:false}` empty sentinel up to `slotIndex`, and replace
   * the element at `slotIndex` with `element`.
   *
   * The prepare/unprepare/toggle diffs send the whole ARRAY under
   * `system.slots.<rank>.prepared` (never a `prepared.<index>` path): the
   * server's diff applier treats numeric path segments as object keys, so an
   * index path would morph the array into `{"0": {...}}` and fail the
   * post-diff Zod re-validation with "Expected array, received object"
   * (found live in r10-C verification).
   */
  private _preparedArrayWith(
    entryId: string,
    rank: number,
    slotIndex: number,
    element: { id: string; expended: boolean },
  ): Array<{ id: string; expended: boolean }> {
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    const entryItem = items?.find((i) => i["_id"] === entryId);
    const sys =
      typeof entryItem?.["system"] === "object" && entryItem["system"] !== null
        ? (entryItem["system"] as Record<string, unknown>)
        : {};
    const slots = sys["slots"] as Record<string, { prepared?: unknown[] }> | undefined;
    const rawPrepared = slots?.[String(rank)]?.prepared;
    const next: Array<{ id: string; expended: boolean }> = Array.isArray(rawPrepared)
      ? rawPrepared.map((e) => {
          const el = (typeof e === "object" && e !== null ? e : {}) as Record<string, unknown>;
          return {
            id: typeof el["id"] === "string" ? el["id"] : "",
            expended: el["expended"] === true,
          };
        })
      : [];
    while (next.length <= slotIndex) next.push({ id: "", expended: false });
    next[slotIndex] = element;
    return next;
  }

  /** Read whether a prepared slot is currently expended (raw document read, not derived). */
  private _isSlotExpended(entryId: string, rank: number, slotIndex: number): boolean {
    return this.getPreparedSlot(entryId, rank, slotIndex)?.expended ?? false;
  }

  /**
   * Read the raw prepared-slot entry (spell item id + expended flag) for a
   * given spellcastingEntry/rank/slotIndex — the UI-facing counterpart of
   * `_isSlotExpended`, exposed so SpellsTab can render "prepared" (has a
   * non-empty id) vs "empty" (no entry, or unprepareSlot's `{id: ""}`
   * sentinel — see unprepareSlot's doc comment) vs "expended" slot states.
   * Reads the raw document, NOT `derived` (prepared-slot state isn't part of
   * CharacterDerived).
   */
  getPreparedSlot(
    entryId: string,
    rank: number,
    slotIndex: number,
  ): { id: string; expended: boolean } | null {
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    const entryItem = items?.find((i) => i["_id"] === entryId);
    const sys =
      typeof entryItem?.["system"] === "object" && entryItem["system"] !== null
        ? (entryItem["system"] as Record<string, unknown>)
        : {};
    const slots = sys["slots"] as Record<string, { prepared?: unknown[] }> | undefined;
    const prepared = slots?.[String(rank)]?.prepared;
    const slotEntry = Array.isArray(prepared) ? prepared[slotIndex] : undefined;
    if (typeof slotEntry === "object" && slotEntry !== null) {
      const e = slotEntry as Record<string, unknown>;
      return {
        id: typeof e["id"] === "string" ? e["id"] : "",
        expended: e["expended"] === true,
      };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Rest (Descansar — feedback item: recovering expended spell slots)
  // -------------------------------------------------------------------------

  /**
   * Build the ops for a full "Rest" action (Pathbuilder-style header button):
   * for every spellcasting entry, clear `expended` on every prepared slot
   * (across every rank) via a whole-array doc:update diff (same
   * `_preparedArrayWith`-shaped array the prepare/unprepare/toggle ops use —
   * arrays are never diffed by index, per r10-C lesson), plus a
   * `focusPoints.value = max` update.
   *
   * Only entries/ranks that actually have at least one expended slot (or a
   * focus-point deficit) produce an op — resting with nothing to recover
   * returns an empty array so callers can skip the "nothing changed" no-op
   * network round-trip.
   *
   * Restores HP per the remaster night's-rest rule: Constitution modifier ×
   * level, minimum 1 × level (a 0-or-negative CON mod still heals level HP),
   * clamped to max HP (r16 verificação viva). Uses the DERIVED CON mod (r11
   * build-driven scores) and the doc's level. Emits a `chat:send` summary card
   * (speaker = the actor) so the player sees what was recovered.
   */
  restAll(): Array<DocOpPayload | ChatRollPayload> {
    if (!this.editable) return [];
    const ops: Array<DocOpPayload | ChatRollPayload> = [];

    // --- HP recovery (CON mod × level, min 1 × level, clamp to max) ---------
    const hpBefore = this.hpCurrent;
    const hpRecovered = this.restHpRecovery();
    if (hpRecovered > 0) {
      const newHp = Math.min(hpBefore + hpRecovered, this.hpMax);
      if (newHp !== hpBefore) {
        ops.push({
          type: "doc:update",
          documentType: "Actor",
          id: this._actorId,
          diff: { "system.attributes.hp.value": newHp },
        });
      }
    }

    for (const entry of this.spellcastingEntries) {
      for (const slot of entry.slots) {
        if (slot.isCantrip) continue;
        const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
        const entryItem = items?.find((i) => i["_id"] === entry.entryId);
        const sys =
          typeof entryItem?.["system"] === "object" && entryItem["system"] !== null
            ? (entryItem["system"] as Record<string, unknown>)
            : {};
        const slots = sys["slots"] as Record<string, { prepared?: unknown[] }> | undefined;
        const rawPrepared = slots?.[String(slot.rank)]?.prepared;
        if (!Array.isArray(rawPrepared) || rawPrepared.length === 0) continue;

        const hasExpended = rawPrepared.some(
          (e) =>
            typeof e === "object" &&
            e !== null &&
            (e as Record<string, unknown>)["expended"] === true,
        );
        if (!hasExpended) continue;

        const restedPrepared = rawPrepared.map((e) => {
          const el = (typeof e === "object" && e !== null ? e : {}) as Record<string, unknown>;
          return {
            id: typeof el["id"] === "string" ? el["id"] : "",
            expended: false,
          };
        });

        ops.push({
          type: "doc:update",
          documentType: "Item",
          id: entry.entryId,
          embedded: { type: "Item", id: this._actorId },
          diff: {
            [`system.slots.${String(slot.rank)}.prepared`]: restedPrepared,
          },
        });
      }
    }

    if (this.focusPoints.value < this.focusPoints.max) {
      const op = this.setFocusPoints(this.focusPoints.max);
      if (op) ops.push(op);
    }

    // --- Rest summary card (chat) — only when something actually happened ----
    const actuallyRecovered = Math.min(hpRecovered, Math.max(0, this.hpMax - hpBefore));
    if (ops.length > 0) {
      ops.push(this._buildRestSummary(actuallyRecovered));
    }

    return ops;
  }

  /** The actor's derived Constitution modifier (r11 build-driven scores). */
  private _conMod(): number {
    const con = this.abilities.find((a) => a.slug === "con");
    return con?.mod ?? 0;
  }

  /**
   * HP recovered by a night's rest (remaster): CON modifier × level, but at
   * least 1 × level (a 0-or-negative CON mod still heals level HP). Never
   * exceeds the HP actually missing (so a full-HP actor recovers 0).
   */
  restHpRecovery(): number {
    const level = Math.max(1, this.level);
    const perLevel = Math.max(1, this._conMod());
    const potential = perLevel * level;
    const missing = Math.max(0, this.hpMax - this.hpCurrent);
    return Math.min(potential, missing);
  }

  /**
   * Build the rest-summary chat card: "Tobias descansou: +6 HP, magias e foco
   * restaurados" (plain-text chat:send, speaker = the actor). `hpRecovered` is
   * the HP actually restored (0 when already full — the card then omits the HP
   * clause).
   */
  private _buildRestSummary(hpRecovered: number): ChatRollPayload {
    const content =
      hpRecovered > 0
        ? t("FUSION.Sheet.Rest.SummaryHp", { name: this.name, hp: String(hpRecovered) })
        : t("FUSION.Sheet.Rest.Summary", { name: this.name });
    return {
      type: "chat:send",
      content,
      worldId: this._worldId,
      rollMode: "public",
      speakerActorId: this._actorId,
    };
  }
}

// ---------------------------------------------------------------------------
// Spell picker helpers (DEC-R10-04) — pure, client-side filtering for the
// compendium spell picker. Operate on PackIndexEntry-shaped objects (the
// compendium:search index result) so they're testable without a socket.
// ---------------------------------------------------------------------------

/** Minimal shape the picker needs from a compendium spell index entry. */
export interface SpellPickerEntry {
  name: string;
  /**
   * Denormalized pt-BR name for bilingual search (T1). Mirrors
   * PackIndexEntry.namePt — present only when a translation overlay exists.
   */
  namePt?: string | undefined;
  /** Extra index fields keyed by JSON path (PackIndexEntry.index), e.g. "system.level.value". */
  index: Record<string, unknown>;
}

export interface SpellPickerFilters {
  /** Maximum spell rank/level to include (inclusive). Omit for no cap. */
  maxRank?: number;
  /** Restrict to spells whose traditions include this value (e.g. "arcane"). */
  tradition?: string;
  /**
   * Restrict to spells belonging to this class trait slug (e.g. "bard") —
   * issue #7. Focus spells carry no `traditions` at all (spells-core: 458/458
   * empty), so tradition filtering cannot scope the focus picker to the
   * character's class; the class trait on the spell itself is the only
   * signal. An entry with NO known class trait at all (shared/general focus
   * spells, e.g. domain/archetype grants — 85/458 in spells-core) always
   * passes, mirroring planVM's `isFeatEligible` classFeat rule: only an
   * entry tagged for a DIFFERENT class is excluded.
   */
  classTrait?: string;
  /** Case-insensitive substring match against the spell name. */
  search?: string;
}

/**
 * Known class trait slugs (mirrors planVM.ts's `KNOWN_CLASS_TRAITS` — kept in
 * sync by hand, same pattern as `SKILL_ABILITY`/`CANONICAL_SKILL_SLUGS`
 * between these two files; planVM already imports FROM this module, so the
 * reverse import would cycle). Distinguishes "this spell belongs to a
 * DIFFERENT class" from "this is a shared/general focus spell" in
 * `filterSpellPicker`'s `classTrait` filter (issue #7).
 */
const KNOWN_CLASS_TRAITS = new Set([
  "magus",
  "alchemist",
  "barbarian",
  "bard",
  "champion",
  "cleric",
  "druid",
  "fighter",
  "gunslinger",
  "inventor",
  "investigator",
  "kineticist",
  "monk",
  "oracle",
  "ranger",
  "rogue",
  "sorcerer",
  "summoner",
  "swashbuckler",
  "witch",
  "wizard",
]);

function pickerSpellLevel(entry: SpellPickerEntry): number {
  // The "spell" item schema stores level as a flat number at system.level
  // (NOT a { value } wrapper) — the spells-core pack manifest indexes it
  // under the exact key "system.level" (see systems/pf2e/packs/spells-core/
  // pack.json indexFields + packages/server/src/compendium/service.ts
  // _buildIndexFromDocuments, which extracts via dot-path verbatim).
  const raw = entry.index["system.level"];
  return typeof raw === "number" ? raw : 0;
}

function pickerSpellTraditions(entry: SpellPickerEntry): string[] {
  const raw = entry.index["system.traits.traditions"];
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === "string");
  return [];
}

/** The full trait list (system.traits.value) of a picker entry. */
function pickerSpellTraits(entry: SpellPickerEntry): string[] {
  const raw = entry.index["system.traits.value"];
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === "string");
  return [];
}

/**
 * Does an entry's trait list satisfy the picker's `classTrait` filter (issue
 * #7)? An entry with no KNOWN class trait at all is always eligible (shared
 * focus spell); an entry tagged for a class is eligible only when that class
 * matches. Mirrors planVM's `isFeatEligible` classFeat rule verbatim.
 */
function matchesClassTrait(traits: string[], classTrait: string): boolean {
  const looksClassTagged = traits.some((t) => KNOWN_CLASS_TRAITS.has(t));
  return !looksClassTagged || traits.includes(classTrait);
}

/**
 * Does an entry's trait list satisfy a single picker trait-chip filter
 * (issue #6)? A plain membership check, EXCEPT the "focus" chip also accepts
 * "composition": PF2e's Bard composition CANTRIPS (Allegro, Courageous
 * Anthem, Dirge of Doom, House of Imaginary Walls, Rallying Anthem, Silver's
 * Refrain, Song of Marching, Song of Strength, Triple Time, Uplifting
 * Overture — 10/20 compositions in spells-core) correctly omit the "focus"
 * trait, because RAW cantrips never cost a Focus Point — but they belong
 * next to the composition spells that DO cost one when browsing the Focus
 * tab's picker. This widens the DISPLAY match only; it never adds "focus" to
 * the underlying data, which stays the source of truth `costsFocusPoint`
 * reads from (see `SpellRow.costsFocusPoint`, issue #36).
 */
export function matchesTraitFilter(traits: string[], filter: string): boolean {
  if (traits.includes(filter)) return true;
  if (filter === "focus" && traits.includes("composition")) return true;
  return false;
}

/**
 * Normalize a string for case- and diacritics-insensitive matching:
 * NFD-decompose, strip combining marks, lowercase. Local copy (this module is
 * dependency-free by design — see the file docstring); semantics match
 * normalizeSearchText in packages/shared/src/compendium.ts (REQ-CMP-013).
 */
function normalizePickerText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Test whether an entry's EN name OR its pt-BR namePt contains the (already
 * normalized) search term. Bilingual (T1): the user can type either language.
 */
function pickerNameMatches(entry: SpellPickerEntry, searchNorm: string): boolean {
  if (normalizePickerText(entry.name).includes(searchNorm)) return true;
  if (entry.namePt !== undefined && normalizePickerText(entry.namePt).includes(searchNorm)) {
    return true;
  }
  return false;
}

/**
 * Build an EN→pt-BR spell-name translator from spells-core pack index entries
 * (T1 r13). Each entry carries an EN `name` and, when a translation overlay
 * exists, a denormalized `namePt` (see PackIndexEntry). The translator maps an
 * embedded spell's stored name (usually EN, but tolerant of pt-BR-copied data)
 * to its pt-BR display name; names with no matching pack entry — or no
 * `namePt` — return unchanged (EN fallback).
 *
 * Matching is accent/case-insensitive on BOTH sides, so it resolves regardless
 * of whether the actor's embedded item name was copied in EN ("Sure Strike")
 * or already in pt-BR ("Golpe Certeiro"): the index is keyed by BOTH the
 * normalized EN name and the normalized pt-BR name, both pointing at the
 * pt-BR display name. Later entries never clobber earlier ones for a given
 * key (first write wins) — deterministic given a stable index order.
 *
 * Pure and dependency-free (the caller — SpellsTab — owns the socket that
 * loads the index and threads the result into the VM via
 * `spellNameTranslator`).
 */
export function buildSpellNameTranslator(entries: SpellPickerEntry[]): SpellNameTranslator {
  const map = new Map<string, string>();
  for (const entry of entries) {
    const pt = entry.namePt;
    if (pt === undefined || pt.length === 0) continue;
    const enKey = normalizePickerText(entry.name);
    const ptKey = normalizePickerText(pt);
    if (enKey && !map.has(enKey)) map.set(enKey, pt);
    if (ptKey && !map.has(ptKey)) map.set(ptKey, pt);
  }
  return (enName: string): string => {
    if (!enName) return enName;
    return map.get(normalizePickerText(enName)) ?? enName;
  };
}

/**
 * A pack index entry carrying enough to resolve a details-panel doc: the
 * Compendium `uuid` plus the EN `name` and optional pt-BR `namePt` join keys
 * (r14-B4). Structural superset of {@link SpellPickerEntry} — the spells-core
 * `searchPack` result (PackIndexEntry[]) satisfies it directly. `index` is
 * optional and carries the `flags.fusion.sourceId` join, which the pack index
 * DOES publish since issue #41 — `buildSpellDetailsResolver` below already uses
 * it. (This comment used to say the index did not carry sourceId; that stopped
 * being true with #41, and the stale claim outlived the fact in three places.)
 */
export interface SpellDetailsIndexEntry {
  uuid: string;
  name: string;
  namePt?: string | undefined;
  index?: Record<string, unknown> | undefined;
}

/**
 * Build a resolver from spells-core pack index entries that maps a clicked
 * spell (by its RAW name — EN or pt-BR — and optional `sourceId`) to the pack
 * document's Compendium UUID (r14-B4). The Spells tab feeds the returned uuid
 * to `getDocument` to render the full localized description in the details
 * popup; a `null` result means the spell has no pack counterpart and the popup
 * shows its embedded description instead.
 *
 * Matching mirrors {@link buildSpellNameTranslator}: the name index is keyed by
 * BOTH the normalized EN name and the normalized pt-BR name (accent/case
 * insensitive), so a spell copied in either language still resolves. A
 * `sourceId` index is also built when entries expose `flags.fusion.sourceId`
 * (via the optional `index` bag) — a stronger key than name when present.
 * First write wins per key (deterministic given a stable index order).
 */
export function buildSpellDetailsResolver(entries: SpellDetailsIndexEntry[]): SpellDetailsResolver {
  const byName = new Map<string, string>();
  const bySourceId = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.uuid) continue;
    const enKey = normalizePickerText(entry.name);
    if (enKey && !byName.has(enKey)) byName.set(enKey, entry.uuid);
    if (entry.namePt !== undefined && entry.namePt.length > 0) {
      const ptKey = normalizePickerText(entry.namePt);
      if (ptKey && !byName.has(ptKey)) byName.set(ptKey, entry.uuid);
    }
    const sourceId = entry.index?.["flags.fusion.sourceId"];
    if (typeof sourceId === "string" && sourceId.length > 0 && !bySourceId.has(sourceId)) {
      bySourceId.set(sourceId, entry.uuid);
    }
  }
  return (rawName: string, sourceId?: string | null): string | null => {
    if (sourceId) {
      const bySrc = bySourceId.get(sourceId);
      if (bySrc) return bySrc;
    }
    if (!rawName) return null;
    return byName.get(normalizePickerText(rawName)) ?? null;
  };
}

/**
 * Filter a compendium spell index by rank ceiling, tradition, and a name
 * search substring. Every filter is optional and combines with AND.
 * The name search is case- AND accent-insensitive on both sides ("revelacao"
 * matches "Revelação" and vice versa) and BILINGUAL — it matches the EN name
 * or the pt-BR namePt overlay, so a pt-BR user can search in either language.
 */
export function filterSpellPicker<T extends SpellPickerEntry>(
  entries: T[],
  filters: SpellPickerFilters,
): T[] {
  const rawSearch = filters.search?.trim();
  const searchNorm = rawSearch ? normalizePickerText(rawSearch) : undefined;
  return entries.filter((entry) => {
    if (filters.maxRank !== undefined && pickerSpellLevel(entry) > filters.maxRank) return false;
    if (filters.tradition !== undefined) {
      const traditions = pickerSpellTraditions(entry);
      if (!traditions.includes(filters.tradition)) return false;
    }
    if (filters.classTrait !== undefined) {
      if (!matchesClassTrait(pickerSpellTraits(entry), filters.classTrait)) return false;
    }
    if (searchNorm && !pickerNameMatches(entry, searchNorm)) return false;
    return true;
  });
}

/**
 * Sort picker entries for display: rank ascending, then name ascending
 * (case/diacritics-insensitive). Returns a NEW array — does not mutate.
 * The picker always shows results in this order (design decision: the list
 * must be scannable on open, before any search is typed).
 */
export function sortSpellPickerEntries<T extends SpellPickerEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const rankDiff = pickerSpellLevel(a) - pickerSpellLevel(b);
    if (rankDiff !== 0) return rankDiff;
    return normalizePickerText(a.name).localeCompare(normalizePickerText(b.name));
  });
}

/**
 * Resolve the picker's INITIAL tradition filter so the list is never empty on
 * open (root-cause fix: a tradition mismatch — wrong casing, unknown value,
 * or an index where no entry carries that tradition — used to zero the whole
 * list with no way to recover in the UI).
 *
 * Returns `tradition` when at least one entry matches it; otherwise null
 * (= no tradition filter, show everything). Also returns null for an
 * empty/blank tradition.
 */
export function resolveInitialTradition(
  entries: SpellPickerEntry[],
  tradition: string | undefined,
): string | null {
  const t = tradition?.trim();
  if (!t) return null;
  const hasMatch = entries.some((e) => pickerSpellTraditions(e).includes(t));
  return hasMatch ? t : null;
}
