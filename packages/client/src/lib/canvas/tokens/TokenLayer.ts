/**
 * TokenLayer.ts — reactive layer binding DocumentMirror → PIXI token sprites.
 *
 * Spec: 06-canvas-e-renderizacao.md §REQ-CNV-025..033, §REQ-CNV-037, §D5, §D8
 * Spec: 05-usuarios-e-permissoes.md — hidden tokens; GM sees all
 * Spec: 04-rede-e-sincronizacao.md §REQ-NET-050/051/052 — optimistic move
 *
 * DEC-SEP-05 (F2, 2026-08-23): the vision-based visibility filter that used to
 * live here (`setVisionPolygons`/`_applyVisionFilter`, REQ-VIS-080) was removed
 * with the rest of the fog/vision pipeline — see `docs/design/separacao-repos/
 * design.md`. Every non-hidden token is now visible to every role; hidden
 * tokens keep the separate (and unrelated) GM-only redaction below.
 *
 * Responsibilities:
 *   - Subscribe to DocumentMirror "Token" (embedded in active SceneDocument).
 *   - For each TokenDocument in the active scene: create, update, or destroy
 *     a TokenSprite.
 *   - Subscribe to DocumentMirror "Actor": a sprite's art/name come from the
 *     base Actor (TK023 / RNF-TOK-01), not from the token itself, so an
 *     Actor edited (or created after its token, e.g. compendium drop) must
 *     also re-reconcile the active scene's tokens — otherwise art/name
 *     freeze after the first draw.
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
import type { ActorDocument } from "../../actors/actorDirectory.js";
import { TokenSprite } from "./TokenSprite.js";
import { tokenDisplayPrefs } from "./tokenDisplayPrefsStore.svelte.js";
import { footprintRegistry } from "./footprintRegistry.svelte.js";

// ---------------------------------------------------------------------------
// TokenLayer
// ---------------------------------------------------------------------------

export class TokenLayer {
  /** The PIXI container this layer manages. Pass the "tokens" layer. */
  private _container: Container;

  /**
   * The world mirror. Stored (not just read once in the constructor) so it
   * can be handed to each `TokenSprite` — TK023 (REQ-CNV-091): a sprite reads
   * its effective actor from the mirror by `token.actorId`, it no longer
   * carries its own art.
   */
  private _mirror: DocumentMirror;

  /** Mirror subscription unsubscribe fn (Scene collection). */
  private _unsubscribe: (() => void) | null = null;

  /**
   * Mirror subscription unsubscribe fn (Actor collection).
   *
   * TK023 (RNF-TOK-01) made every sprite resolve its art/name from the base
   * Actor document via `resolveEffectiveActor`, but that resolution only
   * re-runs when the sprite's own TokenDocument changes (`update()`). An
   * Actor edited on its own (art swap, rename) — or an Actor arriving in the
   * mirror AFTER its token (compendium drop: Actor doc:create, then the
   * token's doc:create) — never touched the Scene document, so no sprite
   * ever re-read it. Subscribing to "Actor" here closes that gap: any Actor
   * change re-reconciles the active scene's tokens, which re-resolves every
   * sprite's effective actor and redraws art/nameplate accordingly.
   */
  private _unsubscribeActor: (() => void) | null = null;

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
   * The display-preferences object last applied to every sprite (for LOD) —
   * TK080/REQ-TOK-074: `tokenDisplayPrefsStore.svelte.ts` hands out a NEW
   * object every time the user toggles a preference, so a reference
   * inequality here is exactly "the preference changed since last tick",
   * with no extra event wiring needed from the Configurações drawer.
   */
  private _lastDisplayPrefs = tokenDisplayPrefs.current;

  /**
   * The size→footprint table last reconciled against (R5).
   *
   * `footprintRegistry` is filled by the `system:footprint` ack (TK041), which
   * is ASYNCHRONOUS: the canvas mounts, sprites reconcile against an empty
   * table — `footprintOf` fails open to 1×1 (REQ-TOK-012, DEC-TOK-03) — and
   * the answer lands a round-trip later. `_reconcileTokens` only runs on a
   * Scene or Actor mirror change, so before this field a "grande" creature
   * stayed 1×1 until some unrelated broadcast touched the scene; #194's
   * `_loadedSceneId` guard removed the scene reload that used to hide it.
   * Same mechanism as `_lastDisplayPrefs` above: the registry publishes a NEW
   * Map whenever the table changes, so a reference inequality in `tick()` is
   * exactly "the table changed since last frame".
   */
  private _lastFootprintTable = footprintRegistry.sizeToFootprint;

  constructor(
    container: Container,
    mirror: DocumentMirror,
    sceneId: string,
    gridSize: number,
    isGm: boolean,
  ) {
    this._container = container;
    this._mirror = mirror;
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

    // Subscribe to Actor collection changes — an Actor edited (or created)
    // on its own never touches the Scene document, so without this the
    // sprite's art/name freeze after the first draw (see _unsubscribeActor
    // doc comment above).
    this._unsubscribeActor = mirror.subscribe<ActorDocument>("Actor", () => {
      const activeScene = this._mirror.getDoc<SceneDocument>("Scene", this._sceneId);
      if (activeScene) {
        this._reconcileTokens(activeScene.tokens);
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
    // R5: the size→footprint table can land after the sprites were first
    // drawn (see `_lastFootprintTable`). Re-reconcile the active scene once,
    // on the first frame after it changes — `TokenSprite.update` re-derives
    // the footprint and repaints when it differs (REQ-TOK-012/017).
    const footprintTable = footprintRegistry.sizeToFootprint;
    if (footprintTable !== this._lastFootprintTable) {
      this._lastFootprintTable = footprintTable;
      const scene = this._mirror.getDoc<SceneDocument>("Scene", this._sceneId);
      if (scene) this._reconcileTokens(scene.tokens);
    }

    for (const sprite of this._sprites.values()) {
      sprite.tick(deltaMs);
    }

    // Update LOD when zoom changes by a non-trivial amount, OR when the
    // user's display preferences changed (TK080) — either one can move the
    // effective (zoom AND preference) visibility TokenSprite.updateLod computes.
    const prefsChanged = tokenDisplayPrefs.current !== this._lastDisplayPrefs;
    if (Math.abs(zoom - this._lastZoom) > 0.01 || prefsChanged) {
      this._lastZoom = zoom;
      this._lastDisplayPrefs = tokenDisplayPrefs.current;
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
    this._unsubscribeActor?.();
    this._unsubscribeActor = null;
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
        // TK023 (REQ-CNV-091): the sprite is handed the mirror so it can
        // resolve its own effective actor (art/name) by `token.actorId` —
        // a token no longer carries a `texture` of its own.
        const sprite = new TokenSprite(token, this._gridSize, this._isGm, this._mirror);
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
