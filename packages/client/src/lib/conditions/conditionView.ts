/**
 * conditionView.ts — the view model behind a condition chip (spec 39 §5.4).
 *
 * The drawer knows no condition (DEC-CTT-11): it paints what the game system
 * declared through `ConditionDefinition` (REQ-SYS-043). This module turns that
 * declaration plus the actor's active conditions into everything a chip needs
 * — label, tone, emphasis, order and how many fit — with no DOM and no store,
 * so all of it stays unit-testable.
 *
 * Two rules run through every function here:
 *
 *  - **Fail open** (REQ-CTT-035): a missing `tone` becomes a situation, a
 *    missing `help` becomes no tooltip, a slug the system never declared still
 *    produces a chip. An incomplete declaration degrades the display; it never
 *    hides the condition.
 *  - **No icon** (REQ-CTT-030): the declared `img` points at Paizo artwork,
 *    which this project may not ship, so it never crosses into the view.
 */

/** Effect of a condition on whoever carries it — never a severity scale. */
export const CONDITION_TONES = ["benefit", "harm", "special"] as const;
export type ConditionTone = (typeof CONDITION_TONES)[number];

/**
 * The subset of the system's `ConditionDefinition` (REQ-SYS-043) this view
 * needs. Declared structurally rather than imported so the client keeps no
 * dependency on `@fusion/system-api`, and so a partially-filled declaration
 * from any system still typechecks.
 */
export interface ConditionDisplayContract {
  readonly slug?: string;
  readonly label?: string | null;
  /** Present in the contract, deliberately unused here (REQ-CTT-030). */
  readonly img?: string | null;
  readonly tone?: string | null;
  readonly help?: string | null;
  readonly critical?: boolean | null;
}

/** One condition currently active on an actor. */
export interface ActiveCondition {
  readonly slug: string;
  /** Numeric value for valued conditions (Amedrontado 2); absent when unvalued. */
  readonly value?: number | null;
}

/** Everything a chip draws, and nothing else. */
export interface ConditionView {
  readonly slug: string;
  /** Display name without the value ("Amedrontado"). */
  readonly name: string;
  /** Numeric value, or `null` when the condition carries none. */
  readonly value: number | null;
  /** Name and value as one string ("Amedrontado 2") — REQ-CTT-033. */
  readonly label: string;
  readonly tone: ConditionTone;
  /** Declared help text, or `null` when the system declared none (REQ-CTT-035). */
  readonly help: string | null;
  /** Filled emphasis of the same tone, never a fourth color (REQ-CTT-032). */
  readonly critical: boolean;
}

/** How many chips a card draws before collapsing the rest into "+N" (REQ-CTT-037). */
export const CONDITION_CHIP_LIMIT = 2;

// ---------------------------------------------------------------------------
// Building a view
// ---------------------------------------------------------------------------

/**
 * Coerce whatever the system declared into one of the three tones.
 *
 * Anything absent, empty or unrecognised becomes `"special"` — the neutral
 * situation tone (REQ-CTT-035), so a system that ships a tone we do not know
 * still gets its condition painted.
 */
export function normalizeConditionTone(tone: string | null | undefined): ConditionTone {
  return (CONDITION_TONES as readonly string[]).includes(tone ?? "")
    ? (tone as ConditionTone)
    : "special";
}

/**
 * Turn a slug into a readable name, for the condition no system declared.
 * "off-guard" → "Off Guard". Last resort only: a declared `label` always wins.
 */
export function humanizeConditionSlug(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Glue the value to the name (REQ-CTT-033): "Amedrontado 2", never
 * "Amedrontado (2)" and never a second tag beside the chip. A non-finite or
 * absent value simply leaves the name alone.
 */
export function formatConditionLabel(name: string, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return name;
  return `${name} ${String(value)}`;
}

/** Build one chip view from an active condition plus (maybe) its declaration. */
export function toConditionView(
  active: ActiveCondition,
  declaration?: ConditionDisplayContract,
): ConditionView {
  const declaredName = declaration?.label?.trim();
  const name =
    declaredName !== undefined && declaredName !== ""
      ? declaredName
      : humanizeConditionSlug(active.slug);
  const value =
    active.value !== null && active.value !== undefined && Number.isFinite(active.value)
      ? active.value
      : null;
  const help = declaration?.help?.trim();

  return {
    slug: active.slug,
    name,
    value,
    label: formatConditionLabel(name, value),
    tone: normalizeConditionTone(declaration?.tone),
    help: help !== undefined && help !== "" ? help : null,
    critical: declaration?.critical === true,
  };
}

/**
 * Build the chip views for every active condition of an actor.
 *
 * `declarations` is the system's condition registry (REQ-SYS-043); a slug it
 * does not carry still yields a chip (REQ-CTT-035). Entries with a blank slug
 * are dropped — there is no condition there to name.
 */
export function buildConditionViews(
  actives: readonly ActiveCondition[],
  declarations?: ReadonlyMap<string, ConditionDisplayContract>,
): ConditionView[] {
  return actives
    .filter((active) => active.slug.trim() !== "")
    .map((active) => toConditionView(active, declarations?.get(active.slug)));
}

// ---------------------------------------------------------------------------
// Order — REQ-CTT-036
// ---------------------------------------------------------------------------

/** Group rank: criticals, then penalties, then situations, then benefits. */
const GROUP_RANK: Record<ConditionTone, number> = { harm: 1, special: 2, benefit: 3 };
const CRITICAL_RANK = 0;

function groupRank(view: ConditionView): number {
  return view.critical ? CRITICAL_RANK : GROUP_RANK[view.tone];
}

/**
 * Order the chips: criticals → penalties → situations → benefits, alphabetical
 * by name inside each group (REQ-CTT-036).
 *
 * Alphabetical on the NAME, not on the label: "Amedrontado 10" must not sort
 * before "Amedrontado 2". Collation is pt-BR so accents fall where a reader
 * expects them ("Abalado" before "Ágil"), which a code-point sort gets wrong.
 * Pure: the input array is never reordered.
 */
export function sortConditions(views: readonly ConditionView[]): ConditionView[] {
  return [...views].sort((a, b) => {
    const byGroup = groupRank(a) - groupRank(b);
    if (byGroup !== 0) return byGroup;
    const byName = a.name.localeCompare(b.name, "pt-BR");
    if (byName !== 0) return byName;
    const byValue = (a.value ?? 0) - (b.value ?? 0);
    if (byValue !== 0) return byValue;
    return a.slug.localeCompare(b.slug, "pt-BR");
  });
}

// ---------------------------------------------------------------------------
// The cap of two plus "+N" — REQ-CTT-037
// ---------------------------------------------------------------------------

export interface ConditionSplit {
  /** The chips actually drawn. */
  readonly shown: ConditionView[];
  /** How many are folded behind the "+N" indicator; `0` when none are. */
  readonly hidden: number;
}

/**
 * Split an already-ordered list into what the card draws and what hides behind
 * "+N" (REQ-CTT-037). Expanding reveals the rest in place — same list, same
 * order — so nothing opens a window and the drawer keeps its width
 * (DEC-GAV-04).
 */
export function splitConditionsForDisplay(
  views: readonly ConditionView[],
  options?: { expanded?: boolean; limit?: number },
): ConditionSplit {
  const limit = options?.limit ?? CONDITION_CHIP_LIMIT;
  if (options?.expanded === true || views.length <= limit) {
    return { shown: [...views], hidden: 0 };
  }
  return { shown: views.slice(0, limit), hidden: views.length - limit };
}
