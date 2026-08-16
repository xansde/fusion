/**
 * worldSettingsImpact.ts — the query REQ-CFG-082's disable confirmation reads
 * its "quantos são afetados" number from (spec 37 §5.4/§5.9, G103).
 *
 * `settings:declarations` (worldSettingsRegistry.svelte.ts) hands the tab
 * every row's CURRENT value on mount; this file is deliberately separate and
 * asked only on demand, right before a `needsDisableConfirm` write commits
 * (Q-CFG-03: the count must not cost a full actor scan on every section
 * open — see `worldSettingsSection.ts`'s docstring for the read/write split
 * this mirrors). Uses the "query" socket event (read-only, mirrors
 * `compendiumApi.ts`'s `sendQuery`) rather than `sendOp`'s "op" event.
 */

import type { Socket } from "socket.io-client";

export interface SettingImpactResult {
  readonly count: number;
}

/**
 * Ask the server how many of the world's actors are affected by turning
 * `key` off. Never assumes zero on its own — a caller that cannot reach the
 * server should treat a rejected/timed-out promise as "unknown", not "none"
 * (WorldSection.svelte keeps the control at its last confirmed value either
 * way, same REQ-CFG-073 discipline as every other write in this section).
 */
export function querySettingDisableImpact(
  socket: Socket,
  key: string,
  timeoutMs = 10_000,
): Promise<SettingImpactResult> {
  return new Promise<SettingImpactResult>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Query "settings:impact" timed out`));
    }, timeoutMs);

    socket.emit(
      "query",
      { type: "settings:impact", payload: { key }, ts: Date.now() },
      (ack: { ok: boolean; result?: SettingImpactResult; code?: string; message?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (ack.ok && ack.result !== undefined) {
          resolve(ack.result);
        } else {
          reject(
            new Error(ack.message ?? `Query "settings:impact" failed: ${ack.code ?? "UNKNOWN"}`),
          );
        }
      },
    );
  });
}
