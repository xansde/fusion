/**
 * @fusion/client — Sheets public API
 *
 * Re-exports the sheet registry singleton and PF2e sheet helpers so other
 * client modules can resolve and open sheets without deep imports.
 */

export { sheetRegistry } from "./sheetRegistry.js";
export type { SheetComponent, SheetRegistration } from "./sheetRegistry.js";
export { registerPf2eSheets, openActorSheet } from "./pf2e/registerPf2eSheets.js";
export {
  registerEtmosSheets,
  openEtmosActorSheet,
  openCompositor,
} from "./etmos/registerEtmosSheets.js";
