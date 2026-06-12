/**
 * TokenLayer.ts — reactive layer binding DocumentMirror → PIXI token sprites.
 *
 * Spec: 06-canvas-e-renderizacao.md §REQ-CNV-025..033, §REQ-CNV-037, §D5, §D8
 * Spec: 05-usuarios-e-permissoes.md — hidden tokens; GM sees all
 * Spec: 04-rede-e-sincronizacao.md §REQ-NET-050/051/052 — optimistic move
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
 *
 * This class does NOT own the PIXI ticker — it receives deltaMs from the
 * FusionCanvas ticker callback. The sceneLoader (or TableScreen) wires this up.
 *
 * Usage:
 *   const layer = new TokenLayer(container, mirror, sceneId, gridSize, isGm);
 *   // In ticker:
 *   layer.tick(ticker.deltaMS, camera.scale);
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
  }

  private _clearAll(): void {
    for (const sprite of this._sprites.values()) {
      sprite.destroy();
    }
    this._sprites.clear();
  }
}
