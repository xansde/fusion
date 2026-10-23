/**
 * worldSettingsRegistry.svelte.ts — reactive holder for the Mundo section's
 * declared rows (spec 37 §5.4, G102).
 *
 * `worldSettingsSection.ts` is the pure render/write logic; this module is
 * where the declarations come FROM — the `settings:declarations` query
 * (`net/handlers/settings-handlers.ts` on the server) — and where a
 * successful write is folded back in locally, since `Setting` documents are
 * not part of the join/resync snapshot today (no `DocumentMirror` entry to
 * read a fresh `_id`/value from after a create).
 *
 * Mirrors `lib/conditions/conditionRegistry.svelte.ts`: fail-open (a refusal
 * or timeout just leaves the list as it was — REQ-CFG-030 has nothing to
 * render is a legitimate empty state, not an error banner) and single-flight
 * per mount.
 */

import type { Socket } from "socket.io-client";
import { sendOp } from "../docs/sendOp.js";
import type { WorldSettingRow, WorldSettingsDeclarationsResult } from "./worldSettingsSection.js";

const registry = $state<{ systemId: string | null; rows: WorldSettingRow[] }>({
  systemId: null,
  rows: [],
});

/** In-flight (or settled) request, so a second caller never asks again. */
let inFlight: Promise<void> | null = null;

export const worldSettingsRegistry = {
  get systemId(): string | null {
    return registry.systemId;
  },
  get rows(): readonly WorldSettingRow[] {
    return registry.rows;
  },
};

/**
 * Ask the server for the active system's world-scope setting declarations,
 * once. Never rejects — a failure leaves the section exactly where it was.
 */
export function ensureWorldSettingsRegistry(socket: Socket): Promise<void> {
  inFlight ??= sendOp<WorldSettingsDeclarationsResult>(socket, {
    type: "settings:declarations",
    payload: {},
  })
    .then((result) => {
      registry.systemId = result.systemId ?? null;
      registry.rows = [...(result.settings ?? [])];
    })
    .catch(() => {
      // Fail open: the section simply has nothing to draw yet.
    });
  return inFlight;
}

/** Put declarations in place without a socket — used by tests. */
export function seedWorldSettingsRegistry(result: WorldSettingsDeclarationsResult): void {
  registry.systemId = result.systemId ?? null;
  registry.rows = [...(result.settings ?? [])];
  inFlight = Promise.resolve();
}

/** Fold a write's outcome back into the row it targeted (id + new value). */
export function applyWorldSettingWrite(key: string, id: string, value: unknown): void {
  registry.rows = registry.rows.map((row) => (row.key === key ? { ...row, id, value } : row));
}

/**
 * Fold LIVE `Setting` documents (a `doc:create`/`doc:update` envelope from the server) into the rows already
 * declared: a row named by a document's `key` takes its `_id` and `value`. Setting documents are not part of the
 * world snapshot, so this is how a client that is already connected learns the GM changed a world setting: the
 * GM's own Mundo section (his write is echoed back) and, through the server's player-readable allowlist, the
 * Plano of a player reading the campaign's trained skills (HJ-09, #434).
 *
 * Never invents a row (a document no declaration names is ignored), and skips malformed documents.
 */
export function applyWorldSettingDocs(docs: readonly unknown[]): void {
  let rows = registry.rows;
  for (const doc of docs) {
    if (doc === null || typeof doc !== "object") continue;
    const fields = doc as Record<string, unknown>;
    const id = fields["_id"];
    const key = fields["key"];
    if (typeof id !== "string" || typeof key !== "string" || !("value" in fields)) continue;
    const value = fields["value"];
    rows = rows.map((row) => (row.key === key ? { ...row, id, value } : row));
  }
  if (rows !== registry.rows) registry.rows = rows;
}

/** Forget everything, including the single-flight guard (tests, world switch). */
export function resetWorldSettingsRegistry(): void {
  registry.systemId = null;
  registry.rows = [];
  inFlight = null;
}
