/**
 * M3 mapa-som — sound:play, sound:stop server handlers.
 *
 * Contract: packages/shared/src/sound/types.ts (immutable — see project
 * CLAUDE.md). The GM/Assistant picks one track from the world asset library;
 * the server never streams audio bytes, only broadcasts the COMMAND
 * (src + server-authoritative startedAt) so every client plays the asset
 * locally, each with its own local volume.
 *
 * ## Security invariants:
 *
 *   1. **GM/Assistant only** — both sound:play and sound:stop require
 *      `isRolePrivileged(ctx.role)`. A player attempting either receives
 *      PERMISSION_DENIED.
 *
 *   2. **Server-authoritative startedAt** — `Date.now()` is read on the
 *      server at the moment play is accepted, never trusted from the client.
 *      This is what lets late joiners derive the loop position locally.
 *
 * ## Persistence:
 *
 *   One row in the `settings` table under key `_meta:ambientTrack`, storing
 *   `{ key, value: AmbientTrackState }` — same shape/mechanism as
 *   `_meta:activeScene` in sync-handlers.ts (raw SQL upsert; the meta key
 *   contains ":" which fails the BaseDocument _id regex).
 *
 * ## Broadcast:
 *
 *   Both handlers broadcast `sound:state` to the whole namespace (`ns.emit`),
 *   allocate a real seq via SeqStore, and push the envelope into the OpBuffer
 *   — same mechanism as `world:activeScene` (sync-handlers.ts) — so the
 *   ambient track command replays correctly via resync:delta, not just the
 *   join snapshot.
 *
 * ## Asset existence validation (optional):
 *
 *   `SoundHandlerDeps.assetExists` is an OPTIONAL dependency. When the
 *   SocketManager wiring can resolve the world's assets directory (see
 *   socket-manager.ts's `assetsDir` option), it is supplied and sound:play
 *   rejects an unknown asset with NOT_FOUND. When it is undefined (assetsDir
 *   not wired for this namespace — e.g. some test contexts), the handler
 *   accepts any name that satisfies AmbientTrackSrcSchema and existence
 *   checking becomes the responsibility of the GM's asset-picker UI, which
 *   only ever lists real library assets.
 */

import type { Namespace } from "socket.io";
import type { Database as Db } from "better-sqlite3";
import type { HandlerFn, HandlerContext } from "../handler-registry.js";
import type { SeqStore } from "../seq-store.js";
import type { OpBuffer } from "../op-buffer.js";
import { isRolePrivileged } from "../../documents/ownership.js";
import { SoundPlayPayloadSchema, SoundStopPayloadSchema } from "@fusion/shared";
import type { Ack, AmbientTrackState, SoundStatePayload } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Persistence — settings table, key "_meta:ambientTrack"
// ---------------------------------------------------------------------------

const AMBIENT_TRACK_SETTING_KEY = "_meta:ambientTrack";

/**
 * Read the ambient track state from world settings via raw SQL.
 * Returns null when nothing has ever been persisted (silent table) or on
 * any parse failure — mirrors getActiveSceneId's fail-safe behaviour.
 */
export function getAmbientTrackState(db: Db): AmbientTrackState {
  try {
    const row = db
      .prepare(`SELECT data FROM settings WHERE id = ?`)
      .get(AMBIENT_TRACK_SETTING_KEY) as { data: string } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.data) as { value?: AmbientTrackState };
    return parsed.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Persist ambient track state to the settings table via raw SQL (upsert).
 * `state: null` represents the silent table.
 */
export function persistAmbientTrackState(db: Db, state: AmbientTrackState): void {
  const now = Date.now();
  const data = JSON.stringify({ key: AMBIENT_TRACK_SETTING_KEY, value: state });
  db.prepare(
    `INSERT OR REPLACE INTO settings (id, data, created_at, updated_at)
     VALUES (?, ?, coalesce((SELECT created_at FROM settings WHERE id = ?), ?), ?)`,
  ).run(AMBIENT_TRACK_SETTING_KEY, data, AMBIENT_TRACK_SETTING_KEY, now, now);
}

// ---------------------------------------------------------------------------
// Ack helpers
// ---------------------------------------------------------------------------

function ackError(code: string, message: string): Ack<never> {
  return { ok: false, code: code as never, message };
}

// ---------------------------------------------------------------------------
// Handler dependencies
// ---------------------------------------------------------------------------

export interface SoundHandlerDeps {
  db: Db;
  ns: Namespace;
  seqStore: SeqStore;
  opBuffer: OpBuffer;
  /**
   * Optional existence check for a library asset name (bare filename, no
   * path — already validated against AMBIENT_TRACK_SRC_PATTERN by the zod
   * schema before this is called). See module docblock for the wiring
   * rationale. When omitted, sound:play never rejects for NOT_FOUND.
   */
  assetExists?: (name: string) => boolean;
}

// ---------------------------------------------------------------------------
// Shared broadcast helper
// ---------------------------------------------------------------------------

/**
 * Persist + broadcast a new ambient track state. Shared by both handlers so
 * play/stop can never drift in how they allocate seq / push to the buffer /
 * emit — same pattern as buildActiveSceneHandler's broadcast in
 * sync-handlers.ts.
 */
function commitAndBroadcast(deps: SoundHandlerDeps, state: AmbientTrackState): number {
  persistAmbientTrackState(deps.db, state);

  const seq = deps.seqStore.next();
  const broadcastEnvelope = {
    type: "sound:state" as const,
    seq,
    ts: Date.now(),
    payload: { state } satisfies SoundStatePayload,
  };
  deps.opBuffer.push(broadcastEnvelope);
  deps.ns.emit("op", broadcastEnvelope);

  return seq;
}

// ---------------------------------------------------------------------------
// sound:play — GM/Assistant starts looping a library track for everyone
// ---------------------------------------------------------------------------

export function buildSoundPlayHandler(deps: SoundHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can play the ambient track");
    }

    const parsed = SoundPlayPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }

    const { src } = parsed.data;

    if (deps.assetExists && !deps.assetExists(src)) {
      return ackError("NOT_FOUND", `Asset "${src}" was not found in the world asset library`);
    }

    const state: AmbientTrackState = { src, startedAt: Date.now() };
    const seq = commitAndBroadcast(deps, state);

    return { ok: true, seq, result: { state } };
  };
}

// ---------------------------------------------------------------------------
// sound:stop — GM/Assistant silences the table
// ---------------------------------------------------------------------------

export function buildSoundStopHandler(deps: SoundHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can stop the ambient track");
    }

    const parsed = SoundStopPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }

    const seq = commitAndBroadcast(deps, null);

    return { ok: true, seq, result: { state: null } };
  };
}
