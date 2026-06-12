/**
 * Regression tests for the RollService term converter and dice-count guard.
 *
 * These tests pin the FIX-1 / FIX-2 behavior: the converter must operate on the
 * EXPORTED form of the roll (where dice terms carry a real `type === "roll-results"`
 * tag and individual dice carry `value`/`useInTotal`/`modifiers`). The previous
 * implementation read `term.type` off the LIVE RollResults instance, where it is
 * always `undefined`, so every term collapsed to a numeric fallback with no
 * `results[]`, breaking the rich breakdown, crit/fumble flags, 3D dice mapping,
 * and the REQ-ROL-052 dice-count guard (which became dead code returning 0).
 *
 * RNG determinism — FIX-4: `@dice-roller/rpg-dice-roller` uses a single
 * process-wide engine (`NumberGenerator.generator.engine`). We inject a
 * deterministic queue engine and ALWAYS restore the original in afterEach so the
 * determinism does not leak into unrelated tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database as Db } from "better-sqlite3";
import { NumberGenerator } from "@dice-roller/rpg-dice-roller";

import { openDatabase } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { RollService, RollError } from "../chat/roll-service.js";
import type { DiceResult, RollTermResult } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Deterministic engine helper (FIX-4)
// ---------------------------------------------------------------------------

/**
 * Build a queue-based engine. For a standard die `dN` where `N-1` is NOT a
 * power-of-two-minus-one (d6, d10, d20, …), the library computes the face as
 * `(engine.next() % N) + 1` (random-js downscaleToLoopCheckedRange). So to force
 * a die to show face `v`, push the value `v - 1`. The queue cycles if exhausted.
 */
function faceQueueEngine(faces: number[]): { next(): number } {
  const queue = faces.map((f) => f - 1);
  let i = 0;
  return {
    next(): number {
      const v = queue[i % queue.length] ?? 0;
      i++;
      return v >>> 0;
    },
  };
}

/** Snapshot + restore wrapper around the library's GLOBAL engine. */
interface EngineGlobal {
  generator: { engine: { next(): number } };
}

function getGlobalEngine(): { next(): number } {
  return (NumberGenerator as unknown as EngineGlobal).generator.engine;
}

function setGlobalEngine(engine: { next(): number }): void {
  (NumberGenerator as unknown as EngineGlobal).generator.engine = engine;
}

// ---------------------------------------------------------------------------
// Test harness — a throwaway sqlite DB for the audit log
// ---------------------------------------------------------------------------

describe("RollService term converter (FIX-1) and dice-count guard (FIX-2)", () => {
  let dataDir: string;
  let fusionDb: FusionDatabase;
  let db: Db;
  let originalEngine: { next(): number };

  beforeEach(() => {
    dataDir = join(
      tmpdir(),
      `fusion-roll-conv-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(dataDir, { recursive: true });
    fusionDb = openDatabase({ path: join(dataDir, "world.db"), skipIntegrityCheck: true });
    db = fusionDb.raw;
    // Snapshot the global engine BEFORE any RollService mutates it (FIX-4).
    originalEngine = getGlobalEngine();
  });

  afterEach(() => {
    // Restore the library's global engine so determinism does not leak (FIX-4).
    setGlobalEngine(originalEngine);
    fusionDb.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function diceTerm(t: RollTermResult[], idx = 0): RollTermResult {
    const dice = t.filter((x) => x.type === "dice");
    const term = dice[idx];
    expect(term).toBeDefined();
    return term as RollTermResult;
  }

  // -------------------------------------------------------------------------
  // FIX-3 (a): keep-highest produces a real dice term with one discarded die.
  // -------------------------------------------------------------------------
  it("4d6kh3: dice term has 4 results, exactly one discarded, total = sum of top 3", () => {
    // Force d6 faces: 1, 6, 5, 4 — the 1 must be dropped, total = 6+5+4 = 15.
    const svc = new RollService({ db, rng: faceQueueEngine([1, 6, 5, 4]) });

    const result = svc.roll({
      formula: "4d6kh3",
      mode: "public",
      worldId: "w",
      userId: "u",
    });

    const term = diceTerm(result.terms);
    expect(term.type).toBe("dice");
    expect(term.faces).toBe(6);
    expect(term.results).toBeDefined();
    const dice = term.results as DiceResult[];
    expect(dice).toHaveLength(4);

    const discarded = dice.filter((d) => d.discarded === true);
    expect(discarded).toHaveLength(1);
    expect(discarded[0]?.result).toBe(1);
    expect(discarded[0]?.active).toBe(false);

    // Manual sum of the three kept (largest) dice: 6 + 5 + 4 = 15.
    expect(result.total).toBe(15);
    expect(term.total).toBe(15);
  });

  // -------------------------------------------------------------------------
  // FIX-3 (b): crit / fumble flags appear on the individual dice.
  // -------------------------------------------------------------------------
  it("2d20cs=20cf=1: success flag on the 20, failure flag on the 1", () => {
    // Force the two d20 to roll 20 then 1.
    const svc = new RollService({ db, rng: faceQueueEngine([20, 1]) });

    const result = svc.roll({
      formula: "2d20cs=20cf=1",
      mode: "public",
      worldId: "w",
      userId: "u",
    });

    const term = diceTerm(result.terms);
    expect(term.faces).toBe(20);
    const dice = term.results as DiceResult[];
    expect(dice).toHaveLength(2);

    const crit = dice.find((d) => d.result === 20);
    const fumble = dice.find((d) => d.result === 1);
    expect(crit?.success).toBe(true);
    expect(fumble?.failure).toBe(true);
    expect(result.total).toBe(21);
  });

  // -------------------------------------------------------------------------
  // Exploding dice surface the `exploded` flag.
  // -------------------------------------------------------------------------
  it("exploding dice mark the exploded die", () => {
    // 1d6! forcing a 6 (explodes) then a 2 (stops). next = face-1.
    const svc = new RollService({ db, rng: faceQueueEngine([6, 2]) });

    const result = svc.roll({ formula: "1d6!", mode: "public", worldId: "w", userId: "u" });
    const term = diceTerm(result.terms);
    const dice = term.results as DiceResult[];
    expect(dice.length).toBeGreaterThanOrEqual(2);
    expect(dice.some((d) => d.exploded === true)).toBe(true);
    expect(result.total).toBe(8);
  });

  // -------------------------------------------------------------------------
  // Multi-term formula: each dice term gets its OWN faces (no leakage).
  // -------------------------------------------------------------------------
  it("1d20 + 2d6: two distinct dice terms with correct faces, plus operator/numeric terms", () => {
    const svc = new RollService({ db, rng: faceQueueEngine([20, 3, 4]) });

    const result = svc.roll({
      formula: "1d20 + 2d6",
      mode: "public",
      worldId: "w",
      userId: "u",
    });

    const diceTerms = result.terms.filter((t) => t.type === "dice");
    expect(diceTerms).toHaveLength(2);
    expect(diceTerms[0]?.faces).toBe(20);
    expect(diceTerms[0]?.results).toHaveLength(1);
    expect(diceTerms[1]?.faces).toBe(6);
    expect(diceTerms[1]?.results).toHaveLength(2);

    // Operator term present.
    expect(result.terms.some((t) => t.type === "operator" && t.expression === "+")).toBe(true);

    // 20 + 3 + 4 = 27.
    expect(result.total).toBe(27);
  });

  // -------------------------------------------------------------------------
  // FIX-3 (c): multi-term giant formula exceeds maxDicePerRoll → FORMULA_TOO_LARGE.
  // -------------------------------------------------------------------------
  it("12 × 999d6 summed (= 11988 dice) is rejected with FORMULA_TOO_LARGE", () => {
    // Each term <= 999 (the library per-term cap), so the parser accepts it; the
    // SERVER dice-count guard must reject the 11988-dice total (> 10000).
    const svc = new RollService({ db, rng: faceQueueEngine([1]) });
    const formula = "999d6" + "+999d6".repeat(11);

    let thrown: unknown;
    try {
      svc.roll({ formula, mode: "public", worldId: "w", userId: "u" });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(RollError);
    expect((thrown as RollError).code).toBe("FORMULA_TOO_LARGE");
  });

  // -------------------------------------------------------------------------
  // A roll just under the limit is accepted (guard is not over-eager).
  // -------------------------------------------------------------------------
  it("a roll at exactly maxDicePerRoll is accepted (guard boundary)", () => {
    const svc = new RollService({ db, rng: faceQueueEngine([1]), maxDicePerRoll: 10 });
    // 10 dice — exactly the limit, must NOT throw.
    const result = svc.roll({ formula: "10d6", mode: "public", worldId: "w", userId: "u" });
    const term = diceTerm(result.terms);
    expect(term.results).toHaveLength(10);
  });

  it("a roll one over a custom maxDicePerRoll is rejected", () => {
    const svc = new RollService({ db, rng: faceQueueEngine([1]), maxDicePerRoll: 10 });
    expect(() =>
      svc.roll({ formula: "11d6", mode: "public", worldId: "w", userId: "u" }),
    ).toThrowError(RollError);
  });

  // -------------------------------------------------------------------------
  // Pool / brace group: nested dice are surfaced as dice terms (3D dice + breakdown).
  // -------------------------------------------------------------------------
  it("pool {2d6, 3d6}kh1 surfaces nested dice as dice terms", () => {
    const svc = new RollService({ db, rng: faceQueueEngine([6, 6, 6, 6, 6]) });
    const result = svc.roll({
      formula: "{2d6, 3d6}kh1",
      mode: "public",
      worldId: "w",
      userId: "u",
    });

    // At least one pool term plus the nested dice terms.
    expect(result.terms.some((t) => t.type === "pool")).toBe(true);
    const diceTerms = result.terms.filter((t) => t.type === "dice");
    expect(diceTerms.length).toBeGreaterThan(0);
    // Every surfaced dice term must carry real results.
    for (const t of diceTerms) {
      expect((t.results ?? []).length).toBeGreaterThan(0);
    }
  });
});
