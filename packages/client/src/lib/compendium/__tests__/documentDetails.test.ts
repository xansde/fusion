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

  it("rewrites a save @Check[...] with a DC into '<Save> save (DC N)'", () => {
    const html = "<p>Attempt a @Check[fortitude|dc:29] save.</p>";
    expect(sanitizeDescriptionToText(html)[0]).toBe("Attempt a Fortitude save (DC 29) save.");
  });

  it("rewrites a skill @Check[...] without a DC into the capitalized skill", () => {
    const html = "<p>Roll @Check[athletics] to climb.</p>";
    expect(sanitizeDescriptionToText(html)[0]).toBe("Roll Athletics to climb.");
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

describe("Foundry enricher humanization (via sanitizeDescriptionToText)", () => {
  /** Convenience: humanize a bare (already tag-free) enricher string. */
  const humanize = (s: string): string => sanitizeDescriptionToText(`<p>${s}</p>`)[0] ?? "";

  describe("@Damage", () => {
    it("renders formula + damage type, dropping bracket/flag syntax", () => {
      expect(humanize("@Damage[6d6[fire]]")).toBe("6d6 fire");
    });

    it("drops a trailing |options: flag block", () => {
      expect(humanize("@Damage[((max(5,ceil(@actor.level/2)))d4)[fire]|options:area-damage]")).toBe(
        "((max(5,ceil(level/2)))d4) fire",
      );
    });

    it("simplifies @actor.level roll-data to 'level' with no leading @", () => {
      const out = humanize("@Damage[max(16,(2*(floor(@actor.level/2))))d6[fire]|options:area-damage]");
      expect(out).toBe("max(16,(2*(floor(level/2))))d6 fire");
      expect(out).not.toContain("@");
    });

    it("keeps multi-word damage types (persistent, acid) as words", () => {
      expect(humanize("@Damage[2d6[persistent,acid]]")).toBe("2d6 persistent acid");
    });

    it("simplifies a roll-data damage type to its last path segment", () => {
      expect(humanize("@Damage[ceil(@actor.level/2)d6[@actor.flags.system.x.damageType]]")).toBe(
        "ceil(level/2)d6 damageType",
      );
    });

    it("handles an untyped damage formula (no [type] group)", () => {
      expect(humanize("@Damage[(@actor.level)d6[untyped]]")).toBe("(level)d6 untyped");
    });

    it("prefers an explicit {label} over the computed formula", () => {
      expect(humanize("@Damage[(8d6+@actor.abilities.str.mod)[bludgeoning]|options:area-damage]{8d6}")).toBe("8d6");
    });
  });

  describe("@Template", () => {
    it("renders 'N-foot shape' from a type: prefixed body", () => {
      expect(humanize("@Template[type:burst|distance:10]")).toBe("10-foot burst");
    });

    it("renders 'N-foot shape' from a bare shape segment", () => {
      expect(humanize("@Template[burst|distance:10]")).toBe("10-foot burst");
    });

    it("handles cone/emanation/line shapes", () => {
      expect(humanize("@Template[cone|distance:30]")).toBe("30-foot cone");
      expect(humanize("@Template[emanation|distance:20]")).toBe("20-foot emanation");
      expect(humanize("@Template[line|distance:30]")).toBe("30-foot line");
    });

    it("falls back to the shape when there is no distance", () => {
      expect(humanize("@Template[burst]")).toBe("burst");
    });
  });

  describe("@Check", () => {
    it("renders a save as '<Save> save (DC N)'", () => {
      expect(humanize("@Check[fortitude|dc:29]")).toBe("Fortitude save (DC 29)");
    });

    it("accepts the type: prefixed statistic form", () => {
      expect(humanize("@Check[type:fortitude|dc:29]")).toBe("Fortitude save (DC 29)");
    });

    it("prefixes 'basic' for basic saves and drops other flags", () => {
      expect(humanize("@Check[fortitude|against:spell|basic|options:area-effect]")).toBe("basic Fortitude save");
    });

    it("renders reflex/will saves without a DC", () => {
      expect(humanize("@Check[reflex|against:class-spell]")).toBe("Reflex save");
      expect(humanize("@Check[will]")).toBe("Will save");
    });

    it("renders a skill check as the capitalized skill (not a save)", () => {
      expect(humanize("@Check[athletics|dc:15]")).toBe("Athletics (DC 15)");
      expect(humanize("@Check[acrobatics]")).toBe("Acrobatics");
    });

    it("drops a non-numeric roll-data DC rather than leaking @-syntax", () => {
      const out = humanize("@Check[crafting|dc:@self.level]");
      expect(out).toBe("Crafting");
      expect(out).not.toContain("@");
    });
  });

  describe("@Localize", () => {
    it("drops a pure localization-key wrapper, keeping surrounding prose", () => {
      const out = humanize("Text @Localize[PF2E.NPC.Abilities.Glossary.Grab] more");
      expect(out).toContain("Text");
      expect(out).toContain("more");
      expect(out).not.toContain("@Localize");
      expect(out).not.toContain("PF2E");
    });

    it("leaves no @Localize syntax behind", () => {
      expect(humanize("@Localize[PF2E.condition.sickened.rules]")).not.toContain("@Localize");
    });
  });

  describe("unknown enrichers", () => {
    it("uses an explicit {Label} when present", () => {
      expect(humanize("@Foo[bar]{Nice Label}")).toBe("Nice Label");
    });

    it("falls back to a readable bracket body, never raw @Tag[ syntax", () => {
      const out = humanize("@Foo[some readable content]");
      expect(out).toBe("some readable content");
      expect(out).not.toMatch(/@[A-Za-z]+\[/);
    });

    it("strips @-roll-data from an unknown enricher body", () => {
      expect(humanize("@Bar[@actor.level rounds]")).toBe("level rounds");
    });
  });

  describe("[[/roll]] inline blocks", () => {
    it("renders [[/r formula]] as the bare formula", () => {
      expect(humanize("Roll [[/r 1d20+5]] to hit.")).toBe("Roll 1d20+5 to hit.");
    });

    it("drops a #flavor comment from a roll", () => {
      expect(humanize("[[/r 1d4 #Recharge Lantern Beam]]")).toBe("1d4");
    });

    it("handles [[/br 2d6[fire]]] blind rolls with a damage type", () => {
      expect(humanize("[[/br 2d6[fire]]]")).toBe("2d6 fire");
    });

    it("handles [[/gmr 1d4 #hours]] GM rolls", () => {
      expect(humanize("[[/gmr 1d4 #hours]]")).toBe("1d4");
    });

    it("prefers an explicit {label} on a roll block", () => {
      expect(humanize("[[/r 1d4]]{4}")).toBe("4");
    });

    it("humanizes an [[/act slug]] action macro to a title-cased name", () => {
      expect(humanize("[[/act administer-first-aid variant=stabilize]]")).toBe("Administer First Aid");
      expect(humanize("[[/act climb skill=warfare-lore]]")).toBe("Climb");
    });

    it("leaves lone/mismatched double brackets in prose untouched", () => {
      expect(humanize("An array like [[1, 2]] stays put.")).toContain("[[1, 2]]");
    });
  });

  describe("the real Blazing Conflagration action (golden case)", () => {
    it("humanizes every enricher with no raw syntax leaking", () => {
      const html =
        "<p>Each creature in a @Template[type:burst|distance:10] takes " +
        "@Damage[max(16,(2*(floor(@actor.level/2))))d6[fire]|options:area-damage] damage with a " +
        "@Check[fortitude|against:spell|basic|options:area-effect] save against your spell DC; " +
        "creatures that critically fail are " +
        "@UUID[Compendium.pf2e.conditionitems.Item.Blinded] for 1 round.</p>";
      const out = sanitizeDescriptionToText(html)[0] ?? "";

      expect(out).toBe(
        "Each creature in a 10-foot burst takes max(16,(2*(floor(level/2))))d6 fire damage with a " +
          "basic Fortitude save save against your spell DC; creatures that critically fail are Blinded for 1 round.",
      );
      // Hard guarantees: no Foundry enricher syntax survives.
      expect(out).not.toContain("@");
      expect(out).not.toContain("|options:");
      expect(out).not.toMatch(/@[A-Za-z]+\[/);
      expect(out).not.toMatch(/\[\[/);
    });
  });

  describe("idempotency / no-enricher safety", () => {
    it("leaves plain prose with no enrichers unchanged", () => {
      const plain = "This is a normal sentence with numbers 3d6 and punctuation.";
      expect(sanitizeDescriptionToText(`<p>${plain}</p>`)[0]).toBe(plain);
    });

    it("is idempotent: humanized output contains no re-processable enrichers", () => {
      const html = "<p>@Template[burst|distance:20] and @Check[reflex|dc:18] and [[/r 2d8]].</p>";
      const once = sanitizeDescriptionToText(html)[0] ?? "";
      // Feeding the already-humanized text back through must be a no-op.
      const twice = sanitizeDescriptionToText(`<p>${once}</p>`)[0] ?? "";
      expect(twice).toBe(once);
      expect(once).not.toMatch(/@[A-Za-z]+\[/);
      expect(once).not.toMatch(/\[\[/);
    });
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
