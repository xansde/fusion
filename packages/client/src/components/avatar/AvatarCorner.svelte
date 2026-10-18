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
   *
   * Each VIEWER decides how it sits on their own screen (client-local, never
   * sent anywhere — lib/settings/clientPrefs.ts): show/hide, size, a corner, or
   * a spot dragged by hand. The gear that appears on hover opens those controls;
   * a hidden overlay comes back from the creator or from Configurações →
   * Preferências. Wherever it goes it stays off the drawer, the header and the
   * action bar (lib/avatar/posicao.ts).
   */

  import type { Catalogo, Selecao } from "waybuilder-avatar";
  import { carregarCatalogo } from "$lib/avatar/acervo.js";
  import { ANIMACAO_COMBATE, ANIMACAO_PADRAO, animacaoDisponivel } from "$lib/avatar/animacao.js";
  import { escolherAvatarDoUsuario, type AtorComAvatar, type AvatarDoUsuario } from "$lib/avatar/meuAvatar.js";
  import { paraSelecao } from "$lib/avatar/criador.js";
  import { worldMirror } from "$lib/docs/worldSync.js";
  import { combatStore } from "$lib/combat/combatStore.svelte.js";
  import { session } from "$lib/session.svelte.js";
  import { isDrawerOpen } from "$lib/sidebar/drawerLayout.svelte.js";
  import { posicaoDoAvatar, zoomParaTamanho } from "$lib/avatar/posicao.js";
  import {
    mudarPreferenciasDoAvatar,
    preferenciasDoAvatar,
  } from "$lib/avatar/preferenciasDoAvatar.svelte.js";
  import AvatarOverlayControles from "./AvatarOverlayControles.svelte";
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
  let viewportWidth = $state(1280);
  let viewportHeight = $state(800);
  const prefs = $derived(preferenciasDoAvatar.atual);
  const zoom = $derived(zoomParaTamanho(prefs.tamanho));

  /** Where a drag currently holds the box (raw px), or null when not dragging. */
  let arraste: { x0: number; y0: number; baseL: number; baseT: number; left: number; top: number; moveu: boolean } | null =
    $state(null);
  /** A drag ends with a pointerup that the browser also turns into a click — swallow it. */
  let engolirClique = false;
  let menuAberto = $state(false);

  /**
   * The action bar as it really is on screen. Its height depends on the tab row,
   * the status strip and whether it is folded, so it is measured rather than
   * guessed; absent (no active actor) means there is nothing to dodge.
   */
  let barraMedida: { left: number; right: number; top: number } | null = $state(null);
  $effect(() => {
    let ultima = "";
    const medir = () => {
      const r = document.querySelector("[data-action-bar]")?.getBoundingClientRect();
      const nova =
        r !== undefined && r.width > 0
          ? { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top) }
          : null;
      const chave = JSON.stringify(nova);
      if (chave !== ultima) {
        ultima = chave;
        barraMedida = nova;
      }
    };
    medir();
    const id = setInterval(medir, 500);
    return () => clearInterval(id);
  });

  function posicaoCom(livre: { x: number; y: number } | null) {
    return posicaoDoAvatar({
      viewportWidth,
      viewportHeight,
      drawerOpen: isDrawerOpen(),
      tamanho: prefs.tamanho,
      canto: prefs.canto,
      livre,
      oculto: !prefs.visivel,
      barra: barraMedida,
    });
  }

  const posicao = $derived.by(() => {
    const a = arraste;
    // While dragging, the same clamps as a saved spot: what you drop is what stays.
    if (a !== null && a.moveu) return posicaoCom({ x: a.left / viewportWidth, y: a.top / viewportHeight });
    return posicaoCom(prefs.livre);
  });

  /** The menu opens towards the middle of the screen, never off its edge. */
  const menuParaEsquerda = $derived(posicao.left + prefs.tamanho / 2 > viewportWidth / 2);
  const menuParaCima = $derived(posicao.top + prefs.tamanho / 2 > viewportHeight / 2);

  function aoPressionar(e: PointerEvent): void {
    if (e.button !== 0) return;
    arraste = {
      x0: e.clientX,
      y0: e.clientY,
      baseL: posicao.left,
      baseT: posicao.top,
      left: posicao.left,
      top: posicao.top,
      moveu: false,
    };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function aoMover(e: PointerEvent): void {
    const a = arraste;
    if (a === null) return;
    const dx = e.clientX - a.x0;
    const dy = e.clientY - a.y0;
    // A few pixels of slack: a click with a shaky hand is still a click.
    if (!a.moveu && Math.hypot(dx, dy) < 5) return;
    arraste = { ...a, moveu: true, left: a.baseL + dx, top: a.baseT + dy };
  }

  function aoSoltar(): void {
    const a = arraste;
    arraste = null;
    if (a === null || !a.moveu) return;
    engolirClique = true;
    const solto = posicaoCom({ x: a.left / viewportWidth, y: a.top / viewportHeight });
    mudarPreferenciasDoAvatar({ livre: { x: solto.left / viewportWidth, y: solto.top / viewportHeight } });
  }

  function aoClicar(): void {
    if (engolirClique) {
      engolirClique = false;
      return;
    }
    if (meu !== null) onAbrirFicha?.(meu.actorId);
  }

  function ocultar(): void {
    menuAberto = false;
    mudarPreferenciasDoAvatar({ visivel: false });
  }

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

<svelte:window
  bind:innerWidth={viewportWidth}
  bind:innerHeight={viewportHeight}
  onkeydown={(e) => {
    if (e.key === "Escape") menuAberto = false;
  }}
  onpointerdown={(e) => {
    // A click anywhere else closes the menu, like any popover.
    if (menuAberto && !(e.target instanceof Element && e.target.closest(".avatar-canto"))) menuAberto = false;
  }}
/>

{#if catalogo !== null && meu !== null && posicao.visivel}
  <div
    class="avatar-canto"
    class:avatar-canto--estatico={reduzirMovimento}
    class:avatar-canto--combate={emCombate}
    class:avatar-canto--arrastando={arraste?.moveu === true}
    class:avatar-canto--menu={menuAberto}
    style:left="{posicao.left}px"
    style:top="{posicao.top}px"
    style:width="{prefs.tamanho}px"
    style:height="{prefs.tamanho}px"
  >
    <button
      type="button"
      class="avatar-canto__botao"
      title={onAbrirFicha === undefined
        ? t("FUSION.Avatar.Overlay.DragHint")
        : `${t("FUSION.Avatar.OpenSheet", { name: meu.nome })} — ${t("FUSION.Avatar.Overlay.DragHint")}`}
      aria-label={onAbrirFicha === undefined
        ? t("FUSION.Avatar.CornerAlt", { name: meu.nome })
        : t("FUSION.Avatar.OpenSheet", { name: meu.nome })}
      onpointerdown={aoPressionar}
      onpointermove={aoMover}
      onpointerup={aoSoltar}
      onpointercancel={() => {
        arraste = null;
      }}
      onclick={aoClicar}
    >
      <AvatarSprite
        {catalogo}
        {selecao}
        corpo={meu.avatar.corpo}
        {animacao}
        {zoom}
        tamanhoCss={prefs.tamanho}
        animando={!reduzirMovimento}
      />
    </button>

    <button
      type="button"
      class="avatar-canto__engrenagem"
      aria-expanded={menuAberto}
      aria-label={t("FUSION.Avatar.Overlay.Settings")}
      title={t("FUSION.Avatar.Overlay.Settings")}
      onclick={() => {
        menuAberto = !menuAberto;
      }}
    >⚙</button>

    {#if menuAberto}
      <div
        class="avatar-canto__menu"
        class:avatar-canto__menu--esquerda={menuParaEsquerda}
        class:avatar-canto__menu--cima={menuParaCima}
        role="dialog"
        aria-label={t("FUSION.Avatar.Overlay.Settings")}
      >
        <p class="avatar-canto__menu-titulo">{t("FUSION.Avatar.Overlay.Title")}</p>
        <AvatarOverlayControles semMostrar />
        <div class="avatar-canto__menu-acoes">
          <button type="button" onclick={ocultar}>{t("FUSION.Avatar.Overlay.Hide")}</button>
          <button
            type="button"
            onclick={() => {
              menuAberto = false;
            }}>{t("FUSION.Avatar.Overlay.Close")}</button
          >
        </div>
        <p class="avatar-canto__menu-dica">{t("FUSION.Avatar.Overlay.HideHint")}</p>
      </div>
    {/if}
  </div>
{/if}

<style>
  .avatar-canto {
    animation: avatar-entrada 480ms cubic-bezier(0.22, 1, 0.36, 1) both;
    /* Decoration: never eat a click meant for the canvas underneath. The button
       re-enables pointer events for itself. */
    pointer-events: none;
    position: fixed;
    /* Slides together with the sidebar toggle instead of jumping. */
    transition:
      left var(--fusion-transition),
      top var(--fusion-transition);
    z-index: var(--fusion-z-actionbar, 70);
  }

  .avatar-canto--estatico {
    animation: none;
  }

  /* Following the pointer: no easing, or the box lags behind the hand. */
  .avatar-canto--arrastando {
    transition: none;
  }

  .avatar-canto--arrastando .avatar-canto__botao {
    cursor: grabbing;
  }

  .avatar-canto__engrenagem {
    align-items: center;
    background: var(--fusion-surface, #1e1e1e);
    border: 1px solid var(--fusion-border);
    border-radius: 50%;
    color: var(--fusion-text);
    cursor: pointer;
    display: flex;
    font-size: 0.875rem;
    height: 1.6rem;
    justify-content: center;
    opacity: 0;
    padding: 0;
    pointer-events: auto;
    position: absolute;
    right: 2px;
    top: 2px;
    transition: opacity var(--fusion-transition);
    width: 1.6rem;
  }

  .avatar-canto:hover .avatar-canto__engrenagem,
  .avatar-canto:focus-within .avatar-canto__engrenagem,
  .avatar-canto--menu .avatar-canto__engrenagem {
    opacity: 1;
  }

  .avatar-canto__menu {
    background: var(--fusion-surface, #1e1e1e);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    left: calc(100% + 6px);
    padding: 0.6rem;
    pointer-events: auto;
    position: absolute;
    top: 0;
    width: 13rem;
  }

  .avatar-canto__menu--esquerda {
    left: auto;
    right: calc(100% + 6px);
  }

  .avatar-canto__menu--cima {
    bottom: 0;
    top: auto;
  }

  .avatar-canto__menu-titulo {
    font-size: 0.75rem;
    font-weight: 600;
    margin: 0;
  }

  .avatar-canto__menu-acoes {
    display: flex;
    gap: 0.35rem;
  }

  .avatar-canto__menu-acoes button {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    cursor: pointer;
    font-size: 0.75rem;
    padding: 0.25rem 0.55rem;
  }

  .avatar-canto__menu-dica {
    color: var(--fusion-text-subtle);
    font-size: 0.625rem;
    margin: 0;
  }

  .avatar-canto__botao {
    background: none;
    border: 0;
    border-radius: var(--fusion-radius);
    cursor: grab;
    display: block;
    height: 100%;
    padding: 0;
    pointer-events: auto;
    touch-action: none;
    transition: transform var(--fusion-transition);
    width: 100%;
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
