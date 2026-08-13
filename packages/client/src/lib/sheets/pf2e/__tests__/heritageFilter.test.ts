/**
 * heritageFilter — which heritages the ABC picker offers for an ancestry.
 *
 * A heritage names its ancestry at `system.ancestry.slug`; a VERSATILE
 * heritage (Aiuvarin, Changeling, Dhampir, Dragonblood, Dromaar, Duskwalker,
 * Nephilim — PF2e Remaster) carries `ancestry: null` and may be taken by ANY
 * ancestry. The old inline filter required a string match, so the versatile
 * seven were offered to nobody.
 */
import { describe, expect, it } from "vitest";
import { heritageMatchesAncestry } from "../heritageFilter.js";

describe("heritageMatchesAncestry", () => {
  it("accepts a heritage whose declared ancestry matches", () => {
    expect(heritageMatchesAncestry("dwarf", "dwarf")).toBe(true);
  });

  it("rejects a heritage from another ancestry", () => {
    expect(heritageMatchesAncestry("elf", "dwarf")).toBe(false);
  });

  it("accepts a versatile heritage (ancestry slug null) for any ancestry", () => {
    expect(heritageMatchesAncestry(null, "dwarf")).toBe(true);
    expect(heritageMatchesAncestry(undefined, "goblin")).toBe(true);
  });

  it("rejects a malformed slug value instead of coercing it", () => {
    expect(heritageMatchesAncestry(42, "dwarf")).toBe(false);
    expect(heritageMatchesAncestry({ slug: "dwarf" }, "dwarf")).toBe(false);
  });
});
