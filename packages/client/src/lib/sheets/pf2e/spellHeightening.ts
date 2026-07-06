/**
 * spellHeightening.ts — pure PF2e spell-heightening math (r16-G3).
 *
 * Foundry/pf2e stores a spell's scaling in `system.heightening`:
 *
 *   - type "interval": `{ type, interval, damage: { <compKey>: "<XdY>" } }`
 *     Every `interval` ranks the spell is heightened ABOVE its base level, each
 *     listed damage component gains one extra `<XdY>` term. Horizon Thunder
 *     Sphere (base 1, "0": base 3d6, +2d6 every +1) at rank 3 rolls
 *     `3d6+2d6+2d6`.
 *
 *   - type "fixed": `{ type, levels: { <rank>: { damage?, target?, range?, … } } }`
 *     Specific ranks override parts of the spell. A level entry that ONLY
 *     rewrites `damage` (e.g. Darklight rank 10) can be applied to the roll
 *     formula automatically. A level entry that changes target/range/area/etc.
 *     is "complex" — we surface a badge and defer to the details popup rather
 *     than inventing a mechanical rule.
 *
 * This module is intentionally dependency-free and side-effect-free: it only
 * transforms plain records (the actor's embedded spell `system`, which
 * preserves `damage`/`heightening` verbatim from the pack — see
 * CharacterSheetVM.addSpellToEntry which copies `...spellDoc`). The server owns
 * the RNG; here we only assemble the roll STRING the sheet emits as
 * `/r <formula> # <flavor>`.
 */

/** Where a spell is being cast from — decides how its effective rank is set. */
export type SpellSurface = "cantrip" | "focus" | "prepared" | "grimoire";

/** One damage component of a spell, already resolved to a display/roll formula. */
export interface HeightenedDamageComponent {
  /** Component key from `system.damage` (e.g. "0" or a Foundry random id). */
  key: string;
  /** Roll formula for this component AT the effective rank (e.g. "3d6+2d6"). */
  formula: string;
  /** Damage type slug (e.g. "fire", "void") or null when untyped. */
  type: string | null;
  /** Category slug (e.g. "persistent", "splash") or null. */
  category: string | null;
}

/** Result of applying heightening to a spell for a given effective rank. */
export interface HeightenedSpell {
  /**
   * Heightening baseline rank — the rank at which the base damage formula holds.
   * Equals system.level for ranked spells; normalized to 1 for cantrips
   * (system.level 0, cast at rank >= 1). The UI compares effectiveRank against
   * this to decide whether to show a heightened badge.
   */
  baseRank: number;
  /** Effective rank the spell is being cast at (>= baseRank). */
  effectiveRank: number;
  /** How many ranks above the baseline (effectiveRank - baseRank; 0 = not heightened). */
  heightenedBy: number;
  /** Damage components with effective-rank formulas (empty for non-damage spells). */
  components: HeightenedDamageComponent[];
  /**
   * Combined roll formula across all components (joined with "+"), or null when
   * the spell has no damage at all. Safe to feed to the dice roller verbatim.
   */
  rollFormula: string | null;
  /**
   * Short display of the combined damage (e.g. "3d6+2d6 elétrico"), or null.
   * Uses the FIRST component's type as a hint; multi-type spells still combine.
   */
  damageDisplay: string | null;
  /**
   * True when the effective rank triggers a FIXED heightening entry that changes
   * more than damage (target/range/area/duration/…). The UI shows a badge and
   * routes the player to the details popup; the formula is NOT auto-altered by
   * the complex change (only its own `damage` block, if present, is applied).
   */
  hasComplexHeightening: boolean;
}

/** True for a plain object (not array, not null). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Effective casting rank for a spell surfaced on the sheet.
 *
 * PF2e rules:
 *  - cantrips: auto-heighten to the highest rank you can cast = ceil(level/2)
 *    (min 1). A level-3 character casts cantrips at rank 2.
 *  - focus spells: same auto-heighten to ceil(level/2) (min 1).
 *  - prepared: cast at the rank of the SLOT they were prepared in (`slotRank`).
 *  - grimoire (known, unprepared): shown at their own base rank.
 *
 * `slotRank` is only consulted for the "prepared" surface; ignored otherwise.
 * The result is never below `baseRank` (a spell can't be cast under its level).
 */
export function effectiveSpellRank(
  surface: SpellSurface,
  actorLevel: number,
  baseRank: number,
  slotRank?: number,
): number {
  const lvl = num(actorLevel) ?? 1;
  const base = num(baseRank) ?? 0;
  switch (surface) {
    case "cantrip":
    case "focus": {
      const maxRank = Math.max(1, Math.ceil(lvl / 2));
      return Math.max(base, maxRank);
    }
    case "prepared": {
      const sr = num(slotRank);
      return sr === null ? base : Math.max(base, sr);
    }
    case "grimoire":
    default:
      return base;
  }
}

/**
 * Read `system.damage` (a `{ <key>: { formula, type, category } }` map) into an
 * ordered array of base components. Order follows Object.keys insertion order,
 * which the pack JSON preserves (component "0" first, splash/persistent later).
 */
function readBaseComponents(
  system: Record<string, unknown>,
): Array<{ key: string; formula: string; type: string | null; category: string | null }> {
  const damage = system["damage"];
  if (!isRecord(damage)) return [];
  const out: Array<{ key: string; formula: string; type: string | null; category: string | null }> = [];
  for (const [key, raw] of Object.entries(damage)) {
    if (!isRecord(raw)) continue;
    const formula = str(raw["formula"]);
    if (!formula) continue;
    out.push({ key, formula, type: str(raw["type"]), category: str(raw["category"]) });
  }
  return out;
}

/**
 * Apply a FIXED heightening `damage` block (from `levels.<rank>.damage`) as an
 * OVERRIDE: the highest listed rank <= effRank whose entry carries a `damage`
 * map replaces the base components entirely (matching Foundry's fixed
 * semantics — the level entry restates the full damage at that rank).
 *
 * Returns the overriding components, or null when no applicable fixed-damage
 * entry exists (caller keeps the base components).
 */
function fixedDamageOverride(
  levels: Record<string, unknown>,
  effRank: number,
): Array<{ key: string; formula: string; type: string | null; category: string | null }> | null {
  let bestRank = -1;
  let bestDamage: Record<string, unknown> | null = null;
  for (const [rankKey, entry] of Object.entries(levels)) {
    const rank = Number(rankKey);
    if (!Number.isFinite(rank) || rank > effRank) continue;
    if (!isRecord(entry)) continue;
    const dmg = entry["damage"];
    if (!isRecord(dmg) || Object.keys(dmg).length === 0) continue;
    if (rank > bestRank) {
      bestRank = rank;
      bestDamage = dmg;
    }
  }
  if (!bestDamage) return null;
  const out: Array<{ key: string; formula: string; type: string | null; category: string | null }> = [];
  for (const [key, raw] of Object.entries(bestDamage)) {
    if (!isRecord(raw)) continue;
    const formula = str(raw["formula"]);
    if (!formula) continue;
    out.push({ key, formula, type: str(raw["type"]), category: str(raw["category"]) });
  }
  return out.length > 0 ? out : null;
}

/**
 * Does any FIXED level entry <= effRank change something OTHER than `damage`?
 * (target/range/area/duration/save/…). Signals a "complex" heightening that we
 * badge but do not fold into the formula.
 */
function hasComplexFixedChange(levels: Record<string, unknown>, effRank: number): boolean {
  for (const [rankKey, entry] of Object.entries(levels)) {
    const rank = Number(rankKey);
    if (!Number.isFinite(rank) || rank > effRank) continue;
    if (!isRecord(entry)) continue;
    for (const k of Object.keys(entry)) {
      if (k !== "damage") return true;
    }
  }
  return false;
}

/**
 * Compute the heightened view of a spell at a given effective rank.
 *
 * Pure: `spellSystem` is the embedded spell's `system` object; `baseRank` is its
 * own level; `effectiveRank` comes from {@link effectiveSpellRank}. Never throws
 * on malformed data — missing/odd shapes degrade to the base (or empty) formula.
 */
export function computeHeightenedSpell(
  spellSystem: unknown,
  baseRank: number,
  effectiveRank: number,
): HeightenedSpell {
  const system = isRecord(spellSystem) ? spellSystem : {};
  const rawBase = num(baseRank) ?? 0;
  // Cantrips carry system.level 0 but are always CAST at a real rank >= 1: their
  // damage formula is the rank-1 baseline, and each rank above 1 heightens once.
  // Normalize the base to 1 so a level-3 caster's cantrip (rank 2) heightens by
  // exactly 1 step — not 2 (which counting from 0 would give). (r16-G3)
  const base = Math.max(1, rawBase);
  const eff = Math.max(base, num(effectiveRank) ?? base);
  const heightenedBy = Math.max(0, eff - base);

  let components = readBaseComponents(system);
  let hasComplexHeightening = false;

  const heightening = system["heightening"];
  if (isRecord(heightening)) {
    const type = str(heightening["type"]);

    if (type === "interval" && heightenedBy > 0) {
      const interval = num(heightening["interval"]);
      const incMap = isRecord(heightening["damage"]) ? (heightening["damage"] as Record<string, unknown>) : {};
      if (interval && interval > 0) {
        const steps = Math.floor(heightenedBy / interval);
        if (steps > 0) {
          components = components.map((comp) => {
            const inc = str(incMap[comp.key]);
            if (!inc) return comp;
            // Append the extra term `steps` times — robust vs. any base shape
            // ("3d6", "1d4+1", "8"): the roller sums composite formulas fine.
            const extra = Array.from({ length: steps }, () => inc).join("+");
            return { ...comp, formula: `${comp.formula}+${extra}` };
          });
        }
      }
    } else if (type === "fixed") {
      const levels = isRecord(heightening["levels"]) ? (heightening["levels"] as Record<string, unknown>) : {};
      const override = fixedDamageOverride(levels, eff);
      if (override) components = override;
      hasComplexHeightening = hasComplexFixedChange(levels, eff);
    }
  }

  const rollFormula = components.length > 0 ? components.map((c) => c.formula).join("+") : null;
  const damageDisplay =
    components.length > 0
      ? components.map((c) => c.formula).join("+") + (components[0]?.type ? ` ${components[0].type}` : "")
      : null;

  return {
    baseRank: base,
    effectiveRank: eff,
    heightenedBy,
    components: components.map((c) => ({ key: c.key, formula: c.formula, type: c.type, category: c.category })),
    rollFormula,
    damageDisplay,
    hasComplexHeightening,
  };
}
