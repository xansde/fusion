/**
 * conditionRegistry.svelte.ts — the active system's condition dictionary, on
 * the client (REQ-SYS-043, DEC-CTT-11).
 *
 * `conditionView.ts` knows how to paint a condition from a declaration; this
 * module is where the declaration comes FROM. It matters because the client
 * package cannot import a game system: only the server resolves one, per world,
 * and `PF2E_CONDITIONS` lives in `systems/pf2e`. Without this module the map
 * handed to `buildConditionViews` is always empty, and every chip degrades to a
 * tooltip-less situation — which would quietly turn REQ-CTT-031 (colour from the
 * declared `tone`), REQ-CTT-032 (the emphasis of a critical condition) and
 * REQ-CTT-034 (the system's help in a tooltip) into dead letters.
 *
 * Two properties the callers depend on:
 *
 *  - **Fail open** (REQ-CTT-035): before the answer arrives — and if it never
 *    arrives — the map is simply empty, so the panel still draws every active
 *    condition, named after its own item. Nothing waits on this, and nothing
 *    breaks when the request fails.
 *  - **Fetched once per seat**: `ensureConditionRegistry` is idempotent and
 *    single-flight, so a tab that mounts and unmounts (REQ-GAV-017) does not
 *    re-ask on every open. The dictionary is static for the life of a world.
 */

import type { Socket } from "socket.io-client";
import { sendOp } from "../docs/sendOp.js";
import type { ConditionDisplayContract } from "./conditionView.js";

/**
 * Shape of the `system:conditions` ack (server `SystemConditionsResult`).
 *
 * Both fields are optional here on purpose: this is a wire payload, and the
 * client validates what it got rather than trusting a type it wrote itself.
 */
interface SystemConditionsResult {
  readonly systemId?: string | null;
  readonly conditions?: readonly ConditionDisplayContract[];
}

const registry = $state<{ declarations: ReadonlyMap<string, ConditionDisplayContract> }>({
  declarations: new Map<string, ConditionDisplayContract>(),
});

/** In-flight (or settled) request, so a second caller never asks again. */
let inFlight: Promise<void> | null = null;

/**
 * The declarations known right now — empty until the system answers, never
 * `undefined`, so a consumer can pass it straight through without a guard.
 */
export const conditionRegistry = {
  get declarations(): ReadonlyMap<string, ConditionDisplayContract> {
    return registry.declarations;
  },
};

/** Index a list of declarations by slug, dropping entries with no slug to key. */
export function indexConditionDeclarations(
  entries: readonly ConditionDisplayContract[],
): ReadonlyMap<string, ConditionDisplayContract> {
  const map = new Map<string, ConditionDisplayContract>();
  for (const entry of entries) {
    const slug = entry.slug?.trim() ?? "";
    if (slug.length === 0) continue;
    map.set(slug, entry);
  }
  return map;
}

/**
 * Ask the server for the active system's condition dictionary, once.
 *
 * Never rejects: a refusal, a timeout or a world with no system all leave the
 * map as it was (REQ-CTT-035). The promise is returned so a test can await the
 * settle; production code fires and forgets.
 */
export function ensureConditionRegistry(socket: Socket): Promise<void> {
  inFlight ??= sendOp<SystemConditionsResult>(socket, {
    type: "system:conditions",
    payload: {},
  })
    .then((result) => {
      registry.declarations = indexConditionDeclarations(result.conditions ?? []);
    })
    .catch(() => {
      // Fail open: the chips keep drawing with their own item names.
    });
  return inFlight;
}

/**
 * Put declarations in place without a socket — used by tests and by any caller
 * that already holds the dictionary.
 */
export function seedConditionRegistry(entries: readonly ConditionDisplayContract[]): void {
  registry.declarations = indexConditionDeclarations(entries);
  inFlight = Promise.resolve();
}

/** Forget everything, including the single-flight guard (tests, world switch). */
export function resetConditionRegistry(): void {
  registry.declarations = new Map<string, ConditionDisplayContract>();
  inFlight = null;
}
