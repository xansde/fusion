<script lang="ts">
  /**
   * GridCalibrationPanel.svelte — the Master's controls for calibrating a scene's grid.
   *
   * A battle map arrives as someone else's image with a grid already drawn into the
   * pixels. The Master drags a box over ONE printed cell; the grid that box implies is
   * previewed over the whole map while they adjust (handles, arrow keys, typed numbers),
   * and Confirm writes size, origin and look to the scene — every client sees it at once.
   *
   * The panel owns no geometry: attachGridCalibration handles the pointer and keys,
   * calibrateSquareGrid does the arithmetic (both tested on their own). What lives here
   * is the presentation and the save. Esc cancels, Enter confirms.
   */
  import { untrack } from "svelte";
  import type { Socket } from "socket.io-client";
  import { calibrateSquareGrid, MIN_CALIBRATION_SIZE, type SceneDocument } from "@fusion/shared";
  import type { FusionCanvas } from "../../lib/canvas/FusionCanvas.js";
  import {
    attachGridCalibration,
    type GridCalibrationHandle,
  } from "../../lib/canvas/attachGridCalibration.js";
  import {
    normalizeRect,
    rectFromGrid,
    squareUpRect,
    type Rect,
  } from "../../lib/canvas/gridCalibrationRect.js";
  import { effectiveGridSize, sceneContentOffset } from "../../lib/canvas/sceneCoords.js";
  import { updateGridCalibration } from "../../lib/scenes/sceneController.js";
  import type { FootprintResolver } from "../../lib/scenes/gridRecalibration.js";
  import { t } from "../../lib/i18n/index.js";

  const {
    canvas,
    scene,
    socket,
    onClose,
    footprintOf = () => ({ width: 1, height: 1 }),
  }: {
    canvas: FusionCanvas;
    scene: SceneDocument;
    socket: Socket | null;
    onClose: () => void;
    /** Size in cells of the token behind an actor (tokens keep their centre on the map). */
    footprintOf?: FootprintResolver;
  } = $props();

  // The scene is read once: the panel is aimed at THIS scene for as long as it is open,
  // and a mirror echo must not reset what the Master is in the middle of typing.
  const initial = untrack(() => scene);
  const corner = sceneContentOffset(initial);
  const origin = { x: corner.padX, y: corner.padY };
  const totalWidth = initial.width + corner.padX * 2;
  const totalHeight = initial.height + corner.padY * 2;
  const sceneId = initial._id;
  const startCell = effectiveGridSize(initial);

  /** How many cells the box covers. Spanning several divides the drag error. */
  let cols = $state(1);
  let rows = $state(1);
  let keepSquare = $state(true);

  // A scene saved without a grid block starts from the factory look (visible on most maps).
  const g = initial.grid as
    | { distance?: number; units?: string; color?: string; alpha?: number }
    | undefined;
  let distance = $state(g?.distance ?? 5);
  let units = $state(g?.units ?? "ft");
  let color = $state(g?.color ?? "#000000");
  let alpha = $state(g?.alpha ?? (g ? 0.2 : 0.4));

  // Replaced immediately: attachGridCalibration reports its starting box through
  // onChange as soon as it mounts.
  let rect = $state<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  let saving = $state(false);
  let error = $state<string | null>(null);

  const calibration = $derived(calibrateSquareGrid(rect, cols, rows, origin));
  /** Below ~0.97 the two sides disagree enough that the drag was probably sloppy. */
  const skewed = $derived(!keepSquare && calibration.ok && calibration.squareness < 0.97);
  const canApply = $derived(
    calibration.ok && !saving && Number.isFinite(distance) && distance > 0 && units.trim() !== "",
  );

  let tool: GridCalibrationHandle | null = null;

  function settle(next: Rect): void {
    if (!keepSquare) return;
    const squared = squareUpRect(next, cols, rows);
    const n = normalizeRect(next);
    if (squared.width !== n.width || squared.height !== n.height) tool?.setRect(squared);
  }

  $effect(() => {
    tool = attachGridCalibration({
      canvas,
      layer: canvas.getLayer("controls"),
      cellPx: startCell,
      onChange: (next) => {
        rect = next;
      },
      // Read through the live cols/rows: a box too small for one cell may be valid for four.
      isValid: (candidate) => calibrateSquareGrid(candidate, cols, rows, origin).ok,
      getPreview: (candidate) => {
        const c = calibrateSquareGrid(candidate, cols, rows, origin);
        if (!c.ok) return null;
        const r = normalizeRect(candidate);
        return { size: c.size, originX: r.x, originY: r.y, width: totalWidth, height: totalHeight };
      },
      onSettle: settle,
      onCancel: onClose,
      onConfirm: () => {
        void apply();
      },
    });

    return () => {
      tool?.dispose();
      tool = null;
    };
  });

  // Cells across/down and the keep-square switch change what the box means.
  $effect(() => {
    void cols;
    void rows;
    if (keepSquare) {
      const current = untrack(() => tool?.getRect());
      if (current) settle(current);
    }
    tool?.invalidate();
  });

  function num(e: Event): number {
    return Number((e.currentTarget as HTMLInputElement).value);
  }

  function onSize(e: Event): void {
    const size = Math.round(num(e));
    if (!Number.isFinite(size) || size <= 0) return;
    tool?.setRect(
      rectFromGrid(size, { x: calibration.offsetX, y: calibration.offsetY }, origin, rect, cols, rows),
    );
  }

  function onOffset(axis: "x" | "y", e: Event): void {
    const v = num(e);
    if (!Number.isFinite(v)) return;
    const size = calibration.size > 0 ? calibration.size : startCell;
    const off = axis === "x" ? { x: v, y: calibration.offsetY } : { x: calibration.offsetX, y: v };
    tool?.setRect(rectFromGrid(size, off, origin, rect, cols, rows));
  }

  async function apply(): Promise<void> {
    if (!canApply) return;
    error = null;

    if (!socket) {
      error = t("FUSION.Scene.Calibrate.NoConnection");
      return;
    }

    saving = true;
    try {
      // `scene` (not `initial`): tokens may have moved while the panel was open.
      await updateGridCalibration(
        socket,
        sceneId,
        {
          size: calibration.size,
          offsetX: calibration.offsetX,
          offsetY: calibration.offsetY,
          distance,
          units: units.trim(),
          color,
          alpha,
        },
        { scene, footprintOf },
      );
      onClose();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }
</script>

<div class="calibration" role="dialog" aria-label={t("FUSION.Scene.Calibrate.Title")}>
  <h2 class="calibration__title">{t("FUSION.Scene.Calibrate.Title")}</h2>
  <p class="calibration__hint">{t("FUSION.Scene.Calibrate.Hint")}</p>

  <div class="calibration__cells">
    <label class="calibration__field">
      <span>{t("FUSION.Scene.Calibrate.Columns")}</span>
      <input type="number" min="1" max="50" step="1" bind:value={cols} />
    </label>
    <span class="calibration__times" aria-hidden="true">×</span>
    <label class="calibration__field">
      <span>{t("FUSION.Scene.Calibrate.Rows")}</span>
      <input type="number" min="1" max="50" step="1" bind:value={rows} />
    </label>
  </div>

  <label class="calibration__check">
    <input type="checkbox" bind:checked={keepSquare} />
    <span>{t("FUSION.Scene.Calibrate.KeepSquare")}</span>
  </label>

  <div class="calibration__grid">
    <label class="calibration__field">
      <span>{t("FUSION.Scene.Calibrate.Size")}</span>
      <input
        type="number"
        min={MIN_CALIBRATION_SIZE}
        step="1"
        aria-label={t("FUSION.Scene.Calibrate.Size")}
        value={Math.round(calibration.size)}
        onchange={onSize}
      />
    </label>
    <label class="calibration__field">
      <span>{t("FUSION.Scene.Calibrate.OffsetX")}</span>
      <input
        type="number"
        step="1"
        aria-label={t("FUSION.Scene.Calibrate.OffsetX")}
        value={Math.round(calibration.offsetX)}
        onchange={(e) => {
          onOffset("x", e);
        }}
      />
    </label>
    <label class="calibration__field">
      <span>{t("FUSION.Scene.Calibrate.OffsetY")}</span>
      <input
        type="number"
        step="1"
        aria-label={t("FUSION.Scene.Calibrate.OffsetY")}
        value={Math.round(calibration.offsetY)}
        onchange={(e) => {
          onOffset("y", e);
        }}
      />
    </label>
  </div>

  {#if !calibration.ok}
    <div class="calibration__readout" aria-live="polite">
      <span class="calibration__invalid">
        {t("FUSION.Scene.Calibrate.TooSmall")} ({MIN_CALIBRATION_SIZE} px)
      </span>
    </div>
  {/if}

  {#if skewed}
    <p class="calibration__warn">{t("FUSION.Scene.Calibrate.NotSquare")}</p>
  {/if}

  <div class="calibration__grid">
    <label class="calibration__field">
      <span>{t("FUSION.Scene.Calibrate.Distance")}</span>
      <input type="number" min="0.5" step="0.5" bind:value={distance} />
    </label>
    <label class="calibration__field">
      <span>{t("FUSION.Scene.Calibrate.Units")}</span>
      <input type="text" maxlength="8" bind:value={units} />
    </label>
    <label class="calibration__field">
      <span>{t("FUSION.Scene.Calibrate.Color")}</span>
      <input type="color" bind:value={color} />
    </label>
  </div>
  <label class="calibration__field">
    <span>{t("FUSION.Scene.Calibrate.Alpha")}: {Math.round(alpha * 100)}%</span>
    <input type="range" min="0" max="1" step="0.05" bind:value={alpha} />
  </label>

  {#if error}
    <p class="calibration__error">{error}</p>
  {/if}

  <div class="calibration__actions">
    <button type="button" class="btn btn--ghost btn--sm" onclick={onClose} disabled={saving}>
      {t("FUSION.Scene.Calibrate.Cancel")}
    </button>
    <button
      type="button"
      class="btn btn--primary btn--sm"
      onclick={() => {
        void apply();
      }}
      disabled={!canApply}
    >
      {saving ? t("FUSION.Scene.Calibrate.Applying") : t("FUSION.Scene.Calibrate.Apply")}
    </button>
  </div>
</div>

<style>
  .calibration {
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    box-shadow: var(--fusion-shadow-popover);
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    left: 0.75rem;
    padding: 0.8rem 0.9rem;
    position: absolute;
    top: calc(var(--fusion-header-height) + 0.75rem + var(--fusion-target) + 0.5rem);
    width: min(20rem, calc(100vw - 1.5rem));
    z-index: 95;
  }

  .calibration__title {
    color: var(--fusion-text);
    font-size: var(--fusion-text-base);
    font-weight: 600;
    margin: 0;
  }

  .calibration__hint {
    color: var(--fusion-text-muted);
    font-size: var(--fusion-text-xs);
    line-height: 1.35;
    margin: 0;
  }

  .calibration__cells {
    align-items: flex-end;
    display: flex;
    gap: 0.5rem;
  }

  .calibration__grid {
    display: grid;
    gap: 0.5rem;
    grid-template-columns: repeat(3, 1fr);
  }

  .calibration__field {
    display: flex;
    flex-direction: column;
    font-size: var(--fusion-text-xs);
    gap: 0.2rem;
    min-width: 0;
  }

  .calibration__field span {
    color: var(--fusion-text-muted);
  }

  .calibration__field input[type="number"],
  .calibration__field input[type="text"] {
    background: var(--fusion-bg);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: var(--fusion-text-sm);
    min-height: var(--fusion-target);
    padding: 0.3rem 0.5rem;
    width: 100%;
  }

  .calibration__field input[type="color"] {
    background: transparent;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    height: var(--fusion-target);
    padding: 0;
    width: 100%;
  }

  .calibration__check {
    align-items: center;
    color: var(--fusion-text);
    display: flex;
    font-size: var(--fusion-text-xs);
    gap: 0.4rem;
  }

  .calibration__times {
    color: var(--fusion-text-muted);
    padding-bottom: 0.6rem;
  }

  .calibration__readout {
    align-items: baseline;
    display: flex;
    gap: 0.6rem;
  }

  .calibration__invalid {
    color: var(--fusion-danger);
    font-size: var(--fusion-text-xs);
  }

  .calibration__warn {
    color: var(--fusion-warning);
    font-size: var(--fusion-text-xs);
    margin: 0;
  }

  .calibration__error {
    color: var(--fusion-danger);
    font-size: var(--fusion-text-xs);
    margin: 0;
  }

  .calibration__actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }

  /* Buttons (inline — avoids deep import of global .btn) */
  .btn {
    min-height: var(--fusion-target);
    align-items: center;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    display: inline-flex;
    font-family: var(--fusion-font);
    font-size: var(--fusion-text-sm);
    font-weight: 500;
    justify-content: center;
    padding: 0.45rem 1rem;
    transition:
      background-color var(--fusion-transition),
      opacity var(--fusion-transition);
    white-space: nowrap;
  }

  .btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .btn:focus-visible {
    outline: 2px solid var(--fusion-focus);
    outline-offset: 2px;
  }

  .btn--primary {
    background: var(--fusion-accent);
    color: var(--fusion-on-accent);
  }

  .btn--primary:hover:not(:disabled) {
    background: var(--fusion-accent-hover);
  }

  .btn--ghost {
    background: transparent;
    border-color: var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .btn--ghost:hover:not(:disabled) {
    border-color: var(--fusion-text-muted);
    color: var(--fusion-text);
  }

  .btn--sm {
    padding: 0.3rem 0.75rem;
  }
</style>
