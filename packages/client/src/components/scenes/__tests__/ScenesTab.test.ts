/**
 * ScenesTab.test.ts — the scene panel after it left the pre-drawer sidebar (G016).
 *
 * The move is a bridge, not a redesign: the table must keep doing everything it did
 * — list the scenes, see which one is on air, activate, edit, delete, and be told
 * when the world has no scene yet. These assertions are on the server-rendered
 * markup (the client's Vitest has no DOM), which is where "the panel still offers
 * the action" is observable.
 *
 * Covers REQ-GAV-011 (no collapse control inside the panel — the rail's active tab
 * is the only gesture), REQ-GAV-017 (nothing in the panel keeps state that must
 * survive the unmount) and REQ-CEN-001 (this is the panel behind tab "scenes").
 * The empty state is spec 36 §7.4. The keyboard block covers REQ-CEN-090 — the row
 * actions must be reachable with visible focus, so the hover-only reveal they inherited
 * from the old sidebar gets a focus equivalent (REQ-UIF-064).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SceneDocument } from "@fusion/shared";

import ScenesTab from "../ScenesTab.svelte";
import { sceneListState } from "../../../lib/scenes/scenesState.svelte.js";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

function makeScene(id: string, name: string): SceneDocument {
  return {
    _id: id,
    name,
    type: "Scene",
    width: 1000,
    height: 1000,
    grid: { type: "square", size: 100 },
    tokens: [],
    walls: [],
  } as unknown as SceneDocument;
}

/**
 * The component's own stylesheet. Vitest runs the client in a node environment — no
 * DOM, so no `:hover` to leave and no `:focus-visible` to trigger — and the rule under
 * test IS declarative. Same technique the drawer's keyboard test uses
 * (`SidebarResponsive.test.ts`).
 */
function styleOfScenesTab(): string {
  const source = readFileSync(
    fileURLToPath(new URL("../ScenesTab.svelte", import.meta.url)),
    "utf8",
  );
  const style = /<style>([\s\S]*)<\/style>/.exec(source)?.[1];
  if (style === undefined) throw new Error("ScenesTab.svelte has no <style> block");
  return style;
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

describe("ScenesTab — the scene panel, moved out of the old sidebar unchanged", () => {
  beforeEach(() => {
    sceneListState.scenes = [];
  });

  it("REQ-CEN-001 / REQ-CEN-036: lists the scenes of the world, and the one on air only in the head", () => {
    sceneListState.scenes = [makeScene("s1", "Taverna"), makeScene("s2", "Cripta")];

    const html = renderTab("s2");

    // Both scenes are named by the panel...
    expect(html).toContain("Taverna");
    expect(html).toContain("Cripta");
    // ...but the one on air is named by the HEAD, and is not a line of the archive
    // (REQ-CEN-036) — which is why the "active row" marker of the old sidebar is gone.
    expect(html).not.toContain("scene-row__dot--on");
    const archive = html.slice(html.indexOf('class="scenes-tab__body'));
    expect(archive).toContain("Taverna");
    expect(archive).not.toContain("Cripta");
  });

  it("REQ-CEN-001 / REQ-CEN-036: every scene of the archive keeps its activate, edit and delete actions", () => {
    sceneListState.scenes = [makeScene("s1", "Taverna"), makeScene("s2", "Cripta")];

    const html = renderTab("s2");

    // The scene NOT on air keeps the three verbs of the row...
    expect(html).toContain(`${t("FUSION.Scene.Dialog.ActivateScene")} Taverna`);
    expect(html).toContain(`${t("FUSION.Scene.Dialog.EditScene")} Taverna`);
    expect(html).toContain(`${t("FUSION.Scene.Dialog.DeleteScene")} Taverna`);
    // ...and the one on air has no row at all, so it offers none of them here.
    expect(html).not.toContain(`${t("FUSION.Scene.Dialog.ActivateScene")} Cripta`);
    expect(html).not.toContain(`${t("FUSION.Scene.Dialog.EditScene")} Cripta`);
    // And the header still offers creating one.
    expect(html).toContain(t("FUSION.Sidebar.Scenes.Create"));
  });

  it("spec 36 §7.4 / REQ-CEN-080: a world with no scene shows the invitation to create the first", () => {
    const html = renderTab(null);

    expect(html).toContain(t("FUSION.Sidebar.Scenes.Empty"));
    expect(html).not.toContain("scene-row__name");
  });

  it("REQ-CEN-080 / REQ-CEN-036: with the world's only scene on air, the panel does not claim there is none", () => {
    // The archive is empty because the scene lives in the head (REQ-CEN-036) — and the
    // head is naming it right above. "Nenhuma cena criada" here would be the panel
    // contradicting itself on the same screen; REQ-CEN-080 reserves that sentence for a
    // world with no scene at all.
    sceneListState.scenes = [makeScene("s1", "Taverna")];

    const html = renderTab("s1");

    expect(html).toContain("Taverna");
    expect(html).not.toContain(t("FUSION.Sidebar.Scenes.Empty"));
    expect(html).toContain(t("FUSION.Scene.Shelf.OnlyOnAir"));
  });

  it("REQ-GAV-011: the panel carries no collapse control of its own", () => {
    sceneListState.scenes = [makeScene("s1", "Taverna")];

    const html = renderTab("s1");

    // No ✕ and no chevron: the rail's active tab is the only way to collapse.
    // `×` (U+00D7) is deliberately NOT in this set: since REQ-CEN-011 the head writes
    // the scene's dimensions as "4200 × 2800 px", where the multiplication sign is
    // typography, not a close control.
    expect(html).not.toMatch(/[✕✖❯☰]/);
    expect(html.toLowerCase()).not.toContain("collapse");
  });

  it("REQ-NPC-094: the row actions are drawn icons, never a glyph", () => {
    // Nothing on air, so both scenes are lines of the archive (REQ-CEN-036).
    sceneListState.scenes = [makeScene("s1", "Taverna"), makeScene("s2", "Cripta")];

    const html = renderTab(null);

    const actionButtons = [...html.matchAll(/<button[^>]*class="action-btn[\s\S]*?<\/button>/g)];
    expect(actionButtons.length).toBeGreaterThanOrEqual(5);
    for (const [button] of actionButtons) {
      expect(button).toContain("<svg");
      expect(button).not.toMatch(/\p{Extended_Pictographic}|[\u{2190}-\u{2BFF}]/u);
    }
  });

  describe("keyboard (REQ-CEN-090)", () => {
    it("REQ-CEN-090: the row actions are real buttons in the natural focus order", () => {
      // Nothing on air, so both scenes are lines of the archive (REQ-CEN-036).
      sceneListState.scenes = [makeScene("s1", "Taverna"), makeScene("s2", "Cripta")];

      const html = renderTab(null);

      const actionTags = [...html.matchAll(/<button[^>]*class="action-btn[^>]*>/g)].map(
        (match) => match[0],
      );
      expect(actionTags.length).toBeGreaterThanOrEqual(5);
      for (const tag of actionTags) {
        // Nothing removes them from the tab sequence, and each one names its scene.
        expect(tag).not.toMatch(/tabindex="-1"/);
        expect(tag).toMatch(/aria-label="/);
      }
    });

    it("REQ-CEN-090 / REQ-UIF-064: focusing a row action reveals it — hover is not the only way", () => {
      const css = styleOfScenesTab();

      // The group starts hidden...
      expect(css).toMatch(/\.scene-row__actions\s*\{[^}]*opacity:\s*0/);
      // ...and hover is not the sole trigger that brings it back: keyboard focus
      // anywhere in the row reveals it too, so no one tabs onto an invisible button.
      expect(css).toMatch(
        /\.scene-row:focus-within\s+\.scene-row__actions[^{]*\{[^}]*opacity:\s*1/,
      );
    });

    it("REQ-CEN-090: the focused row action draws a visible ring", () => {
      expect(styleOfScenesTab()).toMatch(/\.action-btn:focus-visible\s*\{[^}]*outline:\s*(?!none)/);
    });

    it("REQ-CEN-090 / REQ-CEN-037: reordering is reachable without a mouse — the grip is a button", () => {
      // REQ-CEN-037 names the drag, which is a pointer gesture; REQ-CEN-090 requires
      // EVERY action of the line, reordering included, to be reachable from the
      // keyboard. A decorative `aria-hidden` handle is unreachable by definition.
      sceneListState.scenes = [makeScene("s1", "Taverna"), makeScene("s2", "Cripta")];

      const html = renderTab(null);

      const grips = [...html.matchAll(/<button[^>]*class="scene-row__grip[^>]*>/g)].map(
        (match) => match[0],
      );
      expect(grips).toHaveLength(2);
      for (const grip of grips) {
        expect(grip).not.toMatch(/aria-hidden="true"/);
        expect(grip).not.toMatch(/tabindex="-1"/);
        // It names the scene it moves, like every other action of the line.
        expect(grip).toMatch(/aria-label="/);
      }
      expect(html).toContain(`${t("FUSION.Scene.Shelf.Reorder")}: Taverna`);
    });

    it("REQ-CEN-090: the focused grip draws a visible ring too", () => {
      expect(styleOfScenesTab()).toMatch(
        /\.scene-row__grip:focus-visible\s*\{[^}]*outline:\s*(?!none)/,
      );
    });
  });
});
