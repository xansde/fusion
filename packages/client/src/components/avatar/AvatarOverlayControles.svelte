<script lang="ts">
  /**
   * AvatarOverlayControles.svelte — this viewer's controls for the avatar
   * overlay: show/hide, size, corner (or "back to the corner" after a drag).
   *
   * One component, three homes: the overlay's own gear menu, the avatar
   * creator, and Configurações → Preferências. The last two are what bring a
   * HIDDEN overlay back — once hidden there is no overlay to click on.
   * Every change goes through the live store, so all three and the overlay
   * agree at once (lib/avatar/preferenciasDoAvatar.svelte.ts).
   */

  import {
    mudarPreferenciasDoAvatar,
    preferenciasDoAvatar,
  } from "$lib/avatar/preferenciasDoAvatar.svelte.js";
  import { CANTOS, TAMANHO_MAXIMO, TAMANHO_MINIMO, type CantoDoAvatar } from "$lib/avatar/posicao.js";
  import { t } from "$lib/i18n/i18n.js";

  interface Props {
    /** Omit the show/hide checkbox (the overlay's own menu has a "Hide" button instead). */
    semMostrar?: boolean;
  }

  let { semMostrar = false }: Props = $props();

  const prefs = $derived(preferenciasDoAvatar.atual);

  const ROTULO_DO_CANTO: Record<CantoDoAvatar, string> = {
    "superior-esquerdo": "FUSION.Avatar.Overlay.CornerTopLeft",
    "superior-direito": "FUSION.Avatar.Overlay.CornerTopRight",
    "inferior-esquerdo": "FUSION.Avatar.Overlay.CornerBottomLeft",
    "inferior-direito": "FUSION.Avatar.Overlay.CornerBottomRight",
  };

  const SETA_DO_CANTO: Record<CantoDoAvatar, string> = {
    "superior-esquerdo": "↖",
    "superior-direito": "↗",
    "inferior-esquerdo": "↙",
    "inferior-direito": "↘",
  };
</script>

<div class="avatar-overlay-controles">
  {#if !semMostrar}
    <label class="linha">
      <input
        type="checkbox"
        checked={prefs.visivel}
        onchange={(e) => mudarPreferenciasDoAvatar({ visivel: (e.currentTarget as HTMLInputElement).checked })}
      />
      <span>{t("FUSION.Avatar.Overlay.Show")}</span>
    </label>
  {/if}

  <label class="linha linha--coluna">
    <span class="rotulo">{t("FUSION.Avatar.Overlay.Size")} <span class="valor">{prefs.tamanho} px</span></span>
    <input
      type="range"
      min={TAMANHO_MINIMO}
      max={TAMANHO_MAXIMO}
      step="32"
      value={prefs.tamanho}
      aria-label={t("FUSION.Avatar.Overlay.Size")}
      oninput={(e) => mudarPreferenciasDoAvatar({ tamanho: Number((e.currentTarget as HTMLInputElement).value) })}
    />
  </label>

  <div class="linha linha--coluna">
    <span class="rotulo">{t("FUSION.Avatar.Overlay.Corner")}</span>
    <div class="cantos" role="group" aria-label={t("FUSION.Avatar.Overlay.Corner")}>
      {#each CANTOS as canto (canto)}
        <button
          type="button"
          class="canto"
          aria-pressed={prefs.livre === null && prefs.canto === canto}
          title={t(ROTULO_DO_CANTO[canto])}
          aria-label={t(ROTULO_DO_CANTO[canto])}
          onclick={() => mudarPreferenciasDoAvatar({ canto, livre: null })}
        >{SETA_DO_CANTO[canto]}</button>
      {/each}
    </div>
    <span class="dica">
      {prefs.livre === null ? t("FUSION.Avatar.Overlay.DragHint") : t("FUSION.Avatar.Overlay.Free")}
    </span>
  </div>
</div>

<style>
  .avatar-overlay-controles {
    display: flex;
    flex-direction: column;
    font-size: 0.75rem;
    gap: 0.5rem;
  }

  .linha {
    align-items: center;
    display: flex;
    gap: 0.4rem;
  }

  .linha--coluna {
    align-items: stretch;
    flex-direction: column;
    gap: 0.25rem;
  }

  .rotulo {
    color: var(--fusion-text-subtle);
    font-size: 0.6875rem;
  }

  .valor {
    color: var(--fusion-text);
  }

  .cantos {
    display: grid;
    gap: 0.2rem;
    grid-template-columns: repeat(2, 2rem);
  }

  .canto {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    cursor: pointer;
    font-size: 0.875rem;
    height: 1.6rem;
    padding: 0;
  }

  .canto[aria-pressed="true"] {
    background: var(--fusion-accent);
    border-color: var(--fusion-accent);
    color: var(--fusion-on-accent);
  }

  .dica {
    color: var(--fusion-text-subtle);
    font-size: 0.625rem;
  }
</style>
