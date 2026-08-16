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
   * Spec 36 (gaveta lateral): the side drawer replaces the old tabbed sidebar — an icon-only
   * rail plus the panel of the active tab, with the core tabs registered through
   * `registerCoreSidebarTabs` (REQ-GAV-030).
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
  import { canLoadScene } from "../lib/canvas/canvasReadyGate.js";
  import { activeSceneState } from "../lib/docs/activeScene.svelte.js";
  import { attachCombatSync } from "../lib/combat/combatStore.svelte.js";
  import { attachChatSync, attachChatMessageSync } from "../lib/chat/chatStore.svelte.js";
  import Sidebar from "./sidebar/Sidebar.svelte";
  import { registerCoreSidebarTabs } from "../lib/sidebar/registerCoreTabs.js";
  import ActiveSceneBadge from "./scenes/ActiveSceneBadge.svelte";
  import NoSceneOverlay from "./scenes/NoSceneOverlay.svelte";
  import ScenePrepareNotice from "./scenes/ScenePrepareNotice.svelte";
  import { sceneListState } from "../lib/scenes/scenesState.svelte.js";
  import {
    buildScenePrepareNoticeVM,
    reconcileScenePrepare,
    resolveCanvasScene,
    scenePrepareState,
  } from "../lib/scenes/prepareState.svelte.js";
  import WindowHost from "./windows/WindowHost.svelte";
  import { getSocket } from "../lib/session.svelte.js";
  import { SceneOrchestrator } from "../lib/canvas/scene-orchestrator.js";
  import { TokenLayer } from "../lib/canvas/tokens/TokenLayer.js";
  import { LightingRenderer } from "../lib/canvas/vision/LightingRenderer.js";
  import { FogState } from "../lib/canvas/vision/fog-state.js";
  import { CombatCanvasController } from "../lib/canvas/combat/combatCanvasController.js";
  import { worldMirror } from "../lib/docs/worldSync.js";
  import { registerPf2eSheets } from "../lib/sheets/pf2e/registerPf2eSheets.js";
  import { registerEtmosSheets } from "../lib/sheets/etmos/registerEtmosSheets.js";
  import {
    buildTokenFromActorFields,
    type ActorDragPayload,
  } from "../lib/actors/actorDirectory.js";
  import { importToWorld as compendiumImportToWorld } from "../lib/compendium/compendiumApi.js";
  import type { CompendiumDragPayload } from "../lib/compendium/compendiumBrowser.js";
  import type { SceneDocument } from "@fusion/shared";
  import { t } from "../lib/i18n/i18n.js";

  // The seven core tabs enter the drawer through the public registration call, not
  // through an `{#if}` inside it (DEC-GAV-07 / REQ-GAV-030). It runs before the
  // drawer mounts because the drawer reads the registry to decide where this seat
  // opens (REQ-GAV-015/016), and it is idempotent, so a remount is harmless.
  registerCoreSidebarTabs();

  let loggingOut = $state(false);
  let canvasContainer: HTMLElement | null = $state(null);
  let fusionCanvas: FusionCanvas | null = null;
  let cleanupScene: (() => void) | null = null;
  let cleanupCombatSync: (() => void) | null = null;
  let cleanupChatSync: (() => void) | null = null;
  let cleanupChatMessageSync: (() => void) | null = null;
  // Debug overlay is toggled internally by F9 inside FusionCanvas.toggleDebug().

  // BUG FIX (race): the scene-reload $effect below reacts to activeSceneState.scene
  // and calls loadSceneDocument(canvas, scene) → canvas.getLayer("background"), which
  // throws "Layer not found" if the PIXI layer hierarchy hasn't been built yet.
  // $effect runs synchronously after first render — BEFORE onMount's `await
  // canvas.init()` resolves — so activating a scene during that window raced ahead of
  // _buildHierarchy() and the background never rendered. canvasReady is flipped to
  // true only once init() has resolved; the $effect is gated on it so no
  // loadSceneDocument call can reach the canvas before its layers exist.
  let canvasReady = $state(false);

  // ---- What THIS canvas draws (spec 44 §5.6, DEC-CEN-03) ----
  // Normally the scene on air. While this Master is preparing a scene, it is the
  // prepared one instead — a local swap that changes nobody else's screen and writes
  // nothing to the server (REQ-CEN-050/051, RNF-CEN-03). Everything below that used to
  // read `activeSceneState.scene` for "what is under the cursor" reads this.
  const canvasScene = $derived(
    resolveCanvasScene({
      activeScene: activeSceneState.scene,
      scenes: sceneListState.scenes,
      prepareSceneId: scenePrepareState.sceneId,
    }),
  );

  /** The persistent notice of REQ-CEN-052 — `null` whenever there is no prepare. */
  const prepareNotice = $derived(
    buildScenePrepareNoticeVM({
      scenes: sceneListState.scenes,
      activeSceneId: activeSceneState.id,
      prepareSceneId: scenePrepareState.sceneId,
    }),
  );

  // REQ-CEN-054/055: a prepare stops meaning anything the moment its scene goes on air
  // (from any origin) or is deleted. This is the one owner of that rule — it ends the
  // prepare silently and the canvas falls back to the scene on air.
  $effect(() => {
    reconcileScenePrepare({
      activeSceneId: activeSceneState.id,
      sceneIds: sceneListState.scenes.map((scene) => scene._id),
    });
  });

  // ---- SceneOrchestrator lifecycle ----
  // One orchestrator per active scene. Created on scene activation, torn down on switch.
  let sceneOrchestrator: SceneOrchestrator | null = null;

  // Disposer for the PIXI ticker callback registered in _createOrchestrator.
  // Stored here so _teardownOrchestrator and onDestroy can remove it cleanly,
  // preventing accumulation of stale callbacks across scene switches (leak fix).
  let _tickerDisposer: (() => void) | null = null;

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
      case "connected": return t("FUSION.Connection.Connected");
      case "connecting": return t("FUSION.Connection.Connecting");
      case "reconnecting": return t("FUSION.Connection.Reconnecting");
      case "disconnected": return t("FUSION.Connection.Disconnected");
      case "auth_failed": return t("FUSION.Connection.AuthFailed");
      case "protocol_mismatch": return t("FUSION.Connection.ProtocolMismatch");
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
      case 4: return t("FUSION.Role.GM");
      case 3: return t("FUSION.Role.Assistant");
      case 2: return t("FUSION.Role.Trusted");
      default: return t("FUSION.Role.Player");
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
      // If there is no active scene yet (world snapshot not received, or GM hasn't
      // activated one), fall back to dev-scene so the canvas shows something.
      // A real scene is loaded by the $effect below (gated on canvasReady) once
      // activeSceneState.scene is set — never here, to avoid a double-load race.
      if (!activeSceneState.scene) {
        cleanupScene = await loadDevScene(canvas);
      }
      // Flip the gate LAST: this gets read by the reactive $effect, which will
      // (re-)run now that the PIXI layer hierarchy is guaranteed to exist.
      canvasReady = true;
    } catch (err) {
      console.error("[TableScreen] Canvas init failed:", err);
    }

    // Attach combat sync (combat:turnChange events for the canvas turn marker)
    const sock = getSocket();
    if (sock) {
      cleanupCombatSync?.();
      cleanupCombatSync = attachCombatSync(sock);

      // BUG #1 FIX: chat history load + live "op" listener are session-scoped
      // here, NOT tied to ChatPanel's mount lifecycle (see chatStore.svelte.ts
      // header comment on attachChatSync/attachChatMessageSync). Previously
      // these lived in ChatPanel's onMount/onDestroy, so leaving the chat tab
      // dropped incoming messages and reset the store.
      cleanupChatSync?.();
      cleanupChatSync = attachChatSync(sock, session.worldInfo?.id ?? "");
      cleanupChatMessageSync?.();
      cleanupChatMessageSync = attachChatMessageSync(sock);
    }

    // Register PF2e sheets once, after the Svelte runtime is ready (REQ-UIF-018..019).
    // Errors are non-fatal — the sheets simply won't be available for resolution.
    registerPf2eSheets().catch((err) => {
      console.warn("[TableScreen] registerPf2eSheets failed:", err);
    });

    // Register Etmos sheets (orador/antagonista) — same pattern as PF2e above.
    registerEtmosSheets().catch((err) => {
      console.warn("[TableScreen] registerEtmosSheets failed:", err);
    });
  });

  onDestroy(() => {
    _teardownOrchestrator();
    cleanupScene?.();
    cleanupCombatSync?.();
    cleanupChatSync?.();
    cleanupChatMessageSync?.();
    fusionCanvas?.destroy();
    fusionCanvas = null;
    cleanupScene = null;
    cleanupCombatSync = null;
    cleanupChatSync = null;
    cleanupChatMessageSync = null;
  });

  // ---- Canvas drag-and-drop (REQ-UIF-046 [MVP]) ----

  /**
   * Validate and extract the ActorDragPayload from a DragEvent.
   * Returns null if the event does not carry a valid fusion-actor payload.
   */
  function _getActorDragPayload(event: DragEvent): ActorDragPayload | null {
    const raw = event.dataTransfer?.getData("application/fusion-actor");
    if (!raw) return null;
    try {
      const payload = JSON.parse(raw) as ActorDragPayload;
      if (payload.kind !== "actor") return null;
      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Validate and extract a CompendiumDragPayload from a DragEvent.
   * Compendium entries are dragged with "text/plain" + JSON.
   * Returns null if the event does not carry a valid compendium payload.
   */
  function _getCompendiumDragPayload(event: DragEvent): CompendiumDragPayload | null {
    const raw = event.dataTransfer?.getData("text/plain");
    if (!raw) return null;
    try {
      const payload = JSON.parse(raw) as CompendiumDragPayload;
      if (payload.kind !== "compendium-actor" && payload.kind !== "compendium-item") return null;
      return payload;
    } catch {
      return null;
    }
  }

  function handleCanvasDragOver(event: DragEvent): void {
    // Only accept actor drags; only GMs can create tokens (permission gate).
    if (!isGm()) return;
    // The drop lands on the scene the Master is LOOKING at — the prepared one while a
    // prepare lasts (REQ-CEN-050), never the one on air behind his back.
    if (!canvasScene) return;
    const actorPayload = _getActorDragPayload(event);
    const compPayload = _getCompendiumDragPayload(event);
    if (!actorPayload && !compPayload) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  function handleCanvasDrop(event: DragEvent): void {
    if (!isGm()) return;
    const scene = canvasScene;
    if (!scene) return;
    const canvas = fusionCanvas;
    if (!canvas) return;

    // Convert client coords → scene (world) coords using the camera transform.
    const rect = canvasContainer!.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const cam = canvas.camera;
    const worldX = (screenX - cam.tx) / cam.scale;
    const worldY = (screenY - cam.ty) / cam.scale;

    const sock = getSocket();
    if (!sock) return;

    const actorPayload = _getActorDragPayload(event);
    if (actorPayload) {
      event.preventDefault();
      const gridSize = scene.grid?.size ?? 100;
      const fields = buildTokenFromActorFields({
        payload: actorPayload,
        sceneId: scene._id,
        x: worldX,
        y: worldY,
        gridSize,
      });
      sock.emit("op", {
        type: "doc:create",
        ts: Date.now(),
        payload: {
          documentType: "Token",
          embedded: { type: "Token", sceneId: scene._id },
          documents: [fields],
        },
      });
      return;
    }

    const compPayload = _getCompendiumDragPayload(event);
    if (compPayload && compPayload.kind === "compendium-actor") {
      event.preventDefault();
      // Import the actor to world, then create a token at the drop location.
      void (async () => {
        try {
          const result = await compendiumImportToWorld(sock, [compPayload.uuid]);
          const createdId = result.created[0];
          if (!createdId) return;
          const gridSize = scene.grid?.size ?? 100;
          // Build a minimal actor payload to reuse buildTokenFromActorFields
          const fakePayload: ActorDragPayload = {
            kind: "actor",
            uuid: createdId,
            documentType: "Actor",
            subtype: compPayload.subtype ?? "npc",
            name: compPayload.name,
            img: compPayload.img,
            origin: "sidebar",
          };
          const fields = buildTokenFromActorFields({
            payload: fakePayload,
            sceneId: scene._id,
            x: worldX,
            y: worldY,
            gridSize,
          });
          sock.emit("op", {
            type: "doc:create",
            ts: Date.now(),
            payload: {
              documentType: "Token",
              embedded: { type: "Token", sceneId: scene._id },
              documents: [fields],
            },
          });
        } catch (err) {
          console.error("[TableScreen] Failed to import compendium actor on drop:", err);
        }
      })();
    }
  }

  /**
   * React to active scene changes.
   * When activeSceneState.scene changes, reload the canvas content and
   * restart the SceneOrchestrator for the new scene.
   * Runs in a $effect so it re-executes reactively.
   *
   * M1-B: When no scene is active, we clear the canvas and let NoSceneOverlay
   * handle the UI (no more dev-scene fallback in production paths).
   *
   * M3-C: SceneOrchestrator is created/destroyed here alongside scene content.
   *
   * BUG FIX (race): gated on canvasReady so this can NEVER call
   * loadSceneDocument()/canvas.getLayer(...) before FusionCanvas.init() has
   * finished building the PIXI layer hierarchy (_buildHierarchy). Without the
   * gate, $effect runs synchronously on first render — before onMount's async
   * `await canvas.init()` resolves — so activating a scene at boot raced ahead
   * of the layers existing and getLayer("background") threw, silently dropping
   * the background render. canvasReady flips to true once (in onMount, after
   * init()), which re-triggers this effect and performs the (now safe) load —
   * covering both the "scene already active at mount" and "GM activates a
   * scene later" cases with the same code path.
   */
  $effect(() => {
    const canvas = fusionCanvas;
    if (!canLoadScene(canvas !== null, canvasReady)) return;
    // canLoadScene(true, ...) guarantees canvas !== null — narrow for TS.
    if (!canvas) return;

    // REQ-CEN-050/053: the prepared scene when there is one, the scene on air otherwise.
    const scene = canvasScene;

    // Tear down previous orchestrator before changing scene
    _teardownOrchestrator();

    // Cleanup previous scene content
    cleanupScene?.();
    cleanupScene = null;

    void (async () => {
      try {
        if (scene) {
          cleanupScene = await loadSceneDocument(canvas, scene);
          // Create and set up orchestrator for the new scene
          sceneOrchestrator = _createOrchestrator(canvas, scene);
          await sceneOrchestrator.setup();
        }
        // When no active scene: canvas remains empty; NoSceneOverlay is shown
        // by the Svelte template. Dev-scene is only used in the initial mount
        // fallback (see onMount above, before canvasReady is set).
      } catch (err) {
        console.error("[TableScreen] Scene load failed:", err);
      }
    })();
  });

  // ---- SceneOrchestrator helpers ----

  /**
   * Create a SceneOrchestrator for the given scene, wiring up all PIXI renderers.
   * Called from the $effect whenever a new scene activates.
   *
   * The orchestrator is "thin assembly" — all logic lives in the .ts modules;
   * this function just instantiates and connects them.
   *
   * M3-C: fog:get and fog:update are routed through the active socket.
   *       CombatCanvasController is wired if the canvas is available.
   *       GM gets no FogState (fog bypassed entirely).
   */
  function _createOrchestrator(canvas: FusionCanvas, scene: SceneDocument): SceneOrchestrator {
    const sock = getSocket();
    const currentIsGm = isGm();
    const userId = session.user?.id ?? "";
    const gridSize = scene.grid?.size ?? 100;

    // --- TokenLayer ---
    const tokenLayer = new TokenLayer(
      canvas.getLayer("tokens"),
      worldMirror,
      scene._id,
      gridSize,
      currentIsGm,
    );

    // Wire SceneOrchestrator tick into FusionCanvas ticker via the public API.
    // SceneOrchestrator.tick() already calls tokenLayer.tick() internally —
    // calling it here too would double-tick tokens every frame (bug fix #3).
    // The disposer is stored in _tickerDisposer so _teardownOrchestrator can
    // remove the callback and prevent accumulation across scene switches (bug fix #2).
    const tickerCb = (ticker: { deltaMS: number }) => {
      sceneOrchestrator?.tick(ticker.deltaMS, canvas.camera.scale);
    };
    _tickerDisposer = canvas.addTicker(tickerCb);

    // --- LightingRenderer ---
    const lightingRenderer = new LightingRenderer(
      canvas.getLayer("lighting"),
      scene.width,
      scene.height,
      Math.round(scene.width * scene.padding),
      Math.round(scene.height * scene.padding),
    );

    // --- FogState (player only) ---
    let fogState: FogState | null = null;
    if (!currentIsGm && sock) {
      fogState = new FogState(
        scene._id,
        userId,
        false,
        // persistFn: send fog:update op
        (payload) => {
          sock.emit("op", { type: "fog:update", ts: Date.now(), payload });
        },
        // getFn: request fog:get op via ack
        (payload) =>
          new Promise((resolve, reject) => {
            sock.emit(
              "op",
              { type: "fog:get", ts: Date.now(), payload },
              (ack: { ok: boolean; result?: unknown }) => {
                if (ack.ok) {
                  resolve(ack.result as import("@fusion/shared").FogGetResponsePayload);
                } else {
                  reject(new Error("fog:get failed"));
                }
              },
            );
          }),
      );
    }

    // --- CombatCanvasController ---
    const combatController = new CombatCanvasController(
      canvas,
      tokenLayer,
      canvas.getLayer("controls"),
      gridSize,
      currentIsGm,
      userId,
    );

    return new SceneOrchestrator({
      scene,
      mirror: worldMirror,
      isGm: currentIsGm,
      userId,
      tokenLayer,
      lightingRenderer,
      fogState,
      combatController,
    });
  }

  /**
   * Tear down the current orchestrator (flush fog, destroy PIXI objects, unsubscribe).
   * Also removes the PIXI ticker callback to prevent stale closures from accumulating
   * across scene switches (fixes ticker leak — bug fix #2).
   * Safe to call when orchestrator is null.
   */
  function _teardownOrchestrator(): void {
    // Remove the ticker callback BEFORE destroying the orchestrator so the
    // callback cannot fire against a half-destroyed tokenLayer.
    _tickerDisposer?.();
    _tickerDisposer = null;

    if (sceneOrchestrator) {
      sceneOrchestrator.teardown();
      sceneOrchestrator = null;
    }
  }
</script>

<!-- ========================================================================
  Layout: canvas fills the viewport, header floats on top as an overlay.
  REQ-CNV spec: canvas occupies full screen, header is overlay.
========================================================================= -->
<div class="table-shell">

  <!-- Canvas host — PIXI mounts its <canvas> inside this -->
  <!-- REQ-UIF-046 [MVP]: ondragover/ondrop handle actor drag-to-canvas (GM only). -->
  <div
    class="canvas-host"
    bind:this={canvasContainer}
    aria-label={t("FUSION.Header.GameCanvas")}
    role="img"
    ondragover={handleCanvasDragOver}
    ondrop={handleCanvasDrop}
  ></div>

  <!-- No-scene overlay: shown when this canvas has nothing to draw. A prepare counts as
       something to draw (REQ-CEN-050), so the Master preparing a scene with nothing on
       air sees the scene, not the waiting card. -->
  {#if !canvasScene}
    <NoSceneOverlay isGm={isGm()} />
  {/if}

  <!-- REQ-CEN-052: while a prepare lasts, the canvas keeps a persistent notice naming
       the scene the TABLE is watching, with the two ways out. -->
  {#if prepareNotice}
    <ScenePrepareNotice notice={prepareNotice} socket={getSocket()} />
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
      aria-label={t("FUSION.Header.Leave")}
    >
      {loggingOut ? t("FUSION.Header.Leaving") : t("FUSION.Header.Leave")}
    </button>
  </header>

  <!-- -------------------------------------------------------------------- -->
  <!-- Side drawer — icon rail plus the panel of the active tab (spec 36).  -->
  <!-- The rail is the same for every role; the GM group is simply absent    -->
  <!-- for a player (REQ-GAV-003, REQ-GAV-004).                              -->
  <!-- -------------------------------------------------------------------- -->
  {#if getSocket()}
    {@const sock = getSocket()!}
    <Sidebar
      socket={sock}
      worldId={session.worldInfo?.id ?? ""}
      activeSceneId={activeSceneState.id}
      isGm={isGm()}
      userId={session.user?.id ?? ""}
    />
  {/if}

  <!-- -------------------------------------------------------------------- -->
  <!-- Window Host — floating windows and dialogs (M3-C)                    -->
  <!-- REQ-UIF-009..016: window manager registry mounted here once.          -->
  <!-- pointer-events: none on the host; individual windows restore them.    -->
  <!-- -------------------------------------------------------------------- -->
  <WindowHost />

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
