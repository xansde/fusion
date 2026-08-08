<script lang="ts">
  /**
   * SystemNoticeStack.svelte — the Sistema's notifications, centred at the top.
   *
   * Svelte 5 Runes component. Ported from the `.toastwrap` / `.nt` block of
   * `docs/design/prototipo-log-missoes.html`.
   *
   * Mounted OUTSIDE `HubLayer`, deliberately. The Hub host is
   * `position: fixed` with `z-index: var(--fusion-z-hub)`, which opens a
   * stacking context — anything inside it is trapped in the Hub band no matter
   * what z-index it asks for. A notice belongs in the `--fusion-z-notification`
   * band (REQ-UIF-008: always visible, even over a modal), so it has to be a
   * sibling of the Hub rather than a child of it.
   *
   * The queue lives in `$lib/hub/noticeStore.svelte.ts`; this component only
   * draws it and drives the clock.
   */

  import {
    noticeState,
    tickSystemNotices,
    dismissSystemNotice,
    notify,
  } from "$lib/hub/noticeStore.svelte.js";
  import { runNoticeDemo, isNoticeDemoRequested } from "$lib/hub/noticeDemo.js";

  /** How often expiry is checked. */
  const TICK_MS = 250;

  const visible = $derived(noticeState.queue.visible);

  $effect(() => {
    // A single interval for the whole stack rather than a timeout per notice:
    // one timer cannot leak, and a notice dismissed by hand does not leave an
    // orphan callback behind that would later fire against a stale id.
    const handle = setInterval(() => tickSystemNotices(), TICK_MS);
    return () => clearInterval(handle);
  });

  // SCAFFOLDING — remove once something real calls `notify()`.
  //
  // Nothing in the client emits a notice yet (the callers arrive with specs 28
  // and 34), so the whole component would be invisible during review. Behind
  // `?hud-demo=1` it plays one notice of each tone and exposes
  // `window.fusionHudDemo()` to replay them.
  $effect(() => {
    if (!isNoticeDemoRequested(window.location.search)) return;
    return runNoticeDemo(notify, window);
  });
</script>

<!-- `aria-live="polite"`, not `assertive`: a notice is worth announcing at the
     next pause, not worth cutting off whatever the player is already hearing. -->
<div class="stack" role="status" aria-live="polite">
  {#each visible as notice (notice.id)}
    <button
      class="notice tone-{notice.tone}"
      type="button"
      onclick={() => dismissSystemNotice(notice.id)}
      aria-label="Dispensar: {notice.title}"
    >
      <span class="corner tl" aria-hidden="true"></span>
      <span class="corner tr" aria-hidden="true"></span>
      <span class="corner bl" aria-hidden="true"></span>
      <span class="corner br" aria-hidden="true"></span>

      <span class="kicker">Sistema</span>
      <span class="title">{notice.title}</span>
      {#if notice.body}
        <span class="body">{notice.body}</span>
      {/if}

      <!-- The life bar reads as the notice counting itself down. It is pure
           decoration: expiry is decided by the reducer, never by this
           animation finishing, so a throttled background tab cannot leave a
           notice on screen forever. -->
      <span class="life" style="animation-duration: {notice.ttlMs}ms" aria-hidden="true"></span>
    </button>
  {/each}
</div>

<style>
  .stack {
    position: fixed;
    top: 22px;
    left: 50%;
    transform: translateX(-50%);
    z-index: var(--fusion-z-notification);

    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: min(420px, calc(100vw - 32px));

    /* The stack spans a wide strip most of which is empty. Letting it take
       pointer input would put an invisible bar across the top of the map. */
    pointer-events: none;
  }

  .notice {
    position: relative;
    width: 100%;
    pointer-events: auto;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 12px 16px;
    text-align: center;

    background: linear-gradient(160deg, rgba(11, 42, 60, 0.9), rgba(3, 14, 22, 0.94));
    border: 1px solid var(--fusion-sw-accent-line);
    box-shadow: 0 0 40px var(--fusion-sw-accent-halo);
    backdrop-filter: blur(5px);
    color: var(--fusion-sw-ink);
    font-family: var(--fusion-sw-font);
  }

  .notice:focus-visible {
    outline: 2px solid var(--fusion-sw-accent);
    outline-offset: 2px;
  }

  .corner {
    position: absolute;
    width: 13px;
    height: 13px;
    border: var(--fusion-sw-corner-rule) solid var(--fusion-sw-accent);
    pointer-events: none;
  }
  .corner.tl {
    top: -1px;
    left: -1px;
    border-right: 0;
    border-bottom: 0;
  }
  .corner.tr {
    top: -1px;
    right: -1px;
    border-left: 0;
    border-bottom: 0;
  }
  .corner.bl {
    bottom: -1px;
    left: -1px;
    border-right: 0;
    border-top: 0;
  }
  .corner.br {
    bottom: -1px;
    right: -1px;
    border-left: 0;
    border-top: 0;
  }

  .kicker {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: var(--fusion-sw-track-title);
    text-transform: uppercase;
    color: var(--fusion-sw-accent);
    text-shadow: 0 0 12px var(--fusion-sw-accent-glow);
  }

  .title {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #fff;
  }

  .body {
    font-size: 12.6px;
    line-height: 1.6;
    color: var(--fusion-sw-ink);
  }

  .life {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    background: var(--fusion-sw-accent);
    opacity: 0.5;
    width: 100%;
    transform-origin: left center;
    animation: fusion-sw-drain linear forwards;
  }

  @keyframes fusion-sw-drain {
    from {
      transform: scaleX(1);
    }
    to {
      transform: scaleX(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .life {
      animation: none;
    }
  }

  /* ---- tones -------------------------------------------------------------- */
  .notice {
    --fusion-sw-accent: var(--fusion-sw-blue);
    --fusion-sw-accent-glow: var(--fusion-sw-blue-glow);
    --fusion-sw-accent-line: rgba(87, 200, 255, 0.5);
    --fusion-sw-accent-halo: rgba(87, 200, 255, 0.2);
  }
  .notice.tone-rumour {
    --fusion-sw-accent: var(--fusion-sw-gold);
    --fusion-sw-accent-glow: rgba(255, 209, 102, 0.7);
    --fusion-sw-accent-line: rgba(255, 209, 102, 0.55);
    --fusion-sw-accent-halo: rgba(255, 209, 102, 0.22);
    background: linear-gradient(160deg, rgba(60, 44, 12, 0.9), rgba(14, 9, 2, 0.94));
  }
  .notice.tone-good {
    --fusion-sw-accent: var(--fusion-sw-ok);
    --fusion-sw-accent-glow: rgba(94, 242, 164, 0.6);
    --fusion-sw-accent-line: rgba(94, 242, 164, 0.5);
    --fusion-sw-accent-halo: rgba(94, 242, 164, 0.2);
    background: linear-gradient(160deg, rgba(9, 48, 33, 0.88), rgba(2, 14, 9, 0.94));
  }
  .notice.tone-bad {
    --fusion-sw-accent: var(--fusion-sw-bad);
    --fusion-sw-accent-glow: rgba(255, 92, 122, 0.6);
    --fusion-sw-accent-line: rgba(255, 92, 122, 0.5);
    --fusion-sw-accent-halo: rgba(255, 92, 122, 0.2);
    background: linear-gradient(160deg, rgba(58, 10, 22, 0.9), rgba(16, 2, 6, 0.94));
  }
</style>
