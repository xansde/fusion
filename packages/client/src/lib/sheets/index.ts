/**
 * @fusion/client — Sheets public API
 *
 * Re-exports the sheet registry singleton and the system-agnostic
 * `openActorSheet` helper so other CORE client modules can resolve and open
 * sheets without deep imports. A system's own registration entry point
 * (e.g. `registerPf2eSheets`) is NOT re-exported here — callers get it from
 * the system's own entry point (`systems/pf2e/index.ts`), per DEC-SEP-02: the
 * core framework never imports a system's territory except through that one
 * door.
 */

export { sheetRegistry } from "./sheetRegistry.js";
export type { SheetComponent, SheetRegistration } from "./sheetRegistry.js";
export { openActorSheet } from "./openActorSheet.js";
