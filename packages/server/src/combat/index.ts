/**
 * Combat subsystem — public exports.
 *
 * Re-exports the handler factory, registry, and event bus for use in
 * the socket manager and tests.
 */

export * from "./combat-handlers.js";
export * from "./initiative-registry.js";
export * from "./combat-event-bus.js";
export * from "./targeting-store.js";
export * from "./target-handler.js";
