/**
 * npcSheetVM.ts — Pure view-model for the PF2e NPC Sheet.
 *
 * Lean GM-focused view: statblock summary (AC / saves / HP / Perception /
 * skills), strikes/actions from melee items, and conditions.
 *
 * No PIXI, no Svelte, no browser APIs — fully testable with Vitest.
 *
 * Clean-room. ORC/OGL mechanics.
 * REQ-PF2-111, REQ-UIF-021..025.
 * Spec: 17-sistema-pf2e.md §Fichas.
 */

import type { NpcDerived, ModifierBreakdown } from "./derivedTypes.js";
import { fmtMod } from "./characterSheetVM.js";

export type { NpcDerived };
export { fmtMod };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NpcStatRow {
  label: string;
  total: number;
  totalFormatted: string;
  modifiers: ModifierBreakdown[];
}

export interface NpcStrikeRow {
  id: string;
  name: string;
  bonus: number;
  bonusFormatted: string;
  damageEntries: Array<{ formula: string; damageType: string }>;
  traits: string[];
  isRanged: boolean;
}

export interface NpcActionRow {
  id: string;
  name: string;
  description: string;
  actionCost: string | null;
  traits: string[];
}

export interface NpcConditionRow {
  slug: string;
  label: string;
  value?: number;
  itemId: string;
}

export interface DocUpdatePayload {
  type: "doc:update";
  documentType: string;
  id: string;
  diff: Record<string, unknown>;
}

export interface RollCheckPayload {
  type: "roll:check";
  formula: string;
  actorId: string;
  context: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// NpcSheetVM
// ---------------------------------------------------------------------------

/**
 * View-model for the PF2e NPC Sheet.
 *
 * GMs primarily use this during combat — the focus is speed of reading and
 * quick access to rolls. Fields are derived from the `_derived` object
 * populated by the M3-B NPC derivation steps.
 */
export class NpcSheetVM {
  private readonly _doc: Record<string, unknown>;
  private readonly _actorId: string;
  private readonly _ownership: number;
  private readonly _isGm: boolean;

  constructor(opts: {
    doc: Record<string, unknown>;
    actorId: string;
    ownership: number;
    isGm: boolean;
  }) {
    this._doc = opts.doc;
    this._actorId = opts.actorId;
    this._ownership = opts.ownership;
    this._isGm = opts.isGm;
  }

  // -------------------------------------------------------------------------
  // Permission
  // -------------------------------------------------------------------------

  get editable(): boolean {
    return this._isGm || this._ownership >= 3; // OwnershipLevel.OWNER = 3
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  get name(): string {
    const raw = this._doc["name"];
    return typeof raw === "string" ? raw : "Unknown NPC";
  }

  get img(): string | null {
    const raw = this._doc["img"];
    return typeof raw === "string" ? raw : null;
  }

  private get _system(): Record<string, unknown> {
    const sys = this._doc["system"];
    return typeof sys === "object" && sys !== null ? (sys as Record<string, unknown>) : {};
  }

  private get _derived(): NpcDerived | null {
    const sys = this._system;
    const d = sys["derived"];
    if (!d || typeof d !== "object") return null;
    return d as unknown as NpcDerived;
  }

  // -------------------------------------------------------------------------
  // Level
  // -------------------------------------------------------------------------

  get level(): number {
    const lvl = this._system["level"] as { value?: number } | undefined;
    return lvl?.value ?? 0;
  }

  // -------------------------------------------------------------------------
  // HP
  // -------------------------------------------------------------------------

  get hpCurrent(): number {
    const derived = this._derived;
    if (derived) return derived.hp.value;
    const attrs = this._system["attributes"] as Record<string, unknown> | undefined;
    const hp = attrs?.["hp"] as Record<string, unknown> | undefined;
    const val = hp?.["value"];
    return typeof val === "number" ? val : 0;
  }

  get hpMax(): number {
    const derived = this._derived;
    if (derived) return derived.hp.max;
    const attrs = this._system["attributes"] as Record<string, unknown> | undefined;
    const hp = attrs?.["hp"] as Record<string, unknown> | undefined;
    const max = hp?.["max"];
    return typeof max === "number" ? max : 0;
  }

  get hpDetails(): string {
    const attrs = this._system["attributes"] as Record<string, unknown> | undefined;
    const hp = attrs?.["hp"] as Record<string, unknown> | undefined;
    const details = hp?.["details"];
    return typeof details === "string" ? details : "";
  }

  // -------------------------------------------------------------------------
  // AC
  // -------------------------------------------------------------------------

  get ac(): NpcStatRow {
    const derived = this._derived;
    if (derived) {
      return {
        label: "AC",
        total: derived.ac.total,
        totalFormatted: String(derived.ac.total),
        modifiers: derived.ac.modifiers,
      };
    }
    const attrs = this._system["attributes"] as Record<string, unknown> | undefined;
    const acData = attrs?.["ac"] as Record<string, unknown> | undefined;
    const rawAc = acData?.["value"];
    const total = typeof rawAc === "number" ? rawAc : 10;
    return { label: "AC", total, totalFormatted: String(total), modifiers: [] };
  }

  get acDetails(): string {
    const attrs = this._system["attributes"] as Record<string, unknown> | undefined;
    const acData = attrs?.["ac"] as Record<string, unknown> | undefined;
    const details = acData?.["details"];
    return typeof details === "string" ? details : "";
  }

  // -------------------------------------------------------------------------
  // Perception
  // -------------------------------------------------------------------------

  get perception(): NpcStatRow {
    const derived = this._derived;
    if (derived) {
      return {
        label: "Perception",
        total: derived.perception.total,
        totalFormatted: fmtMod(derived.perception.total),
        modifiers: derived.perception.modifiers,
      };
    }
    const attrs = this._system["attributes"] as Record<string, unknown> | undefined;
    const perc = attrs?.["perception"] as Record<string, unknown> | undefined;
    const rawMod = perc?.["mod"];
    const total = typeof rawMod === "number" ? rawMod : 0;
    return { label: "Perception", total, totalFormatted: fmtMod(total), modifiers: [] };
  }

  get perceptionDetails(): string {
    const attrs = this._system["attributes"] as Record<string, unknown> | undefined;
    const perc = attrs?.["perception"] as Record<string, unknown> | undefined;
    const details = perc?.["details"];
    return typeof details === "string" ? details : "";
  }

  // -------------------------------------------------------------------------
  // Saves
  // -------------------------------------------------------------------------

  get saves(): NpcStatRow[] {
    const derived = this._derived;
    const saveNames = ["fortitude", "reflex", "will"] as const;

    return saveNames.map((name) => {
      const saveDerived = derived?.saves[name];
      if (saveDerived) {
        return {
          label: name.charAt(0).toUpperCase() + name.slice(1),
          total: saveDerived.total,
          totalFormatted: fmtMod(saveDerived.total),
          modifiers: saveDerived.modifiers,
        };
      }

      // Fallback: read from raw statblock
      const attrs = this._system["attributes"] as Record<string, unknown> | undefined;
      const saveData = attrs?.[name] as Record<string, unknown> | undefined;
      const rawSave = saveData?.["value"];
      const total = typeof rawSave === "number" ? rawSave : 0;
      return {
        label: name.charAt(0).toUpperCase() + name.slice(1),
        total,
        totalFormatted: fmtMod(total),
        modifiers: [],
      };
    });
  }

  // -------------------------------------------------------------------------
  // Skills
  // -------------------------------------------------------------------------

  get skills(): Array<{ slug: string; label: string; total: number; totalFormatted: string }> {
    const derived = this._derived;
    const skillsSource = this._system["skills"] as
      | Record<string, { value?: number; label?: string }>
      | undefined;

    if (!skillsSource) return [];

    return Object.entries(skillsSource).map(([slug, raw]) => {
      const derivedSkill = derived?.skills[slug];
      const rawVal = raw.value;
      const total = derivedSkill?.total ?? (typeof rawVal === "number" ? rawVal : 0);
      const rawLabel = raw.label;
      const label =
        typeof rawLabel === "string" ? rawLabel : slug.charAt(0).toUpperCase() + slug.slice(1);
      return {
        slug,
        label,
        total,
        totalFormatted: fmtMod(total),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Speed
  // -------------------------------------------------------------------------

  get speed(): number {
    const attrs = this._system["attributes"] as Record<string, unknown> | undefined;
    const s = attrs?.["speed"] as Record<string, unknown> | undefined;
    const rawSpeed = s?.["value"];
    return typeof rawSpeed === "number" ? rawSpeed : 25;
  }

  // -------------------------------------------------------------------------
  // Strikes (melee/ranged items)
  // -------------------------------------------------------------------------

  get strikes(): NpcStrikeRow[] {
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    if (!items) return [];

    return items
      .filter((item) => item["type"] === "melee")
      .map((item) => {
        const rawSys = item["system"];
        const sys =
          typeof rawSys === "object" && rawSys !== null ? (rawSys as Record<string, unknown>) : {};
        const rawBonus = sys["bonus"];
        const bonus = typeof rawBonus === "number" ? rawBonus : 0;
        const damageRaw = sys["damage"] as
          | Array<Record<string, unknown>>
          | Record<string, unknown>
          | undefined;
        const damageEntries: NpcStrikeRow["damageEntries"] = [];

        if (Array.isArray(damageRaw)) {
          for (const d of damageRaw) {
            const rawFormula = d["formula"];
            const rawDmgType = d["damageType"];
            damageEntries.push({
              formula: typeof rawFormula === "string" ? rawFormula : "1d6",
              damageType: typeof rawDmgType === "string" ? rawDmgType : "untyped",
            });
          }
        } else if (damageRaw && typeof damageRaw === "object") {
          const rawFormula = damageRaw["formula"];
          const rawDmgType = damageRaw["damageType"];
          damageEntries.push({
            formula: typeof rawFormula === "string" ? rawFormula : "1d6",
            damageType: typeof rawDmgType === "string" ? rawDmgType : "untyped",
          });
        }

        const traitsRaw = sys["traits"] as { value?: string[] } | undefined;
        const traits = traitsRaw?.value ?? [];
        const rawStrikeId = item["_id"];
        const rawStrikeName = item["name"];

        return {
          id: typeof rawStrikeId === "string" ? rawStrikeId : "",
          name: typeof rawStrikeName === "string" ? rawStrikeName : "Strike",
          bonus,
          bonusFormatted: fmtMod(bonus),
          damageEntries,
          traits,
          isRanged: traits.includes("ranged") || traits.some((t) => t.startsWith("range-")),
        };
      });
  }

  // -------------------------------------------------------------------------
  // Actions / abilities
  // -------------------------------------------------------------------------

  get actions(): NpcActionRow[] {
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    if (!items) return [];

    return items
      .filter((item) => item["type"] === "action" || item["type"] === "ability")
      .map((item) => {
        const rawItemSys = item["system"];
        const sys =
          typeof rawItemSys === "object" && rawItemSys !== null
            ? (rawItemSys as Record<string, unknown>)
            : {};
        const traitsRaw = sys["traits"] as { value?: string[] } | undefined;
        const actionType = sys["actionType"] as Record<string, unknown> | undefined;
        const actionsObj = sys["actions"] as Record<string, unknown> | undefined;

        // Determine action cost label
        let actionCost: string | null = null;
        const rawActType = actionType?.["value"];
        const type = typeof rawActType === "string" ? rawActType : "action";
        if (type === "reaction") actionCost = "R";
        else if (type === "free") actionCost = "F";
        else if (type === "passive") actionCost = null;
        else {
          const rawCount = actionsObj?.["value"];
          const count = typeof rawCount === "number" ? rawCount : 1;
          actionCost = count === 1 ? "1" : count === 2 ? "2" : count === 3 ? "3" : "1";
        }

        const descObj = sys["description"];
        let description = "";
        if (typeof descObj === "object" && descObj !== null) {
          const val = (descObj as Record<string, unknown>)["value"];
          description = typeof val === "string" ? val : "";
        } else if (typeof descObj === "string") {
          description = descObj;
        }
        const rawActId = item["_id"];
        const rawActName = item["name"];
        return {
          id: typeof rawActId === "string" ? rawActId : "",
          name: typeof rawActName === "string" ? rawActName : "Action",
          description,
          actionCost,
          traits: traitsRaw?.value ?? [],
        };
      });
  }

  // -------------------------------------------------------------------------
  // Conditions
  // -------------------------------------------------------------------------

  get conditions(): NpcConditionRow[] {
    const items = this._doc["items"] as Array<Record<string, unknown>> | undefined;
    if (!items) return [];

    return items
      .filter((item) => item["type"] === "condition")
      .map((item) => {
        const rawCondSys = item["system"];
        const sys =
          typeof rawCondSys === "object" && rawCondSys !== null
            ? (rawCondSys as Record<string, unknown>)
            : {};
        const numValue = typeof sys["value"] === "number" ? sys["value"] : undefined;
        const rawSlug = sys["slug"];
        const rawCondName = item["name"];
        const rawCondId = item["_id"];
        const row: NpcConditionRow = {
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
  // Op builders
  // -------------------------------------------------------------------------

  rollSave(saveName: "fortitude" | "reflex" | "will"): RollCheckPayload {
    const derived = this._derived;
    const total = derived?.saves[saveName].total ?? 0;
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

  rollPerception(): RollCheckPayload {
    const rawPerc = (this._system["attributes"] as Record<string, unknown> | undefined)?.[
      "perception"
    ];
    const rawPercMod =
      typeof rawPerc === "object" && rawPerc !== null
        ? (rawPerc as Record<string, unknown>)["mod"]
        : undefined;
    const total =
      this._derived?.perception.total ?? (typeof rawPercMod === "number" ? rawPercMod : 0);
    return {
      type: "roll:check",
      formula: `1d20 + ${String(total)}`,
      actorId: this._actorId,
      context: { label: "Perception", type: "perception", dc: null },
    };
  }

  rollStrike(strikeId: string): RollCheckPayload {
    const strike = this.strikes.find((s) => s.id === strikeId);
    const bonus = strike?.bonus ?? 0;
    return {
      type: "roll:check",
      formula: `1d20 + ${String(bonus)}`,
      actorId: this._actorId,
      context: {
        label: strike?.name ?? "Strike",
        type: "strike",
        strikeId,
        damageEntries: strike?.damageEntries ?? [],
      },
    };
  }

  rollSkill(skillSlug: string): RollCheckPayload {
    const skill = this.skills.find((s) => s.slug === skillSlug);
    const total = skill?.total ?? 0;
    return {
      type: "roll:check",
      formula: `1d20 + ${String(total)}`,
      actorId: this._actorId,
      context: { label: skill?.label ?? skillSlug, type: "skill", skill: skillSlug, dc: null },
    };
  }

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

  toggleCondition(conditionSlug: string): DocUpdatePayload | null {
    if (!this.editable) return null;
    const existing = this.conditions.find((c) => c.slug === conditionSlug);
    if (existing) {
      return {
        type: "doc:update",
        documentType: "Actor",
        id: this._actorId,
        diff: { [`items.-${existing.itemId}`]: true },
      };
    }
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
