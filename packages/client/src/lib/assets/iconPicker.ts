/**
 * iconPicker.ts — the decisions of the FilePicker's "Ícones da barra" mode, as pure functions
 * (BAR-F3-05; `lib/components/assets/FilePicker.svelte` only calls them).
 */

import type { UploadOptions } from "./assetApi.js";

/** The FilePicker's modes: the asset browser (default) or the action bar's icon gallery. */
export type FilePickerMode = "assets" | "actionbar-icons";

/**
 * How an upload of this mode is sent. The icon mode declares the "icon" purpose (REQ-BAR-103):
 * without it the server refuses a player, and the file would not land in the shared gallery.
 */
export function pickerUploadOptions(mode: FilePickerMode): UploadOptions {
  return mode === "actionbar-icons" ? { purpose: "icon" } : {};
}

/** The Mestre's role number (REQ-USR-005). */
const GAMEMASTER_ROLE = 4;

/**
 * Whether "Apagar" is offered on a gallery icon: deleting stays STORAGE_DELETE, the Mestre only
 * (REQ-BAR-081, REQ-AST-029). Courtesy — `DELETE /api/assets/icons/:name` refuses anyone else.
 */
export function canDeleteGalleryIcons(role: number | undefined): boolean {
  return role === GAMEMASTER_ROLE;
}
