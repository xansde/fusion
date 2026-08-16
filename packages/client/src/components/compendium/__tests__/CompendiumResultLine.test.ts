/**
 * CompendiumResultLine.test.ts — the line drawn (spec 43 §5.5, G093).
 *
 * Rendered with `render()` from `svelte/server`, like `CompendiumShelf.test.ts`:
 * the client's Vitest runs in a node environment with no DOM, so the
 * server-rendered markup is what a component test reads. The line is
 * presentational precisely so it can be handed a built view model here.
 *
 * Covers REQ-CPD-040 (image or type icon, translated name plus the original),
 * REQ-CPD-041 (the fields the pack declared), REQ-CPD-042 (the matched run
 * marked), REQ-CPD-043 (the in-world seal with the DEC-CPD-12 caveat within
 * reach), REQ-CPD-044 (draggable only where §5.7 gives a destination),
 * REQ-CPD-045 (the fallback keeps the row's alignment) and REQ-CPD-046 (no
 * creature statistic on an unprivileged line).
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PackIndexEntry } from "@fusion/shared";

import CompendiumResultLine from "../CompendiumResultLine.svelte";
import {
  buildResultLine,
  buildWorldOriginIndex,
  type ResultLineContext,
} from "../../../lib/compendium/resultLine.js";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<PackIndexEntry> = {}): PackIndexEntry {
  return {
    _id: "abc0123456789def",
    uuid: "Compendium.pf2e.spells-core.Item.abc0123456789def",
    name: "Fireball",
    img: "icons/spells/fireball.webp",
    type: "spell",
    index: {},
    ...overrides,
  } as PackIndexEntry;
}

const SPELL = makeEntry({
  namePt: "Bola de Fogo",
  i18n: { ptBR: { name: "Bola de Fogo" } },
  index: {
    "system.level.value": 3,
    "system.traits.value": ["fire", "arcane"],
    "flags.fusion.sourceId": "vendor-src-1",
  },
});

function renderLine(
  entry: PackIndexEntry,
  ctx: Partial<ResultLineContext> = {},
  props: Record<string, unknown> = {},
): string {
  const line = buildResultLine(entry, {
    documentType: "Item",
    packId: "pf2e.spells-core",
    indexFields: ["system.level.value", "system.traits.value"],
    locale: "pt-BR",
    viewerIsPrivileged: true,
    ...ctx,
  });
  const { body } = render(CompendiumResultLine, {
    props: { line, onPreview: () => undefined, ...props },
  });
  return body;
}

function source(): string {
  return readFileSync(
    fileURLToPath(new URL("../CompendiumResultLine.svelte", import.meta.url)),
    "utf8",
  );
}

/** The declarations of one CSS rule, by selector, from the component's style. */
function declarationsOf(selector: string): string {
  const style = /<style>([\s\S]*)<\/style>/.exec(source())?.[1];
  if (style === undefined) throw new Error("CompendiumResultLine.svelte has no <style> block");
  const css = style.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((rule) => (rule[1] ?? "").split(",").some((s) => s.trim() === selector))
    .map((rule) => rule[2] ?? "")
    .join("\n");
}

/** How many declared index fields the markup actually drew. */
function fieldCount(html: string): number {
  return [...html.matchAll(/class="result-line__field[" ]/g)].length;
}

// ---------------------------------------------------------------------------

describe("CompendiumResultLine — two names, the fields, and a seal that promises nothing", () => {
  it("REQ-CPD-040: the translated name leads and the original follows it", () => {
    const html = renderLine(SPELL);

    expect(html).toContain("Bola de Fogo");
    expect(html).toContain("Fireball");
    // The original is the secondary line, not the headline.
    expect(html.indexOf("Bola de Fogo")).toBeLessThan(html.indexOf("result-line__name-original"));
  });

  it("REQ-CPD-040: with only one name there is no second line to read", () => {
    const html = renderLine(makeEntry({ index: {} }));

    expect(html).toContain("Fireball");
    expect(html).not.toContain("result-line__name-original");
  });

  it("REQ-CPD-041: the declared index fields are drawn, with a readable label", () => {
    const html = renderLine(SPELL);

    expect(html).toContain(t("FUSION.Compendium.Field.system.level.value"));
    expect(html).toContain("fire, arcane");
    // Two fields declared, two drawn — and the origin flag is not one of them.
    expect(fieldCount(html)).toBe(2);
    expect(html).not.toContain("vendor-src-1");
  });

  it("REQ-CPD-042: the matched run is marked, and as markup, never as injected HTML", () => {
    const html = renderLine(SPELL, { search: "fogo" });

    expect(html).toMatch(/<mark[^>]*>Fogo<\/mark>/);
    // Nothing in this component hands a string to `{@html}`.
    expect(source()).not.toContain("@html");
  });

  it("REQ-CPD-042: a name carrying markup is escaped, not executed", () => {
    const html = renderLine(makeEntry({ name: "<img src=x onerror=alert(1)>" }), {
      search: "img",
    });

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;");
  });

  it("REQ-CPD-043: the seal appears when the world already holds a document from this entry", () => {
    const worldOrigins = buildWorldOriginIndex([
      { _id: "worldid000000001", flags: { fusion: { sourceId: "vendor-src-1" } } },
    ]);
    const html = renderLine(SPELL, { worldOrigins });

    expect(html).toContain(t("FUSION.Compendium.Line.InWorld"));
    // DEC-CPD-12: the caveat travels with the seal — it does not claim sameness.
    expect(html).toContain(t("FUSION.Compendium.Line.InWorldHint"));
  });

  it("REQ-CPD-043: without a world document there is no seal at all", () => {
    const html = renderLine(SPELL, { worldOrigins: buildWorldOriginIndex([]) });

    expect(html).not.toContain("result-line__seal");
  });

  it("REQ-CPD-043/064: the seal never disables bringing the entry over again", () => {
    const worldOrigins = buildWorldOriginIndex([
      { _id: "worldid000000001", flags: { fusion: { sourceId: "vendor-src-1" } } },
    ]);
    const html = renderLine(SPELL, { worldOrigins }, { onImport: () => undefined });

    expect(html).toContain(t("FUSION.Compendium.Line.ImportShort"));
    expect(html).not.toContain("disabled");
  });

  it("REQ-CPD-044: a line with a destination is draggable, one without is not", () => {
    expect(renderLine(makeEntry(), { documentType: "Actor" })).toContain('draggable="true"');
    expect(renderLine(makeEntry(), { documentType: "JournalEntry" })).toContain(
      'draggable="false"',
    );
  });

  it("REQ-CPD-045: with no usable image the box holds a drawn icon, never an emoji", () => {
    const html = renderLine(makeEntry({ img: "icons/placeholder/spell.svg" }));

    expect(html).toContain("result-line__icon");
    expect(html).toContain("<svg");
    expect(html).not.toContain("<img");
    // Pictographs change shape per operating system and ignore the theme.
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it("REQ-CPD-045: image and fallback share one box, so a failed request shifts nothing", () => {
    const figure = declarationsOf(".result-line__figure");

    // The box has a fixed size of its own...
    expect(figure).toMatch(/width:\s*1\.8rem/);
    expect(figure).toMatch(/height:\s*1\.8rem/);
    expect(figure).toMatch(/flex-shrink:\s*0/);
    // ...and both fillings are sized by it, so neither can size differently.
    for (const selector of [".result-line__img", ".result-line__icon"]) {
      const filling = declarationsOf(selector);
      expect(filling).toMatch(/width:\s*1\.8rem/);
      expect(filling).toMatch(/height:\s*1\.8rem/);
    }
  });

  it("REQ-CPD-046: the line drawn for a player carries no hit points or armour class", () => {
    const creature = makeEntry({
      name: "Goblin Warrior",
      type: "npc",
      index: {
        "system.details.level.value": 1,
        "system.attributes.hp.max": 16,
        "system.attributes.ac.value": 16,
      },
    });
    const declared = [
      "system.details.level.value",
      "system.attributes.hp.max",
      "system.attributes.ac.value",
    ];

    const player = renderLine(creature, {
      documentType: "Actor",
      indexFields: declared,
      viewerIsPrivileged: false,
    });
    const gm = renderLine(creature, {
      documentType: "Actor",
      indexFields: declared,
      viewerIsPrivileged: true,
    });

    expect(player).not.toContain(t("FUSION.Compendium.Field.system.attributes.hp.max"));
    expect(player).not.toContain(t("FUSION.Compendium.Field.system.attributes.ac.value"));
    // Only the level survived — the two statistics were not drawn at all.
    expect(fieldCount(player)).toBe(1);
    expect(fieldCount(gm)).toBe(3);
    expect(gm).toContain(t("FUSION.Compendium.Field.system.attributes.hp.max"));
  });

  it("REQ-CPD-031: an aggregated line names the pack it came from", () => {
    const html = renderLine(SPELL, { packLabel: "Magias — Núcleo" });

    expect(html).toContain("Magias — Núcleo");
  });
});
