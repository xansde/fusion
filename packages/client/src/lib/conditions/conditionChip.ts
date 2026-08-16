/**
 * conditionChip.ts — the display contract of a condition, as a pure model.
 *
 * A condition is drawn the way the SYSTEM declared it, never the way a panel guessed:
 * `ConditionDefinition` (REQ-SYS-043, amended by DEC-CTT-11) carries `tone`, `help` and
 * `critical`, and every surface that shows conditions — the combat tab (REQ-CBA-050..053)
 * and the contacts tab (REQ-CTT-030..038) — reads the same three fields through this
 * module. Nothing here knows a single condition by name.
 *
 * Two rules shape the whole file:
 *
 *  - **Fail open** (REQ-CTT-035): a declaration missing `tone` is drawn as a situation, a
 *    declaration missing `help` is drawn without a tooltip, and an undeclared condition is
 *    still drawn. Incomplete metadata degrades the chip; it never hides the condition,
 *    because the condition is what the table can see in the fiction.
 *  - **Value belongs to the label** (REQ-CTT-033): "Amedrontado 2" is one string, not a
 *    name plus a badge — the panels render `label`, and the numeral is made tabular by CSS.
 *
 * The ordering (REQ-CTT-036, REQ-CBA-051) lives here too, so head, queue and card cannot
 * disagree about which two conditions survive a cap of two.
 *
 * No runes, no components, no socket: this module is unit-testable on its own.
 */

// ---------------------------------------------------------------------------
// The declared contract
// ---------------------------------------------------------------------------

/**
 * What the condition does to whoever carries it (REQ-SYS-043) — never how grave it is.
 * `"benefit"` helps, `"harm"` hinders, `"special"` is a situation (detection, attitude,
 * control).
 */
export type ConditionTone = "benefit" | "harm" | "special";

/** The subset of `ConditionDefinition` a chip needs (REQ-SYS-043 + DEC-CTT-11). */
export interface ConditionDisplayContract {
  /** Translated name declared by the system; falls back to the actor item's own name. */
  readonly label?: string;
  /** Effect on the bearer. Absent ⇒ `"special"` (REQ-CTT-035). */
  readonly tone?: ConditionTone;
  /** Short help text, already translated by the system. Absent ⇒ no tooltip. */
  readonly help?: string;
  /** Takes the character out of the scene: emphasis, never a fourth tone (REQ-CTT-032). */
  readonly critical?: boolean;
}

/**
 * How a surface asks for a condition's declaration.
 *
 * The client has no access to the system registry today (the packages cannot import
 * `systems/pf2e`), so every caller passes `undefined` and every chip degrades openly. When
 * the registry does reach the client, only this lookup changes.
 */
export type ConditionContractLookup = (slug: string) => ConditionDisplayContract | undefined;

// ---------------------------------------------------------------------------
// The chip
// ---------------------------------------------------------------------------

/** One condition, resolved for display. */
export interface ConditionChipModel {
  /** Stable key for the `{#each}` — the actor item's id when there is one, else the slug. */
  readonly id: string;
  /** System slug (`"frightened"`), used to look the declaration up. */
  readonly slug: string;
  /** Name without the value. */
  readonly name: string;
  /** Numeric value, or `null` for a condition that carries none. */
  readonly value: number | null;
  /** What is drawn: name and value as one string (REQ-CTT-033). */
  readonly label: string;
  /** Resolved tone — `"special"` when the system declared none (REQ-CTT-035). */
  readonly tone: ConditionTone;
  /** Whether the chip is drawn filled (REQ-CTT-032). */
  readonly critical: boolean;
  /** Help text for the drawn tooltip, or `null` for no tooltip (REQ-CTT-034/035). */
  readonly help: string | null;
}

/** The raw condition as it sits on an actor, before the declaration is applied. */
export interface RawCondition {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly value: number | null;
}

const TONES: ReadonlySet<string> = new Set<ConditionTone>(["benefit", "harm", "special"]);

function toneOf(contract: ConditionDisplayContract | undefined): ConditionTone {
  const declared = contract?.tone;
  // REQ-CTT-035: a condition with no declared tone is a situation, not a hidden condition.
  return declared !== undefined && TONES.has(declared) ? declared : "special";
}

/**
 * Resolve one condition against its declaration.
 *
 * `label` is composed here and nowhere else, so "Amedrontado 2" reads the same on the turn
 * head, in the queue and on a contact card (REQ-CTT-033).
 */
export function buildConditionChip(
  raw: RawCondition,
  contract?: ConditionDisplayContract,
): ConditionChipModel {
  const name = contract?.label ?? raw.name;
  const help = typeof contract?.help === "string" && contract.help !== "" ? contract.help : null;
  return {
    id: raw.id,
    slug: raw.slug,
    name,
    value: raw.value,
    label: raw.value === null ? name : `${name} ${String(raw.value)}`,
    tone: toneOf(contract),
    critical: contract?.critical === true,
    help,
  };
}

// ---------------------------------------------------------------------------
// Ordering (REQ-CTT-036, REQ-CBA-051)
// ---------------------------------------------------------------------------

const TONE_RANK: Readonly<Record<ConditionTone, number>> = {
  harm: 1,
  special: 2,
  benefit: 3,
};

/** Critical first, then penalties, situations, benefits — alphabetical inside each group. */
function rankOf(chip: ConditionChipModel): number {
  return chip.critical ? 0 : TONE_RANK[chip.tone];
}

/**
 * Order the chips the way every surface must show them (REQ-CTT-036, REQ-CBA-051).
 *
 * This is what makes a cap of two honest: with the order fixed, the two that survive are
 * the two that matter most, and the "+N" hides the tail rather than an arbitrary slice.
 * Returns a new array; the input is never mutated.
 */
export function orderConditionChips(chips: readonly ConditionChipModel[]): ConditionChipModel[] {
  return [...chips].sort((a, b) => {
    const byRank = rankOf(a) - rankOf(b);
    if (byRank !== 0) return byRank;
    return a.label.localeCompare(b.label, "pt-BR");
  });
}

// ---------------------------------------------------------------------------
// Reading the conditions off an actor
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Read the active conditions of an actor document, already resolved and ordered.
 *
 * Conditions are embedded items of `type: "condition"` (the same shape the character sheet
 * reads), carrying `system.slug` and an optional `system.value`. An actor the viewer does
 * not have — a creature missing from a player's mirror — yields an empty list: there is
 * nothing to read, which is a different thing from a rule refusing to draw it.
 */
export function readActorConditions(
  actor: Record<string, unknown> | null | undefined,
  lookup?: ConditionContractLookup,
): ConditionChipModel[] {
  if (!actor) return [];
  const items = actor["items"];
  if (!Array.isArray(items)) return [];

  const chips: ConditionChipModel[] = [];
  for (const entry of items) {
    const item = asRecord(entry);
    if (!item || item["type"] !== "condition") continue;

    const system = asRecord(item["system"]) ?? {};
    const name = typeof item["name"] === "string" ? item["name"] : "";
    const slug = typeof system["slug"] === "string" ? system["slug"] : name;
    if (slug === "" && name === "") continue;

    const rawValue = system["value"];
    const value = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
    const id = typeof item["_id"] === "string" && item["_id"] !== "" ? item["_id"] : slug;

    chips.push(
      buildConditionChip({ id, slug, name: name === "" ? slug : name, value }, lookup?.(slug)),
    );
  }

  return orderConditionChips(chips);
}
