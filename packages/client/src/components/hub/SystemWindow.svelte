<script lang="ts">
  /**
   * SystemWindow.svelte — the chrome of a Hub panel.
   *
   * Svelte 5 Runes component. Visual language ported from the interactive
   * prototype `docs/design/prototipo-log-missoes.html` (`.win` + `.br` + `.scan`),
   * which in turn transplanted Mario's "System Window" mockup.
   *
   * This component owns the *frame* and nothing else: bracket corners,
   * scanlines, the uppercase title rule, the glow. Panel content is a snippet.
   * Keeping the frame in one place is what stops the four corners from being
   * re-derived (slightly differently) in every panel.
   *
   * Two details that look decorative but are not:
   *
   *  - The corners sit at `-2px`, deliberately outside the border box, so the
   *    frame reads as brackets *around* the panel rather than as a thicker
   *    border. They are `aria-hidden` and never take pointer input.
   *  - `.hub-surface` is what opts this panel back into pointer events inside
   *    `HubLayer`, whose host is `pointer-events: none`. Without it the panel
   *    would render and then let every click fall through to the canvas.
   */

  import type { Snippet } from "svelte";
  import { HUB_SURFACE_CLASS } from "$lib/hub/layers.js";

  /** Which register the Sistema is speaking in. */
  export type SystemWindowTone = "system" | "rumour" | "good" | "bad";

  interface Props {
    /** Read out in the title bar, uppercased by CSS — write it in normal case. */
    title: string;
    /** Panel body. */
    children?: Snippet;
    /** Optional actions rendered at the right of the title bar. */
    actions?: Snippet;
    /** When provided, a close button appears and calls this. */
    onClose?: () => void;
    /**
     * Scanline overlay. On by default; turn it off for panels that render a
     * map or an image, where the moiré against fine detail is unpleasant.
     */
    scanlines?: boolean;
    /** Colour register. Defaults to the Sistema's cyan. */
    tone?: SystemWindowTone;
  }

  const {
    title,
    children,
    actions,
    onClose,
    scanlines = true,
    tone = "system",
  }: Props = $props();

  // Unique per instance so several panels can be open without their titles
  // fighting over one id — `aria-labelledby` would otherwise point at whichever
  // node happened to mount last.
  const titleId = `fusion-sw-title-${crypto.randomUUID()}`;
</script>

<section class="sw {HUB_SURFACE_CLASS} tone-{tone}" aria-labelledby={titleId}>
  <!-- The four bracket corners. Decoration: hidden from the accessibility tree
       and inert to the pointer, so they never eat a click near an edge. -->
  <span class="corner tl" aria-hidden="true"></span>
  <span class="corner tr" aria-hidden="true"></span>
  <span class="corner bl" aria-hidden="true"></span>
  <span class="corner br" aria-hidden="true"></span>

  {#if scanlines}
    <span class="scan" aria-hidden="true"></span>
  {/if}

  <header class="head">
    <h2 class="title" id={titleId}>{title}</h2>
    <div class="head-actions">
      {@render actions?.()}
      {#if onClose}
        <button class="close" type="button" onclick={onClose} aria-label="Fechar {title}">
          ✕
        </button>
      {/if}
    </div>
  </header>

  <div class="body">
    {@render children?.()}
  </div>
</section>

<style>
  .sw {
    position: relative;
    background: var(--fusion-sw-panel);
    border: 1px solid var(--fusion-sw-line);
    box-shadow: var(--fusion-sw-halo);
    color: var(--fusion-sw-ink);
    font-family: var(--fusion-sw-font);

    /* The panel clips its own body, not the corners: those live outside the
       border box, so `overflow: hidden` here would shave them off. The body
       carries the scroll instead. */
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  /* ---- bracket corners ---------------------------------------------------- */
  .corner {
    position: absolute;
    width: var(--fusion-sw-corner);
    height: var(--fusion-sw-corner);
    border: var(--fusion-sw-corner-rule) solid var(--fusion-sw-accent);
    pointer-events: none;
  }
  .corner.tl {
    top: calc(-1 * var(--fusion-sw-corner-rule));
    left: calc(-1 * var(--fusion-sw-corner-rule));
    border-right: 0;
    border-bottom: 0;
  }
  .corner.tr {
    top: calc(-1 * var(--fusion-sw-corner-rule));
    right: calc(-1 * var(--fusion-sw-corner-rule));
    border-left: 0;
    border-bottom: 0;
  }
  .corner.bl {
    bottom: calc(-1 * var(--fusion-sw-corner-rule));
    left: calc(-1 * var(--fusion-sw-corner-rule));
    border-right: 0;
    border-top: 0;
  }
  .corner.br {
    bottom: calc(-1 * var(--fusion-sw-corner-rule));
    right: calc(-1 * var(--fusion-sw-corner-rule));
    border-left: 0;
    border-top: 0;
  }

  /* ---- scanlines ---------------------------------------------------------- */
  .scan {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: repeating-linear-gradient(
      0deg,
      var(--fusion-sw-scan-tint) 0 var(--fusion-sw-scan-line),
      transparent var(--fusion-sw-scan-line) var(--fusion-sw-scan-gap)
    );
  }

  /* A player who asked the OS to stop moving things did not ask for a CRT.
     The tint is faint enough to read as texture, but it is still a repeating
     high-contrast pattern, which is exactly what triggers visual discomfort. */
  @media (prefers-reduced-motion: reduce) {
    .scan {
      display: none;
    }
  }

  /* ---- title bar ---------------------------------------------------------- */
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 14px;
    border-bottom: 1px solid var(--fusion-sw-line);
  }

  .title {
    flex: 1;
    margin: 0;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: var(--fusion-sw-track-title);
    text-transform: uppercase;
    color: var(--fusion-sw-accent);
    text-shadow: 0 0 12px var(--fusion-sw-accent-glow);
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .close {
    background: none;
    border: 1px solid transparent;
    color: var(--fusion-sw-dim);
    font: 700 11px var(--fusion-sw-font-mono);
    line-height: 1;
    padding: 4px 6px;
    cursor: pointer;
    transition: var(--fusion-sw-transition);
  }
  .close:hover {
    color: var(--fusion-sw-accent);
    border-color: var(--fusion-sw-line-strong);
  }
  .close:focus-visible {
    outline: 2px solid var(--fusion-sw-accent);
    outline-offset: 1px;
  }

  /* ---- body --------------------------------------------------------------- */
  .body {
    position: relative;

    /* Above the scanline overlay, which spans the whole panel. Content that
       renders *under* the scanlines is illegible at small sizes. */
    z-index: 1;

    padding: 14px;
    overflow: auto;
    min-height: 0;
    scrollbar-width: thin;
    scrollbar-color: var(--fusion-sw-line-strong) transparent;
  }

  /* ---- tones -------------------------------------------------------------- */
  /* Each tone rebinds a local accent pair; every rule above reads those two,
     so a new register is four lines here and nothing anywhere else. */
  .sw {
    --fusion-sw-accent: var(--fusion-sw-blue);
    --fusion-sw-accent-glow: var(--fusion-sw-blue-glow);
  }
  .sw.tone-rumour {
    --fusion-sw-accent: var(--fusion-sw-gold);
    --fusion-sw-accent-glow: rgba(255, 209, 102, 0.55);
  }
  .sw.tone-good {
    --fusion-sw-accent: var(--fusion-sw-ok);
    --fusion-sw-accent-glow: rgba(94, 242, 164, 0.5);
  }
  .sw.tone-bad {
    --fusion-sw-accent: var(--fusion-sw-bad);
    --fusion-sw-accent-glow: rgba(255, 92, 122, 0.5);
  }
</style>
