/**
 * Roll-resolution registrar — BHR-F2-05 (imports ALQ-F4-09), plan §2.8 of the
 * Alquimista ("RuleElementRegistry e RollNotes"), spec 52 REQ-BHR-051..053/069/070.
 *
 * Asserts by the RULE:
 *   - a system registers AT MOST ONE roll resolver (the pure function the server
 *     calls to settle a roll's conditional modifiers and notes): a second one is
 *     a programming error and throws, like `registerActorMechanics`;
 *   - `onRollResolved(id, fn)` follows the SAME id+priority discipline as every
 *     other hook (REQ-SYS-138/139, REQ-BHR-070): duplicate id throws, callbacks
 *     are exposed already sorted by priority descending, ties by registration order;
 *   - a system that registers neither gets `rollResolver: null` and an empty list.
 */
import { describe, it, expect } from "vitest";
import { defineSystem } from "../system-module.js";
import type { RollResolverDefinition, RollResolvedHookFn } from "../effects.js";

const VALID_MANIFEST = {
  id: "test-system",
  title: "Test System",
  version: "0.1.0",
  engineCompat: ">=0.1.0 <2.0.0",
  authors: [{ name: "Test Author" }],
  documentTypes: {},
  languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
} as const;

const resolver: RollResolverDefinition = {
  resolve: () => ({ modifiers: [], total: 0, notes: [] }),
};

describe("registerRollResolver", () => {
  it("expõe o resolvedor registrado no SystemModule", () => {
    const mod = defineSystem(VALID_MANIFEST, (r) => {
      r.registerRollResolver(resolver);
    });
    expect(mod.rollResolver).toBe(resolver);
  });

  it("sem registro, rollResolver é null e não há ouvintes", () => {
    const mod = defineSystem(VALID_MANIFEST, () => {});
    expect(mod.rollResolver).toBeNull();
    expect(mod.onRollResolved).toEqual([]);
  });

  it("um segundo registro lança (no máximo um por sistema)", () => {
    expect(() =>
      defineSystem(VALID_MANIFEST, (r) => {
        r.registerRollResolver(resolver);
        r.registerRollResolver(resolver);
      }),
    ).toThrow(/registerRollResolver/);
  });
});

describe("onRollResolved", () => {
  const noop: RollResolvedHookFn = () => {};

  it("ordena por prioridade decrescente e, no empate, pela ordem de registro", () => {
    const mod = defineSystem(VALID_MANIFEST, (r) => {
      r.onRollResolved("a", noop);
      r.onRollResolved("b", noop, { priority: 10 });
      r.onRollResolved("c", noop);
    });
    expect(mod.onRollResolved.map((h) => h.id)).toEqual(["b", "a", "c"]);
    expect(mod.onRollResolved[0]?.priority).toBe(10);
  });

  it("id repetido lança (REQ-SYS-138)", () => {
    expect(() =>
      defineSystem(VALID_MANIFEST, (r) => {
        r.onRollResolved("dup", noop);
        r.onRollResolved("dup", noop);
      }),
    ).toThrow(/dup/);
  });
});
