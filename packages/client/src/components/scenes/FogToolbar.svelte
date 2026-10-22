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
  import type { IconName } from "@fusion/shared";
  import { t } from "../../lib/i18n/i18n.js";
  import Icon from "../common/Icon.svelte";
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

  // Glyphs the shared set already has go through <Icon>; the three it lacks (polygon,
  // brush, snap-to-grid) and the on/off switch keep their own path in the same 24 grid.
  const SHARED: Partial<Record<string, IconName>> = {
    cloud: "cloud-fog",
    rect: "square",
    reveal: "eye",
    cover: "eye-off",
    undo: "undo-2",
    sun: "sun",
  };

  const ICON = {
    cloud: "",
    toggle: "M7 8h10a4 4 0 0 1 0 8H7A4 4 0 0 1 7 8z M7 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
    rect: "",
    poly: "M12 3l8.5 6.2-3.2 10H6.7L3.5 9.2z",
    brush:
      "M18.4 3.6a2 2 0 0 1 0 2.8L11 13.8 8.2 11l7.4-7.4a2 2 0 0 1 2.8 0z M8 12.5c-2.5 0-3 2.5-4 5 2.5 1 6 .5 6-2.5",
    reveal: "",
    cover: "",
    snap: "M4 4h16v16H4z M4 9.3h16 M4 14.7h16 M9.3 4v16 M14.7 4v16",
    undo: "",
    sun: "",
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

{#snippet icon(name: keyof typeof ICON)}
  {@const shared = SHARED[name]}
  {#if shared}
    <Icon name={shared} size={20} />
  {:else}
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d={ICON[name]}
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
  {/if}
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
        onclick={coverAll}>{@render icon("cloud")}</button
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
    top: calc(var(--fusion-header-height) + 0.75rem);
    left: calc(0.75rem + 3 * (2.25rem + 0.4rem));
    z-index: 90;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
  }

  .fog-dock__toggle {
    align-items: center;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    cursor: pointer;
    display: inline-flex;
    height: 2.25rem; /* aligned with the other corner buttons of the row (their offset is 2.25rem) */
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
    color: var(--fusion-on-accent);
  }

  .fog-dock__toggle:focus-visible,
  .fog-btn:focus-visible {
    outline: 2px solid var(--fusion-focus);
    outline-offset: 2px;
  }

  .fog-strip {
    align-items: center;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    box-shadow: var(--fusion-shadow-popover);
    display: flex;
    flex-wrap: wrap;
    gap: var(--fusion-space-1);
    max-width: calc(100vw - 8rem);
    padding: var(--fusion-space-1);
  }

  .fog-sep {
    align-self: stretch;
    background: var(--fusion-border);
    margin: var(--fusion-space-1) 0.15rem;
    width: 1px;
  }

  .fog-radius {
    min-height: var(--fusion-target);
    width: 6rem;
  }

  .fog-notice {
    background: var(--fusion-warning-dim);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-warning);
    font-size: var(--fusion-text-sm);
    margin: 0;
    max-width: 18rem;
    padding: var(--fusion-space-1) var(--fusion-space-2);
  }

  .fog-btn {
    align-items: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    cursor: pointer;
    display: inline-flex;
    height: var(--fusion-target);
    justify-content: center;
    padding: 0;
    width: var(--fusion-target);
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
