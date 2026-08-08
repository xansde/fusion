/**
 * loreSlug.test.ts — the single source of truth for how a Lore proficiency is
 * keyed on `system.skills`.
 *
 * Background: two conventions coexisted. `addLoreSkill` (manual lore) and the
 * whole display layer (skillNames.ts, characterSheetVM's label, the training
 * dialog) use the PREFIX form `lore-<subject>`; `planVM.loreSlug` (background
 * lore) used the SUFFIX form `<subject>-lore`. A background's Lore therefore
 * rendered as a raw slug ("Lore (scribing-lore)") and lived in a namespace no
 * other code recognized. This module makes `lore-<subject>` canonical and keeps
 * the legacy form readable so existing characters can be healed, not orphaned.
 */

import { describe, expect, it } from "vitest";

import { isLoreSlug, legacyLoreSlug, loreSlug, loreSubject, migrateLoreSlug } from "../loreSlug";

describe("loreSlug — canonical `lore-<subject>` form", () => {
  it("strips the trailing 'Lore' word and prefixes instead", () => {
    expect(loreSlug("Scribing Lore")).toBe("lore-scribing");
    expect(loreSlug("Piloting Lore")).toBe("lore-piloting");
    expect(loreSlug("Fireworks Lore")).toBe("lore-fireworks");
  });

  it("agrees with addLoreSkill's hand-rolled slug for a manual lore", () => {
    // addLoreSkill builds `lore-${name.toLowerCase().replace(/[^a-z0-9]+/g,"-")}`
    // over a name that does NOT carry a trailing "Lore" word.
    expect(loreSlug("Warfare")).toBe("lore-warfare");
  });

  it("slugifies multi-word and accented subjects", () => {
    expect(loreSlug("Underworld Lore")).toBe("lore-underworld");
    expect(loreSlug("Sailing  Lore")).toBe("lore-sailing");
    expect(loreSlug("Circo Lore")).toBe("lore-circo");
    expect(loreSlug("Órgão Lore")).toBe("lore-orgao");
  });

  it("degrades to a bare 'lore' when there is no subject left", () => {
    expect(loreSlug("Lore")).toBe("lore");
    expect(loreSlug("   ")).toBe("lore");
  });
});

describe("isLoreSlug — recognizes both conventions", () => {
  it("accepts the canonical prefix form", () => {
    expect(isLoreSlug("lore-scribing")).toBe(true);
    expect(isLoreSlug("lore")).toBe(true);
  });

  it("accepts the legacy suffix form so old characters stay readable", () => {
    expect(isLoreSlug("scribing-lore")).toBe(true);
  });

  it("rejects the 16 canonical skills", () => {
    for (const slug of ["acrobatics", "arcana", "athletics", "religion", "performance"]) {
      expect(isLoreSlug(slug)).toBe(false);
    }
  });
});

describe("loreSubject — the human-readable subject behind a slug", () => {
  it("reads the canonical form", () => {
    expect(loreSubject("lore-scribing")).toBe("scribing");
    expect(loreSubject("lore-underworld")).toBe("underworld");
  });

  it("reads the legacy form (this is what made the label render raw)", () => {
    expect(loreSubject("scribing-lore")).toBe("scribing");
  });

  it("restores spaces for multi-word subjects", () => {
    expect(loreSubject("lore-abyssal-history")).toBe("abyssal history");
  });

  it("returns an empty subject for a bare lore slug", () => {
    expect(loreSubject("lore")).toBe("");
  });
});

describe("migrateLoreSlug — heal path for characters built on the legacy form", () => {
  it("converts a legacy suffix slug to the canonical prefix slug", () => {
    expect(migrateLoreSlug("scribing-lore")).toBe("lore-scribing");
    expect(migrateLoreSlug("fireworks-lore")).toBe("lore-fireworks");
  });

  it("returns null for a slug that is already canonical — nothing to heal", () => {
    expect(migrateLoreSlug("lore-scribing")).toBeNull();
    expect(migrateLoreSlug("lore")).toBeNull();
  });

  it("returns null for a non-lore slug — never touches a real skill", () => {
    expect(migrateLoreSlug("religion")).toBeNull();
    expect(migrateLoreSlug("athletics")).toBeNull();
  });

  it("round-trips with legacyLoreSlug, so the heal can find what it must rename", () => {
    const legacy = legacyLoreSlug("Scribing Lore");
    expect(legacy).toBe("scribing-lore");
    expect(migrateLoreSlug(legacy)).toBe(loreSlug("Scribing Lore"));
  });
});
