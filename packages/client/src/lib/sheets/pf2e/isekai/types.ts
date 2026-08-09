/**
 * @fusion/system-pf2e — Isekai variant: content types.
 *
 * The Isekai layer is CONTENT (eight curated archetypes with their blessings,
 * actions and trackers), not a compendium pack: the set is fixed, small, and
 * every entry is mechanically wired to a tracker widget. Typing it here — and
 * keeping the data in `archetypes.ts` — means the client reads one typed
 * module instead of round-tripping through a pack it would then have to
 * re-validate.
 *
 * Player-facing text is pt-BR (the table's language), like the packs. Field
 * names and code stay in English, per the repo convention.
 */

/**
 * Action cost of an Isekai ability, in PF2e terms.
 *
 * `"none"` is for an ability with no action cost of its own (a passive, or
 * something spent during downtime / daily preparations) — it still shows in
 * the panel when it costs Focus, because "what can I spend Focus on" is the
 * question the panel answers.
 */
export type IsekaiActionCost = "1" | "2" | "3" | "reaction" | "free" | "none";

/** Where an ability comes from — drives grouping in the Plan and the panel. */
export type IsekaiAbilityOrigin = "major" | "minor" | "panel";

/**
 * A spendable Isekai ability: anything the player can DO at the table, as
 * opposed to a passive bonus.
 *
 * Only abilities that cost an action, a reaction or Focus become entries
 * here — a flat passive (Fodão's Couraça de Protagonista) is a Blessing and
 * nothing else. The Isekai tab lists these filtered by character level.
 */
export interface IsekaiAction {
  /** Stable id, unique within the archetype. Never the name (renames happen). */
  id: string;
  name: string;
  /** Character level at which it becomes available. */
  level: number;
  cost: IsekaiActionCost;
  /** Focus Points spent. 0 = free of Focus (but may still cost actions). */
  focus: number;
  /** Usage limit as written, when the ability has one (e.g. "1x por encontro"). */
  frequency?: string;
  /** Rules text, pt-BR. May contain inline `<b>` emphasis, like the packs. */
  text: string;
  origin: IsekaiAbilityOrigin;
}

/** A Minor Blessing — unlocks on its own at `level`, no slot budget, no pick. */
export interface IsekaiBlessing {
  level: number;
  name: string;
  /** Effect text, pt-BR. May contain inline `<b>`. */
  text: string;
}

/** A prose panel from the source material (recharge rules, design notes). */
export interface IsekaiPanel {
  title: string;
  subtitle?: string;
  paragraphs: readonly string[];
}

// ---------------------------------------------------------------------------
// Trackers
// ---------------------------------------------------------------------------

/**
 * The seven tracker widgets, one shape per archetype that needs state kept
 * between rolls. `kind` is the discriminant the client switches on.
 *
 * The Queridinho de Deus has NO tracker — deliberately. Its power lives in
 * the PF2e sheet (extra feats, wider prerequisites), not in a counter, and
 * inventing one for symmetry would be a widget with nothing to hold.
 */
export type IsekaiTrackerDef =
  | IsekaiDicePoolTracker
  | IsekaiRosterTracker
  | IsekaiCatalogTracker
  | IsekaiStockTracker
  | IsekaiStageTracker
  | IsekaiListTracker
  | IsekaiUsesTracker;

interface IsekaiTrackerBase {
  /** Unique within the archetype. */
  id: string;
  title: string;
  /** Help text shown under the widget, pt-BR. */
  note: string;
}

/** Sortudo — the Dados do Destino pool: real d20s rolled and banked. */
export interface IsekaiDicePoolTracker extends IsekaiTrackerBase {
  kind: "dice-pool";
  /** Dice rolled at the start of each day. */
  perDay: number;
  /** Extra die granted from a level onward (Pé de Coelho). */
  levelBonus?: { level: number; extra: number };
  /** Fixed values added from a level onward (A Casa Sempre Vence: a 20 and a 1). */
  fixedFrom?: { level: number; values: readonly number[] };
}

/** Carismático — the Séquito, in three tiers with caps. */
export interface IsekaiRosterTracker extends IsekaiTrackerBase {
  kind: "roster";
  tiers: readonly { id: "active" | "retinue" | "base"; label: string; cap: number | null }[];
  /** How many companions may follow the character at once (active + retinue). */
  followingCap: number;
  /** Level at which "Dar um Nome" unlocks — before it, the ★ affordance is inert. */
  namedFromLevel: number;
  /** Each ★ Named companion locks 1 point of the Focus maximum. */
  namedLocksFocus: boolean;
}

/** Evolutivo — the Catálogo do Predador: collected abilities, some prepared. */
export interface IsekaiCatalogTracker extends IsekaiTrackerBase {
  kind: "catalog";
  placeholder: string;
  /**
   * Level from which passives stop counting against the prepared limit
   * (Predador Supremo). `undefined` = never.
   */
  passivesUnlimitedFromLevel?: number;
}

/** Crafter — Essências de Monstro, counted per level, fusible upward. */
export interface IsekaiStockTracker extends IsekaiTrackerBase {
  kind: "stock";
  unitLabel: string;
  maxLevel: number;
  /** How many of level N fuse into one of level N+1. */
  fuseRatio: number;
}

/** Underdog — the Desespero stage (the "N" every Mark scales on). */
export interface IsekaiStageTracker extends IsekaiTrackerBase {
  kind: "stage";
  stages: readonly { value: number; label: string }[];
}

/** Especialista — the Assinaturas, capped by level, teachable. */
export interface IsekaiListTracker extends IsekaiTrackerBase {
  kind: "list";
  placeholder: string;
  /** Cap staircase: the highest entry with `level <= characterLevel` wins. */
  capByLevel: readonly { level: number; cap: number }[];
  /** Label of the ★ flag (e.g. "ensinada a um aliado"). */
  flagLabel: string;
  /** Each ★ flagged entry locks 1 point of the Focus maximum. */
  flagLocksFocus: boolean;
}

/** Fodão — limited-use abilities, checked off as spent. */
export interface IsekaiUsesTracker extends IsekaiTrackerBase {
  kind: "uses";
  uses: readonly { id: string; name: string; scope: string; level: number }[];
}

// ---------------------------------------------------------------------------
// Archetype
// ---------------------------------------------------------------------------

/** One of the eight Isekai archetypes. */
export interface IsekaiArchetype {
  /** Stable id — also the data key everywhere (never the display name). */
  id: string;
  name: string;
  /** Axis line, e.g. "EIXO DE COMBATE BRUTO". */
  axis: string;
  tagline: string;
  /** Accent colour, `#rrggbb`. Drives the card/chip accent in the sheet. */
  color: string;
  /** The PF2e law this archetype revokes — the design contract of the layer. */
  revokes: string;
  /** Anime/LN inspirations, as written. */
  inspirations: string;
  majorBlessing: { title: string; paragraphs: readonly string[] };
  /** Minor Blessings, ascending by level. */
  minorBlessings: readonly IsekaiBlessing[];
  /** Optional override of the default "how minors unlock" note. */
  minorsNote?: string;
  panels: readonly IsekaiPanel[];
  /** Everything spendable, for the Isekai tab's action list. */
  actions: readonly IsekaiAction[];
  /** The state widget, when this archetype needs one. */
  tracker?: IsekaiTrackerDef;
}
