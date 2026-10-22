<script lang="ts">
  /**
   * App.svelte — root shell (Svelte 5 runes).
   *
   * Orchestrates screens: loading → join → table, with a "management"
   * branch when the server is up but no world is open yet (see
   * ManagementScreen.svelte and session.svelte.ts's sessionActions.load()).
   * Session state lives in src/lib/session.svelte.ts.
   *
   * M0-C: real auth + WebSocket join flow.
   * M1-A will replace the TableScreen placeholder with PIXI canvas.
   *
   * REQ-ARQ-003: no imports from @fusion/server.
   * REQ-SEC-014: access token kept only in memory (never localStorage).
   */

  import { onMount } from "svelte";
  import { session, sessionActions } from "./lib/session.svelte.js";
  import JoinScreen from "./components/JoinScreen.svelte";
  import TableScreen from "./components/TableScreen.svelte";
  import ManagementScreen from "./components/ManagementScreen.svelte";
  import FusionMark from "./components/common/FusionMark.svelte";
  import { t } from "./lib/i18n/i18n.js";

  onMount(async () => {
    await sessionActions.load();
  });
</script>

<div class="fusion-shell">
  {#if session.screen === "loading"}
    <!-- Loading / session-restore splash -->
    <div class="loading-screen" role="status" aria-live="polite">
      <span class="loading-screen__mark" aria-hidden="true"><FusionMark size={40} /></span>
      <span class="loading-screen__label">{t("FUSION.App.Loading")}</span>
    </div>

  {:else if session.screen === "join"}
    <JoinScreen />

  {:else if session.screen === "management"}
    <ManagementScreen />

  {:else if session.screen === "table"}
    <TableScreen />
  {/if}
</div>

<style>
  .fusion-shell {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  /* Minimal full-screen loading indicator: the mark breathes (no spinner);
     reduced motion keeps it still (base.css switches animations off). */
  .loading-screen {
    align-items: center;
    background: var(--fusion-bg);
    color: var(--fusion-accent);
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-3);
    height: 100%;
    justify-content: center;
  }

  .loading-screen__mark {
    animation: breathe 1.6s ease-in-out infinite;
    display: inline-flex;
  }

  .loading-screen__label {
    color: var(--fusion-text-muted);
    font-size: var(--fusion-text-base);
  }

  @keyframes breathe {
    50% {
      opacity: 0.45;
    }
  }
</style>
