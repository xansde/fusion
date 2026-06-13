/**
 * vision/ — public API for the client-side vision/lighting module.
 *
 * Spec: 07-visao-iluminacao-fog.md (M2-A + M2-B scope)
 */

export type {
  TokenVisionConfig,
  LightConfig,
  TokenSourceConfig,
  VisionPolygonResult,
  LightPolygonResult,
  VisionStateResult,
} from "./vision-state.js";

export {
  VisionStateComputer,
  buildTokenVisionConfig,
  buildTokenLightConfig,
  buildAmbientLightConfig,
  polygonBounds,
} from "./vision-state.js";

export { LightingRenderer } from "./LightingRenderer.js";

// M2-B: fog of war accumulation
export type { FogRenderState, FogPersistFn, FogGetFn } from "./fog-state.js";
export { FogState, PERSIST_DEBOUNCE_MS, visibilityPolygonToRing, pointInFog } from "./fog-state.js";
