<script lang="ts">
  /**
   * ShowPlayersButton — GM-only floating button (beside the ruler) that opens the
   * "Mostrar aos jogadores" form: an image from the asset library and/or a titled note,
   * sent to every connected client.
   */
  import FilePicker from "$lib/components/assets/FilePicker.svelte";
  import { fusionApi } from "../lib/api.js";
  import { getSocket } from "../lib/session.svelte.js";
  import { canSendShow, emitShow } from "../lib/presence/showPlayers.js";
  import { assetNameFromPath } from "../lib/assets/assetApi.js";

  let open = $state(false);
  let picking = $state(false);
  let title = $state("");
  let text = $state("");
  let imagePath = $state<string | null>(null);
  let sent = $state(false);

  const imageName = $derived(imagePath ? assetNameFromPath(imagePath) : null);
  const ready = $derived(canSendShow({ title, text, ...(imagePath ? { imagePath } : {}) }));

  function send(): void {
    const ok = emitShow(getSocket(), {
      title,
      text,
      ...(imagePath ? { imagePath } : {}),
    });
    if (!ok) return;
    sent = true;
    window.setTimeout(() => {
      sent = false;
    }, 1500);
  }

  function reset(): void {
    title = "";
    text = "";
    imagePath = null;
  }
</script>

<div class="show-tool">
  <button
    type="button"
    class="show-tool__main"
    class:show-tool__main--active={open}
    aria-pressed={open}
    aria-label="Mostrar aos jogadores"
    title="Mostrar aos jogadores"
    onclick={() => {
      open = !open;
    }}
  >
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
      />
      <circle cx="9" cy="10.5" r="1.6" fill="currentColor" />
      <path
        d="M4 17l5-4.5 3.5 3 3-2.5L20 16.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
    </svg>
  </button>

  {#if open}
    <form
      class="show-tool__panel"
      aria-label="Mostrar aos jogadores"
      onsubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label>
        <span>Título</span>
        <input type="text" maxlength="120" bind:value={title} />
      </label>
      <label>
        <span>Texto</span>
        <textarea rows="3" maxlength="2000" bind:value={text}></textarea>
      </label>
      <div class="show-tool__image">
        <button
          type="button"
          class="show-tool__btn"
          onclick={() => {
            picking = true;
          }}>Escolher imagem</button
        >
        {#if imageName}
          <span class="show-tool__file" title={imageName}>{imageName}</span>
          <button
            type="button"
            class="show-tool__btn"
            aria-label="Remover imagem"
            onclick={() => {
              imagePath = null;
            }}>&times;</button
          >
        {/if}
      </div>
      <div class="show-tool__actions">
        <button type="submit" class="show-tool__btn show-tool__btn--primary" disabled={!ready}>
          {sent ? "Enviado" : "Mostrar a todos"}
        </button>
        <button type="button" class="show-tool__btn" onclick={reset}>Limpar</button>
      </div>
    </form>
  {/if}
</div>

{#if picking}
  <FilePicker
    category="handouts"
    token={fusionApi.getToken() ?? ""}
    onSelect={(path) => {
      imagePath = path;
      picking = false;
    }}
    onClose={() => {
      picking = false;
    }}
  />
{/if}

<style>
  .show-tool {
    align-items: flex-start;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    left: calc(0.75rem + 2.25rem + 0.4rem);
    position: absolute;
    top: calc(var(--fusion-header-height) + 0.75rem);
    z-index: 90;
  }

  .show-tool__main,
  .show-tool__panel {
    background: rgba(24, 24, 31, 0.85);
    backdrop-filter: blur(6px);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
  }

  .show-tool__main {
    align-items: center;
    color: var(--fusion-text-muted);
    cursor: pointer;
    display: inline-flex;
    height: 2.25rem;
    justify-content: center;
    width: 2.25rem;
  }

  .show-tool__main:hover {
    border-color: var(--fusion-text-muted);
    color: var(--fusion-text);
  }

  .show-tool__main--active {
    background: var(--fusion-accent);
    border-color: var(--fusion-accent);
    color: var(--fusion-bg);
  }

  .show-tool__panel {
    color: var(--fusion-text-muted);
    display: flex;
    flex-direction: column;
    font-size: 0.8125rem;
    gap: 0.45rem;
    padding: 0.55rem;
    width: 16rem;
  }

  .show-tool__panel label {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .show-tool__panel input,
  .show-tool__panel textarea {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    padding: 0.25rem 0.4rem;
    resize: vertical;
  }

  .show-tool__image,
  .show-tool__actions {
    align-items: center;
    display: flex;
    gap: 0.4rem;
  }

  .show-tool__file {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .show-tool__btn {
    background: transparent;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: 0.8125rem;
    padding: 0.25rem 0.55rem;
  }

  .show-tool__btn--primary {
    background: var(--fusion-accent);
    border-color: var(--fusion-accent);
    color: var(--fusion-bg);
  }

  .show-tool__btn:disabled {
    cursor: default;
    opacity: 0.5;
  }
</style>
