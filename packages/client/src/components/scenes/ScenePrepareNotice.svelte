<script lang="ts">
  /**
   * ScenePrepareNotice.svelte — the persistent warning of a prepare (REQ-CEN-052).
   *
   * While the Master is preparing a scene, his canvas is showing something the table is
   * not. That is a useful state and a dangerous one: the failure mode of spec 44 is
   * exactly forgetting it. So the notice is PERSISTENT — no auto-dismiss, no timer — it
   * names the scene the table is actually watching, and it carries the only two ways out:
   * put the prepared scene on air (REQ-CEN-040/044) or leave the prepare (REQ-CEN-053).
   *
   * The rule lives in `lib/scenes/prepareState.svelte.ts`; this file is markup plus the
   * error surface of a refused activation (REQ-CEN-045). Leaving the prepare goes through
   * `exitScenePrepare`, which takes no socket — no write leaves the client (RNF-CEN-03).
   */

  import type { Socket } from "socket.io-client";
  import { t } from "../../lib/i18n/i18n.js";
  import { OpError } from "../../lib/scenes/sceneController.js";
  import {
    SCENE_PREPARE_KEYS,
    exitScenePrepare,
    putPreparedSceneOnAir,
    type ScenePrepareNoticeVM,
  } from "../../lib/scenes/prepareState.svelte.js";

  const { notice, socket }: { notice: ScenePrepareNoticeVM; socket: Socket | null } = $props();

  /** In flight — disables both actions instead of pretending the swap already happened. */
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function handlePutOnAir(): Promise<void> {
    if (busy || socket === null) return;
    busy = true;
    error = null;
    try {
      await putPreparedSceneOnAir(socket, notice.preparedSceneId);
    } catch (err) {
      // REQ-CEN-045: the failure is said out loud and the prepare stays where it was.
      error = err instanceof OpError ? err.message : t(SCENE_PREPARE_KEYS.failed);
    } finally {
      busy = false;
    }
  }
</script>

<aside
  class="scene-prepare"
  role="status"
  aria-live="polite"
  aria-label={t(notice.labelKey)}
  data-prepared-scene={notice.preparedSceneId}
>
  <!-- Drawn glyph (REQ-NPC-094): a workbench square with a corner cut, meaning "off
       stage". Never an emoji. -->
  <svg
    class="scene-prepare__icon"
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M2.5 3.5h11v9h-11z" />
    <path d="M2.5 6.5h11" />
    <path d="M6 9.5h4" />
  </svg>

  <div class="scene-prepare__text">
    <span class="scene-prepare__title">{t(notice.title.key, notice.title.vars)}</span>
    <!-- REQ-CEN-052: what the TABLE is watching, named — that is the whole reason the
         notice exists. -->
    <span class="scene-prepare__on-air">{t(notice.onAir.key, notice.onAir.vars)}</span>
    {#if error}
      <span class="scene-prepare__error" role="alert">{error}</span>
    {/if}
  </div>

  <div class="scene-prepare__actions">
    <button
      class="btn btn--primary btn--sm"
      disabled={busy || socket === null}
      onclick={handlePutOnAir}
    >
      {t(notice.putOnAirKey)}
    </button>
    <button class="btn btn--ghost btn--sm" disabled={busy} onclick={exitScenePrepare}>
      {t(notice.exitKey)}
    </button>
  </div>
</aside>

<style>
  /* Anchored to the canvas, above the no-scene overlay's plane but below the windows:
     it is a state of the canvas, not a dialog, and it never blocks the map. */
  .scene-prepare {
    align-items: center;
    background: rgba(24, 24, 31, 0.9);
    backdrop-filter: blur(8px);
    border: 1px solid var(--fusion-accent);
    border-radius: var(--fusion-radius-lg);
    bottom: 1.25rem;
    display: flex;
    gap: 0.75rem;
    left: 50%;
    max-width: min(32rem, calc(100vw - 2rem));
    padding: 0.6rem 0.9rem;
    pointer-events: auto;
    position: absolute;
    transform: translateX(-50%);
    z-index: 60;
  }

  .scene-prepare__icon {
    color: var(--fusion-accent);
    flex-shrink: 0;
  }

  .scene-prepare__text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .scene-prepare__title {
    color: var(--fusion-text);
    font-size: 0.8125rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scene-prepare__on-air {
    color: var(--fusion-text-muted);
    font-size: 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scene-prepare__error {
    color: var(--fusion-danger);
    font-size: 0.75rem;
  }

  .scene-prepare__actions {
    display: flex;
    flex-shrink: 0;
    gap: 0.35rem;
  }
</style>
