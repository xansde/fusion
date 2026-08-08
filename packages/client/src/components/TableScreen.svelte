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

  import { onMount, onDestroy, untrack } from "svelte";
  import { session, sessionActions } from "../lib/session.svelte.js";
  import { FusionCanvas } from "../lib/canvas/FusionCanvas.js";
  import { loadDevScene } from "../lib/canvas/dev-scene.js";
  import { loadSceneDocument } from "../lib/canvas/sceneLoader.js";
  import { canLoadScene } from "../lib/canvas/canvasReadyGate.js";
  import { activeSceneState } from "../lib/docs/activeScene.svelte.js";
  import { sceneReloadKey } from "../lib/canvas/sceneReloadKey.js";
  import {
    attachCombatSync,
    combatActions,
    getTargetingState,
  } from "../lib/combat/combatStore.svelte.js";
  import { isTargetedByUser } from "../lib/combat/targeting.js";
  import { attachChatSync, attachChatMessageSync } from "../lib/chat/chatStore.svelte.js";
  import AppSidebar from "./chat/AppSidebar.svelte";
  import ActiveSceneBadge from "./scenes/ActiveSceneBadge.svelte";
  import NoSceneOverlay from "./scenes/NoSceneOverlay.svelte";
  import WindowHost from "./windows/WindowHost.svelte";
  import HubLayer from "./hub/HubLayer.svelte";
  import { getSocket } from "../lib/session.svelte.js";
  import { SceneOrchestrator } from "../lib/canvas/scene-orchestrator.js";
  import { TokenLayer } from "../lib/canvas/tokens/TokenLayer.js";
  import { TokenInteractionManager } from "../lib/canvas/tokens/TokenInteractionManager.js";
  import { resolveOwnedActorIds } from "../lib/canvas/tokens/ownedActors.js";
  import { attachRuler } from "../lib/presence/attachRuler.js";
  import { attachPing } from "../lib/presence/attachPing.js";
  import { attachPresenceSync } from "../lib/presence/attachPresenceSync.js";
  import GridCalibrationPanel from "./scenes/GridCalibrationPanel.svelte";
  import SceneImagesPanel from "./scenes/SceneImagesPanel.svelte";
  import { TileLayer } from "../lib/canvas/TileLayer.js";
  import { resolveAssetUrl } from "../lib/assets/assetApi.js";
  import { fusionApi } from "../lib/api.js";
  import { LightingRenderer } from "../lib/canvas/vision/LightingRenderer.js";
  import { FogState } from "../lib/canvas/vision/fog-state.js";
  import { CombatCanvasController } from "../lib/canvas/combat/combatCanvasController.js";
  import { worldMirror } from "../lib/docs/worldSync.js";
  import { registerPf2eSheets } from "../lib/sheets/pf2e/registerPf2eSheets.js";
  import { registerEtmosSheets } from "../lib/sheets/etmos/registerEtmosSheets.js";
  import type { ActorDragPayload } from "../lib/actors/actorDirectory.js";
  import { buildTokenDropPayload, canAcceptCanvasDrop } from "../lib/canvas/tokens/tokenDrop.js";
  import { importToWorld as compendiumImportToWorld } from "../lib/compendium/compendiumApi.js";
  import type { CompendiumDragPayload } from "../lib/compendium/compendiumBrowser.js";
  import type { SceneDocument, TokenDocument } from "@fusion/shared";
  import { t } from "../lib/i18n/i18n.js";
  import { sendOp } from "../lib/docs/sendOp.js";
  import TokenConfigDialog from "./scenes/TokenConfigDialog.svelte";

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

  // ---- SceneOrchestrator lifecycle ----
  // One orchestrator per active scene. Created on scene activation, torn down on switch.
  let sceneOrchestrator: SceneOrchestrator | null = null;

  // Disposer for the PIXI ticker callback registered in _createOrchestrator.
  // Stored here so _teardownOrchestrator and onDestroy can remove it cleanly,
  // preventing accumulation of stale callbacks across scene switches (leak fix).
  let _tickerDisposer: (() => void) | null = null;

  // Token interaction (drag, select, arrow-key move). One per active scene,
  // destroyed on scene switch so its window keyboard listener does not leak.
  //
  // WIRING GAP (found live on 2026-08-07): TokenInteractionManager existed with
  // full tests since M1-C but was never CONSTRUCTED in production — TokenSprite
  // set eventMode="static" and nobody subscribed. Tokens rendered and could not
  // be moved by anyone. Same class of gap as the ruler and the target marker:
  // the chain of code existed, the user's gesture did not.
  let tokenInteraction: TokenInteractionManager | null = null;

  // Ruler (hold R, Ctrl+click adds a waypoint). Same wiring gap as the tokens:
  // RulerStateMachine had tests and no gesture, so nobody could ever start one
  // — and since nobody started one, the remote-ruler receive path never ran
  // either. Disposer removes the window listeners on scene switch.
  let disposeRuler: (() => void) | null = null;

  // Map ping (press and hold). Third instance of the same gap: emitPing() and
  // the server's rate-limited rebroadcast shipped in M1-E with zero callers,
  // and nothing ever drew presenceState.pings either.
  let disposePing: (() => void) | null = null;

  // The ephemeral receive path itself. attachPresenceSync() was never called
  // anywhere, so no remote cursor, ping or ruler ever reached the store — the
  // socket listener for "ephemeral" simply was not registered.
  let disposePresence: (() => void) | null = null;

  // Grid calibration tool. Holds the canvas instance rather than a boolean so
  // the panel can only ever mount with a live canvas — `fusionCanvas` itself
  // is not reactive state, so the template cannot depend on it directly.
  let calibrationCanvas: FusionCanvas | null = $state(null);

  function openGridCalibration(): void {
    if (fusionCanvas && activeSceneState.scene) calibrationCanvas = fusionCanvas;
  }

  function closeGridCalibration(): void {
    calibrationCanvas = null;
  }

  // Scene images panel (GM): which images the scene is composed of and when
  // each one appears.
  let showingSceneImages = $state(false);

  // Token being configured via double-click (TokenConfigDialog). null when no
  // dialog is open. Set by TokenInteractionManager's onConfigureToken callback.
  let configuringToken: TokenDocument | null = $state(null);

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
    if (!activeSceneState.scene) return;
    // Decide from `types` only: getData() is blanked during dragover by the
    // drag data store's protected mode, so reading it here always looked like
    // "not a drag we handle" and preventDefault() never ran — which is what
    // stopped the browser from ever firing `drop`. See canAcceptCanvasDrop.
    if (!canAcceptCanvasDrop(event.dataTransfer?.types)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  function handleCanvasDrop(event: DragEvent): void {
    if (!isGm()) return;
    const scene = activeSceneState.scene;
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
      const payload = buildTokenDropPayload({
        payload: actorPayload,
        sceneId: scene._id,
        x: worldX,
        y: worldY,
        gridSize,
      });
      sendOp(sock, { type: "doc:create", payload }).catch((err: unknown) => {
        console.warn("[TableScreen] token creation rejected:", err);
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
          // Build a minimal actor payload to reuse buildTokenDropPayload
          const fakePayload: ActorDragPayload = {
            kind: "actor",
            uuid: createdId,
            documentType: "Actor",
            subtype: compPayload.subtype ?? "npc",
            name: compPayload.name,
            img: compPayload.img,
            origin: "sidebar",
          };
          const payload = buildTokenDropPayload({
            payload: fakePayload,
            sceneId: scene._id,
            x: worldX,
            y: worldY,
            gridSize,
          });
          await sendOp(sock, { type: "doc:create", payload });
        } catch (err) {
          console.warn("[TableScreen] token creation rejected (compendium actor):", err);
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
  // Only the fields loadSceneDocument() actually reads. Tokens, walls and
  // lights are EMBEDDED in the Scene document, so the mirror hands out a new
  // SceneDocument on every one of their updates; depending on the object itself
  // made a single token drag reload the whole scene — destroying the background
  // and re-awaiting Assets.load() per position update, which is exactly why the
  // map blinked out while dragging.
  const reloadKey = $derived(sceneReloadKey(activeSceneState.scene));

  $effect(() => {
    // reloadKey is the ONLY scene dependency of this effect, on purpose.
    void reloadKey;

    const canvas = fusionCanvas;
    if (!canLoadScene(canvas !== null, canvasReady)) return;
    // canLoadScene(true, ...) guarantees canvas !== null — narrow for TS.
    if (!canvas) return;

    // Read untracked: we want the current document, not a dependency on it.
    const scene = untrack(() => activeSceneState.scene);

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
    // REQ-VIS-085: FogState only exists when the scene actually wants fog.
    // tokenVision off ⇒ players see the whole map (no mask at all);
    // tokenVision on + fogEnabled off ⇒ simple vision mask, no accumulation.
    // Same runtime-absence risk as `grid` (see sceneReloadKey.ts) — read defensively.
    const tokenVisionOn = scene.tokenVision ?? false;
    const fogEnabledOn = scene.fogEnabled ?? false;
    let fogState: FogState | null = null;
    if (!currentIsGm && sock && tokenVisionOn && fogEnabledOn) {
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

    // --- TokenInteractionManager (drag, select, arrow-key move) ---
    // Needs a socket to send ops and the scene's grid to snap. Both come from
    // state that already exists at this point: loadSceneDocument() ran and
    // installed the grid strategy on the canvas before this function is called.
    const grid = canvas.gridStrategy;
    const userRole = session.user?.role ?? 1;
    const tokensLayer = canvas.getLayer("tokens");

    // Wrapped: a failure to wire interaction must not take vision, fog and
    // combat down with it. Before this guard, anything thrown here escaped to
    // the caller's catch and the whole orchestrator was silently skipped.
    try {
      if (sock && grid) {
        tokenInteraction = new TokenInteractionManager({
          tokenContainer: tokensLayer,
          tokenLayer,
          mirror: worldMirror,
          sceneId: scene._id,
          canvas,
          socket: sock,
          userId,
          userRole,
          ownedActorIds: resolveOwnedActorIds(worldMirror, userId, userRole),
          // PERMISSION-LIVE FIX: re-resolved on every check instead of the
          // static snapshot above, so a GM granting ownership mid-session
          // unlocks the token for the player without a scene reload — see
          // TokenInteractionOptions.getOwnedActorIds's doc comment.
          getOwnedActorIds: () => resolveOwnedActorIds(worldMirror, userId, userRole),
          grid,
          // Targeting port for the right-click gesture. Built here — and not
          // imported inside the manager — so the PIXI layer keeps no Svelte
          // dependency. The socket carries an absolute boolean, so the client
          // reads its own state and sends the opposite; the server resolves
          // the acting user from the socket and echoes the truth back.
          targeting: {
            isTargetedByMe: (tokenId: string) =>
              isTargetedByUser(getTargetingState(), tokenId, userId),
            toggle: (tokenId: string, targeted: boolean) =>
              combatActions.target(sock, tokenId, targeted),
          },
          onError: (msg) => {
            console.warn("[TableScreen] token move rejected:", msg);
          },
          // Double-click a token to open TokenConfigDialog (Appearance / vision / light).
          onConfigureToken: (token) => {
            configuringToken = token;
          },
        });
      }
    } catch (err) {
      console.error("[TableScreen] token interaction failed to wire:", err);
    }

    // One line that says whether the canvas is actually operable. Three
    // features have shipped unreachable here; "did it wire?" should not need a
    // debugger to answer.
    console.info("[TableScreen] canvas wiring:", {
      tokenInteraction: tokenInteraction !== null,
      socket: sock !== null,
      gridStrategy: grid !== null,
      gridSize: grid?.config.size ?? null,
      userRole,
      ownedActors: resolveOwnedActorIds(worldMirror, userId, userRole).size,
      tokensLayerEventMode: tokensLayer.eventMode,
      tokensInLayer: tokensLayer.children.length,
      stageEventMode: canvas.stageEventMode,
    });

    // --- Ruler (hold R) ---
    // Works without a socket: measuring is local, only the broadcast needs one.
    try {
      if (grid) {
        disposeRuler = attachRuler({
          canvas,
          grid,
          layer: canvas.getLayer("controls"),
          socket: sock,
        });
      }
    } catch (err) {
      console.error("[TableScreen] ruler failed to wire:", err);
    }

    // --- Ephemeral receive path (cursors, pings, rulers of other users) ---
    // Must come before attachPing: without this listener the server's echo of
    // our own ping never arrives and the ripple never appears.
    try {
      if (sock) disposePresence = attachPresenceSync(sock);
    } catch (err) {
      console.error("[TableScreen] presence sync failed to wire:", err);
    }

    // --- Ping (press and hold on the map) ---
    // Works without a socket too: the ping is then drawn locally only.
    try {
      disposePing = attachPing({
        canvas,
        layer: canvas.getLayer("controls"),
        socket: sock,
        cellPx: gridSize,
        userId,
      });
    } catch (err) {
      console.error("[TableScreen] ping failed to wire:", err);
    }

    // --- Tiles (the extra images a scene is composed from) ---
    // Signed asset URLs expire, so the resolver runs per load rather than the
    // path being stored resolved. Players never receive hidden tiles at all.
    const tileLayer = new TileLayer(canvas.getLayer("tiles"), async (path) => {
      const accessToken = fusionApi.getToken();
      const tileUserId = session.user?.id;
      if (!accessToken || !tileUserId) return path;
      return resolveAssetUrl(path, accessToken, tileUserId);
    });

    return new SceneOrchestrator({
      scene,
      mirror: worldMirror,
      isGm: currentIsGm,
      userId,
      tokenLayer,
      lightingRenderer,
      fogState,
      combatController,
      tileLayer,
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

    // Destroy BEFORE the orchestrator: the manager holds a window keydown
    // listener and PIXI handlers on token sprites the orchestrator is about to
    // tear down. Leaving it alive across a scene switch stacks one listener per
    // scene and points them at destroyed sprites.
    tokenInteraction?.destroy();
    tokenInteraction = null;

    disposeRuler?.();
    disposeRuler = null;

    disposePing?.();
    disposePing = null;

    disposePresence?.();
    disposePresence = null;

    if (sceneOrchestrator) {
      sceneOrchestrator.teardown();
      sceneOrchestrator = null;
    }

    // A scene switch invalidates any open TokenConfigDialog — its token no
    // longer belongs to the (about to be destroyed) interaction manager.
    configuringToken = null;
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

  <!-- No-scene overlay: shown when no active scene -->
  {#if !activeSceneState.scene}
    <NoSceneOverlay isGm={isGm()} />
  {/if}

  <!-- Scene images: which images compose the scene and when each appears -->
  {#if showingSceneImages && activeSceneState.scene}
    <SceneImagesPanel
      scene={activeSceneState.scene}
      socket={getSocket()}
      onClose={() => {
        showingSceneImages = false;
      }}
    />
  {/if}

  <!-- Grid calibration: box on the map + panel with the derived numbers -->
  {#if calibrationCanvas && activeSceneState.scene}
    <GridCalibrationPanel
      canvas={calibrationCanvas}
      sceneId={activeSceneState.scene._id}
      cellPx={activeSceneState.scene.grid?.size ?? 100}
      socket={getSocket()}
      onClose={closeGridCalibration}
    />
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

    <!-- Scene images + grid calibration (GM, with an active scene) -->
    {#if isGm() && activeSceneState.scene}
      <button
        class="btn btn--ghost btn--sm"
        onclick={() => {
          showingSceneImages = !showingSceneImages;
        }}
        aria-pressed={showingSceneImages}
      >
        {t("FUSION.Scene.Images.Open")}
      </button>
    {/if}
    {#if isGm() && activeSceneState.scene && canvasReady}
      <button
        class="btn btn--ghost btn--sm"
        onclick={openGridCalibration}
        disabled={calibrationCanvas !== null}
      >
        {t("FUSION.Scene.Calibrate.Open")}
      </button>
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

  <!-- -------------------------------------------------------------------- -->
  <!-- Window Host — floating windows and dialogs (M3-C)                    -->
  <!-- REQ-UIF-009..016: window manager registry mounted here once.          -->
  <!-- pointer-events: none on the host; individual windows restore them.    -->
  <!-- -------------------------------------------------------------------- -->
  <WindowHost />

  <!-- -------------------------------------------------------------------- -->
  <!-- Hub layer — player Hub overlay (spec 28)                             -->
  <!-- Last in the shell and in the `--fusion-z-hub` band, so it paints over -->
  <!-- canvas, regions and windows. The host is pointer-events: none; only   -->
  <!-- `.hub-surface` descendants take input, so clicks on empty Hub space   -->
  <!-- fall through to the map.                                              -->
  <!-- -------------------------------------------------------------------- -->
  <HubLayer />

  <!-- -------------------------------------------------------------------- -->
  <!-- Token config dialog — opened by double-clicking a token on the       -->
  <!-- canvas (TokenInteractionManager's onConfigureToken callback).         -->
  <!-- -------------------------------------------------------------------- -->
  {#if configuringToken && activeSceneState.scene && getSocket()}
    <TokenConfigDialog
      sceneId={activeSceneState.scene._id}
      token={configuringToken}
      socket={getSocket()!}
      onClose={() => { configuringToken = null; }}
      onSuccess={() => { configuringToken = null; }}
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
    /* REQ-UIF-008: anchored shell region — value comes from the layer scale
       in base.css, not a literal. */
    z-index: var(--fusion-z-region);
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
