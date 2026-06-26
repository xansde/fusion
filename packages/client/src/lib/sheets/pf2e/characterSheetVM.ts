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

import type { CharacterDerived, DerivedStatistic, DerivedStrike } from "./derivedTypes.js";

// ---------------------------------------------------------------------------
// Re-export derived types for consumers
// ---------------------------------------------------------------------------

export type { CharacterDerived, DerivedStatistic, DerivedStrike };

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

export type CharacterSheetTab = "main" | "skills" | "actions" | "spells" | "inventory";

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
  slots: Array<{
    rank: number;
    value: number;
    max: number;
    spells: Array<{ id: string; name: string; level: number }>;
  }>;
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

  constructor(opts: {
    doc: Record<string, unknown>;
    actorId: string;
    ownership: number;
    userId: string;
    isGm: boolean;
  }) {
    this._doc = opts.doc;
    this._actorId = opts.actorId;
    this._ownership = opts.ownership;
    this._userId = opts.userId;
    this._isGm = opts.isGm;
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

    return Object.entries(ABILITY_LABELS).map(([slug, label]) => {
      const raw = abilities[slug];
      const score = raw?.value ?? 10;
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

  get skills(): SkillRow[] {
    const skillsSource = this._system["skills"] as
      | Record<string, { rank?: number; lore?: boolean }>
      | undefined;
    const derivedSkills: Record<string, { total: number; dc: number; modifiers: unknown[] }> =
      this._derived?.skills ?? {};

    if (!skillsSource) return [];

    return Object.entries(skillsSource).map(([slug, raw]) => {
      const rank = raw.rank ?? 0;
      const isLore = raw.lore === true;
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
        const equippedObj =
          typeof sys["equipped"] === "object" && sys["equipped"] !== null
            ? (sys["equipped"] as Record<string, unknown>)
            : {};
        return {
          id: typeof rawId === "string" ? rawId : "",
          name: typeof rawName === "string" ? rawName : "",
          subtype: typeof rawType === "string" ? rawType : "",
          quantity: typeof rawQty === "number" ? rawQty : 1,
          bulk,
          equipped: equippedObj["inSlot"] === true,
          img: typeof item["img"] === "string" ? item["img"] : null,
        };
      });
  }

  // -------------------------------------------------------------------------
  // Spells tab
  // -------------------------------------------------------------------------

  get spellcastingEntries(): SpellcastingEntryRow[] {
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    if (!items) return [];

    return items
      .filter((item) => item["type"] === "spellcastingEntry")
      .map((entry) => {
        const sys =
          typeof entry["system"] === "object" && entry["system"] !== null
            ? (entry["system"] as Record<string, unknown>)
            : {};
        const rawId = entry["_id"];
        const entryId = typeof rawId === "string" ? rawId : "";
        const rawTradition = sys["tradition"];
        const tradition = typeof rawTradition === "string" ? rawTradition : "arcane";
        const rawPrepared = sys["prepared"];
        const prepared = typeof rawPrepared === "string" ? rawPrepared : "spontaneous";
        const rawAbility = sys["ability"];
        const ability = typeof rawAbility === "string" ? rawAbility : "int";

        // Spell DC and attack from derived (if available)
        const spellDC = 10; // simplified for now — full derivation in M3-D
        const spellAttack = 0;

        // Slots
        const slotsRaw = sys["slots"] as
          | Record<string, { value?: number; max?: number }>
          | undefined;
        const slots: SpellcastingEntryRow["slots"] = [];
        if (slotsRaw) {
          for (let rank = 0; rank <= 10; rank++) {
            const slotKey = `slot${String(rank)}`;
            const slot = slotsRaw[slotKey];
            if (!slot || (slot.max === 0 && rank > 0)) continue;
            // Find prepared spells for this rank in this entry
            const preparedSpells: Array<{ id: string; name: string; level: number }> = [];
            for (const spItem of items) {
              if (spItem["type"] !== "spell") continue;
              const spSys = spItem["system"] as Record<string, unknown> | undefined;
              if ((spItem["spellcastingEntry"] ?? spItem["location"]) !== entryId) continue;
              const rawLevel = spSys?.["level"];
              const spLevel = typeof rawLevel === "number" ? rawLevel : rank;
              const rawSpId = spItem["_id"];
              const rawSpName = spItem["name"];
              preparedSpells.push({
                id: typeof rawSpId === "string" ? rawSpId : "",
                name: typeof rawSpName === "string" ? rawSpName : "",
                level: spLevel,
              });
            }
            slots.push({
              rank,
              value: slot.value ?? 0,
              max: slot.max ?? 0,
              spells: preparedSpells,
            });
          }
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
          slots,
        };
      });
  }

  // -------------------------------------------------------------------------
  // Op builders — called by Svelte component to build sendOp payloads
  // -------------------------------------------------------------------------

  /**
   * Build a roll:check op for a skill check.
   * The server executes the roll and posts a chat card.
   */
  rollSkill(skillSlug: string): RollCheckPayload {
    const skillStat = this._derived?.skills[skillSlug];
    const total = skillStat?.total ?? 0;
    return {
      type: "roll:check",
      formula: `1d20 + ${String(total)}`,
      actorId: this._actorId,
      context: {
        label: CharacterSheetVM.SKILL_LABELS[skillSlug] ?? skillSlug,
        type: "skill",
        skill: skillSlug,
        dc: null,
      },
    };
  }

  /**
   * Build a roll:check op for a saving throw.
   */
  rollSave(saveName: "fortitude" | "reflex" | "will"): RollCheckPayload {
    const derivedSave = this._derived?.saves[saveName];
    const total = derivedSave?.total ?? 0;
    return {
      type: "roll:check",
      formula: `1d20 + ${String(total)}`,
      actorId: this._actorId,
      context: {
        label: saveName.charAt(0).toUpperCase() + saveName.slice(1) + " Save",
        type: "save",
        save: saveName,
        dc: null,
      },
    };
  }

  /**
   * Build a roll:check op for Perception.
   */
  rollPerception(): RollCheckPayload {
    const total = this._derived?.perception.total ?? 0;
    return {
      type: "roll:check",
      formula: `1d20 + ${String(total)}`,
      actorId: this._actorId,
      context: {
        label: "Perception",
        type: "perception",
        dc: null,
      },
    };
  }

  /**
   * Build a roll:check op for a strike (attack roll).
   * @param strikeSourceId  The sourceId from the StrikeRow.
   * @param mapIndex        0 = first attack, 1 = second, 2 = third.
   */
  rollStrike(strikeSourceId: string, mapIndex: 0 | 1 | 2): RollCheckPayload {
    const strike = this._derived?.strikes.find((s) => s.sourceId === strikeSourceId);
    if (!strike) {
      return {
        type: "roll:check",
        formula: "1d20",
        actorId: this._actorId,
        context: { label: "Strike", type: "strike" },
      };
    }
    const variant = strike.variants[mapIndex];
    return {
      type: "roll:check",
      formula: variant.formula,
      actorId: this._actorId,
      context: {
        label: `${strike.label} (MAP ${String(mapIndex)})`,
        type: "strike",
        strikeSourceId,
        mapIndex,
        damageFormula: strike.damageFormula,
        critDamageFormula: strike.critDamageFormula,
      },
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
}
