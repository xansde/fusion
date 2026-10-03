import { describe, expect, it } from "vitest";
import {
  resolveWorldVariantRules,
  type WorldVariantRulesStoreSource,
} from "../documents/world-variant-rules.js";

function storeWith(settings: Record<string, unknown>[]): WorldVariantRulesStoreSource {
  return { getAll: () => settings };
}

describe("resolveWorldVariantRules (DEC-MCL-09 world-setting overlay)", () => {
  it("resolves both variants to undefined (unknown, not off) when no Setting document exists (achado 5)", () => {
    const resolved = resolveWorldVariantRules(storeWith([]), { manifest: { id: "pf2e" } });
    expect(resolved).toEqual({ classLevels: undefined, freeArchetype: undefined });
  });

  it("resolves an EXPLICIT false the same as an explicit true — a GM who turns it off always wins", () => {
    const store = storeWith([{ _id: "s1", key: "pf2e:variantRules.classLevels", value: false }]);
    const resolved = resolveWorldVariantRules(store, { manifest: { id: "pf2e" } });
    expect(resolved.classLevels).toBe(false);
  });

  it("reads classLevels=true from a pf2e-namespaced Setting document; freeArchetype stays undefined (unset)", () => {
    const store = storeWith([{ _id: "s1", key: "pf2e:variantRules.classLevels", value: true }]);
    const resolved = resolveWorldVariantRules(store, { manifest: { id: "pf2e" } });
    expect(resolved).toEqual({ classLevels: true, freeArchetype: undefined });
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
    expect(resolved).toEqual({ classLevels: true, freeArchetype: undefined });
  });

  it("ignores a stored value that isn't literally true", () => {
    const store = storeWith([{ _id: "s1", key: "pf2e:variantRules.classLevels", value: "true" }]);
    const resolved = resolveWorldVariantRules(store, { manifest: { id: "pf2e" } });
    expect(resolved.classLevels).toBe(false);
  });

  it("degrades to both-undefined (not false) when store or systemModule is missing", () => {
    expect(resolveWorldVariantRules(undefined, { manifest: { id: "pf2e" } })).toEqual({
      classLevels: undefined,
      freeArchetype: undefined,
    });
    expect(resolveWorldVariantRules(storeWith([]), undefined)).toEqual({
      classLevels: undefined,
      freeArchetype: undefined,
    });
  });

  // HJ-09 (#434, D4): "perícias treinadas pela campanha" é setting de mundo; o
  // mesmo overlay que leva classLevels/freeArchetype ao doc leva a lista.
  describe("campaignSkills (HJ-09, setting `campaign.trainedSkills`)", () => {
    it("resolves to undefined (unknown, not empty) when no Setting document exists", () => {
      const resolved = resolveWorldVariantRules(storeWith([]), { manifest: { id: "pf2e" } });
      expect(resolved.campaignSkills).toBeUndefined();
    });

    it("reads the slug list from the system-namespaced Setting", () => {
      const store = storeWith([
        { _id: "s1", key: "pf2e:campaign.trainedSkills", value: ["occultism", "stealth"] },
      ]);
      const resolved = resolveWorldVariantRules(store, { manifest: { id: "pf2e" } });
      expect(resolved.campaignSkills).toEqual(["occultism", "stealth"]);
    });

    it("an EXPLICIT empty list is a value (the GM cleared it), not 'unknown'", () => {
      const store = storeWith([{ _id: "s1", key: "pf2e:campaign.trainedSkills", value: [] }]);
      const resolved = resolveWorldVariantRules(store, { manifest: { id: "pf2e" } });
      expect(resolved.campaignSkills).toEqual([]);
    });

    it("namespaces by the ACTIVE system id: a pf2e row never leaks into a misto world", () => {
      const store = storeWith([
        { _id: "s1", key: "pf2e:campaign.trainedSkills", value: ["occultism"] },
        { _id: "s2", key: "pf2e-sf2e:campaign.trainedSkills", value: ["piloting"] },
      ]);
      const resolved = resolveWorldVariantRules(store, { manifest: { id: "pf2e-sf2e" } });
      expect(resolved.campaignSkills).toEqual(["piloting"]);
    });

    it("drops anything that is not a slug string and de-duplicates (a forged value cannot reach the derivation)", () => {
      const store = storeWith([
        {
          _id: "s1",
          key: "pf2e:campaign.trainedSkills",
          value: ["occultism", "occultism", 7, null, "Not A Slug", "../x", "lore-x"],
        },
      ]);
      const resolved = resolveWorldVariantRules(store, { manifest: { id: "pf2e" } });
      expect(resolved.campaignSkills).toEqual(["occultism", "lore-x"]);
    });

    it("a non-array stored value resolves to an empty list, never throws", () => {
      const store = storeWith([{ _id: "s1", key: "pf2e:campaign.trainedSkills", value: "occultism" }]);
      const resolved = resolveWorldVariantRules(store, { manifest: { id: "pf2e" } });
      expect(resolved.campaignSkills).toEqual([]);
    });
  });
});
