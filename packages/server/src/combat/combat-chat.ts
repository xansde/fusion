/**
 * combat-chat.ts — broadcast initiative-roll results to the chat log.
 *
 * CA-CBT-002: when initiative is rolled, the result appears in the chat.
 * CA-CBT-009: rolling a PC's initiative shows the result with its statistic.
 *
 * Hidden combatants (REQ-CBT-031): a hidden combatant's initiative result MUST
 * NOT leak to players. Those messages are broadcast as GM-only whispers
 * (whisper = [...gmUserIds]) so players never receive them, mirroring the
 * gmroll visibility rule used by the chat handler.
 *
 * Creatures (REQ-CBA-067, CA-CBA-005): a combatant with no player owner gets
 * the same GM-only treatment, hidden or not — the player must never see a
 * creature's initiative value "em momento algum, nem na montagem". The combat
 * panel conceals the number in its column; the chat panel is the same screen,
 * so concealing one while publishing the other would be no redaction at all.
 *
 * This module persists each message to chat_messages (so reconnecting clients
 * and chat:history see it) and broadcasts it per-socket honouring visibility.
 * It intentionally reuses the same persistence shape and broadcast event as
 * chat-handler.ts so the client renders these like any other roll message.
 */

import type { Namespace, Socket } from "socket.io";
import type { Database as Db } from "better-sqlite3";
import { createDocumentId, defaultStats } from "@fusion/shared";
import { CHAT_BROADCAST_EVENT, CHAT_DOCUMENT_TYPE } from "@fusion/shared";
import type { ChatMessage, Envelope } from "@fusion/shared";
import type { SeqStore } from "../net/seq-store.js";
import { isRolePrivileged } from "../documents/ownership.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Per-combatant initiative result accumulated by the roll handler and handed to
 * the broadcaster. Carries only what the chat message needs.
 */
export interface InitiativeRollChatEntry {
  /** Display name of the combatant whose initiative was rolled. */
  readonly combatantName: string;
  /** Actor id (used as speaker actorId for the message), or null. */
  readonly actorId: string | null;
  /** The rolled initiative total. */
  readonly total: number;
  /** Statistic label/key used (e.g. "perception"), or null. */
  readonly statistic: string | null;
  /** Whether the combatant is hidden — GM-only message when true. */
  readonly hidden: boolean;
  /**
   * Whether the combatant's actor is owned by at least one player (the server's
   * cached "is this a PC?" answer). False means creature — GM-only message
   * (REQ-CBA-067).
   */
  readonly hasPlayerOwner: boolean;
}

/**
 * Dependencies for the initiative-roll chat broadcaster.
 */
export interface CombatChatDeps {
  readonly db: Db;
  readonly ns: Namespace;
  readonly seqStore: SeqStore;
  readonly worldId: string;
  /** Id of the user who initiated the roll (the message author/speaker). */
  readonly authorId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGmUserIds(db: Db): string[] {
  return (
    db.prepare(`SELECT id FROM users WHERE role >= 3 AND active = 1`).all() as { id: string }[]
  ).map((r) => r.id);
}

function resolveAlias(db: Db, userId: string, actorId: string | null): string {
  if (actorId) {
    try {
      const row = db.prepare(`SELECT data FROM actors WHERE id = ?`).get(actorId) as
        | { data: string }
        | undefined;
      if (row) {
        const data = JSON.parse(row.data) as Record<string, unknown>;
        if (typeof data["name"] === "string") return data["name"];
      }
    } catch {
      // fall through to user name
    }
  }
  try {
    const user = db.prepare(`SELECT name FROM users WHERE id = ?`).get(userId) as
      | { name: string }
      | undefined;
    if (user) return user.name;
  } catch {
    // fall through
  }
  return "Unknown";
}

function persistChatMessage(db: Db, msg: ChatMessage): void {
  const now = Date.now();
  const data = JSON.stringify(msg);
  db.prepare(
    `INSERT INTO chat_messages (id, data, timestamp, author_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(msg._id, data, msg.timestamp, msg.speaker.userId, now, now);
}

/**
 * Build an initiative chat message for a single combatant result.
 *
 * Hidden combatant (REQ-CBT-031) → whisper to all GMs.
 * Creature, i.e. no player owner (REQ-CBA-067) → whisper to all GMs: the player
 * must never read a creature's initiative value, and the chat log is the same
 * screen as the combat panel. Hiding the number in the panel column while the
 * very same number is published in the message next to it is not redaction.
 * Player-owned combatant that is not hidden → public message.
 */
function buildInitiativeMessage(deps: CombatChatDeps, entry: InitiativeRollChatEntry): ChatMessage {
  const stats = defaultStats();
  const statSuffix = entry.statistic ? ` (${entry.statistic})` : "";
  const content = `${entry.combatantName} rolls initiative${statSuffix}: ${String(entry.total)}`;

  const gmOnly = entry.hidden || !entry.hasPlayerOwner;
  const whisper = gmOnly ? getGmUserIds(deps.db) : [];

  const msg: ChatMessage = {
    _id: createDocumentId(),
    worldId: deps.worldId,
    type: "roll",
    content,
    speaker: {
      userId: deps.authorId,
      ...(entry.actorId ? { actorId: entry.actorId } : {}),
      alias: resolveAlias(deps.db, deps.authorId, entry.actorId),
    },
    timestamp: Date.now(),
    whisper,
    blind: false,
    sort: 0,
    ownership: { default: 0 },
    flags: {},
    _stats: {
      ...stats,
      lastModifiedBy: deps.authorId,
      createdBy: deps.authorId,
    },
  };
  return msg;
}

/**
 * Whether a socket should receive this message.
 * Public (whisper empty) → everyone. Targeted → recipients, author, or any GM.
 */
function socketMayReceive(socket: Socket, msg: ChatMessage): boolean {
  if (msg.whisper.length === 0) return true;
  const socketData = socket.data as { userId?: string; role?: number } | undefined;
  const userId = socketData?.userId ?? "";
  const role = socketData?.role ?? 0;
  if (isRolePrivileged(role)) return true; // GMs always see whispered initiative
  if (userId === msg.speaker.userId) return true;
  return msg.whisper.includes(userId);
}

// ---------------------------------------------------------------------------
// Public broadcaster factory
// ---------------------------------------------------------------------------

/**
 * Build a function that persists + broadcasts an array of initiative results to
 * the chat. One ChatMessage per combatant, ordered as rolled. Returns a no-op
 * when the entries array is empty.
 */
export function buildInitiativeRollBroadcaster(
  deps: CombatChatDeps,
): (entries: readonly InitiativeRollChatEntry[]) => void {
  return (entries) => {
    for (const entry of entries) {
      const msg = buildInitiativeMessage(deps, entry);
      persistChatMessage(deps.db, msg);

      const seq = deps.seqStore.next();
      const envelope: Envelope = {
        type: CHAT_BROADCAST_EVENT,
        seq,
        ts: Date.now(),
        payload: {
          documentType: CHAT_DOCUMENT_TYPE,
          documents: [msg],
        },
      };

      for (const [, socket] of deps.ns.sockets) {
        if (socketMayReceive(socket, msg)) {
          socket.emit("op", envelope);
        }
      }
    }
  };
}
