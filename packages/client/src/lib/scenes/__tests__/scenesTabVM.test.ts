/**
 * scenesTabVM.test.ts — the "no ar" head of the Cenas tab (spec 44 §5.2, plan G080).
 *
 * The head is the first thing the Mestre reads when the drawer opens, and it answers
 * "what is the table looking at right now". These tests are on the projection, not on
 * the markup: what the head says, in every state a real world produces — a scene with a
 * map, a scene with only a colour, no scene at all, and a world whose scene list has not
 * arrived yet.
 *
 * Covers REQ-CEN-011, REQ-CEN-012, REQ-CEN-014, REQ-CEN-015 and RNF-CEN-02.
 *
 * The head's fixed height (REQ-CEN-010, REQ-CEN-013) is deliberately NOT asserted here:
 * height is declarative and lives in the theme token plus the component's stylesheet, so
 * a pure projection cannot observe it. It is proven in
 * `components/scenes/__tests__/ScenesTabHead.test.ts`.
 */

import { describe, expect, it } from "vitest";
import type { SceneDocument } from "@fusion/shared";

import { SCENE_HEAD_IMAGE_SIZES, SCENE_HEAD_KEYS, buildSceneHeadVM } from "../scenesTabVM.js";

function makeScene(overrides: Partial<SceneDocument> & { _id: string }): SceneDocument {
  return {
    type: "Scene",
    name: "Cena",
    width: 4000,
    height: 3000,
    grid: { type: "square", size: 100, distance: 5, units: "ft" },
    background: null,
    backgroundColor: "#101018",
    thumb: null,
    tokens: [],
    walls: [],
    ...overrides,
  } as unknown as SceneDocument;
}

describe("scenesTabVM — the head of the Cenas tab", () => {
  describe("a scene on air (REQ-CEN-011)", () => {
    it("REQ-CEN-011: names the scene, its dimensions, its grid size and its background image", () => {
      const scene = makeScene({
        _id: "s1",
        name: "Cripta de Gelo",
        width: 4200,
        height: 2800,
        grid: { type: "square", size: 140 } as SceneDocument["grid"],
        background: "/assets/cripta.webp",
      });

      const vm = buildSceneHeadVM({ scenes: [scene], activeSceneId: "s1" });

      expect(vm.kind).toBe("on-air");
      if (vm.kind !== "on-air") return;
      expect(vm.sceneId).toBe("s1");
      expect(vm.name).toBe("Cripta de Gelo");
      expect(vm.dimensions).toEqual({
        key: SCENE_HEAD_KEYS.dimensions,
        vars: { width: 4200, height: 2800 },
      });
      expect(vm.grid).toEqual({ key: SCENE_HEAD_KEYS.gridSquare, vars: { size: 140 } });
      expect(vm.background).toMatchObject({ kind: "image", src: "/assets/cripta.webp" });
    });

    it("REQ-CEN-011: a hex scene says hex, and a gridless scene says it has no grid", () => {
      const hex = makeScene({
        _id: "h",
        grid: { type: "hex", size: 90 } as SceneDocument["grid"],
      });
      const gridless = makeScene({
        _id: "g",
        grid: { type: "gridless", size: 100 } as SceneDocument["grid"],
      });

      const hexVm = buildSceneHeadVM({ scenes: [hex], activeSceneId: "h" });
      const gridlessVm = buildSceneHeadVM({ scenes: [gridless], activeSceneId: "g" });

      expect(hexVm).toMatchObject({ grid: { key: SCENE_HEAD_KEYS.gridHex, vars: { size: 90 } } });
      // No cell size is quoted for a gridless scene — a "0 px" grid would be a lie.
      expect(gridlessVm).toMatchObject({ grid: { key: SCENE_HEAD_KEYS.gridNone } });
      expect((gridlessVm as { grid: { vars?: unknown } }).grid.vars).toBeUndefined();
    });

    it("REQ-CEN-011: the name is handed over whole — the VM never truncates it", () => {
      const longName = "A Grande Ponte Suspensa Sobre o Abismo de Vidro Negro";
      const vm = buildSceneHeadVM({
        scenes: [makeScene({ _id: "s1", name: longName })],
        activeSceneId: "s1",
      });

      expect(vm).toMatchObject({ name: longName });
    });
  });

  describe("the background of the head (REQ-CEN-012)", () => {
    it("REQ-CEN-012: a scene with no background image falls back to its own colour", () => {
      const vm = buildSceneHeadVM({
        scenes: [makeScene({ _id: "s1", background: null, backgroundColor: "#2b1a3d" })],
        activeSceneId: "s1",
      });

      expect(vm).toMatchObject({ background: { kind: "color", color: "#2b1a3d" } });
    });

    it("REQ-CEN-012: an empty background string counts as no image, not as an empty image", () => {
      const vm = buildSceneHeadVM({
        scenes: [makeScene({ _id: "s1", background: "   ", backgroundColor: "#123456" })],
        activeSceneId: "s1",
      });

      expect(vm).toMatchObject({ background: { kind: "color", color: "#123456" } });
    });

    it("REQ-CEN-012: the scene's colour is kept even when there IS an image, so the box is never empty", () => {
      const vm = buildSceneHeadVM({
        scenes: [
          makeScene({ _id: "s1", background: "/assets/mapa.webp", backgroundColor: "#0a0a12" }),
        ],
        activeSceneId: "s1",
      });

      expect(vm).toMatchObject({ background: { kind: "image", color: "#0a0a12" } });
    });

    it("REQ-CEN-012: a scene that stores no colour still gets one — the box is never a hole", () => {
      // A world imported without `backgroundColor` (or with it blanked) must not produce
      // a head with nothing to paint: the fallback colour is what keeps the box filled.
      const vm = buildSceneHeadVM({
        scenes: [makeScene({ _id: "s1", background: null, backgroundColor: "  " })],
        activeSceneId: "s1",
      });

      expect(vm.kind).toBe("on-air");
      if (vm.kind !== "on-air") return;
      expect(vm.background.kind).toBe("color");
      expect(vm.background.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });

  describe("no scene on air (REQ-CEN-014)", () => {
    it("REQ-CEN-014: says nothing is on air, that the players are waiting, and offers to fix it", () => {
      const vm = buildSceneHeadVM({
        scenes: [makeScene({ _id: "s1" }), makeScene({ _id: "s2" })],
        activeSceneId: null,
      });

      expect(vm).toEqual({
        kind: "empty",
        title: { key: SCENE_HEAD_KEYS.empty },
        notice: { key: SCENE_HEAD_KEYS.emptyNotice },
        action: { key: SCENE_HEAD_KEYS.chooseScene },
      });
    });

    it("REQ-CEN-014: a world with no scene at all still says it, but offers nothing to put on air", () => {
      const vm = buildSceneHeadVM({ scenes: [], activeSceneId: null });

      expect(vm).toMatchObject({ kind: "empty", title: { key: SCENE_HEAD_KEYS.empty } });
      expect((vm as { action: unknown }).action).toBeNull();
    });

    it("REQ-CEN-014: a scene on air that has not arrived yet is not reported as 'nothing on air'", () => {
      const vm = buildSceneHeadVM({ scenes: [], activeSceneId: "s9" });

      expect(vm).toEqual({ kind: "pending", title: { key: SCENE_HEAD_KEYS.pending } });
    });
  });

  describe("following the world (REQ-CEN-015)", () => {
    it("REQ-CEN-015: the head follows a change of scene on air from any origin", () => {
      const scenes = [
        makeScene({ _id: "s1", name: "Taverna" }),
        makeScene({ _id: "s2", name: "Cripta" }),
      ];

      const before = buildSceneHeadVM({ scenes, activeSceneId: "s1" });
      const after = buildSceneHeadVM({ scenes, activeSceneId: "s2" });

      expect(before).toMatchObject({ name: "Taverna" });
      expect(after).toMatchObject({ name: "Cripta" });
    });

    it("REQ-CEN-015: `active` on the document is not a second source of what is on air", () => {
      // The world's single source is the id the drawer hands down (DEC-CEN-02). A stale
      // `active: true` on a document must not put a scene back on the head.
      const stale = makeScene({ _id: "s1", name: "Taverna", active: true });

      const vm = buildSceneHeadVM({ scenes: [stale], activeSceneId: null });

      expect(vm.kind).toBe("empty");
    });
  });

  describe("the image is a thumbnail, not a map download (RNF-CEN-02)", () => {
    it("RNF-CEN-02: asks the browser for a drawer-wide box instead of the full-resolution map", () => {
      const vm = buildSceneHeadVM({
        scenes: [makeScene({ _id: "s1", width: 8000, background: "/assets/mapa.webp" })],
        activeSceneId: "s1",
      });

      // The hint is handed over on every image head, and it is the drawer's width —
      // never the scene's own 8000px. That the value still matches the drawer is checked
      // against the theme in `ScenesTabHead.test.ts`.
      expect(vm).toMatchObject({ background: { sizes: SCENE_HEAD_IMAGE_SIZES } });
    });

    it("RNF-CEN-02: prefers the smaller `thumb` when the world has one", () => {
      const vm = buildSceneHeadVM({
        scenes: [
          makeScene({
            _id: "s1",
            background: "/assets/mapa.webp",
            thumb: "/assets/mapa-thumb.webp",
          }),
        ],
        activeSceneId: "s1",
      });

      expect(vm).toMatchObject({
        background: { kind: "image", src: "/assets/mapa-thumb.webp", source: "thumb" },
      });
    });

    it("RNF-CEN-02: falls back to the background when nothing fills `thumb` — no thumbnail is invented", () => {
      const vm = buildSceneHeadVM({
        scenes: [makeScene({ _id: "s1", background: "/assets/mapa.webp", thumb: null })],
        activeSceneId: "s1",
      });

      expect(vm).toMatchObject({
        background: { kind: "image", src: "/assets/mapa.webp", source: "background" },
      });
    });
  });
});
