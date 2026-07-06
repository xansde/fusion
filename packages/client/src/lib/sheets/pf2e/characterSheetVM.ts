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
  ArchetypeClassDC,
} from "./derivedTypes.js";

// ---------------------------------------------------------------------------
// Re-export derived types for consumers
// ---------------------------------------------------------------------------

export type { CharacterDerived, DerivedStatistic, DerivedStrike, ArchetypeClassDC };

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

// ---------------------------------------------------------------------------
// Ability names
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
  | "inventory"
  | "feats"
  | "bio";

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

export interface ConditionRow {
  slug: string;
  label: string;
  value?: number;
  /** Item _id in the embedded items array — needed for remove op. */
  itemId: string;
}

export interface SpellcastingEntryRow {
  entryId: string;
  label: string;
  tradition: string;
  prepared: string;
  ability: string;
  spellDC: number;
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

export interface FeatRow {
  id: string;
  name: string;
  subtype: string;
  level: number | null;
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

  constructor(opts: {
    doc: Record<string, unknown>;
    actorId: string;
    ownership: number;
    userId: string;
    isGm: boolean;
    worldId?: string;
    /** EN→pt-BR spell-name resolver; omitted in headless tests. */
    spellNameTranslator?: SpellNameTranslator;
  }) {
    this._doc = opts.doc;
    this._actorId = opts.actorId;
    this._ownership = opts.ownership;
    this._userId = opts.userId;
    this._isGm = opts.isGm;
    this._worldId = opts.worldId ?? "";
    this._spellNameTranslator = opts.spellNameTranslator;
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
    const attrs = this._system["attributes"] as Record<string, unknown> | undefined;
    const s = attrs?.["speed"] as Record<string, unknown> | undefined;
    return Number(s?.["value"] ?? 25);
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
    if (!abilities) return [];

    const abilityMods = this._derived?.abilityMods;
    // r11: build-driven actors have their FINAL scores in derived.abilityScores
    // (the base-phase overwrite from the boosts ledger never persists into the
    // raw doc) — prefer it; raw persisted scores are the manual-entry fallback.
    const derivedScores = (this._derived as { abilityScores?: Record<string, number> } | null)
      ?.abilityScores;

    return Object.entries(ABILITY_LABELS).map(([slug, label]) => {
      const raw = abilities[slug];
      const score = derivedScores?.[slug] ?? raw?.value ?? 10;
      const mod = abilityMods
        ? ((abilityMods as Record<string, number>)[slug] ?? Math.floor((score - 10) / 2))
        : Math.floor((score - 10) / 2);
      return {
        slug,
        label,
        longLabel: ABILITY_LONG_LABELS[slug] ?? slug,
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
    const perception = this._system["perception"] as Record<string, unknown> | undefined;
    return Number(perception?.["rank"] ?? 0);
  }

  // -------------------------------------------------------------------------
  // Saves
  // -------------------------------------------------------------------------

  get saves(): SaveRow[] {
    const derived = this._derived;
    const savesSource = this._system["saves"] as Record<string, { rank?: number }> | undefined;
    const saveNames = ["fortitude", "reflex", "will"] as const;

    return saveNames.map((name) => {
      const rank = savesSource?.[name]?.rank ?? 0;
      const derivedSave = derived?.saves[name];
      const total = derivedSave?.total ?? 0;
      return {
        slug: name,
        label: name.charAt(0).toUpperCase() + name.slice(1),
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
    const derivedSkills: Record<string, { total: number; dc: number; modifiers: unknown[] }> =
      this._derived?.skills ?? {};

    // Union of canonical slugs + whatever is present on the document (covers
    // lore skills, which have no canonical slug, and any derived-only entry).
    const slugs = new Set<string>(CharacterSheetVM.CANONICAL_SKILL_SLUGS);
    for (const slug of Object.keys(skillsSource)) slugs.add(slug);
    for (const slug of Object.keys(derivedSkills)) slugs.add(slug);

    const rows = Array.from(slugs).map((slug) => {
      const raw = skillsSource[slug];
      const rank = raw?.rank ?? 0;
      const isLore = raw?.lore === true;
      const ability = isLore ? "int" : (CharacterSheetVM.SKILL_ABILITY[slug] ?? "int");
      const derivedStat = derivedSkills[slug];
      const total = derivedStat?.total ?? 0;
      const label = isLore
        ? `Lore (${slug.replace(/^lore-/, "")})`
        : (CharacterSheetVM.SKILL_LABELS[slug] ?? slug);

      return {
        slug,
        label,
        total,
        totalFormatted: fmtMod(total),
        rank,
        rankLabel: proficiencyLabel(rank),
        rankLabelFull: proficiencyLabelFull(rank),
        ability,
        abilityLabel: ABILITY_LABELS[ability] ?? ability.toUpperCase(),
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
        const spellAttack = derivedEntry?.attack ?? 0;
        // Proficiency rank (0-4, TEML) — prefer derived; fall back to the raw
        // document's system.proficiency.value (SpellcastingEntrySystemSchema).
        const rawProficiency = sys["proficiency"] as Record<string, unknown> | undefined;
        const proficiencyRank =
          derivedEntry?.rank ?? (typeof rawProficiency?.["value"] === "number" ? rawProficiency["value"] : 0);

        // Slots — contract 4: keys are "0".."10", NOT "slot0".."slot10".
        const slotsRaw = sys["slots"] as
          | Record<string, { value?: number; max?: number }>
          | undefined;

        // Group every spell belonging to this entry by its own system.level.
        const spellsByRank = new Map<number, SpellRow[]>();
        for (const spItem of items) {
          if (spItem["type"] !== "spell") continue;
          const spSys =
            typeof spItem["system"] === "object" && spItem["system"] !== null
              ? (spItem["system"] as Record<string, unknown>)
              : {};
          // Contract 4: location lives on the item ROOT (fallback: root spellcastingEntry).
          const location = spItem["location"] ?? spItem["spellcastingEntry"];
          if (location !== entryId) continue;

          const rawLevel = spSys["level"];
          const spLevel = typeof rawLevel === "number" ? rawLevel : 0;
          const rawSpId = spItem["_id"];
          const rawSpName = spItem["name"];
          const defense = spSys["defense"] as Record<string, unknown> | undefined;
          const hasAttack = defense?.["spellAttack"] === true;
          const rawCastTime = spSys["castTime"];

          const row: SpellRow = {
            id: typeof rawSpId === "string" ? rawSpId : "",
            name: this._translateSpellName(typeof rawSpName === "string" ? rawSpName : ""),
            level: spLevel,
            hasAttack,
            castTime: typeof rawCastTime === "string" ? rawCastTime : null,
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
      const sys =
        typeof item["system"] === "object" && item["system"] !== null
          ? (item["system"] as Record<string, unknown>)
          : {};

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
      const defense = sys["defense"] as Record<string, unknown> | undefined;
      const rawCastTime = sys["castTime"];
      rows.push({
        id,
        name: this._translateSpellName(typeof rawName === "string" ? rawName : ""),
        level: typeof rawLevel === "number" ? rawLevel : 0,
        hasAttack: defense?.["spellAttack"] === true,
        castTime: typeof rawCastTime === "string" ? rawCastTime : null,
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
  // Feats tab
  // -------------------------------------------------------------------------

  private static readonly FEAT_TYPES = new Set([
    "feat",
    "ancestry",
    "background",
    "class",
    "heritage",
  ]);

  get feats(): FeatRow[] {
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    if (!items) return [];

    return items
      .filter((item) => {
        const t = item["type"];
        return typeof t === "string" && CharacterSheetVM.FEAT_TYPES.has(t);
      })
      .map((item) => {
        const sys =
          typeof item["system"] === "object" && item["system"] !== null
            ? (item["system"] as Record<string, unknown>)
            : {};
        const rawId = item["_id"];
        const rawName = item["name"];
        const rawType = item["type"];
        const rawLevel = sys["level"];
        let level: number | null = null;
        if (typeof rawLevel === "number") {
          level = rawLevel;
        } else if (typeof rawLevel === "object" && rawLevel !== null) {
          const v = (rawLevel as Record<string, unknown>)["value"];
          level = typeof v === "number" ? v : null;
        }
        return {
          id: typeof rawId === "string" ? rawId : "",
          name: typeof rawName === "string" ? rawName : "",
          subtype: typeof rawType === "string" ? rawType : "",
          level,
        };
      });
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
   * "/r 1d20+9 # Acrobatics"
   */
  rollSkill(skillSlug: string): ChatRollPayload {
    const skillStat = this._derived?.skills[skillSlug];
    const total = skillStat?.total ?? 0;
    const label = CharacterSheetVM.SKILL_LABELS[skillSlug] ?? skillSlug;
    return this._buildChatRoll(CharacterSheetVM._fmtRollFormula("1d20", total), label);
  }

  /**
   * Build a chat:send op for a saving throw.
   * "/r 1d20+11 # Fortitude Save"
   */
  rollSave(saveName: "fortitude" | "reflex" | "will"): ChatRollPayload {
    const derivedSave = this._derived?.saves[saveName];
    const total = derivedSave?.total ?? 0;
    const label = saveName.charAt(0).toUpperCase() + saveName.slice(1) + " Save";
    return this._buildChatRoll(CharacterSheetVM._fmtRollFormula("1d20", total), label);
  }

  /**
   * Build a chat:send op for Perception.
   * "/r 1d20+8 # Perception"
   */
  rollPerception(): ChatRollPayload {
    const total = this._derived?.perception.total ?? 0;
    return this._buildChatRoll(CharacterSheetVM._fmtRollFormula("1d20", total), "Perception");
  }

  /**
   * Build a chat:send op for a strike (attack roll).
   * "/r 1d20+13 # Longsword (MAP 0)"
   * @param strikeSourceId  The sourceId from the StrikeRow.
   * @param mapIndex        0 = first attack, 1 = second, 2 = third.
   */
  rollStrike(strikeSourceId: string, mapIndex: 0 | 1 | 2): ChatRollPayload {
    const strike = this._derived?.strikes.find((s) => s.sourceId === strikeSourceId);
    if (!strike) {
      return this._buildChatRoll("1d20", `Strike (MAP ${String(mapIndex)})`);
    }
    const variant = strike.variants[mapIndex];
    const label = `${strike.label} (MAP ${String(mapIndex)})`;
    // variant.formula is already a full "1d20 + N" style formula from derived
    // data — reuse it verbatim as the roll formula.
    return this._buildChatRoll(variant.formula.replace(/\s+/g, ""), label);
  }

  /**
   * Build a chat:send op for a strike's damage roll (new — contract 3).
   * Returns null when the derived strike lacks damageRoll/critDamageRoll
   * (older/pre-migration data) so the component can hide the button.
   */
  rollStrikeDamage(strikeSourceId: string, crit: boolean): ChatRollPayload | null {
    const strike = this._derived?.strikes.find((s) => s.sourceId === strikeSourceId);
    if (!strike) return null;
    const formula = crit ? strike.critDamageRoll : strike.damageRoll;
    if (!formula) return null;
    const label = `${strike.label} — ${crit ? "Critical" : "Damage"}`;
    return this._buildChatRoll(formula, label);
  }

  /**
   * Build a chat:send op for a spell attack roll (new).
   * Returns null when derived.spellcasting[entryId] is unavailable.
   */
  rollSpellAttack(entryId: string): ChatRollPayload | null {
    const derivedEntry = this._derived?.spellcasting?.[entryId];
    if (!derivedEntry) return null;
    const entry = this.spellcastingEntries.find((e) => e.entryId === entryId);
    const label = `Spell Attack (${entry?.label ?? "Spellcasting"})`;
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
        [`system.slots.${String(rank)}.prepared`]: this._preparedArrayWith(entryId, rank, slotIndex, {
          id: spellItemId,
          expended: false,
        }),
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
        [`system.slots.${String(rank)}.prepared`]: this._preparedArrayWith(entryId, rank, slotIndex, {
          id: "",
          expended: false,
        }),
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
        [`system.slots.${String(rank)}.prepared`]: this._preparedArrayWith(entryId, rank, slotIndex, {
          id: current?.id ?? "",
          expended: !(current?.expended ?? false),
        }),
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
   * Deliberately does NOT restore HP — PF2e's rest rules heal
   * Constitution-modifier × level HP per night, which requires the
   * character's CON mod and level and isn't implemented here. Documented as
   * a follow-up (see BUILD-LOG r11); resting only clears spell slots and
   * focus points in this MVP.
   */
  restAll(): DocOpPayload[] {
    if (!this.editable) return [];
    const ops: DocOpPayload[] = [];

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
          (e) => typeof e === "object" && e !== null && (e as Record<string, unknown>)["expended"] === true,
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

    return ops;
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
  /** Case-insensitive substring match against the spell name. */
  search?: string;
}

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

/**
 * Normalize a string for case- and diacritics-insensitive matching:
 * NFD-decompose, strip combining marks, lowercase. Local copy (this module is
 * dependency-free by design — see the file docstring); semantics match
 * normalizeSearchText in packages/shared/src/compendium.ts (REQ-CMP-013).
 */
function normalizePickerText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
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
 * kept optional so a `flags.fusion.sourceId` join can be added later without a
 * signature change (the pack index does not carry sourceId today).
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
export function buildSpellDetailsResolver(
  entries: SpellDetailsIndexEntry[],
): SpellDetailsResolver {
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
