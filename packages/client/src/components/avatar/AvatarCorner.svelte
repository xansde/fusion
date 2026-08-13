<script lang="ts">
  /**
   * AvatarCorner.svelte — the viewer's own avatar, bottom-right of the table.
   *
   * Shows ONE avatar: the character this user explicitly owns (see
   * lib/avatar/meuAvatar.ts for why permission-based ownership is the wrong
   * rule — it would hand a GM every actor in the world). No avatar, no overlay:
   * the corner renders nothing at all rather than an empty frame.
   *
   * The animation:
   *   - it slides up and fades in when it appears (and only then — the sprite
   *     itself is already in motion afterwards, so a second looping transform
   *     would fight the pixel art);
   *   - it loops `idle`, and switches to `combat_idle` while a combat is running
   *     on the active scene, so the table's state reads off the figure;
   *   - `prefers-reduced-motion` drops the slide-in and holds a still frame.
   *
   * Sits in the fixed-regions z band: a character sheet or any floating window
   * covers it, which is the right precedence — the avatar is decoration, the
   * windows are work.
   */

  import type { Catalogo, Selecao } from "waybuilder-avatar";
  import { carregarCatalogo } from "$lib/avatar/acervo.js";
  import { ANIMACAO_COMBATE, ANIMACAO_PADRAO, animacaoDisponivel } from "$lib/avatar/animacao.js";
  import { escolherAvatarDoUsuario, type AtorComAvatar, type AvatarDoUsuario } from "$lib/avatar/meuAvatar.js";
  import { paraSelecao } from "$lib/avatar/criador.js";
  import { worldMirror } from "$lib/docs/worldSync.js";
  import { combatStore } from "$lib/combat/combatStore.svelte.js";
  import { session } from "$lib/session.svelte.js";
  import { sidebarState } from "$lib/scenes/scenesState.svelte.js";
  import { t } from "$lib/i18n/i18n.js";
  import AvatarSprite from "./AvatarSprite.svelte";

  interface Props {
    /** Called when the avatar is clicked — the sheet opener, injected by the caller. */
    onAbrirFicha?: (actorId: string) => void;
  }

  let { onAbrirFicha = undefined }: Props = $props();

  let catalogo: Catalogo | null = $state(null);
  let meu: AvatarDoUsuario | null = $state(null);
  let reduzirMovimento = $state(false);

  // The mirror is the live source: an avatar saved from the creator (or by
  // another client of the same user) reaches the corner through the doc:update
  // broadcast, with no extra plumbing.
  $effect(() => {
    const userId = session.user?.id ?? null;
    const aplicar = (docs: AtorComAvatar[]) => {
      meu = escolherAvatarDoUsuario(docs, userId);
    };
    aplicar(worldMirror.getByType<AtorComAvatar>("Actor"));
    return worldMirror.subscribe<AtorComAvatar>("Actor", aplicar);
  });

  // Load the acervo only once there IS an avatar to draw: a table whose players
  // never made one must not pay 1.7 MB for the catalog.
  $effect(() => {
    if (meu === null || catalogo !== null) return;
    void carregarCatalogo()
      .then((cat) => {
        catalogo = cat;
      })
      .catch(() => {
        catalogo = null;
      });
  });

  $effect(() => {
    const consulta = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduzirMovimento = consulta.matches;
    const aoMudar = (e: MediaQueryListEvent) => {
      reduzirMovimento = e.matches;
    };
    consulta.addEventListener("change", aoMudar);
    return () => consulta.removeEventListener("change", aoMudar);
  });

  const emCombate = $derived(combatStore.combat !== null);

  /** The stored selection in the renderer's shape (see paraSelecao). */
  const selecao = $derived.by((): Selecao => {
    const atual = meu;
    return atual === null ? {} : paraSelecao(atual.avatar);
  });

  const animacao = $derived.by(() => {
    if (catalogo === null) return ANIMACAO_PADRAO;
    return emCombate
      ? animacaoDisponivel(catalogo, ANIMACAO_COMBATE, ANIMACAO_PADRAO)
      : animacaoDisponivel(catalogo, ANIMACAO_PADRAO);
  });
</script>

{#if catalogo !== null && meu !== null}
  <div
    class="avatar-canto"
    class:avatar-canto--estatico={reduzirMovimento}
    class:avatar-canto--combate={emCombate}
    class:avatar-canto--recuado={sidebarState.open}
  >
    {#if onAbrirFicha !== undefined}
      <button
        type="button"
        class="avatar-canto__botao"
        title={t("FUSION.Avatar.OpenSheet", { name: meu.nome })}
        aria-label={t("FUSION.Avatar.OpenSheet", { name: meu.nome })}
        onclick={() => onAbrirFicha(meu!.actorId)}
      >
        <AvatarSprite
          {catalogo}
          {selecao}
          corpo={meu.avatar.corpo}
          {animacao}
          zoom={3}
          animando={!reduzirMovimento}
        />
      </button>
    {:else}
      <AvatarSprite
        {catalogo}
        {selecao}
        corpo={meu.avatar.corpo}
        {animacao}
        zoom={3}
        animando={!reduzirMovimento}
        rotulo={t("FUSION.Avatar.CornerAlt", { name: meu.nome })}
      />
    {/if}
  </div>
{/if}

<style>
  .avatar-canto {
    animation: avatar-entrada 480ms cubic-bezier(0.22, 1, 0.36, 1) both;
    bottom: 0.5rem;
    /* Decoration: never eat a click meant for the canvas underneath. The button
       re-enables pointer events for itself. */
    pointer-events: none;
    position: fixed;
    right: 0.75rem;
    /* Slides together with the sidebar toggle instead of jumping. */
    transition: right var(--fusion-transition);
    z-index: var(--fusion-z-region);
  }

  /* The sidebar is a fixed overlay on the same right edge; when it is open the
     avatar steps left by its width so it stands on the map, not on the chat. */
  .avatar-canto--recuado {
    right: calc(var(--fusion-sidebar-width) + 0.75rem);
  }

  .avatar-canto--estatico {
    animation: none;
  }

  .avatar-canto__botao {
    background: none;
    border: 0;
    border-radius: var(--fusion-radius);
    cursor: pointer;
    display: block;
    padding: 0;
    pointer-events: auto;
    transition: transform var(--fusion-transition);
  }

  .avatar-canto__botao:hover,
  .avatar-canto__botao:focus-visible {
    transform: translateY(-3px);
  }

  .avatar-canto__botao:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 2px;
  }

  /* A ground shadow under the sprite: it reads as standing on the table instead
     of floating over the map. */
  .avatar-canto::after {
    background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.45), transparent 70%);
    bottom: 2px;
    content: "";
    height: 12px;
    left: 50%;
    position: absolute;
    transform: translateX(-50%);
    width: 76%;
    z-index: -1;
  }

  /* In combat the ground goes warm — a second, quieter reading of the same state
     the `combat_idle` pose already tells. */
  .avatar-canto--combate::after {
    background: radial-gradient(ellipse at center, rgba(190, 70, 45, 0.55), transparent 70%);
  }

  @keyframes avatar-entrada {
    from {
      opacity: 0;
      transform: translateY(28px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .avatar-canto {
      animation: none;
    }
    .avatar-canto__botao:hover,
    .avatar-canto__botao:focus-visible {
      transform: none;
    }
  }
</style>
