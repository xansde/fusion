/**
 * @fusion/client — public re-exports for tooling (not used at runtime).
 *
 * REQ-ARQ-003: client must NOT import from server.
 * REQ-ARQ-004: client uses Svelte 5 (Runes) + Vite + PIXI.js v8 (M0-B+).
 *
 * The actual entry point for the browser is src/main.ts, loaded by index.html.
 */

export { formatVersion } from "./util/format.js";
