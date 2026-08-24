/**
 * scene-orchestrator.ts — Live integration layer between DocumentMirror and PIXI renderers.
 *
 * Spec: 06-canvas-e-renderizacao.md (layer composition),
 *       10-combate-e-iniciativa.md (combat turn marker)
 *
 * DEC-SEP-05 (F2, 2026-08-23): this module used to be the central driver for
 * vision/fog/lighting too (VisionStateComputer, TokenLayer.setVisionPolygons,
 * LightingRenderer.render, FogState) — see `docs/design/separacao-repos/
 * design.md`. That wiring was removed along with the rest of the fog/vision
 * pipeline; what is left is exactly what survives DEC-SEP-05's fronteira:
 * grid-size fan-out (R4) and the combat controller tick/destroy.
 *
 * Responsibilities:
 *   - Subscribe to DocumentMirror for Scene (grid size changes).
 *   - On a scene grid change: re-lay TokenLayer sprites and notify the grid
 *     consumer (TokenInteractionManager's drag-snap config).
 *   - On combat update: drive CombatCanvasController (turn marker position, auto-pan).
 *
 * Design constraints:
 *   - NO PIXI import here — renderers are injected as interfaces (testable in Node).
 *   - Lógica testável em .ts (este arquivo); .svelte permanece fino.
 *   - The orchestrator is created once per scene and destroyed when the scene changes.
 *     TableScreen.svelte calls setup() / teardown() based on activeSceneState.
 *
 * Usage (from TableScreen.svelte):
 *   const orch = new SceneOrchestrator(opts);
 *   await orch.setup();
 *   // In ticker:
 *   orch.tick(deltaMs, cameraZoom);
 *   // On scene change:
 *   orch.teardown();
 *
 * REQ-CBT-050..052, REQ-CNV-025..033
 */

import type { SceneDocument, TokenDocument } from "@fusion/shared";
import type { DocumentMirror } from "../docs/DocumentMirror.js";
import { effectiveGridSize } from "./sceneCoords.js";

// ---------------------------------------------------------------------------
// Injected renderer interfaces (no PIXI dependency — testable in Node)
// ---------------------------------------------------------------------------

/**
 * Minimal interface for the TokenLayer that the orchestrator drives.
 * Implemented by the real TokenLayer; spy-able in tests.
 */
export interface ITokenLayer {
  /**
   * Re-lay the sprites on a new grid cell size (R4). Declared here because
   * the orchestrator is the only thing already subscribed to the Scene
   * document, so it is what notices the Mestre changing the grid with the
   * scene's pencil — before this the real `TokenLayer.setGridSize` had no
   * production caller at all.
   */
  setGridSize(gridSize: number, tokens: TokenDocument[]): void;
  tick(deltaMs: number, zoom: number): void;
  destroy(): void;
}

/**
 * Minimal interface for CombatCanvasController that the orchestrator drives.
 */
export interface ICombatController {
  tick(deltaMs: number): void;
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface SceneOrchestratorOptions {
  /** The scene this orchestrator manages. */
  scene: SceneDocument;
  /** DocumentMirror singleton (worldMirror). */
  mirror: DocumentMirror;
  /** Injected token layer renderer. */
  tokenLayer: ITokenLayer;
  /** Injected combat controller. Null if no active combat. */
  combatController: ICombatController | null;
  /**
   * Called when the scene's effective grid cell size changes (R4), so the
   * things that hold a COPY of it — `TokenInteractionManager.gridConfig`,
   * which decides where a drag snaps — can follow. A plain callback rather
   * than another injected renderer interface: the orchestrator has no
   * business knowing what a token interaction manager is, only that someone
   * downstream cares about the number.
   */
  onGridSizeChange?: (gridSize: number) => void;
}

// ---------------------------------------------------------------------------
// SceneOrchestrator
// ---------------------------------------------------------------------------

/**
 * Connects DocumentMirror document changes to the PIXI renderer pipeline.
 *
 * One instance per active scene. Construct via TableScreen when a scene
 * activates; call teardown() before replacing with a new instance.
 */
export class SceneOrchestrator {
  private _scene: SceneDocument;
  private _mirror: DocumentMirror;

  private _tokenLayer: ITokenLayer;
  private _combatController: ICombatController | null;
  private _onGridSizeChange: ((gridSize: number) => void) | null;

  /**
   * The grid cell size the sprites are currently laid out on (R4).
   *
   * Seeded from the scene this orchestrator was built for — `TableScreen`
   * constructs the TokenLayer and the interaction manager with that same
   * value — so the initial `_onSceneChange` does not fire a redundant
   * full reconcile; only a genuine change does.
   */
  private _prevGridSize: number;

  /** Unsubscribe functions from DocumentMirror subscriptions. */
  private _unsubscribes: Array<() => void> = [];

  /** Whether setup() has been called. */
  private _ready = false;

  /**
   * Set by `teardown()`, checked by `setup()`'s continuation. `TableScreen.svelte`
   * recreates the orchestrator on every Scene mutation reaching the client —
   * including a brand-new token embedding — via a `$effect` that tears down
   * the CURRENT orchestrator and builds a new one. Bailing out in `setup()`
   * before it subscribes to the mirror avoids leaking a subscription that
   * keeps firing into destroyed state if `teardown()` already ran on this
   * same instance by the time an earlier `setup()` resumes.
   */
  private _destroyed = false;

  constructor(opts: SceneOrchestratorOptions) {
    this._scene = opts.scene;
    this._mirror = opts.mirror;
    this._tokenLayer = opts.tokenLayer;
    this._combatController = opts.combatController;
    this._onGridSizeChange = opts.onGridSizeChange ?? null;
    this._prevGridSize = effectiveGridSize(opts.scene);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialize: subscribe to DocumentMirror for reactive updates and run the
   * initial grid-size check.
   *
   * DEC-SEP-05 (F2): used to be `async` because of the `FogState.load()`
   * await it ran before subscribing (and the `_destroyed` guard below existed
   * to protect that await's continuation, see the field's own doc comment).
   * Nothing here awaits anything any more, but `TableScreen.svelte` still
   * calls `await orch.setup()` — `await` on a non-Promise is a plain no-op,
   * so the caller needs no change.
   */
  setup(): void {
    if (this._destroyed) return;

    // Subscribe to Scene document changes (grid config)
    const offScene = this._mirror.subscribe<SceneDocument>("Scene", (scenes) => {
      const scene = scenes.find((s) => s._id === this._scene._id);
      if (scene) {
        this._scene = scene;
        this._onSceneChange(scene);
      }
    });

    this._unsubscribes.push(offScene);

    // Run initial check from current mirror state
    const currentScene = this._mirror.getDoc<SceneDocument>("Scene", this._scene._id);
    if (currentScene) {
      this._scene = currentScene;
      this._onSceneChange(currentScene);
    }

    this._ready = true;
  }

  /**
   * Tear down all subscriptions and owned resources.
   * Call before this scene is replaced by a new one.
   * Idempotent — a second call, or one racing a not-yet-finished `setup()`,
   * is a no-op past the first.
   */
  teardown(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    for (const unsub of this._unsubscribes) {
      unsub();
    }
    this._unsubscribes = [];

    this._combatController?.destroy();
    this._tokenLayer.destroy();

    this._ready = false;
  }

  /**
   * Drive per-frame logic (combat animation, token animation).
   * Call from the FusionCanvas ticker callback.
   */
  tick(deltaMs: number, cameraZoom: number): void {
    if (!this._ready) return;
    this._tokenLayer.tick(deltaMs, cameraZoom);
    this._combatController?.tick(deltaMs);
  }

  // ---------------------------------------------------------------------------
  // Internal — scene change handler
  // ---------------------------------------------------------------------------

  /**
   * Called whenever the scene document changes in the mirror.
   * Detects a grid-size change (R4) and fans it out.
   */
  private _onSceneChange(scene: SceneDocument): void {
    const tokens = scene.tokens;

    // See note above: `grid` can be runtime-absent despite the non-nullish type.
    const gridSize = effectiveGridSize(scene);

    // R4: the Mestre changed the scene's grid with the scene pencil. Sprites
    // and the interaction manager's snap config both hold a COPY of the cell
    // size, and #194's `_loadedSceneId` guard removed the canvas reload that
    // used to rebuild them — without this they stay on the old size until F5.
    // Guarded on a real change: `_onSceneChange` also runs on every token
    // move, and a full re-reconcile per move would be pure waste.
    if (gridSize !== this._prevGridSize) {
      this._prevGridSize = gridSize;
      this._tokenLayer.setGridSize(gridSize, tokens);
      this._onGridSizeChange?.(gridSize);
    }
  }

  // ---------------------------------------------------------------------------
  // Getters (for testing / inspection)
  // ---------------------------------------------------------------------------

  /** Whether setup() has completed. */
  get isReady(): boolean {
    return this._ready;
  }

  /** The scene document this orchestrator manages. */
  get sceneId(): string {
    return this._scene._id;
  }
}
