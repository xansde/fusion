<script lang="ts">
  /**
   * TableScreen.svelte — post-login "table" screen with PIXI canvas.
   *
   * M1-A: Canvas occupies the full screen; header is an overlay on top.
   * The FusionCanvas is initialized when the component mounts and destroyed
   * on unmount (important for Vite HMR — prevents PIXI leaks).
   *
   * M1-B (SCENE-UI): GM sidebar with Scenes tab. Players see no sidebar but
   * receive the NoSceneOverlay while waiting for the GM to activate a scene.
   *
   * M1-D (CHAT): AppSidebar replaces ScenesSidebar; adds Chat tab for all users.
   *
   * REQ-CNV-001: WebGPU with automatic WebGL fallback.
   * REQ-CNV-006: Render group for camera transform.
   * REQ-CNV-007: Pan (middle-button / Space+drag) and zoom (scroll).
   * Debug overlay: F9 toggles renderer/fps/camera/cell info.
   */

  import { onMount, onDestroy } from "svelte";
  import { session, sessionActions } from "../lib/session.svelte.js";
  import { FusionCanvas } from "../lib/canvas/FusionCanvas.js";
  import { loadDevScene } from "../lib/canvas/dev-scene.js";
  import { loadSceneDocument } from "../lib/canvas/sceneLoader.js";
  import { activeSceneState } from "../lib/docs/activeScene.svelte.js";
  import { attachCombatSync } from "../lib/combat/combatStore.svelte.js";
  import AppSidebar from "./chat/AppSidebar.svelte";
  import ActiveSceneBadge from "./scenes/ActiveSceneBadge.svelte";
  import NoSceneOverlay from "./scenes/NoSceneOverlay.svelte";
  import { getSocket } from "../lib/session.svelte.js";

  let loggingOut = $state(false);
  let canvasContainer: HTMLElement | null = $state(null);
  let fusionCanvas: FusionCanvas | null = null;
  let cleanupScene: (() => void) | null = null;
  let cleanupCombatSync: (() => void) | null = null;
  // Debug overlay is toggled internally by F9 inside FusionCanvas.toggleDebug().

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

  /** True when the logged-in user is the GM (role 4). */
  const isGm = $derived(() => (session.user?.role ?? 0) === 4);

  // ---- Canvas lifecycle ----

  onMount(async () => {
    if (!canvasContainer) return;

    const canvas = new FusionCanvas({ container: canvasContainer });
    fusionCanvas = canvas;

    try {
      await canvas.init();
      // Load initial scene: use real scene doc if available, else dev-scene fallback
      cleanupScene = await _loadCurrentScene(canvas);
    } catch (err) {
      console.error("[TableScreen] Canvas init failed:", err);
    }

    // Attach combat sync (combat:turnChange events for the canvas turn marker)
    const sock = getSocket();
    if (sock) {
      cleanupCombatSync?.();
      cleanupCombatSync = attachCombatSync(sock);
    }
  });

  onDestroy(() => {
    cleanupScene?.();
    cleanupCombatSync?.();
    fusionCanvas?.destroy();
    fusionCanvas = null;
    cleanupScene = null;
    cleanupCombatSync = null;
  });

  /**
   * React to active scene changes.
   * When activeSceneState.scene changes, reload the canvas content.
   * Runs in a $effect so it re-executes reactively.
   *
   * M1-B: When no scene is active, we clear the canvas and let NoSceneOverlay
   * handle the UI (no more dev-scene fallback in production paths).
   */
  $effect(() => {
    const canvas = fusionCanvas;
    if (!canvas) return;

    const scene = activeSceneState.scene;

    // Cleanup previous scene content
    cleanupScene?.();
    cleanupScene = null;

    void (async () => {
      try {
        if (scene) {
          cleanupScene = await loadSceneDocument(canvas, scene);
        }
        // When no active scene: canvas remains empty; NoSceneOverlay is shown
        // by the Svelte template. Dev-scene is only used in initial mount
        // fallback (see _loadCurrentScene below).
      } catch (err) {
        console.error("[TableScreen] Scene load failed:", err);
      }
    })();
  });

  async function _loadCurrentScene(canvas: FusionCanvas): Promise<() => void> {
    const scene = activeSceneState.scene;
    if (scene) {
      return loadSceneDocument(canvas, scene);
    }
    // Initial mount: if no active scene yet, fall back to dev-scene so the
    // canvas shows something while waiting for the world snapshot.
    return loadDevScene(canvas);
  }
</script>

<!-- ========================================================================
  Layout: canvas fills the viewport, header floats on top as an overlay.
  REQ-CNV spec: canvas occupies full screen, header is overlay.
========================================================================= -->
<div class="table-shell">

  <!-- Canvas host — PIXI mounts its <canvas> inside this -->
  <div
    class="canvas-host"
    bind:this={canvasContainer}
    aria-label="Game canvas"
    role="img"
  ></div>

  <!-- No-scene overlay: shown when no active scene -->
  {#if !activeSceneState.scene}
    <NoSceneOverlay isGm={isGm()} />
  {/if}

  <!-- -------------------------------------------------------------------- -->
  <!-- Header overlay                                                        -->
  <!-- -------------------------------------------------------------------- -->
  <header class="table-header">
    <!-- World name -->
    <div class="table-header__world">
      <span class="table-header__world-icon" aria-hidden="true">&#9889;</span>
      <span class="table-header__world-name">
        {session.worldInfo?.title ?? "Fusion VTT"}
      </span>
    </div>

    <!-- Active scene badge (centre area) -->
    <ActiveSceneBadge scene={activeSceneState.scene} />

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
  <!-- App sidebar — Scenes tab (GM) + Chat tab (all users)                 -->
  <!-- -------------------------------------------------------------------- -->
  {#if getSocket()}
    {@const sock = getSocket()!}
    <AppSidebar
      socket={sock}
      worldId={session.worldInfo?.id ?? ""}
      activeSceneId={activeSceneState.id}
      isGm={isGm()}
      userId={session.user?.id ?? ""}
    />
  {/if}

</div>

<style>
  .table-shell {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background-color: var(--fusion-bg);
  }

  /* Canvas host fills the entire shell */
  .canvas-host {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  /* ---- Header overlay ---- */
  .table-header {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    align-items: center;
    background: rgba(24, 24, 31, 0.85);
    backdrop-filter: blur(6px);
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
</style>
