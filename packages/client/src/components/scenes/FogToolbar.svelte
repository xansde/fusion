<script lang="ts">
  /**
   * FogToolbar.svelte — the GM's manual-fog mini-bar.
   *
   * An icon-only button in the top-left corner row of the canvas (right after the
   * ruler / show-players / pin buttons; the right edge belongs to the drawer, the
   * bottom to the action bar). It opens a compact horizontal strip of icon buttons:
   * fog on/off for the scene, the three shapes (rectangle, polygon, brush),
   * reveal/cover, snap, undo, "reveal all" / "cover all". No help text: every
   * control explains itself through a tooltip (title / aria-label). Only one corner
   * panel is open at a time (see lib/ui/cornerPanel).
   *
   * Mounted for privileged users only. The component edits nothing by itself:
   * every change is handed to `onChange` as the next ManualFog and the owner
   * (TableScreen) sends it to the server; the server is what enforces GM-only.
   */

  import { resetFog, undoFogOp, type ManualFog } from "@fusion/shared";
  import { t } from "../../lib/i18n/i18n.js";
  import {
    fogToolState,
    MAX_BRUSH_RADIUS,
    MIN_BRUSH_RADIUS,
  } from "../../lib/canvas/fog/fogToolState.svelte.js";
  import type { FogTool } from "../../lib/canvas/fog/FogToolController.js";
  import { cornerPanel, toggleCornerPanel } from "../../lib/ui/cornerPanel.svelte.js";

  const {
    fog,
    onChange,
  }: {
    fog: ManualFog;
    onChange: (next: ManualFog) => void;
  } = $props();

  const open = $derived(cornerPanel.open === "fog");

  const ICON = {
    cloud: "M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9.5 4.3 4.3 0 0 1 17.5 18z",
    toggle: "M7 8h10a4 4 0 0 1 0 8H7A4 4 0 0 1 7 8z M7 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
    rect: "M4 6h16v12H4z",
    poly: "M12 3l8.5 6.2-3.2 10H6.7L3.5 9.2z",
    brush:
      "M18.4 3.6a2 2 0 0 1 0 2.8L11 13.8 8.2 11l7.4-7.4a2 2 0 0 1 2.8 0z M8 12.5c-2.5 0-3 2.5-4 5 2.5 1 6 .5 6-2.5",
    reveal:
      "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
    cover:
      "M3 3l18 18 M10.6 6.1A9.8 9.8 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.9 M6.5 7.6C3.9 9.3 2 12 2 12s3.6 6 10 6c1.6 0 3-.4 4.2-.9 M9.9 9.9a2.5 2.5 0 0 0 3.2 3.2",
    snap: "M4 4h16v16H4z M4 9.3h16 M4 14.7h16 M9.3 4v16 M14.7 4v16",
    undo: "M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3",
    sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4",
  } as const;

  function toggleOpen(): void {
    toggleCornerPanel("fog");
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

  const tools: ReadonlyArray<{
    id: Exclude<FogTool, "none">;
    icon: keyof typeof ICON;
    label: string;
  }> = $derived([
    { id: "rect", icon: "rect", label: t("FUSION.Fog.ToolRect") },
    {
      id: "poly",
      icon: "poly",
      label: `${t("FUSION.Fog.ToolPoly")} - ${t("FUSION.Fog.PolyHint")}`,
    },
    { id: "brush", icon: "brush", label: t("FUSION.Fog.ToolBrush") },
  ]);

  const revealLabel = $derived(`${t("FUSION.Fog.Reveal")} (Alt)`);
  const coverLabel = $derived(`${t("FUSION.Fog.Cover")} (Alt)`);
</script>

{#snippet icon(name: keyof typeof ICON, filled = false)}
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path
      d={ICON[name]}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
  </svg>
{/snippet}

<div class="fog-dock">
  <button
    type="button"
    class="fog-dock__toggle"
    class:fog-dock__toggle--on={fog.enabled}
    class:fog-dock__toggle--open={open}
    aria-expanded={open}
    aria-label={t("FUSION.Fog.Open")}
    title={t("FUSION.Fog.Open")}
    onclick={toggleOpen}
  >
    {@render icon("cloud")}
  </button>

  {#if open}
    <div class="fog-strip" role="group" aria-label={t("FUSION.Fog.Title")}>
      <button
        type="button"
        class="fog-btn"
        class:fog-btn--active={fog.enabled}
        aria-pressed={fog.enabled}
        aria-label={t("FUSION.Fog.Enabled")}
        title={t("FUSION.Fog.Enabled")}
        onclick={() => {
          setEnabled(!fog.enabled);
        }}>{@render icon("toggle")}</button
      >

      <span class="fog-sep" aria-hidden="true"></span>

      {#each tools as tool (tool.id)}
        <button
          type="button"
          class="fog-btn"
          class:fog-btn--active={fogToolState.tool === tool.id}
          aria-pressed={fogToolState.tool === tool.id}
          aria-label={tool.label}
          title={tool.label}
          disabled={!fog.enabled}
          onclick={() => {
            pick(tool.id);
          }}>{@render icon(tool.icon)}</button
        >
      {/each}

      {#if fogToolState.tool === "brush"}
        <input
          class="fog-radius"
          type="range"
          min={MIN_BRUSH_RADIUS}
          max={MAX_BRUSH_RADIUS}
          step="5"
          aria-label="{t('FUSION.Fog.BrushSize')}: {fogToolState.radius}"
          title="{t('FUSION.Fog.BrushSize')}: {fogToolState.radius}"
          bind:value={fogToolState.radius}
        />
      {/if}

      <span class="fog-sep" aria-hidden="true"></span>

      <button
        type="button"
        class="fog-btn fog-btn--reveal"
        class:fog-btn--active={fogToolState.mode === "reveal"}
        aria-pressed={fogToolState.mode === "reveal"}
        aria-label={revealLabel}
        title={revealLabel}
        disabled={!fog.enabled}
        onclick={() => {
          fogToolState.mode = "reveal";
        }}>{@render icon("reveal")}</button
      >
      <button
        type="button"
        class="fog-btn fog-btn--cover"
        class:fog-btn--active={fogToolState.mode === "cover"}
        aria-pressed={fogToolState.mode === "cover"}
        aria-label={coverLabel}
        title={coverLabel}
        disabled={!fog.enabled}
        onclick={() => {
          fogToolState.mode = "cover";
        }}>{@render icon("cover")}</button
      >
      <button
        type="button"
        class="fog-btn"
        class:fog-btn--active={fogToolState.snap}
        aria-pressed={fogToolState.snap}
        aria-label={t("FUSION.Fog.Snap")}
        title={t("FUSION.Fog.Snap")}
        disabled={!fog.enabled}
        onclick={() => {
          fogToolState.snap = !fogToolState.snap;
        }}>{@render icon("snap")}</button
      >

      <span class="fog-sep" aria-hidden="true"></span>

      <button
        type="button"
        class="fog-btn"
        aria-label={t("FUSION.Fog.Undo")}
        title={t("FUSION.Fog.Undo")}
        disabled={!fog.enabled || fog.ops.length === 0}
        onclick={undo}>{@render icon("undo")}</button
      >
      <button
        type="button"
        class="fog-btn"
        aria-label={t("FUSION.Fog.RevealAll")}
        title={t("FUSION.Fog.RevealAll")}
        disabled={!fog.enabled}
        onclick={revealAll}>{@render icon("sun")}</button
      >
      <button
        type="button"
        class="fog-btn"
        aria-label={t("FUSION.Fog.CoverAll")}
        title={t("FUSION.Fog.CoverAll")}
        disabled={!fog.enabled}
        onclick={coverAll}>{@render icon("cloud", true)}</button
      >
    </div>
    {#if fogToolState.notice}
      <p class="fog-notice" role="status">{fogToolState.notice}</p>
    {/if}
  {/if}
</div>

<style>
  .fog-dock {
    position: absolute;
    /* Same row as the ruler / show-players / pin buttons (the fourth slot). */
    top: calc(var(--fusion-header-height, 48px) + 0.75rem);
    left: calc(0.75rem + 3 * (2.25rem + 0.4rem));
    z-index: 90;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
  }

  .fog-dock__toggle {
    align-items: center;
    background: rgba(24, 24, 31, 0.85);
    backdrop-filter: blur(6px);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-text-muted);
    cursor: pointer;
    display: inline-flex;
    height: 2.25rem;
    justify-content: center;
    width: 2.25rem;
  }

  .fog-dock__toggle:hover {
    border-color: var(--fusion-text-muted);
    color: var(--fusion-text);
  }

  .fog-dock__toggle--on {
    color: var(--fusion-text);
  }

  .fog-dock__toggle--open {
    background: var(--fusion-accent);
    border-color: var(--fusion-accent);
    color: var(--fusion-bg);
  }

  .fog-dock__toggle:focus-visible,
  .fog-btn:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 2px;
  }

  .fog-strip {
    align-items: center;
    background: rgba(24, 24, 31, 0.85);
    backdrop-filter: blur(6px);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm, 4px);
    display: flex;
    flex-wrap: nowrap;
    gap: 0.2rem;
    padding: 0.25rem;
  }

  .fog-sep {
    align-self: stretch;
    background: var(--fusion-border);
    margin: 0.1rem 0.15rem;
    width: 1px;
  }

  .fog-radius {
    width: 5rem;
  }

  .fog-notice {
    background: var(--fusion-warning-dim);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-warning);
    font-size: 0.72rem;
    margin: 0;
    max-width: 18rem;
    padding: 0.25rem 0.45rem;
  }

  .fog-btn {
    align-items: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-text-muted);
    cursor: pointer;
    display: inline-flex;
    height: 1.9rem;
    justify-content: center;
    padding: 0;
    width: 1.9rem;
  }

  .fog-btn:hover:not(:disabled) {
    border-color: var(--fusion-accent);
    color: var(--fusion-text);
  }

  .fog-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .fog-btn--active {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
    color: var(--fusion-text);
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
