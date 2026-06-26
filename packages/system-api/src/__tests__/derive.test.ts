/**
 * Tests for the derivation pipeline:
 *   - DeriveStepRegistry: add / sortedForPhase / filtering
 *   - topoSort: correct ordering, cycle detection
 *   - evaluatePredicate: string, and, or, not, numeric comparisons
 *
 * REQ-SYS-020..023 / REQ-SYS-086.
 */
import { describe, it, expect } from "vitest";
import {
  DeriveStepRegistry,
  topoSort,
  CyclicDependencyError,
  evaluatePredicate,
  emptySynthetics,
  type DeriveStep,
} from "../derive.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep(overrides: Partial<DeriveStep> & { id: string }): DeriveStep {
  return {
    documentType: "Actor",
    subtypes: ["character"],
    phase: "base",
    reads: [],
    writes: [],
    run: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// topoSort
// ---------------------------------------------------------------------------

describe("topoSort", () => {
  it("returns empty for empty input", () => {
    expect(topoSort([])).toEqual([]);
  });

  it("preserves single step", () => {
    const step = makeStep({ id: "a" });
    expect(topoSort([step])).toEqual([step]);
  });

  it("orders A before B when A writes what B reads", () => {
    const a = makeStep({ id: "a", writes: ["system.x"] });
    const b = makeStep({ id: "b", reads: ["system.x"] });

    // Regardless of declaration order (b, a), a must come first
    const sorted = topoSort([b, a]);
    expect(sorted[0].id).toBe("a");
    expect(sorted[1].id).toBe("b");
  });

  it("handles a diamond dependency: A → B, A → C, B + C → D", () => {
    const a = makeStep({ id: "a", writes: ["x"] });
    const b = makeStep({ id: "b", reads: ["x"], writes: ["y"] });
    const c = makeStep({ id: "c", reads: ["x"], writes: ["z"] });
    const d = makeStep({ id: "d", reads: ["y", "z"] });

    const sorted = topoSort([d, c, b, a]);
    const ids = sorted.map((s) => s.id);

    expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
    expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("c"));
    expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("d"));
    expect(ids.indexOf("c")).toBeLessThan(ids.indexOf("d"));
  });

  it("is deterministic: same input → same output (alphabetic tiebreak)", () => {
    // Three independent steps — should come out alphabetically
    const x = makeStep({ id: "x" });
    const a = makeStep({ id: "a" });
    const m = makeStep({ id: "m" });

    const sorted = topoSort([x, a, m]);
    expect(sorted.map((s) => s.id)).toEqual(["a", "m", "x"]);
  });

  it("throws CyclicDependencyError for a direct cycle A ↔ B", () => {
    const a = makeStep({ id: "a", reads: ["system.b"], writes: ["system.a"] });
    const b = makeStep({ id: "b", reads: ["system.a"], writes: ["system.b"] });

    expect(() => topoSort([a, b])).toThrow(CyclicDependencyError);
  });

  it("cycle error message names the cycle steps", () => {
    const a = makeStep({ id: "step-a", reads: ["q"], writes: ["p"] });
    const b = makeStep({ id: "step-b", reads: ["p"], writes: ["q"] });

    try {
      topoSort([a, b]);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CyclicDependencyError);
      const msg = (err as Error).message;
      expect(msg).toContain("step-a");
      expect(msg).toContain("step-b");
    }
  });

  it("throws CyclicDependencyError for a 3-step cycle", () => {
    const a = makeStep({ id: "a", reads: ["z"], writes: ["x"] });
    const b = makeStep({ id: "b", reads: ["x"], writes: ["y"] });
    const c = makeStep({ id: "c", reads: ["y"], writes: ["z"] });

    expect(() => topoSort([a, b, c])).toThrow(CyclicDependencyError);
  });
});

// ---------------------------------------------------------------------------
// DeriveStepRegistry
// ---------------------------------------------------------------------------

describe("DeriveStepRegistry", () => {
  it("starts empty", () => {
    const r = new DeriveStepRegistry();
    expect(r.all).toHaveLength(0);
  });

  it("stores added steps", () => {
    const r = new DeriveStepRegistry();
    const s = makeStep({ id: "s1" });
    r.add(s);
    expect(r.all).toHaveLength(1);
    expect(r.all[0]).toBe(s);
  });

  it("sortedForPhase filters by phase", () => {
    const r = new DeriveStepRegistry();
    r.add(makeStep({ id: "base-1", phase: "base" }));
    r.add(makeStep({ id: "derived-1", phase: "derived" }));

    const base = r.sortedForPhase("base", "Actor", "character");
    expect(base).toHaveLength(1);
    expect(base[0].id).toBe("base-1");

    const derived = r.sortedForPhase("derived", "Actor", "character");
    expect(derived).toHaveLength(1);
    expect(derived[0].id).toBe("derived-1");
  });

  it("sortedForPhase filters by documentType", () => {
    const r = new DeriveStepRegistry();
    r.add(makeStep({ id: "actor-step", documentType: "Actor" }));
    r.add(makeStep({ id: "item-step", documentType: "Item" }));

    const actorSteps = r.sortedForPhase("base", "Actor", "character");
    expect(actorSteps.map((s) => s.id)).toEqual(["actor-step"]);
  });

  it("sortedForPhase filters by subtype (non-empty subtypes list)", () => {
    const r = new DeriveStepRegistry();
    r.add(makeStep({ id: "char-step", subtypes: ["character"] }));
    r.add(makeStep({ id: "npc-step", subtypes: ["npc"] }));
    r.add(makeStep({ id: "all-step", subtypes: [] }));

    const charSteps = r.sortedForPhase("base", "Actor", "character");
    const ids = charSteps.map((s) => s.id).sort();
    expect(ids).toContain("char-step");
    expect(ids).toContain("all-step");
    expect(ids).not.toContain("npc-step");
  });

  it("sortedForPhase returns topologically sorted steps", () => {
    const r = new DeriveStepRegistry();
    r.add(makeStep({ id: "b", reads: ["system.score"], writes: ["system.mod"] }));
    r.add(makeStep({ id: "a", writes: ["system.score"] }));

    const sorted = r.sortedForPhase("base", "Actor", "character");
    expect(sorted[0].id).toBe("a");
    expect(sorted[1].id).toBe("b");
  });

  it("sortedForPhase throws on cyclic steps", () => {
    const r = new DeriveStepRegistry();
    r.add(makeStep({ id: "x", reads: ["b"], writes: ["a"] }));
    r.add(makeStep({ id: "y", reads: ["a"], writes: ["b"] }));

    expect(() => r.sortedForPhase("base", "Actor", "character")).toThrow(CyclicDependencyError);
  });

  // ── Minimal example from spec 15 §D3 ─────────────────────────────────────
  it("example from spec: derive ability modifier from score", () => {
    const r = new DeriveStepRegistry();

    r.add({
      id: "engine-2e.ability-score",
      documentType: "Actor",
      subtypes: ["character"],
      phase: "base",
      reads: [],
      writes: ["system.abilities.str.score"],
      run(doc, _ctx) {
        (doc as { system: { abilities: { str: { score: number } } } }).system.abilities.str.score =
          14; // fixed for test
      },
    });

    r.add({
      id: "engine-2e.ability-modifier",
      documentType: "Actor",
      subtypes: ["character"],
      phase: "base",
      reads: ["system.abilities.str.score"],
      writes: ["system.abilities.str.mod"],
      run(doc, _ctx) {
        const d = doc as { system: { abilities: { str: { score: number; mod: number } } } };
        d.system.abilities.str.mod = Math.floor((d.system.abilities.str.score - 10) / 2);
      },
    });

    const sorted = r.sortedForPhase("base", "Actor", "character");
    expect(sorted[0].id).toBe("engine-2e.ability-score");
    expect(sorted[1].id).toBe("engine-2e.ability-modifier");

    // Execute in order to verify correctness
    const doc = { system: { abilities: { str: { score: 0, mod: 0 } } } };
    const ctx = {
      system: {},
      synthetics: emptySynthetics(),
      rollOptions: new Set<string>(),
    };

    for (const step of sorted) {
      step.run(doc, ctx);
    }

    expect(doc.system.abilities.str.score).toBe(14);
    expect(doc.system.abilities.str.mod).toBe(2); // floor((14 - 10) / 2) = 2
  });
});

// ---------------------------------------------------------------------------
// evaluatePredicate
// REQ-SYS-086
// ---------------------------------------------------------------------------

describe("evaluatePredicate", () => {
  const opts = new Set(["target:condition:off-guard", "action:strike", "frightened:2"]);

  it("string term: present option returns true", () => {
    expect(evaluatePredicate(["action:strike"], opts)).toBe(true);
  });

  it("string term: absent option returns false", () => {
    expect(evaluatePredicate(["flanking"], opts)).toBe(false);
  });

  it("empty predicate returns true (vacuous truth)", () => {
    expect(evaluatePredicate([], opts)).toBe(true);
  });

  it("implicit AND: all terms must be present", () => {
    expect(evaluatePredicate(["action:strike", "target:condition:off-guard"], opts)).toBe(true);
    expect(evaluatePredicate(["action:strike", "flanking"], opts)).toBe(false);
  });

  it("{ or: [...] } — at least one must pass", () => {
    expect(evaluatePredicate([{ or: ["flanking", "action:strike"] }], opts)).toBe(true);
    expect(evaluatePredicate([{ or: ["flanking", "invisible"] }], opts)).toBe(false);
  });

  it("{ and: [...] } — all must pass", () => {
    expect(
      evaluatePredicate([{ and: ["action:strike", "target:condition:off-guard"] }], opts),
    ).toBe(true);
    expect(evaluatePredicate([{ and: ["action:strike", "flanking"] }], opts)).toBe(false);
  });

  it("{ not: 'option' } — option must be absent", () => {
    expect(evaluatePredicate([{ not: "flanking" }], opts)).toBe(true);
    expect(evaluatePredicate([{ not: "action:strike" }], opts)).toBe(false);
  });

  it("{ not: [...] } — negation of a predicate array", () => {
    expect(evaluatePredicate([{ not: ["flanking", "invisible"] }], opts)).toBe(true);
    expect(evaluatePredicate([{ not: ["action:strike"] }], opts)).toBe(false);
  });

  it("nested: { or: [{ and: [...] }, 'x'] }", () => {
    // or: (action:strike AND target:condition:off-guard) OR flanking
    const pred = [{ or: [{ and: ["action:strike", "target:condition:off-guard"] }, "flanking"] }];
    expect(evaluatePredicate(pred, opts)).toBe(true);
  });

  // Numeric comparisons
  it("{ gte: ['frightened', 2] } — frightened:2 satisfies >=2", () => {
    expect(evaluatePredicate([{ gte: ["frightened", 2] }], opts)).toBe(true);
    expect(evaluatePredicate([{ gte: ["frightened", 3] }], opts)).toBe(false);
  });

  it("{ lte: ['frightened', 2] } — frightened:2 satisfies <=2", () => {
    expect(evaluatePredicate([{ lte: ["frightened", 2] }], opts)).toBe(true);
    expect(evaluatePredicate([{ lte: ["frightened", 1] }], opts)).toBe(false);
  });

  it("{ gt: ['frightened', 1] } — frightened:2 satisfies >1", () => {
    expect(evaluatePredicate([{ gt: ["frightened", 1] }], opts)).toBe(true);
    expect(evaluatePredicate([{ gt: ["frightened", 2] }], opts)).toBe(false);
  });

  it("{ lt: ['frightened', 3] } — frightened:2 satisfies <3", () => {
    expect(evaluatePredicate([{ lt: ["frightened", 3] }], opts)).toBe(true);
    expect(evaluatePredicate([{ lt: ["frightened", 2] }], opts)).toBe(false);
  });

  it("{ eq: ['frightened', 2] } — frightened:2 equals 2", () => {
    expect(evaluatePredicate([{ eq: ["frightened", 2] }], opts)).toBe(true);
    expect(evaluatePredicate([{ eq: ["frightened", 1] }], opts)).toBe(false);
  });

  it("absent numeric option compares as 0", () => {
    // No "stunned:N" in opts → treated as 0
    expect(evaluatePredicate([{ gte: ["stunned", 0] }], opts)).toBe(true);
    expect(evaluatePredicate([{ gte: ["stunned", 1] }], opts)).toBe(false);
  });

  it("{ eq: ['someFlag', 'value'] } — checks for string-valued presence", () => {
    const s = new Set(["mode:stealth"]);
    expect(evaluatePredicate([{ eq: ["mode", "stealth"] }], s)).toBe(true);
    expect(evaluatePredicate([{ eq: ["mode", "combat"] }], s)).toBe(false);
  });
});
