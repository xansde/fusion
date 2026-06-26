/**
 * @fusion/system-pf2e — Actions public API.
 *
 * Re-exports all action-related modules:
 *   - strikes:            Strike derivation, attack resolution, damage computation.
 *   - conditions-manager: Apply/remove/toggle conditions.
 *   - damage:             Apply-damage pipeline (IWR + HP).
 *
 * Clean-room. REQ-PF2-030..034, REQ-PF2-040..041, REQ-PF2-050..054, REQ-PF2-060.
 */

export * from "./strikes.js";
export * from "./conditions-manager.js";
export * from "./damage.js";
