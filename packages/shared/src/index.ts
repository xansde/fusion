/**
 * @fusion/shared — public API
 *
 * This package is the single source of truth for:
 * - Document IDs and UUIDs
 * - Network protocol types and envelope
 * - Result/error helpers
 *
 * REQ-ARQ-002: shared must NOT import from server, client, system-api, or systems/*.
 */

export * from "./id.js";
export * from "./uuid.js";
export * from "./version.js";
export * from "./protocol.js";
export * from "./result.js";
export * from "./document.js";
export * from "./actor-delta.js";
export * from "./avatar.js";
export * from "./grid/types.js";
export * from "./grid/math.js";
export * from "./grid/SquareGrid.js";
export * from "./grid/factory.js";
export * from "./grid/calibration.js";
export * from "./scene.js";
export * from "./region-map.js";
export * from "./map-package.js";
export * from "./chat/index.js";
export * from "./vision/index.js";
export * from "./fog/index.js";
export * from "./sound/index.js";
export * from "./combat/index.js";
export * from "./compendium.js";
export * from "./mechanics.js";
export * from "./etmos/index.js";
