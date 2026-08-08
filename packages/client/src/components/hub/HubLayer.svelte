<script lang="ts">
  /**
   * HubLayer.svelte — full-viewport overlay that hosts the player Hub.
   *
   * Svelte 5 Runes component. Spec: 28-hub-do-jogador.md.
   *
   * Mounted once inside TableScreen, last in the shell, so it paints above the
   * canvas, the fixed regions and the floating windows (REQ-UIF-008 band
   * `--fusion-z-hub`).
   *
   * The whole point of this component is the pass-through rule:
   *
   *   the host covers the entire viewport but never takes pointer input.
   *   Only descendants that opt in via `.hub-surface` do.
   *
   * So a click on empty Hub space reaches whatever is underneath — a token, the
   * grid, a window — exactly as if the Hub were not there. This mirrors the
   * pattern `WindowHost.svelte` already uses; the two hosts are siblings and
   * neither blocks the other.
   *
   * Opt-in, not opt-out, is deliberate. The Hub is meant to carry decorative
   * chrome (ambient glow, scanlines, framing) spanning large empty areas. Were
   * those to capture clicks, the symptom would be "the map randomly stops
   * responding" — a bug that is miserable to trace back to a decorative div.
   */

  import type { Snippet } from "svelte";
  import { HUB_LAYER_CLASS, HUB_SURFACE_CLASS } from "$lib/hub/layers.js";

  interface Props {
    /** Hub content. Anything interactive must carry `class="hub-surface"`. */
    children?: Snippet;
    /**
     * When false the layer is removed from the DOM entirely. Prefer this over
     * `display: none` on the host: it also drops the subtree out of the focus
     * order, which `pointer-events: none` alone does not do — a Hub panel left
     * mounted but invisible would still be reachable by Tab.
     */
    active?: boolean;
  }

  const { children, active = true }: Props = $props();
</script>

{#if active}
  <!--
    role="presentation": the host is a positioning shell with no semantics of
    its own. Individual Hub panels carry their own roles and labels. Marking
    the host as a region would announce an empty landmark on every screen.
  -->
  <div class={HUB_LAYER_CLASS} data-hub-surface-class={HUB_SURFACE_CLASS} role="presentation">
    {@render children?.()}
  </div>
{/if}

<style>
  .fusion-hub-layer {
    position: fixed;
    inset: 0;

    /* The pass-through rule. Descendants opt back in below. */
    pointer-events: none;

    z-index: var(--fusion-z-hub);

    /* Deliberately no background, no backdrop-filter and no opacity < 1.
       A background would be invisible yet still paint over the canvas; a
       backdrop-filter or an opacity below 1 would force a compositing layer
       over the whole viewport and cost a full-screen repaint on every canvas
       frame. Tint belongs on `.hub-surface` elements, never on the host. */
  }

  /* Elements that opt back into pointer input. `:global` because the markup
     comes from the consumer's snippet, so Svelte's scoping does not reach it. */
  .fusion-hub-layer :global(.hub-surface) {
    pointer-events: auto;
  }
</style>
