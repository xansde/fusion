<script lang="ts">
  /**
   * AvatarSprite.svelte — one avatar on a canvas.
   *
   * The single drawing surface in the feature: the creator's big preview, each
   * cell of its piece grid, and the corner overlay are all this component with a
   * different zoom and `animando`.
   *
   * Two modes, and the difference is not cosmetic:
   *
   *   animando  a requestAnimationFrame loop, driven by `performance.now()`
   *             DIRECTLY rather than by a per-instance start time — so every
   *             avatar on screen shares one phase and they breathe together.
   *   parado    paints once. Every tile was sliced when the avatar was
   *             prepared, so there is nothing left to land.
   */

  import { untrack } from "svelte";
  import type { Catalogo, Selecao } from "waybuilder-avatar";
  import {
    chaveDoAvatar,
    desenharAvatar,
    passoEm,
    prepararAvatar,
    type AvatarPronto,
  } from "$lib/avatar/desenhar.js";
  import { ladoDoQuadro } from "$lib/avatar/animacao.js";

  interface Props {
    catalogo: Catalogo;
    selecao: Selecao;
    corpo: string;
    animacao: string;
    /** Integer pixel multiplier. Non-integer zoom blurs pixel art. */
    zoom?: number;
    animando?: boolean;
    /** Accessible description; omit inside a labelled button. */
    rotulo?: string;
    /**
     * Displayed side in CSS px. The canvas is drawn at the integer `zoom` that
     * covers it and scaled down by CSS with `pixelated` — never smoothed up.
     */
    tamanhoCss?: number;
  }

  let {
    catalogo,
    selecao,
    corpo,
    animacao,
    zoom = 3,
    animando = true,
    rotulo = "",
    tamanhoCss = undefined,
  }: Props = $props();

  let tela: HTMLCanvasElement | null = $state(null);
  let pronto: AvatarPronto | null = $state(null);

  const lado = $derived(ladoDoQuadro(catalogo));

  /*
   * What this sprite shows, as a string. Callers hand us FRESH selection objects
   * all the time (the corner rebuilds it on every Actor broadcast — HP, a token
   * move —, the creator's grid on every edit); keying the work on content means
   * an unchanged avatar is neither re-prepared nor repainted.
   */
  const chave = $derived(chaveDoAvatar(selecao, corpo, animacao, !animando));

  // Resolve layers + palettes + every tile whenever the CONTENT changes (never
  // per frame). The previous `pronto` stays on screen until the new one is whole,
  // and the cancel flag keeps a slow load from overwriting a newer one.
  $effect(() => {
    void chave;
    // Untracked: the CONTENT key above is the only dependency. Tracking the
    // props themselves would re-prepare on every fresh-but-equal object.
    const alvo = untrack(() => ({ catalogo, selecao, corpo, animacao, parado: !animando }));
    let cancelado = false;
    void prepararAvatar(alvo.catalogo, alvo.selecao, alvo.corpo, alvo.animacao, {
      parado: alvo.parado,
    }).then((p) => {
      if (!cancelado) pronto = p;
    });
    return () => {
      cancelado = true;
    };
  });

  $effect(() => {
    const ctx = tela?.getContext("2d") ?? null;
    const atual = pronto;
    // Read so a zoom change (canvas resize clears it) repaints.
    const escala = zoom;
    if (ctx === null || atual === null) return;

    if (!animando || atual.ciclo.length <= 1) {
      // Still: every tile is already in hand — one paint, done.
      desenharAvatar(ctx, atual, 0, escala);
      return;
    }

    // Animated: the cycle runs at the acervo's fps (8), the display at 60+.
    // Repaint only when the cycle step changes — the same pixels drawn again
    // are work, not motion.
    let raf = 0;
    let ultimo = -1;
    const passo = (agora: number) => {
      const p = passoEm(agora, atual.fps);
      if (p !== ultimo) {
        ultimo = p;
        desenharAvatar(ctx, atual, agora, escala);
      }
      raf = requestAnimationFrame(passo);
    };
    desenharAvatar(ctx, atual, performance.now(), escala);
    ultimo = passoEm(performance.now(), atual.fps);
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  });
</script>

<canvas
  bind:this={tela}
  class="avatar-sprite"
  width={lado * zoom}
  height={lado * zoom}
  role={rotulo === "" ? "presentation" : "img"}
  aria-label={rotulo === "" ? undefined : rotulo}
  style:width={tamanhoCss === undefined ? undefined : `${String(tamanhoCss)}px`}
  style:height={tamanhoCss === undefined ? undefined : `${String(tamanhoCss)}px`}
></canvas>

<style>
  .avatar-sprite {
    /* Pixel art: never let the browser smooth it on upscale. */
    image-rendering: pixelated;
    display: block;
  }
</style>
