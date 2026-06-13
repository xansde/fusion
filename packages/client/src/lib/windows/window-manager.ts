/**
 * window-manager.ts — Fusion Window Manager (pure logic, no DOM/Svelte deps).
 *
 * Implements REQ-UIF-009..016 from spec 11-ui-framework-e-fichas.md.
 *
 * Responsibilities:
 *  - Registry of open windows (id → WindowEntry)
 *  - Z-order management: focus brings a window to the top
 *  - Open / close / minimize / restore
 *  - Move / resize with clamp to viewport
 *  - Cascade for new windows without saved position
 *  - Persistence of geometry + minimized state per window-id via localStorage
 *    (client-side UI preferences — DEC-UIF-10; NEVER tokens/credentials)
 *
 * All state is held in plain reactive $state runes so WindowHost.svelte can
 * iterate the registry. The module exports a singleton `windowManager`.
 */

// ---------------------------------------------------------------------------
// Types (re-exported so callers import from this module)
// ---------------------------------------------------------------------------

export type WindowId = string;

export interface WindowGeometry {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface WindowEntry {
  readonly id: WindowId;
  /** Singleton key — if set, only one window per key is allowed (REQ-UIF-014). */
  readonly singletonKey: string | undefined;
  title: string;
  icon?: string | undefined;
  resizable: boolean;
  minimizable: boolean;
  minWidth: number;
  minHeight: number;
  top: number;
  left: number;
  width: number;
  height: number;
  minimized: boolean;
  zIndex: number;
}

export interface WindowOpenOptions {
  id?: WindowId;
  singletonKey?: string;
  title: string;
  icon?: string;
  resizable?: boolean;
  minimizable?: boolean;
  minWidth?: number;
  minHeight?: number;
  /** Initial position/size; if omitted and no saved geometry, cascade is used. */
  position?: Partial<WindowGeometry>;
}

export interface WindowHandle {
  readonly id: WindowId;
  bringToFront(): void;
  minimize(): void;
  restore(): void;
  setPosition(p: Partial<WindowGeometry>): void;
  close(): void;
}

export interface ViewportSize {
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "fusion:windowGeometry";
const DEFAULT_WIDTH = 520;
const DEFAULT_HEIGHT = 360;
const DEFAULT_MIN_WIDTH = 200;
const DEFAULT_MIN_HEIGHT = 100;
const CASCADE_OFFSET = 30; // px shift per cascade step
const CASCADE_MAX_STEPS = 12;
const KEEP_IN_VIEWPORT_MARGIN = 40; // px of header that must remain visible

// ---------------------------------------------------------------------------
// Persistence helpers (localStorage — UI geometry only, DEC-UIF-10)
// ---------------------------------------------------------------------------

type PersistedGeometry = Pick<WindowEntry, "top" | "left" | "width" | "height" | "minimized">;
type GeometryStore = Record<string, PersistedGeometry>;

function loadGeometryStore(): GeometryStore {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return {};
    return JSON.parse(raw) as GeometryStore;
  } catch {
    return {};
  }
}

function saveGeometryStore(store: GeometryStore): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    }
  } catch {
    // Swallow quota errors — geometry loss is acceptable.
  }
}

function loadGeometry(key: string): PersistedGeometry | undefined {
  return loadGeometryStore()[key];
}

function persistGeometry(key: string, geo: PersistedGeometry): void {
  const store = loadGeometryStore();
  store[key] = geo;
  saveGeometryStore(store);
}

// ---------------------------------------------------------------------------
// Clamp helpers
// ---------------------------------------------------------------------------

/**
 * Clamp a window's position so that at least `margin` px of its header
 * (top edge) remains within the viewport. Width/height are clamped to fit
 * within the viewport too, respecting minimum sizes.
 */
export function clampToViewport(
  geo: WindowGeometry,
  viewport: ViewportSize,
  margin = KEEP_IN_VIEWPORT_MARGIN,
  minWidth = DEFAULT_MIN_WIDTH,
  minHeight = DEFAULT_MIN_HEIGHT,
): WindowGeometry {
  const w = Math.max(minWidth, Math.min(geo.width, viewport.width));
  const h = Math.max(minHeight, Math.min(geo.height, viewport.height));

  // left: must not push the entire window past the right edge
  const left = Math.max(-(w - margin), Math.min(geo.left, viewport.width - margin));
  // top: must not push the header above 0 or below the bottom
  const top = Math.max(0, Math.min(geo.top, viewport.height - margin));

  return { top, left, width: w, height: h };
}

// ---------------------------------------------------------------------------
// Cascade helper
// ---------------------------------------------------------------------------

/**
 * Compute the next cascade position given the current open windows.
 * Steps through CASCADE_OFFSET increments and wraps after CASCADE_MAX_STEPS.
 */
export function cascadePosition(
  openWindows: ReadonlyMap<WindowId, WindowEntry>,
  viewport: ViewportSize,
  defaultWidth = DEFAULT_WIDTH,
  defaultHeight = DEFAULT_HEIGHT,
): WindowGeometry {
  const count = openWindows.size % CASCADE_MAX_STEPS;
  const base = 80;
  return {
    top: base + count * CASCADE_OFFSET,
    left: base + count * CASCADE_OFFSET,
    width: Math.min(defaultWidth, viewport.width - 40),
    height: Math.min(defaultHeight, viewport.height - 40),
  };
}

// ---------------------------------------------------------------------------
// ID generator
// ---------------------------------------------------------------------------

let _idCounter = 0;

function nextId(): WindowId {
  _idCounter += 1;
  return `win-${String(_idCounter)}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// WindowManager class (singleton instance exported below)
// ---------------------------------------------------------------------------

/**
 * Pure window manager. Holds state as plain objects so Svelte 5 $state runes
 * in WindowHost can subscribe reactively.
 *
 * Intentionally free of Svelte imports so logic is fully testable in Vitest
 * without a DOM/browser environment.
 */
export class WindowManager {
  /**
   * Mutable map of open windows. Svelte components should wrap this in
   * `$state` — see WindowHost.svelte.
   */
  readonly windows: Map<WindowId, WindowEntry> = new Map();

  activeWindowId: WindowId | null = null;

  private _highestZ = 100;

  /** Current viewport size (updated by WindowHost on resize). */
  viewport: ViewportSize = { width: 1280, height: 800 };

  // -------------------------------------------------------------------------
  // open
  // -------------------------------------------------------------------------

  /**
   * Open a new window (or focus existing singleton).
   * Returns a handle to control the window.
   */
  open(opts: WindowOpenOptions): WindowHandle {
    // Singleton check (REQ-UIF-014)
    if (opts.singletonKey) {
      for (const entry of this.windows.values()) {
        if (entry.singletonKey === opts.singletonKey) {
          this.focus(entry.id);
          return this._makeHandle(entry.id);
        }
      }
    }

    const id = opts.id ?? nextId();
    const persistKey = opts.singletonKey ?? id;

    // Resolve geometry: saved → provided → cascade
    const saved = loadGeometry(persistKey);
    let geo: WindowGeometry;

    if (saved) {
      geo = {
        top: saved.top,
        left: saved.left,
        width: saved.width,
        height: saved.height,
      };
    } else if (opts.position) {
      geo = {
        top: opts.position.top ?? 80,
        left: opts.position.left ?? 80,
        width: opts.position.width ?? DEFAULT_WIDTH,
        height: opts.position.height ?? DEFAULT_HEIGHT,
      };
    } else {
      geo = cascadePosition(this.windows, this.viewport);
    }

    // Clamp in case saved position is off-screen on a different viewport
    geo = clampToViewport(
      geo,
      this.viewport,
      KEEP_IN_VIEWPORT_MARGIN,
      opts.minWidth ?? DEFAULT_MIN_WIDTH,
      opts.minHeight ?? DEFAULT_MIN_HEIGHT,
    );

    this._highestZ += 1;

    const entry: WindowEntry = {
      id,
      singletonKey: opts.singletonKey,
      title: opts.title,
      icon: opts.icon,
      resizable: opts.resizable ?? true,
      minimizable: opts.minimizable ?? true,
      minWidth: opts.minWidth ?? DEFAULT_MIN_WIDTH,
      minHeight: opts.minHeight ?? DEFAULT_MIN_HEIGHT,
      top: geo.top,
      left: geo.left,
      width: geo.width,
      height: geo.height,
      minimized: saved?.minimized ?? false,
      zIndex: this._highestZ,
    };

    this.windows.set(id, entry);
    this.activeWindowId = id;

    return this._makeHandle(id);
  }

  // -------------------------------------------------------------------------
  // focus
  // -------------------------------------------------------------------------

  /** Bring window to front and mark as active. */
  focus(id: WindowId): void {
    const entry = this.windows.get(id);
    if (!entry) return;

    this._highestZ += 1;
    entry.zIndex = this._highestZ;
    this.activeWindowId = id;
  }

  // -------------------------------------------------------------------------
  // minimize / restore
  // -------------------------------------------------------------------------

  minimize(id: WindowId): void {
    const entry = this.windows.get(id);
    if (!entry || !entry.minimizable) return;
    entry.minimized = true;
    this._persist(entry);
  }

  restore(id: WindowId): void {
    const entry = this.windows.get(id);
    if (!entry) return;
    entry.minimized = false;
    this._persist(entry);
    this.focus(id);
  }

  // -------------------------------------------------------------------------
  // setPosition (move / resize)
  // -------------------------------------------------------------------------

  /**
   * Update position/size of a window, clamped to viewport.
   * Partial update — only the provided keys are changed.
   */
  setPosition(id: WindowId, p: Partial<WindowGeometry>): void {
    const entry = this.windows.get(id);
    if (!entry) return;

    const next = clampToViewport(
      {
        top: p.top ?? entry.top,
        left: p.left ?? entry.left,
        width: p.width ?? entry.width,
        height: p.height ?? entry.height,
      },
      this.viewport,
      KEEP_IN_VIEWPORT_MARGIN,
      entry.minWidth,
      entry.minHeight,
    );

    entry.top = next.top;
    entry.left = next.left;
    entry.width = next.width;
    entry.height = next.height;

    this._persist(entry);
  }

  // -------------------------------------------------------------------------
  // close
  // -------------------------------------------------------------------------

  close(id: WindowId): void {
    const entry = this.windows.get(id);
    if (!entry) return;
    this._persist(entry); // save final geometry before removing
    this.windows.delete(id);

    if (this.activeWindowId === id) {
      // Activate the window with the next highest z-index
      let nextId: WindowId | null = null;
      let nextZ = -Infinity;
      for (const [wid, w] of this.windows) {
        if (w.zIndex > nextZ) {
          nextZ = w.zIndex;
          nextId = wid;
        }
      }
      this.activeWindowId = nextId;
    }
  }

  closeAll(): void {
    for (const id of [...this.windows.keys()]) {
      this.close(id);
    }
  }

  // -------------------------------------------------------------------------
  // get handle
  // -------------------------------------------------------------------------

  get(id: WindowId): WindowHandle | undefined {
    if (!this.windows.has(id)) return undefined;
    return this._makeHandle(id);
  }

  // -------------------------------------------------------------------------
  // viewport update
  // -------------------------------------------------------------------------

  /**
   * Call when the browser viewport changes. Re-clamps all open windows.
   */
  onViewportResize(viewport: ViewportSize): void {
    this.viewport = viewport;
    for (const entry of this.windows.values()) {
      const clamped = clampToViewport(
        { top: entry.top, left: entry.left, width: entry.width, height: entry.height },
        viewport,
        KEEP_IN_VIEWPORT_MARGIN,
        entry.minWidth,
        entry.minHeight,
      );
      entry.top = clamped.top;
      entry.left = clamped.left;
      entry.width = clamped.width;
      entry.height = clamped.height;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _persist(entry: WindowEntry): void {
    const key = entry.singletonKey ?? entry.id;
    persistGeometry(key, {
      top: entry.top,
      left: entry.left,
      width: entry.width,
      height: entry.height,
      minimized: entry.minimized,
    });
  }

  private _makeHandle(id: WindowId): WindowHandle {
    return {
      id,
      bringToFront: () => {
        this.focus(id);
      },
      minimize: () => {
        this.minimize(id);
      },
      restore: () => {
        this.restore(id);
      },
      setPosition: (p) => {
        this.setPosition(id, p);
      },
      close: () => {
        this.close(id);
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const windowManager = new WindowManager();
