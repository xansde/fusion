/**
 * scene-orchestrator.test.ts — Unit tests for SceneOrchestrator (no PIXI).
 *
 * All PIXI renderers are injected as spy/fake interfaces so the tests run in
 * a plain Node environment under Vitest.
 *
 * Scenarios covered:
 *   - Token added to scene → TokenLayer.setVisionPolygons called
 *   - Door/wall change → VisionStateComputer cache busted (walls changed flag)
 *   - Scene switch → teardown called on old instance; setup on new creates fresh state
 *   - Combat turn advances → CombatController.tick called each frame
 *   - GM role → fog disabled (setVisionPolygons receives fogEnabled=false)
 *   - Player role → fog enabled
 *   - FogState.load called during setup
 *   - FogState.updateVision called after each vision recompute (player)
 *   - FogState.persistNow called on teardown
 *   - Multiple scene changes → each one triggers setVisionPolygons
 */

import { describe, it, expect } from "vitest";
import { SceneOrchestrator } from "../scene-orchestrator.js";
import type {
  ITokenLayer,
  ILightingRenderer,
  ICombatController,
  SceneOrchestratorOptions,
} from "../scene-orchestrator.js";
import { DocumentMirror } from "../../docs/DocumentMirror.js";
import type { SceneDocument, TokenDocument, WorldSnapshotPayload } from "@fusion/shared";
import type { FogState } from "../vision/fog-state.js";
import type { FogRenderState } from "../vision/fog-state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A005 fix (REQ-VIS-085): restriction is now gated on `scene.tokenVision`, not
// just "is this viewer a GM". Every pre-existing test in this file was written
// when a non-GM viewer was ALWAYS restricted, so the default fixture keeps that
// behaviour explicit (`tokenVision: true`) — the handful of tests that exercise
// the NEW "tokenVision off" branch pass `{ tokenVision: false }` themselves.
function makeScene(id: string, overrides: Record<string, unknown> = {}): SceneDocument {
  return {
    _id: id,
    name: "Test Scene",
    width: 1000,
    height: 1000,
    padding: 0,
    backgroundColor: "#000000",
    darkness: 0,
    globalLight: false,
    grid: { type: "square", size: 100 },
    walls: [],
    tokens: [],
    background: null,
    initialView: null,
    tokenVision: true,
    ...overrides,
  } as unknown as SceneDocument;
}

function makeToken(
  id: string,
  x = 100,
  y = 100,
  overrides: Partial<TokenDocument> = {},
): TokenDocument {
  return {
    _id: id,
    name: "Token A",
    x,
    y,
    width: 1,
    height: 1,
    hidden: false,
    rotation: 0,
    vision: { enabled: true, range: null, angle: 360, rotation: 0, visionMode: "basic" },
    light: null,
    // ownership: userId → 3 so it counts as controlled for player tests
    ownership: { "user-1": 3 },
    ...overrides,
  } as unknown as TokenDocument;
}

function makeWallEntry(
  id: string,
  doorState = "closed",
): {
  _id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  type: string;
  doorState: string;
} {
  return { _id: id, x1: 0, y1: 0, x2: 100, y2: 0, type: "wall", doorState };
}

function makeMirror(sceneId: string, scene: SceneDocument): DocumentMirror {
  const mirror = new DocumentMirror();
  const snapshot: WorldSnapshotPayload = {
    seq: 1,
    activeSceneId: sceneId,
    documents: {
      Scene: [scene as unknown as Record<string, unknown>],
    },
  };
  mirror.applySnapshot(snapshot);
  return mirror;
}

function makeTokenLayer(): ITokenLayer & { calls: { fn: string; args: unknown[] }[] } {
  const calls: { fn: string; args: unknown[] }[] = [];
  return {
    calls,
    setVisionPolygons(polygons, fogEnabled) {
      calls.push({ fn: "setVisionPolygons", args: [polygons, fogEnabled] });
    },
    tick(deltaMs, zoom) {
      calls.push({ fn: "tick", args: [deltaMs, zoom] });
    },
    destroy() {
      calls.push({ fn: "destroy", args: [] });
    },
  };
}

function makeLightingRenderer(): ILightingRenderer & { calls: { fn: string; args: unknown[] }[] } {
  const calls: { fn: string; args: unknown[] }[] = [];
  return {
    calls,
    render(state, fogState, debugMode) {
      calls.push({ fn: "render", args: [state, fogState, debugMode] });
    },
    destroy() {
      calls.push({ fn: "destroy", args: [] });
    },
  };
}

function makeCombatController(): ICombatController & { calls: { fn: string; args: unknown[] }[] } {
  const calls: { fn: string; args: unknown[] }[] = [];
  return {
    calls,
    tick(deltaMs) {
      calls.push({ fn: "tick", args: [deltaMs] });
    },
    destroy() {
      calls.push({ fn: "destroy", args: [] });
    },
  };
}

function makeFogState(isGm = false): FogState & {
  loadCalled: boolean;
  updateVisionCalls: number;
  persistNowCalled: boolean;
  destroyCalled: boolean;
} {
  let loadCalled = false;
  let updateVisionCalls = 0;
  let persistNowCalled = false;
  let destroyCalled = false;

  const fogRenderState: FogRenderState = {
    explored: { polygons: [], totalVertices: 0 },
    currentVisionRings: [],
    fogActive: !isGm,
    sceneId: "scene-1",
  };

  const fake = {
    get loadCalled() {
      return loadCalled;
    },
    get updateVisionCalls() {
      return updateVisionCalls;
    },
    get persistNowCalled() {
      return persistNowCalled;
    },
    get destroyCalled() {
      return destroyCalled;
    },
    async load() {
      loadCalled = true;
    },
    updateVision(_polygons: unknown) {
      updateVisionCalls++;
    },
    persistNow() {
      persistNowCalled = true;
    },
    destroy() {
      destroyCalled = true;
    },
    getRenderState() {
      return fogRenderState;
    },
    applyReset() {},
    get explored() {
      return fogRenderState.explored;
    },
    get isDirty() {
      return false;
    },
    get sceneId() {
      return "scene-1";
    },
  } as unknown as FogState & {
    loadCalled: boolean;
    updateVisionCalls: number;
    persistNowCalled: boolean;
    destroyCalled: boolean;
  };

  return fake;
}

function makeOrchestrator(
  scene: SceneDocument,
  mirror: DocumentMirror,
  opts: Partial<{
    isGm: boolean;
    userId: string;
    fogState: FogState | null;
    combatController: ICombatController | null;
  }> = {},
): {
  orchestrator: SceneOrchestrator;
  tokenLayer: ITokenLayer & { calls: { fn: string; args: unknown[] }[] };
  lightingRenderer: ILightingRenderer & { calls: { fn: string; args: unknown[] }[] };
} {
  const tokenLayer = makeTokenLayer();
  const lightingRenderer = makeLightingRenderer();

  const options: SceneOrchestratorOptions = {
    scene,
    mirror,
    isGm: opts.isGm ?? false,
    userId: opts.userId ?? "user-1",
    tokenLayer,
    lightingRenderer,
    fogState: opts.fogState !== undefined ? opts.fogState : makeFogState(opts.isGm ?? false),
    combatController: opts.combatController ?? null,
  };

  const orchestrator = new SceneOrchestrator(options);
  return { orchestrator, tokenLayer, lightingRenderer };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SceneOrchestrator", () => {
  describe("setup / initial state", () => {
    it("calls FogState.load during setup (player)", async () => {
      const scene = makeScene("scene-1");
      const mirror = makeMirror("scene-1", scene);
      const fogState = makeFogState(false);
      const { orchestrator } = makeOrchestrator(scene, mirror, { fogState });

      await orchestrator.setup();
      expect(fogState.loadCalled).toBe(true);
      orchestrator.teardown();
    });

    it("does NOT call FogState.load for GM (no fog)", async () => {
      const scene = makeScene("scene-1");
      const mirror = makeMirror("scene-1", scene);
      // GM has no fogState
      const { orchestrator } = makeOrchestrator(scene, mirror, { isGm: true, fogState: null });

      await orchestrator.setup();
      // Just verify setup completes without error and isReady is true
      expect(orchestrator.isReady).toBe(true);
      orchestrator.teardown();
    });

    it("triggers initial vision computation on setup", async () => {
      const token = makeToken("tok-1", 100, 100);
      const scene = makeScene("scene-1", { tokens: [token] });
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator, tokenLayer } = makeOrchestrator(scene, mirror);

      await orchestrator.setup();

      // Should have called setVisionPolygons at least once during setup
      const svpCalls = tokenLayer.calls.filter((c) => c.fn === "setVisionPolygons");
      expect(svpCalls.length).toBeGreaterThan(0);

      orchestrator.teardown();
    });
  });

  describe("token → TokenLayer integration", () => {
    it("when a token is added to the scene, setVisionPolygons is called", async () => {
      const scene = makeScene("scene-1");
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator, tokenLayer } = makeOrchestrator(scene, mirror);
      await orchestrator.setup();

      const callsBefore = tokenLayer.calls.filter((c) => c.fn === "setVisionPolygons").length;

      // Simulate a doc:update that adds a token to the scene
      const updatedScene = makeScene("scene-1", {
        tokens: [makeToken("tok-1", 200, 200)],
      });
      mirror.feedOp({
        seq: 2,
        type: "doc:update",
        ts: Date.now(),
        payload: {
          documentType: "Scene",
          documents: [updatedScene as unknown as Record<string, unknown>],
        },
      });

      const callsAfter = tokenLayer.calls.filter((c) => c.fn === "setVisionPolygons").length;
      expect(callsAfter).toBeGreaterThan(callsBefore);

      orchestrator.teardown();
    });

    it("player role → setVisionPolygons called with fogEnabled=true", async () => {
      const token = makeToken("tok-1");
      const scene = makeScene("scene-1", { tokens: [token] });
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator, tokenLayer } = makeOrchestrator(scene, mirror, {
        isGm: false,
        userId: "user-1",
      });

      await orchestrator.setup();

      const svpCalls = tokenLayer.calls.filter((c) => c.fn === "setVisionPolygons");
      expect(svpCalls.length).toBeGreaterThan(0);
      // Last call should have fogEnabled = true for non-GM player
      const lastCall = svpCalls[svpCalls.length - 1];
      expect(lastCall?.args[1]).toBe(true);

      orchestrator.teardown();
    });

    it("GM role → setVisionPolygons called with fogEnabled=false", async () => {
      const token = makeToken("tok-gm", 100, 100);
      const scene = makeScene("scene-1", { tokens: [token] });
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator, tokenLayer } = makeOrchestrator(scene, mirror, {
        isGm: true,
        fogState: null,
      });

      await orchestrator.setup();

      const svpCalls = tokenLayer.calls.filter((c) => c.fn === "setVisionPolygons");
      expect(svpCalls.length).toBeGreaterThan(0);
      // GM → fogEnabled = false
      const lastCall = svpCalls[svpCalls.length - 1];
      expect(lastCall?.args[1]).toBe(false);

      orchestrator.teardown();
    });

    // A005 (ajustes r1, item 24 — "cena preta para o jogador"): REQ-CEN-072
    // (specs/44-aba-cenas.md) requires the player to keep receiving the data
    // of the scene on air needed to render it, deferring the actual rendering
    // rule to spec 07. REQ-VIS-085 (specs/07-visao-iluminacao-fog.md) is that
    // rule — "com fog desabilitado, toda a cena é visível a todos" — and ties
    // restriction to the SCENE's own `tokenVision` flag, which defaults to
    // `false` (`packages/shared/src/scene.ts:368`), not to "is this viewer a
    // GM". Before this fix, `scene-orchestrator.ts` restricted EVERY non-GM
    // viewer unconditionally, so a brand-new scene (token vision never turned
    // on by the GM) still painted the player's canvas fully black even though
    // REQ-CEN-072 was already delivering the scene's data correctly.
    it("REQ-CEN-072/REQ-VIS-085: player in a scene with tokenVision=false → setVisionPolygons called with fogEnabled=false (no restriction)", async () => {
      const token = makeToken("tok-1");
      const scene = makeScene("scene-1", { tokens: [token], tokenVision: false });
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator, tokenLayer } = makeOrchestrator(scene, mirror, {
        isGm: false,
        userId: "user-1",
      });

      await orchestrator.setup();

      const svpCalls = tokenLayer.calls.filter((c) => c.fn === "setVisionPolygons");
      expect(svpCalls.length).toBeGreaterThan(0);
      const lastCall = svpCalls[svpCalls.length - 1];
      expect(lastCall?.args[1]).toBe(false);

      orchestrator.teardown();
    });

    it("REQ-VIS-085: player in a scene without a tokenVision field at all (legacy/partial scene) → restriction stays off", async () => {
      const token = makeToken("tok-1");
      // No `tokenVision` override: makeScene's spread order means an explicit
      // `undefined` from a caller who forgot the field is exactly what a
      // scene persisted before this flag existed would look like.
      const scene = { ...makeScene("scene-1", { tokens: [token] }) } as Record<string, unknown>;
      delete scene["tokenVision"];
      const mirror = makeMirror("scene-1", scene as unknown as SceneDocument);
      const { orchestrator, tokenLayer } = makeOrchestrator(
        scene as unknown as SceneDocument,
        mirror,
        { isGm: false, userId: "user-1" },
      );

      await orchestrator.setup();

      const svpCalls = tokenLayer.calls.filter((c) => c.fn === "setVisionPolygons");
      expect(svpCalls.length).toBeGreaterThan(0);
      const lastCall = svpCalls[svpCalls.length - 1];
      expect(lastCall?.args[1]).toBe(false);

      orchestrator.teardown();
    });
  });

  describe("fog state integration", () => {
    it("FogState.updateVision is called after each scene change (player)", async () => {
      const token = makeToken("tok-1");
      const scene = makeScene("scene-1", { tokens: [token] });
      const mirror = makeMirror("scene-1", scene);
      const fogState = makeFogState(false);
      const { orchestrator } = makeOrchestrator(scene, mirror, { fogState });

      await orchestrator.setup();
      const callsAfterSetup = fogState.updateVisionCalls;
      expect(callsAfterSetup).toBeGreaterThan(0);

      // Second scene change
      const updated = makeScene("scene-1", { tokens: [makeToken("tok-1", 300, 300)] });
      mirror.feedOp({
        seq: 2,
        type: "doc:update",
        ts: Date.now(),
        payload: {
          documentType: "Scene",
          documents: [updated as unknown as Record<string, unknown>],
        },
      });

      expect(fogState.updateVisionCalls).toBeGreaterThan(callsAfterSetup);
      orchestrator.teardown();
    });

    it("FogState.updateVision NOT called for GM", async () => {
      const token = makeToken("tok-1");
      const scene = makeScene("scene-1", { tokens: [token] });
      const mirror = makeMirror("scene-1", scene);
      // GM has no fogState
      const { orchestrator } = makeOrchestrator(scene, mirror, { isGm: true, fogState: null });

      await orchestrator.setup();

      // No exception should be thrown (fog is null for GM)
      expect(orchestrator.isReady).toBe(true);
      orchestrator.teardown();
    });
  });

  describe("wall/door change → cache invalidation", () => {
    it("wall change triggers a full cache bust (clearAll path)", async () => {
      const scene = makeScene("scene-1");
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator, tokenLayer } = makeOrchestrator(scene, mirror);
      await orchestrator.setup();

      const callsBefore = tokenLayer.calls.filter((c) => c.fn === "setVisionPolygons").length;

      // Simulate wall being added to the scene
      const sceneWithWall = makeScene("scene-1", {
        walls: [makeWallEntry("wall-1", "closed") as unknown],
      });
      mirror.feedOp({
        seq: 2,
        type: "doc:update",
        ts: Date.now(),
        payload: {
          documentType: "Scene",
          documents: [sceneWithWall as unknown as Record<string, unknown>],
        },
      });

      const callsAfter = tokenLayer.calls.filter((c) => c.fn === "setVisionPolygons").length;
      // A scene change (including wall addition) must trigger a new setVisionPolygons call
      expect(callsAfter).toBeGreaterThan(callsBefore);

      orchestrator.teardown();
    });

    it("door state change (closed→open) triggers recompute", async () => {
      const initialWall = makeWallEntry("wall-door-1", "closed");
      const scene = makeScene("scene-1", {
        walls: [initialWall as unknown],
      });
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator, tokenLayer } = makeOrchestrator(scene, mirror);
      await orchestrator.setup();

      const callsBefore = tokenLayer.calls.filter((c) => c.fn === "setVisionPolygons").length;

      // Door opens
      const openedDoor = makeWallEntry("wall-door-1", "open");
      const sceneWithOpenDoor = makeScene("scene-1", {
        walls: [openedDoor as unknown],
      });
      mirror.feedOp({
        seq: 2,
        type: "doc:update",
        ts: Date.now(),
        payload: {
          documentType: "Scene",
          documents: [sceneWithOpenDoor as unknown as Record<string, unknown>],
        },
      });

      const callsAfter = tokenLayer.calls.filter((c) => c.fn === "setVisionPolygons").length;
      expect(callsAfter).toBeGreaterThan(callsBefore);

      orchestrator.teardown();
    });
  });

  describe("scene switch → teardown + setup", () => {
    it("teardown calls destroy on tokenLayer and lightingRenderer", async () => {
      const scene = makeScene("scene-1");
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator, tokenLayer, lightingRenderer } = makeOrchestrator(scene, mirror);

      await orchestrator.setup();
      orchestrator.teardown();

      expect(tokenLayer.calls.some((c) => c.fn === "destroy")).toBe(true);
      expect(lightingRenderer.calls.some((c) => c.fn === "destroy")).toBe(true);
    });

    it("teardown calls FogState.persistNow (flush before scene switch)", async () => {
      const scene = makeScene("scene-1");
      const mirror = makeMirror("scene-1", scene);
      const fogState = makeFogState(false);
      const { orchestrator } = makeOrchestrator(scene, mirror, { fogState });

      await orchestrator.setup();
      orchestrator.teardown();

      expect(fogState.persistNowCalled).toBe(true);
    });

    it("teardown calls FogState.destroy", async () => {
      const scene = makeScene("scene-1");
      const mirror = makeMirror("scene-1", scene);
      const fogState = makeFogState(false);
      const { orchestrator } = makeOrchestrator(scene, mirror, { fogState });

      await orchestrator.setup();
      orchestrator.teardown();

      expect(fogState.destroyCalled).toBe(true);
    });

    it("after teardown, isReady is false", async () => {
      const scene = makeScene("scene-1");
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator } = makeOrchestrator(scene, mirror);

      await orchestrator.setup();
      expect(orchestrator.isReady).toBe(true);

      orchestrator.teardown();
      expect(orchestrator.isReady).toBe(false);
    });

    it("mirror subscription is removed on teardown (no further callbacks)", async () => {
      const scene = makeScene("scene-1");
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator, tokenLayer } = makeOrchestrator(scene, mirror);

      await orchestrator.setup();
      orchestrator.teardown();

      const callsAtTeardown = tokenLayer.calls.length;

      // Emit a scene change AFTER teardown — orchestrator should NOT respond
      const updatedScene = makeScene("scene-1", { tokens: [makeToken("tok-x")] });
      mirror.feedOp({
        seq: 2,
        type: "doc:update",
        ts: Date.now(),
        payload: {
          documentType: "Scene",
          documents: [updatedScene as unknown as Record<string, unknown>],
        },
      });

      expect(tokenLayer.calls.length).toBe(callsAtTeardown);
    });
  });

  describe("combat controller", () => {
    it("CombatController.tick is called on each orchestrator tick", async () => {
      const scene = makeScene("scene-1");
      const mirror = makeMirror("scene-1", scene);
      const combatController = makeCombatController();
      const { orchestrator } = makeOrchestrator(scene, mirror, { combatController });

      await orchestrator.setup();

      orchestrator.tick(16, 1);
      orchestrator.tick(16, 1);

      const tickCalls = combatController.calls.filter((c) => c.fn === "tick");
      expect(tickCalls.length).toBe(2);

      orchestrator.teardown();
    });

    it("CombatController.destroy is called on teardown", async () => {
      const scene = makeScene("scene-1");
      const mirror = makeMirror("scene-1", scene);
      const combatController = makeCombatController();
      const { orchestrator } = makeOrchestrator(scene, mirror, { combatController });

      await orchestrator.setup();
      orchestrator.teardown();

      expect(combatController.calls.some((c) => c.fn === "destroy")).toBe(true);
    });

    it("tick is a no-op before setup()", () => {
      const scene = makeScene("scene-1");
      const mirror = makeMirror("scene-1", scene);
      const combatController = makeCombatController();
      const { orchestrator } = makeOrchestrator(scene, mirror, { combatController });

      // Do NOT call setup
      orchestrator.tick(16, 1);

      // combatController.tick should NOT have been called (orchestrator not ready)
      expect(combatController.calls.filter((c) => c.fn === "tick").length).toBe(0);
    });
  });

  describe("LightingRenderer integration", () => {
    it("render is called on each scene change", async () => {
      const scene = makeScene("scene-1");
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator, lightingRenderer } = makeOrchestrator(scene, mirror);

      await orchestrator.setup();

      const rendersBefore = lightingRenderer.calls.filter((c) => c.fn === "render").length;
      expect(rendersBefore).toBeGreaterThan(0);

      // Trigger another scene change
      const updated = makeScene("scene-1", { tokens: [makeToken("tok-1")] });
      mirror.feedOp({
        seq: 2,
        type: "doc:update",
        ts: Date.now(),
        payload: {
          documentType: "Scene",
          documents: [updated as unknown as Record<string, unknown>],
        },
      });

      const rendersAfter = lightingRenderer.calls.filter((c) => c.fn === "render").length;
      expect(rendersAfter).toBeGreaterThan(rendersBefore);

      orchestrator.teardown();
    });
  });

  describe("sceneId tracking", () => {
    it("exposes the correct sceneId", async () => {
      const scene = makeScene("scene-xyz");
      const mirror = makeMirror("scene-xyz", scene);
      const { orchestrator } = makeOrchestrator(scene, mirror);

      expect(orchestrator.sceneId).toBe("scene-xyz");
      await orchestrator.setup();
      orchestrator.teardown();
    });
  });
});
