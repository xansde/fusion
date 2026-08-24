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
  import { createSceneLoadGuard } from "../lib/canvas/sceneLoadGuard.js";
  import { activeSceneState } from "../lib/docs/activeScene.svelte.js";
  import { attachCombatSync } from "../lib/combat/combatStore.svelte.js";
  import { setCombatBadgeViewer } from "../lib/combat/combatBadge.svelte.js";
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
  import { ensureFootprintRegistry } from "../lib/canvas/tokens/footprintRegistry.svelte.js";
  import { initTokenDisplayPrefs } from "../lib/canvas/tokens/tokenDisplayPrefsStore.svelte.js";
  import { TokenInteractionManager } from "../lib/canvas/tokens/TokenInteractionManager.js";
  import { ownedActorIdsOf } from "../lib/combat/combatBadge.svelte.js";
  import { CombatCanvasController } from "../lib/canvas/combat/combatCanvasController.js";
  import { worldMirror } from "../lib/docs/worldSync.js";
  import { registerPf2eSheets } from "@fusion/sheets-pf2e";
  import { openTokenSheet } from "../lib/sheets/openTokenSheet.js";
  import {
    buildActorDropTokenOp,
    buildTokenFromActorFields,
    type ActorDragPayload,
  } from "../lib/actors/actorDirectory.js";
  import { buildTokenCreateOp } from "../lib/docs/tokenCreateOp.js";
  import { sendOp } from "../lib/docs/sendOp.js";
  import { importToWorld as compendiumImportToWorld } from "../lib/compendium/compendiumApi.js";
  import { decideSceneDrop } from "../lib/compendium/importTargets.js";
  import type { CompendiumDragPayload } from "../lib/compendium/compendiumBrowser.js";
  import { hasActorDragType, hasCompendiumDragType } from "../lib/canvas/canvasDragTypes.js";
  import { CANVAS_DROP_EFFECT } from "../lib/canvas/dragEffects.js";
  import { effectiveGridSize } from "../lib/canvas/sceneCoords.js";
  import type { SceneDocument } from "@fusion/shared";
  import { t } from "../lib/i18n/i18n.js";

  // The seven core tabs enter the drawer through the public registration call, not
  // through an `{#if}` inside it (DEC-GAV-07 / REQ-GAV-030). It runs before the
  // drawer mounts because the drawer reads the registry to decide where this seat
  // opens (REQ-GAV-015/016), and it is idempotent, so a remount is harmless.
  registerCoreSidebarTabs();

  // REQ-CBA-004: the Combate dot goes amber when the participant of the turn belongs
  // to this user, so the badge has to know which seat this is. Who is logged in is the
  // session's fact, and this is where the session meets the drawer — the rail itself
  // stays ignorant of every badge rule (REQ-GAV-023).
  $effect(() => {
    setCombatBadgeViewer(session.user?.id ?? null);
  });

  let loggingOut = $state(false);
  let canvasContainer: HTMLElement | null = $state(null);
  let fusionCanvas: FusionCanvas | null = null;
  let cleanupScene: (() => void) | null = null;
  // BUG FIX (#81): decides whether an in-flight scene load's result is still
  // wanted by the time it resolves — see sceneLoadGuard.ts doc comment. Must
  // be created once here (module/component scope), not inside the $effect
  // below, so the generation counter survives across effect re-runs.
  const sceneLoadGuard = createSceneLoadGuard();
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

  // ---- Refused drop over the scene (REQ-CPD-063) ----
  // A compendium entry with no destination on the map must be refused WITH a
  // message and without importing anything. "Nothing happened" is not a
  // message, so the refusal is shown here and fades on its own.
  let dropRefusal = $state<string | null>(null);
  const DROP_REFUSAL_MS = 4000;

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
  // Click-to-select, drag-to-move, arrow-key move, duplicate/delete (TK030,
  // TK050/051, TK060-062, TK090) — was built and unit-tested but never
  // instantiated anywhere in the running app until this wiring. Lives outside
  // SceneOrchestrator, same as _tickerDisposer above, for the same reason:
  // it is bound 1:1 to canvas.getLayer("tokens") + the socket for THIS scene
  // load, not part of the orchestrator's own render/tick contract.
  let _tokenInteraction: TokenInteractionManager | null = null;
  /**
   * The `_id` of the scene the canvas currently has loaded — tracked so the
   * scene-reload $effect below can tell "the GM switched scenes" (reload)
   * apart from "something INSIDE the same scene changed" (no reload).
   *
   * Every embedded Token op (move/create/delete/hide — TK030+) is broadcast
   * by the server as a `{ documentType: "Scene" }` update (sync-handlers.ts:
   * embedded ops re-send the FULL parent Scene), because that's what the
   * client's Scene collection actually stores. `worldSync.ts` reacts to any
   * such broadcast by re-deriving `activeSceneState.scene` from the mirror —
   * a fresh object every time, whether or not the change was token-related.
   * Without this guard, `canvasScene` (which is exactly that derived value)
   * changes identity on every single token drag, and the effect below tore
   * down and rebuilt the ENTIRE canvas for it: re-running loadSceneDocument
   * (black screen while art reloads) and re-centering the camera via
   * canvas.panTo/fitToScene (zoom reset) — on every drag frame's ack.
   * TokenLayer already reconciles token-only changes on its own mirror
   * subscription (see TokenLayer.ts's `mirror.subscribe("Scene", ...)`), so
   * a full reload here is both wrong and redundant for that case.
   */
  let _loadedSceneId: string | null = null;

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

      // TK041 (REQ-SYS-009, spec 41-token.md DEC-TOK-03): the active system's
      // size→footprint table — every TokenSprite render and every drag/add
      // snap (TokenInteractionManager) reads it through footprintOf(). Fire
      // once per seat; fails open (empty map → every token stays 1×1) so a
      // slow or absent answer never blocks the canvas.
      void ensureFootprintRegistry(sock);

      // TK080 (REQ-TOK-074): this user's saved name/bar display preferences,
      // loaded once per seat into the live store TokenSprite reads through
      // (tokenDisplayPrefsStore.svelte.ts) — 100% client-local, no socket
      // round-trip (unlike the footprint table above, which is server data).
      initTokenDisplayPrefs(session.worldInfo?.id ?? "", session.user?.id ?? "");
    }

    // Register PF2e sheets once, after the Svelte runtime is ready (REQ-UIF-018..019).
    // Errors are non-fatal — the sheets simply won't be available for resolution.
    registerPf2eSheets().catch((err) => {
      console.warn("[TableScreen] registerPf2eSheets failed:", err);
    });
  });

  onDestroy(() => {
    // BUG FIX (#81 follow-up): invalidate any scene load still in flight
    // BEFORE tearing down. Without this, a load that started just before
    // unmount is still `isCurrent` when it resolves after onDestroy has
    // already run: it would assign `cleanupScene = cleanup` after this
    // function already set `cleanupScene = null` below — a cleanup nobody
    // ever calls again — and would build/setup a fresh SceneOrchestrator on
    // the `canvas` closed over by the effect, which `fusionCanvas?.destroy()`
    // below has already torn down (that call resolves but fails silently in
    // its own try/catch, leaving orphaned renderers on nothing). Calling
    // begin() bumps the generation with no paired load, so isCurrent() is
    // false for every load already in flight and each one discards itself
    // instead of installing. The returned generation id is unused — only
    // the side effect (invalidation) matters here.
    sceneLoadGuard.begin();
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
    // REQ-UIF-045 / item A031 of the r1 review: `dragover` runs in the browser's
    // "protected mode" — only `dataTransfer.types` is readable here, `getData()`
    // always returns "" until `drop` fires. Deciding from `_getActorDragPayload`/
    // `_getCompendiumDragPayload` (which call `getData()`) never accepted a drag, so
    // `preventDefault()` never ran, and the browser refused to ever fire `drop`. The
    // types-only predicates live in `canvasDragTypes.ts` so the rule is exercised
    // directly (canvasDragTypes.test.ts) instead of only through this component.
    if (!hasActorDragType(event.dataTransfer) && !hasCompendiumDragType(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    // Dropping an actor on the map COPIES it into a token — the actor stays in its
    // list. Every source that targets the canvas has to allow this operation, or the
    // browser refuses the drop even after this `preventDefault()` (see dragEffects.ts).
    if (event.dataTransfer) event.dataTransfer.dropEffect = CANVAS_DROP_EFFECT;
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
      const gridSize = effectiveGridSize(scene);
      const op = buildActorDropTokenOp({
        payload: actorPayload,
        sceneId: scene._id,
        x: worldX,
        y: worldY,
        gridSize,
      });
      // REQ-NPC-063: an embedded doc:create (`buildActorDropTokenOp` composes the
      // spec-41 token fields with the shared envelope), awaited with an ack so a
      // server refusal (VALIDATION_FAILED, permission, …) surfaces to the Master
      // instead of being swallowed by a fire-and-forget emit (REQ-CPD-060).
      void (async () => {
        try {
          await sendOp(sock, op);
        } catch (err) {
          console.error("[TableScreen] Failed to create token from actor drop:", err);
          dropRefusal = t("FUSION.DragDrop.Actor.CreateFailed");
          window.setTimeout(() => {
            dropRefusal = null;
          }, DROP_REFUSAL_MS);
        }
      })();
      return;
    }

    const compPayload = _getCompendiumDragPayload(event);
    // REQ-CPD-062/063: decide BEFORE importing. Only an actor has a destination
    // on the map; anything else is refused with a message and nothing is
    // brought to the world — a refusal that imported first would be a lie.
    const decision = decideSceneDrop(compPayload);
    if (decision && !decision.accepted) {
      event.preventDefault();
      dropRefusal = t(decision.reasonKey);
      window.setTimeout(() => {
        dropRefusal = null;
      }, DROP_REFUSAL_MS);
      return;
    }
    if (decision?.accepted) {
      event.preventDefault();
      dropRefusal = null;
      const accepted = decision.payload;
      // Import the actor to world, then create a token at the drop location.
      void (async () => {
        try {
          const result = await compendiumImportToWorld(sock, [accepted.uuid]);
          const createdId = result.created[0];
          if (!createdId) return;
          const gridSize = effectiveGridSize(scene);
          // Build a minimal actor payload to reuse buildTokenFromActorFields
          const fakePayload: ActorDragPayload = {
            kind: "actor",
            _id: createdId,
            documentType: "Actor",
            subtype: accepted.subtype ?? "npc",
            name: accepted.name,
            img: accepted.img,
            origin: "sidebar",
          };
          const fields = buildTokenFromActorFields({
            payload: fakePayload,
            sceneId: scene._id,
            x: worldX,
            y: worldY,
            gridSize,
          });
          // REQ-CPD-062: an embedded doc:create, awaited with an ack — same
          // shape and same visible-failure treatment as the actor branch
          // above (REQ-CPD-060 requires a visible return of a failure, and a
          // fire-and-forget emit here would swallow it just as silently).
          await sendOp(sock, buildTokenCreateOp(scene._id, { ...fields }));
        } catch (err) {
          console.error("[TableScreen] Failed to import compendium actor on drop:", err);
          dropRefusal = t("FUSION.DragDrop.Actor.CreateFailed");
          window.setTimeout(() => {
            dropRefusal = null;
          }, DROP_REFUSAL_MS);
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
   *
   * BUG FIX (#81): this effect used to clean up the PREVIOUS scene
   * (`cleanupScene?.()`) synchronously at the top of its own execution, but
   * only learned the NEW scene's cleanup after an `await` — so two scene
   * switches close together raced: the second run's top-of-execution cleanup
   * found `cleanupScene` still null (the first load hadn't resolved yet), and
   * whichever load resolved LAST won unconditionally, silently overwriting
   * whatever the other had assigned (leaked content, orphaned orchestrator).
   * sceneLoadGuard pairs each in-flight load with the generation that started
   * it: after every `await`, isCurrent(generation) says whether this load's
   * result is still wanted. A stale result disposes of itself immediately
   * instead of being installed — see sceneLoadGuard.ts for the full writeup.
   */
  $effect(() => {
    const canvas = fusionCanvas;
    if (!canLoadScene(canvas !== null, canvasReady)) return;
    // canLoadScene(true, ...) guarantees canvas !== null — narrow for TS.
    if (!canvas) return;

    // REQ-CEN-050/053: the prepared scene when there is one, the scene on air otherwise.
    const scene = canvasScene;

    // Same scene still active — only its content mutated (e.g. a token moved,
    // an embedded doc:update echoed back as a Scene broadcast). TokenLayer and
    // the other per-doc reconcilers already pick this up on their own mirror
    // subscriptions; a full canvas teardown/reload here would only cause a
    // black-screen flash and reset the camera for no reason. See _loadedSceneId.
    if (scene && scene._id === _loadedSceneId) return;

    // Tear down previous orchestrator before changing scene
    _teardownOrchestrator();

    // Cleanup previous scene content — whatever the last WINNING generation
    // installed (a still in-flight loser has nothing here yet: it discards
    // itself below, on its own generation check, the moment it resolves).
    cleanupScene?.();
    cleanupScene = null;
    _loadedSceneId = null;

    // Bump the generation BEFORE the async work starts, synchronously, so a
    // concurrent effect re-run always sees a strictly newer generation.
    const generation = sceneLoadGuard.begin();

    void (async () => {
      try {
        if (scene) {
          const cleanup = await loadSceneDocument(canvas, scene);
          if (!sceneLoadGuard.isCurrent(generation)) {
            // Superseded while in flight: this result is stale. Nobody else
            // holds a reference to it, so this is the only chance to release
            // the PIXI objects THIS load added (sprite/graphics — see
            // cleanupFns in sceneLoader.ts) — cleanupScene/sceneOrchestrator
            // belong to whichever generation is current now, so they are
            // left untouched. Note this cleanup is NOT fully self-contained:
            // it also clears the grid, which is global FusionCanvas state,
            // not scoped to this load — FusionCanvas.clearGridIf() guards
            // that specific step so it only acts if this load's grid config
            // is still the one installed (see its doc comment).
            cleanup?.();
            return;
          }
          cleanupScene = cleanup;
          // Create and set up orchestrator for the new scene
          sceneOrchestrator = _createOrchestrator(canvas, scene);
          await sceneOrchestrator.setup();
          if (!sceneLoadGuard.isCurrent(generation)) {
            // Superseded during setup(): the newer effect run already tore
            // down sceneOrchestrator/cleanupScene synchronously above, so
            // there is nothing left to release here — just don't mark this
            // stale scene as loaded.
            return;
          }
          _loadedSceneId = scene._id;
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
   * CombatCanvasController is wired if the canvas is available.
   */
  function _createOrchestrator(canvas: FusionCanvas, scene: SceneDocument): SceneOrchestrator {
    const sock = getSocket();
    const currentIsGm = isGm();
    const userId = session.user?.id ?? "";
    const gridSize = effectiveGridSize(scene);

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

    // --- TokenInteractionManager (click-to-select, drag/arrow move, duplicate, delete) ---
    // Requires a live socket — with none (disconnected), there is nothing to
    // send ops on, so interaction stays unwired for this scene load rather
    // than silently queuing/dropping every gesture.
    if (sock) {
      _tokenInteraction = new TokenInteractionManager({
        tokenContainer: canvas.getLayer("tokens"),
        tokenLayer,
        mirror: worldMirror,
        sceneId: scene._id,
        canvas,
        socket: sock,
        userId,
        userRole: session.user?.role ?? 0,
        // R2: read live, never a snapshot. This manager is built once per
        // scene LOAD (see `_loadedSceneId`), so a set captured here would
        // freeze "which actors are mine" at canvas-mount time — and since
        // fase 5 that set is the only client-side predicate for moving a
        // token (REQ-TOK-032/034). A player whose Actor snapshot lands after
        // the canvas mounted, or who is granted OWNER during the session,
        // would be refused by the interface until F5 while the server would
        // have accepted the move.
        getOwnedActorIds: () =>
          ownedActorIdsOf(worldMirror.getByType<Record<string, unknown>>("Actor"), userId),
        gridConfig: { size: gridSize, offsetX: 0, offsetY: 0 },
        // TK110 (REQ-TOK-110): two clicks on a token open its sheet. The
        // manager already decided the gesture happened and that this user may
        // see the sheet (REQ-TOK-111); everything read here is read NOW, from
        // the live mirror, so the window never opens on a snapshot taken when
        // the canvas mounted (same reasoning as getOwnedActorIds above).
        onOpenSheet: (tokenId) => {
          const currentScene = worldMirror.getDoc<SceneDocument>("Scene", scene._id);
          const token = currentScene?.tokens?.find((candidate) => candidate._id === tokenId);
          if (!token) return;
          const baseActor = worldMirror.getDoc<Record<string, unknown>>("Actor", token.actorId);
          if (!baseActor) return;

          const owned = ownedActorIdsOf(
            worldMirror.getByType<Record<string, unknown>>("Actor"),
            userId,
          );

          openTokenSheet(
            token as unknown as Parameters<typeof openTokenSheet>[0],
            baseActor,
            {
              userId,
              isGm: currentIsGm,
              isOwner: owned.has(token.actorId),
              worldId: session.worldInfo?.id ?? "",
              socket: sock,
              // Lazy socket accessor: a captured socket goes stale across a
              // reconnect (same pattern as the NPCs tab).
              sendOpFn: (op: unknown) => {
                void sendOp(getSocket() ?? sock, op as Parameters<typeof sendOp>[1]);
              },
            },
          );
        },
        onError: (msg) => {
          dropRefusal = msg;
          window.setTimeout(() => {
            dropRefusal = null;
          }, DROP_REFUSAL_MS);
        },
      });
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
      tokenLayer,
      combatController,
      // R4: the orchestrator is the one thing subscribed to the Scene
      // document, so it is what notices the grid being edited with the
      // scene's pencil. It re-lays the sprites itself (TokenLayer.setGridSize);
      // this hands the same number to the drag snap, which keeps its own copy
      // of the cell size in `gridConfig`.
      onGridSizeChange: (size: number) => {
        _tokenInteraction?.setGridSize(size);
      },
    });
  }

  /**
   * Tear down the current orchestrator (destroy PIXI objects, unsubscribe).
   * Also removes the PIXI ticker callback to prevent stale closures from accumulating
   * across scene switches (fixes ticker leak — bug fix #2).
   * Safe to call when orchestrator is null.
   */
  function _teardownOrchestrator(): void {
    // Remove the ticker callback BEFORE destroying the orchestrator so the
    // callback cannot fire against a half-destroyed tokenLayer.
    _tickerDisposer?.();
    _tickerDisposer = null;

    _tokenInteraction?.destroy();
    _tokenInteraction = null;

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

  <!-- REQ-CPD-063: a compendium drop the map has no place for says so. -->
  {#if dropRefusal}
    <p class="drop-refusal" role="status">{dropRefusal}</p>
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
  /*
   * The refused-drop message (REQ-CPD-063). Sits above the canvas, below the
   * header, and never takes the pointer — it reports, it does not block.
   */
  .drop-refusal {
    position: absolute;
    top: calc(var(--fusion-header-height, 48px) + 0.5rem);
    left: 50%;
    transform: translateX(-50%);
    z-index: 120;
    margin: 0;
    max-width: min(90vw, 32rem);
    padding: 0.4rem 0.75rem;
    background: var(--fusion-surface, #1e1e1e);
    border: 1px solid var(--fusion-border, #444);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-text, #eee);
    font-size: 0.85rem;
    pointer-events: none;
  }

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
