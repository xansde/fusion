/**
 * Non-circular dedup test against the REAL committed pf2e/sf2e packs (not
 * fixtures) — the assertion comes from what the packs actually contain
 * (verified by hand against `.fusion-build/sf2e-nivel3/mundo-misto/dedup.md`),
 * never from the dedup algorithm's own output.
 *
 * Uses `CompendiumService` directly (discoverPacks against both systems'
 * real packsDir), lighter than a full `boot()` — the end-to-end
 * `compendium:*` socket path is covered separately by
 * `boot-compendium-composite-dedup.test.ts`.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { UserRole } from "../../documents/ownership.js";
import { CompendiumService, resolveSystemPacksDir } from "../service.js";

describe("CompendiumService cross-system dedup — real pf2e + sf2e packs", () => {
  let composite: CompendiumService;
  let pf2eOnly: CompendiumService;

  beforeAll(() => {
    const pf2eDir = resolveSystemPacksDir("pf2e");
    const sf2eDir = resolveSystemPacksDir("sf2e");
    if (!pf2eDir || !sf2eDir) {
      throw new Error("pf2e/sf2e packs dir not found — run from a full monorepo checkout");
    }

    composite = new CompendiumService();
    composite.discoverPacks(pf2eDir, "pf2e");
    composite.discoverPacks(sf2eDir, "sf2e");

    pf2eOnly = new CompendiumService();
    pf2eOnly.discoverPacks(pf2eDir, "pf2e");
  });

  it("a real reprint (Assurance) is hidden from the sf2e pack's index in the composite", () => {
    const sf2eIndex = composite.getPackIndex(UserRole.GAMEMASTER, "sf2e.skill-feats-core");
    expect(sf2eIndex).not.toBeNull();
    const names = sf2eIndex!.entries.map((e) => e.name);
    expect(names).not.toContain("Assurance");
  });

  it('the surviving pf2e entry is stamped with mergedFromSystems: ["sf2e"]', () => {
    const pf2eIndex = composite.getPackIndex(UserRole.GAMEMASTER, "pf2e.feats-core");
    expect(pf2eIndex).not.toBeNull();
    const assurance = pf2eIndex!.entries.find((e) => e.name === "Assurance");
    expect(assurance).toBeDefined();
    expect(assurance!.index["mergedFromSystems"]).toEqual(["sf2e"]);
  });

  it("compendium:get on the sf2e Assurance uuid resolves to the PF2e canonical document", () => {
    // Read the sf2e uuid from a service that has NOT deduped (single-system),
    // so we get the real hidden-from-composite uuid without relying on the
    // composite's own filtering to find it.
    const sf2eOnly = new CompendiumService();
    sf2eOnly.discoverPacks(resolveSystemPacksDir("sf2e")!, "sf2e");
    const sf2eIndex = sf2eOnly.getPackIndex(UserRole.GAMEMASTER, "sf2e.skill-feats-core");
    const sf2eAssurance = sf2eIndex!.entries.find((e) => e.name === "Assurance");
    expect(sf2eAssurance).toBeDefined();

    const resolved = composite.getDocument(UserRole.GAMEMASTER, sf2eAssurance!.uuid);
    expect(resolved).not.toBeNull();
    const system = resolved!["system"] as Record<string, unknown>;
    const publication = system["publication"] as Record<string, unknown>;
    expect(publication["title"]).toBe("Pathfinder Player Core");
  });

  it("a genuine homonym with different mechanics (Reach Spell) still appears in BOTH systems' packs", () => {
    const pf2eIndex = composite.getPackIndex(UserRole.GAMEMASTER, "pf2e.feats-core");
    const sf2eIndex = composite.getPackIndex(UserRole.GAMEMASTER, "sf2e.feats-core");
    expect(pf2eIndex!.entries.some((e) => e.name === "Reach Spell")).toBe(true);
    expect(sf2eIndex!.entries.some((e) => e.name === "Reach Spell")).toBe(true);
  });

  it("a pure pf2e-only world is completely unaffected (no dedup pass applied)", () => {
    const index = pf2eOnly.getPackIndex(UserRole.GAMEMASTER, "pf2e.feats-core");
    expect(index!.entries.some((e) => e.name === "Assurance")).toBe(true);
    const assurance = index!.entries.find((e) => e.name === "Assurance");
    expect(assurance!.index["mergedFromSystems"]).toBeUndefined();
  });

  // I5 (revisão adversarial 3): 36 documents share the exact same
  // `flags.fusion.sourceId` across pf2e and sf2e with DIFFERENT content —
  // pf2e's "Ratfolk" ancestry and sf2e's "Ysoki" ancestry both carry vendor
  // sourceId `P6PcVnCkh4XMdefw` under the generic `packName: "ancestries"`.
  // Dedup identity is `type + slug(name) + normalized mechanics`
  // (mechanicsFingerprint), never the bare sourceId — so this pair must
  // NEVER fuse (different name → different slug → different fingerprint),
  // unlike Assurance above. Proves the dedup/alias mechanism resolves each
  // to its own distinct document, not to the other's.
  it("Ratfolk (pf2e) and Ysoki (sf2e) share a sourceId but are NOT fused — both appear and resolve to their own document", () => {
    const pf2eIndex = composite.getPackIndex(UserRole.GAMEMASTER, "pf2e.ancestries-core");
    const sf2eIndex = composite.getPackIndex(UserRole.GAMEMASTER, "sf2e.ancestries-core");
    expect(pf2eIndex).not.toBeNull();
    expect(sf2eIndex).not.toBeNull();

    const ratfolkEntry = pf2eIndex!.entries.find((e) => e.name === "Ratfolk");
    const ysokiEntry = sf2eIndex!.entries.find((e) => e.name === "Ysoki");
    expect(ratfolkEntry).toBeDefined();
    expect(ysokiEntry).toBeDefined();
    // Neither is stamped as a fused/merged entry.
    expect(ratfolkEntry!.index["mergedFromSystems"]).toBeUndefined();
    expect(ysokiEntry!.index["mergedFromSystems"]).toBeUndefined();

    const ratfolkDoc = composite.getDocument(UserRole.GAMEMASTER, ratfolkEntry!.uuid);
    const ysokiDoc = composite.getDocument(UserRole.GAMEMASTER, ysokiEntry!.uuid);
    expect(ratfolkDoc).not.toBeNull();
    expect(ysokiDoc).not.toBeNull();
    expect(ratfolkDoc!["name"]).toBe("Ratfolk");
    expect(ysokiDoc!["name"]).toBe("Ysoki");
    // The shared sourceId, confirmed on both raw docs (sanity: this really
    // is the collision case, not two coincidentally-unrelated ancestries).
    const ratfolkFlags = (ratfolkDoc!["flags"] as Record<string, unknown>)["fusion"] as Record<
      string,
      unknown
    >;
    const ysokiFlags = (ysokiDoc!["flags"] as Record<string, unknown>)["fusion"] as Record<
      string,
      unknown
    >;
    expect(ratfolkFlags["sourceId"]).toBe(ysokiFlags["sourceId"]);
    expect(ratfolkFlags["packName"]).toBe(ysokiFlags["packName"]);
  });
});
