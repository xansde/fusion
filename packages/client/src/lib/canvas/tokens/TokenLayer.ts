/**
 * TokenLayer.ts — reactive layer binding DocumentMirror → PIXI token sprites.
 *
 * Spec: 06-canvas-e-renderizacao.md §REQ-CNV-025..033, §REQ-CNV-037, §D5, §D8
 * Spec: 05-usuarios-e-permissoes.md — hidden tokens; GM sees all
 * Spec: 04-rede-e-sincronizacao.md §REQ-NET-050/051/052 — optimistic move
 * Spec: 07-visao-iluminacao-fog.md §REQ-VIS-080 — token visibility filter
 *
 * Responsibilities:
 *   - Subscribe to DocumentMirror "Token" (embedded in active SceneDocument).
 *   - For each TokenDocument in the active scene: create, update, or destroy
 *     a TokenSprite.
 *   - Hidden tokens: visible (semi-transparent) to GM; invisible to players
 *     (server already filters them from snapshots — but hidden flag may arrive
 *     via update op, so we guard here too).
 *   - LOD: delegate zoom-based visibility updates to each sprite.
 *   - Tick: drive animation for all sprites on every frame.
 *   - Optimistic move API: TokenLayer.applyLocalMove() snaps a sprite
 *     immediately and marks it so the next mirror reconcile skips animation.
 *   - Rollback API: TokenLayer.rollbackMove() reverts a sprite to a given pos.
 *   - Vision filter (M2-B): setVisionPolygons() feeds the current vision rings
 *     so tokens outside the current vision polygon are hidden for players.
 *     REQ-VIS-080: tokens in explored-but-not-visible areas are NOT visible.
 *     GM always sees all tokens regardless of vision.
 *
 * This class does NOT own the PIXI ticker — it receives deltaMs from the
 * FusionCanvas ticker callback. The sceneLoader (or TableScreen) wires this up.
 *
 * Usage:
 *   const layer = new TokenLayer(container, mirror, sceneId, gridSize, isGm);
 *   // In ticker:
 *   layer.tick(ticker.deltaMS, camera.scale);
 *   // On vision update (M2-B):
 *   layer.setVisionPolygons(visionResult.visionPolygons, fogEnabled);
 *   // On local drag confirm:
 *   layer.applyLocalMove(tokenId, newX, newY);
 *   // On rollback (ack rejected):
 *   layer.rollbackMove(tokenId, authX, authY);
 *   // Teardown:
 *   layer.destroy();
 */

import type { Container } from "pixi.js";
import type { TokenDocument, SceneDocument } from "@fusion/shared";
import type { DocumentMirror } from "../../docs/DocumentMirror.js";
import { TokenSprite } from "./TokenSprite.js";
import type { VisionPolygonResult } from "../vision/vision-state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Test whether a point (px, py) is inside any of the given vision polygons.
 * Uses ray-casting algorithm on each polygon's vertices.
 * Returns true if the point is in at least one polygon.
 * Called client-side only for the token visibility filter.
 */
function pointInAnyPolygon(px: number, py: number, polygons: VisionPolygonResult[]): boolean {
  for (const vp of polygons) {
    const verts = vp.polygon.vertices;
    const n = verts.length;
    if (n < 3) continue;
    let inside = false;
    let j = n - 1;
    for (let i = 0; i < n; i++) {
      const vi = verts[i];
      const vj = verts[j];
      j = i;
      if (!vi || !vj) continue;
      if (vi.y > py !== vj.y > py && px < ((vj.x - vi.x) * (py - vi.y)) / (vj.y - vi.y) + vi.x) {
        inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// TokenLayer
// ---------------------------------------------------------------------------

export class TokenLayer {
  /** The PIXI container this layer manages. Pass the "tokens" layer. */
  private _container: Container;

  /** Mirror subscription unsubscribe fn. */
  private _unsubscribe: (() => void) | null = null;

  /** Active sprites, keyed by token _id. */
  private _sprites: Map<string, TokenSprite> = new Map();

  /** Current scene ID (used to match tokens). */
  private _sceneId: string;

  /** Grid cell size in pixels. */
  private _gridSize: number;

  /** Whether the local user is a GM (controls hidden-token visibility). */
  private _isGm: boolean;

  /** Last known camera zoom (for LOD). */
  private _lastZoom = 1;

  /**
   * Current vision polygons for the player (set via setVisionPolygons).
   * Used to filter token visibility: tokens outside vision are hidden for players.
   * REQ-VIS-080: explored-but-not-visible area hides tokens.
   */
  private _visionPolygons: VisionPolygonResult[] = [];

  /**
   * Whether fog/token-vision is active for this user.
   * When false (GM or fog disabled), all tokens are visible.
   */
  private _fogActive = false;

  constructor(
    container: Container,
    mirror: DocumentMirror,
    sceneId: string,
    gridSize: number,
    isGm: boolean,
  ) {
    this._container = container;
    this._sceneId = sceneId;
    this._gridSize = gridSize;
    this._isGm = isGm;
    this._fogActive = !isGm;

    // Subscribe to Scene collection changes; tokens are embedded in Scene.
    this._unsubscribe = mirror.subscribe<SceneDocument>("Scene", (scenes) => {
      const scene = scenes.find((s) => s._id === this._sceneId);
      if (scene) {
        this._reconcileTokens(scene.tokens);
      } else {
        // Scene was deleted or no longer active — clear everything
        this._clearAll();
      }
    });

    // Initial population from the current mirror state
    const scene = mirror.getDoc<SceneDocument>("Scene", sceneId);
    if (scene) {
      this._reconcileTokens(scene.tokens);
    }
  }

  // ---------------------------------------------------------------------------
  // Public — tick (call from FusionCanvas ticker)
  // ---------------------------------------------------------------------------

  /**
   * Advance all active token animations.
   * @param deltaMs  Frame delta in milliseconds (from PIXI ticker).
   * @param zoom     Current camera zoom scale (for LOD updates).
   */
  tick(deltaMs: number, zoom: number): void {
    for (const sprite of this._sprites.values()) {
      sprite.tick(deltaMs);
    }

    // Update LOD only when zoom changes by a non-trivial amount
    if (Math.abs(zoom - this._lastZoom) > 0.01) {
      this._lastZoom = zoom;
      for (const sprite of this._sprites.values()) {
        sprite.updateLod(zoom);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public — optimistic move API (REQ-NET-050/051 / D5)
  // ---------------------------------------------------------------------------

  /**
   * Apply an optimistic local move: snap the sprite immediately without animation
   * and mark it so the next reconcile (server ack) skips re-animation.
   *
   * Call this BEFORE emitting the token:move op to the server.
   */
  applyLocalMove(tokenId: string, x: number, y: number): void {
    const sprite = this._sprites.get(tokenId);
    if (!sprite) return;
    sprite.markLocalPending();
    sprite.snapTo(x, y);
  }

  /**
   * Rollback a token to the authoritative position after a rejected ack.
   * Snaps instantly (no animation) to provide immediate rejection feedback.
   * Clears _localPending so the next broadcast from the server animates normally.
   *
   * REQ-NET-051: if server rejects/corrects, originator reverts to authoritative pos.
   */
  rollbackMove(tokenId: string, authX: number, authY: number): void {
    const sprite = this._sprites.get(tokenId);
    if (!sprite) return;
    // Clear the pending flag BEFORE snap so that any subsequent server broadcast
    // for this token will animate rather than being silently consumed.
    sprite.clearLocalPending();
    sprite.snapTo(authX, authY);
  }

  // ---------------------------------------------------------------------------
  // Public — sprite access (for visual updates in TokenInteractionManager)
  // ---------------------------------------------------------------------------

  /**
   * Iterate all active sprites as [tokenId, TokenSprite] pairs.
   * Used by TokenInteractionManager to update selection visuals.
   */
  sprites(): IterableIterator<[string, TokenSprite]> {
    return this._sprites.entries();
  }

  /**
   * Return the sprite for a given token ID, or undefined if not found.
   * Used by TokenInteractionManager to update pending visuals.
   */
  getSprite(tokenId: string): TokenSprite | undefined {
    return this._sprites.get(tokenId);
  }

  // ---------------------------------------------------------------------------
  // Public — vision filter update (M2-B)
  // ---------------------------------------------------------------------------

  /**
   * Update the current vision polygons and fog active state.
   *
   * Called after each VisionStateComputer.compute() to apply the token
   * visibility filter: tokens outside the current vision polygon are
   * hidden for non-GM players (REQ-VIS-080).
   *
   * The fog overlay (LightingRenderer) already hides the terrain in unexplored /
   * explored-but-not-visible areas; this filter hides TOKENS in those areas
   * so they don't bleed through the fog overlay.
   *
   * @param polygons - Current vision polygons from VisionStateResult.
   * @param fogEnabled - Whether fog/token-vision is active.
   */
  setVisionPolygons(polygons: VisionPolygonResult[], fogEnabled: boolean): void {
    this._visionPolygons = polygons;
    this._fogActive = !this._isGm && fogEnabled;
    this._applyVisionFilter();
  }

  // ---------------------------------------------------------------------------
  // Public — scene/grid update
  // ---------------------------------------------------------------------------

  /**
   * Update the grid size (e.g. scene changed grid config).
   * Forces a full re-reconcile of all sprites.
   */
  setGridSize(gridSize: number, tokens: TokenDocument[]): void {
    this._gridSize = gridSize;
    this._reconcileTokens(tokens);
  }

  // ---------------------------------------------------------------------------
  // Public — what is on screen
  // ---------------------------------------------------------------------------

  /**
   * Ids of the tokens this layer is drawing right now.
   *
   * Reports the result of the filters already applied above — hidden tokens for
   * players, the vision filter, reconciliation — instead of re-deriving them.
   * The tactical minimap (spec 32, DEC-MMT-02) consumes this so it can never
   * show a token the canvas is hiding: a widget that computes its own
   * visibility diverges in silence, which is the worst bug a table can have.
   */
  visibleTokenIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const [id, sprite] of this._sprites) {
      if (sprite.container.visible) ids.add(id);
    }
    return ids;
  }

  // ---------------------------------------------------------------------------
  // Public — teardown
  // ---------------------------------------------------------------------------

  /**
   * Destroy all sprites and unsubscribe from the mirror.
   * Safe to call multiple times.
   */
  destroy(): void {
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._clearAll();
  }

  // ---------------------------------------------------------------------------
  // Private — reconciliation
  // ---------------------------------------------------------------------------

  /**
   * Reconcile the in-memory sprite map with the authoritative token list.
   *
   * - Tokens not in the new list → destroy sprite.
   * - Tokens in the new list but not in sprites → create sprite.
   * - Tokens in both → update sprite.
   *
   * Hidden tokens: GMs see them semi-transparent (handled by TokenSprite).
   * Players: server filters hidden tokens from snapshots; we still guard here
   * in case a doc:update arrives with hidden=true before a delete.
   */
  private _reconcileTokens(tokens: TokenDocument[]): void {
    const incomingIds = new Set<string>();

    for (const token of tokens) {
      // Players should not render hidden tokens (server filters, but be safe)
      if (token.hidden && !this._isGm) continue;

      incomingIds.add(token._id);
      const existing = this._sprites.get(token._id);
      if (existing) {
        existing.update(token, this._gridSize);
      } else {
        // Create new sprite
        const sprite = new TokenSprite(token, this._gridSize, this._isGm);
        sprite.updateLod(this._lastZoom);
        this._sprites.set(token._id, sprite);
        this._container.addChild(sprite.container);
      }
    }

    // Remove sprites for tokens that no longer exist in the scene
    for (const [id, sprite] of this._sprites) {
      if (!incomingIds.has(id)) {
        sprite.destroy();
        this._sprites.delete(id);
      }
    }

    // After reconciliation, apply vision filter to ensure new sprites are
    // correctly hidden/shown based on current vision state.
    this._applyVisionFilter();
  }

  private _clearAll(): void {
    for (const sprite of this._sprites.values()) {
      sprite.destroy();
    }
    this._sprites.clear();
  }

  // ---------------------------------------------------------------------------
  // Private — vision filter
  // ---------------------------------------------------------------------------

  /**
   * Apply the vision-based visibility filter to all active sprites.
   *
   * REQ-VIS-080: tokens outside the current vision polygon are invisible
   * to non-GM players, even in explored areas.
   *
   * Only affects non-GM players when fog is active. GM and disabled fog
   * always show all tokens.
   */
  private _applyVisionFilter(): void {
    if (this._isGm || !this._fogActive) {
      // Restore all sprites to visible
      for (const sprite of this._sprites.values()) {
        sprite.container.visible = true;
      }
      return;
    }

    // No vision polygons → player has no tokens with vision → see nothing
    if (this._visionPolygons.length === 0) {
      for (const sprite of this._sprites.values()) {
        sprite.container.visible = false;
      }
      return;
    }

    for (const sprite of this._sprites.values()) {
      const pos = sprite.container;
      const visible = pointInAnyPolygon(pos.x, pos.y, this._visionPolygons);
      sprite.container.visible = visible;
    }
  }
}
