<script lang="ts">
  /**
   * SystemHud.svelte — the System Window as it sits over the table.
   *
   * Svelte 5 Runes component. Holds the one piece of state the Hub needs (which
   * panel is open) and composes the two pieces that draw it: `CommandBar` at the
   * bottom edge and a `SystemWindow` above it.
   *
   * Scope, stated plainly: this is the *frame*. The Mapa panel hosts the
   * tactical minimap of spec 32; the Comitiva panel hosts the party roster of
   * spec 28. Missões still renders an explicit empty state naming where its
   * content will come from rather than mock data that would later have to be
   * told apart from the real thing.
   *
   * Closed by default. The Hub is diegetic chrome over a map the table is trying
   * to look at; it opens when asked and gets out of the way when dismissed.
   */

  import CommandBar from "./CommandBar.svelte";
  import SystemWindow from "./SystemWindow.svelte";
  import TacticalMinimap from "./TacticalMinimap.svelte";
  import RegionMapPanel from "./RegionMapPanel.svelte";
  import PartyPanel from "./PartyPanel.svelte";
  import QuestPanel from "./QuestPanel.svelte";
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

  /**
   * Where each panel's content is going to come from.
   *
   * Empty now that Missões, Comitiva and Mapa are all real. Kept — rather than
   * deleted along with its branch — because the next panel to be sketched
   * lands here first, and re-deriving this scaffolding costs more than the two
   * lines it occupies.
   */
  const pending: Record<string, string> = {};

  /** The map panel draws a map: scanlines over it are moiré, not atmosphere. */
  const isMap = $derived(activePanel?.id === "map");

  /**
   * Which map the panel is showing.
   *
   * Two different things answer to the word "mapa" and the table needs both:
   * `region` is the map you consult (spec 34) — an image with pins, and what
   * opens by default, because that is what a player presses M to look at.
   * `tactical` is the overview of the scene being played (spec 32). They are
   * tabs rather than separate Hub buttons: one button per idea, and "where are
   * we" is one idea at two scales.
   */
  let mapView = $state<"region" | "tactical">("region");

  /**
   * Whether the map window is stretched to the viewport.
   *
   * The panel's normal width is chosen for reading a list; a map is a picture
   * you want as big as the screen allows, and the frame's own resize handle
   * can only grow within the window it sits in. This widens the window itself,
   * which is why it lives here and not in the map panel.
   */
  let mapFull = $state(false);
</script>

{#if activePanel}
  <div class="slot" class:wide={isMap} class:full={isMap && mapFull}>
    <SystemWindow title={activePanel.label} onClose={() => (active = null)} scanlines={!isMap}>
      {#if isMap}
        <div class="tabs">
          <button
            class="tab"
            class:on={mapView === "region"}
            type="button"
            onclick={() => (mapView = "region")}>Região</button
          >
          <button
            class="tab"
            class:on={mapView === "tactical"}
            type="button"
            onclick={() => (mapView = "tactical")}>Tático</button
          >
          <span class="tabs-spacer"></span>
          <button
            class="tab"
            type="button"
            title={mapFull ? "Reduzir a janela" : "Ampliar a janela"}
            onclick={() => (mapFull = !mapFull)}>{mapFull ? "⤡ reduzir" : "⤢ ampliar"}</button
          >
        </div>
        {#if mapView === "region"}
          <RegionMapPanel />
        {:else}
          <TacticalMinimap source={minimapSource} />
        {/if}
      {:else if activePanel.id === "party"}
        <PartyPanel />
      {:else if activePanel.id === "missions"}
        <!-- Tracking a place switches the Hub to the map, which only this
             component can do: the panels do not know about each other. -->
        <QuestPanel
          onTrackOnMap={() => {
            active = "map";
            mapView = "region";
          }}
        />
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

  /* Ampliada: a janela toma a tela até onde a barra de comando permite. */
  .slot.full {
    width: calc(100vw - 32px);
    max-height: calc(100vh - 96px);
  }

  /* Widening the window without heightening the picture would gain almost
     nothing — the image is bounded by the frame's height, not its width. A
     hand-dragged size is an inline style and still wins over this. */
  .slot.full :global(.frame) {
    height: calc(100vh - 300px);
  }

  /* SystemWindow is the flex child that must be allowed to shrink; without
     this its `overflow: auto` body would never engage and the panel would
     simply grow past `max-height`. */
  .slot :global(> section) {
    flex: 1;
    min-height: 0;
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 8px;
  }

  .tabs-spacer {
    flex: 1;
  }

  .tab {
    padding: 3px 10px;
    border: 1px solid var(--fusion-sw-line);
    background: var(--fusion-sw-fill);
    color: var(--fusion-sw-dim);
    font: 700 9.5px var(--fusion-sw-font);
    letter-spacing: var(--fusion-sw-track-label);
    text-transform: uppercase;
    cursor: pointer;
    transition: var(--fusion-sw-transition);
  }
  .tab:hover {
    background: var(--fusion-sw-fill-active);
  }
  .tab.on {
    border-color: var(--fusion-sw-blue);
    color: var(--fusion-sw-blue);
    background: var(--fusion-sw-fill-active);
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
