/**
 * scene-orchestrator.test.ts — Unit tests for SceneOrchestrator (no PIXI).
 *
 * All PIXI renderers are injected as spy/fake interfaces so the tests run in
 * a plain Node environment under Vitest.
 *
 * DEC-SEP-05 (F2, 2026-08-23): this file used to cover the vision/fog/lighting
 * wiring the orchestrator drove (VisionStateComputer, TokenLayer.
 * setVisionPolygons, LightingRenderer.render, FogState) — see `docs/design/
 * separacao-repos/design.md`. That wiring, and every test exercising it, was
 * removed along with the rest of the fog/vision pipeline. What is left below
 * is exactly what survives DEC-SEP-05's fronteira: grid-size fan-out (R4) and
 * the combat controller.
 *
 * Scenarios covered:
 *   - setup/teardown lifecycle (mirror subscription, isReady, idempotency)
 *   - Scene grid change → TokenLayer.setGridSize + onGridSizeChange callback
 *   - Combat turn advances → CombatController.tick called each frame
 */

import { describe, it, expect } from "vitest";
import { SceneOrchestrator } from "../scene-orchestrator.js";
import type {
  ITokenLayer,
  ICombatController,
  SceneOrchestratorOptions,
} from "../scene-orchestrator.js";
import { DocumentMirror } from "../../docs/DocumentMirror.js";
import type { SceneDocument, TokenDocument, WorldSnapshotPayload } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    ...overrides,
  } as unknown as TokenDocument;
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
    setGridSize(gridSize, tokens) {
      calls.push({ fn: "setGridSize", args: [gridSize, tokens] });
    },
    tick(deltaMs, zoom) {
      calls.push({ fn: "tick", args: [deltaMs, zoom] });
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

function makeOrchestrator(
  scene: SceneDocument,
  mirror: DocumentMirror,
  opts: Partial<{
    combatController: ICombatController | null;
    onGridSizeChange: (gridSize: number) => void;
  }> = {},
): {
  orchestrator: SceneOrchestrator;
  tokenLayer: ITokenLayer & { calls: { fn: string; args: unknown[] }[] };
} {
  const tokenLayer = makeTokenLayer();

  const options: SceneOrchestratorOptions = {
    scene,
    mirror,
    tokenLayer,
    combatController: opts.combatController ?? null,
    ...(opts.onGridSizeChange !== undefined ? { onGridSizeChange: opts.onGridSizeChange } : {}),
  };

  const orchestrator = new SceneOrchestrator(options);
  return { orchestrator, tokenLayer };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SceneOrchestrator", () => {
  describe("setup / teardown lifecycle", () => {
    it("setup completes and isReady becomes true", async () => {
      const scene = makeScene("scene-1");
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator } = makeOrchestrator(scene, mirror);

      await orchestrator.setup();
      expect(orchestrator.isReady).toBe(true);
      orchestrator.teardown();
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

    it("teardown calls destroy on tokenLayer", async () => {
      const scene = makeScene("scene-1");
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator, tokenLayer } = makeOrchestrator(scene, mirror);

      await orchestrator.setup();
      orchestrator.teardown();

      expect(tokenLayer.calls.some((c) => c.fn === "destroy")).toBe(true);
    });

    it("teardown is idempotent — a second call is a no-op", async () => {
      const scene = makeScene("scene-1");
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator, tokenLayer } = makeOrchestrator(scene, mirror);

      await orchestrator.setup();
      orchestrator.teardown();
      const callsAfterFirst = tokenLayer.calls.length;

      orchestrator.teardown();
      expect(tokenLayer.calls.length).toBe(callsAfterFirst);
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

  // R4 (integração pós-#194): before this, `TokenLayer.setGridSize` had NO
  // production caller at all, and #194's `_loadedSceneId` guard stopped the
  // canvas reload that used to rebuild everything — so changing a scene's grid
  // size with the scene's pencil left sprites (and the interaction manager's
  // snap) on the old size until F5. The orchestrator is the one thing already
  // subscribed to the Scene document, so it is where the new size is fanned out.
  describe("grid size change → TokenLayer + interaction manager (R4)", () => {
    it("a scene grid change repasses the new size to the TokenLayer and to the grid consumer", async () => {
      const scene = makeScene("scene-1", { tokens: [makeToken("tok-1")] });
      const mirror = makeMirror("scene-1", scene);
      const gridSizes: number[] = [];
      const { orchestrator, tokenLayer } = makeOrchestrator(scene, mirror, {
        onGridSizeChange: (size) => gridSizes.push(size),
      });
      await orchestrator.setup();

      const sceneWithNewGrid = makeScene("scene-1", {
        tokens: [makeToken("tok-1")],
        grid: { type: "square", size: 140 },
      });
      mirror.feedOp({
        seq: 2,
        type: "doc:update",
        ts: Date.now(),
        payload: {
          documentType: "Scene",
          documents: [sceneWithNewGrid as unknown as Record<string, unknown>],
        },
      });

      const gridCalls = tokenLayer.calls.filter((c) => c.fn === "setGridSize");
      expect(gridCalls).toHaveLength(1);
      expect(gridCalls[0]?.args[0]).toBe(140);
      expect(gridCalls[0]?.args[1]).toEqual(sceneWithNewGrid.tokens);
      expect(gridSizes).toEqual([140]);

      orchestrator.teardown();
    });

    it("a scene change that does NOT touch the grid leaves both alone", async () => {
      const scene = makeScene("scene-1", { tokens: [makeToken("tok-1", 100, 100)] });
      const mirror = makeMirror("scene-1", scene);
      const gridSizes: number[] = [];
      const { orchestrator, tokenLayer } = makeOrchestrator(scene, mirror, {
        onGridSizeChange: (size) => gridSizes.push(size),
      });
      await orchestrator.setup();

      // A plain token move — the commonest Scene broadcast there is.
      const sceneMoved = makeScene("scene-1", { tokens: [makeToken("tok-1", 300, 300)] });
      mirror.feedOp({
        seq: 2,
        type: "doc:update",
        ts: Date.now(),
        payload: {
          documentType: "Scene",
          documents: [sceneMoved as unknown as Record<string, unknown>],
        },
      });

      expect(tokenLayer.calls.filter((c) => c.fn === "setGridSize")).toHaveLength(0);
      expect(gridSizes).toEqual([]);

      orchestrator.teardown();
    });

    it("a scene with no grid at all falls back to the default size without churning", async () => {
      const scene = makeScene("scene-1", { grid: null, tokens: [makeToken("tok-1")] });
      const mirror = makeMirror("scene-1", scene);
      const { orchestrator, tokenLayer } = makeOrchestrator(scene, mirror);
      await orchestrator.setup();

      expect(tokenLayer.calls.filter((c) => c.fn === "setGridSize")).toHaveLength(0);

      orchestrator.teardown();
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
