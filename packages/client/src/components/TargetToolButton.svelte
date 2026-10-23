<script lang="ts">
  /**
   * TargetToolButton — floating on-screen switch for how targets are marked.
   *
   * Beside the ruler button. The picker sets the right-click behaviour ("Um alvo": click replaces the aim, Shift adds;
   * "Vários": the opposite) and offers the area selector: Explosão · Cone · Linha reuse the ruler's area tool, but on
   * release they mark the tokens inside as the user's aim instead of pinning anything. "Limpar alvos" is Esc.
   */
  import { setMyTargets } from "../lib/combat/combatStore.svelte.js";
  import { TARGET_MODES } from "../lib/combat/targetMode.js";
  import { setTargetMode, targetModeState } from "../lib/combat/targetModeStore.svelte.js";
  import {
    rulerTool,
    selectTargetArea,
    setAreaSize,
    setRulerTool,
  } from "../lib/presence/rulerToolStore.svelte.js";
  import { TOOL_MODES, isAreaMode } from "../lib/presence/templateTool.js";
  import { getSocket } from "../lib/session.svelte.js";
  import {
    closeCornerPanel,
    cornerPanel,
    openCornerPanel,
    toggleCornerPanel,
  } from "../lib/ui/cornerPanel.svelte.js";

  // Which slot of the button row this one takes (the ruler is 0; the GM-only buttons sit in between).
  let { slot = 1 }: { slot?: number } = $props();

  const AREA_MODES = TOOL_MODES.filter((m) => m.mode === "burst" || m.mode === "cone" || m.mode === "line");

  const open = $derived(cornerPanel.open === "targets");
  const areaOn = $derived(rulerTool.purpose === "target" && isAreaMode(rulerTool.mode));

  function onMain(): void {
    if (areaOn) {
      setRulerTool(null);
      closeCornerPanel("targets");
    } else {
      toggleCornerPanel("targets");
    }
  }

  function pickArea(mode: (typeof AREA_MODES)[number]["mode"]): void {
    if (!isAreaMode(mode) || mode === "emanation") return;
    selectTargetArea(mode);
    openCornerPanel("targets");
  }

  function clearTargets(): void {
    const sock = getSocket();
    if (sock) void setMyTargets(sock, []);
  }

  function onSize(e: Event): void {
    setAreaSize(Number((e.currentTarget as HTMLInputElement).value));
  }
</script>

<div class="target-tool" style:--target-slot={slot}>
  <button
    type="button"
    class="target-tool__main"
    class:target-tool__main--active={areaOn}
    aria-pressed={areaOn}
    aria-label="Alvos"
    title="Alvos"
    onclick={onMain}
  >
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.6" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <path
        d="M12 2v4 M12 18v4 M2 12h4 M18 12h4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </svg>
  </button>

  {#if open}
    <div class="target-tool__panel" role="group" aria-label="Marcação de alvos">
      {#each TARGET_MODES as m (m.mode)}
        <button
          type="button"
          class="target-tool__mode"
          class:target-tool__mode--active={targetModeState.mode === m.mode}
          aria-pressed={targetModeState.mode === m.mode}
          onclick={() => {
            setTargetMode(m.mode);
          }}
        >
          {m.label}
        </button>
      {/each}
      <p class="target-tool__section">Área</p>
      {#each AREA_MODES as m (m.mode)}
        <button
          type="button"
          class="target-tool__mode"
          class:target-tool__mode--active={areaOn && rulerTool.mode === m.mode}
          aria-pressed={areaOn && rulerTool.mode === m.mode}
          onclick={() => {
            pickArea(m.mode);
          }}
        >
          {m.label}
        </button>
      {/each}
      {#if areaOn}
        <label class="target-tool__size">
          <span>Tamanho</span>
          <input
            type="number"
            min="5"
            max="500"
            step="5"
            value={rulerTool.sizeFt}
            onchange={onSize}
            aria-label="Tamanho em pés"
          />
          <span>pés</span>
        </label>
      {/if}
      <button type="button" class="target-tool__mode" onclick={clearTargets}>Limpar alvos</button>
      <p class="target-tool__hint">
        {#if areaOn}
          Arraste no mapa. Roda = tamanho. Ao soltar, marca quem está dentro (Shift soma).
        {:else if targetModeState.mode === "single"}
          Botão direito troca o alvo; Shift + botão direito soma.
        {:else}
          Botão direito soma alvos; Shift + botão direito troca.
        {/if}
      </p>
    </div>
  {/if}
</div>

<style>
  .target-tool {
    position: absolute;
    top: calc(var(--fusion-header-height) + 0.75rem);
    left: calc(0.75rem + var(--target-slot, 0) * (var(--fusion-target) + 0.4rem));
    z-index: 90;
    align-items: flex-start;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .target-tool__main,
  .target-tool__panel {
    background: var(--fusion-bg);
    backdrop-filter: blur(6px);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
  }

  .target-tool__main {
    align-items: center;
    color: var(--fusion-text-muted);
    cursor: pointer;
    display: inline-flex;
    height: var(--fusion-target);
    justify-content: center;
    transition:
      background-color var(--fusion-transition),
      color var(--fusion-transition),
      border-color var(--fusion-transition);
    width: var(--fusion-target);
  }

  .target-tool__main:hover {
    border-color: var(--fusion-text-muted);
    color: var(--fusion-text);
  }

  .target-tool__main--active {
    background: var(--fusion-accent);
    border-color: var(--fusion-accent);
    color: var(--fusion-bg);
  }

  .target-tool__main:focus-visible,
  .target-tool__mode:focus-visible {
    outline: 2px solid var(--fusion-focus);
    outline-offset: 2px;
  }

  .target-tool__panel {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.35rem;
    min-width: 11rem;
  }

  .target-tool__mode {
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: var(--fusion-text-sm);
    padding: 0.3rem 0.6rem;
    text-align: left;
  }

  .target-tool__mode:hover {
    color: var(--fusion-text);
    border-color: var(--fusion-border);
  }

  .target-tool__mode--active {
    background: var(--fusion-accent);
    color: var(--fusion-bg);
  }

  .target-tool__size {
    align-items: center;
    color: var(--fusion-text-muted);
    display: flex;
    font-size: var(--fusion-text-sm);
    gap: 0.35rem;
    padding: 0.2rem 0.3rem;
  }

  .target-tool__size input {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-family: var(--fusion-font-mono);
    padding: 0.15rem 0.3rem;
    width: 4rem;
  }

  .target-tool__section {
    color: var(--fusion-text-subtle);
    font-size: var(--fusion-text-sm);
    margin: 0.25rem 0.3rem 0;
  }

  .target-tool__hint {
    color: var(--fusion-text-subtle);
    font-size: var(--fusion-text-sm);
    margin: 0;
    max-width: 11rem;
    padding: 0 0.3rem 0.2rem;
  }
</style>
