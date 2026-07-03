/**
 * scene-orchestrator.ts — Live integration layer between DocumentMirror and PIXI renderers.
 *
 * Spec: 06-canvas-e-renderizacao.md (layer composition), 07-visao-iluminacao-fog.md (vision/fog),
 *       10-combate-e-iniciativa.md (combat turn marker)
 *
 * GAP CLOSURE (M3-C): This module is the missing orchestrator that was absent since M2-A.
 * All vision/fog/token/combat modules existed and passed unit tests but had no central
 * driver connecting them to the DocumentMirror. This class is that driver.
 *
 * Responsibilities:
 *   - Subscribe to DocumentMirror for Scene (tokens, walls, lights), Combat.
 *   - On scene data change:
 *       · Compute vision polygons (VisionStateComputer) from controlled tokens + walls
 *       · Feed results to TokenLayer.setVisionPolygons (hides tokens outside vision)
 *       · Feed results to LightingRenderer.render (darkness, fog mask, lights)
 *       · Feed current vision polygons to FogState.updateVision (accumulation + persist)
 *   - On scene activation (scene change):
 *       · Tear down previous orchestrator state (no PIXI leaks)
 *       · Load fog from server (FogState.load) for new scene
 *   - On combat update:
 *       · Drive CombatCanvasController (turn marker position, auto-pan)
 *   - GM bypasses fog: no fog mask, no fog accumulation.
 *   - Invalidation: wall/door/light change busts ALL vision caches; token-only
 *     change busts only that token's cache (VisionStateComputer.invalidateToken).
 *
 * Design constraints:
 *   - NO PIXI import here — renderers are injected as interfaces (testable in Node).
 *   - Lógica testável em .ts (este arquivo); .svelte permanece fino.
 *   - The orchestrator is created once per scene and destroyed when the scene changes.
 *     TableScreen.svelte calls setup() / teardown() based on activeSceneState.
 *
 * Usage (from TableScreen.svelte):
 *   const orch = new SceneOrchestrator(opts);
 *   await orch.setup(); // loads fog, computes initial state
 *   // In ticker:
 *   orch.tick(deltaMs, cameraZoom);
 *   // On scene change:
 *   orch.teardown();
 *
 * REQ-VIS-020..087, REQ-CBT-050..052, REQ-CNV-025..033
 */

import type { SceneDocument, TokenDocument } from "@fusion/shared";
import type { DocumentMirror } from "../docs/DocumentMirror.js";
import {
  VisionStateComputer,
  buildTokenVisionConfig,
  buildTokenLightConfig,
  buildAmbientLightConfig,
  type TokenSourceConfig,
  type VisionStateResult,
} from "./vision/vision-state.js";
import type { FogState, FogRenderState } from "./vision/fog-state.js";
import type { VisionPolygonResult } from "./vision/vision-state.js";

// ---------------------------------------------------------------------------
// Injected renderer interfaces (no PIXI dependency — testable in Node)
// ---------------------------------------------------------------------------

/**
 * Minimal interface for the TokenLayer that the orchestrator drives.
 * Implemented by the real TokenLayer; spy-able in tests.
 */
export interface ITokenLayer {
  setVisionPolygons(polygons: VisionPolygonResult[], fogEnabled: boolean): void;
  tick(deltaMs: number, zoom: number): void;
  destroy(): void;
}

/**
 * Minimal interface for LightingRenderer that the orchestrator drives.
 */
export interface ILightingRenderer {
  render(state: VisionStateResult, fogState?: FogRenderState | null, debugMode?: boolean): void;
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
  /** Whether the local user is GM. GM bypasses fog entirely. */
  isGm: boolean;
  /** Local user id (for controlled token resolution). */
  userId: string;
  /** Injected token layer renderer. */
  tokenLayer: ITokenLayer;
  /** Injected lighting renderer. */
  lightingRenderer: ILightingRenderer;
  /** Injected fog state manager. Null for GM (no fog). */
  fogState: FogState | null;
  /** Injected combat controller. Null if no active combat. */
  combatController: ICombatController | null;
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
  private _isGm: boolean;
  private _userId: string;

  private _tokenLayer: ITokenLayer;
  private _lightingRenderer: ILightingRenderer;
  private _fogState: FogState | null;
  private _combatController: ICombatController | null;

  private _visionComputer = new VisionStateComputer();

  /** Last computed vision result (to avoid redundant renders). */
  private _lastVisionResult: VisionStateResult | null = null;

  /** Unsubscribe functions from DocumentMirror subscriptions. */
  private _unsubscribes: Array<() => void> = [];

  /** Tracks which walls/tokens changed to do selective cache invalidation. */
  private _prevWallHash = "";
  private _prevTokenPositions = new Map<string, string>(); // tokenId → "x:y"

  /** Whether setup() has been called. */
  private _ready = false;

  constructor(opts: SceneOrchestratorOptions) {
    this._scene = opts.scene;
    this._mirror = opts.mirror;
    this._isGm = opts.isGm;
    this._userId = opts.userId;
    this._tokenLayer = opts.tokenLayer;
    this._lightingRenderer = opts.lightingRenderer;
    this._fogState = opts.fogState;
    this._combatController = opts.combatController;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialize: load fog from server (player only) and run initial render.
   * Subscribes to DocumentMirror for reactive updates.
   */
  async setup(): Promise<void> {
    // Load persisted fog exploration from server (REQ-VIS-084)
    if (this._fogState) {
      await this._fogState.load().catch((err: unknown) => {
        console.warn("[SceneOrchestrator] fog load failed:", err);
      });
    }

    // Subscribe to Scene document changes (tokens, walls, lights embedded)
    const offScene = this._mirror.subscribe<SceneDocument>("Scene", (scenes) => {
      const scene = scenes.find((s) => s._id === this._scene._id);
      if (scene) {
        this._scene = scene;
        this._onSceneChange(scene);
      }
    });

    this._unsubscribes.push(offScene);

    // Run initial vision computation from current mirror state
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
   * Flushes pending fog state to server before destroying.
   */
  teardown(): void {
    for (const unsub of this._unsubscribes) {
      unsub();
    }
    this._unsubscribes = [];

    // Flush fog (beforeunload or scene switch — REQ-VIS-083)
    this._fogState?.persistNow();
    this._fogState?.destroy();

    this._combatController?.destroy();
    this._tokenLayer.destroy();
    this._lightingRenderer.destroy();

    this._visionComputer.clearAll();
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
   * Determines what changed (walls/lights vs tokens only) and recomputes vision.
   */
  private _onSceneChange(scene: SceneDocument): void {
    const walls = scene.walls;
    const tokens = scene.tokens;
    const ambientLights = (scene as Record<string, unknown>)["lights"] as
      | Array<{
          _id: string;
          x: number;
          y: number;
          brightRadius?: number;
          dimRadius?: number;
          angle?: number;
          rotation?: number;
          color?: string;
          intensity?: number;
          enabled?: boolean;
        }>
      | undefined;

    // Detect wall changes (any wall mutation busts all caches)
    const wallHash = _hashWalls(walls);
    const wallsChanged = wallHash !== this._prevWallHash;
    if (wallsChanged) {
      this._prevWallHash = wallHash;
      this._visionComputer.clearAll();
    } else {
      // Selective cache invalidation: only invalidate tokens that moved/changed
      this._invalidateMovedTokens(tokens);
    }

    // Build TokenSourceConfig array from scene tokens
    const tokenSources = this._buildTokenSources(tokens);

    // Build scene bounds
    const sceneBounds = {
      x: 0,
      y: 0,
      width: scene.width,
      height: scene.height,
    };

    // Compute vision state. The SceneDocument type declares `grid` as always
    // present (Zod default), but minimal/legacy/partial-diff scenes can arrive
    // without it at runtime — reading `.size` then throws. Guard defensively;
    // the type says non-nullish, so the lint rule is disabled here on purpose.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const gridSize = scene.grid?.size ?? 100;
    const darkness = scene.darkness;
    const globalLight = scene.globalLight;

    const visionResult = this._visionComputer.compute(
      walls,
      tokenSources,
      sceneBounds,
      this._isGm,
      darkness,
      globalLight,
    );

    // Add ambient lights from scene (they are embedded in scene doc)
    if (ambientLights !== undefined && ambientLights.length > 0) {
      const ambientConfigs = ambientLights.map((l) => buildAmbientLightConfig(l, gridSize));
      const ambientPolygons = this._visionComputer.computeAmbientLights(
        ambientConfigs,
        walls,
        sceneBounds,
      );
      // Merge ambient light polygons into the result
      visionResult.lightPolygons.push(...ambientPolygons);
    }

    // Feed vision polygons to TokenLayer (hides tokens outside vision for players)
    const fogEnabled = !this._isGm;
    this._tokenLayer.setVisionPolygons(visionResult.visionPolygons, fogEnabled);

    // Update fog accumulation with current vision polygons (player only)
    if (this._fogState && !this._isGm) {
      const rawPolygons = visionResult.visionPolygons.map((vp) => vp.polygon);
      this._fogState.updateVision(rawPolygons);
    }

    // Render lighting/fog overlay
    const fogRenderState = this._fogState?.getRenderState() ?? null;
    this._lightingRenderer.render(visionResult, fogRenderState);

    this._lastVisionResult = visionResult;
  }

  // ---------------------------------------------------------------------------
  // Internal — token source building
  // ---------------------------------------------------------------------------

  /**
   * Convert scene TokenDocuments to TokenSourceConfig for the VisionStateComputer.
   * A token is "controlled" if: GM (sees all) OR the token belongs to the local user.
   */
  private _buildTokenSources(tokens: TokenDocument[]): TokenSourceConfig[] {
    // See note above: `grid` can be runtime-absent despite the non-nullish type.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const gridSize = this._scene.grid?.size ?? 100;
    const sources: TokenSourceConfig[] = [];

    for (const token of tokens) {
      // Determine if this token is controlled by the local user
      // A token is controlled if: its actorId actor is owned by userId, or token.userId matches.
      // In MVP: if isGm, all tokens count as "controllable"; otherwise check ownership.
      const controlled = this._isGm || _isTokenControlledByUser(token, this._userId);

      const vision = buildTokenVisionConfig(token, gridSize);

      const light = buildTokenLightConfig(token._id, token.light, token.x, token.y, gridSize);

      sources.push({
        id: token._id,
        x: token.x,
        y: token.y,
        vision,
        light,
        controlled,
      });
    }

    return sources;
  }

  // ---------------------------------------------------------------------------
  // Internal — selective cache invalidation
  // ---------------------------------------------------------------------------

  /**
   * Detect tokens that moved or changed vision config since last frame
   * and call VisionStateComputer.invalidateToken for each.
   * Avoids full cache bust when only tokens move (walls unchanged).
   */
  private _invalidateMovedTokens(tokens: TokenDocument[]): void {
    const nextPositions = new Map<string, string>();

    for (const token of tokens) {
      const key = token._id;
      const posKey = `${String(token.x)}:${String(token.y)}:${String(token.rotation)}`;
      nextPositions.set(key, posKey);

      const prev = this._prevTokenPositions.get(key);
      if (prev !== posKey) {
        this._visionComputer.invalidateToken(token._id);
      }
    }

    this._prevTokenPositions = nextPositions;
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

  /** Last vision result (null until first compute). */
  get lastVisionResult(): VisionStateResult | null {
    return this._lastVisionResult;
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers (pure functions, easily testable)
// ---------------------------------------------------------------------------

/**
 * Fast wall set hash used to detect structural wall changes.
 * Matches the same approach used internally by VisionStateComputer.
 */
function _hashWalls(walls: Array<{ _id: string; doorState?: string }>): string {
  let h = 0;
  for (const w of walls) {
    for (let i = 0; i < w._id.length; i++) {
      h = (h ^ w._id.charCodeAt(i)) * 31;
    }
    if (w.doorState && w.doorState !== "closed") h ^= 0xdeadbeef;
  }
  return h.toString(16);
}

/**
 * Determine if a token is controlled by the given userId.
 *
 * MVP logic: a token is controlled if it has explicit ownership for the userId
 * (ownership[userId] === 3) or if there is no specific ownership set and the
 * token is in the user's possession (userId matches token's actorId controller).
 *
 * The server already filters which tokens appear in the snapshot for players;
 * this predicate determines vision, not visibility.
 */
function _isTokenControlledByUser(token: TokenDocument, userId: string): boolean {
  // Check token-level ownership field if present (actor ownership propagated)
  const doc = token as Record<string, unknown>;
  const ownership = doc["ownership"] as Record<string, number> | undefined;
  if (ownership) {
    // 3 = OWNER level
    if (ownership[userId] === 3) return true;
    // default ownership
    if (ownership["default"] === 3) return true;
  }
  // Fallback: check if token.userId matches (some VTT approaches store the owning user)
  const tokenUserId = doc["userId"] as string | undefined;
  if (tokenUserId && tokenUserId === userId) return true;

  return false;
}

// Re-export the hash helper for tests
export { _hashWalls as hashWallsForTest, _isTokenControlledByUser as isTokenControlledForTest };
