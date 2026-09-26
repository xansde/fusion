import { describe, expect, it } from "vitest";
import {
  resolveWorldVariantRules,
  type WorldVariantRulesStoreSource,
} from "../documents/world-variant-rules.js";

function storeWith(settings: Record<string, unknown>[]): WorldVariantRulesStoreSource {
  return { getAll: () => settings };
}

describe("resolveWorldVariantRules (DEC-MCL-09 world-setting overlay)", () => {
  it("defaults both variants to false when no Setting document exists", () => {
    const resolved = resolveWorldVariantRules(storeWith([]), { manifest: { id: "pf2e" } });
    expect(resolved).toEqual({ classLevels: false, freeArchetype: false });
  });

  it("reads classLevels=true from a pf2e-namespaced Setting document", () => {
    const store = storeWith([{ _id: "s1", key: "pf2e:variantRules.classLevels", value: true }]);
    const resolved = resolveWorldVariantRules(store, { manifest: { id: "pf2e" } });
    expect(resolved).toEqual({ classLevels: true, freeArchetype: false });
  });

  it("reads both variants independently (Q-MCL-01)", () => {
    const store = storeWith([
      { _id: "s1", key: "pf2e:variantRules.classLevels", value: true },
      { _id: "s2", key: "pf2e:variantRules.freeArchetype", value: true },
    ]);
    const resolved = resolveWorldVariantRules(store, { manifest: { id: "pf2e" } });
    expect(resolved).toEqual({ classLevels: true, freeArchetype: true });
  });

  it("namespaces by the ACTIVE system id, e.g. the misto composite 'pf2e-sf2e'", () => {
    const store = storeWith([
      // A pure-pf2e-namespaced row must NOT leak into a misto world's resolution.
      { _id: "s1", key: "pf2e:variantRules.classLevels", value: true },
      { _id: "s2", key: "pf2e-sf2e:variantRules.classLevels", value: true },
    ]);
    const resolved = resolveWorldVariantRules(store, { manifest: { id: "pf2e-sf2e" } });
    expect(resolved).toEqual({ classLevels: true, freeArchetype: false });
  });

  it("ignores a stored value that isn't literally true", () => {
    const store = storeWith([{ _id: "s1", key: "pf2e:variantRules.classLevels", value: "true" }]);
    const resolved = resolveWorldVariantRules(store, { manifest: { id: "pf2e" } });
    expect(resolved.classLevels).toBe(false);
  });

  it("degrades to both-false when store or systemModule is missing", () => {
    expect(resolveWorldVariantRules(undefined, { manifest: { id: "pf2e" } })).toEqual({
      classLevels: false,
      freeArchetype: false,
    });
    expect(resolveWorldVariantRules(storeWith([]), undefined)).toEqual({
      classLevels: false,
      freeArchetype: false,
    });
  });
});
