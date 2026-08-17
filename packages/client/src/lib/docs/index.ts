/**
 * @fusion/client docs module — public exports.
 *
 * DocumentMirror: reactive world document store.
 * sendOp: typed socket.io op emitter.
 * activeScene: Svelte 5 reactive active-scene store.
 * worldSync: socket wiring.
 * displayName: resolves a document's translated label (REQ-CMP-055, A041).
 */

export { DocumentMirror } from "./DocumentMirror.js";
export type { GapListener, ChangeListener } from "./DocumentMirror.js";

export { sendOp, OpError } from "./sendOp.js";
export type { SendOpOptions } from "./sendOp.js";

export {
  activeSceneState,
  setActiveSceneId,
  syncActiveSceneFromMirror,
} from "./activeScene.svelte.js";

export { worldMirror, attachWorldSync } from "./worldSync.js";

export { displayName } from "./displayName.js";
export type { DisplayNameDoc } from "./displayName.js";
