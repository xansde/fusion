/**
 * @fusion/client canvas/combat module — public API.
 *
 * Combat canvas overlays: the turn marker (pulsing ring over the active token)
 * and the targeting reticles (corner brackets over targeted tokens), plus the
 * controller that wires combat state to those overlays.
 *
 * These are imperative PIXI classes driven from the scene/canvas lifecycle
 * (constructor → tick → destroy). They are connected to the live canvas by the
 * token-rendering pipeline once a TokenLayer instance is available.
 *
 * Spec: 10-combate-e-iniciativa.md §REQ-CBT-050..055, §DEC-CBT-08
 */

export { CombatTurnMarker } from "./CombatTurnMarker.js";
export type { CombatTurnMarkerConfig } from "./CombatTurnMarker.js";

export { TargetingMarkerLayer } from "./TargetingMarker.js";
export type { TargetingMarkerConfig, TargetedTokenPosition } from "./TargetingMarker.js";

export { CombatCanvasController } from "./combatCanvasController.js";
