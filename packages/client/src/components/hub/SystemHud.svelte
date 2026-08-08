<script lang="ts">
  /**
   * SystemHud.svelte — the System Window as it sits over the table.
   *
   * Svelte 5 Runes component. Holds the one piece of state the Hub needs (which
   * panel is open) and composes the two pieces that draw it: `CommandBar` at the
   * bottom edge and a `SystemWindow` above it.
   *
   * Scope, stated plainly: this is the *frame*. What goes inside each panel is
   * content owned by specs still being written — the mission board and the party
   * roster by spec 28 (Hub do jogador), the region map by spec 34. Each panel
   * therefore renders an explicit empty state naming where its content will come
   * from, rather than mock data that would later have to be told apart from the
   * real thing.
   *
   * Closed by default. The Hub is diegetic chrome over a map the table is trying
   * to look at; it opens when asked and gets out of the way when dismissed.
   */

  import CommandBar from "./CommandBar.svelte";
  import SystemWindow from "./SystemWindow.svelte";
  import { HUB_PANELS, HUB_CLOSE_KEY } from "$lib/hub/commandBar.js";
  import { HUB_SURFACE_CLASS } from "$lib/hub/layers.js";

  interface Props {
    /** Panel open on mount. `null` — the default — starts dismissed. */
    initialPanel?: string | null;
  }

  const { initialPanel = null }: Props = $props();

  let active = $state<string | null>(initialPanel);

  const activePanel = $derived(HUB_PANELS.find((panel) => panel.id === active) ?? null);

  /** Where each panel's content is going to come from. */
  const pending: Record<string, string> = {
    missions: "O quadro de missões chega com a spec 28 (Hub do jogador) — issue #90.",
    party: "A ficha resumida da comitiva chega com a spec 28 (Hub do jogador).",
    map: "O mapa de região chega com a spec 34, sobre os overlays de cena.",
  };
</script>

{#if activePanel}
  <div class="slot">
    <SystemWindow title={activePanel.label} onClose={() => (active = null)}>
      <p class="pending {HUB_SURFACE_CLASS}">{pending[activePanel.id]}</p>
      <p class="hint">
        <kbd>{activePanel.key.toUpperCase()}</kbd> fecha esta janela ·
        <kbd>{HUB_CLOSE_KEY}</kbd> dispensa o Sistema
      </p>
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
</style>
