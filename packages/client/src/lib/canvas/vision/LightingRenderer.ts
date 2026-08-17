/**
 * LightingRenderer.ts — PIXI rendering for the "lighting" layer.
 *
 * Spec: 07-visao-iluminacao-fog.md
 * REQ-VIS-043: bright/dim distinction with gradient
 * REQ-VIS-044: darkness overlay controlled by scene.darkness
 * REQ-VIS-045: global illumination
 * REQ-VIS-064: GM sees all; player masked to current vision
 * REQ-VIS-080: three fog states (unexplored / explored-out-of-sight / visible)
 * D10: lighting composed in RenderTextures and meshes/shaders
 *
 * Render composition (bottom → top within the "lighting" layer):
 *   1. Darkness overlay (dark rect at darkness alpha — affects everything)
 *   2. Light meshes (additive blending: bright inner + dim outer)
 *   3. Fog overlay (three-state fog: unexplored opaque / explored translucent / visible clear)
 *      — replaces the old simple vision mask when fog is provided.
 *   4. Vision mask overlay (for non-GM players without fog: black rect punched by vision)
 *
 * Fog three-state composition (when FogRenderState is provided):
 *   a. Draw full-scene black rect (alpha 1.0) — unexplored base
 *   b. Draw explored FogShape polygons with erase blend (removes unexplored → shows dim layer)
 *   c. Between (a) and (b): a translucent layer (0.5 alpha) drawn only over explored area
 *      so explored-but-not-visible = dimmed terrain visible.
 *   d. For currently-visible area: draw current vision rings with erase blend at full opacity
 *      on top of the translucent layer so currently-visible = fully clear.
 *
 * Implementation strategy for three fog states:
 *   Layer 3a (fogBase, black, alpha 1)         — covers everything
 *   Layer 3b (exploredDim, black, alpha 0.6)   — covers only explored area (via erase on base)
 *     → result: unexplored = black; explored = dimmed through 0.6 overlay
 *   Layer 3c (currentVision, erases 3b)        — currently visible area is fully clear
 *
 * The lighting layer sits in the EffectsGroup above tokens so it darkens tokens
 * that are not in vision and illuminates those that are.
 *
 * Performance notes:
 *  - Uses PIXI Graphics (CPU polygons) for MVP; WebGPU mesh shaders in V2.
 *  - Redraws only when VisionStateResult or FogRenderState changes.
 *  - Re-render guard: skips draw when state key unchanged. The key is built
 *    from actual coordinates/properties (see buildLightingStateKey below),
 *    not vertex/ring COUNTS — moving a source without changing its polygon's
 *    vertex count must still invalidate the cached render.
 *  - Debug: logs recalc time to console when F9 debug is active.
 */

import { Container, Graphics } from "pixi.js";
import type { VisionStateResult, LightPolygonResult, VisionPolygonResult } from "./vision-state.js";
import type { FogRenderState } from "./fog-state.js";
import type { FogRing } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Blend mode constants
// PIXI v8: blendMode is a string enum.
// ---------------------------------------------------------------------------

const BLEND_ADD = "add" as const;

/**
 * Alpha for the "explored but not currently visible" fog layer.
 * 0 = fully transparent (explored = completely revealed)
 * 1 = fully opaque (explored = same as unexplored)
 * 0.65 gives a dark translucent look for explored areas.
 */
const EXPLORED_FOG_ALPHA = 0.65;

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
  /** Fog container — three-state fog when FogRenderState provided. */
  private _fogContainer: Container;
  /** Simple vision mask container — used when no fog state is provided. */
  private _visionMaskContainer: Container;

  /** Last rendered state — used to skip redundant draws. */
  private _lastStateKey = "";

  /**
   * Set by `destroy()`, checked at the top of `render()` (defect 2, Fase 1 e2e).
   * `SceneOrchestrator.setup()` is async (it awaits `FogState.load()` before its
   * first `render()` call); `TableScreen.svelte` can call this renderer's owning
   * orchestrator's `teardown()` — which calls `destroy()` here — while that
   * `setup()` is still in flight, whenever a Scene mutation (e.g. a new token
   * embedding) makes the `$effect` re-run before the previous one finished. The
   * `_darknessOverlay`/etc. Graphics objects are then already destroyed — PIXI's
   * `Graphics.clear()` reads a `null` internal context in that state and throws
   * `TypeError: Cannot read properties of null (reading 'clear')` (confirmed
   * against the exact exception from the e2e console capture). `render()` after
   * `destroy()` is a no-op instead: the orchestrator that superseded this one
   * already owns a fresh `LightingRenderer` and will draw the current state.
   */
  private _destroyed = false;

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

    // 3. Fog overlay (three-state: unexplored / explored / visible)
    this._fogContainer = new Container();
    this._fogContainer.label = "lighting:fog";
    this._fogContainer.eventMode = "none";
    container.addChild(this._fogContainer);

    // 4. Simple vision mask (non-GM, no fog state)
    this._visionMaskContainer = new Container();
    this._visionMaskContainer.label = "lighting:vision-mask";
    this._visionMaskContainer.eventMode = "none";
    container.addChild(this._visionMaskContainer);
  }

  /**
   * Update the rendered lighting state.
   * Safe to call every frame — returns early if state unchanged.
   *
   * @param state - Vision/lighting computation result from VisionStateComputer.
   * @param fogState - Optional fog render state from FogState. When provided,
   *   replaces the simple vision mask with three-state fog rendering.
   * @param debugMode - Log timing when true.
   * @param restrictionActive - REQ-VIS-085: whether this scene actually
   *   restricts non-GM vision (`scene.tokenVision === true`). Defaults to
   *   `true` for callers that only ever render restricted scenes (e.g. the
   *   existing unit tests). When `false`, fog/vision-mask are cleared exactly
   *   like the GM branch below — darkness and lights (which are not a
   *   per-role restriction) still render for everyone.
   */
  render(
    state: VisionStateResult,
    fogState?: FogRenderState | null,
    debugMode = false,
    restrictionActive = true,
  ): void {
    // Defect 2 (Fase 1 e2e): a no-op guard against a stale async continuation
    // rendering into PIXI objects this instance's own `destroy()` already tore
    // down — see the `_destroyed` field doc comment for the exact race.
    if (this._destroyed) return;

    const t0 = performance.now();

    const stateKey = this._buildStateKey(state, fogState, restrictionActive);
    if (stateKey === this._lastStateKey) return;
    this._lastStateKey = stateKey;

    this._renderDarkness(state.darkness);
    this._renderLights(state.lightPolygons, state.globalLight);

    const mode = selectLightingRenderMode(state.isGm, restrictionActive, fogState);

    if (mode === "fog") {
      // Three-state fog: hides simple vision mask
      this._visionMaskContainer.removeChildren();
      this._visionMaskContainer.visible = false;
      this._fogContainer.visible = true;
      // Narrowed by selectLightingRenderMode: "fog" only returns when fogState is truthy.
      this._renderFog(fogState as FogRenderState, state.visionPolygons);
    } else if (mode === "vision-mask") {
      // No fog state — use simple M2-A vision mask
      this._fogContainer.removeChildren();
      this._fogContainer.visible = false;
      this._visionMaskContainer.visible = true;
      this._renderVisionMask(state.visionPolygons, state.isGm, state.darkness, state.globalLight);
    } else {
      // GM, or a scene that does not restrict non-GM vision at all
      // (REQ-VIS-085: `scene.tokenVision !== true` → the whole scene is
      // visible to everyone): clear both.
      this._fogContainer.removeChildren();
      this._fogContainer.visible = false;
      this._visionMaskContainer.removeChildren();
      this._visionMaskContainer.visible = false;
    }

    const elapsed = performance.now() - t0;
    if (debugMode && elapsed > 1) {
      console.debug(`[LightingRenderer] render ${elapsed.toFixed(2)}ms`);
    }
  }

  /** Clean up all PIXI objects. Idempotent — a second call is a no-op. */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._darknessOverlay.destroy();
    this._lightsContainer.destroy({ children: true });
    this._fogContainer.destroy({ children: true });
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
  // Private — three-state fog rendering
  // ---------------------------------------------------------------------------

  /**
   * Render the fog of war with three visual states:
   *   - Unexplored: opaque black (base layer)
   *   - Explored but not currently visible: translucent dark overlay
   *     (shows the map background dimmed — terrain visible, NO live tokens)
   *   - Currently visible: fully clear
   *
   * Implementation:
   *   Layer A: full-scene opaque black rect
   *   Layer B: for each explored polygon, draw an EXPLORED_FOG_ALPHA black poly
   *            (drawn OVER Layer A via normal blend — so explored replaces the
   *             opaque black with a translucent shadow)
   *   Wait — cleaner approach using PIXI groups + erase:
   *
   *   Container "fog":
   *     1. fogBase (Graphics): full-scene black, alpha 1  — unexplored base
   *     2. exploredErase (Graphics, blendMode "erase"): explored polygons at alpha 1
   *        → This cuts out explored areas from fogBase (they become transparent)
   *     3. exploredDim (Graphics, blendMode "normal"): explored polygons at alpha EXPLORED_FOG_ALPHA
   *        → Draws a translucent dim over explored-but-not-visible areas
   *     4. currentVisionErase (Graphics, blendMode "erase"): current vision at alpha 1
   *        → Cuts current vision from exploredDim (makes currently-visible fully clear)
   *
   * Result:
   *   - Unexplored area: covered by fogBase (alpha 1, black) — opaque
   *   - Explored, not visible: fogBase erased → exploredDim (alpha 0.65, black) — dimmed map
   *   - Currently visible: fogBase erased, exploredDim erased → fully clear
   *
   * Note: for the "explored dim" layer to show terrain but NOT tokens, this fog layer
   * must be above the tokens layer (which it is, being in EffectsGroup).
   * The live token rendering is handled separately by the token visibility filter
   * (see FogTokenFilter / TokenLayer.setVisionPolygons).
   *
   * REQ-VIS-080: three states correctly modeled.
   */
  private _renderFog(fogState: FogRenderState, visionPolygons: VisionPolygonResult[]): void {
    this._fogContainer.removeChildren();

    const totalW = this._sceneWidth + this._padX * 2;
    const totalH = this._sceneHeight + this._padY * 2;

    // --- Layer 1: Full-scene unexplored base (opaque black) ---
    const fogBase = new Graphics();
    fogBase.label = "fog:base";
    fogBase.eventMode = "none";
    fogBase.rect(0, 0, totalW, totalH).fill({ color: 0x000000, alpha: 1 });
    this._fogContainer.addChild(fogBase);

    // If no explored area at all, we're done (full blackout)
    if (fogState.explored.polygons.length === 0 && fogState.currentVisionRings.length === 0) {
      return;
    }

    // Gather all rings to render: explored shape + current vision rings
    // For the "erase explored from base" pass:
    const allKnownRings: FogRing[] = [];
    for (const poly of fogState.explored.polygons) {
      allKnownRings.push(poly.outer);
    }
    // Current vision rings also need to be part of the explored erase pass
    // (they are either already in explored or about to be)
    for (const ring of fogState.currentVisionRings) {
      allKnownRings.push(ring);
    }

    if (allKnownRings.length > 0) {
      // --- Layer 2: Erase explored areas from the opaque base ---
      // (Removes them from the black base so they show the scene underneath)
      const exploredErase = new Graphics();
      exploredErase.label = "fog:explored-erase";
      exploredErase.eventMode = "none";
      exploredErase.blendMode = "erase";
      for (const ring of allKnownRings) {
        drawRingOnGraphics(exploredErase, ring);
      }
      this._fogContainer.addChild(exploredErase);

      // --- Layer 3: Draw dim overlay on explored areas ---
      // (Re-adds translucent black over explored — so explored = dimmed, not clear)
      const exploredDim = new Graphics();
      exploredDim.label = "fog:explored-dim";
      exploredDim.eventMode = "none";
      for (const ring of allKnownRings) {
        drawRingOnGraphics(exploredDim, ring, EXPLORED_FOG_ALPHA);
      }
      this._fogContainer.addChild(exploredDim);
    }

    // --- Layer 4: Erase currently-visible areas from the dim overlay ---
    // This makes the currently-visible area fully clear.
    // Priority: current vision polygons from VisionStateResult (authoritative for rendering)
    const currentRings: FogRing[] = [];

    // Prefer the VisionPolygonResult rings (contains actual computed polygons)
    for (const vp of visionPolygons) {
      const verts = vp.polygon.vertices;
      if (verts.length < 3) continue;
      const ring: FogRing = [];
      for (const v of verts) {
        ring.push(v.x, v.y);
      }
      currentRings.push(ring);
    }

    // Also use fogState.currentVisionRings as fallback / supplement
    if (currentRings.length === 0) {
      for (const ring of fogState.currentVisionRings) {
        currentRings.push(ring);
      }
    }

    if (currentRings.length > 0) {
      const currentVisionErase = new Graphics();
      currentVisionErase.label = "fog:current-erase";
      currentVisionErase.eventMode = "none";
      currentVisionErase.blendMode = "erase";
      for (const ring of currentRings) {
        drawRingOnGraphics(currentVisionErase, ring);
      }
      this._fogContainer.addChild(currentVisionErase);
    }
  }

  // ---------------------------------------------------------------------------
  // Private — vision mask (legacy — used when no FogRenderState)
  // ---------------------------------------------------------------------------

  /**
   * Render the vision mask for non-GM players (M2-A behavior, no fog state).
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

  private _buildStateKey(
    state: VisionStateResult,
    fogState: FogRenderState | null | undefined,
    restrictionActive: boolean,
  ): string {
    return buildLightingStateKey(state, fogState, restrictionActive);
  }
}

// ---------------------------------------------------------------------------
// Pure render-mode selector (exported for unit testing without a PIXI renderer)
// ---------------------------------------------------------------------------

/**
 * Decide which of render()'s three mutually-exclusive branches applies
 * (REQ-VIS-085, A005 fix — "cena preta para o jogador", ajustes r1 item 24).
 *
 * - "fog": three-state fog rendering — fogState is provided, its own
 *   `fogActive` flag is on, AND this scene restricts non-GM vision.
 * - "vision-mask": simple M2-A vision mask — scene restricts non-GM vision,
 *   but there is no active fog state to render instead.
 * - "clear": GM (never restricted), or a scene that does not restrict
 *   non-GM vision at all (`restrictionActive === false` — either
 *   `scene.tokenVision` or `scene.fogEnabled` is off). Both the fog and
 *   vision-mask containers must be cleared here, not just left alone —
 *   this is the branch that used to be unreachable for a non-GM viewer
 *   before the A005 fix, which painted the whole canvas black regardless
 *   of `restrictionActive`.
 *
 * Extracted as a pure function (no PIXI dependency) so this exact branch
 * can be unit tested without a renderer, per this codebase's convention
 * (see `buildLightingStateKey` below).
 */
export function selectLightingRenderMode(
  isGm: boolean,
  restrictionActive: boolean,
  fogState: FogRenderState | null | undefined,
): "fog" | "vision-mask" | "clear" {
  const showRestriction = !isGm && restrictionActive;
  if (fogState && fogState.fogActive && showRestriction) return "fog";
  if (showRestriction) return "vision-mask";
  return "clear";
}

// ---------------------------------------------------------------------------
// Pure state-key builder (exported for unit testing without a PIXI renderer)
// ---------------------------------------------------------------------------

/**
 * Serialize a VisibilityPolygon's vertices into a compact, content-sensitive
 * string: every coordinate is included, not just the vertex count.
 *
 * Coordinates are rounded to a small fraction of a pixel (4 decimal places)
 * so floating-point noise from repeated geometry ops doesn't cause spurious
 * re-renders, while any real movement (which changes coordinates by at least
 * a visible fraction of a pixel) still changes the key.
 */
function polygonVerticesKey(vertices: readonly { x: number; y: number }[]): string {
  let key = "";
  for (const v of vertices) {
    key += `${v.x.toFixed(4)},${v.y.toFixed(4)};`;
  }
  return key;
}

/** Serialize a FogRing (flat [x0,y0,x1,y1,...]) into a coordinate-sensitive string. */
function fogRingKey(ring: FogRing): string {
  let key = "";
  for (const coord of ring) {
    key += `${coord.toFixed(4)},`;
  }
  return key;
}

/**
 * Build the re-render guard key for LightingRenderer.render().
 *
 * MUST reflect the actual content that affects the drawn pixels — not just
 * counts. A stateKey based on vertex/ring COUNTS is a real bug: moving a
 * light or token without changing its polygon's vertex count (the common
 * case — a light's visibility polygon shape stays topologically the same as
 * it slides across open floor) would produce an unchanged key, so
 * LightingRenderer.render() would skip the redraw and leave stale geometry
 * on screen.
 *
 * This function includes:
 *  - Full vertex coordinates for every vision and light polygon (not counts).
 *  - Light id + color + intensity + dim/bright radii (properties that affect
 *    the drawn gradient/color even when the polygon shape is unchanged).
 *  - Full fog ring coordinates for explored polygons + current vision rings
 *    (not just totalVertices/ring-count).
 *
 * Exported as a pure function (no PIXI dependency) so it can be unit tested
 * without a renderer, per this codebase's convention (see
 * CombatTurnMarker.test.ts / computePulseAlpha).
 *
 * `restrictionActive` (REQ-VIS-085, A005 fix) is folded into the key too:
 * toggling a scene's `tokenVision` flag with everything else unchanged must
 * still force a redraw (fog/mask appearing or disappearing), not get skipped
 * by the re-render guard.
 */
export function buildLightingStateKey(
  state: VisionStateResult,
  fogState?: FogRenderState | null,
  restrictionActive = true,
): string {
  const vpKey = state.visionPolygons
    .map((v) => `${v.tokenId}:${polygonVerticesKey(v.polygon.vertices)}`)
    .join("|");

  const lpKey = state.lightPolygons
    .map(
      (l) =>
        `${l.lightId}:${l.color}:${String(l.intensity)}:${String(l.dimPx)}:${String(l.brightPx)}:${polygonVerticesKey(l.polygon.vertices)}:${polygonVerticesKey(l.brightPolygon.vertices)}`,
    )
    .join("|");

  const fogKey = fogState
    ? `fog:${fogState.explored.polygons
        .map((p) => `${fogRingKey(p.outer)}[${p.holes.map((h) => fogRingKey(h)).join("/")}]`)
        .join("|")}:cv:${fogState.currentVisionRings.map((r) => fogRingKey(r)).join("|")}`
    : "nofog";

  return `${String(state.isGm)}|${String(restrictionActive)}|${String(state.darkness)}|${String(state.globalLight)}|${vpKey}||${lpKey}||${fogKey}`;
}

// ---------------------------------------------------------------------------
// Internal helper — draw a FogRing onto a Graphics object
// ---------------------------------------------------------------------------

/**
 * Draw a closed ring (flat [x0,y0,x1,y1,...]) onto a PIXI Graphics object.
 * Skips rings with fewer than 3 vertices.
 */
function drawRingOnGraphics(g: Graphics, ring: FogRing, fillAlpha = 1): void {
  const n = ring.length >> 1;
  if (n < 3) return;
  const x0 = ring[0] as number;
  const y0 = ring[1] as number;
  g.moveTo(x0, y0);
  for (let i = 1; i < n; i++) {
    g.lineTo(ring[i * 2] as number, ring[i * 2 + 1] as number);
  }
  g.closePath();
  g.fill({ color: 0x000000, alpha: fillAlpha });
}
