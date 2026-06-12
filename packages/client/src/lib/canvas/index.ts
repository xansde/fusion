/**
 * @fusion/client canvas module — public API.
 *
 * Consumers should import from this module, not from individual files.
 */

export { FusionCanvas } from "./FusionCanvas.js";
export type { FusionCanvasOptions } from "./FusionCanvas.js";

export { GridRenderer } from "./GridRenderer.js";
export type { GridRenderConfig } from "./GridRenderer.js";

export { loadDevScene, DEV_SCENE_CONFIG } from "./dev-scene.js";

export * from "./camera-math.js";
export * from "./layers.js";
