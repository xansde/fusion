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
  pickLocalizedName,
  pickEnName,
  localizedNameParts,
  pickLocalizedDescription,
  formatActionCost,
  formatIndexActionCost,
  traitDisplayName,
  rarityDisplayName,
  translateValueTokens,
  translateDamageType,
} from "../documentDetails.js";
import { TRAIT_NAMES_PT } from "../traitNames.js";

/**
 * Field-shape helper: existing EN assertions predate the labelKey addition
 * (r15-A1). This strips labelKey so the historic `{label,value}` assertions
 * stay readable; dedicated pt-BR tests below assert labelKey explicitly.
 */
const noKey = (fields: Array<{ labelKey: string; label: string; value: string }>) =>
  fields.map(({ label, value }) => ({ label, value }));

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
    const html =
      "<p>Adjust your @UUID[Compendium.pf2e.actionspf2e.Item.Arcane Cascade]{Arcane Cascade}.</p>";
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
      const out = humanize(
        "@Damage[max(16,(2*(floor(@actor.level/2))))d6[fire]|options:area-damage]",
      );
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
      expect(
        humanize("@Damage[(8d6+@actor.abilities.str.mod)[bludgeoning]|options:area-damage]{8d6}"),
      ).toBe("8d6");
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
      expect(humanize("@Check[fortitude|against:spell|basic|options:area-effect]")).toBe(
        "basic Fortitude save",
      );
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
      expect(humanize("[[/act administer-first-aid variant=stabilize]]")).toBe(
        "Administer First Aid",
      );
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
    expect(sanitizeDescriptionHtml(html)).toBe(
      "<ul><li><strong>Cook</strong> some food.</li></ul>",
    );
  });

  it("rewrites @UUID[...]{Label} references to plain label text inside the sanitized HTML", () => {
    const html = "<p>@UUID[Compendium.pf2e.conditionitems.Item.Clumsy]{Clumsy 1}</p>";
    expect(sanitizeDescriptionHtml(html)).toBe("<p>Clumsy 1</p>");
  });

  it("never re-introduces executable markup via a rewritten label", () => {
    const html = "<p>@UUID[Compendium.pf2e.x.Item.y]{<img src=x onerror=alert(1)>}</p>";
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

describe("action-glyph inline icon conversion (r16-G2)", () => {
  // Feedback: "Esfera de Trovão do Horizonte" rendered "2 Esta magia tem
  // alcance de 9 metros." — the vendor HTML's `<span class="action-glyph">2
  // </span>` relies on a Foundry-specific glyph font we don't ship; the
  // previous sanitizer dropped the unknown `class` attribute and left the
  // bare "2" as confusing prose. These tokens must become the app's own
  // accessible action-cost icons (◆/◇/⟳) instead of disappearing or leaking
  // a stray digit.

  describe("sanitizeDescriptionHtml — single-action-count glyphs", () => {
    it("converts 1/2/3 to the matching number of ◆ icons", () => {
      expect(
        sanitizeDescriptionHtml('<p><span class="action-glyph">1</span> One action.</p>'),
      ).toBe('<p><span title="1 ação">◆</span> One action.</p>');
      expect(
        sanitizeDescriptionHtml('<p><span class="action-glyph">2</span> Two actions.</p>'),
      ).toBe('<p><span title="2 ações">◆◆</span> Two actions.</p>');
      expect(
        sanitizeDescriptionHtml('<p><span class="action-glyph">3</span> Three actions.</p>'),
      ).toBe('<p><span title="3 ações">◆◆◆</span> Three actions.</p>');
    });

    it("uses the EN label when locale is en", () => {
      expect(
        sanitizeDescriptionHtml('<p><span class="action-glyph">2</span> Two actions.</p>', "en"),
      ).toBe('<p><span title="2 actions">◆◆</span> Two actions.</p>');
    });
  });

  describe("sanitizeDescriptionHtml — free action (F) and reaction (R)", () => {
    it("converts F/f to the free-action glyph ◇", () => {
      expect(sanitizeDescriptionHtml('<span class="action-glyph">F</span> {item|name}')).toBe(
        '<span title="ação livre">◇</span> {item|name}',
      );
    });

    it("converts R/r to the reaction glyph ⟳", () => {
      expect(sanitizeDescriptionHtml('{item|name} <span class="action-glyph">R</span>')).toBe(
        '{item|name} <span title="reação">⟳</span>',
      );
      expect(
        sanitizeDescriptionHtml(
          '<p><strong>Rewrite Possibility</strong> <span class="action-glyph">r</span></p>',
        ),
      ).toBe('<p><strong>Rewrite Possibility</strong> <span title="reação">⟳</span></p>');
    });
  });

  describe("sanitizeDescriptionHtml — summon-creature attack glyph (a)", () => {
    it("converts the lowercase 'a' attack-cost glyph to a single ◆ (same weight as '1')", () => {
      const html =
        '<p><strong>Melee</strong> <span class="action-glyph">a</span> fangs, <strong>Damage</strong> 2d8 piercing.</p>';
      expect(sanitizeDescriptionHtml(html)).toBe(
        '<p><strong>Melee</strong> <span title="1 ação">◆</span> fangs, <strong>Damage</strong> 2d8 piercing.</p>',
      );
    });
  });

  describe("sanitizeDescriptionHtml — ranges", () => {
    it('converts a "1 - 3" range to the min/max icon range joined by "a"', () => {
      expect(sanitizeDescriptionHtml('<p><span class="action-glyph">1 - 3</span></p>')).toBe(
        '<p><span title="1 - 3">◆ a ◆◆◆</span></p>',
      );
    });

    it('converts "2 or 3" and "1 to 2" ranges', () => {
      expect(sanitizeDescriptionHtml('<p><span class="action-glyph">2 or 3</span></p>')).toBe(
        '<p><span title="2 or 3">◆◆ a ◆◆◆</span></p>',
      );
      expect(sanitizeDescriptionHtml('<p><span class="action-glyph">1 to 2</span></p>')).toBe(
        '<p><span title="1 to 2">◆ a ◆◆</span></p>',
      );
    });
  });

  describe("sanitizeDescriptionHtml — unknown glyph values never disappear", () => {
    it("keeps an unrecognized glyph value as plain text instead of dropping it", () => {
      expect(sanitizeDescriptionHtml('<p><span class="action-glyph">?</span> Mystery.</p>')).toBe(
        "<p>? Mystery.</p>",
      );
    });
  });

  describe("sanitizeDescriptionHtml — coexists with other tags/enrichers", () => {
    it("does not disturb sibling allow-listed tags or @UUID rewriting", () => {
      const html =
        '<p><span class="action-glyph">2</span> Grants @UUID[Compendium.pf2e.conditionitems.Item.Dazzled]{Dazzled}.</p>';
      expect(sanitizeDescriptionHtml(html)).toBe(
        '<p><span title="2 ações">◆◆</span> Grants Dazzled.</p>',
      );
    });

    it("never leaves an unstyled <span> in the output for any OTHER vendor span", () => {
      const html = '<p><span class="foo">bar</span></p>';
      expect(sanitizeDescriptionHtml(html)).toBe("<p>bar</p>");
    });
  });

  describe("sanitizeDescriptionToText — glyphs render as plain icon text", () => {
    it("converts glyphs to icons in the plain-text pipeline (no digits leak)", () => {
      const html = '<p><span class="action-glyph">2</span> This spell has a range of 30 feet.</p>';
      expect(sanitizeDescriptionToText(html)[0]).toBe("◆◆ This spell has a range of 30 feet.");
    });

    it("keeps other numbers in the prose untouched (no over-eager digit stripping)", () => {
      const html =
        '<p><span class="action-glyph">3</span> This spell has a range of 60 feet and deals 3d6 damage.</p>';
      const out = sanitizeDescriptionToText(html)[0] ?? "";
      expect(out).toBe("◆◆◆ This spell has a range of 60 feet and deals 3d6 damage.");
      expect(out).toContain("60 feet");
      expect(out).toContain("3d6");
    });
  });

  describe("golden case: Horizon Thunder Sphere / Esfera de Trovão do Horizonte", () => {
    const EN_HTML =
      "<p>You gather magical energy into your palm, forming a concentrated ball of electricity that crackles and rumbles like impossibly distant thunder. Make a ranged spell attack roll against your target's AC. On a success, you deal 3d6 electricity damage. On a critical success, the target takes double damage and is @UUID[Compendium.pf2e.conditionitems.Item.Dazzled] for 1 round. The number of actions you spend when Casting this Spell determines the range and other parameters.</p>\n" +
      '<p><span class="action-glyph">2</span> This spell has a range of 30 feet.</p>\n' +
      '<p><span class="action-glyph">3</span> This spell has a range of 60 feet and deals half damage on a failure (but not a critical failure) as the electricity lashes out and jolts the target.</p>';

    const PT_HTML =
      "<p>Você reúne energia mágica em sua palma, formando uma bola concentrada de eletricidade que crepita e zumbe como um trovão impossivelmente distante. Faça uma rolagem de ataque de magia a distância contra a CA de seu alvo. Em um sucesso, você causa 3d6 dano de eletricidade. Em um sucesso crítico, o alvo sofre o dobro do dano e fica @UUID[Compendium.pf2e.conditionitems.Item.Dazzled]{Ofuscado} por 1 rodada. O número de ações que você gasta ao Conjurar esta Magia determina o alcance e outros parâmetros.</p>\n" +
      '<p><span class="action-glyph">2</span> Esta magia tem alcance de 9 metros.</p>\n' +
      '<p><span class="action-glyph">3</span> Esta magia tem alcance de 18 metros e causa metade do dano em uma falha (mas não uma falha crítica) enquanto a eletricidade chicoteia e choca o alvo.</p>';

    it("EN: renders ◆◆/◆◆◆ icons instead of a bare '2'/'3' in the HTML pipeline", () => {
      const out = sanitizeDescriptionHtml(EN_HTML, "en");
      expect(out).toContain('<span title="2 actions">◆◆</span> This spell has a range of 30 feet.');
      expect(out).toContain(
        '<span title="3 actions">◆◆◆</span> This spell has a range of 60 feet and deals half damage',
      );
      expect(out).not.toMatch(/<p>\s*2\s+This spell/);
      expect(out).not.toMatch(/<p>\s*3\s+This spell/);
    });

    it("pt-BR: renders ◆◆/◆◆◆ icons instead of a bare '2'/'3' in the HTML pipeline (the reported bug)", () => {
      const out = sanitizeDescriptionHtml(PT_HTML, "pt-BR");
      expect(out).toContain('<span title="2 ações">◆◆</span> Esta magia tem alcance de 9 metros.');
      expect(out).toContain('<span title="3 ações">◆◆◆</span> Esta magia tem alcance de 18 metros');
      // The exact bug reported: a bare leading digit followed by the sentence.
      expect(out).not.toMatch(/<p>\s*2\s+Esta magia/);
      expect(out).not.toMatch(/<p>\s*3\s+Esta magia/);
    });

    it("pt-BR: the plain-text pipeline also reads as icons, not bare digits", () => {
      const blocks = sanitizeDescriptionToText(PT_HTML, "pt-BR");
      expect(blocks.some((b) => b.startsWith("◆◆ Esta magia tem alcance de 9 metros."))).toBe(true);
      expect(blocks.some((b) => b.startsWith("◆◆◆ Esta magia tem alcance de 18 metros"))).toBe(
        true,
      );
      expect(blocks.some((b) => /^\d/.test(b))).toBe(false);
    });
  });
});

describe("buildSpellFields (EN, default locale)", () => {
  it("extracts cast time, range, target, and requirements", () => {
    const fields = buildSpellFields({
      castTime: "2",
      range: "30 feet",
      target: "1 creature",
      requirements: "You're benefitting from Arcane Cascade",
    });
    expect(noKey(fields)).toEqual(
      expect.arrayContaining([
        { label: "Cast", value: "◆◆ 2 actions" },
        { label: "Range", value: "30 feet" },
        { label: "Target", value: "1 creature" },
        { label: "Requirements", value: "You're benefitting from Arcane Cascade" },
      ]),
    );
  });

  it("formats a reaction/free cast time distinctly from numbered actions", () => {
    expect(noKey(buildSpellFields({ castTime: "reaction" }))).toEqual([
      { label: "Cast", value: "⟳ reaction" },
    ]);
    expect(noKey(buildSpellFields({ castTime: "free" }))).toEqual([
      { label: "Cast", value: "◇ free action" },
    ]);
    expect(noKey(buildSpellFields({ castTime: "1" }))).toEqual([
      { label: "Cast", value: "◆ 1 action" },
    ]);
  });

  it("extracts area with type and value", () => {
    const fields = buildSpellFields({ area: { type: "burst", value: 20 } });
    expect(noKey(fields)).toEqual([{ label: "Area", value: "20-foot burst" }]);
  });

  it("extracts a basic save with the (basic) suffix", () => {
    const fields = buildSpellFields({
      defense: { save: { statistic: "reflex", basic: true } },
    });
    expect(noKey(fields)).toEqual([{ label: "Save", value: "Reflex (basic)" }]);
  });

  it("extracts a non-basic save without the suffix", () => {
    const fields = buildSpellFields({
      defense: { save: { statistic: "fortitude", basic: false } },
    });
    expect(noKey(fields)).toEqual([{ label: "Save", value: "Fortitude" }]);
  });

  it("extracts spellAttack defense", () => {
    const fields = buildSpellFields({ defense: { spellAttack: true } });
    expect(noKey(fields)).toEqual([{ label: "Save", value: "Spell attack" }]);
  });

  it("extracts passive defense (e.g. AC)", () => {
    const fields = buildSpellFields({ defense: { passive: { statistic: "ac" } } });
    expect(noKey(fields)).toEqual([{ label: "Defense", value: "AC" }]);
  });

  it("extracts damage entries keyed by rank, with type appended", () => {
    const fields = buildSpellFields({
      damage: { "0": { formula: "6d6", type: "fire" } },
    });
    expect(noKey(fields)).toEqual([{ label: "Damage (Base)", value: "6d6 fire" }]);
  });

  it("extracts duration, marking sustained spells", () => {
    const fields = buildSpellFields({
      duration: { value: "1 minute", sustained: true },
    });
    expect(noKey(fields)).toEqual([{ label: "Duration", value: "1 minute (sustained)" }]);
  });

  it("extracts interval heightening with the +N delta", () => {
    const fields = buildSpellFields({ heightening: { type: "interval", interval: 2 } });
    expect(noKey(fields)).toEqual([{ label: "Heightened", value: "+2" }]);
  });

  it("extracts fixed heightening with the rank list", () => {
    const fields = buildSpellFields({
      heightening: { type: "fixed", levels: { "5": {}, "9": {} } },
    });
    expect(noKey(fields)).toEqual([{ label: "Heightened", value: "Rank 5, 9" }]);
  });

  it("returns an empty array for a system with no recognizable fields", () => {
    expect(buildSpellFields({})).toEqual([]);
  });

  it("always carries a labelKey alongside the EN label", () => {
    const [cast] = buildSpellFields({ castTime: "2" });
    expect(cast?.labelKey).toBe("FUSION.Sheet.Details.Field.Cast");
    expect(cast?.label).toBe("Cast");
  });
});

describe("buildSpellFields (pt-BR)", () => {
  it("translates labels, cast icons, enumerable values and damage type", () => {
    const fields = buildSpellFields(
      {
        castTime: "2 to 2 rounds", // the Horizon Thunder Sphere vendor value
        range: "varies",
        target: "1 creature",
        duration: { value: "1 minute", sustained: false },
        damage: { "0": { formula: "3d6", type: "electricity" } },
        defense: { save: { statistic: "reflex", basic: true } },
      },
      "pt-BR",
    );
    expect(fields).toEqual([
      { labelKey: "FUSION.Sheet.Details.Field.Cast", label: "Conjuração", value: "◆◆ 2 ações" },
      { labelKey: "FUSION.Sheet.Details.Field.Range", label: "Alcance", value: "varia" },
      { labelKey: "FUSION.Sheet.Details.Field.Target", label: "Alvo", value: "1 criatura" },
      { labelKey: "FUSION.Sheet.Details.Field.Duration", label: "Duração", value: "1 minuto" },
      {
        labelKey: "FUSION.Sheet.Details.Field.Save",
        label: "Salvaguarda",
        value: "Reflexos (básica)",
      },
      {
        labelKey: "FUSION.Sheet.Details.Field.DamageBase",
        label: "Dano (base)",
        value: "3d6 eletricidade",
      },
    ]);
  });

  it("translates area shape and units to pt-BR", () => {
    const fields = buildSpellFields({ area: { type: "burst", value: 20 } }, "pt-BR");
    expect(fields).toEqual([
      { labelKey: "FUSION.Sheet.Details.Field.Area", label: "Área", value: "20 pés de explosão" },
    ]);
  });

  it("never renders 'X to X' — collapses the degenerate range to a single cost", () => {
    const [cast] = buildSpellFields({ castTime: "2 to 2 rounds" }, "pt-BR");
    expect(cast?.value).toBe("◆◆ 2 ações");
    expect(cast?.value).not.toContain(" to ");
    expect(cast?.value).not.toContain(" a ");
  });
});

describe("buildFeatFields (EN, default locale)", () => {
  it("extracts prerequisites joined by semicolons", () => {
    const fields = buildFeatFields({
      prerequisites: [{ value: "Trained in Acrobatics" }, { value: "level 5" }],
    });
    expect(noKey(fields)).toEqual([
      { label: "Prerequisites", value: "Trained in Acrobatics; level 5" },
    ]);
  });

  it("extracts frequency as 'max per unit'", () => {
    const fields = buildFeatFields({ frequency: { max: 1, per: "day" } });
    expect(noKey(fields)).toEqual([{ label: "Frequency", value: "1 per day" }]);
  });

  it("extracts action cost with icons for action/reaction/free feats", () => {
    expect(noKey(buildFeatFields({ actionType: "action", actions: 2 }))).toEqual([
      { label: "Cast", value: "◆◆ 2 actions" },
    ]);
    expect(noKey(buildFeatFields({ actionType: "reaction" }))).toEqual([
      { label: "Cast", value: "⟳ reaction" },
    ]);
    expect(noKey(buildFeatFields({ actionType: "free" }))).toEqual([
      { label: "Cast", value: "◇ free action" },
    ]);
  });

  it("omits the cast field for passive feats", () => {
    expect(buildFeatFields({ actionType: "passive" })).toEqual([]);
  });
});

describe("buildFeatFields (pt-BR)", () => {
  it("translates frequency and action cost", () => {
    expect(buildFeatFields({ frequency: { max: 1, per: "day" } }, "pt-BR")).toEqual([
      { labelKey: "FUSION.Sheet.Details.Field.Frequency", label: "Frequência", value: "1 por dia" },
    ]);
    expect(buildFeatFields({ actionType: "action", actions: 1 }, "pt-BR")).toEqual([
      { labelKey: "FUSION.Sheet.Details.Field.Cast", label: "Conjuração", value: "◆ 1 ação" },
    ]);
  });
});

describe("buildClassFeatureFields", () => {
  it("extracts the level field (EN)", () => {
    expect(noKey(buildClassFeatureFields({ level: 5 }))).toEqual([{ label: "Level", value: "5" }]);
  });

  it("extracts prerequisites alongside level (EN)", () => {
    const fields = buildClassFeatureFields({
      level: 9,
      prerequisites: [{ value: "Hybrid Study" }],
    });
    expect(noKey(fields)).toEqual([
      { label: "Level", value: "9" },
      { label: "Prerequisites", value: "Hybrid Study" },
    ]);
  });

  it("translates the level label in pt-BR", () => {
    expect(buildClassFeatureFields({ level: 3 }, "pt-BR")).toEqual([
      { labelKey: "FUSION.Sheet.Details.Field.Level", label: "Nível", value: "3" },
    ]);
  });

  // Issue #58: class-features-core reuses 17 documents across classes at
  // divergent grant levels (35 cases / 11 classes — e.g. Barbarian grants
  // "Reflex Expertise" at 9, the document itself says 3). The builder already
  // uses featuresByLevel[].level (the source of truth); this is the same fix
  // for the compendium details panel, via an optional contextLevel the
  // caller supplies when it knows the real grant.
  it("prefers contextLevel over the document's static system.level when given", () => {
    expect(noKey(buildClassFeatureFields({ level: 3 }, "en", 9))).toEqual([
      { label: "Level", value: "9" },
    ]);
  });

  it("falls back to the document's system.level when contextLevel is omitted", () => {
    expect(noKey(buildClassFeatureFields({ level: 3 }, "en"))).toEqual([
      { label: "Level", value: "3" },
    ]);
  });

  it("still translates the label when contextLevel overrides the value (pt-BR)", () => {
    expect(buildClassFeatureFields({ level: 3 }, "pt-BR", 9)).toEqual([
      { labelKey: "FUSION.Sheet.Details.Field.Level", label: "Nível", value: "9" },
    ]);
  });
});

describe("buildMechanicalFields (dispatch)", () => {
  it("dispatches to buildSpellFields for type 'spell'", () => {
    const fields = buildMechanicalFields({ type: "spell", system: { range: "touch" } });
    expect(noKey(fields)).toEqual([{ label: "Range", value: "touch" }]);
  });

  it("threads the locale through to the sub-builder", () => {
    const fields = buildMechanicalFields({ type: "spell", system: { range: "touch" } }, "pt-BR");
    expect(fields).toEqual([
      { labelKey: "FUSION.Sheet.Details.Field.Range", label: "Alcance", value: "toque" },
    ]);
  });

  it("dispatches to buildFeatFields for type 'feat'", () => {
    const fields = buildMechanicalFields({
      type: "feat",
      system: { frequency: { max: 1, per: "day" } },
    });
    expect(noKey(fields)).toEqual([{ label: "Frequency", value: "1 per day" }]);
  });

  it("dispatches to buildClassFeatureFields for type 'classFeature'", () => {
    const fields = buildMechanicalFields({ type: "classFeature", system: { level: 3 } });
    expect(noKey(fields)).toEqual([{ label: "Level", value: "3" }]);
  });

  it("threads contextLevel through to buildClassFeatureFields for type 'classFeature' (issue #58)", () => {
    const fields = buildMechanicalFields({ type: "classFeature", system: { level: 3 } }, "en", 9);
    expect(noKey(fields)).toEqual([{ label: "Level", value: "9" }]);
  });

  it("ignores contextLevel for types other than 'classFeature' (a spell's rank is intrinsic)", () => {
    const fields = buildMechanicalFields(
      { type: "spell", system: { level: 3, range: "touch" } },
      "en",
      9,
    );
    expect(noKey(fields)).toEqual([{ label: "Range", value: "touch" }]);
  });

  it("returns an empty array for unrecognized types", () => {
    expect(buildMechanicalFields({ type: "weapon", system: { range: "touch" } })).toEqual([]);
  });

  it("returns an empty array when system is missing or not an object", () => {
    expect(buildMechanicalFields({ type: "spell" })).toEqual([]);
    expect(buildMechanicalFields({ type: "spell", system: "not-an-object" })).toEqual([]);
  });
});

describe("formatActionCost (r15-A1)", () => {
  it("maps 1/2/3 to action glyphs + pt-BR label", () => {
    expect(formatActionCost("1", "pt-BR")).toEqual({ icons: "◆", label: "1 ação", isText: false });
    expect(formatActionCost("2", "pt-BR")).toEqual({
      icons: "◆◆",
      label: "2 ações",
      isText: false,
    });
    expect(formatActionCost("3", "pt-BR")).toEqual({
      icons: "◆◆◆",
      label: "3 ações",
      isText: false,
    });
  });

  it("maps free/reaction to their glyphs", () => {
    expect(formatActionCost("free", "pt-BR")).toEqual({
      icons: "◇",
      label: "ação livre",
      isText: false,
    });
    expect(formatActionCost("reaction", "pt-BR")).toEqual({
      icons: "⟳",
      label: "reação",
      isText: false,
    });
  });

  it("renders action ranges (1 to 3 / 2 or 3) with a glyph range, never 'X to X'", () => {
    expect(formatActionCost("1 to 3", "pt-BR")).toEqual({
      icons: "◆ a ◆◆◆",
      label: "1 a 3 ações",
      isText: false,
    });
    expect(formatActionCost("2 or 3", "pt-BR")).toEqual({
      icons: "◆◆ a ◆◆◆",
      label: "2 a 3 ações",
      isText: false,
    });
    expect(formatActionCost("1 or 2", "pt-BR")).toEqual({
      icons: "◆ a ◆◆",
      label: "1 a 2 ações",
      isText: false,
    });
  });

  it("collapses the degenerate '2 to 2 rounds' vendor value to a single cost", () => {
    const c = formatActionCost("2 to 2 rounds", "pt-BR");
    expect(c).toEqual({ icons: "◆◆", label: "2 ações", isText: false });
    expect(c.label).not.toContain(" to ");
    expect(`${c.icons} ${c.label}`).not.toContain("rounds");
  });

  it("keeps long/textual times as translated text with no glyphs", () => {
    expect(formatActionCost("1 minute", "pt-BR")).toEqual({
      icons: "",
      label: "1 minuto",
      isText: true,
    });
    expect(formatActionCost("10 minutes", "pt-BR")).toEqual({
      icons: "",
      label: "10 minutos",
      isText: true,
    });
    expect(formatActionCost("1 hour", "pt-BR")).toEqual({
      icons: "",
      label: "1 hora",
      isText: true,
    });
  });

  it("preserves EN output on the en locale", () => {
    expect(formatActionCost("2", "en")).toEqual({ icons: "◆◆", label: "2 actions", isText: false });
    expect(formatActionCost("1 to 3", "en")).toEqual({
      icons: "◆ to ◆◆◆",
      label: "1 to 3 actions",
      isText: false,
    });
    expect(formatActionCost("1 minute", "en")).toEqual({
      icons: "",
      label: "1 minute",
      isText: true,
    });
  });

  it("handles empty/undefined input safely", () => {
    expect(formatActionCost("", "pt-BR")).toEqual({ icons: "", label: "", isText: true });
    expect(formatActionCost(null, "pt-BR")).toEqual({ icons: "", label: "", isText: true });
    expect(formatActionCost(undefined, "pt-BR")).toEqual({ icons: "", label: "", isText: true });
  });
});

describe("formatIndexActionCost (r20-X2 picker-row badge)", () => {
  it("renders action-count glyphs with a pt-BR tooltip", () => {
    expect(formatIndexActionCost("2", "pt-BR")).toEqual({
      icons: "◆◆",
      display: "◆◆",
      title: "2 ações",
      isText: false,
    });
    expect(formatIndexActionCost("1", "pt-BR")).toEqual({
      icons: "◆",
      display: "◆",
      title: "1 ação",
      isText: false,
    });
  });

  it("renders reaction and free glyphs", () => {
    expect(formatIndexActionCost("reaction", "pt-BR")).toEqual({
      icons: "⟳",
      display: "⟳",
      title: "reação",
      isText: false,
    });
    expect(formatIndexActionCost("free", "pt-BR")).toEqual({
      icons: "◇",
      display: "◇",
      title: "ação livre",
      isText: false,
    });
  });

  it("renders spell action ranges", () => {
    expect(formatIndexActionCost("1 to 3", "pt-BR")).toEqual({
      icons: "◆ a ◆◆◆",
      display: "◆ a ◆◆◆",
      title: "1 a 3 ações",
      isText: false,
    });
  });

  it("shows short text (no glyphs) for long/textual cast times", () => {
    expect(formatIndexActionCost("1 minute", "pt-BR")).toEqual({
      icons: "",
      display: "1 minuto",
      title: "1 minuto",
      isText: true,
    });
    expect(formatIndexActionCost("10 minutes", "pt-BR")).toEqual({
      icons: "",
      display: "10 minutos",
      title: "10 minutos",
      isText: true,
    });
  });

  it("returns null for passive / absent cost (no badge)", () => {
    expect(formatIndexActionCost(undefined, "pt-BR")).toBeNull();
    expect(formatIndexActionCost(null, "pt-BR")).toBeNull();
    expect(formatIndexActionCost("", "pt-BR")).toBeNull();
    expect(formatIndexActionCost("   ", "pt-BR")).toBeNull();
    expect(formatIndexActionCost(42 as unknown, "pt-BR")).toBeNull();
  });

  it("preserves EN glyph labels on the en locale", () => {
    expect(formatIndexActionCost("2", "en")).toEqual({
      icons: "◆◆",
      display: "◆◆",
      title: "2 actions",
      isText: false,
    });
  });
});

describe("value translation helpers (r15-A1)", () => {
  it("translateValueTokens handles common range/target/duration phrases", () => {
    expect(translateValueTokens("1 creature", "pt-BR")).toBe("1 criatura");
    expect(translateValueTokens("1 willing creature", "pt-BR")).toBe("1 criatura disposta");
    expect(translateValueTokens("30 feet", "pt-BR")).toBe("30 pés");
    expect(translateValueTokens("touch", "pt-BR")).toBe("toque");
    expect(translateValueTokens("varies", "pt-BR")).toBe("varia");
    expect(translateValueTokens("up to 5 creatures", "pt-BR")).toBe("até 5 criaturas");
  });

  it("translateValueTokens leaves numbers and dice untouched", () => {
    expect(translateValueTokens("120 feet", "pt-BR")).toBe("120 pés");
    expect(translateValueTokens("3d6", "pt-BR")).toBe("3d6");
  });

  it("translateValueTokens is a no-op on en", () => {
    expect(translateValueTokens("1 creature", "en")).toBe("1 creature");
  });

  it("translateDamageType maps damage slugs", () => {
    expect(translateDamageType("electricity", "pt-BR")).toBe("eletricidade");
    expect(translateDamageType("fire", "pt-BR")).toBe("fogo");
    expect(translateDamageType("bludgeoning", "pt-BR")).toBe("concussão");
    expect(translateDamageType("fire", "en")).toBe("fire");
    expect(translateDamageType("unknownType", "pt-BR")).toBe("unknownType");
  });
});

describe("trait/rarity display names (r15-A1)", () => {
  it("translates known trait slugs to accented pt-BR", () => {
    expect(traitDisplayName("attack", "pt-BR")).toBe("ataque");
    expect(traitDisplayName("concentrate", "pt-BR")).toBe("concentração");
    expect(traitDisplayName("electricity", "pt-BR")).toBe("eletricidade");
    expect(traitDisplayName("manipulate", "pt-BR")).toBe("manipulação");
  });

  it("keeps coined names in English (magus)", () => {
    expect(traitDisplayName("magus", "pt-BR")).toBe("magus");
  });

  it("returns the raw slug on the en locale", () => {
    expect(traitDisplayName("attack", "en")).toBe("attack");
  });

  it("falls back to a humanized slug for an unknown trait", () => {
    expect(traitDisplayName("some-new-trait", "pt-BR")).toBe("some new trait");
  });

  it("covers all 190 glossary traits with a non-empty accented value", () => {
    // 177 (r15) + 13 sincronizados na r20 (ancestrias planares, overflow,
    // potion, talisman...). Count exato de propósito: trait novo no glossário
    // exige regenerar via tools/translate-packs/gen-client-maps.mjs e revisar.
    const keys = Object.keys(TRAIT_NAMES_PT);
    expect(keys.length).toBe(190);
    for (const slug of keys) {
      const pt = traitDisplayName(slug, "pt-BR");
      expect(pt.length).toBeGreaterThan(0);
    }
  });

  it("has no ASCII-folded leftovers where an accent is required (spot checks)", () => {
    // These specific slugs were unaccented in the raw glossary and must be fixed.
    expect(TRAIT_NAMES_PT["acid"]).toBe("ácido");
    expect(TRAIT_NAMES_PT["consumable"]).toBe("consumível");
    expect(TRAIT_NAMES_PT["skill"]).toBe("perícia");
    expect(TRAIT_NAMES_PT["water"]).toBe("água");
  });

  it("translates rarity slugs", () => {
    expect(rarityDisplayName("uncommon", "pt-BR")).toBe("Incomum");
    expect(rarityDisplayName("rare", "pt-BR")).toBe("Raro");
    expect(rarityDisplayName("rare", "en")).toBe("rare");
  });
});

describe("buildDetailsHeader", () => {
  it("extracts name, level/rank, traits and rarity (no translation → subtitleEn null)", () => {
    const header = buildDetailsHeader({
      name: "Fireball",
      system: { level: 3, traits: { value: ["fire", "attack"], rarity: "common" } },
    });
    expect(header).toEqual({
      name: "Fireball",
      subtitleEn: null,
      levelOrRank: 3,
      traits: ["fire", "attack"],
      rarity: "common",
    });
  });

  it("falls back to null/empty for missing fields", () => {
    const header = buildDetailsHeader({ name: "Mystery" });
    expect(header).toEqual({
      name: "Mystery",
      subtitleEn: null,
      levelOrRank: null,
      traits: [],
      rarity: null,
    });
  });

  it("prefers the pt-BR name and exposes the EN subtitle when locale is pt-BR", () => {
    const header = buildDetailsHeader(
      {
        name: "Basic Concoction",
        system: { level: 4 },
        i18n: { ptBR: { name: "Concocção Básica" } },
      },
      "pt-BR",
    );
    expect(header.name).toBe("Concocção Básica");
    expect(header.subtitleEn).toBe("Basic Concoction");
  });

  it("uses the EN name (no subtitle) when locale is en, even if a translation exists", () => {
    const header = buildDetailsHeader(
      { name: "Basic Concoction", i18n: { ptBR: { name: "Concocção Básica" } } },
      "en",
    );
    expect(header.name).toBe("Basic Concoction");
    expect(header.subtitleEn).toBeNull();
  });

  // Issue #58: the level badge next to the name reads the same shared/
  // reused system.level as buildClassFeatureFields — without this override
  // the badge and the "Level" field below it would show two DIFFERENT
  // numbers for the same classFeature document.
  it("prefers contextLevel over system.level for a classFeature doc", () => {
    const header = buildDetailsHeader(
      { type: "classFeature", name: "Reflex Expertise", system: { level: 3 } },
      "en",
      9,
    );
    expect(header.levelOrRank).toBe(9);
  });

  it("ignores contextLevel for a non-classFeature doc (e.g. a spell's rank is intrinsic)", () => {
    const header = buildDetailsHeader(
      { type: "spell", name: "Fireball", system: { level: 3 } },
      "en",
      9,
    );
    expect(header.levelOrRank).toBe(3);
  });

  it("falls back to system.level for a classFeature doc when contextLevel is omitted", () => {
    const header = buildDetailsHeader(
      { type: "classFeature", name: "Reflex Expertise", system: { level: 3 } },
      "en",
    );
    expect(header.levelOrRank).toBe(3);
  });
});

describe("localization helpers (T1)", () => {
  const translated = {
    name: "Basic Concoction",
    system: { description: "<p>You gain a 1st- or 2nd-level alchemist feat.</p>" },
    i18n: {
      ptBR: {
        name: "Concocção Básica",
        description: "<p>Você ganha um talento de alquimista de 1º ou 2º nível.</p>",
      },
    },
  };
  const untranslated = {
    name: "Longsword",
    system: { description: "<p>A versatile blade.</p>" },
  };

  describe("pickLocalizedName", () => {
    it("returns the pt-BR name when locale is pt-BR and a translation exists", () => {
      expect(pickLocalizedName(translated, "pt-BR")).toBe("Concocção Básica");
    });

    it("returns the EN name when locale is en", () => {
      expect(pickLocalizedName(translated, "en")).toBe("Basic Concoction");
    });

    it("falls back to the EN name when no translation exists (pt-BR locale)", () => {
      expect(pickLocalizedName(untranslated, "pt-BR")).toBe("Longsword");
    });

    it("returns '' for a null/nameless source", () => {
      expect(pickLocalizedName(null, "pt-BR")).toBe("");
      expect(pickLocalizedName({}, "pt-BR")).toBe("");
    });
  });

  describe("pickEnName", () => {
    it("always returns the EN name regardless of translation", () => {
      expect(pickEnName(translated)).toBe("Basic Concoction");
      expect(pickEnName(untranslated)).toBe("Longsword");
    });
  });

  describe("localizedNameParts", () => {
    it("exposes the EN subtitle only when a translation is actually shown", () => {
      expect(localizedNameParts(translated, "pt-BR")).toEqual({
        display: "Concocção Básica",
        subtitleEn: "Basic Concoction",
      });
    });

    it("has no subtitle when untranslated (display equals EN)", () => {
      expect(localizedNameParts(untranslated, "pt-BR")).toEqual({
        display: "Longsword",
        subtitleEn: null,
      });
    });

    it("has no subtitle on the en locale", () => {
      expect(localizedNameParts(translated, "en")).toEqual({
        display: "Basic Concoction",
        subtitleEn: null,
      });
    });
  });

  describe("pickLocalizedDescription", () => {
    it("prefers the pt-BR description on the pt-BR locale", () => {
      expect(pickLocalizedDescription(translated, "pt-BR")).toBe(
        "<p>Você ganha um talento de alquimista de 1º ou 2º nível.</p>",
      );
    });

    it("uses the EN description on the en locale", () => {
      expect(pickLocalizedDescription(translated, "en")).toBe(
        "<p>You gain a 1st- or 2nd-level alchemist feat.</p>",
      );
    });

    it("falls back to the EN description when no translation exists", () => {
      expect(pickLocalizedDescription(untranslated, "pt-BR")).toBe("<p>A versatile blade.</p>");
    });

    it("returns null when neither a translation nor an EN description is present", () => {
      expect(pickLocalizedDescription({ name: "X" }, "pt-BR")).toBeNull();
      expect(pickLocalizedDescription(null, "pt-BR")).toBeNull();
    });
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
