/**
 * ScenesTabHead.test.ts — the "no ar" head of the Cenas tab, as it is drawn (plan G080).
 *
 * The projection itself is tested in `lib/scenes/__tests__/scenesTabVM.test.ts`. What is
 * asserted here is what only the component can answer: that the head sits at the top and
 * OUTSIDE the archive's scrolling area, that its height comes from the theme token and
 * from nothing else, and that every state — scene with a map, scene with only a colour,
 * nothing on air — draws the same box.
 *
 * The client's Vitest runs in a node environment (no DOM), so the assertions are on the
 * server-rendered markup and on the component's own stylesheet — the same technique
 * `ScenesTab.test.ts` and `SidebarResponsive.test.ts` use, and the right one here because
 * the height rule IS declarative.
 *
 * Covers REQ-CEN-010, REQ-CEN-011, REQ-CEN-012, REQ-CEN-013, REQ-CEN-014, REQ-CEN-015
 * and RNF-CEN-02.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SceneDocument } from "@fusion/shared";

import ScenesTab from "../ScenesTab.svelte";
import { sceneListState } from "../../../lib/scenes/scenesState.svelte.js";
import {
  SCENE_HEAD_HEIGHT_TOKEN,
  SCENE_HEAD_IMAGE_SIZES,
} from "../../../lib/scenes/scenesTabVM.js";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

function makeScene(overrides: Partial<SceneDocument> & { _id: string }): SceneDocument {
  return {
    type: "Scene",
    name: "Cena",
    width: 4000,
    height: 3000,
    grid: { type: "square", size: 100 },
    background: null,
    backgroundColor: "#101018",
    thumb: null,
    tokens: [],
    walls: [],
    ...overrides,
  } as unknown as SceneDocument;
}

function renderTab(activeSceneId: string | null): string {
  const { body } = render(ScenesTab, {
    props: {
      socket: {} as never,
      worldId: "world-1",
      userId: "user-1",
      isGm: true,
      activeSceneId,
    },
  });
  return body;
}

function styleOfScenesTab(): string {
  const source = readFileSync(
    fileURLToPath(new URL("../ScenesTab.svelte", import.meta.url)),
    "utf8",
  );
  const style = /<style>([\s\S]*)<\/style>/.exec(source)?.[1];
  if (style === undefined) throw new Error("ScenesTab.svelte has no <style> block");
  return style;
}

/** The theme sheet — the only place a design token is given a number. */
function baseCss(): string {
  return readFileSync(fileURLToPath(new URL("../../../styles/base.css", import.meta.url)), "utf8");
}

/** The declaration block of a single class selector, for height assertions. */
function ruleFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (match === null) throw new Error(`no rule for ${selector}`);
  return match[1] ?? "";
}

describe("ScenesTab — the head that says what is on air", () => {
  beforeEach(() => {
    sceneListState.scenes = [];
  });

  describe("shape and height (REQ-CEN-010, REQ-CEN-013)", () => {
    it("REQ-CEN-010: the head is drawn before the archive and outside its scrolling area", () => {
      sceneListState.scenes = [makeScene({ _id: "s1", name: "Taverna" })];

      const html = renderTab("s1");

      const headAt = html.indexOf("scene-head");
      const bodyAt = html.indexOf("scenes-tab__body");
      expect(headAt).toBeGreaterThanOrEqual(0);
      expect(headAt).toBeLessThan(bodyAt);

      const css = styleOfScenesTab();
      // The archive is the thing that scrolls...
      expect(ruleFor(css, ".scenes-tab__body")).toMatch(/overflow-y:\s*auto/);
      // ...and the head is not inside it: it never shrinks and never scrolls away.
      expect(ruleFor(css, ".scene-head")).toMatch(/flex-shrink:\s*0/);
    });

    it("REQ-CEN-010: the height comes from the theme token, and it is a height, not a floor", () => {
      const rule = ruleFor(styleOfScenesTab(), ".scene-head");

      // The token the head is drawn with is the very one the VM module publishes as the
      // head's theme contract (`SCENE_HEAD_HEIGHT_TOKEN`) — rename one side and this fails.
      expect(rule).toMatch(new RegExp(`height:\\s*var\\(${SCENE_HEAD_HEIGHT_TOKEN}\\)`));
      expect(rule).not.toMatch(/min-height/);
      expect(rule).not.toMatch(/max-height/);
      // And the token is given a number in exactly one place: the theme.
      expect(baseCss()).toMatch(new RegExp(`${SCENE_HEAD_HEIGHT_TOKEN}:\\s*\\d+px`));
    });

    it("REQ-CEN-013: a long name is truncated legibly instead of wrapping the head taller", () => {
      const css = styleOfScenesTab();
      const rule = ruleFor(css, ".scene-head__name");

      expect(rule).toMatch(/white-space:\s*nowrap/);
      expect(rule).toMatch(/text-overflow:\s*ellipsis/);
      expect(rule).toMatch(/overflow:\s*hidden/);

      // The whole name is still reachable — the tooltip carries it untruncated.
      const longName = "A Grande Ponte Suspensa Sobre o Abismo de Vidro Negro";
      sceneListState.scenes = [makeScene({ _id: "s1", name: longName })];
      expect(renderTab("s1")).toContain(`title="${longName}"`);
    });

    it("REQ-CEN-013: every state of the head is the same box — no state carries its own height", () => {
      const css = styleOfScenesTab();
      sceneListState.scenes = [makeScene({ _id: "s1" })];

      const onAir = renderTab("s1");
      const nothingOnAir = renderTab(null);

      for (const html of [onAir, nothingOnAir]) {
        expect(html).toMatch(/<section class="scene-head[ "]/);
      }
      // No state-specific height anywhere in the head's own rules.
      expect(css).not.toMatch(/\.scene-head__(state|info|canvas)[^{]*\{[^}]*height:\s*\d/);
    });
  });

  describe("what the head says about the scene on air (REQ-CEN-011, REQ-CEN-012)", () => {
    it("REQ-CEN-011: names the scene, its dimensions and its grid size", () => {
      sceneListState.scenes = [
        makeScene({
          _id: "s1",
          name: "Cripta de Gelo",
          width: 4200,
          height: 2800,
          grid: { type: "square", size: 140 } as SceneDocument["grid"],
        }),
      ];

      const html = renderTab("s1");

      expect(html).toContain("Cripta de Gelo");
      expect(html).toContain(t("FUSION.Scene.Head.Dimensions", { width: 4200, height: 2800 }));
      expect(html).toContain(t("FUSION.Scene.Head.GridSquare", { size: 140 }));
    });

    it("REQ-CEN-011 / RNF-CEN-02: the background image is scaled into the fixed box", () => {
      sceneListState.scenes = [
        makeScene({ _id: "s1", background: "https://cdn.example/mapa.webp" }),
      ];

      const html = renderTab("s1");

      expect(html).toMatch(/<img[^>]*class="scene-head__image[ "]/);
      expect(html).toContain('src="https://cdn.example/mapa.webp"');
      // RNF-CEN-02: the browser is told the box is drawer-wide, not map-wide.
      expect(html).toContain(`sizes="${SCENE_HEAD_IMAGE_SIZES}"`);
      // And the image is covered into the head instead of setting its size.
      expect(ruleFor(styleOfScenesTab(), ".scene-head__image")).toMatch(/object-fit:\s*cover/);
    });

    it("RNF-CEN-02: the `sizes` hint is the drawer's width, and follows it", () => {
      // `sizes` is an HTML attribute and cannot read a CSS custom property, so the drawer
      // width is repeated in `scenesTabVM.ts`. This is the guard against the two drifting
      // apart: widen the drawer (REQ-GAV-012) and the hint has to be widened with it.
      const drawerWidth = /--fusion-sidebar-width:\s*([^;]+);/.exec(baseCss())?.[1]?.trim();

      expect(drawerWidth).toBe(SCENE_HEAD_IMAGE_SIZES);
    });

    it("REQ-CEN-012: a scene with no image paints its own background colour, same box", () => {
      sceneListState.scenes = [
        makeScene({ _id: "s1", background: null, backgroundColor: "#2b1a3d" }),
      ];

      const html = renderTab("s1");

      expect(html).toContain("background-color: #2b1a3d");
      expect(html).not.toMatch(/<img[^>]*class="scene-head__image[ "]/);
      // The identification is still there — nothing collapsed.
      expect(html).toContain(t("FUSION.Scene.Head.OnAir"));
    });
  });

  describe("nothing on air (REQ-CEN-014)", () => {
    it("REQ-CEN-014: says it, says the players are on the waiting screen, and offers to fix it", () => {
      sceneListState.scenes = [makeScene({ _id: "s1" }), makeScene({ _id: "s2" })];

      const html = renderTab(null);

      expect(html).toContain(t("FUSION.Scene.Head.Empty"));
      expect(html).toContain(t("FUSION.Scene.Head.EmptyNotice"));
      expect(html).toContain(t("FUSION.Scene.Head.ChooseScene"));
    });

    it("REQ-CEN-014: a world with no scene at all still says it, and offers nothing to put on air", () => {
      const html = renderTab(null);

      expect(html).toContain(t("FUSION.Scene.Head.Empty"));
      expect(html).not.toContain(t("FUSION.Scene.Head.ChooseScene"));
      // The invitation to create the first scene is the archive's, and it is still there.
      expect(html).toContain(t("FUSION.Sidebar.Scenes.Empty"));
    });
  });

  describe("following the world (REQ-CEN-015)", () => {
    it("REQ-CEN-015: the head shows whichever scene the world says is on air", () => {
      sceneListState.scenes = [
        makeScene({ _id: "s1", name: "Taverna" }),
        makeScene({ _id: "s2", name: "Cripta" }),
      ];

      const onTaverna = renderTab("s1");
      const onCripta = renderTab("s2");

      const headOf = (html: string): string =>
        /<section class="scene-head[^"]*"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
      expect(headOf(onTaverna)).toContain("Taverna");
      expect(headOf(onTaverna)).not.toContain("Cripta");
      expect(headOf(onCripta)).toContain("Cripta");
      expect(headOf(onCripta)).not.toContain("Taverna");
    });

    it("REQ-CEN-015: the head keeps no copy of the scene — it is derived from the world", () => {
      const source = readFileSync(
        fileURLToPath(new URL("../ScenesTab.svelte", import.meta.url)),
        "utf8",
      );

      // The head is a `$derived` projection; a `$state` snapshot of it would be the
      // local copy that goes stale when another GM changes the scene on air.
      expect(source).toMatch(/const head = \$derived\(/);
    });
  });

  // Ajustes r1, item 27 (plan A052): the prototype (`scenes-tab.prototype.html`,
  // `liveHead()`) anchors "no ar" to the TOP of the head, isolated from the name — not
  // stacked with it in the footer gradient block. Structural proof, not a screenshot:
  // the flag markup must be a SIBLING of `.scene-head__info` (never nested inside it),
  // and must be pinned to the head's own top edge, independent of the footer block.
  describe("the on-air flag is anchored to the top, apart from the name (REQ-CEN-010, REQ-CEN-011, REQ-CEN-013)", () => {
    function headOf(html: string): string {
      const match = /<section class="scene-head[^"]*"[\s\S]*?<\/section>/.exec(html);
      if (match === null) throw new Error("no .scene-head section in the rendered markup");
      return match[0];
    }

    it("REQ-CEN-011: the flag is NOT nested inside `.scene-head__info` — it is a sibling of it", () => {
      sceneListState.scenes = [makeScene({ _id: "s1", name: "Taverna" })];
      const head = headOf(renderTab("s1"));

      // `.scene-head__info` only ever wraps `<span>`s (name, meta) — no nested `<div>` —
      // so its content runs up to the very next closing tag.
      const infoMatch = /<div class="scene-head__info[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(head);
      expect(infoMatch).not.toBeNull();
      const infoInner = infoMatch?.[1] ?? "";

      expect(infoInner).not.toContain("scene-head__flag");
      // The name and dimensions stay exactly where they were — in the footer block.
      expect(infoInner).toContain("scene-head__name");
      expect(infoInner).toContain("scene-head__meta");
    });

    it("REQ-CEN-011: the flag markup sits before `.scene-head__info` opens, as its own element", () => {
      sceneListState.scenes = [makeScene({ _id: "s1", name: "Taverna" })];
      const head = headOf(renderTab("s1"));

      const canvasCloseAt = head.indexOf("</div>"); // closes `.scene-head__canvas`
      const flagAt = head.indexOf("scene-head__flag");
      const infoOpenAt = head.indexOf("scene-head__info");

      expect(canvasCloseAt).toBeGreaterThan(-1);
      expect(flagAt).toBeGreaterThan(canvasCloseAt);
      expect(flagAt).toBeLessThan(infoOpenAt);
      expect(head).toContain(t("FUSION.Scene.Head.OnAir"));
    });

    it("REQ-CEN-013: the flag is pinned to the head's own top edge, not carried by the footer", () => {
      const css = styleOfScenesTab();

      const flagRule = ruleFor(css, ".scene-head__flag");
      expect(flagRule).toMatch(/position:\s*absolute/);
      expect(flagRule).toMatch(/top:\s*0/);

      // The head is the positioning context — unchanged by this move.
      expect(ruleFor(css, ".scene-head")).toMatch(/position:\s*relative/);

      // No height leaks from the flag into the fixed-height box (REQ-CEN-013/REQ-CEN-010).
      expect(flagRule).not.toMatch(/height:\s*\d/);
    });

    it("Ajustes r1 review (2026-08-17): the flag carries its own scrim over the scene's image", () => {
      // The flag sits directly on `.scene-head__canvas` (the scene's own background
      // image, DEC-CEN-04) with no gradient underneath it any more — green text with
      // no anteparo of its own is unreadable over a light map. An explicit `left` is
      // asserted too: the flag is an out-of-flow child with no other inset set, so its
      // horizontal position would otherwise depend on static-position fallback instead
      // of a declared value.
      const css = styleOfScenesTab();
      const flagRule = ruleFor(css, ".scene-head__flag");

      expect(flagRule).toMatch(/background:\s*rgba\(0,\s*0,\s*0/);
      expect(flagRule).toMatch(/left:\s*[\d.]/);
    });

    it("REQ-CEN-010: the head's height stays the theme token, on air or not, flag or no flag", () => {
      const css = styleOfScenesTab();
      sceneListState.scenes = [makeScene({ _id: "s1" })];

      const onAir = renderTab("s1");
      const nothingOnAir = renderTab(null);

      expect(onAir).toContain("scene-head__flag");
      expect(nothingOnAir).not.toContain("scene-head__flag");
      // Same fixed-height rule regardless — checked once in the shape/height describe
      // above; here we only confirm the flag itself never gets its own height rule.
      expect(ruleFor(css, ".scene-head")).toMatch(
        new RegExp(`height:\\s*var\\(${SCENE_HEAD_HEIGHT_TOKEN}\\)`),
      );
    });
  });
});
