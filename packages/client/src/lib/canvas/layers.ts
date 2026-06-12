/**
 * layers.ts — layer name constants and type definitions.
 *
 * Spec: 06-canvas-e-renderizacao.md §D1, §REQ-CNV-002..005
 *
 * The Fusion canvas uses four top-level groups:
 *   PrimaryGroup   — physical scene content (background, tiles, drawings, tokens, overhead)
 *   EffectsGroup   — weather, lighting, vision, fog  (REQ-CNV-004)
 *   InterfaceGroup — interactive overlays (templates, grid, controls)  (REQ-CNV-004)
 *   OverlayGroup   — elements that do NOT follow the camera (ruler, pings, cursors)
 *
 * Full render order (bottom → top):
 *   PrimaryGroup:   background → tiles → drawings → tokens → overhead
 *   EffectsGroup:   weather → lighting  (vision/fog in M1-C via 07-visao-iluminacao-fog.md)
 *   InterfaceGroup: templates → grid → controls
 *   OverlayGroup:   ruler → pings → remote cursors  (outside world render group)
 *
 * REQ-CNV-003: visual rendering order within PrimaryGroup.
 * REQ-CNV-004: EffectsGroup above Primary; InterfaceGroup above Effects.
 */

// ---------------------------------------------------------------------------
// Layer names
// ---------------------------------------------------------------------------

/** All named layers within the canvas hierarchy. */
export type LayerName =
  // PrimaryGroup layers (REQ-CNV-003)
  | "background"
  | "tiles"
  | "drawings"
  | "tokens"
  | "overhead"
  // EffectsGroup layers (REQ-CNV-004)
  | "weather"
  | "lighting"
  // InterfaceGroup layers (REQ-CNV-004)
  | "templates"
  | "controls";

/** All named top-level groups. */
export type GroupName = "primary" | "effects" | "interface" | "overlay";

/**
 * Z-order within each group (lower = further back).
 * PrimaryGroup: REQ-CNV-003.
 * EffectsGroup / InterfaceGroup: REQ-CNV-004.
 * Grid renderer is inserted between templates and controls in InterfaceGroup.
 */
export const LAYER_ORDER: Record<LayerName, number> = {
  // PrimaryGroup
  background: 0,
  tiles: 10,
  drawings: 20,
  tokens: 30,
  overhead: 40,
  // EffectsGroup
  weather: 0,
  lighting: 10,
  // InterfaceGroup
  templates: 0,
  controls: 20, // grid renderer is at z=10, inserted between templates(0) and controls(20)
};
