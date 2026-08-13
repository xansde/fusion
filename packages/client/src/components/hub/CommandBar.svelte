<script lang="ts">
  /**
   * CommandBar.svelte — the strip that summons the System Window's panels.
   *
   * Svelte 5 Runes component. Ported from the `.wtabs` / `.wtab` bar of
   * `docs/design/prototipo-log-missoes.html`.
   *
   * Controlled component: the active panel lives in the parent, so the same
   * state can also be driven from elsewhere (a macro, a scene change) without
   * this bar being the source of truth.
   *
   * All keyboard decisions are delegated to `$lib/hub/commandBar.ts`, which is
   * pure and tested. This file only wires the events — deliberately, since the
   * client runs Vitest with `environment: "node"` and cannot mount components.
   */

  import {
    HUB_PANELS,
    resolveShortcut,
    applyShortcut,
    type HubPanel,
  } from "$lib/hub/commandBar.js";
  import { HUB_SURFACE_CLASS } from "$lib/hub/layers.js";

  interface Props {
    /** Currently open panel, or `null` when the Hub is dismissed. */
    active: string | null;
    /** Called with the next active panel. */
    onChange: (panelId: string | null) => void;
    /** Panels to offer. Defaults to the three the prototype settled on. */
    panels?: readonly HubPanel[];
    /** Optional per-panel counters, e.g. `{ missions: 3 }`. Zero hides it. */
    badges?: Readonly<Record<string, number>>;
  }

  const { active, onChange, panels = HUB_PANELS, badges = {} }: Props = $props();

  function onWindowKeydown(event: KeyboardEvent) {
    const intent = resolveShortcut(event, panels);
    if (!intent) return;

    // Only once the intent is ours: a blanket preventDefault would swallow
    // browser shortcuts and, worse, Escape for every other dialog on screen.
    event.preventDefault();
    onChange(applyShortcut(active, intent));
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<nav class="bar {HUB_SURFACE_CLASS}" aria-label="Janelas do Sistema">
  {#each panels as panel (panel.id)}
    {@const isActive = panel.id === active}
    {@const badge = badges[panel.id] ?? 0}
    <button
      class="tab"
      class:on={isActive}
      type="button"
      aria-pressed={isActive}
      onclick={() => onChange(applyShortcut(active, { kind: "panel", panelId: panel.id }))}
    >
      <span class="label">{panel.label}</span>
      <!-- `<kbd>` is the shortcut hint, not a control: the key it names is
           handled on window, so announcing it as interactive would be a lie. -->
      <kbd aria-hidden="true">{panel.key.toUpperCase()}</kbd>
      {#if badge > 0}
        <span class="badge" aria-label="{badge} em andamento">{badge}</span>
      {/if}
    </button>
  {/each}
</nav>

<style>
  .bar {
    position: fixed;
    left: 50%;
    bottom: 18px;
    transform: translateX(-50%);
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;

    /* No z-index: the bar is a child of the Hub layer, which already sits in
       the `--fusion-z-hub` band (REQ-UIF-008). Restating it here would create
       a second opinion about stacking. */
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 14px;
    border: 1px solid var(--fusion-sw-line-strong);
    background: var(--fusion-sw-fill);
    color: var(--fusion-sw-dim);
    font: 600 11px var(--fusion-sw-font);
    letter-spacing: var(--fusion-sw-track-label);
    text-transform: uppercase;
    cursor: pointer;
    transition: var(--fusion-sw-transition);

    /* The bar floats over the canvas: without a backdrop the labels vanish
       against a bright map. */
    backdrop-filter: blur(6px);
  }

  .tab:hover {
    color: var(--fusion-sw-ink);
    border-color: var(--fusion-sw-blue);
  }

  .tab.on {
    color: var(--fusion-sw-blue);
    border-color: var(--fusion-sw-blue);
    background: var(--fusion-sw-fill-active);
    box-shadow: var(--fusion-sw-halo-soft);
  }

  .tab:focus-visible {
    outline: 2px solid var(--fusion-sw-blue);
    outline-offset: 2px;
  }

  kbd {
    font: 700 9px var(--fusion-sw-font-mono);
    color: #3f6072;
    border: 1px solid var(--fusion-sw-line);
    border-radius: 2px;
    padding: 0 4px;
  }

  .badge {
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--fusion-sw-bad);
    color: #fff;
    font: 800 9px var(--fusion-sw-font);
    display: grid;
    place-items: center;
    box-shadow: 0 0 8px var(--fusion-sw-bad);
  }

  @media (prefers-reduced-motion: reduce) {
    .tab {
      transition: none;
    }
  }
</style>
