<script lang="ts">
  /**
   * CalibrateGridButton — GM-only corner button (fifth in the row, after the ruler,
   * "Mostrar aos jogadores", the pin and the fog) that opens the grid calibration for the
   * scene on the canvas. Click again to leave without writing anything.
   */
  import { cornerPanel } from "../lib/ui/cornerPanel.svelte.js";
  import {
    startGridCalibration,
    stopGridCalibration,
  } from "../lib/scenes/gridCalibrationState.svelte.js";
  import { t } from "../lib/i18n/index.js";

  const { sceneId }: { sceneId: string | null } = $props();

  const open = $derived(cornerPanel.open === "calibrate");

  function toggle(): void {
    if (open) stopGridCalibration();
    else if (sceneId) startGridCalibration(sceneId);
  }
</script>

<div class="calibrate-tool">
  <button
    type="button"
    class="calibrate-tool__main"
    class:calibrate-tool__main--active={open}
    aria-pressed={open}
    aria-label={t("FUSION.Scene.Calibrate.Open")}
    title={t("FUSION.Scene.Calibrate.Open")}
    disabled={!sceneId}
    onclick={toggle}
  >
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M4 4h16v16H4z M4 12h16 M12 4v16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-dasharray="2.5 1.5"
      />
      <rect x="12" y="12" width="8" height="8" fill="none" stroke="currentColor" stroke-width="2" />
    </svg>
  </button>
</div>

<style>
  .calibrate-tool {
    left: calc(0.75rem + 4 * (2.25rem + 0.4rem));
    position: absolute;
    top: calc(var(--fusion-header-height) + 0.75rem);
    z-index: 90;
  }

  .calibrate-tool__main {
    align-items: center;
    background: rgba(24, 24, 31, 0.85);
    backdrop-filter: blur(6px);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    cursor: pointer;
    display: inline-flex;
    height: 2.25rem;
    justify-content: center;
    width: 2.25rem;
  }

  .calibrate-tool__main:hover:not(:disabled) {
    border-color: var(--fusion-text-muted);
    color: var(--fusion-text);
  }

  .calibrate-tool__main:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .calibrate-tool__main--active {
    background: var(--fusion-accent);
    border-color: var(--fusion-accent);
    color: var(--fusion-bg);
  }

  .calibrate-tool__main:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 2px;
  }
</style>
