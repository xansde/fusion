/**
 * canvasReadyGate.ts — pure decision helper for the TableScreen scene-reload
 * $effect gate.
 *
 * BUG FIX (race): TableScreen.svelte's scene-reload $effect used to call
 * loadSceneDocument(canvas, scene) → canvas.getLayer("background") as soon as
 * fusionCanvas was assigned, but Svelte 5 $effects run synchronously on first
 * render — BEFORE onMount's `await canvas.init()` (which builds the PIXI layer
 * hierarchy via _buildHierarchy()) has resolved. Activating a scene during
 * that window raced ahead of the layers existing, so
 * FusionCanvas.getLayer("background") threw "Layer not found" and the scene's
 * background silently failed to render.
 *
 * The fix adds a `canvasReady` flag, flipped to true only after
 * `canvas.init()` resolves. This module hosts the gate condition as a pure,
 * testable function so the fix's correctness doesn't rely solely on manual/
 * browser verification — TableScreen.svelte's $effect is a thin caller of
 * this predicate (REQ pattern: "componentes finos").
 *
 * Spec: 06-canvas-e-renderizacao.md §DEC-CNV-01 (FusionCanvas init contract).
 */

/**
 * Whether the scene-reload $effect is allowed to call loadSceneDocument()
 * (and therefore canvas.getLayer(...)) right now.
 *
 * @param hasCanvas    True once fusionCanvas has been assigned (component mounted).
 * @param canvasReady  True once FusionCanvas.init() has resolved — i.e. the
 *                      PIXI layer hierarchy is guaranteed to exist.
 */
export function canLoadScene(hasCanvas: boolean, canvasReady: boolean): boolean {
  return hasCanvas && canvasReady;
}

/**
 * isCurrentGeneration — pure decision helper for the TableScreen scene-load
 * teardown race (issue #81).
 *
 * BUG FIX (race): TableScreen.svelte's scene-reload $effect used to tear down
 * `cleanupScene`/`sceneOrchestrator` SYNCHRONOUSLY at the top of the effect
 * body, then reassign them only inside a detached `void (async () => {...})()`
 * after awaiting `loadSceneDocument()`/`orchestrator.setup()`. Because the
 * teardown ran at the START of the NEXT effect execution rather than at the
 * END of the PREVIOUS one, a scene switch that raced ahead of an in-flight
 * load's awaits could have its own freshly-created content silently torn
 * down by teardown code meant for the load that came before it — or, worse,
 * a slow load could resolve AFTER a newer one and overwrite it with stale
 * content ("the teardown for load N must never run against load N+1's
 * content").
 *
 * The fix stamps every load with a monotonically increasing generation
 * number when it starts. After each await inside the load, the code checks
 * whether its generation is still the current one before publishing to
 * `cleanupScene`/`sceneOrchestrator` — a load whose generation was
 * superseded undoes only what IT produced and returns without publishing.
 *
 * @param loadGeneration    The generation number captured when this load started.
 * @param currentGeneration The generation counter's current value.
 */
export function isCurrentGeneration(loadGeneration: number, currentGeneration: number): boolean {
  return loadGeneration === currentGeneration;
}
