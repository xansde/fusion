/**
 * footprintRegistry.svelte.ts — the active system's size→footprint table, on
 * the client (REQ-SYS-009, spec 41-token.md TK041/DEC-TOK-03).
 *
 * `footprint.ts`'s `footprintOf` knows how to turn a size category into
 * occupied cells once it HAS the table; this module is where the table comes
 * FROM. It exists for the same reason `conditionRegistry.svelte.ts` does: the
 * client package cannot import a game system (REQ-ARQ-005 — `sizeToFootprint`
 * lives in `systems/pf2e`/`systems/sf2e`), only the server resolves one per
 * world. Without this module `footprintOf` never sees a real conversion and
 * every token stays 1×1, which is exactly the pre-TK041 behaviour.
 *
 * Same two properties `conditionRegistry` guarantees:
 *
 *  - **Fail open**: before the answer arrives — and if it never arrives — the
 *    map is empty, so `footprintOf` falls back to 1×1 (never throws, never
 *    blocks a render).
 *  - **Fetched once per seat**: `ensureFootprintRegistry` is idempotent and
 *    single-flight. The table is static for the life of a world.
 */

import type { Socket } from "socket.io-client";
import { sendOp } from "../../docs/sendOp.js";

/** One size category's occupied cells, as the server declared it. */
export interface FootprintEntry {
  readonly width: number;
  readonly height: number;
}

/** Shape of the `system:footprint` ack (server `SystemFootprintResult`). */
interface SystemFootprintResult {
  readonly systemId?: string | null;
  readonly sizeToFootprint?: Readonly<Record<string, FootprintEntry>>;
}

const registry = $state<{ sizeToFootprint: ReadonlyMap<string, FootprintEntry> }>({
  sizeToFootprint: new Map<string, FootprintEntry>(),
});

/** In-flight (or settled) request, so a second caller never asks again. */
let inFlight: Promise<void> | null = null;

/**
 * The size→footprint table known right now — empty until the system answers,
 * never `undefined`, so `footprintOf` can read it without a guard.
 */
export const footprintRegistry = {
  get sizeToFootprint(): ReadonlyMap<string, FootprintEntry> {
    return registry.sizeToFootprint;
  },
};

/** Index the wire's `Record` by size category, dropping empty-string keys. */
export function indexSizeToFootprint(
  entries: Readonly<Record<string, FootprintEntry>>,
): ReadonlyMap<string, FootprintEntry> {
  const map = new Map<string, FootprintEntry>();
  for (const [size, entry] of Object.entries(entries)) {
    const key = size.trim();
    if (key.length === 0) continue;
    map.set(key, entry);
  }
  return map;
}

/**
 * Ask the server for the active system's size→footprint table, once.
 *
 * Never rejects: a refusal, a timeout or a world with no system all leave the
 * map as it was (fail open — every token stays 1×1). The promise is returned
 * so a test can await the settle; production code fires and forgets.
 */
export function ensureFootprintRegistry(socket: Socket): Promise<void> {
  inFlight ??= sendOp<SystemFootprintResult>(socket, {
    type: "system:footprint",
    payload: {},
  })
    .then((result) => {
      registry.sizeToFootprint = indexSizeToFootprint(result.sizeToFootprint ?? {});
    })
    .catch(() => {
      // Fail open: footprintOf keeps deriving 1x1 for every category.
    });
  return inFlight;
}

/**
 * Put the table in place without a socket — used by tests and by any caller
 * that already holds it.
 */
export function seedFootprintRegistry(entries: Readonly<Record<string, FootprintEntry>>): void {
  registry.sizeToFootprint = indexSizeToFootprint(entries);
  inFlight = Promise.resolve();
}

/** Forget everything, including the single-flight guard (tests, world switch). */
export function resetFootprintRegistry(): void {
  registry.sizeToFootprint = new Map<string, FootprintEntry>();
  inFlight = null;
}
