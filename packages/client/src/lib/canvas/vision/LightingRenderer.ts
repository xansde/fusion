/**
 * LightingRenderer.ts — PIXI rendering for the "lighting" layer.
 *
 * Spec: 07-visao-iluminacao-fog.md
 * REQ-VIS-043: bright/dim distinction with gradient
 * REQ-VIS-044: darkness overlay controlled by scene.darkness
 * REQ-VIS-045: global illumination
 * REQ-VIS-064: GM sees all; player masked to current vision
 * D10: lighting composed in RenderTextures and meshes/shaders
 *
 * Render composition (bottom → top within the "lighting" layer):
 *   1. Darkness overlay (dark rect at darkness alpha — affects everything)
 *   2. Light meshes (additive blending: bright inner + dim outer)
 *   3. Vision mask overlay (for non-GM players: black rect punched by vision polygon)
 *
 * The lighting layer sits in the EffectsGroup above tokens so it darkens tokens
 * that are not in vision and illuminates those that are.
 *
 * Performance notes:
 *  - Uses PIXI Graphics (CPU polygons) for MVP; WebGPU mesh shaders in V2.
 *  - Redraws only when VisionStateResult changes (guarded by simple equality check).
 *  - Debug: logs recalc time to console when F9 debug is active.
 */

import { Container, Graphics } from "pixi.js";
import type { VisionStateResult, LightPolygonResult, VisionPolygonResult } from "./vision-state.js";

// ---------------------------------------------------------------------------
// Blend mode constants
// PIXI v8: blendMode is a string enum.
// ---------------------------------------------------------------------------

const BLEND_ADD = "add" as const;

// ---------------------------------------------------------------------------
// LightingRenderer
// ---------------------------------------------------------------------------

export class LightingRenderer {
  /** The container this renderer manages (should be the "lighting" layer). */
  private _container: Container;

  /** Scene dimensions (pixels). */
  private _sceneWidth: number;
  private _sceneHeight: number;
  private _padX: number;
  private _padY: number;

  /** Child containers for ordered rendering. */
  private _darknessOverlay: Graphics;
  private _lightsContainer: Container;
  private _visionMaskContainer: Container;

  /** Last rendered state — used to skip redundant draws. */
  private _lastStateKey = "";

  constructor(container: Container, sceneWidth: number, sceneHeight: number, padX = 0, padY = 0) {
    this._container = container;
    this._sceneWidth = sceneWidth;
    this._sceneHeight = sceneHeight;
    this._padX = padX;
    this._padY = padY;

    // 1. Darkness overlay
    this._darknessOverlay = new Graphics();
    this._darknessOverlay.label = "lighting:darkness";
    this._darknessOverlay.eventMode = "none";
    container.addChild(this._darknessOverlay);

    // 2. Light meshes (additive)
    this._lightsContainer = new Container();
    this._lightsContainer.label = "lighting:lights";
    this._lightsContainer.eventMode = "none";
    container.addChild(this._lightsContainer);

    // 3. Vision mask (non-GM)
    this._visionMaskContainer = new Container();
    this._visionMaskContainer.label = "lighting:vision-mask";
    this._visionMaskContainer.eventMode = "none";
    container.addChild(this._visionMaskContainer);
  }

  /**
   * Update the rendered lighting state.
   * Safe to call every frame — returns early if state unchanged.
   */
  render(state: VisionStateResult, debugMode = false): void {
    const t0 = performance.now();

    const stateKey = this._buildStateKey(state);
    if (stateKey === this._lastStateKey) return;
    this._lastStateKey = stateKey;

    this._renderDarkness(state.darkness);
    this._renderLights(state.lightPolygons, state.globalLight);
    this._renderVisionMask(state.visionPolygons, state.isGm, state.darkness, state.globalLight);

    const elapsed = performance.now() - t0;
    if (debugMode && elapsed > 1) {
      console.debug(`[LightingRenderer] render ${elapsed.toFixed(2)}ms`);
    }
  }

  /** Clean up all PIXI objects. */
  destroy(): void {
    this._darknessOverlay.destroy();
    this._lightsContainer.destroy({ children: true });
    this._visionMaskContainer.destroy({ children: true });
  }

  // ---------------------------------------------------------------------------
  // Private — darkness overlay
  // ---------------------------------------------------------------------------

  private _renderDarkness(darkness: number): void {
    const g = this._darknessOverlay;
    g.clear();
    if (darkness <= 0) return;

    // A black overlay with alpha proportional to darkness
    const totalW = this._sceneWidth + this._padX * 2;
    const totalH = this._sceneHeight + this._padY * 2;

    g.rect(0, 0, totalW, totalH).fill({ color: 0x000000, alpha: darkness * 0.8 });
  }

  // ---------------------------------------------------------------------------
  // Private — light meshes
  // ---------------------------------------------------------------------------

  private _renderLights(lights: LightPolygonResult[], globalLight: boolean): void {
    this._lightsContainer.removeChildren();

    if (globalLight && lights.length === 0) {
      // Global illumination: full scene is lit — skip individual lights
      return;
    }

    for (const light of lights) {
      this._drawLightPolygon(light);
    }
  }

  private _drawLightPolygon(light: LightPolygonResult): void {
    const color = this._hexToNumber(light.color);
    const alpha = Math.max(0.05, Math.min(1, light.intensity));

    // --- Dim polygon (outer, lower alpha) ---
    const dimG = new Graphics();
    dimG.eventMode = "none";
    dimG.blendMode = BLEND_ADD;

    const dimVerts = light.polygon.vertices;
    if (dimVerts.length >= 3) {
      const first = dimVerts[0];
      if (first) {
        dimG.moveTo(first.x, first.y);
        for (let i = 1; i < dimVerts.length; i++) {
          const v = dimVerts[i];
          if (v) dimG.lineTo(v.x, v.y);
        }
        dimG.closePath();
        dimG.fill({ color, alpha: alpha * 0.35 });
      }
    }

    this._lightsContainer.addChild(dimG);

    // --- Bright polygon (inner, stronger alpha) ---
    const brightVerts = light.brightPolygon.vertices;
    if (brightVerts.length >= 3 && light.brightPx > 0) {
      const brightG = new Graphics();
      brightG.eventMode = "none";
      brightG.blendMode = BLEND_ADD;

      const firstBright = brightVerts[0];
      if (firstBright) {
        brightG.moveTo(firstBright.x, firstBright.y);
        for (let i = 1; i < brightVerts.length; i++) {
          const v = brightVerts[i];
          if (v) brightG.lineTo(v.x, v.y);
        }
        brightG.closePath();
        brightG.fill({ color, alpha: alpha * 0.6 });
      }

      this._lightsContainer.addChild(brightG);
    }
  }

  // ---------------------------------------------------------------------------
  // Private — vision mask
  // ---------------------------------------------------------------------------

  /**
   * Render the vision mask for non-GM players.
   *
   * Strategy (simple, MVP):
   *   - Draw a full-scene black rect (alpha = fog darkness).
   *   - For each vision polygon: "punch a hole" by drawing the polygon
   *     with `erase` blend mode (PIXI v8 supports this).
   *   - Result: outside vision = dark; inside vision = clear.
   *
   * For GM: skip the mask entirely (they see everything).
   */
  private _renderVisionMask(
    visionPolygons: VisionPolygonResult[],
    isGm: boolean,
    darkness: number,
    globalLight: boolean,
  ): void {
    this._visionMaskContainer.removeChildren();

    // GM sees all — no fog overlay
    if (isGm) return;

    // Global illumination + no darkness = no mask needed
    if (globalLight && darkness <= 0) return;

    const totalW = this._sceneWidth + this._padX * 2;
    const totalH = this._sceneHeight + this._padY * 2;

    // Base fog alpha: outside vision is hidden
    // When there are no controlled tokens with vision, full blackout
    const fogAlpha = visionPolygons.length === 0 ? 1 : 0.92;

    // Draw the fog base
    const fogBase = new Graphics();
    fogBase.eventMode = "none";
    fogBase.rect(0, 0, totalW, totalH).fill({ color: 0x000000, alpha: fogAlpha });
    this._visionMaskContainer.addChild(fogBase);

    // Punch vision holes using erase blend mode
    for (const vp of visionPolygons) {
      const verts = vp.polygon.vertices;
      if (verts.length < 3) continue;

      const eraser = new Graphics();
      eraser.eventMode = "none";
      // "erase" is a valid PIXI v8 blend mode (blendMode is typed as string)
      eraser.blendMode = "erase";

      const firstVert = verts[0];
      if (!firstVert) continue;
      eraser.moveTo(firstVert.x, firstVert.y);
      for (let i = 1; i < verts.length; i++) {
        const v = verts[i];
        if (v) eraser.lineTo(v.x, v.y);
      }
      eraser.closePath();
      eraser.fill({ color: 0xffffff, alpha: 1 });

      this._visionMaskContainer.addChild(eraser);
    }
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  private _hexToNumber(hex: string): number {
    // "#rrggbb" → 0xrrggbb
    const clean = hex.replace("#", "");
    return parseInt(clean, 16) || 0xffffff;
  }

  private _buildStateKey(state: VisionStateResult): string {
    const vpKey = state.visionPolygons
      .map((v) => `${v.tokenId}:${String(v.polygon.vertices.length)}`)
      .join(",");
    const lpKey = state.lightPolygons
      .map((l) => `${l.lightId}:${String(l.polygon.vertices.length)}`)
      .join(",");
    return `${String(state.isGm)}|${String(state.darkness)}|${String(state.globalLight)}|${vpKey}|${lpKey}`;
  }
}
