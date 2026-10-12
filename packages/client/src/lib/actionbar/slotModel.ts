/**
 * slotModel.ts — what a slot and its tooltip draw, decided from an `ActionBarEntry`
 * (BAR-F1-04; spec 53 REQ-BAR-029..032, REQ-BAR-037..039, REQ-BAR-044, REQ-BAR-104, DEC-BAR-15;
 * tasks.md §2.2).
 *
 * Pure (§2.10): `Slot.svelte` only draws what these functions return, so the decisions — the short
 * name under the icon, which seal sits in the corner, which bonus the slot shows, which of the four
 * states it is in — are tested without a DOM.
 *
 * D-15 runs through the whole file. `cost`, `badge`, `uses` and `groupUses` are DISPLAY data: the
 * model formats them and never reads one as a rule. A state is a signal, never a lock — nothing here
 * produces "blocked", and REQ-BAR-104 keeps a faded slot clickable (the sheet's own function is the
 * one that refuses, when it refuses).
 */

import { formatActionCost } from "../compendium/documentDetails.js";
import { i18n, t, type SupportedLocale } from "../i18n/i18n.js";
import { actionBarCostToken } from "./cost.js";
import { FAVORITE_KEYS } from "./favoriteKeys.js";
import type {
  ActionBarEntry,
  ActionBarEntryKind,
  ActionBarTab,
  ActionBarVariant,
} from "./types.js";

// ---------------------------------------------------------------------------
// The twelve favourite keys (D-BA07)
// ---------------------------------------------------------------------------

/**
 * What the key seal of Favorites slot `i` says: 1–9, 0, − and =, in the order of the slots. The
 * minus is the typographic one (U+2212), as in the prototype. The table is `favoriteKeys.ts`, shared
 * with the shortcuts, so the seal and the key that answers to it cannot drift apart.
 */
export const FAVORITE_KEY_LABELS: readonly string[] = FAVORITE_KEYS.map((key) => key.label);

// ---------------------------------------------------------------------------
// The short name under the icon (DEC-BAR-15)
// ---------------------------------------------------------------------------

/** Longest short name the core draws under an icon before shortening it (characters). */
export const SHORT_LABEL_MAX = 10;

/** Words dropped first when a long name has to be squeezed ("Arquitetar uma Estratégia"). */
const CONNECTORS: ReadonlySet<string> = new Set([
  "de",
  "do",
  "da",
  "dos",
  "das",
  "e",
  "um",
  "uma",
  "o",
  "a",
  "os",
  "as",
  "para",
  "com",
  "em",
  "no",
  "na",
  "por",
]);

/**
 * The name an entry without a `shortLabel` gets under its icon (DEC-BAR-15: "sem ele o core abrevia
 * o `label`"). Whole words only: connectors go first, then words are added while they still fit;
 * if even the first word is too long it ends in an ellipsis, so the result never exceeds `max`.
 */
export function abbreviateLabel(label: string, max: number = SHORT_LABEL_MAX): string {
  const text = label.trim().replace(/\s+/g, " ");
  if (text.length <= max) return text;

  const meaningful = text
    .split(" ")
    .filter((word, index) => index === 0 || !CONNECTORS.has(word.toLowerCase()));

  let shortened = "";
  for (const word of meaningful) {
    const next = shortened === "" ? word : `${shortened} ${word}`;
    if (next.length > max) break;
    shortened = next;
  }
  if (shortened !== "") return shortened;

  return `${(meaningful[0] ?? text).slice(0, Math.max(1, max - 1))}…`;
}

// ---------------------------------------------------------------------------
// Variants: which bonus and which hint the slot is "in" (REQ-BAR-039, REQ-BAR-041)
// ---------------------------------------------------------------------------

/** The order axes are consulted in: the strike's MAP first, then the spell's rank, cost, element. */
const AXIS_ORDER: readonly ActionBarVariant["axis"][] = ["map", "rank", "cost", "element"];

/** The default variant of each axis the entry has, in {@link AXIS_ORDER}. */
function defaultVariants(entry: ActionBarEntry): ActionBarVariant[] {
  const found: ActionBarVariant[] = [];
  for (const axis of AXIS_ORDER) {
    const variant = entry.variants?.find(
      (candidate) => candidate.axis === axis && candidate.isDefault === true,
    );
    if (variant !== undefined) found.push(variant);
  }
  return found;
}

/** The default variant that carries its own bonus ("+4" at the second attack), if any. */
function badgeVariant(entry: ActionBarEntry): ActionBarVariant | undefined {
  return defaultVariants(entry).find((variant) => variant.badge !== undefined);
}

/**
 * What the slot shows as its bonus: the one of the variant IN USE (the strike at the current MAP),
 * else the entry's own. Display only.
 */
export function slotBadge(entry: ActionBarEntry): string | null {
  return badgeVariant(entry)?.badge ?? entry.badge ?? null;
}

/**
 * "depois deste: MAP −10" — what the strike does to the NEXT attack, from the default variant of the
 * MAP axis (REQ-BAR-039). The status strip repeats it while the pointer is on the strike.
 */
export function mapHint(entry: ActionBarEntry): string | null {
  const variant = entry.variants?.find(
    (candidate) => candidate.axis === "map" && candidate.isDefault === true,
  );
  return variant?.hint ?? null;
}

// ---------------------------------------------------------------------------
// The slot
// ---------------------------------------------------------------------------

/** The four states of a slot (REQ-BAR-030). `spent` is "spent-until-recharge" in the entry. */
export type SlotState = "ready" | "unavailable" | "spent" | "active";

export interface SlotSeal {
  /** `rank` = spell rank, `map` = counts for the multiple attack penalty, `uses` = quantity or charges. */
  kind: "rank" | "map" | "uses";
  text: string;
}

export interface SlotView {
  id: string;
  /** The whole name: tooltip and screen readers. */
  label: string;
  /** What is drawn under the icon (DEC-BAR-15). */
  shortLabel: string;
  /** The accessible name: the name, the cost and — when faded — why (REQ-BAR-031). */
  ariaLabel: string;
  /** Glyph for the top-left corner ("◆◆"), or null when the cost has none. */
  costGlyph: string | null;
  /** The cost in words ("2 ações"), or null. */
  costLabel: string | null;
  seal: SlotSeal | null;
  badge: string | null;
  state: SlotState;
  /** Why the slot is faded; null when it is not. */
  reason: string | null;
}

const STATE_OF: Record<NonNullable<ActionBarEntry["state"]>, SlotState> = {
  ready: "ready",
  unavailable: "unavailable",
  "spent-until-recharge": "spent",
  active: "active",
};

/** The cost as the existing formatter reads it: glyphs, a label, and whether it is plain text. */
function costOf(
  entry: ActionBarEntry,
  locale: SupportedLocale,
): { glyphs: string; label: string } | null {
  if (entry.cost === undefined) return null;
  const token = actionBarCostToken(entry.cost);
  if (token === null) return null;
  const formatted = formatActionCost(token, locale);
  if (formatted.label === "") return null;
  return { glyphs: formatted.icons, label: formatted.label };
}

/** A range of actions fits a slot corner only as "◆–◆◆◆" (the formatter's "◆ a ◆◆◆" is too wide). */
function cornerGlyph(glyphs: string): string | null {
  if (glyphs === "") return null;
  return glyphs.replace(/ (?:a|to) /, "–");
}

function sealOf(entry: ActionBarEntry): SlotSeal | null {
  if (entry.rank !== undefined) return { kind: "rank", text: String(entry.rank) };
  if (entry.countsForMap === true) return { kind: "map", text: t("FUSION.ActionBar.Seal.Map") };
  if (entry.uses !== undefined) {
    const { value, max } = entry.uses;
    return {
      kind: "uses",
      text: max === undefined ? `×${String(value)}` : `${String(value)}/${String(max)}`,
    };
  }
  return null;
}

function whyPrefix(state: SlotState): string {
  return state === "spent"
    ? t("FUSION.ActionBar.Tooltip.Spent")
    : t("FUSION.ActionBar.Tooltip.Unavailable");
}

export function slotView(entry: ActionBarEntry, locale: SupportedLocale = i18n.locale): SlotView {
  const state = STATE_OF[entry.state ?? "ready"];
  const cost = costOf(entry, locale);
  const faded = state === "unavailable" || state === "spent";
  const reason = faded && (entry.reason ?? "").trim() !== "" ? (entry.reason ?? "").trim() : null;

  const badge = slotBadge(entry);
  // The accessible name carries what the eye reads off the slot: the name, the cost and the bonus or DC.
  const spoken = [entry.label, cost?.label, badge ?? undefined].filter(
    (part): part is string => part !== undefined && part !== "",
  );
  const ariaLabel =
    reason === null ? spoken.join(", ") : `${spoken.join(", ")}. ${whyPrefix(state)}: ${reason}`;

  return {
    id: entry.id,
    label: entry.label,
    shortLabel:
      (entry.shortLabel ?? "").trim() !== ""
        ? (entry.shortLabel ?? "").trim()
        : abbreviateLabel(entry.label),
    ariaLabel,
    costGlyph: cost === null ? null : cornerGlyph(cost.glyphs),
    costLabel: cost?.label ?? null,
    seal: sealOf(entry),
    badge,
    state,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Tabs and groups (REQ-BAR-026)
// ---------------------------------------------------------------------------

/** The entries of one tab, in the order the provider gave them. */
export function entriesForTab(
  entries: readonly ActionBarEntry[],
  tab: ActionBarTab,
): ActionBarEntry[] {
  return entries.filter((entry) => entry.tab === tab);
}

export interface SlotGroup {
  /** The group's name ("Truques", "1º patamar"); undefined for entries that belong to none. */
  name: string | undefined;
  /** The counter of the group header ("2/3" of slots, the pips of focus), from the first entry that carries one. */
  uses: ActionBarEntry["groupUses"];
  entries: ActionBarEntry[];
}

/** Groups by `entry.group`, in the order each group first appears; the ungrouped form one group of their own. */
export function groupEntries(entries: readonly ActionBarEntry[]): SlotGroup[] {
  const groups: SlotGroup[] = [];
  for (const entry of entries) {
    let group = groups.find((candidate) => candidate.name === entry.group);
    if (group === undefined) {
      group = { name: entry.group, uses: undefined, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
    group.uses ??= entry.groupUses;
  }
  return groups;
}

// ---------------------------------------------------------------------------
// The short tooltip (REQ-BAR-044)
// ---------------------------------------------------------------------------

export interface TooltipView {
  title: string;
  /** "Golpe · corpo a corpo · alcance 5 pés". */
  subtitle: string;
  /** The cost with its glyphs in full ("◆ a ◆◆◆"); glyphs are empty for a textual time. */
  cost: { glyphs: string; label: string } | null;
  traits: string[];
  /**
   * The bonus or DC, and the variant it belongs to ("Bônus +9 (1º ataque)"). Null when there is
   * none, or when the effect line already says it ({@link figureSpan}): the bonus is drawn once.
   */
  numbers: { label: string | null; value: string; variant: string | null } | null;
  /** What changes next ("depois deste: MAP −10", REQ-BAR-039). */
  hint: string | null;
  effect: string | null;
  /**
   * Where the effect line says the bonus or DC itself (an index range into `effect`), or null. The
   * line then takes the place of the numbers row, with the figure in bold, as the prototype's does.
   */
  effectFigure: { start: number; end: number } | null;
  /** Why a faded entry is faded (REQ-BAR-031). */
  why: { kind: "unavailable" | "spent"; reason: string } | null;
  /** Which footer line: Alt is only promised when the system has a detail panel. */
  footer: "menu" | "alt-and-menu";
}

const KIND_KEY: Record<ActionBarEntryKind, string> = {
  strike: "FUSION.ActionBar.Kind.Strike",
  spell: "FUSION.ActionBar.Kind.Spell",
  action: "FUSION.ActionBar.Kind.Action",
  item: "FUSION.ActionBar.Kind.Item",
  reaction: "FUSION.ActionBar.Kind.Reaction",
  toggle: "FUSION.ActionBar.Kind.Toggle",
  check: "FUSION.ActionBar.Kind.Check",
};

/**
 * The name each tab wears on the TabBar. A provider that heads its tab with the tab's own name (the
 * prototype's T2 reads "GOLPES" over the strikes, which have no group of their own) writes this very
 * string into `group`, so the tooltip can tell a heading that only repeats the tab from a group.
 */
const TAB_KEY: Record<ActionBarTab, string> = {
  strikes: "FUSION.ActionBar.Tabs.Strikes",
  spells: "FUSION.ActionBar.Tabs.Spells",
  actions: "FUSION.ActionBar.Tabs.Actions",
  items: "FUSION.ActionBar.Tabs.Items",
  reactions: "FUSION.ActionBar.Tabs.Reactions",
  checks: "FUSION.ActionBar.Tabs.Checks",
};

/** A bonus ("+9", "−1") gets the word "Bônus"; a DC ("CD 18") says what it is by itself. */
const SIGNED_BONUS = /^[+−-]\s?\d/;

/** The typographic minus (U+2212) and the en dash read as the hyphen the sheet prints. */
function plainMinus(text: string): string {
  return text.replace(/[−–]/g, "-");
}

/**
 * Where `text` already says `figure` ("+5", "CD 18") as a figure of its own — not inside another
 * ("1d4+4" does not say "+4", "+50" does not say "+5") — or null. A provider may write the bonus into
 * the effect line, as the prototype does ("Bônus +5 (base +9, MAP −4) · Dano …"), and the tooltip then
 * does not repeat it in a row of its own (REQ-BAR-044: the bonus is shown once). The minus signs are
 * compared as one, character for character, so the span is an index into `text` itself.
 */
function figureSpan(text: string, figure: string): { start: number; end: number } | null {
  const needle = plainMinus(figure).trim();
  if (needle === "") return null;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(String.raw`(?<![\w+-])${escaped}(?!\w)`).exec(plainMinus(text));
  return match === null ? null : { start: match.index, end: match.index + match[0].length };
}

export function tooltipView(
  entry: ActionBarEntry,
  locale: SupportedLocale,
  options: { hasDetails: boolean },
): TooltipView {
  const feet =
    entry.range === undefined ? null : t("FUSION.ActionBar.Range.Feet", { feet: entry.range.feet });
  const rangeKind =
    entry.range === undefined
      ? null
      : t(
          entry.range.kind === "reach"
            ? "FUSION.ActionBar.Range.Reach"
            : "FUSION.ActionBar.Range.Ranged",
        );

  // A group that only repeats the name of the tab the entry sits on says nothing here: "Golpe · Golpes · corpo a
  // corpo" for a strike under the "Golpes" heading. A group that says something ("Classe", "Truques") stays.
  const group = entry.group === t(TAB_KEY[entry.tab]) ? undefined : entry.group;
  const subtitle = [t(KIND_KEY[entry.kind]), group, rangeKind, feet]
    .filter((part): part is string => part !== undefined && part !== null && part !== "")
    .join(" · ");

  const badge = slotBadge(entry);
  const variant = badgeVariant(entry);
  const effect = (entry.effect ?? "").trim();
  const effectFigure = badge === null ? null : figureSpan(effect, badge);
  const numbers =
    badge === null || effectFigure !== null
      ? null
      : {
          label: SIGNED_BONUS.test(badge) ? t("FUSION.ActionBar.Tooltip.Bonus") : null,
          value: badge,
          variant: variant?.badge !== undefined ? variant.label : null,
        };

  const state = STATE_OF[entry.state ?? "ready"];
  const reason = (entry.reason ?? "").trim();
  const why =
    (state === "unavailable" || state === "spent") && reason !== ""
      ? { kind: state, reason }
      : null;

  const hint =
    defaultVariants(entry).find((candidate) => candidate.hint !== undefined)?.hint ?? null;

  return {
    title: entry.label,
    subtitle,
    cost: costOf(entry, locale),
    traits: entry.traits ?? [],
    numbers,
    hint,
    effect: effect !== "" ? effect : null,
    effectFigure,
    why,
    footer: options.hasDetails ? "alt-and-menu" : "menu",
  };
}
