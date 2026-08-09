/**
 * FusionCanvas.ts — PIXI Application shell for the Fusion VTT canvas.
 *
 * Spec: 06-canvas-e-renderizacao.md §DEC-CNV-01, §DEC-CNV-02, §REQ-CNV-001..009
 *
 * Responsibilities:
 *   - Initialize PIXI.Application with WebGPU preference, fallback to WebGL.
 *   - Maintain a ResizeObserver on the container element.
 *   - Build the four-group hierarchy: Primary, Effects, Interface, Overlay.
 *   - Provide a Render Group for the "world" (Primary + Effects + Interface),
 *     keeping Overlay outside so ruler/pings are fixed to screen.
 *   - Camera: pan (middle-button drag OR Space+drag), zoom at cursor.
 *   - Expose panTo / zoomTo / fitToScene programmatic API.
 *   - Export getLayer(name) with typed return.
 *   - Debug overlay toggled by F9: renderer, fps, camera, cell under cursor.
 *   - Clean destroy() with no leaks (important for Vite HMR).
 *
 * The PIXI shell is intentionally thin — all math lives in camera-math.ts.
 */

import { Application, Container, Text, TextStyle } from "pixi.js";

import type { GridStrategy } from "@fusion/shared";
import {
  type CameraState,
  type ZoomLimits,
  DEFAULT_ZOOM_LIMITS,
  screenToWorld,
  zoomAtPoint,
  centerOn,
  fitScene,
  lerpCamera,
  easeInOut,
} from "./camera-math.js";
import { GridRenderer, type GridRenderConfig } from "./GridRenderer.js";
import type { LayerName } from "./layers.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface FusionCanvasOptions {
  /** DOM element to mount the canvas inside. */
  container: HTMLElement;
  /** Initial zoom limits (default: 0.1–3.0). */
  zoomLimits?: ZoomLimits;
}

// ---------------------------------------------------------------------------
// Zoom constants
// ---------------------------------------------------------------------------

const ZOOM_FACTOR_WHEEL = 0.001; // scale delta per wheel pixel
// ZOOM_FACTOR_PINCH = 0.002 and ZOOM_STEP_KEYBOARD = 0.1 reserved for future pinch/keyboard handlers

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnimTarget {
  to: CameraState;
  durationMs: number;
  elapsed: number;
  from: CameraState;
}

// ---------------------------------------------------------------------------
// FusionCanvas
// ---------------------------------------------------------------------------

export class FusionCanvas {
  private _app: Application | null = null;
  private _container: HTMLElement;
  private _resizeObserver: ResizeObserver | null = null;
  private _destroyed = false;

  // Zoom limits
  private _zoomLimits: ZoomLimits;

  // Camera state
  private _camera: CameraState = { tx: 0, ty: 0, scale: 1 };
  private _animTarget: AnimTarget | null = null;

  // World container — is the render group for camera transform
  // REQ-CNV-006: Primary + Effects + Interface wrapped in a render group
  private _worldContainer: Container | null = null;

  // Layer containers
  private _layers: Map<LayerName, Container> = new Map();
  private _overlayContainer: Container | null = null;

  // Grid
  private _gridRenderer: GridRenderer | null = null;
  private _currentGridConfig: GridRenderConfig | null = null;
  /**
   * Grid geometry for the active scene. Owned by whoever loads the scene
   * (sceneLoader) and injected here; the canvas never assumes a grid type.
   */
  private _gridStrategy: GridStrategy | null = null;

  // Pan interaction
  private _isPanning = false;
  private _isSpaceDown = false;
  private _panStart: { sx: number; sy: number; tx: number; ty: number } | null = null;

  // Debug overlay
  private _debugVisible = false;
  private _debugText: Text | null = null;
  private _cursorWorld: { x: number; y: number } = { x: 0, y: 0 };
  private _fps = 0;
  private _rendererType = "unknown";

  // Bound event handlers (for removal on destroy)
  private _onWheel: (e: WheelEvent) => void;
  private _onPointerDown: (e: PointerEvent) => void;
  private _onPointerMove: (e: PointerEvent) => void;
  private _onPointerUp: (e: PointerEvent) => void;
  private _onKeyDown: (e: KeyboardEvent) => void;
  private _onKeyUp: (e: KeyboardEvent) => void;
  private _onContextMenu: (e: Event) => void;

  constructor(options: FusionCanvasOptions) {
    this._container = options.container;
    this._zoomLimits = options.zoomLimits ?? DEFAULT_ZOOM_LIMITS;

    // Bind handlers
    this._onWheel = this._handleWheel.bind(this);
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onKeyUp = this._handleKeyUp.bind(this);
    this._onContextMenu = (e) => {
      e.preventDefault();
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialize PIXI Application and build the scene hierarchy.
   * Must be awaited before calling any other method.
   *
   * REQ-CNV-001: WebGPU with automatic WebGL fallback.
   */
  async init(): Promise<void> {
    if (this._destroyed) throw new Error("[FusionCanvas] Cannot re-init after destroy()");
    if (this._app) return; // already initialized

    const { width, height } = this._container.getBoundingClientRect();

    const app = new Application();
    await app.init({
      width: Math.max(width, 1),
      height: Math.max(height, 1),
      preference: "webgpu", // WebGPU first, falls back to WebGL automatically
      antialias: false, // disable for performance; enable per scene if needed
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      backgroundColor: 0x0e0e12,
    });

    this._app = app;

    // Log which renderer activated (REQ-CNV-001)
    this._rendererType = app.renderer.type === 2 ? "WebGPU" : "WebGL";
    console.info(`[FusionCanvas] Renderer: ${this._rendererType}`);

    // Mount canvas to container
    this._container.appendChild(app.canvas);
    Object.assign(app.canvas.style, {
      display: "block",
      width: "100%",
      height: "100%",
      position: "absolute",
      top: "0",
      left: "0",
    });

    this._buildHierarchy();
    this._setupResize();
    this._setupInputEvents();
    this._setupTicker();
  }

  /**
   * Clean up all resources (PIXI, observers, event listeners).
   * Safe to call multiple times.
   * Important for Vite HMR — prevents leaks.
   */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    // Remove input events
    this._container.removeEventListener("wheel", this._onWheel);
    this._container.removeEventListener("pointerdown", this._onPointerDown);
    this._container.removeEventListener("pointermove", this._onPointerMove);
    this._container.removeEventListener("pointerup", this._onPointerUp);
    this._container.removeEventListener("pointercancel", this._onPointerUp);
    this._container.removeEventListener("contextmenu", this._onContextMenu);
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);

    // Resize observer
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;

    // Stop ticker
    this._app?.ticker.stop();

    // Destroy PIXI app (destroys stage, renderer, etc.)
    this._app?.destroy(true, { children: true });
    this._app = null;
  }

  // ---------------------------------------------------------------------------
  // Ticker API (public — avoids callers accessing private _app via bracket-hack)
  // ---------------------------------------------------------------------------

  /**
   * Add a per-frame callback to the PIXI ticker.
   * Returns a disposer function that removes the callback when called.
   *
   * REQ-CNV: callers (e.g. SceneOrchestrator wiring in TableScreen) must call
   * the disposer on teardown to prevent callbacks from accumulating across
   * scene switches.
   */
  addTicker(cb: (ticker: { deltaMS: number }) => void): () => void {
    if (!this._app) {
      return () => {
        /* no-op — canvas not yet initialised */
      };
    }
    this._app.ticker.add(cb);
    return () => {
      this._app?.ticker.remove(cb);
    };
  }

  // ---------------------------------------------------------------------------
  // Grid
  // ---------------------------------------------------------------------------

  /**
   * Set the grid render config. Pass null to hide the grid.
   * REQ-CNV-024: grid rendered with configurable color/alpha.
   */
  setGrid(config: GridRenderConfig | null): void {
    this._currentGridConfig = config;
    this._gridRenderer?.update(config);
  }

  /**
   * Set the grid geometry used to answer "which cell is this pixel in?".
   * Pass null when no scene is active.
   *
   * Separate from setGrid() on purpose: GridRenderConfig is what the renderer
   * needs to DRAW (color, alpha, canvas extent), GridStrategy is what callers
   * need to MEASURE. Only the latter knows the grid type.
   */
  setGridStrategy(strategy: GridStrategy | null): void {
    this._gridStrategy = strategy;
  }

  /** The active scene's grid geometry, or null when no scene is loaded. */
  get gridStrategy(): GridStrategy | null {
    return this._gridStrategy;
  }

  /**
   * The DOM element the renderer is mounted in.
   *
   * Exposed so interaction modules (ruler, tools) can attach pointer listeners
   * and measure the viewport without reaching into private state.
   */
  get viewElement(): HTMLElement {
    return this._container;
  }

  /**
   * The PIXI stage's eventMode, for diagnostics.
   *
   * Every layer this class builds is created with eventMode "none" — panning
   * and zooming are DOM-level, so the app never needed PIXI hit testing until
   * token dragging arrived. When a consumer opts a layer back into "static",
   * whether events actually reach it depends on the stage, and reading that
   * from the outside otherwise means poking at private state.
   */
  get stageEventMode(): string | null {
    return this._app?.stage.eventMode ?? null;
  }

  // ---------------------------------------------------------------------------
  // Layer access
  // ---------------------------------------------------------------------------

  /**
   * Return a named layer container.
   * REQ-CNV-002/003: typed layer access.
   */
  getLayer(name: LayerName): Container {
    const layer = this._layers.get(name);
    if (!layer) throw new Error(`[FusionCanvas] Layer "${name}" not found`);
    return layer;
  }

  // ---------------------------------------------------------------------------
  // Camera API
  // ---------------------------------------------------------------------------

  /** Current camera state. */
  get camera(): CameraState {
    return this._camera;
  }

  /** Zoom limits. */
  get zoomLimits(): ZoomLimits {
    return this._zoomLimits;
  }

  set zoomLimits(limits: ZoomLimits) {
    this._zoomLimits = limits;
  }

  /**
   * Instantly pan to a world position (center viewport on that point).
   * REQ-CNV-008.
   */
  panTo(worldX: number, worldY: number, scale?: number): void {
    const { width, height } = this._getViewSize();
    const s = scale ?? this._camera.scale;
    this._setCamera(centerOn(worldX, worldY, width, height, s, this._zoomLimits));
  }

  /**
   * Animate the camera to a target view.
   * REQ-CNV-008.
   */
  zoomTo(target: { x: number; y: number; scale: number }, durationMs = 400): void {
    const { width, height } = this._getViewSize();
    const to = centerOn(target.x, target.y, width, height, target.scale, this._zoomLimits);
    this._animTarget = {
      from: { ...this._camera },
      to,
      durationMs,
      elapsed: 0,
    };
  }

  /**
   * Fit the entire scene in the viewport.
   */
  fitToScene(sceneW: number, sceneH: number, durationMs = 400): void {
    const { width, height } = this._getViewSize();
    const to = fitScene(sceneW, sceneH, width, height, this._zoomLimits);
    if (durationMs <= 0) {
      this._setCamera(to);
    } else {
      this._animTarget = { from: { ...this._camera }, to, durationMs, elapsed: 0 };
    }
  }

  // ---------------------------------------------------------------------------
  // Debug overlay
  // ---------------------------------------------------------------------------

  /** Toggle the F9 debug overlay. */
  toggleDebug(): void {
    this._debugVisible = !this._debugVisible;
    if (this._debugText) {
      this._debugText.visible = this._debugVisible;
    }
  }

  get debugVisible(): boolean {
    return this._debugVisible;
  }

  // ---------------------------------------------------------------------------
  // Private — Hierarchy
  // ---------------------------------------------------------------------------

  private _buildHierarchy(): void {
    const app = this._app;
    if (!app) return;
    const stage = app.stage;

    // World container holds the camera transform (Primary + Effects + Interface).
    // REQ-CNV-006 originally wrapped these in a PIXI render group (isRenderGroup)
    // for camera-transform batching. BUG (r8): PIXI v8.19's WebGPU backend does
    // not paint a render group's contents — confirmed live against a real world
    // (background, tokens and grid were all invisible, the canvas showed only the
    // clear color; disabling the render group made them render immediately). Kept
    // as a plain Container so the scene renders on both WebGPU and WebGL.
    // TODO(perf): re-enable the render group once the PIXI WebGPU bug is fixed or
    // PIXI is upgraded past the broken version.
    const world = new Container();
    this._worldContainer = world;
    stage.addChild(world);

    // --- Primary group (REQ-CNV-003) ---
    // Physical scene content: background, tiles, drawings, tokens, overhead
    const primaryGroup = new Container();
    primaryGroup.label = "group:primary";
    world.addChild(primaryGroup);

    const primaryLayers: LayerName[] = ["background", "tiles", "drawings", "tokens", "overhead"];
    for (const name of primaryLayers) {
      const layer = new Container();
      layer.label = `layer:${name}`;
      layer.eventMode = "none";
      primaryGroup.addChild(layer);
      this._layers.set(name, layer);
    }

    // --- Effects group (REQ-CNV-004) ---
    // Weather, lighting, vision, fog — renders above PrimaryGroup
    const effectsGroup = new Container();
    effectsGroup.label = "group:effects";
    world.addChild(effectsGroup);

    const effectsLayers: LayerName[] = ["weather", "lighting"];
    for (const name of effectsLayers) {
      const layer = new Container();
      layer.label = `layer:${name}`;
      layer.eventMode = "none";
      effectsGroup.addChild(layer);
      this._layers.set(name, layer);
    }

    // --- Interface group (REQ-CNV-004) ---
    // Interactive canvas overlays: templates, notes, walls (GM), grid, controls
    // Renders above EffectsGroup.
    // Render order (insertion order = draw order): templates → grid → controls
    // Spec: 06-canvas-e-renderizacao.md §line 511 / layers.ts LAYER_ORDER comment.
    const interfaceGroup = new Container();
    interfaceGroup.label = "group:interface";
    world.addChild(interfaceGroup);

    // 1. templates layer (z=0)
    const templatesLayer = new Container();
    templatesLayer.label = "layer:templates";
    templatesLayer.eventMode = "none";
    interfaceGroup.addChild(templatesLayer);
    this._layers.set("templates", templatesLayer);

    // 2. grid renderer (z=10) — between templates and controls
    this._gridRenderer = new GridRenderer();
    interfaceGroup.addChild(this._gridRenderer.graphics);

    // 3. controls layer (z=20)
    const controlsLayer = new Container();
    controlsLayer.label = "layer:controls";
    controlsLayer.eventMode = "none";
    interfaceGroup.addChild(controlsLayer);
    this._layers.set("controls", controlsLayer);

    // --- Overlay group — OUTSIDE the world render group (does NOT follow camera) ---
    // REQ-CNV-005: OverlayGroup does not inherit camera transform
    const overlay = new Container();
    overlay.label = "group:overlay";
    this._overlayContainer = overlay;
    stage.addChild(overlay);

    // Debug text in overlay (so it stays fixed on screen)
    this._buildDebugOverlay();
  }

  private _buildDebugOverlay(): void {
    const style = new TextStyle({
      fontFamily: "ui-monospace, monospace",
      fontSize: 12,
      fill: 0x00ff88,
      stroke: { color: 0x000000, width: 3 },
    });

    const text = new Text({ text: "", style });
    text.x = 8;
    text.y = 8;
    text.visible = this._debugVisible;
    text.eventMode = "none";
    text.label = "debug:overlay";

    this._debugText = text;
    this._overlayContainer?.addChild(text);
  }

  // ---------------------------------------------------------------------------
  // Private — Resize
  // ---------------------------------------------------------------------------

  private _setupResize(): void {
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          this._app?.renderer.resize(width, height);
        }
      }
    });
    ro.observe(this._container);
    this._resizeObserver = ro;
  }

  // ---------------------------------------------------------------------------
  // Private — Input Events
  // ---------------------------------------------------------------------------

  private _setupInputEvents(): void {
    const el = this._container;
    el.addEventListener("wheel", this._onWheel, { passive: false });
    el.addEventListener("pointerdown", this._onPointerDown);
    el.addEventListener("pointermove", this._onPointerMove);
    el.addEventListener("pointerup", this._onPointerUp);
    el.addEventListener("pointercancel", this._onPointerUp);
    el.addEventListener("contextmenu", this._onContextMenu);
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
  }

  private _handleWheel(e: WheelEvent): void {
    e.preventDefault();
    if (!this._app) return;

    const rect = this._container.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // deltaY > 0 = scroll down = zoom out.
    // Use Math.exp for a multiplicatively symmetric factor that is always positive
    // (avoids factor ≤ 0 for large deltaY before clampScale absorbs it).
    const factor = Math.exp(-e.deltaY * ZOOM_FACTOR_WHEEL);
    this._cancelAnim();
    this._setCamera(zoomAtPoint(this._camera, factor, sx, sy, this._zoomLimits));
  }

  private _handlePointerDown(e: PointerEvent): void {
    // Middle-button pan (button 1) or Space+drag (any button)
    if (e.button === 1 || (e.button === 0 && this._isSpaceDown)) {
      this._isPanning = true;
      this._panStart = {
        sx: e.clientX,
        sy: e.clientY,
        tx: this._camera.tx,
        ty: this._camera.ty,
      };
      this._container.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }

  private _handlePointerMove(e: PointerEvent): void {
    // Update cursor world position for debug overlay
    const rect = this._container.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    this._cursorWorld = screenToWorld(sx, sy, this._camera);

    if (this._isPanning && this._panStart) {
      const dx = e.clientX - this._panStart.sx;
      const dy = e.clientY - this._panStart.sy;
      this._cancelAnim();
      this._setCamera({
        tx: this._panStart.tx + dx,
        ty: this._panStart.ty + dy,
        scale: this._camera.scale,
      });
    }
  }

  private _handlePointerUp(e: PointerEvent): void {
    if (this._isPanning) {
      this._isPanning = false;
      this._panStart = null;
      try {
        this._container.releasePointerCapture(e.pointerId);
      } catch {
        // ignore if already released
      }
    }
  }

  private _handleKeyDown(e: KeyboardEvent): void {
    if (e.code === "Space" && !e.repeat) {
      this._isSpaceDown = true;
      // Show grab cursor
      this._container.style.cursor = "grab";
    }

    // F9 — toggle debug overlay
    if (e.code === "F9") {
      this.toggleDebug();
      e.preventDefault();
    }
  }

  private _handleKeyUp(e: KeyboardEvent): void {
    if (e.code === "Space") {
      this._isSpaceDown = false;
      this._container.style.cursor = "";
      if (this._isPanning) {
        this._isPanning = false;
        this._panStart = null;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private — Camera
  // ---------------------------------------------------------------------------

  private _setCamera(state: CameraState): void {
    this._camera = state;
    this._applyCamera();
  }

  private _applyCamera(): void {
    if (!this._worldContainer) return;
    const { tx, ty, scale } = this._camera;
    this._worldContainer.position.set(tx, ty);
    this._worldContainer.scale.set(scale, scale);
  }

  private _cancelAnim(): void {
    this._animTarget = null;
  }

  // ---------------------------------------------------------------------------
  // Private — Ticker
  // ---------------------------------------------------------------------------

  private _setupTicker(): void {
    this._app?.ticker.add((ticker) => {
      const deltaMs = ticker.deltaMS;
      this._fps = ticker.FPS;

      // Animate camera
      if (this._animTarget) {
        this._animTarget.elapsed += deltaMs;
        const t = Math.min(1, this._animTarget.elapsed / this._animTarget.durationMs);
        const eased = easeInOut(t);
        const state = lerpCamera(this._animTarget.from, this._animTarget.to, eased);
        this._camera = state;
        this._applyCamera();
        if (t >= 1) this._animTarget = null;
      }

      // Update debug overlay
      if (this._debugVisible && this._debugText) {
        this._updateDebugText();
      }
    });
  }

  private _updateDebugText(): void {
    if (!this._debugText) return;

    const { tx, ty, scale } = this._camera;
    const { x: wx, y: wy } = this._cursorWorld;

    // Cell under the cursor, asked of the scene's grid — not of a hardcoded
    // square formula. The overlay reads whatever geometry the scene declares.
    let cellStr = "–";
    if (this._gridStrategy) {
      const cell = this._gridStrategy.pixelToCell({ x: wx, y: wy });
      cellStr = `(${cell.i.toString()}, ${cell.j.toString()})`;
    }

    const lines = [
      `Renderer: ${this._rendererType}`,
      `FPS: ${this._fps.toFixed(1)}`,
      `Zoom: ${(scale * 100).toFixed(1)}%`,
      `Camera: (${tx.toFixed(0)}, ${ty.toFixed(0)})`,
      `Cursor world: (${wx.toFixed(0)}, ${wy.toFixed(0)})`,
      `Cell: ${cellStr}`,
      `[F9] Toggle debug`,
    ];

    this._debugText.text = lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // Private — Utilities
  // ---------------------------------------------------------------------------

  private _getViewSize(): { width: number; height: number } {
    const rect = this._container.getBoundingClientRect();
    return { width: rect.width || 1, height: rect.height || 1 };
  }
}
