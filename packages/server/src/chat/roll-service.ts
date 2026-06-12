/**
 * RollService — server-side authoritative dice roller.
 *
 * REQ-ROL-024..026: server executes rolls with CSPRNG, records audit log.
 * REQ-ROL-025: MUST use crypto-grade RNG; Math.random() is forbidden.
 * REQ-ROL-026: stores seed in roll_audit_log, never sends it to clients.
 * REQ-ROL-049: seed never appears in RollResultData.
 * REQ-ROL-052: rejects formulas producing > maxDicePerRoll dice.
 *
 * The `rng` parameter is injectable for deterministic testing.
 * Production uses nodeCrypto via @dice-roller/rpg-dice-roller's built-in engine.
 */

import { randomBytes } from "node:crypto";
import type { Database as Db } from "better-sqlite3";
import { DiceRoll, NumberGenerator, Parser, exportFormats } from "@dice-roller/rpg-dice-roller";
import { createDocumentId } from "@fusion/shared";
import type { RollResultData, RollTermResult, DiceResult, RollMode } from "@fusion/shared";
import { replaceFormulaData, extractFlavor, MAX_DICE_PER_ROLL } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RollRequest {
  formula: string;
  rollData?: Record<string, unknown>;
  mode: RollMode;
  flavor?: string;
  worldId: string;
  userId: string;
  actorId?: string;
}

export interface RollServiceOptions {
  db: Db;
  /** Maximum dice per roll (DoS guard). Defaults to MAX_DICE_PER_ROLL. */
  maxDicePerRoll?: number;
  /**
   * Injectable RNG engine for tests — any object with `next(): number`.
   * Production leaves this undefined to use nodeCrypto.
   */
  rng?: { next(): number };
}

export class RollError extends Error {
  constructor(
    public readonly code:
      | "FORMULA_TOO_LARGE"
      | "FORMULA_INVALID"
      | "FORMULA_EMPTY"
      | "FORMULA_TOO_LONG",
    message: string,
  ) {
    super(message);
    this.name = "RollError";
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum characters in a formula string (DoS guard). */
const MAX_FORMULA_LENGTH = 512;

// ---------------------------------------------------------------------------
// Audit log schema (server-only — seed never leaves the server)
// ---------------------------------------------------------------------------

function ensureAuditTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roll_audit_log (
      roll_id          TEXT    PRIMARY KEY NOT NULL,
      world_id         TEXT    NOT NULL,
      user_id          TEXT    NOT NULL,
      actor_id         TEXT,
      formula          TEXT    NOT NULL,
      expanded_formula TEXT    NOT NULL,
      total            REAL    NOT NULL,
      seed             INTEGER NOT NULL,
      created_at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_roll_audit_world_user
      ON roll_audit_log(world_id, user_id, created_at);
  `);
}

function persistAudit(
  db: Db,
  entry: {
    rollId: string;
    worldId: string;
    userId: string;
    actorId: string | null;
    formula: string;
    expandedFormula: string;
    total: number;
    seed: number;
    createdAt: number;
  },
): void {
  db.prepare(
    `
    INSERT INTO roll_audit_log
      (roll_id, world_id, user_id, actor_id, formula, expanded_formula, total, seed, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    entry.rollId,
    entry.worldId,
    entry.userId,
    entry.actorId,
    entry.formula,
    entry.expandedFormula,
    entry.total,
    entry.seed,
    entry.createdAt,
  );
}

// ---------------------------------------------------------------------------
// RNG engine setup
// ---------------------------------------------------------------------------

/** Engine type — compatible with random-js Engine interface. */
interface RngEngine {
  next(): number;
}

/**
 * Build a CSPRNG engine based on Node.js `node:crypto`.
 *
 * The library's built-in `NumberGenerator.engines.nodeCrypto` uses CommonJS
 * `require()` internally and throws "require is not defined" under ESM at
 * call time (the function exists but fails when invoked). We therefore bypass
 * it entirely and build our own engine from the already-imported `randomBytes`.
 *
 * REQ-ROL-025: production MUST use crypto-grade RNG.
 */
function buildNativeNodeCryptoEngine(): RngEngine {
  return {
    next(): number {
      return randomBytes(4).readUInt32BE(0);
    },
  };
}

// ---------------------------------------------------------------------------
// Exported roll shape — the SOURCE OF TRUTH for term conversion
// ---------------------------------------------------------------------------
//
// CRITICAL: the LIVE DiceRoll.rolls instances (RollResults / ResultGroup) do
// NOT expose a `type` tag — that field only materializes on the exported /
// serialized form (toJSON / export(OBJECT)). Reading `term.type` off a live
// instance always yields `undefined`, so every term silently fell through to
// the numeric fallback (no results[]/faces/discarded/exploded), breaking the
// rich breakdown, crit/fumble flags, 3D dice, and the dice-count guard.
//
// We therefore convert over `diceRoll.export(exportFormats.OBJECT)` where each
// dice term genuinely carries `type === "roll-results"` and each individual die
// carries `value` / `useInTotal` / `modifiers`.

/** A single exported die within a `roll-results` term. */
interface ExportedDie {
  value?: number;
  initialValue?: number;
  useInTotal?: boolean;
  modifiers?: string[];
}

/** An exported `roll-results` (standard dice group) term. */
interface ExportedRollResults {
  type: "roll-results";
  value?: number;
  rolls?: ExportedDie[];
}

/** An exported `result-group` (pool / brace group) term — may nest recursively. */
interface ExportedResultGroup {
  type: "result-group";
  value?: number;
  calculationValue?: number;
  isRollGroup?: boolean;
  results?: ExportedTerm[];
}

/** Any element in the exported `rolls` array. */
type ExportedTerm = string | number | ExportedRollResults | ExportedResultGroup;

/** The shape of `DiceRoll.export(exportFormats.OBJECT)` that we rely on. */
interface ExportedRoll {
  rolls: ExportedTerm[];
  total?: number;
}

/**
 * Export a DiceRoll to its plain-object form.
 *
 * Uses the library's `export(exportFormats.OBJECT)` API. Should the library's
 * typings drift, `JSON.parse(JSON.stringify(diceRoll))` is byte-equivalent and
 * an acceptable fallback (both run the same internal `toJSON`).
 */
function exportRoll(diceRoll: DiceRoll): ExportedRoll {
  const exported = (diceRoll as unknown as { export(format: number): unknown }).export(
    exportFormats.OBJECT,
  );
  return exported as ExportedRoll;
}

function isRollResults(term: ExportedTerm): term is ExportedRollResults {
  return typeof term === "object" && term.type === "roll-results";
}

function isResultGroup(term: ExportedTerm): term is ExportedResultGroup {
  return typeof term === "object" && term.type === "result-group";
}

// ---------------------------------------------------------------------------
// Term conversion — exported DiceRoll → RollTermResult[]
// ---------------------------------------------------------------------------

/** Map a single exported die to a DiceResult, decoding its modifier flags. */
function convertDie(die: ExportedDie): DiceResult {
  const mods = die.modifiers ?? [];
  return {
    result: die.value ?? 0,
    active: die.useInTotal ?? true,
    discarded:
      mods.includes("drop") || mods.includes("drop-lowest") || mods.includes("drop-highest"),
    rerolled: mods.includes("re-roll") || mods.includes("reroll"),
    exploded: mods.includes("explode") || mods.includes("penetrate") || mods.includes("compound"),
    success: mods.includes("critical-success") || mods.includes("target-success"),
    failure: mods.includes("critical-failure") || mods.includes("target-failure"),
  };
}

/**
 * AST hint for a dice term, derived from `Parser.parse()`. The live RollResults
 * instance carries neither `type` nor `sides`/`qty` on its own enumerable keys,
 * but the parsed `StandardDice` AST node — which aligns positionally with the
 * exported rolls array — exposes `sides`, `qty`, and a clean per-term notation.
 */
interface DiceTermHint {
  expression: string;
  faces?: number;
}

/** Faces of a StandardDice term (numeric sides; % → 100; fudge → undefined). */
function facesOf(sides: unknown): number | undefined {
  if (typeof sides === "number" && Number.isFinite(sides)) return sides;
  if (sides === "%") return 100;
  return undefined;
}

/**
 * Convert one exported `roll-results` term into a `dice` RollTermResult.
 * `number`/`faces` come from the aligned AST hint when available, falling back
 * to the term expression / die count.
 */
function convertRollResultsTerm(
  term: ExportedRollResults,
  expression: string,
  hint?: DiceTermHint,
): RollTermResult {
  const dice: ExportedDie[] = term.rolls ?? [];
  const results: DiceResult[] = dice.map(convertDie);

  const total =
    typeof term.value === "number"
      ? term.value
      : results.filter((d) => d.active).reduce((s, d) => s + d.result, 0);

  // faces: prefer the AST hint, else parse from the expression (e.g. "1d20").
  let faces = hint?.faces;
  if (faces === undefined) {
    const diceMatch = /(\d*)d(\d+|%)/i.exec(expression);
    const facesRaw = diceMatch?.[2];
    if (facesRaw === "%") faces = 100;
    else if (facesRaw && /^\d+$/.test(facesRaw)) faces = parseInt(facesRaw, 10);
  }

  // number: the actual count of rolled dice (exploding can exceed the declared
  // qty, so the result length is the source of truth for the 3D animation).
  const number = results.length;

  return { type: "dice", expression, total, number, faces, results };
}

/**
 * Recursively collect every die from an exported term (including dice nested
 * inside pool / brace `result-group`s) so dice-box and the breakdown still see
 * the individual dice of a pool.
 */
function collectDiceTerms(term: ExportedTerm, exprBase: string): RollTermResult[] {
  if (isRollResults(term)) {
    return [convertRollResultsTerm(term, exprBase)];
  }
  if (isResultGroup(term)) {
    const out: RollTermResult[] = [];
    for (const sub of term.results ?? []) {
      out.push(...collectDiceTerms(sub, exprBase));
    }
    return out;
  }
  return [];
}

/**
 * Convert a single exported top-level term to a RollTermResult.
 */
function convertTerm(term: ExportedTerm, expression: string, hint?: DiceTermHint): RollTermResult {
  // String → operator
  if (typeof term === "string") {
    return { type: "operator", expression: term, total: 0 };
  }

  // Number → numeric constant
  if (typeof term === "number") {
    return { type: "numeric", expression: String(term), total: term };
  }

  // roll-results (standard dice group)
  if (isRollResults(term)) {
    return convertRollResultsTerm(term, expression, hint);
  }

  // result-group — parenthetical (single result) or pool (multiple results)
  if (isResultGroup(term)) {
    const results = term.results ?? [];
    const subTotal = typeof term.value === "number" ? term.value : (term.calculationValue ?? 0);
    const isPool = Array.isArray(results) && results.length > 1;
    return { type: isPool ? "pool" : "parenthetical", expression, total: subTotal };
  }

  // Fallback — numeric with unknown value
  return { type: "numeric", expression, total: 0 };
}

/**
 * Parse the formula AST and build per-position hints (expression + faces) that
 * align with the exported rolls array. Returns an empty array if parsing fails
 * (the converter then falls back to expression-based heuristics).
 */
function buildAstHints(formula: string): DiceTermHint[] {
  let parsed: unknown[];
  try {
    parsed = Parser.parse(formula) as unknown[];
  } catch {
    return [];
  }
  return parsed.map((node): DiceTermHint => {
    const expression = stringifyAstNode(node);
    if (node !== null && typeof node === "object") {
      const n = node as { sides?: unknown };
      const faces = facesOf(n.sides);
      if (faces !== undefined) return { expression, faces };
    }
    return { expression };
  });
}

/**
 * Stringify a parsed AST node. Operator strings / numeric literals stringify
 * trivially; dice/group AST instances (StandardDice, RollGroup) expose a custom
 * `toString()` that yields their clean notation (e.g. "4d6kh3", "{2d6, 3d8}kh1").
 * We call that `toString()` explicitly so eslint's no-base-to-string rule does
 * not flag the object (the default `[object Object]` is never produced here).
 */
function stringifyAstNode(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (node !== null && typeof node === "object") {
    const toStr = (node as { toString?: () => string }).toString;
    if (typeof toStr === "function") return toStr.call(node);
  }
  return "";
}

/**
 * Convert all terms from a DiceRoll into RollTermResult[], operating on the
 * exported (plain-object) form where dice terms carry a real `type` tag.
 *
 * Top-level terms map 1:1 to RollTermResult, using the positionally-aligned AST
 * for accurate per-term expressions and faces. Pool / brace `result-group`
 * terms additionally have their nested dice extracted and appended as `dice`
 * terms so the client (breakdown + 3D dice) sees every individual die.
 */
function convertRollToTerms(diceRoll: DiceRoll): RollTermResult[] {
  const exported = exportRoll(diceRoll);
  const rawRolls = exported.rolls;
  if (!Array.isArray(rawRolls)) return [];

  const fullExpr = diceRoll.notation;
  const hints = buildAstHints(fullExpr);
  const terms: RollTermResult[] = [];

  rawRolls.forEach((term, i) => {
    const hint = hints[i];
    const expr = exprForTerm(term, hint, fullExpr, i);
    terms.push(convertTerm(term, expr, hint));
    // For pools / brace groups, also surface the nested dice as `dice` terms so
    // mapRollToDiceBoxNotations and the breakdown can render individual dice.
    if (isResultGroup(term)) {
      terms.push(...collectDiceTerms(term, expr));
    }
  });

  return terms;
}

/**
 * Best-effort expression label for a term. Prefers the aligned AST expression;
 * operators/numbers stringify cleanly; dice/group terms fall back to the whole
 * formula notation (the breakdown re-parses faces from this) or the term index.
 */
function exprForTerm(
  term: ExportedTerm,
  hint: DiceTermHint | undefined,
  fullExpr: string,
  index: number,
): string {
  if (typeof term === "string") return term;
  if (typeof term === "number") return String(term);
  if (hint && hint.expression.trim().length > 0) return hint.expression;
  // Dice / group fallback: prefer the whole formula so the faces regex can
  // match a dice notation; fall back to the index if the formula is empty.
  return fullExpr && fullExpr.trim().length > 0 ? fullExpr : String(index);
}

// ---------------------------------------------------------------------------
// Dice count validation — REQ-ROL-052
// ---------------------------------------------------------------------------

/**
 * Count the total number of individual die results across all terms of a roll,
 * operating on the exported form (where dice terms expose a real `type` tag and
 * a populated `rolls[]`). Recurses into pool / brace `result-group`s.
 *
 * REQ-ROL-052: authoritative server-side limit check after parsing.
 */
function countDiceInRoll(diceRoll: DiceRoll): number {
  const exported = exportRoll(diceRoll);
  if (!Array.isArray(exported.rolls)) return 0;

  const countTerm = (term: ExportedTerm): number => {
    if (isRollResults(term)) {
      return Array.isArray(term.rolls) ? term.rolls.length : 0;
    }
    if (isResultGroup(term)) {
      return (term.results ?? []).reduce<number>((sum, sub) => sum + countTerm(sub), 0);
    }
    return 0;
  };

  return exported.rolls.reduce<number>((sum, term) => sum + countTerm(term), 0);
}

// ---------------------------------------------------------------------------
// normalizeExplodingNotation — x → ! (spec note from SHARED-ROLL agent)
// ---------------------------------------------------------------------------

/**
 * Normalize Foundry-style exploding `x` to rpg-dice-roller `!`.
 * e.g. "3d6x" → "3d6!" ; "6d10xo" → "6d10!o"
 */
function normalizeExplodingNotation(formula: string): string {
  return formula.replace(/(\d+d\d+)x(o)?/gi, (_m, dice: string, once?: string) => {
    return `${dice}!${once ?? ""}`;
  });
}

// ---------------------------------------------------------------------------
// RollService
// ---------------------------------------------------------------------------

export class RollService {
  private readonly db: Db;
  private readonly maxDice: number;
  private readonly engine: RngEngine;

  /**
   * @param options.rng Optional engine override (tests only).
   *
   * WARNING — GLOBAL MUTABLE STATE: `@dice-roller/rpg-dice-roller` exposes a
   * single process-wide RNG via `NumberGenerator.generator.engine`. The library
   * offers no per-DiceRoll engine injection, so the constructor MUST assign this
   * global, and the assignment is shared across EVERY RollService instance and
   * every `new DiceRoll()` in the process.
   *
   * Consequences for tests:
   *  - Constructing a RollService with an injected `rng` mutates the global
   *    engine for the whole process — there is no isolation between instances.
   *  - Tests that inject a deterministic engine MUST restore the original engine
   *    in `afterEach` (see the `withDeterministicEngine` helper in the test
   *    suite) to avoid leaking determinism into unrelated tests, which would
   *    otherwise produce cross-test flakiness.
   */
  constructor(options: RollServiceOptions) {
    this.db = options.db;
    this.maxDice = options.maxDicePerRoll ?? MAX_DICE_PER_ROLL;

    // Ensure audit table exists
    ensureAuditTable(this.db);

    // Set up RNG — inject for tests, use native node:crypto in production.
    // REQ-ROL-025: production MUST use crypto-grade RNG.
    // NOTE: Do NOT use NumberGenerator.engines.nodeCrypto — it calls CJS
    // require() internally and throws "require is not defined" under ESM.
    this.engine = options.rng ?? buildNativeNodeCryptoEngine();

    // Wire the chosen engine into the library's GLOBAL generator (see the
    // constructor docblock) so that every DiceRoll instance created afterwards
    // uses CSPRNG (or the injected test engine) rather than the default
    // Math.random-based nativeMath engine. This mutation is process-wide.
    const gen = NumberGenerator as unknown as {
      generator?: { engine: RngEngine };
    };
    if (gen.generator) {
      gen.generator.engine = this.engine;
    }
  }

  /**
   * Execute a dice formula authoritatively on the server.
   *
   * Steps:
   *  1. Validate formula length.
   *  2. Extract flavor (# text) from formula.
   *  3. Substitute @attr references (REQ-ROL-015).
   *  4. Normalize exploding notation (x → !).
   *  5. Generate CSPRNG seed for audit log.
   *  6. Roll dice using rpg-dice-roller.
   *  7. Enforce dice count limit (REQ-ROL-052).
   *  8. Convert result to RollResultData (no seed).
   *  9. Persist audit entry with seed (REQ-ROL-026).
   * 10. Return RollResultData.
   */
  roll(req: RollRequest): RollResultData {
    const { formula, rollData = {}, mode, worldId, userId, actorId } = req;

    // 1. Length guard
    if (!formula || formula.trim().length === 0) {
      throw new RollError("FORMULA_EMPTY", "Formula cannot be empty");
    }
    if (formula.length > MAX_FORMULA_LENGTH) {
      throw new RollError(
        "FORMULA_TOO_LONG",
        `Formula exceeds maximum length of ${String(MAX_FORMULA_LENGTH)} characters`,
      );
    }

    // 2. Extract flavor from formula
    const { formula: formulaNoFlavor, flavor: extractedFlavor } = extractFlavor(formula);
    const effectiveFlavor = req.flavor ?? extractedFlavor;

    // 3. Substitute @attr (REQ-ROL-015)
    const { expanded: expandedFormula, warnings } = replaceFormulaData(formulaNoFlavor, rollData);

    // 4. Normalize exploding notation
    const normalizedFormula = normalizeExplodingNotation(expandedFormula);

    // 5. Generate a 32-bit seed for audit (REQ-ROL-026)
    const seedBuffer = randomBytes(4);
    const seed = seedBuffer.readUInt32BE(0);

    // 6. Roll — the global generator engine was configured in the constructor
    // to use nodeCrypto (production) or the injected test engine. DiceRoll
    // picks up the engine automatically via the library's global generator.
    let diceRoll: DiceRoll;
    try {
      diceRoll = new DiceRoll(normalizedFormula);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new RollError("FORMULA_INVALID", `Invalid formula "${expandedFormula}": ${msg}`);
    }

    // 7. Dice count limit (REQ-ROL-052)
    const diceCount = countDiceInRoll(diceRoll);
    if (diceCount > this.maxDice) {
      throw new RollError(
        "FORMULA_TOO_LARGE",
        `Formula would roll ${String(diceCount)} dice — maximum is ${String(this.maxDice)}`,
      );
    }

    // 8. Convert to RollResultData (seed NEVER included — REQ-ROL-049)
    const rollId = createDocumentId();
    const terms = convertRollToTerms(diceRoll);
    const now = Date.now();

    const result: RollResultData = {
      rollId,
      formula: formulaNoFlavor,
      expandedFormula,
      total: diceRoll.total,
      terms,
      flavor: effectiveFlavor,
      rollMode: mode,
      timestamp: now,
      warnings,
    };

    // 9. Persist audit log (REQ-ROL-026) — seed stored server-side only
    persistAudit(this.db, {
      rollId,
      worldId,
      userId,
      actorId: actorId ?? null,
      formula: formulaNoFlavor,
      expandedFormula,
      total: diceRoll.total,
      seed,
      createdAt: now,
    });

    return result;
  }
}
