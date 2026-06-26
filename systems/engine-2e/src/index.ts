/**
 * @fusion/engine-2e — public API
 *
 * Core 2e mechanics shared between PF2e and SF2e:
 *   - Degrees of Success (§2)
 *   - Modifier stacking (§3.2)
 *   - Multiple Attack Penalty / MAP (§1.4)
 *   - TEML Proficiency (§3.1)
 *   - Dying / Wounded / Doomed (§8)
 *   - IWR pipeline (§6.4)
 *   - Effects Engine (EffectSource collector + Synthetics builder)
 */
export * from "./degreesOfSuccess.js";
export * from "./modifierStacking.js";
export * from "./map.js";
export * from "./temlProficiency.js";
export * from "./dyingWounded.js";
export * from "./iwr.js";
export * from "./effectsEngine.js";
