/**
 * vision/ — public API for the client-side vision/lighting module.
 *
 * Spec: 07-visao-iluminacao-fog.md (M2-A scope)
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
