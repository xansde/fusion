<script lang="ts">
  /**
   * GridCalibrationPanel.svelte — the GM's controls for calibrating the grid.
   *
   * A battle map arrives as someone else's image with a grid already drawn
   * into the pixels. This panel drives the box the GM drags over one of those
   * printed cells, shows the numbers it implies, and writes them to the scene.
   *
   * The panel owns no geometry: attachGridCalibration handles the pointer and
   * calibrateSquareGrid does the arithmetic, both tested on their own. What
   * lives here is the presentation and the save.
   */

  import type { Socket } from "socket.io-client";
  import { calibrateSquareGrid, MIN_CALIBRATION_SIZE } from "@fusion/shared";
  import type { FusionCanvas } from "../../lib/canvas/FusionCanvas.js";
  import {
    attachGridCalibration,
    type GridCalibrationHandle,
  } from "../../lib/canvas/attachGridCalibration.js";
  import type { Rect } from "../../lib/canvas/gridCalibrationRect.js";
  import { updateGridCalibration } from "../../lib/scenes/sceneController.js";
  import { t } from "../../lib/i18n/index.js";

  const {
    canvas,
    sceneId,
    cellPx,
    socket,
    onClose,
  }: {
    canvas: FusionCanvas;
    sceneId: string;
    cellPx: number;
    socket: Socket | null;
    onClose: () => void;
  } = $props();

  /** How many cells the box covers. Spanning several divides the drag error. */
  let cols = $state(1);
  let rows = $state(1);

  // Replaced immediately: attachGridCalibration reports its starting box
  // through onChange as soon as it mounts.
  let rect = $state<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  let saving = $state(false);
  let error = $state<string | null>(null);

  const calibration = $derived(calibrateSquareGrid(rect, cols, rows));
  /** Below ~0.97 the two sides disagree enough that the drag was probably sloppy. */
  const skewed = $derived(calibration.ok && calibration.squareness < 0.97);

  let tool: GridCalibrationHandle | null = null;

  $effect(() => {
    tool = attachGridCalibration({
      canvas,
      layer: canvas.getLayer("controls"),
      cellPx,
      onChange: (next) => {
        rect = next;
      },
      // Read through the live cols/rows: a box that is too small for one cell
      // may be perfectly valid for four.
      isValid: (candidate) => calibrateSquareGrid(candidate, cols, rows).ok,
    });

    return () => {
      tool?.dispose();
      tool = null;
    };
  });

  async function apply(): Promise<void> {
    if (!calibration.ok || saving) return;
    error = null;

    if (!socket) {
      error = t("FUSION.Scene.Calibrate.NoConnection");
      return;
    }

    saving = true;
    try {
      await updateGridCalibration(socket, sceneId, {
        size: calibration.size,
        offsetX: calibration.offsetX,
        offsetY: calibration.offsetY,
      });
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
      <input type="number" min="1" max="50" bind:value={cols} />
    </label>
    <span class="calibration__times" aria-hidden="true">×</span>
    <label class="calibration__field">
      <span>{t("FUSION.Scene.Calibrate.Rows")}</span>
      <input type="number" min="1" max="50" bind:value={rows} />
    </label>
  </div>

  <div class="calibration__readout" aria-live="polite">
    {#if calibration.ok}
      <strong>{calibration.size} px</strong>
      <span class="calibration__origin">
        {t("FUSION.Scene.Calibrate.Origin")}
        {Math.round(calibration.offsetX)}, {Math.round(calibration.offsetY)}
      </span>
    {:else}
      <span class="calibration__invalid">
        {t("FUSION.Scene.Calibrate.TooSmall")} ({MIN_CALIBRATION_SIZE} px)
      </span>
    {/if}
  </div>

  {#if skewed}
    <p class="calibration__warn">{t("FUSION.Scene.Calibrate.NotSquare")}</p>
  {/if}

  {#if error}
    <p class="calibration__error">{error}</p>
  {/if}

  <div class="calibration__actions">
    <button class="btn btn--ghost btn--sm" onclick={onClose} disabled={saving}>
      {t("FUSION.Scene.Calibrate.Cancel")}
    </button>
    <button
      class="btn btn--primary btn--sm"
      onclick={apply}
      disabled={!calibration.ok || saving}
    >
      {saving ? t("FUSION.Scene.Calibrate.Applying") : t("FUSION.Scene.Calibrate.Apply")}
    </button>
  </div>
</div>

<style>
  .calibration {
    background: var(--fusion-surface, #1c1c22);
    border: 1px solid rgba(124, 92, 252, 0.35);
    border-radius: var(--fusion-radius-md, 8px);
    bottom: 1.5rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    left: 50%;
    padding: 0.9rem 1.1rem;
    position: absolute;
    transform: translateX(-50%);
    width: min(26rem, calc(100vw - 2rem));
    z-index: 40;
  }

  .calibration__title {
    color: var(--fusion-text, #eee);
    font-size: 0.95rem;
    font-weight: 600;
    margin: 0;
  }

  .calibration__hint {
    color: var(--fusion-text-muted, #aaa);
    font-size: 0.8rem;
    line-height: 1.35;
    margin: 0;
  }

  .calibration__cells {
    align-items: flex-end;
    display: flex;
    gap: 0.5rem;
  }

  .calibration__field {
    display: flex;
    flex-direction: column;
    font-size: 0.75rem;
    gap: 0.2rem;
  }

  .calibration__field span {
    color: var(--fusion-text-muted, #aaa);
  }

  .calibration__field input {
    background: var(--fusion-bg, #111);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    color: var(--fusion-text, #eee);
    padding: 0.3rem 0.4rem;
    width: 5rem;
  }

  .calibration__times {
    color: var(--fusion-text-muted, #aaa);
    padding-bottom: 0.45rem;
  }

  .calibration__readout {
    align-items: baseline;
    display: flex;
    gap: 0.6rem;
  }

  .calibration__readout strong {
    color: var(--fusion-accent, #7c5cfc);
    font-size: 1.1rem;
  }

  .calibration__origin {
    color: var(--fusion-text-muted, #aaa);
    font-size: 0.75rem;
  }

  .calibration__invalid {
    color: #ff8866;
    font-size: 0.8rem;
  }

  .calibration__warn {
    color: #ffcc66;
    font-size: 0.75rem;
    margin: 0;
  }

  .calibration__error {
    color: #ff8866;
    font-size: 0.78rem;
    margin: 0;
  }

  .calibration__actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }
</style>
