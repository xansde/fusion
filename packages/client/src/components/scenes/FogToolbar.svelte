<script lang="ts">
  /**
   * FogToolbar.svelte — the GM's manual-fog mini-bar.
   *
   * A discreet floating button in the top-left corner of the canvas (the right
   * edge belongs to the drawer, the bottom to the action bar). It opens a small
   * panel: fog on/off for the scene, the three shapes (rectangle, polygon,
   * brush), reveal/cover, "reveal all" / "cover all" and undo.
   *
   * Mounted for privileged users only. The component edits nothing by itself:
   * every change is handed to `onChange` as the next ManualFog and the owner
   * (TableScreen) sends it to the server; the server is what enforces GM-only.
   */

  import { resetFog, undoFogOp, type ManualFog } from "@fusion/shared";
  import { t } from "../../lib/i18n/i18n.js";
  import {
    closeFogBar,
    fogToolState,
    MAX_BRUSH_RADIUS,
    MIN_BRUSH_RADIUS,
  } from "../../lib/canvas/fog/fogToolState.svelte.js";
  import type { FogTool } from "../../lib/canvas/fog/FogToolController.js";

  const {
    fog,
    onChange,
  }: {
    fog: ManualFog;
    onChange: (next: ManualFog) => void;
  } = $props();

  function toggleOpen(): void {
    if (fogToolState.open) closeFogBar();
    else fogToolState.open = true;
  }

  function pick(tool: FogTool): void {
    fogToolState.notice = null;
    fogToolState.tool = fogToolState.tool === tool ? "none" : tool;
  }

  function setEnabled(enabled: boolean): void {
    fogToolState.notice = null;
    if (!enabled) fogToolState.tool = "none";
    onChange({ ...fog, enabled });
  }

  function coverAll(): void {
    fogToolState.notice = null;
    onChange(resetFog({ ...fog, enabled: true }, "covered"));
  }

  function revealAll(): void {
    fogToolState.notice = null;
    onChange(resetFog({ ...fog, enabled: true }, "revealed"));
  }

  function undo(): void {
    fogToolState.notice = null;
    onChange(undoFogOp(fog));
  }

  const tools: ReadonlyArray<{ id: Exclude<FogTool, "none">; key: string }> = [
    { id: "rect", key: "FUSION.Fog.ToolRect" },
    { id: "poly", key: "FUSION.Fog.ToolPoly" },
    { id: "brush", key: "FUSION.Fog.ToolBrush" },
  ];
</script>

<div class="fog-dock">
  <button
    type="button"
    class="fog-dock__toggle"
    class:fog-dock__toggle--on={fog.enabled}
    aria-expanded={fogToolState.open}
    aria-label={t("FUSION.Fog.Open")}
    title={t("FUSION.Fog.Open")}
    onclick={toggleOpen}
  >
    <span aria-hidden="true">&#x2601;</span>
    <span class="fog-dock__toggle-label">{t("FUSION.Fog.Title")}</span>
  </button>

  {#if fogToolState.open}
    <div class="fog-panel" role="group" aria-label={t("FUSION.Fog.Title")}>
      <label class="fog-panel__switch">
        <input
          type="checkbox"
          checked={fog.enabled}
          onchange={(e) => {
            setEnabled(e.currentTarget.checked);
          }}
        />
        <span>{t("FUSION.Fog.Enabled")}</span>
      </label>

      <div class="fog-panel__row" role="group" aria-label={t("FUSION.Fog.Shapes")}>
        {#each tools as tool (tool.id)}
          <button
            type="button"
            class="fog-btn"
            class:fog-btn--active={fogToolState.tool === tool.id}
            aria-pressed={fogToolState.tool === tool.id}
            disabled={!fog.enabled}
            onclick={() => {
              pick(tool.id);
            }}>{t(tool.key)}</button
          >
        {/each}
      </div>

      <div class="fog-panel__row" role="group" aria-label={t("FUSION.Fog.Mode")}>
        <button
          type="button"
          class="fog-btn fog-btn--reveal"
          class:fog-btn--active={fogToolState.mode === "reveal"}
          aria-pressed={fogToolState.mode === "reveal"}
          disabled={!fog.enabled}
          onclick={() => {
            fogToolState.mode = "reveal";
          }}>{t("FUSION.Fog.Reveal")}</button
        >
        <button
          type="button"
          class="fog-btn fog-btn--cover"
          class:fog-btn--active={fogToolState.mode === "cover"}
          aria-pressed={fogToolState.mode === "cover"}
          disabled={!fog.enabled}
          onclick={() => {
            fogToolState.mode = "cover";
          }}>{t("FUSION.Fog.Cover")}</button
        >
      </div>
      <p class="fog-panel__hint">{t("FUSION.Fog.AltHint")}</p>

      {#if fogToolState.tool === "brush"}
        <label class="fog-panel__field">
          <span>{t("FUSION.Fog.BrushSize")}</span>
          <input
            type="range"
            min={MIN_BRUSH_RADIUS}
            max={MAX_BRUSH_RADIUS}
            step="5"
            bind:value={fogToolState.radius}
          />
          <span class="fog-panel__value">{fogToolState.radius}</span>
        </label>
      {/if}
      {#if fogToolState.tool === "rect"}
        <label class="fog-panel__switch">
          <input type="checkbox" bind:checked={fogToolState.snap} />
          <span>{t("FUSION.Fog.Snap")}</span>
        </label>
      {/if}
      {#if fogToolState.tool === "poly"}
        <p class="fog-panel__hint">{t("FUSION.Fog.PolyHint")}</p>
      {/if}

      <div class="fog-panel__row">
        <button type="button" class="fog-btn" disabled={!fog.enabled} onclick={revealAll}
          >{t("FUSION.Fog.RevealAll")}</button
        >
        <button type="button" class="fog-btn" disabled={!fog.enabled} onclick={coverAll}
          >{t("FUSION.Fog.CoverAll")}</button
        >
        <button
          type="button"
          class="fog-btn"
          disabled={!fog.enabled || fog.ops.length === 0}
          onclick={undo}>{t("FUSION.Fog.Undo")}</button
        >
      </div>

      {#if fogToolState.notice}
        <p class="fog-panel__notice" role="status">{fogToolState.notice}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .fog-dock {
    position: absolute;
    /* Below the ruler / show-players / note buttons row, which share the top-left corner. */
    top: calc(var(--fusion-header-height, 48px) + 3.4rem);
    left: 0.75rem;
    z-index: 90;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
  }

  .fog-dock__toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.6rem;
    background: rgba(24, 24, 31, 0.85);
    backdrop-filter: blur(6px);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-text-muted);
    font-size: 0.8rem;
    cursor: pointer;
  }

  .fog-dock__toggle:hover {
    color: var(--fusion-text);
  }

  .fog-dock__toggle--on {
    color: var(--fusion-text);
    border-color: var(--fusion-accent);
  }

  .fog-panel {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 15rem;
    padding: 0.65rem;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius, 8px);
    color: var(--fusion-text);
    font-size: 0.8rem;
    box-shadow: var(--fusion-shadow-modal);
  }

  .fog-panel__row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .fog-panel__switch,
  .fog-panel__field {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .fog-panel__field input[type="range"] {
    flex: 1;
    min-width: 0;
  }

  .fog-panel__value {
    min-width: 2rem;
    text-align: right;
    color: var(--fusion-text-muted);
  }

  .fog-panel__hint {
    margin: 0;
    color: var(--fusion-text-muted);
    font-size: 0.72rem;
  }

  .fog-panel__notice {
    margin: 0;
    padding: 0.3rem 0.45rem;
    background: var(--fusion-warning-dim);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-warning);
  }

  .fog-btn {
    flex: 1 1 auto;
    padding: 0.3rem 0.55rem;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-text);
    font-size: 0.78rem;
    cursor: pointer;
  }

  .fog-btn:hover:not(:disabled) {
    border-color: var(--fusion-accent);
  }

  .fog-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .fog-btn--active {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
  }

  .fog-btn--reveal.fog-btn--active {
    background: var(--fusion-success-dim);
    border-color: var(--fusion-success);
  }

  .fog-btn--cover.fog-btn--active {
    background: var(--fusion-danger-dim);
    border-color: var(--fusion-danger);
  }
</style>
