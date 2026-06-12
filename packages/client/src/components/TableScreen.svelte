<script lang="ts">
  /**
   * TableScreen.svelte — post-login "table" placeholder.
   *
   * Shows:
   * - Header: world name | user name + color | connection indicator + RTT
   * - Logout button
   * - Placeholder canvas area (M1-A)
   *
   * The connection state and RTT are kept reactive via session.svelte.ts
   * which feeds them from the SocketManager.
   *
   * REQ-USR-033: client tracks user online state via session store.
   * REQ-NET-046: RTT displayed via system:ping (wired in SocketManager).
   * REQ-NET-065: connection state indicator (connecting/reconnecting/connected).
   */

  import { session, sessionActions } from "../lib/session.svelte.js";

  let loggingOut = $state(false);

  async function handleLogout(): Promise<void> {
    if (loggingOut) return;
    loggingOut = true;
    try {
      await sessionActions.logout();
    } finally {
      loggingOut = false;
    }
  }

  /** Human-readable connection status */
  const connectionLabel = $derived(() => {
    switch (session.connection) {
      case "connected": return "Connected";
      case "connecting": return "Connecting…";
      case "reconnecting": return "Reconnecting…";
      case "disconnected": return "Disconnected";
      case "auth_failed": return "Auth failed";
      case "protocol_mismatch": return "Version mismatch";
      default: return session.connection;
    }
  });

  const connectionClass = $derived(() => {
    switch (session.connection) {
      case "connected": return "indicator--ok";
      case "connecting":
      case "reconnecting": return "indicator--warn";
      default: return "indicator--err";
    }
  });

  const roleLabel = $derived(() => {
    const role = session.user?.role ?? 0;
    switch (role) {
      case 4: return "GM";
      case 3: return "Assistant";
      case 2: return "Trusted";
      default: return "Player";
    }
  });
</script>

<div class="table-shell">
  <!-- -------------------------------------------------------------------- -->
  <!-- Header                                                                -->
  <!-- -------------------------------------------------------------------- -->
  <header class="table-header">
    <!-- World name -->
    <div class="table-header__world">
      <span class="table-header__world-icon" aria-hidden="true">&#9889;</span>
      <span class="table-header__world-name">
        {session.worldInfo?.title ?? "Fusion VTT"}
      </span>
    </div>

    <!-- Spacer -->
    <div class="table-header__spacer"></div>

    <!-- Connection indicator -->
    <div class="table-header__conn" aria-live="polite" aria-atomic="true">
      <span class="indicator {connectionClass()}" aria-hidden="true"></span>
      <span class="table-header__conn-label">{connectionLabel()}</span>
      {#if session.rttMs !== null && session.connection === "connected"}
        <span class="table-header__rtt">{session.rttMs}ms</span>
      {/if}
    </div>

    <!-- User badge -->
    {#if session.user}
      <div class="table-header__user">
        <span
          class="user-swatch"
          style="background-color: {session.user.color}"
          aria-hidden="true"
        ></span>
        <span class="table-header__user-name">{session.user.name}</span>
        <span class="table-header__user-role">{roleLabel()}</span>
      </div>
    {/if}

    <!-- Logout -->
    <button
      class="btn btn--ghost btn--sm"
      onclick={handleLogout}
      disabled={loggingOut}
      aria-label="Log out"
    >
      {loggingOut ? "…" : "Leave"}
    </button>
  </header>

  <!-- -------------------------------------------------------------------- -->
  <!-- Canvas placeholder (M1-A)                                            -->
  <!-- -------------------------------------------------------------------- -->
  <main class="table-canvas" aria-label="Game canvas — coming in M1-A">
    <div class="table-canvas__placeholder">
      <p class="table-canvas__title">World canvas</p>
      <p class="table-canvas__subtitle">PIXI.js integration arrives in M1-A.</p>
      {#if session.connection !== "connected"}
        <p class="table-canvas__status">
          Waiting for WebSocket connection…
        </p>
      {:else}
        <p class="table-canvas__status table-canvas__status--ok">
          WebSocket connected
        </p>
      {/if}
    </div>
  </main>
</div>

<style>
  .table-shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: var(--fusion-bg);
    overflow: hidden;
  }

  /* ---- Header ---- */
  .table-header {
    align-items: center;
    background: var(--fusion-surface);
    border-bottom: 1px solid var(--fusion-border);
    display: flex;
    flex-shrink: 0;
    gap: 0.75rem;
    height: var(--fusion-header-height);
    padding: 0 1rem;
  }

  .table-header__world {
    align-items: center;
    display: flex;
    gap: 0.4rem;
    overflow: hidden;
  }

  .table-header__world-icon {
    color: var(--fusion-accent);
    flex-shrink: 0;
    font-size: 1rem;
  }

  .table-header__world-name {
    color: var(--fusion-text);
    font-size: 0.9375rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .table-header__spacer {
    flex: 1;
  }

  /* Connection indicator */
  .table-header__conn {
    align-items: center;
    display: flex;
    gap: 0.35rem;
  }

  .indicator {
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
    height: 8px;
    width: 8px;
  }

  .indicator--ok {
    background-color: var(--fusion-success);
    box-shadow: 0 0 0 2px rgba(61, 220, 132, 0.25);
  }

  .indicator--warn {
    background-color: var(--fusion-warning);
    animation: pulse 1.4s ease-in-out infinite;
  }

  .indicator--err {
    background-color: var(--fusion-danger);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .table-header__conn-label {
    color: var(--fusion-text-muted);
    font-size: 0.75rem;
  }

  .table-header__rtt {
    color: var(--fusion-text-subtle);
    font-family: var(--fusion-font-mono);
    font-size: 0.7rem;
  }

  /* User badge */
  .table-header__user {
    align-items: center;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    display: flex;
    gap: 0.45rem;
    padding: 0.2rem 0.6rem;
  }

  .user-swatch {
    border-radius: 50%;
    display: block;
    flex-shrink: 0;
    height: 10px;
    width: 10px;
  }

  .table-header__user-name {
    color: var(--fusion-text);
    font-size: 0.8125rem;
    font-weight: 500;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .table-header__user-role {
    color: var(--fusion-text-subtle);
    font-size: 0.7rem;
  }

  /* Buttons */
  .btn {
    align-items: center;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    display: inline-flex;
    font-family: var(--fusion-font);
    font-size: 0.875rem;
    font-weight: 500;
    justify-content: center;
    padding: 0.5rem 1.25rem;
    transition: background-color var(--fusion-transition), opacity var(--fusion-transition);
    white-space: nowrap;
  }

  .btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .btn--ghost {
    background: transparent;
    border-color: var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .btn--ghost:hover:not(:disabled) {
    border-color: var(--fusion-text-muted);
    color: var(--fusion-text);
  }

  .btn--sm {
    font-size: 0.8125rem;
    padding: 0.3rem 0.75rem;
  }

  /* ---- Canvas placeholder ---- */
  .table-canvas {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .table-canvas__placeholder {
    align-items: center;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 320px;
    text-align: center;
  }

  .table-canvas__title {
    color: var(--fusion-text-muted);
    font-size: 1rem;
    font-weight: 600;
  }

  .table-canvas__subtitle {
    color: var(--fusion-text-subtle);
    font-size: 0.8125rem;
  }

  .table-canvas__status {
    color: var(--fusion-text-subtle);
    font-family: var(--fusion-font-mono);
    font-size: 0.75rem;
    margin-top: 0.5rem;
  }

  .table-canvas__status--ok {
    color: var(--fusion-success);
  }
</style>
