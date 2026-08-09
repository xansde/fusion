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
