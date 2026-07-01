/**
 * @fusion/system-sf2e — Actions public API.
 *
 * Re-exports all action-related modules:
 *   - strikes:            Strike derivation, attack resolution, damage computation
 *                          (+ Tech-weapon ammo/charge gating, SF traits — REQ-SF2-018..020).
 *   - conditions-manager: Apply/remove/toggle conditions.
 *   - damage:             Apply-damage pipeline (IWR + HP).
 *
 * Clean-room. REQ-SF2-004, REQ-SF2-006, REQ-SF2-018..020.
 */

export * from "./strikes.js";
export * from "./conditions-manager.js";
export * from "./damage.js";
