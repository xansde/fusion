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
 *   - REQ-CNV-070/REQ-TOK-003 (defect 2, Fase 1 e2e): two concurrent setups —
 *     an earlier `setup()` still awaiting `FogState.load()` when
 *     `teardown()` runs on the SAME instance (`TableScreen.svelte` recreates
 *     the orchestrator on every Scene mutation, including a new token
 *     embedding, and does so again before the previous recreation finished)
 *     must not touch the renderers that `teardown()` already destroyed, and
 *     must not leak a mirror subscription. Only the LAST (surviving)
 *     orchestrator's `render()` calls should ever land.
 */

import { describe, it, expect } from "vitest";
import { SceneOrchestrator, isTokenControlledForTest } from "../scene-orchestrator.js";
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

// A005 fix (REQ-VIS-085): restriction is gated on BOTH `scene.tokenVision` AND
// `scene.fogEnabled`, not just "is this viewer a GM" (see scene-orchestrator.ts
// for the full spec citation). Every pre-existing test in this file was written
// when a non-GM viewer was ALWAYS restricted, so the default fixture keeps that
// behaviour explicit (`tokenVision: true, fogEnabled: true`) — the handful of
// tests that exercise the "restriction off" branches pass `{ tokenVision:
// false }` / `{ fogEnabled: false }` themselves.
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
    fogEnabled: true,
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
    // TK030 (#164): `TokenDocument` has no `ownership` field (REQ-TOK-013, REQ-TOK-032, REQ-TOK-034) —
    // control is resolved from the ACTOR referenced by `actorId` (see the
    // "REQ-TOK-013, REQ-TOK-034: token control" describe block below, which sets up a
    // real Actor with `ownership` in the mirror). None of the tests above
    // that block assert on vision CONTENT gated by `controlled` — only that
    // setVisionPolygons/render were called — so they do not need an Actor.
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
    // A005/REQ-VIS-085 review: `restrictionActive` (4th arg) is what actually
    // gates the fog/vision-mask overlay in LightingRenderer.render() — it
    // MUST be captured here, not dropped, so tests below can assert on it
    // directly instead of only on the unrelated TokenLayer.setVisionPolygons
    // call.
    render(state, fogState, debugMode, restrictionActive) {
      calls.push({ fn: "render", args: [state, fogState, debugMode, restrictionActive] });
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

    it("player role → setVisionPolygons called with fogEnabled=true, and LightingRenderer.render's restrictionActive arg is also true", async () => {
      const token = makeToken("tok-1");
      const scene = makeScene("scene-1", { tokens: [token] });
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator, tokenLayer, lightingRenderer } = makeOrchestrator(scene, mirror, {
        isGm: false,
        userId: "user-1",
      });

      await orchestrator.setup();

      const svpCalls = tokenLayer.calls.filter((c) => c.fn === "setVisionPolygons");
      expect(svpCalls.length).toBeGreaterThan(0);
      // Last call should have fogEnabled = true for non-GM player
      const lastCall = svpCalls[svpCalls.length - 1];
      expect(lastCall?.args[1]).toBe(true);

      // A005/REQ-VIS-085 review: the 4th arg of LightingRenderer.render is
      // the SAME `restrictionActive` value fed to setVisionPolygons above —
      // it must not be silently dropped by the caller.
      const renderCalls = lightingRenderer.calls.filter((c) => c.fn === "render");
      expect(renderCalls.length).toBeGreaterThan(0);
      expect(renderCalls[renderCalls.length - 1]?.args[3]).toBe(true);

      orchestrator.teardown();
    });

    it("GM role → setVisionPolygons called with fogEnabled=false, and LightingRenderer.render's restrictionActive arg is also false", async () => {
      const token = makeToken("tok-gm", 100, 100);
      const scene = makeScene("scene-1", { tokens: [token] });
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator, tokenLayer, lightingRenderer } = makeOrchestrator(scene, mirror, {
        isGm: true,
        fogState: null,
      });

      await orchestrator.setup();

      const svpCalls = tokenLayer.calls.filter((c) => c.fn === "setVisionPolygons");
      expect(svpCalls.length).toBeGreaterThan(0);
      // GM → fogEnabled = false
      const lastCall = svpCalls[svpCalls.length - 1];
      expect(lastCall?.args[1]).toBe(false);

      const renderCalls = lightingRenderer.calls.filter((c) => c.fn === "render");
      expect(renderCalls.length).toBeGreaterThan(0);
      expect(renderCalls[renderCalls.length - 1]?.args[3]).toBe(false);

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
    it("REQ-CEN-072/REQ-VIS-085: player in a scene with tokenVision=false → setVisionPolygons called with fogEnabled=false (no restriction), and LightingRenderer.render's restrictionActive arg matches", async () => {
      const token = makeToken("tok-1");
      const scene = makeScene("scene-1", { tokens: [token], tokenVision: false });
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator, tokenLayer, lightingRenderer } = makeOrchestrator(scene, mirror, {
        isGm: false,
        userId: "user-1",
      });

      await orchestrator.setup();

      const svpCalls = tokenLayer.calls.filter((c) => c.fn === "setVisionPolygons");
      expect(svpCalls.length).toBeGreaterThan(0);
      const lastCall = svpCalls[svpCalls.length - 1];
      expect(lastCall?.args[1]).toBe(false);

      // This is the branch a mutation of `showRestriction` in LightingRenderer
      // (reverting it to `!isGm`) would leave uncaught: assert the 4th arg
      // that actually gates the fog/vision-mask overlay in render().
      const renderCalls = lightingRenderer.calls.filter((c) => c.fn === "render");
      expect(renderCalls[renderCalls.length - 1]?.args[3]).toBe(false);

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
      const { orchestrator, tokenLayer, lightingRenderer } = makeOrchestrator(
        scene as unknown as SceneDocument,
        mirror,
        { isGm: false, userId: "user-1" },
      );

      await orchestrator.setup();

      const svpCalls = tokenLayer.calls.filter((c) => c.fn === "setVisionPolygons");
      expect(svpCalls.length).toBeGreaterThan(0);
      const lastCall = svpCalls[svpCalls.length - 1];
      expect(lastCall?.args[1]).toBe(false);

      const renderCalls = lightingRenderer.calls.filter((c) => c.fn === "render");
      expect(renderCalls[renderCalls.length - 1]?.args[3]).toBe(false);

      orchestrator.teardown();
    });

    // Ajustes r1 — Fase 0 review of A005: REQ-VIS-085's first clause ("com fog
    // desabilitado, toda a cena é visível a todos") is unconditional — CA-20
    // (specs/07-visao-iluminacao-fog.md:524) states it with no exception for
    // tokenVision. Before this fix, `restrictionActive` read ONLY
    // `scene.tokenVision`, so `tokenVision=true` kept a player masked even
    // with `fogEnabled=false` — the "Fog" checkbox in the perception window
    // (REQ-CEN-021) was a dead control for the player, and the original
    // "tela preta" symptom (item 24) reproduced through this untested
    // quadrant.
    it("CA-20/REQ-VIS-085: player in a scene with fogEnabled=false and tokenVision=true → setVisionPolygons called with fogEnabled=false (no restriction, fog disabled wins)", async () => {
      const token = makeToken("tok-1");
      const scene = makeScene("scene-1", {
        tokens: [token],
        tokenVision: true,
        fogEnabled: false,
      });
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator, tokenLayer, lightingRenderer } = makeOrchestrator(scene, mirror, {
        isGm: false,
        userId: "user-1",
      });

      await orchestrator.setup();

      const svpCalls = tokenLayer.calls.filter((c) => c.fn === "setVisionPolygons");
      expect(svpCalls.length).toBeGreaterThan(0);
      const lastCall = svpCalls[svpCalls.length - 1];
      expect(lastCall?.args[1]).toBe(false);

      const renderCalls = lightingRenderer.calls.filter((c) => c.fn === "render");
      expect(renderCalls[renderCalls.length - 1]?.args[3]).toBe(false);

      orchestrator.teardown();
    });

    // Same review: the schema doc-comment on `fogEnabled` (packages/shared/src/
    // scene.ts) says restriction also requires `tokenVision=true` — a GM
    // turning the head's "Fog" toggle on (REQ-CEN-021) without ever enabling
    // token vision must not restrict a player who has no token-limited sight
    // configured. Registered as an explicit product choice in openQuestions
    // since REQ-VIS-085 does not fully close this quadrant.
    it("REQ-VIS-085: player in a scene with fogEnabled=true and tokenVision=false → setVisionPolygons called with fogEnabled=false (no restriction, token vision required)", async () => {
      const token = makeToken("tok-1");
      const scene = makeScene("scene-1", {
        tokens: [token],
        tokenVision: false,
        fogEnabled: true,
      });
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator, tokenLayer, lightingRenderer } = makeOrchestrator(scene, mirror, {
        isGm: false,
        userId: "user-1",
      });

      await orchestrator.setup();

      const svpCalls = tokenLayer.calls.filter((c) => c.fn === "setVisionPolygons");
      expect(svpCalls.length).toBeGreaterThan(0);
      const lastCall = svpCalls[svpCalls.length - 1];
      expect(lastCall?.args[1]).toBe(false);

      const renderCalls = lightingRenderer.calls.filter((c) => c.fn === "render");
      expect(renderCalls[renderCalls.length - 1]?.args[3]).toBe(false);

      orchestrator.teardown();
    });

    it("REQ-VIS-085: player in a scene with fogEnabled=true and tokenVision=true → setVisionPolygons called with fogEnabled=true (restricted), and LightingRenderer.render's restrictionActive arg is also true", async () => {
      const token = makeToken("tok-1");
      const scene = makeScene("scene-1", {
        tokens: [token],
        tokenVision: true,
        fogEnabled: true,
      });
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator, tokenLayer, lightingRenderer } = makeOrchestrator(scene, mirror, {
        isGm: false,
        userId: "user-1",
      });

      await orchestrator.setup();

      const svpCalls = tokenLayer.calls.filter((c) => c.fn === "setVisionPolygons");
      expect(svpCalls.length).toBeGreaterThan(0);
      const lastCall = svpCalls[svpCalls.length - 1];
      expect(lastCall?.args[1]).toBe(true);

      const renderCalls = lightingRenderer.calls.filter((c) => c.fn === "render");
      expect(renderCalls[renderCalls.length - 1]?.args[3]).toBe(true);

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

    // Ajustes r1 — Fase 0 review of A005: `this._fogState.updateVision` in
    // scene-orchestrator.ts is gated on `restrictionActive`, not just "fog
    // state exists" — a player whose scene doesn't restrict vision
    // (REQ-VIS-085: tokenVision=false or fogEnabled=false) has a fogState
    // instance (they are not the GM) but must not accumulate exploration for
    // a scene nobody is being masked in.
    it("REQ-VIS-085: FogState.updateVision NOT called for a non-GM player when the scene doesn't restrict vision (tokenVision=false)", async () => {
      const token = makeToken("tok-1");
      const scene = makeScene("scene-1", { tokens: [token], tokenVision: false });
      const mirror = makeMirror("scene-1", scene);
      const fogState = makeFogState(false);
      const { orchestrator } = makeOrchestrator(scene, mirror, {
        isGm: false,
        userId: "user-1",
        fogState,
      });

      await orchestrator.setup();

      expect(fogState.updateVisionCalls).toBe(0);
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

  describe("REQ-CNV-070/REQ-TOK-003 (defect 2, Fase 1 e2e): two concurrent setups — only the last applies", () => {
    /** A FogState fake whose `load()` only resolves when the test calls the returned function. */
    function makeDeferredFogState(): {
      fogState: FogState;
      resolveLoad: () => void;
    } {
      let resolveLoad: () => void = () => {
        throw new Error("resolveLoad called before load()");
      };
      const loadPromise = new Promise<void>((resolve) => {
        resolveLoad = resolve;
      });
      const fake = {
        async load() {
          await loadPromise;
        },
        updateVision(_polygons: unknown) {},
        persistNow() {},
        destroy() {},
        getRenderState() {
          return {
            explored: { polygons: [], totalVertices: 0 },
            currentVisionRings: [],
            fogActive: true,
            sceneId: "scene-1",
          };
        },
        applyReset() {},
        get explored() {
          return { polygons: [], totalVertices: 0 };
        },
        get isDirty() {
          return false;
        },
        get sceneId() {
          return "scene-1";
        },
      } as unknown as FogState;
      return { fogState: fake, resolveLoad };
    }

    it("an earlier setup() resuming after the LATER orchestrator's teardown() does not render, and does not throw", async () => {
      const scene = makeScene("scene-1");
      const mirror = makeMirror("scene-1", scene);

      // Orchestrator #1 — the one whose setup() is still awaiting fog.load()
      // when a second Scene mutation makes TableScreen.svelte tear it down
      // (its own $effect re-running, same as a new token embedding).
      const { fogState: fogState1, resolveLoad: resolveLoad1 } = makeDeferredFogState();
      const { orchestrator: orch1, lightingRenderer: lighting1 } = makeOrchestrator(scene, mirror, {
        fogState: fogState1,
      });
      const setup1 = orch1.setup(); // starts, blocks on fog1.load()

      // TableScreen.svelte tears orch1 down BEFORE its setup() finished — the
      // exact race: another Scene mutation reached the client in the meantime.
      orch1.teardown();
      const lighting1CallsAtTeardown = lighting1.calls.length;

      // Orchestrator #2 — the one that superseded it. Its own fog load
      // resolves immediately (a normal, un-raced setup).
      const { orchestrator: orch2, lightingRenderer: lighting2 } = makeOrchestrator(scene, mirror);
      await orch2.setup();
      const lighting2CallsAfterOwnSetup = lighting2.calls.filter((c) => c.fn === "render").length;
      expect(lighting2CallsAfterOwnSetup).toBeGreaterThan(0);

      // NOW orch1's fog.load() resolves — its setup() continuation resumes
      // AFTER its own teardown() already destroyed lighting1/tokenLayer1.
      resolveLoad1();
      await expect(setup1).resolves.toBeUndefined(); // must not throw

      // orch1 must never have rendered after the point its teardown() ran —
      // the bailout happens before any further render() call.
      expect(lighting1.calls.length).toBe(lighting1CallsAtTeardown);
      expect(orch1.isReady).toBe(false);

      // orch2 — the surviving orchestrator — is completely unaffected.
      expect(orch2.isReady).toBe(true);

      orch2.teardown();
    });

    it("an earlier setup() resuming after teardown() does not leak a mirror subscription", async () => {
      const scene = makeScene("scene-1");
      const mirror = makeMirror("scene-1", scene);

      const { fogState: fogState1, resolveLoad: resolveLoad1 } = makeDeferredFogState();
      const { orchestrator: orch1, tokenLayer: tokenLayer1 } = makeOrchestrator(scene, mirror, {
        fogState: fogState1,
      });
      const setup1 = orch1.setup();
      orch1.teardown();

      const { orchestrator: orch2 } = makeOrchestrator(scene, mirror);
      await orch2.setup();

      resolveLoad1();
      await setup1;

      const tokenLayer1CallsAfterResume = tokenLayer1.calls.length;

      // A further Scene mutation must not reach orch1's tokenLayer — if
      // setup1 had subscribed to the mirror (the leak this guard prevents),
      // this feedOp would have called setVisionPolygons on the ALREADY
      // destroyed tokenLayer1.
      const updated = makeScene("scene-1", { tokens: [makeToken("tok-late")] });
      mirror.feedOp({
        seq: 2, // mirror.seq is 1 after makeMirror's snapshot — next must be 2
        type: "doc:update",
        ts: Date.now(),
        payload: {
          documentType: "Scene",
          documents: [updated as unknown as Record<string, unknown>],
        },
      });

      expect(tokenLayer1.calls.length).toBe(tokenLayer1CallsAfterResume);

      orch2.teardown();
    });
  });

  // ---------------------------------------------------------------------------
  // TK030 (#164) — REQ-TOK-013, REQ-TOK-032, REQ-TOK-034, REQ-USR-013: token control IS OWNER
  // of the actor. The old predicate read `token.ownership`/`token.userId`,
  // fields `TokenDocument` never had (REQ-DOC-025) — always `undefined`, so
  // every non-GM user got `false`. This resolves ownership on the ACTOR the
  // mirror holds by `token.actorId`, the same shape the server's
  // `documents/ownership.ts` resolves against.
  // ---------------------------------------------------------------------------
  describe("_isTokenControlledByUser (TK030, #164, REQ-TOK-013, REQ-TOK-034)", () => {
    function makeMirrorWithActor(
      sceneId: string,
      scene: SceneDocument,
      actor: { _id: string; ownership: Record<string, number> },
    ): DocumentMirror {
      const mirror = new DocumentMirror();
      mirror.applySnapshot({
        seq: 1,
        activeSceneId: sceneId,
        documents: {
          Scene: [scene as unknown as Record<string, unknown>],
          Actor: [{ _id: actor._id, name: "Fixture Actor", ownership: actor.ownership }],
        },
      });
      return mirror;
    }

    it("a player who is OWNER of the token's actor controls the token", () => {
      const token = { _id: "tok-1", actorId: "actor-pc" } as unknown as TokenDocument;
      const scene = makeScene("scene-1", { tokens: [token] });
      const mirror = makeMirrorWithActor("scene-1", scene, {
        _id: "actor-pc",
        ownership: { default: 0, "user-1": 3 }, // OwnershipLevel.OWNER = 3
      });

      expect(isTokenControlledForTest(token, "user-1", mirror)).toBe(true);
    });

    it("a player is NOT OWNER of an NPC's actor — does not control that token", () => {
      const token = { _id: "tok-npc", actorId: "actor-npc" } as unknown as TokenDocument;
      const scene = makeScene("scene-1", { tokens: [token] });
      const mirror = makeMirrorWithActor("scene-1", scene, {
        _id: "actor-npc",
        ownership: { default: 0 }, // no OWNER entry for user-1
      });

      expect(isTokenControlledForTest(token, "user-1", mirror)).toBe(false);
    });

    it("reading token.ownership/token.userId directly (the old #164 bug) is not consulted at all", () => {
      // Even if a legacy/malformed doc carries these forbidden fields
      // (REQ-DOC-025), they must have zero effect — only the actor's real
      // ownership decides.
      const token = {
        _id: "tok-legacy",
        actorId: "actor-npc",
        ownership: { "user-1": 3 },
        userId: "user-1",
      } as unknown as TokenDocument;
      const scene = makeScene("scene-1", { tokens: [token] });
      const mirror = makeMirrorWithActor("scene-1", scene, {
        _id: "actor-npc",
        ownership: { default: 0 },
      });

      expect(isTokenControlledForTest(token, "user-1", mirror)).toBe(false);
    });

    it("returns false when the token's actor is not (yet) in the mirror", () => {
      const token = { _id: "tok-1", actorId: "actor-missing" } as unknown as TokenDocument;
      const scene = makeScene("scene-1", { tokens: [token] });
      const mirror = makeMirror("scene-1", scene); // no Actor collection at all

      expect(isTokenControlledForTest(token, "user-1", mirror)).toBe(false);
    });
  });
});
