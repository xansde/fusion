/**
 * combatCanvasController.ts — wires combat state to the PIXI canvas.
 *
 * Reads the active combat from combatStore, maps the active combatant's
 * tokenId to a token sprite position from the TokenLayer, and drives the
 * CombatTurnMarker.
 *
 * Also handles auto-pan (REQ-CBT-045) when combat.autoPan is true.
 *
 * This is a pure TypeScript class (no Svelte runes) so it can be created
 * and destroyed imperatively from the scene loader.
 *
 * Usage:
 *   const controller = new CombatCanvasController(
 *     canvas, tokenLayer, controlsLayer, gridSize, isGm
 *   );
 *   // In ticker:
 *   controller.tick(deltaMs);
 *   // When scene unloads:
 *   controller.destroy();
 *
 * REQ-CBT-050..052: turn marker; REQ-CBT-045: auto-pan.
 * Spec: 10-combate-e-iniciativa.md
 */

import type { Container } from "pixi.js";
import type { FusionCanvas } from "../FusionCanvas.js";
import type { TokenLayer } from "../tokens/TokenLayer.js";
import { combatStore, getTargetingState } from "../../combat/combatStore.svelte.js";
import { resolveCombatantTokenId } from "../../combat/combatTracker.js";
import { computeReticlePositions, type TokenFootprint } from "../../combat/targeting.js";
import { CombatTurnMarker } from "./CombatTurnMarker.js";
import { TargetingMarkerLayer } from "./TargetingMarker.js";

// ---------------------------------------------------------------------------
// CombatCanvasController
// ---------------------------------------------------------------------------

export class CombatCanvasController {
  private _canvas: FusionCanvas;
  private _tokenLayer: TokenLayer;
  private _marker: CombatTurnMarker;
  private _targeting: TargetingMarkerLayer;

  /** Local user id (drives reticle color: own targets vs others). */
  private _userId: string;

  /** Last known active tokenId. Used to detect turn changes. */
  private _lastActiveTokenId: string | null = null;

  /** Whether this is the GM (unused for now but reserved for GM-only visuals). */
  private _isGm: boolean;

  /** Current grid size in scene pixels. */
  private _gridSize: number;

  /**
   * Whether auto-pan is enabled (reads from combat.autoPan).
   * Cached locally; updated each tick.
   */
  private _autoPan = false;

  constructor(
    canvas: FusionCanvas,
    tokenLayer: TokenLayer,
    controlsLayer: Container,
    gridSize: number,
    isGm: boolean,
    userId: string,
  ) {
    this._canvas = canvas;
    this._tokenLayer = tokenLayer;
    this._gridSize = gridSize;
    this._isGm = isGm;
    this._userId = userId;
    this._marker = new CombatTurnMarker(controlsLayer, gridSize);
    this._targeting = new TargetingMarkerLayer(controlsLayer);
  }

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  /**
   * Advance the marker animation and reconcile the active token.
   * Call from the scene ticker every frame.
   */
  tick(deltaMs: number): void {
    // Targeting reticles are independent of an active combat — they can be set
    // outside combat too. Reconcile them every frame so they follow token moves.
    this._reconcileTargeting();

    const combat = combatStore.combat;

    if (!combat || !combat.started || combat.ended) {
      this._marker.hide();
      this._lastActiveTokenId = null;
      return;
    }

    // Resolve which token is currently active
    const activeTokenId = resolveCombatantTokenId(combat);

    // Detect turn change
    const turnChanged = activeTokenId !== this._lastActiveTokenId;
    this._lastActiveTokenId = activeTokenId;

    if (!activeTokenId) {
      this._marker.hide();
      return;
    }

    // Get the sprite position for the active token
    const sprite = this._tokenLayer.getSprite(activeTokenId);

    if (!sprite) {
      // Token not rendered (e.g. not in current scene) — hide marker
      this._marker.hide();
      return;
    }

    // Update marker position (TokenSprite.container is at the token's top-left)
    const pos = sprite.container;
    this._marker.setActiveToken(pos.x, pos.y, this._gridSize);

    // Auto-pan on turn change (REQ-CBT-045)
    if (turnChanged && combat.autoPan) {
      const cx = pos.x + this._gridSize / 2;
      const cy = pos.y + this._gridSize / 2;
      this._canvas.zoomTo({ x: cx, y: cy, scale: this._canvas.camera.scale }, 400);
    }

    // Advance pulse animation
    this._marker.tick(deltaMs);
  }

  /**
   * Update the grid size when the scene config changes.
   */
  setGridSize(gridSize: number): void {
    this._gridSize = gridSize;
    this._marker.setGridSize(gridSize);
  }

  /**
   * Destroy the controller and remove the markers from the canvas.
   */
  destroy(): void {
    this._marker.destroy();
    this._targeting.destroy();
    this._lastActiveTokenId = null;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Reconcile the targeting reticles with the current targeting state.
   *
   * Resolves each targeted token's footprint from the TokenLayer (skipping
   * tokens not rendered in the current scene) and syncs the reticle layer.
   *
   * REQ-CBT-054: targeted tokens get a distinct visual marker.
   */
  private _reconcileTargeting(): void {
    const resolve = (tokenId: string): TokenFootprint | null => {
      const sprite = this._tokenLayer.getSprite(tokenId);
      if (!sprite) return null;
      const pos = sprite.container;
      return { x: pos.x, y: pos.y, gridSize: this._gridSize };
    };

    const positions = computeReticlePositions(getTargetingState(), this._userId, resolve);
    this._targeting.sync(positions);
  }
}
