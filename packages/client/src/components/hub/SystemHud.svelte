<script lang="ts">
  /**
   * SystemHud.svelte — the System Window as it sits over the table.
   *
   * Svelte 5 Runes component. Holds the one piece of state the Hub needs (which
   * panel is open) and composes the two pieces that draw it: `CommandBar` at the
   * bottom edge and a `SystemWindow` above it.
   *
   * Scope, stated plainly: this is the *frame*. The Mapa panel is filled — it
   * hosts the tactical minimap of spec 32. The other two are content owned by
   * spec 28 (Hub do jogador), still being written, so they render an explicit
   * empty state naming where their content will come from rather than mock data
   * that would later have to be told apart from the real thing.
   *
   * Closed by default. The Hub is diegetic chrome over a map the table is trying
   * to look at; it opens when asked and gets out of the way when dismissed.
   */

  import CommandBar from "./CommandBar.svelte";
  import SystemWindow from "./SystemWindow.svelte";
  import TacticalMinimap from "./TacticalMinimap.svelte";
  import { HUB_PANELS, HUB_CLOSE_KEY } from "$lib/hub/commandBar.js";
  import { HUB_SURFACE_CLASS } from "$lib/hub/layers.js";
  import { DEMO_NOTICES } from "$lib/hub/noticeDemo.js";
  import { notify } from "$lib/hub/noticeStore.svelte.js";
  import type { MinimapSource } from "$lib/hub/minimapSource.js";

  interface Props {
    /** Panel open on mount. `null` — the default — starts dismissed. */
    initialPanel?: string | null;
    /**
     * Live wiring for the Mapa panel (spec 32). Built by `TableScreen`, where
     * the canvas and the token layer live; `null` until the canvas is up.
     */
    minimapSource?: MinimapSource | null;
  }

  const { initialPanel = null, minimapSource = null }: Props = $props();

  let active = $state<string | null>(initialPanel);

  const activePanel = $derived(HUB_PANELS.find((panel) => panel.id === active) ?? null);

  /** Where each panel's content is going to come from. */
  const pending: Record<string, string> = {
    missions: "O quadro de missões chega com a spec 28 (Hub do jogador) — issue #90.",
    party: "A ficha resumida da comitiva chega com a spec 28 (Hub do jogador).",
  };

  /** The map panel draws a map: scanlines over it are moiré, not atmosphere. */
  const isMap = $derived(activePanel?.id === "map");
</script>

{#if activePanel}
  <div class="slot" class:wide={isMap}>
    <SystemWindow title={activePanel.label} onClose={() => (active = null)} scanlines={!isMap}>
      {#if isMap}
        <TacticalMinimap source={minimapSource} />
      {:else}
        <p class="pending {HUB_SURFACE_CLASS}">{pending[activePanel.id]}</p>
      {/if}
      <p class="hint">
        <kbd>{activePanel.key.toUpperCase()}</kbd> fecha esta janela ·
        <kbd>{HUB_CLOSE_KEY}</kbd> dispensa o Sistema
      </p>

      <!-- SCAFFOLDING — remove when something real emits notices (specs 28/34).
           Until then this is the only way to see the notification stack at all,
           and a component nobody can look at is a component nobody reviews. -->
      <div class="demo">
        <span class="demo-label">Disparar notificação</span>
        <div class="demo-buttons">
          {#each DEMO_NOTICES as notice (notice.title)}
            <button class="demo-btn tone-{notice.tone}" type="button" onclick={() => notify(notice)}>
              {notice.title}
            </button>
          {/each}
        </div>
      </div>
    </SystemWindow>
  </div>
{/if}

<CommandBar {active} onChange={(next) => (active = next)} />

<style>
  .slot {
    position: fixed;

    /* Anchored above the command bar, centred, and capped so a panel never
       grows into the bar or past the viewport — the body scrolls instead. */
    left: 50%;
    bottom: 74px;
    transform: translateX(-50%);
    width: min(720px, calc(100vw - 48px));
    max-height: min(60vh, calc(100vh - 140px));
    display: flex;
  }

  /* The minimap earns the extra width: a battle map squeezed into 720px stops
     being readable long before the panel stops fitting. */
  .slot.wide {
    width: min(900px, calc(100vw - 48px));
    max-height: min(74vh, calc(100vh - 120px));
  }

  /* SystemWindow is the flex child that must be allowed to shrink; without
     this its `overflow: auto` body would never engage and the panel would
     simply grow past `max-height`. */
  .slot :global(> section) {
    flex: 1;
    min-height: 0;
  }

  .pending {
    margin: 0 0 12px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--fusion-sw-ink);
  }

  .hint {
    margin: 0;
    font-size: 11px;
    letter-spacing: 0.04em;
    color: var(--fusion-sw-dim);
  }

  kbd {
    font: 700 9px var(--fusion-sw-font-mono);
    color: var(--fusion-sw-dim);
    border: 1px solid var(--fusion-sw-line);
    border-radius: 2px;
    padding: 1px 4px;
  }

  /* ---- scaffolding ---------------------------------------------------------
     Styled apart from the rest on purpose: a dashed rule and a muted label say
     "this is a probe, not a feature", so nobody mistakes it for the panel. */
  .demo {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px dashed var(--fusion-sw-line);
  }

  .demo-label {
    display: block;
    margin-bottom: 8px;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: var(--fusion-sw-track-title);
    text-transform: uppercase;
    color: var(--fusion-sw-dim);
  }

  .demo-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .demo-btn {
    padding: 6px 10px;
    border: 1px solid var(--fusion-sw-demo-accent);
    background: var(--fusion-sw-fill);
    color: var(--fusion-sw-demo-accent);
    font: 600 10px var(--fusion-sw-font);
    letter-spacing: var(--fusion-sw-track-label);
    text-transform: uppercase;
    cursor: pointer;
    transition: var(--fusion-sw-transition);
  }
  .demo-btn:hover {
    background: var(--fusion-sw-fill-active);
  }
  .demo-btn:focus-visible {
    outline: 2px solid var(--fusion-sw-demo-accent);
    outline-offset: 2px;
  }

  .demo-btn {
    --fusion-sw-demo-accent: var(--fusion-sw-blue);
  }
  .demo-btn.tone-rumour {
    --fusion-sw-demo-accent: var(--fusion-sw-gold);
  }
  .demo-btn.tone-good {
    --fusion-sw-demo-accent: var(--fusion-sw-ok);
  }
  .demo-btn.tone-bad {
    --fusion-sw-demo-accent: var(--fusion-sw-bad);
  }

  @media (prefers-reduced-motion: reduce) {
    .demo-btn {
      transition: none;
    }
  }
</style>
