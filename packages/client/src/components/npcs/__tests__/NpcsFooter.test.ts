/**
 * NpcsFooter.test.ts — the drawn footer of the NPCs tab (spec 42 §5.8, G076).
 *
 * Covers REQ-NPC-062 (a FIXED footer that holds the chest control and the door to
 * the knowledge window, and nothing else), REQ-NPC-060 (the chest control, what it
 * looks like with no scene on air, and that it delegates to `npcsFooter.ts`'s
 * `placeChest` rather than building its own payload) and REQ-NPC-061 (the actor it
 * asks for carries no folder and no attitude — `npcsFooter.test.ts` proves the
 * `doc:create` itself; this file proves the component never writes a second one).
 * REQ-NPC-094 is checked here too: the two glyphs are drawn, never emoji.
 *
 * The client runs Vitest in a node environment — no jsdom, no testing-library — so
 * the assertions read the server-rendered markup (`svelte/server`) and the
 * component's own source for what a rendered string cannot show (there is no click
 * to simulate here). The wire-level proof that a click sends a `doc:create` lives
 * in `lib/npcs/__tests__/npcsFooter.test.ts`, against the very `placeChest` this
 * component imports and calls — a payload claim is proven at the socket, not read
 * off a rendered string.
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import NpcsFooter from "../NpcsFooter.svelte";
import "../../../lib/i18n/index.js";

function renderFooter(activeSceneId: string | null): string {
  return render(NpcsFooter, { props: { socket: {} as never, activeSceneId } }).body;
}

/** Source with every comment removed, so prose about an op is never read as one. */
const SOURCE = readFileSync(fileURLToPath(new URL("../NpcsFooter.svelte", import.meta.url)), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/** Every emoji-ish codepoint: pictographs, dingbats and the variation selector. */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE0F}]/u;

describe("REQ-NPC-062: the footer is fixed, and holds exactly two controls", () => {
  it("REQ-NPC-062: it is a footer element with the chest and the knowledge window", () => {
    const body = renderFooter("scn-clareira001");

    expect(body).toContain("<footer");
    expect(body).toContain("data-npcs-footer");
    expect(body).toContain('data-action="place-chest"');
    expect(body).toContain('data-action="open-knowledge"');
    // Two controls, no third: the footer is not a second toolbar.
    expect([...body.matchAll(/<button/g)]).toHaveLength(2);
  });

  it("REQ-NPC-062: it does not scroll with the list — it never shrinks", () => {
    expect(SOURCE).toMatch(/\.npcs-footer\s*\{[^}]*flex:\s*0\s+0\s+auto/);
    // And it holds no scrolling area of its own that a row could hide in.
    expect(SOURCE).not.toContain("overflow-y: auto");
  });

  it("REQ-NPC-072: the knowledge control opens the Contatos tab's window", () => {
    const body = renderFooter("scn-clareira001");

    expect(body).toContain("Quem conhece quem");
    expect(SOURCE).toContain("openKnowledgeWindow");
    expect(SOURCE).not.toContain("windowManager.open");
  });
});

describe("REQ-NPC-060: the chest control, and the scene it needs", () => {
  it("REQ-NPC-060: with a scene on air it is offered and enabled", () => {
    const body = renderFooter("scn-clareira001");

    expect(body).toContain("Pôr um baú na cena");
    expect(body).not.toContain("disabled");
    expect(body).not.toContain("data-chest-hint");
  });

  it("REQ-NPC-060: with no scene on air it is off, and says why in words", () => {
    const body = renderFooter(null);

    expect(body).toContain("disabled");
    expect(body).toContain("data-chest-hint");
    expect(body).toContain("Nenhuma cena no ar");
  });
});

describe("REQ-NPC-061 / REQ-NPC-094: what the footer does not build itself", () => {
  it("REQ-NPC-060: the chest button delegates to npcsFooter.ts's placeChest, and builds no payload of its own", () => {
    // The one write this footer causes goes through the tested module — this
    // file never spells `doc:create`, `documentType` or the chest's subtype:
    // if it did, there would be a SECOND place constructing the same op.
    expect(SOURCE).toContain("placeChest as sendPlaceChest");
    expect(SOURCE).not.toContain("doc:create");
    expect(SOURCE).not.toContain("documentType");
    expect(SOURCE).not.toContain("loot");
  });

  it("REQ-NPC-061: the component writes no folder or attitude of its own", () => {
    expect(SOURCE).not.toContain("folder");
    expect(SOURCE).not.toContain("attitude");
  });

  it("REQ-NPC-061 / REQ-NPC-094: the component alters no document directly, and deletes nothing", () => {
    expect(SOURCE).not.toContain("doc:delete");
    expect(SOURCE).not.toContain("doc:update");
  });

  it("REQ-NPC-094: both glyphs are drawn, and neither is an emoji", () => {
    const body = renderFooter("scn-clareira001");

    expect([...body.matchAll(/<svg/g)]).toHaveLength(2);
    expect(body).toMatch(/stroke="currentColor"/);
    expect(EMOJI.test(body)).toBe(false);
  });
});

describe("REQ-GAV-012: the footer fits the drawer's fixed 300px panel in one row", () => {
  // The prototype (npcs-tab.prototype.html:2466-2468) sizes the chest to its own
  // content and only stretches "Quem conhece" — never a 50/50 split, which is
  // what pushed the wide label onto a second line before this fix.
  it("REQ-GAV-012: only the knowledge button stretches — the chest sizes to its content", () => {
    expect(SOURCE).toMatch(/\.npcs-footer__btn--chest\s*\{[^}]*flex:\s*0\s+0\s+auto/);
    expect(SOURCE).toMatch(/\.npcs-footer__btn--wide\s*\{[^}]*flex:\s*1\s+1\s+0/);
    // The base rule carries no flex of its own anymore — only the modifiers do.
    expect(SOURCE).toMatch(/\.npcs-footer__btn\s*\{(?:(?!flex:)[^}])*\}/);
  });

  it("REQ-GAV-012: the chest and the knowledge door carry the modifier classes", () => {
    const body = renderFooter("scn-clareira001");

    expect(body).toMatch(
      /class="npcs-footer__btn npcs-footer__btn--chest[^"]*"[^>]*data-action="place-chest"/,
    );
    expect(body).toMatch(
      /class="npcs-footer__btn npcs-footer__btn--wide[^"]*"[^>]*data-action="open-knowledge"/,
    );
  });

  it("REQ-GAV-012: the visible labels are short — the long text stays in title/aria-label", () => {
    const body = renderFooter("scn-clareira001");

    // Short labels the prototype uses so the row never wraps.
    expect(body).toMatch(/>\s*Baú\s*</);
    expect(body).toMatch(/>\s*Quem conhece\s*</);
    // The long, descriptive text is still there — just off the visible row.
    expect(body).toContain("Pôr um baú na cena");
    expect(body).toContain("Quem conhece quem");
  });
});
