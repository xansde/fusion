/**
 * systems/pf2e/index.ts — the ONE door the core client uses to reach into the
 * PF2e territory (F3, DEC-SEP-02/03).
 *
 * The core (`packages/client/src/**` outside `systems/`) never imports a file
 * under `systems/pf2e/` directly — every dependency crosses through this
 * single entry point, which the dependency-cruiser rule
 * `client-core-must-not-import-system-sheets` enforces. This is what lets F4
 * extract the whole `systems/pf2e/` directory into the `fusion-systems-2e`
 * repo without touching a single file outside it: the core only ever knew
 * about this one module's exported surface.
 *
 * `registerPf2eSheets()` is the sole export today. It:
 *  - registers the PF2e Actor sheets into the core `sheetRegistry`
 *    (REQ-UIF-018/019);
 *  - registers the PF2e ability-card chat extension into the core
 *    `chatCardExtensionRegistry` (ChatMessage.svelte no longer imports
 *    `AbilityCard.svelte` directly);
 *  - registers the PF2e localized skill-name resolver into the core
 *    `skillNameRegistry` (combatSetup.ts's initiative statistic picker).
 *
 * Call it once during app boot (TableScreen.svelte, after the Svelte runtime
 * mounts) — same call site as before F3, just through this door instead of a
 * deep `lib/sheets/pf2e/registerPf2eSheets.js` import.
 */

export { registerPf2eSheets } from "./lib/sheets/pf2e/registerPf2eSheets.js";
