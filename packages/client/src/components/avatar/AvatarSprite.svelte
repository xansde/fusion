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
   *   parado    repaints only until every layer has landed. A still sprite has
   *             no next tick to fix itself on, and an atlas evicted while the
   *             grid scrolls would otherwise leave the cell blank forever.
   */

  import type { Catalogo, Selecao } from "waybuilder-avatar";
  import { desenharAvatar, prepararAvatar, type AvatarPronto } from "$lib/avatar/desenhar.js";
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
  }

  let {
    catalogo,
    selecao,
    corpo,
    animacao,
    zoom = 3,
    animando = true,
    rotulo = "",
  }: Props = $props();

  let tela: HTMLCanvasElement | null = $state(null);
  let pronto: AvatarPronto | null = $state(null);

  const lado = $derived(ladoDoQuadro(catalogo));

  // Resolve layers + palettes + atlases whenever the SELECTION changes (never
  // per frame). The cancel flag keeps a slow load from overwriting a newer one.
  $effect(() => {
    const alvo = { catalogo, selecao, corpo, animacao };
    let cancelado = false;
    void prepararAvatar(alvo.catalogo, alvo.selecao, alvo.corpo, alvo.animacao).then((p) => {
      if (!cancelado) pronto = p;
    });
    return () => {
      cancelado = true;
    };
  });

  $effect(() => {
    const ctx = tela?.getContext("2d") ?? null;
    const atual = pronto;
    if (ctx === null || atual === null) return;

    let raf = 0;

    if (animando) {
      const passo = (agora: number) => {
        desenharAvatar(ctx, atual, agora, zoom);
        raf = requestAnimationFrame(passo);
      };
      raf = requestAnimationFrame(passo);
    } else {
      // Still: paint frame 0 and stop as soon as nothing is missing. The attempt
      // cap keeps a genuinely broken atlas from spinning forever.
      let tentativas = 0;
      const passo = () => {
        const faltando = desenharAvatar(ctx, atual, 0, zoom);
        tentativas++;
        if (faltando > 0 && tentativas < 120) raf = requestAnimationFrame(passo);
      };
      raf = requestAnimationFrame(passo);
    }

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
></canvas>

<style>
  .avatar-sprite {
    /* Pixel art: never let the browser smooth it on upscale. */
    image-rendering: pixelated;
    display: block;
  }
</style>
