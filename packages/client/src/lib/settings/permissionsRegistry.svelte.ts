/**
 * permissionsRegistry.svelte.ts — reactive holder for the Permissões
 * section's rows (spec 37 §5.5, G104).
 *
 * `permissionsSection.ts` is the pure render/write logic; this module is
 * where the rows come FROM — the `settings:permissions` query
 * (`net/handlers/settings-handlers.ts` on the server) — and where a
 * successful write is folded back in locally, since `Setting` documents are
 * not part of the join/resync snapshot today (mirrors
 * `worldSettingsRegistry.svelte.ts`'s own reasoning for the Mundo section).
 *
 * Mirrors `lib/conditions/conditionRegistry.svelte.ts`: fail-open (a refusal
 * or timeout just leaves the list as it was) and single-flight per mount.
 *
 * `commitPermissionWrite` is the ONE place a row's role change is actually
 * sent — REQ-CFG-073's "recusa mantém o valor anterior na tela" is
 * structural here, not a caller's discipline: `applyPermissionWrite` is
 * called ONLY after the server ack confirms the write, so a rejected promise
 * leaves `registry.rows` completely untouched. `PermissionsSection.svelte`
 * calls this and only has to decide what to show the user on failure — it
 * never has anything to revert.
 */

import type { Socket } from "socket.io-client";
import { sendOp } from "../docs/sendOp.js";
import {
  buildPermissionWriteOp,
  type PermissionRow,
  type SettingsPermissionsResult,
} from "./permissionsSection.js";

const registry = $state<{ settingId: string | null; rows: PermissionRow[] }>({
  settingId: null,
  rows: [],
});

/** In-flight (or settled) request, so a second caller never asks again. */
let inFlight: Promise<void> | null = null;

export const permissionsRegistry = {
  get settingId(): string | null {
    return registry.settingId;
  },
  get rows(): readonly PermissionRow[] {
    return registry.rows;
  },
};

/**
 * Ask the server for the Permissões rows, once. Never rejects — a failure
 * leaves the section exactly where it was.
 */
export function ensurePermissionsRegistry(socket: Socket): Promise<void> {
  inFlight ??= sendOp<SettingsPermissionsResult>(socket, {
    type: "settings:permissions",
    payload: {},
  })
    .then((result) => {
      registry.settingId = result.settingId ?? null;
      registry.rows = [...(result.permissions ?? [])];
    })
    .catch(() => {
      // Fail open: the section simply has nothing to draw yet.
    });
  return inFlight;
}

/** Put rows in place without a socket — used by tests. */
export function seedPermissionsRegistry(result: SettingsPermissionsResult): void {
  registry.settingId = result.settingId ?? null;
  registry.rows = [...(result.permissions ?? [])];
  inFlight = Promise.resolve();
}

/** Fold a confirmed write back in: the shared settingId + the one row's new floor. */
export function applyPermissionWrite(settingId: string, key: string, minRole: number): void {
  registry.settingId = settingId;
  registry.rows = registry.rows.map((row) => (row.key === key ? { ...row, minRole } : row));
}

/** Forget everything, including the single-flight guard (tests, world switch). */
export function resetPermissionsRegistry(): void {
  registry.settingId = null;
  registry.rows = [];
  inFlight = null;
}

/**
 * Send `row`'s new role over the wire and, ONLY on a confirmed ack, fold it
 * back into `registry` (REQ-CFG-042/073). A refused or timed-out write
 * rejects and touches nothing — `registry.rows` still shows the last value
 * the server actually accepted.
 */
export async function commitPermissionWrite(
  socket: Socket,
  row: PermissionRow,
  nextMinRole: number,
): Promise<void> {
  const op = buildPermissionWriteOp(registry.settingId, row.key, nextMinRole);
  const result = await sendOp<{ documents?: Array<{ _id: string }> }>(socket, op);
  const settingId = registry.settingId ?? result.documents?.[0]?._id;
  if (settingId !== undefined) applyPermissionWrite(settingId, row.key, nextMinRole);
}
