/**
 * packages/client/src/lib/windows/index.ts
 *
 * Public barrel for the Fusion window manager subsystem.
 *
 * Consumers import from here:
 *   import { windowManager, Dialog, ... } from "$lib/windows";
 */

export {
  windowManager,
  WindowManager,
  clampToViewport,
  cascadePosition,
} from "./window-manager.js";

export type {
  WindowId,
  WindowEntry,
  WindowGeometry,
  WindowOpenOptions,
  WindowHandle,
  ViewportSize,
} from "./window-manager.js";

export { Dialog, confirm, prompt, pendingDialogs, removePendingDialog } from "./dialogs.svelte.js";

export type {
  PendingDialog,
  PendingConfirm,
  PendingPrompt,
  ConfirmOptions,
  PromptOptions,
} from "./dialogs.svelte.js";
