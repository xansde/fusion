/**
 * Unit tests for the pure dedup fingerprint/index builder (mundo misto,
 * DEC-SF2-07-bis). No file I/O — fixtures below mirror the SHAPE of real
 * committed documents (see dedup-real-packs.test.ts for the non-circular
 * assertion against the actual pf2e/sf2e packs).
 */
import { describe, it, expect } from "vitest";
import { mechanicsFingerprint, buildDedupIndex, buildDocKey, slugify } from "../dedup.js";

function feat(over: Record<string, unknown>) {
  return {
    _id: "id-default",
    name: "Assurance",
    type: "feat",
    system: {
      level: 1,
      category: "skill",
      actionType: "passive",
      actions: null,
      traits: { value: ["fortune", "general", "skill"] },
      prerequisites: [{ value: "trained in at least one skill" }],
      rules: [],
      publication: { title: "Pathfinder Player Core" },
    },
    ...over,
  };
}

describe("slugify", () => {
  it("normalizes accents/case/punctuation", () => {
    expect(slugify("Assurance")).toBe("assurance");
    expect(slugify("Adopted Ancestry")).toBe("adopted-ancestry");
  });
});

describe("mechanicsFingerprint", () => {
  it("ignores description/publication/img/_id (only mechanics matter)", () => {
    const a = feat({ _id: "aaa", system: { ...feat({}).system, publication: { title: "X" } } });
    const b = feat({ _id: "bbb", system: { ...feat({}).system, publication: { title: "Y" } } });
    expect(mechanicsFingerprint(a)).toBe(mechanicsFingerprint(b));
  });

  it("differs when traits differ (real case: Reach Spell pf2e vs sf2e)", () => {
    const pf2eReach = feat({
      name: "Reach Spell",
      system: {
        ...feat({}).system,
        traits: { value: ["bard", "cleric", "concentrate", "wizard"] },
      },
    });
    const sf2eReach = feat({
      name: "Reach Spell",
      system: {
        ...feat({}).system,
        traits: { value: ["concentrate", "mystic", "witchwarper"] },
      },
    });
    expect(mechanicsFingerprint(pf2eReach)).not.toBe(mechanicsFingerprint(sf2eReach));
  });

  it("neutralizes @UUID[Compendium.<system>...] refs inside rules", () => {
    const a = feat({
      system: {
        ...feat({}).system,
        rules: [{ key: "GrantItem", uuid: "@UUID[Compendium.pf2e.feats-core.Item.ABC123]" }],
      },
    });
    const b = feat({
      system: {
        ...feat({}).system,
        rules: [{ key: "GrantItem", uuid: "@UUID[Compendium.sf2e.feats-core.Item.XYZ789]" }],
      },
    });
    expect(mechanicsFingerprint(a)).toBe(mechanicsFingerprint(b));
  });
});

describe("buildDedupIndex", () => {
  it("no-ops (empty result) with a single systemId — pure pf2e/sf2e world unaffected", () => {
    const result = buildDedupIndex([
      { packId: "pf2e.feats-core", systemId: "pf2e", docs: [feat({ _id: "a" })] },
      { packId: "pf2e.skill-feats-core", systemId: "pf2e", docs: [feat({ _id: "b" })] },
    ]);
    expect(result.hidden.size).toBe(0);
    expect(result.aliasTo.size).toBe(0);
  });

  it("fuses an identical reprint (Assurance-like) — pf2e wins, sf2e is hidden and aliased", () => {
    const pf2eDoc = feat({ _id: "pf2e-assurance" });
    const sf2eDoc = feat({
      _id: "sf2e-assurance",
      system: { ...feat({}).system, publication: { title: "Starfinder Player Core" } },
    });

    const result = buildDedupIndex([
      { packId: "pf2e.feats-core", systemId: "pf2e", docs: [pf2eDoc] },
      { packId: "sf2e.skill-feats-core", systemId: "sf2e", docs: [sf2eDoc] },
    ]);

    const pf2eKey = buildDocKey("pf2e.feats-core", "pf2e-assurance");
    const sf2eKey = buildDocKey("sf2e.skill-feats-core", "sf2e-assurance");

    expect(result.hidden.has(sf2eKey)).toBe(true);
    expect(result.hidden.has(pf2eKey)).toBe(false);
    expect(result.aliasTo.get(sf2eKey)).toBe(pf2eKey);
    expect(result.mergedFromSystems.get(pf2eKey)).toEqual(["sf2e"]);
  });

  it("keeps both when mechanics genuinely differ (Reach Spell-like)", () => {
    const pf2eDoc = feat({
      _id: "pf2e-reach",
      name: "Reach Spell",
      system: { ...feat({}).system, traits: { value: ["bard", "wizard"] } },
    });
    const sf2eDoc = feat({
      _id: "sf2e-reach",
      name: "Reach Spell",
      system: { ...feat({}).system, traits: { value: ["mystic", "witchwarper"] } },
    });

    const result = buildDedupIndex([
      { packId: "pf2e.feats-core", systemId: "pf2e", docs: [pf2eDoc] },
      { packId: "sf2e.feats-core", systemId: "sf2e", docs: [sf2eDoc] },
    ]);

    expect(result.hidden.size).toBe(0);
    expect(result.aliasTo.size).toBe(0);
  });

  it("keeps both when name matches but `type` differs (not the same kind of document)", () => {
    const pf2eDoc = feat({ _id: "pf2e-x", name: "Inventor", type: "class" });
    const sf2eDoc = feat({ _id: "sf2e-x", name: "Inventor", type: "feat" });

    const result = buildDedupIndex([
      { packId: "pf2e.classes-core", systemId: "pf2e", docs: [pf2eDoc] },
      { packId: "sf2e.skill-feats-core", systemId: "sf2e", docs: [sf2eDoc] },
    ]);

    expect(result.hidden.size).toBe(0);
  });
});
