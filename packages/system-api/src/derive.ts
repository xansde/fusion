/**
 * Derivation pipeline with explicit topological ordering.
 *
 * Solves the "prepareData hell" of Foundry VTT: instead of implicit
 * `prepareBaseData`/`prepareDerivedData` with numeric priorities, systems
 * declare DeriveSteps with explicit `reads`/`writes` edges, and the engine
 * sorts them topologically — guaranteeing deterministic execution order and
 * detecting dependency cycles at registration time.
 *
 * Contrast with Foundry:
 *   - Foundry: `prepareBaseData()` → `prepareDerivedData()` with optional
 *     numeric `priority` that authors must synchronize manually; cycles are
 *     silent bugs, not errors.
 *   - Fusion: explicit `reads`/`writes` paths → topological sort per phase
 *     (`"base"` before effects, `"derived"` after effects). Cycles are
 *     detected eagerly and reported with the full cycle path.
 *
 * REQ-SYS-020: registrar.derive(step)
 * REQ-SYS-021: phases — base → effects → derived
 * REQ-SYS-022: topological ordering within each phase
 * REQ-SYS-023: cycle detection with deterministic error
 * REQ-SYS-024: run is synchronous and I/O-pure
 * REQ-SYS-025: DeriveContext shape
 *
 * REQ-ARQ-005: system-api must NOT import from server or client.
 */
import type { DocumentType } from "./manifest.js";

// ---------------------------------------------------------------------------
// DeriveContext
// ---------------------------------------------------------------------------

/**
 * Context object passed to each DeriveStep.run().
 *
 * REQ-SYS-025.
 */
export interface DeriveContext {
  /**
   * The active SystemModule (for accessing manifest, models, etc.).
   * Typed as unknown here to avoid a circular import; callers cast it.
   */
  system: unknown;

  /**
   * Synthetics accumulator populated during the effects phase.
   * Available to "derived" phase steps; empty/null during "base" phase.
   */
  synthetics: Synthetics;

  /**
   * Current roll options (flags) for the document.
   */
  rollOptions: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Synthetics (populated by the effects engine during prepareData phase 3)
// REQ-SYS-088
// ---------------------------------------------------------------------------

/**
 * A deferred modifier factory: evaluated at roll time (not during prepareData)
 * so predicates can consider the target and roll context.
 * REQ-SYS-083.
 */
export type DeferredModifier = (options: ReadonlySet<string>) => ResolvedModifier | null;

/** A modifier resolved to a concrete numeric value. */
export interface ResolvedModifier {
  readonly slug: string;
  readonly label: string;
  readonly selector: string;
  readonly value: number;
  /** Stacking type: "circumstance" | "item" | "status" | "untyped" | ... */
  readonly type: string;
  readonly source: string;
}

/** A damage dice synthetic entry. */
export interface DamageDiceSynthetic {
  readonly slug: string;
  readonly selector: string;
  readonly diceNumber: number;
  readonly dieSize: string; // "d4" | "d6" | "d8" | "d10" | "d12"
  readonly label: string;
  readonly source: string;
}

/** A roll note to be appended to a result. */
export interface RollNote {
  readonly selector: string;
  readonly text: string;
  readonly predicate?: Predicate;
  readonly source: string;
}

/** An IWR (immunity/weakness/resistance) entry. */
export interface IwrEntry {
  readonly category: "immunity" | "weakness" | "resistance";
  readonly target: string; // damage type or condition slug
  readonly value?: number;
  readonly exceptions?: string[];
  readonly doubleVs?: string[];
  readonly source: string;
}

/** Degree-of-success adjustment. [V2] — reserved shape only. */
export interface DegreeAdjustment {
  readonly selector: string;
  readonly adjustment: "improve" | "worsen";
  readonly predicate?: Predicate;
  readonly source: string;
}

/**
 * Synthetics accumulator for a Document's prepared state.
 *
 * Populated during the effects phase (after "base" steps, before "derived"
 * steps). Consumed by "derived" DeriveSteps and by the roll engine.
 *
 * REQ-SYS-088.
 */
export interface Synthetics {
  /** Deferred modifier factories, keyed by selector. REQ-SYS-083. */
  readonly modifiers: Record<string, DeferredModifier[]>;

  /** Static damage dice, keyed by selector. */
  readonly damageDice: Record<string, DamageDiceSynthetic[]>;

  /** Roll notes, keyed by selector. */
  readonly rollNotes: Record<string, RollNote[]>;

  /**
   * Degree-of-success adjustments. [V2] — reserved.
   * @see REQ-SYS-082 [V2] adjustDegreeOfSuccess
   */
  readonly degreeOfSuccessAdjustments: Record<string, DegreeAdjustment[]>;

  /** Roll options injected by rollOption rule elements, keyed by domain. */
  readonly rollOptions: Record<string, Set<string>>;

  /** IWR entries. */
  readonly iwr: {
    immunities: IwrEntry[];
    weaknesses: IwrEntry[];
    resistances: IwrEntry[];
  };
}

/** Build an empty Synthetics accumulator. */
export function emptySynthetics(): Synthetics {
  return {
    modifiers: {},
    damageDice: {},
    rollNotes: {},
    degreeOfSuccessAdjustments: {},
    rollOptions: {},
    iwr: { immunities: [], weaknesses: [], resistances: [] },
  };
}

// ---------------------------------------------------------------------------
// Predicate (shared between effects and derive)
// REQ-SYS-086
// ---------------------------------------------------------------------------

/** A numeric comparison targeting a roll option that carries a numeric value. */
export type PredicateComparison =
  | { gte: [string, number] }
  | { lte: [string, number] }
  | { gt: [string, number] }
  | { lt: [string, number] }
  | { eq: [string, number | string] };

/** Compound logical operators. */
export type PredicateCompound =
  | { and: Predicate }
  | { or: Predicate }
  | { not: Predicate | PredicateTerm };

/** A single term in a predicate expression. */
export type PredicateTerm = string | PredicateCompound | PredicateComparison;

/**
 * A predicate expression: an array of terms that must ALL be satisfied
 * (implicit AND at the top level).
 *
 * - `string` term → presence check: `options.has(term)` must be true.
 * - `{ and: [...] }` → all children must pass.
 * - `{ or: [...] }` → at least one child must pass.
 * - `{ not: term | [...] }` → child must NOT pass.
 * - `{ gte/lte/gt/lt/eq: [option, number|string] }` → extracts a numeric
 *   suffix from a matching roll option and compares (e.g., option
 *   `"frightened:2"` has value `2`).
 *
 * REQ-SYS-086.
 */
export type Predicate = PredicateTerm[];

// ---------------------------------------------------------------------------
// Predicate evaluation
// REQ-SYS-086
// ---------------------------------------------------------------------------

/**
 * Evaluate a complete predicate against a set of roll options.
 *
 * Top-level: implicit AND over all terms.
 *
 * This function is pure and serializable-friendly — no eval(), no closures
 * over mutable state. REQ-SYS-134.
 */
export function evaluatePredicate(predicate: Predicate, options: ReadonlySet<string>): boolean {
  for (const term of predicate) {
    if (!evaluateTerm(term, options)) return false;
  }
  return true;
}

function evaluateTerm(term: PredicateTerm, options: ReadonlySet<string>): boolean {
  if (typeof term === "string") {
    return options.has(term);
  }

  if ("and" in term) {
    return evaluatePredicate(term.and, options);
  }
  if ("or" in term) {
    for (const child of term.or) {
      if (evaluateTerm(child, options)) return true;
    }
    return false;
  }
  if ("not" in term) {
    const child = term.not;
    if (Array.isArray(child)) {
      return !evaluatePredicate(child, options);
    }
    return !evaluateTerm(child, options);
  }

  // Numeric comparisons: "gte", "lte", "gt", "lt", "eq"
  if ("gte" in term) return compareRollOption(term.gte[0], term.gte[1], "gte", options);
  if ("lte" in term) return compareRollOption(term.lte[0], term.lte[1], "lte", options);
  if ("gt" in term) return compareRollOption(term.gt[0], term.gt[1], "gt", options);
  if ("lt" in term) return compareRollOption(term.lt[0], term.lt[1], "lt", options);
  if ("eq" in term) {
    const [optionKey, expected] = term.eq;
    if (typeof expected === "string") {
      return options.has(`${optionKey}:${expected}`) || options.has(expected);
    }
    return compareRollOption(optionKey, expected, "eq", options);
  }

  return false;
}

/**
 * Extract a numeric value from a roll option of the form `"key:N"` and compare.
 *
 * Example: option `"frightened:2"` with key `"frightened"` → value `2`.
 * If no matching option is found, the value is treated as 0.
 */
function compareRollOption(
  key: string,
  expected: number,
  op: "gte" | "lte" | "gt" | "lt" | "eq",
  options: ReadonlySet<string>,
): boolean {
  let value = 0;
  const prefix = `${key}:`;
  for (const opt of options) {
    if (opt.startsWith(prefix)) {
      const suffix = opt.slice(prefix.length);
      const parsed = Number(suffix);
      if (!Number.isNaN(parsed)) {
        value = parsed;
        break;
      }
    }
  }
  if (options.has(key)) value = value || 1; // bare flag counts as 1

  switch (op) {
    case "gte":
      return value >= expected;
    case "lte":
      return value <= expected;
    case "gt":
      return value > expected;
    case "lt":
      return value < expected;
    case "eq":
      return value === expected;
  }
}

// ---------------------------------------------------------------------------
// DeriveStep
// REQ-SYS-020
// ---------------------------------------------------------------------------

/** Any Document-shaped object (typed loosely to avoid circular import). */
export type AnyDocument = Record<string, unknown>;

/**
 * A single named derivation step.
 *
 * Systems declare these steps and the engine sorts them topologically.
 * This replaces Foundry's implicit `prepareBaseData`/`prepareDerivedData`
 * call order and magic numeric priorities.
 *
 * REQ-SYS-020.
 */
export interface DeriveStep<D extends AnyDocument = AnyDocument> {
  /**
   * Unique ID for this step. Used in topological graph and error messages.
   * Must be unique across all steps registered for a system.
   */
  readonly id: string;

  /** The DocumentType this step applies to (e.g., "Actor"). */
  readonly documentType: DocumentType;

  /** Subtypes this step applies to. Empty array means "all subtypes". */
  readonly subtypes: string[];

  /**
   * Phase of prepareData where this step runs.
   * - `"base"`: before effects are applied (access _source-derived values).
   * - `"derived"`: after effects populate synthetics (access modifier sums).
   *
   * REQ-SYS-021.
   */
  readonly phase: "base" | "derived";

  /**
   * Data paths this step reads. Used to build dependency graph edges:
   * this step runs AFTER any step that writes to a matching path.
   *
   * REQ-SYS-022.
   */
  readonly reads: string[];

  /**
   * Data paths this step writes. Used to build dependency graph edges:
   * any step that reads a matching path runs AFTER this step.
   *
   * REQ-SYS-022.
   */
  readonly writes: string[];

  /**
   * The derivation function. Must be synchronous and I/O-pure.
   * May mutate the provided document object (which is a working copy).
   *
   * REQ-SYS-024.
   */
  run(doc: D, ctx: DeriveContext): void;
}

// ---------------------------------------------------------------------------
// Topological sort with cycle detection
// REQ-SYS-022 / REQ-SYS-023
// ---------------------------------------------------------------------------

export class CyclicDependencyError extends Error {
  constructor(cycle: string[]) {
    super(
      `[derive] Cyclic dependency detected in DeriveSteps: ${cycle.join(" → ")}. ` +
        `Declare derivation steps without circular reads/writes to resolve this.`,
    );
    this.name = "CyclicDependencyError";
  }
}

/**
 * Sort a list of DeriveSteps topologically within a single phase.
 *
 * Two steps S_a and S_b have an edge S_a → S_b when:
 *   S_a.writes intersects S_b.reads
 * meaning S_b depends on the output of S_a and must run after it.
 *
 * REQ-SYS-022: correct execution order.
 * REQ-SYS-023: throws CyclicDependencyError naming the full cycle.
 */
export function topoSort(steps: DeriveStep[]): DeriveStep[] {
  if (steps.length === 0) return [];

  const ids: string[] = steps.map((s) => s.id);
  const indexById = new Map<string, number>(ids.map((id, i) => [id, i]));

  // Build adjacency: step i → set of step indices that depend on it (i runs first).
  const deps = new Map<number, Set<number>>();
  const inDegree: number[] = new Array<number>(steps.length).fill(0);

  for (let i = 0; i < steps.length; i++) {
    if (!deps.has(i)) deps.set(i, new Set());
  }

  for (let i = 0; i < steps.length; i++) {
    const si = steps[i];
    if (!si) continue;
    for (let j = 0; j < steps.length; j++) {
      if (i === j) continue;
      const sj = steps[j];
      if (!sj) continue;
      // Step j reads something that step i writes → i must precede j
      const intersects = si.writes.some((w) => sj.reads.includes(w));
      if (intersects) {
        deps.get(i)?.add(j);
        inDegree[j] = (inDegree[j] ?? 0) + 1;
      }
    }
  }

  // Kahn's algorithm for topological sort
  const queue: number[] = [];
  for (let i = 0; i < steps.length; i++) {
    if ((inDegree[i] ?? 0) === 0) queue.push(i);
  }

  // Use a stable sort of initial queue to make output deterministic
  queue.sort((a, b) => (ids[a] ?? "").localeCompare(ids[b] ?? ""));

  const sorted: DeriveStep[] = [];
  while (queue.length > 0) {
    // queue.length > 0 guarantees shift() returns a number, but TypeScript does not narrow this
    const node = queue.shift() ?? 0;
    const step = steps[node];
    if (step) sorted.push(step);
    const neighbors = [...(deps.get(node) ?? [])].sort((a, b) =>
      (ids[a] ?? "").localeCompare(ids[b] ?? ""),
    );
    for (const neighbor of neighbors) {
      inDegree[neighbor] = (inDegree[neighbor] ?? 0) - 1;
      if ((inDegree[neighbor] ?? 0) === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (sorted.length !== steps.length) {
    // Find the cycle for a helpful error message
    const cycle = findCycle(steps, deps, indexById);
    throw new CyclicDependencyError(cycle);
  }

  return sorted;
}

/** Reconstruct one cycle path using DFS for error reporting. */
function findCycle(
  steps: DeriveStep[],
  deps: Map<number, Set<number>>,
  _indexById: Map<string, number>,
): string[] {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color: number[] = new Array<number>(steps.length).fill(WHITE);
  const parent: number[] = new Array<number>(steps.length).fill(-1);
  let cycleStart = -1;
  let cycleEnd = -1;

  function dfs(u: number): boolean {
    color[u] = GRAY;
    for (const v of deps.get(u) ?? []) {
      if ((color[v] ?? WHITE) === GRAY) {
        cycleStart = v;
        cycleEnd = u;
        return true;
      }
      if ((color[v] ?? WHITE) === WHITE) {
        parent[v] = u;
        if (dfs(v)) return true;
      }
    }
    color[u] = BLACK;
    return false;
  }

  for (let i = 0; i < steps.length; i++) {
    if ((color[i] ?? WHITE) === WHITE && dfs(i)) break;
  }

  if (cycleStart === -1) {
    return steps.map((s) => s.id);
  }

  // Trace the cycle from cycleStart back through parent[] to cycleEnd
  const startStep = steps[cycleStart];
  const path: string[] = [startStep ? startStep.id : String(cycleStart)];
  let cur = cycleEnd;
  const seen = new Set<number>();
  while (cur !== cycleStart && cur !== -1 && !seen.has(cur)) {
    seen.add(cur);
    const curStep = steps[cur];
    if (curStep) path.unshift(curStep.id);
    cur = parent[cur] ?? -1;
  }
  // Close the loop
  if (startStep) path.push(startStep.id);
  return path;
}

// ---------------------------------------------------------------------------
// DeriveStepRegistry — accumulator used during defineSystem build
// ---------------------------------------------------------------------------

/**
 * Accumulates DeriveSteps and exposes sorted access per (phase, documentType).
 *
 * Call `add()` during system registration.
 * Call `sortedForPhase()` during prepareData execution.
 * Throws CyclicDependencyError on first access if cycles exist.
 */
export class DeriveStepRegistry {
  private readonly _steps: DeriveStep[] = [];

  /** Register a derivation step. */
  add(step: DeriveStep): void {
    this._steps.push(step);
  }

  /** All registered steps (in declaration order). */
  get all(): readonly DeriveStep[] {
    return this._steps;
  }

  /**
   * Return topologically sorted steps for a given phase + documentType + subtype.
   *
   * Throws CyclicDependencyError if a cycle exists among the matched steps.
   *
   * REQ-SYS-022 / REQ-SYS-023.
   */
  sortedForPhase(phase: "base" | "derived", documentType: string, subtype: string): DeriveStep[] {
    const candidates = this._steps.filter(
      (s) =>
        s.phase === phase &&
        s.documentType === documentType &&
        (s.subtypes.length === 0 || s.subtypes.includes(subtype)),
    );
    return topoSort(candidates);
  }
}
