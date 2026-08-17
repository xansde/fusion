/**
 * ScenesTabShelf.test.ts — the archive as the tab draws it (plan G082).
 *
 * The rule of WHAT the archive holds, in which order, and what a search or a drag does
 * is pinned in `lib/scenes/__tests__/sceneShelf.test.ts`. What only the component can
 * answer is asserted here: that the groups reach the markup, that the scene on air is
 * absent from the list, that the search field appears only when the panel offers it,
 * that a line can be dragged, and that the footer says where the region map lives.
 *
 * The client's Vitest runs in a node environment (no DOM), so the assertions are on the
 * server-rendered markup and on the component's own source — the technique
 * `ScenesTabHead.test.ts` established here.
 *
 * Covers REQ-CEN-030, REQ-CEN-032, REQ-CEN-033, REQ-CEN-034, REQ-CEN-035, REQ-CEN-036,
 * REQ-CEN-037, REQ-CEN-039.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SceneDocument } from "@fusion/shared";

import ScenesTab from "../ScenesTab.svelte";
import { sceneListState } from "../../../lib/scenes/scenesState.svelte.js";
import { SCENE_SHELF_KEYS, SCENE_SHELF_SEARCH_THRESHOLD } from "../../../lib/scenes/sceneShelf.js";
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
    darkness: 0,
    fogEnabled: false,
    folder: null,
    sort: 0,
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

function sourceOfScenesTab(): string {
  return readFileSync(fileURLToPath(new URL("../ScenesTab.svelte", import.meta.url)), "utf8");
}

/** The archive block alone — everything below the head. */
function archiveOf(html: string): string {
  const start = html.indexOf('class="scenes-tab__body');
  return start === -1 ? "" : html.slice(start);
}

describe("ScenesTab — the archive below the head", () => {
  beforeEach(() => {
    sceneListState.scenes = [];
    sceneListState.folders = [];
  });

  it("REQ-CEN-030: the archive draws one group per folder, named by the folder", () => {
    sceneListState.folders = [
      { _id: "f-a", name: "Ato 1" },
      { _id: "f-b", name: "Ato 2" },
    ];
    sceneListState.scenes = [
      makeScene({ _id: "s1", name: "Taverna", folder: "f-a" }),
      makeScene({ _id: "s2", name: "Cripta", folder: "f-b" }),
    ];

    const archive = archiveOf(renderTab(null));

    expect(archive).toContain("Ato 1");
    expect(archive).toContain("Ato 2");
    expect(archive).toContain("Taverna");
    expect(archive).toContain("Cripta");
  });

  it("REQ-CEN-032: scenes with no folder get their own group, and it comes last", () => {
    sceneListState.folders = [{ _id: "f-a", name: "Ato 1" }];
    sceneListState.scenes = [
      makeScene({ _id: "s1", name: "Solta", folder: null }),
      makeScene({ _id: "s2", name: "Taverna", folder: "f-a" }),
    ];

    const archive = archiveOf(renderTab(null));
    const unfiled = t(SCENE_SHELF_KEYS.noFolder);

    expect(archive).toContain(unfiled);
    expect(archive.indexOf("Ato 1")).toBeLessThan(archive.indexOf(unfiled));
  });

  it("REQ-CEN-036: the scene on air is in the head and NOT in the archive", () => {
    sceneListState.scenes = [
      makeScene({ _id: "s1", name: "Taverna" }),
      makeScene({ _id: "s2", name: "Cripta" }),
    ];

    const html = renderTab("s2");

    // The head names it...
    expect(html).toContain("Cripta");
    // ...and the archive does not repeat it as a line.
    const archive = archiveOf(html);
    expect(archive).toContain("Taverna");
    expect(archive).not.toContain("Cripta");
  });

  it("REQ-CEN-035: every line carries name and the marks that are on — no dimensions", () => {
    sceneListState.scenes = [
      makeScene({ _id: "s1", name: "Cripta", width: 4200, height: 2800, darkness: 0.8 }),
    ];

    const archive = archiveOf(renderTab(null));

    expect(archive).toContain("Cripta");
    expect(archive).not.toContain(t("FUSION.Scene.Head.Dimensions", { width: 4200, height: 2800 }));
    expect(archive).toContain(t(SCENE_SHELF_KEYS.markDarkness));
    expect(archive).not.toContain(t(SCENE_SHELF_KEYS.markFog));
  });

  it("REQ-CEN-035: a scene with no marks still renders the meta line, same shape as one with marks (Ajustes r1 review)", () => {
    // A051 removed the dimensions text that used to guarantee `.scene-row__meta` was
    // never empty. A scene with no marks on now renders that span with nothing
    // inside it — a `display: flex` container with no children collapses to zero
    // height, so without a floor the row shrinks next to a row that has marks
    // (uneven archive, same regression class as the flag legibility fix below).
    sceneListState.scenes = [
      makeScene({ _id: "s-quiet", name: "Silenciosa", sort: 0 }),
      makeScene({ _id: "s-dark", name: "Escura", darkness: 0.5, sort: 1 }),
    ];

    const archive = archiveOf(renderTab(null));
    const quietMeta = /<span class="scene-row__meta[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(archive);
    expect(quietMeta).not.toBeNull();
    // The empty line is still drawn — `{#each}` with zero marks leaves the wrapper in
    // place — so the CSS floor below is what has to keep it the same height as a
    // line that does have a mark, not conditional markup.
    expect(archive).toContain("scene-row__meta");
    expect(archive).toContain(t(SCENE_SHELF_KEYS.markDarkness));

    const style = /<style>([\s\S]*)<\/style>/.exec(sourceOfScenesTab())?.[1] ?? "";
    const rule = /\.scene-row__meta\s*\{([^}]*)\}/.exec(style)?.[1] ?? "";
    expect(rule).toMatch(/min-height:\s*[\d.]/);
  });

  it("REQ-CEN-034: the search field shows up only once the archive outgrows the panel", () => {
    sceneListState.scenes = [makeScene({ _id: "s1", name: "Taverna" })];
    expect(renderTab(null)).not.toContain("scenes-tab__search");

    sceneListState.scenes = Array.from({ length: SCENE_SHELF_SEARCH_THRESHOLD + 1 }, (_v, i) =>
      makeScene({ _id: `s${String(i)}`, name: `Cena ${String(i)}`, sort: i }),
    );
    const many = renderTab(null);
    expect(many).toContain("scenes-tab__search");
    expect(many).toContain(t(SCENE_SHELF_KEYS.searchPlaceholder));
  });

  it("REQ-CEN-033: collapsing a group is a device value, read and written per world+user", () => {
    const source = sourceOfScenesTab();

    // The panel reads the stored set for THIS world and THIS user, and writes it back —
    // it never sends the collapsed state anywhere else.
    expect(source).toMatch(/loadCollapsedSceneFolders\(\s*worldId\s*,\s*userId\s*\)/);
    expect(source).toMatch(/saveCollapsedSceneFolders\(\s*worldId\s*,\s*userId\s*,/);
    expect(source).not.toMatch(/collapsed[\s\S]{0,80}sendOp/);
  });

  it("REQ-CEN-033: a group header is a real button that announces whether it is open", () => {
    sceneListState.folders = [{ _id: "f-a", name: "Ato 1" }];
    sceneListState.scenes = [makeScene({ _id: "s1", name: "Taverna", folder: "f-a" })];

    const archive = archiveOf(renderTab(null));

    expect(archive).toMatch(
      /<button[^>]*class="scene-group__header[^"]*"[^>]*aria-expanded="true"/,
    );
  });

  it("REQ-CEN-037: each line can be dragged, and the drop writes the order", () => {
    sceneListState.folders = [{ _id: "f-a", name: "Ato 1" }];
    sceneListState.scenes = [
      makeScene({ _id: "s1", name: "Taverna", folder: "f-a", sort: 0 }),
      makeScene({ _id: "s2", name: "Cripta", folder: "f-a", sort: 1 }),
    ];

    const archive = archiveOf(renderTab(null));
    expect([...archive.matchAll(/draggable="true"/g)]).toHaveLength(2);

    // And the drop goes through the module that writes `sort` to the document — the tab
    // does not invent its own write.
    const source = sourceOfScenesTab();
    expect(source).toContain("reorderWithinGroup");
    expect(source).toContain("persistSceneOrder");
  });

  it("REQ-CEN-039: the footer points the region map at the Hub, without linking into it", () => {
    sceneListState.scenes = [makeScene({ _id: "s1", name: "Taverna" })];

    const html = renderTab(null);

    expect(html).toContain(t(SCENE_SHELF_KEYS.regionMap));
    // A note, not a door: the footer offers no navigation of its own (DEC-CEN-10).
    const footer = /<footer[\s\S]*?<\/footer>/.exec(html)?.[0] ?? "";
    expect(footer).toContain(t(SCENE_SHELF_KEYS.regionMap));
    expect(footer).not.toContain("<a ");
    expect(footer).not.toContain("<button");
  });

  it("REQ-CEN-039: the footer is there even with an empty world", () => {
    expect(renderTab(null)).toContain(t(SCENE_SHELF_KEYS.regionMap));
  });
});
