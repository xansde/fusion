/**
 * The mounted pair is ONE body on the map (BHR-F5-03, D-B03, spec 52 REQ-TOK-116..118,
 * REQ-CNV-106..107, REQ-BHR-178, plan 2.5). Every server write that changes the position of a Token
 * (`doc:update` on an embedded Token, `token:move`) goes through `applyMountMovement`, so the rule is
 * decided in one place:
 *
 *   - moving a MOUNT that carries a rider moves the rider by the same displacement, in the same
 *     write (the caller persists and broadcasts once). While a combat is running in the scene the
 *     server also stamps `flags.fusion.mount.movedTurn = { combatId, round, turn }` on the MOUNT
 *     token (consumed by BHR-F5-04; the client can never write it: the `flags.fusion.mount` guard
 *     in doc-handlers). Outside a running combat nothing is stamped. `mount:dismount` clears the
 *     whole flag, `movedTurn` included.
 *   - moving a mounted RIDER is refused to a non-privileged caller (his only movement action is
 *     Mount/Dismount); when the GM does it the rider steps off: the flag is cleared on both tokens,
 *     exactly as `mount:dismount` does, and the mount stays where it was.
 *   - "moves" means the position CHANGED: an update that rewrites the same x/y (a client sending the
 *     full transform, a rotation) is not a move.
 *
 * Judged on the stored state, so a GM batch that drags the mount and then the rider by the same
 * displacement leaves them mounted (the rider is already where the follow put him).
 */

import { MOUNT_FLAG_KEY, MOUNT_FLAG_NAMESPACE, readMountState } from "@fusion/shared";
import type { DocumentStore } from "../documents/store.js";

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The token with `flags.fusion.mount` replaced by `state` (undefined = removed); other flags kept. */
export function withMountFlag(token: Rec, state: Rec | undefined): Rec {
  const flags: Rec = isRec(token["flags"]) ? { ...token["flags"] } : {};
  const current = flags[MOUNT_FLAG_NAMESPACE];
  const ns: Rec = isRec(current) ? { ...current } : {};
  if (state === undefined) {
    const { [MOUNT_FLAG_KEY]: _removed, ...rest } = ns;
    flags[MOUNT_FLAG_NAMESPACE] = rest;
    return { ...token, flags };
  }
  ns[MOUNT_FLAG_KEY] = state;
  flags[MOUNT_FLAG_NAMESPACE] = ns;
  return { ...token, flags };
}

/** Raw `flags.fusion.mount` object of a token, or `{}`. */
function rawMountFlag(token: Rec): Rec {
  const flags = token["flags"];
  if (!isRec(flags)) return {};
  const ns = flags[MOUNT_FLAG_NAMESPACE];
  if (!isRec(ns)) return {};
  const raw = ns[MOUNT_FLAG_KEY];
  return isRec(raw) ? raw : {};
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** The running (started, not ended) combat of `sceneId`, as the stamp the mount carries. */
function runningCombatStamp(
  store: DocumentStore,
  sceneId: string,
): { combatId: string; round: number; turn: number } | null {
  let combats: Rec[];
  try {
    combats = store.getAll("combats");
  } catch {
    return null;
  }
  const combat = combats.find(
    (c) => c["started"] === true && c["ended"] !== true && c["sceneId"] === sceneId,
  );
  if (!combat || typeof combat["_id"] !== "string") return null;
  return { combatId: combat["_id"], round: num(combat["round"]), turn: num(combat["turnIndex"]) };
}

/** A rider that stepped off its mount through the movement itself (the GM moved him, or a stale flag healed). */
export interface MountMovementDismount {
  riderTokenId: string;
  mountTokenId: string;
}

export type MountMoveResult =
  | { ok: true; tokens: Rec[]; dismounted?: MountMovementDismount }
  | { ok: false; code: "PERMISSION_DENIED"; message: string };

/**
 * `tokens` is the RAW collection of the scene (the caller persists it whole: REQ-TOK-002), `index` the
 * token being written, `patched` its new state. Returns the collection to persist: `patched` in place,
 * plus the rider that follows / the flags that clear, or a refusal.
 */
export function applyMountMovement(
  store: DocumentStore,
  sceneId: string,
  tokens: Rec[],
  index: number,
  patched: Rec,
  privileged: boolean,
): MountMoveResult {
  const before = tokens[index];
  const next = [...tokens];
  next[index] = patched;
  if (before === undefined) return { ok: true, tokens: next };

  const dx = num(patched["x"]) - num(before["x"]);
  const dy = num(patched["y"]) - num(before["y"]);
  if (dx === 0 && dy === 0) return { ok: true, tokens: next };

  const tokenId = before["_id"];
  const state = readMountState(before);

  // A mounted RIDER moves: players cannot; the GM takes him off the mount.
  if (state.mountTokenId !== undefined) {
    const mountIdx = next.findIndex((t) => t["_id"] === state.mountTokenId);
    const mount = mountIdx === -1 ? undefined : next[mountIdx];
    const confirmed = mount !== undefined && readMountState(mount).riderTokenId === tokenId;
    // A flag its mount does not confirm (token deleted, never paired) is stale: the rider is free
    // again and the flag heals; nobody is dragged and nobody is refused for a ghost.
    if (!confirmed) {
      next[index] = withMountFlag(patched, undefined);
      return {
        ok: true,
        tokens: next,
        dismounted: { riderTokenId: String(tokenId), mountTokenId: state.mountTokenId },
      };
    }
    if (!privileged) {
      return {
        ok: false,
        code: "PERMISSION_DENIED",
        message: `Token ${String(tokenId)} is mounted: it moves with its mount (dismount first)`,
      };
    }
    next[index] = withMountFlag(patched, undefined);
    next[mountIdx] = withMountFlag(mount, undefined);
    return {
      ok: true,
      tokens: next,
      dismounted: { riderTokenId: String(tokenId), mountTokenId: state.mountTokenId },
    };
  }

  // A MOUNT with a rider moves: the rider goes along, same write.
  if (state.riderTokenId !== undefined) {
    const riderIdx = next.findIndex((t) => t["_id"] === state.riderTokenId);
    const rider = riderIdx === -1 ? undefined : next[riderIdx];
    // A flag that the rider does not confirm is stale: the mount walks alone.
    if (rider === undefined || readMountState(rider).mountTokenId !== tokenId) {
      return { ok: true, tokens: next };
    }
    next[riderIdx] = { ...rider, x: num(rider["x"]) + dx, y: num(rider["y"]) + dy };
    const stamp = runningCombatStamp(store, sceneId);
    if (stamp !== null) {
      next[index] = withMountFlag(patched, { ...rawMountFlag(patched), movedTurn: stamp });
    }
  }
  return { ok: true, tokens: next };
}
