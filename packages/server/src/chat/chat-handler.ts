/**
 * Chat handlers — chat:send and chat:history.
 *
 * REQ-CHT-001..004: parse, execute rolls on server, persist, broadcast.
 * REQ-CHT-013..015: command dispatch via parseChatCommand().
 * REQ-CHT-019: inline [[formula]] evaluated on the server.
 * REQ-CHT-033..034: cursor-based pagination, respects visibility.
 *
 * Roll mode → visibility mapping (D-CHT-02 / D5 spec-08):
 *   public    → whisper=[] blind=false  → all clients
 *   gmroll    → whisper=[gmIds] blind=false → GM + author
 *   blindroll → whisper=[gmIds] blind=true  → only GMs see the result
 *   selfroll  → whisper=[authorId] blind=false → author only
 *
 * Whisper (/w): recipients = whisper[] + author (GM not added automatically
 * per spec-09 "whispers" section — only the listed targets + author see it).
 *
 * REQ-ROL-031..033: blindroll — author receives confirmation without result;
 *   other players receive nothing; GMs receive full result.
 */

import type { Namespace, Socket } from "socket.io";
import type { Database as Db } from "better-sqlite3";
import { createDocumentId, defaultStats } from "@fusion/shared";
import { calculateDegreeOfSuccess } from "@fusion/engine-2e";
import type { Envelope } from "@fusion/shared";
import {
  parseChatCommand,
  extractInlineRolls,
  ChatSendPayloadSchema,
  ChatHistoryRequestSchema,
  CHAT_BROADCAST_EVENT,
  CHAT_DOCUMENT_TYPE,
  CHAT_ERROR_CODES,
} from "@fusion/shared";
import type {
  ChatMessage,
  RollResultData,
  RollTermResult,
  RollMode,
  ChatSpeaker,
  InlineRollSpan,
  ChatSendPayload,
  SpellCastCard,
  AbilityCard,
  SaveCheckContext,
} from "@fusion/shared";

import type { HandlerFn, HandlerContext } from "../net/handler-registry.js";
import type { SeqStore } from "../net/seq-store.js";
import { isRolePrivileged } from "../documents/ownership.js";
import { RollService, RollError } from "./roll-service.js";
import type { RollServiceOptions } from "./roll-service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatHandlerDeps {
  db: Db;
  ns: Namespace;
  seqStore: SeqStore;
  /** World ID this handler is bound to. */
  worldId: string;
  /** Optional RNG override for tests. */
  rollServiceOptions?: Partial<RollServiceOptions>;
}

// ---------------------------------------------------------------------------
// Rate limiting — REQ-CHT-NF-004 (5 msg/sec per user)
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 1_000;
const RATE_LIMIT_MAX = 5;

/** Per-userId rate limit state bucket. */
interface RateLimitBucket {
  count: number;
  resetAt: number;
}

/**
 * Create an isolated rate-limiter closure for a single world.
 * Keeping state inside the closure (not at module level) prevents cross-world
 * state bleed, allows GC when the world closes, and avoids test flakiness from
 * leftover state between test runs.
 *
 * The returned function returns true if the message is allowed, false if
 * the user has exceeded the rate limit.
 */
function createRateLimiter(): (userId: string) => boolean {
  const map = new Map<string, RateLimitBucket>();

  // Purge stale entries every 10 s to prevent unbounded memory growth.
  const purge = (): void => {
    const now = Date.now();
    for (const [userId, bucket] of map) {
      if (now >= bucket.resetAt) {
        map.delete(userId);
      }
    }
  };
  const purgeTimer = setInterval(purge, 10_000);
  // Allow the interval to be garbage-collected when nothing else holds a
  // reference (e.g. in tests) — unref() is a no-op in environments that
  // don't support it (browsers), so we guard the call.
  if (typeof purgeTimer === "object" && "unref" in purgeTimer) {
    purgeTimer.unref();
  }

  return function checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const state = map.get(userId);
    if (!state || now >= state.resetAt) {
      map.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return true;
    }
    state.count++;
    return state.count <= RATE_LIMIT_MAX;
  };
}

// ---------------------------------------------------------------------------
// User lookup helpers (raw SQL — no DocumentStore dependency needed)
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  name: string;
  role: number;
}

function getAllUsers(db: Db): UserRow[] {
  return db.prepare(`SELECT id, name, role FROM users WHERE active = 1`).all() as UserRow[];
}

function getGmUserIds(db: Db): string[] {
  // GAMEMASTER = 4, ASSISTANT_GM = 3 — both are privileged
  return (
    db.prepare(`SELECT id FROM users WHERE role >= 3 AND active = 1`).all() as { id: string }[]
  ).map((r) => r.id);
}

function resolveWhisperTargets(
  db: Db,
  targets: string[],
  authorId: string,
): { ids: string[]; notFound: string[] } {
  const allUsers = getAllUsers(db);
  const byName = new Map(allUsers.map((u) => [u.name.toLowerCase(), u.id]));
  const ids: string[] = [];
  const notFound: string[] = [];

  for (const target of targets) {
    const lower = target.toLowerCase();
    if (lower === "gm") {
      ids.push(...getGmUserIds(db).filter((id) => id !== authorId));
    } else if (lower === "players") {
      ids.push(
        ...allUsers.filter((u) => !isRolePrivileged(u.role) && u.id !== authorId).map((u) => u.id),
      );
    } else {
      const id = byName.get(lower);
      if (id) {
        ids.push(id);
      } else {
        notFound.push(target);
      }
    }
  }

  // Deduplicate
  return { ids: [...new Set(ids)], notFound };
}

// ---------------------------------------------------------------------------
// Content sanitization — D-CHT-05: server-side, no script tags
// ---------------------------------------------------------------------------

/**
 * Very lightweight sanitization: strip script tags and on* attributes.
 * The real XSS allowlist (per spec 21) is deferred to a later milestone.
 * This suffices for the MVP by stripping the most dangerous vectors.
 */
function sanitizeContent(content: string): string {
  return content
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+\s+on\w+\s*=\s*["'][^"']*["'][^>]*>/gi, "")
    .trim();
}

// ---------------------------------------------------------------------------
// ChatMessage persistence
// ---------------------------------------------------------------------------

/**
 * Persist a ChatMessage to the chat_messages table.
 * Stores the full document as JSON in the `data` column.
 */
function persistChatMessage(db: Db, msg: ChatMessage): void {
  const now = Date.now();
  const data = JSON.stringify(msg);
  db.prepare(
    `
    INSERT INTO chat_messages (id, data, timestamp, author_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(msg._id, data, msg.timestamp, msg.speaker.userId, now, now);
}

// ---------------------------------------------------------------------------
// Chat broadcast — per-socket visibility
// ---------------------------------------------------------------------------

/**
 * Determine whether a socket should receive this message at all.
 * Returns null if the socket should not receive it; returns the (possibly
 * redacted) payload to send.
 */
function buildPayloadForSocket(
  socket: Socket,
  msg: ChatMessage,
  authorId: string,
): ChatMessage | null {
  const socketData = socket.data as { userId?: string; role?: number } | undefined;
  const socketUserId = socketData?.userId ?? "";
  const socketRole = socketData?.role ?? 0;
  const socketIsPrivileged = isRolePrivileged(socketRole);

  const whisper = msg.whisper;
  const isPublic = whisper.length === 0;

  if (isPublic) {
    // public message — everyone gets it
    if (msg.blind) {
      // blindroll: strip rolls from non-GMs (and from the author)
      if (!socketIsPrivileged) {
        return { ...msg, rolls: undefined };
      }
    }
    return msg;
  }

  // Targeted message (whisper / gmroll / selfroll)
  const isRecipient = whisper.includes(socketUserId);
  const isAuthor = socketUserId === authorId;

  // Visibility rules for targeted messages (whisper / roll modes):
  //
  // spec-09 glossary line 66: "Whisper — visible to explicit recipients + ALL GMs".
  // GMs ALWAYS see whispers (including player-to-player /w commands).
  //
  // For selfroll: only the author sees it (spec-09 line 225: "Roll visible
  // only to the author"). selfroll has type='roll' and whisper=[authorId],
  // so GMs must be excluded via isSelfroll check.
  //
  // For gmroll / blindroll: GMs are already listed in whisper[] by
  // buildRollMessage, so they are caught by isRecipient.
  const isSelfroll =
    msg.type === "roll" &&
    Array.isArray(msg.rolls) &&
    msg.rolls.length > 0 &&
    msg.rolls[0]?.rollMode === "selfroll";

  const gmOverride = socketIsPrivileged && !isSelfroll;

  if (!isRecipient && !isAuthor && !gmOverride) {
    return null;
  }

  // For blindroll: author sees a stripped version, GM sees full
  if (msg.blind && !socketIsPrivileged) {
    return { ...msg, rolls: undefined };
  }

  return msg;
}

/**
 * Broadcast a ChatMessage to all eligible sockets in the namespace.
 * Applies roll-mode visibility rules per socket.
 *
 * REQ-CHT-004 / REQ-ROL-031.
 */
function broadcastChatMessage(
  ns: Namespace,
  seqStore: SeqStore,
  msg: ChatMessage,
  authorId: string,
): number {
  const seq = seqStore.next();

  // Build a minimal blindroll-confirmation message for the author
  // REQ-ROL-032: author of blindroll sees confirmation without the result
  const blindAuthorMsg: ChatMessage = msg.blind
    ? {
        ...msg,
        rolls: undefined,
        content: "(Você realizou uma rolagem cega — somente o GM pode ver o resultado.)",
      }
    : msg;

  for (const [, socket] of ns.sockets) {
    const socketData = socket.data as { userId?: string; role?: number } | undefined;
    const socketUserId = socketData?.userId ?? "";
    const isAuthor = socketUserId === authorId;

    let payload: ChatMessage | null;

    if (msg.blind && isAuthor && !isRolePrivileged(socketData?.role ?? 0)) {
      // Author of blindroll — send stripped confirmation
      payload = blindAuthorMsg;
    } else {
      payload = buildPayloadForSocket(socket, msg, authorId);
    }

    if (payload === null) continue;

    const envelope: Envelope = {
      type: CHAT_BROADCAST_EVENT,
      seq,
      ts: Date.now(),
      payload: {
        documentType: CHAT_DOCUMENT_TYPE,
        documents: [payload],
      },
    };

    socket.emit("op", envelope);
  }

  return seq;
}

// ---------------------------------------------------------------------------
// Inline roll processing — REQ-CHT-019 / D-CHT-08
// ---------------------------------------------------------------------------

/**
 * Evaluate all immediate [[formula]] spans in the text, returning the
 * updated content and an array of RollResultData for persistence.
 */
function processInlineRolls(
  content: string,
  spans: InlineRollSpan[],
  rollService: RollService,
  ctx: HandlerContext,
  worldId: string,
): { content: string; rolls: RollResultData[] } {
  const immediateSpans = spans
    .filter((s) => s.kind === "immediate")
    .sort((a, b) => b.start - a.start); // process right-to-left to keep offsets valid

  let result = content;
  const rolls: RollResultData[] = [];

  for (const span of immediateSpans) {
    try {
      const rollResult = rollService.roll({
        formula: span.formula,
        mode: span.mode,
        worldId,
        userId: ctx.userId,
      });
      rolls.unshift(rollResult); // collect in order
      // Replace the span in the content with the total
      result = result.slice(0, span.start) + String(rollResult.total) + result.slice(span.end);
    } catch {
      // Leave the span as-is if invalid
    }
  }

  return { content: result, rolls };
}

// ---------------------------------------------------------------------------
// chat:send handler
// ---------------------------------------------------------------------------

export function buildChatSendHandler(deps: ChatHandlerDeps): HandlerFn {
  const rollService = new RollService({
    db: deps.db,
    ...deps.rollServiceOptions,
  });

  // Rate limiter is scoped to this world instance — no cross-world state bleed.
  const checkRateLimit = createRateLimiter();

  return (rawPayload, ctx) => {
    // --- Rate limit ---
    if (!checkRateLimit(ctx.userId)) {
      return {
        ok: false,
        code: "VALIDATION_FAILED" as const,
        message: CHAT_ERROR_CODES.RATE_LIMIT,
      };
    }

    // --- Schema validation ---
    const parsed = ChatSendPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION_FAILED" as const,
        message: parsed.error.message,
      };
    }
    const payload: ChatSendPayload = parsed.data;

    // --- World ID check ---
    if (payload.worldId !== deps.worldId) {
      return {
        ok: false,
        code: "VALIDATION_FAILED" as const,
        message: "World ID mismatch",
      };
    }

    // --- Parse command ---
    const command = parseChatCommand(payload.content);

    // --- Speaker resolution (REQ-CHT-022) ---
    // Simplified: userId is always present; actorId/tokenId from payload if provided
    const speaker: ChatSpeaker = {
      userId: ctx.userId,
      actorId: payload.speakerActorId,
      tokenId: payload.speakerTokenId,
      alias: resolveSpeakerAlias(deps.db, ctx.userId, payload.speakerActorId),
    };

    // --- Dispatch by command kind ---

    if (command.kind === "roll") {
      // --- Roll command ---
      const effectiveMode: RollMode = payload.rollMode ?? command.mode;

      let rollResult: RollResultData;
      try {
        rollResult = rollService.roll({
          formula: command.formula,
          mode: effectiveMode,
          worldId: deps.worldId,
          userId: ctx.userId,
        });
      } catch (err) {
        if (err instanceof RollError) {
          return {
            ok: false,
            code: "VALIDATION_FAILED" as const,
            message: err.message,
          };
        }
        throw err;
      }

      // --- Degree of success (r17.1) ---
      // When the client attached a validated save checkContext, grade the roll
      // AUTHORITATIVELY here (never on the client). The DC came from the card's
      // coherence-checked spellcasting DC; the total was rolled by the server.
      const checkContext = payload.flags?.checkContext;
      let gradedSave: SaveCheckContext | null = null;
      if (checkContext?.kind === "save") {
        const degree = computeSaveDegree(rollResult, checkContext);
        if (degree !== null) {
          rollResult = { ...rollResult, degreeOfSuccess: degree };
          gradedSave = checkContext;
        }
      }

      const msg = buildRollMessage(
        deps.db,
        deps.worldId,
        speaker,
        ctx.userId,
        rollResult,
        effectiveMode,
      );

      // Persist the graded save context on the message so the client render is
      // self-contained (the per-degree basic-save damage hint needs `basicSave`,
      // which is NOT carried on RollResultData). Only attached when a degree was
      // actually computed — never trusted for anything but display.
      if (gradedSave) {
        msg.flags = {
          ...msg.flags,
          [SPELLCAST_FLAG_NAMESPACE]: {
            ...msg.flags[SPELLCAST_FLAG_NAMESPACE],
            [CHECK_CONTEXT_FLAG_KEY]: gradedSave,
          },
        };
      }

      // Parent linkage (r18-N1): an attack / damage / save roll fired from a
      // spell-cast card carries the announcement's id so the client nests it
      // under that card. Dangling parent → dropped (still delivered top-level).
      attachParentFlag(msg, resolveParentMessageId(deps.db, payload.flags?.parentMessageId));

      persistChatMessage(deps.db, msg);
      const seq = broadcastChatMessage(deps.ns, deps.seqStore, msg, ctx.userId);

      return { ok: true, seq, result: { message: redactForAuthor(msg, ctx.userId) } };
    }

    if (command.kind === "whisper") {
      // --- Whisper command ---
      const { ids: recipientIds, notFound } = resolveWhisperTargets(
        deps.db,
        command.targets,
        ctx.userId,
      );

      if (notFound.length > 0) {
        return {
          ok: false,
          code: "VALIDATION_FAILED" as const,
          message: `${CHAT_ERROR_CODES.WHISPER_TARGET_NOT_FOUND}: ${notFound.join(", ")}`,
        };
      }

      const content = sanitizeContent(command.message);
      const whisperIds = [...new Set([...recipientIds, ctx.userId])];

      const msg: ChatMessage = buildBaseMessage(deps.worldId, speaker, "whisper", content);
      msg.whisper = whisperIds;

      persistChatMessage(deps.db, msg);
      const seq = broadcastChatMessage(deps.ns, deps.seqStore, msg, ctx.userId);

      return { ok: true, seq, result: { message: msg } };
    }

    if (command.kind === "emote") {
      const content = sanitizeContent(command.message);
      const msg = buildBaseMessage(deps.worldId, speaker, "emote", content);
      persistChatMessage(deps.db, msg);
      const seq = broadcastChatMessage(deps.ns, deps.seqStore, msg, ctx.userId);
      return { ok: true, seq, result: { message: msg } };
    }

    // Handles "ic", "ooc", "text" — after roll/whisper/emote are handled above,
    // the remaining kinds are exhaustively these three.
    {
      const raw = command.kind === "text" ? command.content : command.message;
      // Sanitize FIRST — inline span offsets must be computed against the
      // sanitized string to avoid offset drift when sanitizeContent removes
      // characters (e.g. <script>...</script>) that precede a [[formula]].
      // D-CHT-08 / REQ-CHT-019.
      let content = sanitizeContent(raw);

      // Extract inline spans from the sanitized content (not from raw).
      // For "text" commands, command.inlineRolls was extracted by the parser
      // from the raw input — we must re-extract from the sanitized version.
      const inlineSpans = extractInlineRolls(content);
      const rollResults: RollResultData[] = [];

      if (inlineSpans.length > 0) {
        const processed = processInlineRolls(content, inlineSpans, rollService, ctx, deps.worldId);
        content = processed.content;
        rollResults.push(...processed.rolls);
      }

      const msg = buildBaseMessage(deps.worldId, speaker, "text", content);
      if (rollResults.length > 0) {
        msg.rolls = rollResults;
      }

      // Attach a validated spell-cast card flag (r17-P2), if present. The Zod
      // shape was already validated by ChatSendPayloadSchema; sanitizeSpellCastCard
      // adds the caster=speaker check and DC coherence (never trust the client).
      const spellCast = payload.flags?.pf2e?.spellCast;
      if (spellCast) {
        const sanitized = sanitizeSpellCastCard(deps.db, spellCast, payload.speakerActorId);
        if (sanitized) {
          msg.flags = {
            ...msg.flags,
            [SPELLCAST_FLAG_NAMESPACE]: { [SPELLCAST_FLAG_KEY]: sanitized },
          };
        }
      }

      // Attach a validated generalized ability card flag (r20-X1). Same
      // pipeline as spellCast: the Zod shape was already validated by
      // ChatSendPayloadSchema; sanitizeAbilityCard adds caster=speaker + a
      // by-kind DC coherence check (spellcasting DC for spells, class DC for
      // impulses; strikes carry no DC). Merged into the pf2e namespace WITHOUT
      // clobbering a coexisting spellCast (defensive — a client sends one card).
      const abilityCard = payload.flags?.pf2e?.abilityCard;
      if (abilityCard) {
        const sanitized = sanitizeAbilityCard(deps.db, abilityCard, payload.speakerActorId);
        if (sanitized) {
          msg.flags = {
            ...msg.flags,
            [SPELLCAST_FLAG_NAMESPACE]: {
              ...msg.flags[SPELLCAST_FLAG_NAMESPACE],
              [ABILITY_CARD_FLAG_KEY]: sanitized,
            },
          };
        }
      }

      // Parent linkage (r18-N1) — symmetric with the roll branch. A cast
      // announcement is a PARENT and carries no parentMessageId, so this is a
      // no-op for it; it only matters for a hypothetical nested text child.
      attachParentFlag(msg, resolveParentMessageId(deps.db, payload.flags?.parentMessageId));

      // Return the CANONICAL message on the ack (r18-N1): castSpell chains the
      // attack roll under this announcement using result.message._id. The id is
      // already on every ack (`result.message`), so no wire change is needed.
      persistChatMessage(deps.db, msg);
      const seq = broadcastChatMessage(deps.ns, deps.seqStore, msg, ctx.userId);
      return { ok: true, seq, result: { message: msg } };
    }
  };
}

// ---------------------------------------------------------------------------
// chat:history handler — REQ-CHT-033..034 with visibility filter
// ---------------------------------------------------------------------------

export function buildChatHistoryHandler(deps: ChatHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = ChatHistoryRequestSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION_FAILED" as const,
        message: parsed.error.message,
      };
    }
    const req = parsed.data;

    if (req.worldId !== deps.worldId) {
      return {
        ok: false,
        code: "VALIDATION_FAILED" as const,
        message: "World ID mismatch",
      };
    }

    const limit = Math.min(req.limit, 100);
    const privileged = isRolePrivileged(ctx.role);

    // Load more than requested to account for visibility filtering
    const fetchLimit = limit * 4 + 50;

    let rows: { id: string; data: string; timestamp: number }[];

    if (req.before) {
      // Find timestamp of cursor message for keyset pagination
      const cursor = deps.db
        .prepare(`SELECT timestamp FROM chat_messages WHERE id = ?`)
        .get(req.before) as { timestamp: number } | undefined;

      if (!cursor) {
        rows = [];
      } else {
        rows = deps.db
          .prepare(
            `SELECT id, data, timestamp FROM chat_messages
             WHERE timestamp < ? OR (timestamp = ? AND id < ?)
             ORDER BY timestamp DESC, id DESC
             LIMIT ?`,
          )
          .all(cursor.timestamp, cursor.timestamp, req.before, fetchLimit) as typeof rows;
      }
    } else {
      rows = deps.db
        .prepare(
          `SELECT id, data, timestamp FROM chat_messages
           ORDER BY timestamp DESC, id DESC
           LIMIT ?`,
        )
        .all(fetchLimit) as typeof rows;
    }

    // Parse and filter by visibility
    const visible: ChatMessage[] = [];

    for (const row of rows) {
      if (visible.length >= limit) break;

      let msg: ChatMessage;
      try {
        msg = JSON.parse(row.data) as ChatMessage;
      } catch {
        continue;
      }

      const redacted = redactForViewer(msg, ctx.userId, privileged);
      if (redacted !== null) {
        visible.push(redacted);
      }
    }

    const hasMore = rows.length > visible.length && rows.length >= fetchLimit;
    const nextCursor = visible.length > 0 ? (visible[visible.length - 1]?._id ?? null) : null;

    return {
      ok: true,
      seq: deps.seqStore.peek(),
      result: {
        messages: visible,
        nextCursor,
        hasMore,
      },
    };
  };
}

// ---------------------------------------------------------------------------
// Snapshot helper — last N visible messages for join (REQ-CHT-033)
// ---------------------------------------------------------------------------

/**
 * Returns the last `limit` chat messages visible to the given user.
 * Used by sendJoinSnapshot to include recent chat in the world snapshot.
 */
export function getRecentChatForUser(
  db: Db,
  userId: string,
  role: number,
  limit = 50,
): ChatMessage[] {
  const privileged = isRolePrivileged(role);
  const fetchLimit = limit * 4 + 50;

  const rows = db
    .prepare(
      `SELECT id, data, timestamp FROM chat_messages
       ORDER BY timestamp DESC, id DESC LIMIT ?`,
    )
    .all(fetchLimit) as { id: string; data: string; timestamp: number }[];

  const visible: ChatMessage[] = [];
  for (const row of rows) {
    if (visible.length >= limit) break;
    let msg: ChatMessage;
    try {
      msg = JSON.parse(row.data) as ChatMessage;
    } catch {
      continue;
    }
    const redacted = redactForViewer(msg, userId, privileged);
    if (redacted !== null) {
      visible.push(redacted);
    }
  }

  return visible.reverse(); // oldest first
}

// ---------------------------------------------------------------------------
// Visibility helpers
// ---------------------------------------------------------------------------

/**
 * Redact a ChatMessage for a specific viewer.
 * Returns null if the viewer should not see this message at all.
 */
function redactForViewer(
  msg: ChatMessage,
  viewerId: string,
  privileged: boolean,
): ChatMessage | null {
  const whisper = msg.whisper;
  const isPublic = whisper.length === 0;

  if (isPublic) {
    // Everyone sees public messages; GMs see full; non-GMs get rolls stripped for blind
    if (msg.blind && !privileged) {
      return { ...msg, rolls: undefined };
    }
    return msg;
  }

  // Whispered message
  const isRecipient = whisper.includes(viewerId);
  const isAuthor = msg.speaker.userId === viewerId;

  // Visibility rules for targeted messages (whisper / roll modes):
  //
  // spec-09 glossary line 66: "Whisper — visible to explicit recipients + ALL GMs".
  // GMs always see whispers (including player-to-player /w).
  //
  // For selfroll: only the author sees it (spec-09 line 225: "Roll visible
  // only to the author"). GMs must NOT see selfroll messages that are not
  // addressed to them.
  //
  // For gmroll / blindroll: GMs are already in whisper[] via buildRollMessage.
  const isSelfroll =
    msg.type === "roll" &&
    Array.isArray(msg.rolls) &&
    msg.rolls.length > 0 &&
    msg.rolls[0]?.rollMode === "selfroll";

  const gmOverride = privileged && !isSelfroll;

  if (!isRecipient && !isAuthor && !gmOverride) {
    return null; // not visible to this viewer
  }

  // Blind roll — author sees stripped version
  if (msg.blind && isAuthor && !privileged) {
    return { ...msg, rolls: undefined };
  }

  return msg;
}

/** Redact for the message author (used in ack response). */
function redactForAuthor(msg: ChatMessage, authorId: string): ChatMessage {
  if (msg.blind && msg.speaker.userId === authorId) {
    return { ...msg, rolls: undefined };
  }
  return msg;
}

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

function buildBaseMessage(
  worldId: string,
  speaker: ChatSpeaker,
  type: ChatMessage["type"],
  content: string,
): ChatMessage {
  const stats = defaultStats();
  return {
    _id: createDocumentId(),
    worldId,
    type,
    content,
    speaker,
    timestamp: Date.now(),
    whisper: [],
    blind: false,
    // BaseDocument required fields
    sort: 0,
    ownership: { default: 0 },
    flags: {},
    _stats: {
      ...stats,
      lastModifiedBy: speaker.userId,
      createdBy: speaker.userId,
    },
  };
}

function buildRollMessage(
  db: Db,
  worldId: string,
  speaker: ChatSpeaker,
  authorId: string,
  rollResult: RollResultData,
  mode: RollMode,
): ChatMessage {
  // Determine whisper[] and blind based on roll mode (D-CHT-02)
  let whisper: string[] = [];
  let blind = false;

  switch (mode) {
    case "public":
      whisper = [];
      blind = false;
      break;
    case "gmroll":
      whisper = getGmUserIds(db);
      blind = false;
      break;
    case "blindroll":
      whisper = getGmUserIds(db);
      blind = true;
      break;
    case "selfroll":
      whisper = [authorId];
      blind = false;
      break;
  }

  const content = rollResult.flavor
    ? `${rollResult.flavor}: ${String(rollResult.total)}`
    : String(rollResult.total);

  const msg = buildBaseMessage(worldId, speaker, "roll", content);
  msg.whisper = whisper;
  msg.blind = blind;
  msg.rolls = [rollResult];
  return msg;
}

// ---------------------------------------------------------------------------
// Degree of success — save checkContext (r17.1)
// ---------------------------------------------------------------------------

/**
 * PF2e degree-of-success strings, aligned with the engine-2e enum values.
 * Stored verbatim in `RollResultData.degreeOfSuccess` (D7 spec-08: generic
 * string, not a fixed schema enum). The client maps these to localized badges.
 */
const DEGREE_OF_SUCCESS = {
  criticalSuccess: "criticalSuccess",
  success: "success",
  failure: "failure",
  criticalFailure: "criticalFailure",
} as const;

/** engine-2e DegreeOfSuccess → the string persisted on the roll. */
const ENGINE_DEGREE_TO_STRING: Record<string, string> = {
  CriticalSuccess: DEGREE_OF_SUCCESS.criticalSuccess,
  Success: DEGREE_OF_SUCCESS.success,
  Failure: DEGREE_OF_SUCCESS.failure,
  CriticalFailure: DEGREE_OF_SUCCESS.criticalFailure,
};

/**
 * Read the natural (unmodified) d20 face from a roll's structured terms — never
 * by parsing a string. Scans for the first `dice` term with 20 faces and takes
 * its first ACTIVE die's `result`. Returns null when the roll has no d20 (then
 * no nat20/nat1 adjustment applies and grading is skipped).
 *
 * A save roll is always `1d20 + <mod>`, so the first active d20 face is THE
 * check die. Keep-highest/lowest fortune/misfortune (e.g. `2d20kh1`) would keep
 * the active die here too, which is the correct check die by construction.
 */
export function readNaturalD20(terms: readonly RollTermResult[]): number | null {
  for (const term of terms) {
    if (term.type !== "dice" || term.faces !== 20 || !Array.isArray(term.results)) continue;
    const active = term.results.find((d) => d.active) ?? term.results[0];
    if (active && typeof active.result === "number") return active.result;
  }
  return null;
}

/**
 * Grade a save roll's degree of success AUTHORITATIVELY on the server (r17.1).
 *
 * The total was rolled by the server (anti-cheat); we compare it to the DC from
 * the (already coherence-checked) checkContext and apply the PF2e nat20/nat1
 * degree shift using the natural d20 face read from the structured terms. The
 * grading itself reuses engine-2e's `calculateDegreeOfSuccess` (single source of
 * truth for the 2e mechanic). Returns the degree string, or null when the roll
 * carries no d20 to grade (defensive — a save is always 1d20+mod).
 */
export function computeSaveDegree(roll: RollResultData, ctx: SaveCheckContext): string | null {
  const natural = readNaturalD20(roll.terms);
  if (natural === null) return null;
  const degree = calculateDegreeOfSuccess(roll.total, ctx.dcValue, natural);
  return ENGINE_DEGREE_TO_STRING[degree] ?? null;
}

// ---------------------------------------------------------------------------
// SpellCast card flag (r17-P2)
// ---------------------------------------------------------------------------

const SPELLCAST_FLAG_NAMESPACE = "pf2e" as const;
const SPELLCAST_FLAG_KEY = "spellCast" as const;
/** flags.pf2e.abilityCard — the generalized ability card (r20-X1). */
const ABILITY_CARD_FLAG_KEY = "abilityCard" as const;
/** flags.pf2e.checkContext — the graded save context, for the render's basic hint (r17.1). */
const CHECK_CONTEXT_FLAG_KEY = "checkContext" as const;
/** flags.fusion.parentMessageId — id of the message this roll nests under (r18-N1). */
const PARENT_FLAG_NAMESPACE = "fusion" as const;
const PARENT_MESSAGE_ID_FLAG_KEY = "parentMessageId" as const;

/**
 * Resolve a client-provided `flags.parentMessageId` (r18-N1) to a persisted
 * parent id, or `undefined`. The flag is a plain id string (Zod-bounded); here
 * we verify a message with that id actually exists in the store. A dangling
 * parent (typo, race, deleted message) is DROPPED — never a hard failure: the
 * caller still delivers the roll as a normal top-level message. This keeps the
 * nesting a best-effort UI grouping, never a gate on the send.
 */
function resolveParentMessageId(db: Db, parentMessageId: string | undefined): string | undefined {
  if (!parentMessageId) return undefined;
  const row = db.prepare(`SELECT id FROM chat_messages WHERE id = ?`).get(parentMessageId) as
    | { id: string }
    | undefined;
  if (!row) {
    console.warn(
      `[chat] parentMessageId "${parentMessageId}" not found in store; dropping nesting flag (message delivered as top-level).`,
    );
    return undefined;
  }
  return parentMessageId;
}

/**
 * Attach the validated `flags.fusion.parentMessageId` onto a message so it
 * travels in the persisted/broadcast document (r18-N1). No-op when `parentId`
 * is undefined (dangling/absent), so old messages and non-nested rolls stay
 * unchanged. Merges into any existing flags namespace without clobbering
 * (a save roll carries both `pf2e.checkContext` and `fusion.parentMessageId`).
 */
function attachParentFlag(msg: ChatMessage, parentId: string | undefined): void {
  if (!parentId) return;
  msg.flags = {
    ...msg.flags,
    [PARENT_FLAG_NAMESPACE]: {
      ...msg.flags[PARENT_FLAG_NAMESPACE],
      [PARENT_MESSAGE_ID_FLAG_KEY]: parentId,
    },
  };
}

/**
 * Read the set of derived spellcasting DCs for an actor (server side).
 * Returns an empty array when the actor is unknown, has no derived
 * spellcasting, or the data can't be parsed — the caller then skips the
 * coherence check (it is a best-effort log, never a hard gate).
 */
function readCasterSpellDCs(db: Db, actorId: string): number[] {
  try {
    const row = db.prepare(`SELECT data FROM actors WHERE id = ?`).get(actorId) as
      | { data: string }
      | undefined;
    if (!row) return [];
    const doc = JSON.parse(row.data) as Record<string, unknown>;
    const system = doc["system"] as Record<string, unknown> | undefined;
    const derived = system?.["derived"] as Record<string, unknown> | undefined;
    const spellcasting = derived?.["spellcasting"] as
      | Record<string, { dc?: unknown } | undefined>
      | undefined;
    if (!spellcasting) return [];
    const dcs: number[] = [];
    for (const entry of Object.values(spellcasting)) {
      if (typeof entry?.dc === "number") dcs.push(entry.dc);
    }
    return dcs;
  } catch {
    return [];
  }
}

/**
 * Validate a client-provided SpellCastCard flag before it is attached to a
 * ChatMessage (r17-P2). The shape is already Zod-validated by
 * ChatSendPayloadSchema; here we add a best-effort DC coherence check: the
 * client is NEVER trusted for the DC — if the actor exists and has derived
 * spellcasting DCs, `dcValue` must match one of them, otherwise the DC is
 * dropped (save button falls back to display-only) and a warning is logged.
 *
 * Also enforces that the speaker really is the caster: `casterActorId` must
 * equal the message's resolved speaker actor. A forged card claiming another
 * actor as caster (to make its owner able to roll damage) is rejected by
 * clearing the flag entirely.
 */
function sanitizeSpellCastCard(
  db: Db,
  card: SpellCastCard,
  speakerActorId: string | undefined,
): SpellCastCard | null {
  // The caster on the card MUST be the speaker actor of this message. This
  // prevents forging a card that names an actor the sender does not control
  // (the damage button's server gate rides on speakerActorId = casterActorId).
  if (!speakerActorId || card.casterActorId !== speakerActorId) {
    console.warn(
      `[chat] spellCast card rejected: casterActorId "${card.casterActorId}" != speaker "${speakerActorId ?? "<none>"}"`,
    );
    return null;
  }

  // DC coherence — never trust the client for the DC.
  if (card.dcValue !== undefined) {
    const knownDCs = readCasterSpellDCs(db, card.casterActorId);
    if (knownDCs.length > 0 && !knownDCs.includes(card.dcValue)) {
      console.warn(
        `[chat] spellCast DC ${String(card.dcValue)} for actor ${card.casterActorId} matches no derived spell DC (${knownDCs.join(",")}); dropping DC.`,
      );
      const { dcValue: _drop, ...rest } = card;
      return rest;
    }
  }

  return card;
}

/**
 * Read the actor's derived Kineticist class DC (`system.derived.classDC.dc`),
 * plus any archetype class DCs (`system.derived.archetypeClassDCs[].dc`), as the
 * set of DCs a Kineticist impulse's saving throw may legitimately use. Returns
 * an empty array when the actor is unknown or carries no derived class DC — the
 * caller then skips the coherence check (best-effort log, never a hard gate).
 */
function readCasterClassDCs(db: Db, actorId: string): number[] {
  try {
    const row = db.prepare(`SELECT data FROM actors WHERE id = ?`).get(actorId) as
      | { data: string }
      | undefined;
    if (!row) return [];
    const doc = JSON.parse(row.data) as Record<string, unknown>;
    const system = doc["system"] as Record<string, unknown> | undefined;
    const derived = system?.["derived"] as Record<string, unknown> | undefined;
    const dcs: number[] = [];
    const classDC = derived?.["classDC"] as { dc?: unknown } | undefined;
    if (typeof classDC?.dc === "number") dcs.push(classDC.dc);
    const archetypeDCs = derived?.["archetypeClassDCs"];
    if (Array.isArray(archetypeDCs)) {
      for (const entry of archetypeDCs) {
        const dc = (entry as { dc?: unknown } | null)?.dc;
        if (typeof dc === "number") dcs.push(dc);
      }
    }
    return dcs;
  } catch {
    return [];
  }
}

/**
 * Validate a client-provided AbilityCard flag before it is attached to a
 * ChatMessage (r20-X1) — the generalization of {@link sanitizeSpellCastCard}.
 * The shape is already Zod-validated by ChatSendPayloadSchema; here we add:
 *   - caster=speaker: `casterActorId` must equal the message's resolved speaker
 *     actor (a forged card naming another actor as user is rejected — clearing
 *     the flag), so the damage button's speaker=caster server gate holds;
 *   - DC coherence by kind: the client is NEVER trusted for the DC — if the
 *     actor has derived DCs, `dcValue` must match one (spellcasting DCs for
 *     `spell`, class DCs for `impulse`), otherwise the DC is dropped (the save
 *     button falls back to display-only) and a warning is logged. Strikes carry
 *     no DC, so the coherence check is skipped for them.
 */
function sanitizeAbilityCard(
  db: Db,
  card: AbilityCard,
  speakerActorId: string | undefined,
): AbilityCard | null {
  if (!speakerActorId || card.casterActorId !== speakerActorId) {
    console.warn(
      `[chat] abilityCard rejected: casterActorId "${card.casterActorId}" != speaker "${speakerActorId ?? "<none>"}"`,
    );
    return null;
  }

  if (card.dcValue !== undefined && card.kind !== "strike") {
    const knownDCs =
      card.kind === "impulse"
        ? readCasterClassDCs(db, card.casterActorId)
        : readCasterSpellDCs(db, card.casterActorId);
    if (knownDCs.length > 0 && !knownDCs.includes(card.dcValue)) {
      console.warn(
        `[chat] abilityCard (${card.kind}) DC ${String(card.dcValue)} for actor ${card.casterActorId} matches no derived DC (${knownDCs.join(",")}); dropping DC.`,
      );
      const { dcValue: _drop, ...rest } = card;
      return rest;
    }
  }

  return card;
}

// ---------------------------------------------------------------------------
// Speaker alias resolution (REQ-CHT-022)
// ---------------------------------------------------------------------------

function resolveSpeakerAlias(db: Db, userId: string, actorId?: string): string {
  // Try actor name first
  if (actorId) {
    try {
      const actor = db.prepare(`SELECT data FROM actors WHERE id = ?`).get(actorId) as
        | { data: string }
        | undefined;
      if (actor) {
        const data = JSON.parse(actor.data) as Record<string, unknown>;
        if (typeof data["name"] === "string") return data["name"];
      }
    } catch {
      // fall through
    }
  }

  // Fall back to user name
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
