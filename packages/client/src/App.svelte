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

  onMount(async () => {
    await sessionActions.load();
  });
</script>

<div class="fusion-shell">
  {#if session.screen === "loading"}
    <!-- Loading / session-restore splash -->
    <div class="loading-screen" role="status" aria-live="polite">
      <span class="loading-screen__dot" aria-hidden="true"></span>
      <span class="loading-screen__label">Loading…</span>
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

  /* Minimal full-screen loading indicator */
  .loading-screen {
    align-items: center;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    height: 100%;
    justify-content: center;
  }

  .loading-screen__dot {
    animation: spin 0.8s linear infinite;
    border: 2px solid var(--fusion-border);
    border-top-color: var(--fusion-accent);
    border-radius: 50%;
    display: block;
    height: 28px;
    width: 28px;
  }

  .loading-screen__label {
    color: var(--fusion-text-subtle);
    font-size: 0.8125rem;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
