/**
 * Tests for documentDetails.ts — pure TS helpers for the picker details
 * panel (W2-C2).
 *
 * Coverage:
 *   - sanitizeDescriptionToText: HTML → paragraph-preserving plain text
 *   - sanitizeDescriptionHtml: allow-list HTML sanitization
 *   - @UUID[...]/@Damage[...]/@Check[...]/@Template[...] inline rewriting
 *   - buildSpellFields / buildFeatFields / buildClassFeatureFields
 *   - buildMechanicalFields dispatch by document type
 *   - buildDetailsHeader
 *   - DocumentDetailsCache
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeDescriptionToText,
  sanitizeDescriptionHtml,
  buildSpellFields,
  buildFeatFields,
  buildClassFeatureFields,
  buildMechanicalFields,
  buildDetailsHeader,
  DocumentDetailsCache,
} from "../documentDetails.js";

describe("sanitizeDescriptionToText", () => {
  it("returns an empty array for null/undefined/empty input", () => {
    expect(sanitizeDescriptionToText(null)).toEqual([]);
    expect(sanitizeDescriptionToText(undefined)).toEqual([]);
    expect(sanitizeDescriptionToText("")).toEqual([]);
  });

  it("splits <p> blocks into separate paragraphs", () => {
    const html = "<p>First paragraph.</p><p>Second paragraph.</p>";
    expect(sanitizeDescriptionToText(html)).toEqual(["First paragraph.", "Second paragraph."]);
  });

  it("converts <hr> into a visible separator paragraph", () => {
    const html = "<p>Before.</p><hr /><p>After.</p>";
    const result = sanitizeDescriptionToText(html);
    expect(result).toContain("---");
    expect(result[0]).toBe("Before.");
    expect(result.at(-1)).toBe("After.");
  });

  it("turns <li> into bullet-prefixed lines within the block", () => {
    const html = "<ul><li>Cook</li><li>Lift</li></ul>";
    const result = sanitizeDescriptionToText(html);
    expect(result.join(" ")).toContain("• Cook");
    expect(result.join(" ")).toContain("• Lift");
  });

  it("decodes HTML entities", () => {
    const html = "<p>Rock &amp; roll &mdash; &quot;quoted&quot;</p>".replace("&mdash;", "&nbsp;-");
    const result = sanitizeDescriptionToText(html);
    expect(result[0]).toContain("Rock & roll");
    expect(result[0]).toContain('"quoted"');
  });

  it("rewrites @UUID[...]{Label} to the label text", () => {
    const html = "<p>Adjust your @UUID[Compendium.pf2e.actionspf2e.Item.Arcane Cascade]{Arcane Cascade}.</p>";
    expect(sanitizeDescriptionToText(html)[0]).toBe("Adjust your Arcane Cascade.");
  });

  it("rewrites @UUID[...] without a label to the last path segment", () => {
    const html = "<p>You gain the @UUID[Compendium.pf2e.feats-srd.Item.Cat Fall] general feat.</p>";
    expect(sanitizeDescriptionToText(html)[0]).toBe("You gain the Cat Fall general feat.");
  });

  it("rewrites @Damage[...] with a nested bracketed type into readable text", () => {
    const html = "<p>Deals @Damage[((@item.level+2)*2)d6[poison]] damage.</p>";
    const result = sanitizeDescriptionToText(html)[0];
    expect(result).toContain("poison");
    expect(result).not.toContain("@Damage");
    expect(result).not.toContain("[poison]"); // bracket syntax itself should not leak through
  });

  it("rewrites @Check[...] with a DC into readable text", () => {
    const html = "<p>Attempt a @Check[fortitude|dc:29] save.</p>";
    expect(sanitizeDescriptionToText(html)[0]).toBe("Attempt a fortitude (DC 29) save.");
  });

  it("rewrites @Check[...] without a DC into the bare statistic", () => {
    const html = "<p>Roll @Check[athletics] to climb.</p>";
    expect(sanitizeDescriptionToText(html)[0]).toBe("Roll athletics to climb.");
  });

  it("never leaves an @Tag[ fragment in the output for known or unknown tags", () => {
    const html = "<p>@Template[type:emanation|distance:10] and @Check[flat|dc:3]{3}</p>";
    const result = sanitizeDescriptionToText(html)[0];
    expect(result).not.toMatch(/@[A-Za-z]+\[/);
  });

  it("handles unbalanced/malformed tags without throwing or dropping text", () => {
    const html = "<p>Broken @UUID[no-closing-bracket and more text</p>";
    expect(() => sanitizeDescriptionToText(html)).not.toThrow();
    const result = sanitizeDescriptionToText(html)[0];
    expect(result).toContain("Broken");
  });
});

describe("sanitizeDescriptionHtml", () => {
  it("returns an empty string for null/undefined/empty input", () => {
    expect(sanitizeDescriptionHtml(null)).toBe("");
    expect(sanitizeDescriptionHtml(undefined)).toBe("");
    expect(sanitizeDescriptionHtml("")).toBe("");
  });

  it("keeps allow-listed tags bare (no attributes)", () => {
    const html = '<p class="foo" onclick="alert(1)">Hello</p>';
    expect(sanitizeDescriptionHtml(html)).toBe("<p>Hello</p>");
  });

  it("strips disallowed tags entirely while keeping their text content", () => {
    const html = '<script>alert(1)</script><p>Safe</p><img src="x.png">';
    const out = sanitizeDescriptionHtml(html);
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).toContain("<p>Safe</p>");
  });

  it("preserves strong/em/ul/li structure", () => {
    const html = "<ul><li><strong>Cook</strong> some food.</li></ul>";
    expect(sanitizeDescriptionHtml(html)).toBe("<ul><li><strong>Cook</strong> some food.</li></ul>");
  });

  it("rewrites @UUID[...]{Label} references to plain label text inside the sanitized HTML", () => {
    const html = "<p>@UUID[Compendium.pf2e.conditionitems.Item.Clumsy]{Clumsy 1}</p>";
    expect(sanitizeDescriptionHtml(html)).toBe("<p>Clumsy 1</p>");
  });

  it("never re-introduces executable markup via a rewritten label", () => {
    const html = '<p>@UUID[Compendium.pf2e.x.Item.y]{<img src=x onerror=alert(1)>}</p>';
    const out = sanitizeDescriptionHtml(html);
    // The rewritten label itself is plain text substituted in-place; any
    // tag-looking content inside it must still be stripped by the
    // allow-list pass since the pass runs on the WHOLE string only once —
    // guard against a naive implementation that special-cases rewritten
    // spans and skips them.
    expect(out).not.toContain("<img");
    expect(out).not.toContain("onerror");
  });
});

describe("buildSpellFields", () => {
  it("extracts cast time, range, target, and requirements", () => {
    const fields = buildSpellFields({
      castTime: "2",
      range: "30 feet",
      target: "1 creature",
      requirements: "You're benefitting from Arcane Cascade",
    });
    expect(fields).toEqual(
      expect.arrayContaining([
        { label: "Cast", value: "2 actions" },
        { label: "Range", value: "30 feet" },
        { label: "Target", value: "1 creature" },
        { label: "Requirements", value: "You're benefitting from Arcane Cascade" },
      ]),
    );
  });

  it("formats a reaction/free cast time distinctly from numbered actions", () => {
    expect(buildSpellFields({ castTime: "reaction" })).toEqual([{ label: "Cast", value: "Reaction" }]);
    expect(buildSpellFields({ castTime: "free" })).toEqual([{ label: "Cast", value: "Free Action" }]);
    expect(buildSpellFields({ castTime: "1" })).toEqual([{ label: "Cast", value: "1 action" }]);
  });

  it("extracts area with type and value", () => {
    const fields = buildSpellFields({ area: { type: "burst", value: 20 } });
    expect(fields).toEqual([{ label: "Area", value: "20-foot burst" }]);
  });

  it("extracts a basic save with the (basic) suffix", () => {
    const fields = buildSpellFields({
      defense: { save: { statistic: "reflex", basic: true } },
    });
    expect(fields).toEqual([{ label: "Save", value: "Reflex (basic)" }]);
  });

  it("extracts a non-basic save without the suffix", () => {
    const fields = buildSpellFields({
      defense: { save: { statistic: "fortitude", basic: false } },
    });
    expect(fields).toEqual([{ label: "Save", value: "Fortitude" }]);
  });

  it("extracts spellAttack defense", () => {
    const fields = buildSpellFields({ defense: { spellAttack: true } });
    expect(fields).toEqual([{ label: "Save", value: "Spell attack" }]);
  });

  it("extracts passive defense (e.g. AC)", () => {
    const fields = buildSpellFields({ defense: { passive: { statistic: "ac" } } });
    expect(fields).toEqual([{ label: "Defense", value: "AC" }]);
  });

  it("extracts damage entries keyed by rank, with type appended", () => {
    const fields = buildSpellFields({
      damage: { "0": { formula: "6d6", type: "fire" } },
    });
    expect(fields).toEqual([{ label: "Damage (Base)", value: "6d6 fire" }]);
  });

  it("extracts duration, marking sustained spells", () => {
    const fields = buildSpellFields({
      duration: { value: "1 minute", sustained: true },
    });
    expect(fields).toEqual([{ label: "Duration", value: "1 minute (sustained)" }]);
  });

  it("extracts interval heightening with the +N delta", () => {
    const fields = buildSpellFields({ heightening: { type: "interval", interval: 2 } });
    expect(fields).toEqual([{ label: "Heightened", value: "+2" }]);
  });

  it("extracts fixed heightening with the rank list", () => {
    const fields = buildSpellFields({ heightening: { type: "fixed", levels: { "5": {}, "9": {} } } });
    expect(fields).toEqual([{ label: "Heightened", value: "Rank 5, 9" }]);
  });

  it("returns an empty array for a system with no recognizable fields", () => {
    expect(buildSpellFields({})).toEqual([]);
  });
});

describe("buildFeatFields", () => {
  it("extracts prerequisites joined by semicolons", () => {
    const fields = buildFeatFields({
      prerequisites: [{ value: "Trained in Acrobatics" }, { value: "level 5" }],
    });
    expect(fields).toEqual([{ label: "Prerequisites", value: "Trained in Acrobatics; level 5" }]);
  });

  it("extracts frequency as 'max per unit'", () => {
    const fields = buildFeatFields({ frequency: { max: 1, per: "day" } });
    expect(fields).toEqual([{ label: "Frequency", value: "1 per day" }]);
  });

  it("extracts action cost for action/reaction/free feats", () => {
    expect(buildFeatFields({ actionType: "action", actions: 2 })).toEqual([
      { label: "Cast", value: "2 actions" },
    ]);
    expect(buildFeatFields({ actionType: "reaction" })).toEqual([{ label: "Cast", value: "Reaction" }]);
    expect(buildFeatFields({ actionType: "free" })).toEqual([{ label: "Cast", value: "Free Action" }]);
  });

  it("omits the cast field for passive feats", () => {
    expect(buildFeatFields({ actionType: "passive" })).toEqual([]);
  });
});

describe("buildClassFeatureFields", () => {
  it("extracts the level field", () => {
    expect(buildClassFeatureFields({ level: 5 })).toEqual([{ label: "Level", value: "5" }]);
  });

  it("extracts prerequisites alongside level", () => {
    const fields = buildClassFeatureFields({ level: 9, prerequisites: [{ value: "Hybrid Study" }] });
    expect(fields).toEqual([
      { label: "Level", value: "9" },
      { label: "Prerequisites", value: "Hybrid Study" },
    ]);
  });
});

describe("buildMechanicalFields (dispatch)", () => {
  it("dispatches to buildSpellFields for type 'spell'", () => {
    const fields = buildMechanicalFields({ type: "spell", system: { range: "touch" } });
    expect(fields).toEqual([{ label: "Range", value: "touch" }]);
  });

  it("dispatches to buildFeatFields for type 'feat'", () => {
    const fields = buildMechanicalFields({ type: "feat", system: { frequency: { max: 1, per: "day" } } });
    expect(fields).toEqual([{ label: "Frequency", value: "1 per day" }]);
  });

  it("dispatches to buildClassFeatureFields for type 'classFeature'", () => {
    const fields = buildMechanicalFields({ type: "classFeature", system: { level: 3 } });
    expect(fields).toEqual([{ label: "Level", value: "3" }]);
  });

  it("returns an empty array for unrecognized types", () => {
    expect(buildMechanicalFields({ type: "weapon", system: { range: "touch" } })).toEqual([]);
  });

  it("returns an empty array when system is missing or not an object", () => {
    expect(buildMechanicalFields({ type: "spell" })).toEqual([]);
    expect(buildMechanicalFields({ type: "spell", system: "not-an-object" })).toEqual([]);
  });
});

describe("buildDetailsHeader", () => {
  it("extracts name, level/rank, traits and rarity", () => {
    const header = buildDetailsHeader({
      name: "Fireball",
      system: { level: 3, traits: { value: ["fire", "attack"], rarity: "common" } },
    });
    expect(header).toEqual({ name: "Fireball", levelOrRank: 3, traits: ["fire", "attack"], rarity: "common" });
  });

  it("falls back to null/empty for missing fields", () => {
    const header = buildDetailsHeader({ name: "Mystery" });
    expect(header).toEqual({ name: "Mystery", levelOrRank: null, traits: [], rarity: null });
  });
});

describe("DocumentDetailsCache", () => {
  it("stores and retrieves documents by uuid", () => {
    const cache = new DocumentDetailsCache();
    const doc = { name: "Fireball" };
    expect(cache.has("uuid-1")).toBe(false);
    cache.set("uuid-1", doc);
    expect(cache.has("uuid-1")).toBe(true);
    expect(cache.get("uuid-1")).toBe(doc);
  });

  it("returns undefined for a uuid that was never cached", () => {
    const cache = new DocumentDetailsCache();
    expect(cache.get("missing")).toBeUndefined();
  });

  it("clear() empties the cache", () => {
    const cache = new DocumentDetailsCache();
    cache.set("uuid-1", { name: "X" });
    cache.clear();
    expect(cache.has("uuid-1")).toBe(false);
  });

  it("keeps separate instances isolated from each other", () => {
    const cacheA = new DocumentDetailsCache();
    const cacheB = new DocumentDetailsCache();
    cacheA.set("uuid-1", { name: "A" });
    expect(cacheB.has("uuid-1")).toBe(false);
  });
});
