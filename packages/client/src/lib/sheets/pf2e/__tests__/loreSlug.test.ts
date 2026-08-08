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

/**
 * A THIRD convention exists on disk: `lore-<subject>-lore`. `addLoreSkill` used
 * to build its slug inline over the raw typed name, keeping the trailing "Lore"
 * word — and the field's placeholder ("New Lore name…" / "Nome do novo Lore…")
 * invites typing the full name, so "Warfare Lore" became `lore-warfare-lore`.
 * `addLoreSkill` now goes through `loreSlug`, so nothing NEW lands here, but
 * every character built before that fix still carries these keys and the heal
 * pass is the only thing that can reach them.
 */
describe("migrateLoreSlug — the redundant-suffix form `lore-<subject>-lore`", () => {
  it("drops the redundant trailing word instead of giving up on the prefix", () => {
    expect(migrateLoreSlug("lore-warfare-lore")).toBe("lore-warfare");
    expect(migrateLoreSlug("lore-nature-lore")).toBe("lore-nature");
  });

  it("lands exactly on the key a fresh add would write for the same subject", () => {
    expect(migrateLoreSlug("lore-warfare-lore")).toBe(loreSlug("Warfare Lore"));
  });

  it("is idempotent — the healed key has nothing left to heal", () => {
    const healed = migrateLoreSlug("lore-warfare-lore");
    expect(healed).toBe("lore-warfare");
    expect(migrateLoreSlug(healed!)).toBeNull();
  });

  it("keeps the two known conventions behaving exactly as before", () => {
    expect(migrateLoreSlug("lore-warfare")).toBeNull();
    expect(migrateLoreSlug("warfare-lore")).toBe("lore-warfare");
  });

  it("leaves a subject that merely ENDS in the letters 'lore' alone", () => {
    // "Folklore" is one word: `lore-folklore` is already canonical, and
    // renaming it to `lore-folk` would rewrite the player's subject.
    expect(migrateLoreSlug("lore-folklore")).toBeNull();
  });
});

describe("loreSubject — the redundant-suffix form has no redundant word", () => {
  it("reads the subject without the trailing 'lore'", () => {
    expect(loreSubject("lore-warfare-lore")).toBe("warfare");
    expect(loreSubject("lore-abyssal-history-lore")).toBe("abyssal history");
  });

  it("does not eat a subject that merely ends in the letters 'lore'", () => {
    expect(loreSubject("lore-folklore")).toBe("folklore");
  });
});

/**
 * `lore-lore` is the old inline slug for the meaningless name "Lore" (today
 * `addLoreSkill` rejects it outright). It carries NO subject, so its canonical
 * key is the bare `lore` — the same key `loreSlug("Lore")` produces. Healing it
 * there keeps "one subject, one key"; the heal pass already merges into an
 * existing entry keeping the higher rank, so a collision cannot demote anyone.
 */
describe("the degenerate `lore-lore` slug", () => {
  it("heals to the bare `lore` key", () => {
    expect(migrateLoreSlug("lore-lore")).toBe("lore");
  });

  it("has no subject, exactly like the bare `lore`", () => {
    expect(loreSubject("lore-lore")).toBe("");
    expect(loreSubject("lore")).toBe("");
  });

  it("is still recognized as a Lore slug", () => {
    expect(isLoreSlug("lore-lore")).toBe(true);
  });
});
