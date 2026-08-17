/**
 * Chat handlers — chat:send, chat:history, chat:search, chat:context and
 * chat:invalidate.
 *
 * REQ-CHT-001..004: parse, execute rolls on server, persist, broadcast.
 * REQ-CHT-005: a message is never deleted — it is INVALIDATED, kept in place,
 *   with the record of who voided it and when (REQ-ACH-080..086).
 * REQ-CHT-050: search runs on the server, is open to every role, and reuses the
 *   history visibility predicate (no second rule).
 * REQ-CHT-051: context around a message counts only messages VISIBLE to the
 *   requester — an invisible one takes no slot and is never signalled.
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
  ChatSearchRequestSchema,
  ChatContextRequestSchema,
  ChatInvalidateRequestSchema,
  CHAT_BROADCAST_EVENT,
  CHAT_UPDATE_BROADCAST_EVENT,
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
  ChatTargetRef,
  RollTarget,
} from "@fusion/shared";

import type { HandlerFn, HandlerContext } from "../net/handler-registry.js";
import type { SeqStore } from "../net/seq-store.js";
import {
  isRolePrivileged,
  testOwnership,
  OwnershipLevel,
  UserRole,
} from "../documents/ownership.js";
import type { Ownership } from "../documents/ownership.js";
import {
  redactBlindRollForNonPrivileged,
  redactChatTargetsForNonPrivileged,
  redactSceneDocsForNonPrivileged,
} from "../net/redaction.js";
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
  // GAMEMASTER = 4, ASSISTANT = 3 — both are privileged
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
  fullMessage: ChatMessage,
  authorId: string,
): ChatMessage | null {
  const socketData = socket.data as { userId?: string; role?: number } | undefined;
  const socketUserId = socketData?.userId ?? "";
  const socketRole = socketData?.role ?? 0;
  const socketIsPrivileged = isRolePrivileged(socketRole);

  // The target's AC never leaves for a non-privileged socket — the degree of
  // success does (REQ-ACH-073 / REQ-ACH-092). Applied FIRST so every `return`
  // below hands out the already-redacted body.
  const msg = socketIsPrivileged ? fullMessage : redactChatTargetsForNonPrivileged(fullMessage);

  const whisper = msg.whisper;
  const isPublic = whisper.length === 0;

  if (isPublic) {
    // public message — everyone gets it
    if (msg.blind) {
      // blindroll: strip the result from non-GMs (and from the author) — the
      // dice AND the total in the text (REQ-ROL-032 / REQ-ACH-092).
      if (!socketIsPrivileged) {
        return redactBlindRollForNonPrivileged(msg);
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
    return redactBlindRollForNonPrivileged(msg);
  }

  return msg;
}

/**
 * Broadcast a ChatMessage to all eligible sockets in the namespace.
 * Applies roll-mode visibility rules per socket.
 *
 * `event` selects the envelope type: `doc:create` for a brand-new message
 * (REQ-CHT-004 / REQ-ROL-031) and `doc:update` for a message that changed after
 * the fact — invalidation (REQ-ACH-086). The eligibility walk is deliberately
 * THE SAME for both: whoever could not see the message never learns that it was
 * voided either.
 */
function broadcastChatMessage(
  ns: Namespace,
  seqStore: SeqStore,
  msg: ChatMessage,
  authorId: string,
  event: typeof CHAT_BROADCAST_EVENT | typeof CHAT_UPDATE_BROADCAST_EVENT = CHAT_BROADCAST_EVENT,
): number {
  const seq = seqStore.next();

  for (const [, socket] of ns.sockets) {
    // ONE funnel: the blindroll confirmation that REQ-ROL-032 owes the author
    // is built inside `buildPayloadForSocket`, like every other redaction. It
    // used to be a second body assembled right here, which is exactly how the
    // read paths (history/search/context/ack) ended up shipping the total.
    const payload = buildPayloadForSocket(socket, msg, authorId);

    if (payload === null) continue;

    const envelope: Envelope = {
      type: event,
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

      // --- Target (DEC-ACH-09 / REQ-ACH-070..073) ---
      // The payload names a token/actor; the PORTRAIT (name + the AC used) is
      // built here from what the server knows, and the roll is graded against
      // that AC. Without a resolvable target there is no degree of success
      // (REQ-ACH-071), and a target is only attached when it actually graded the
      // roll — so "has a target" and "has a degree" never disagree.
      // A roll already graded by a save checkContext keeps that grading: the DC
      // of a save is the caster's, not the target's AC.
      const targetPortrait =
        payload.target !== undefined && gradedSave === null
          ? resolveTargetPortrait(deps.db, payload.target, ctx)
          : null;
      let messageTargets: RollTarget[] | undefined;
      if (targetPortrait !== null && targetPortrait.ac !== undefined) {
        const degree = computeAttackDegree(rollResult, targetPortrait.ac);
        if (degree !== null) {
          rollResult = { ...rollResult, degreeOfSuccess: degree, target: targetPortrait };
          messageTargets = [targetPortrait];
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

      if (messageTargets !== undefined) {
        msg.targets = messageTargets;
      }

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

      return {
        ok: true,
        seq,
        result: { message: redactForAuthor(msg, ctx.userId, isRolePrivileged(ctx.role)) },
      };
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
// chat:search handler — REQ-CHT-050 / REQ-ACH-011 / REQ-ACH-012
// ---------------------------------------------------------------------------

/**
 * Upper bound of candidate rows the search walks per request. The scan stops as
 * soon as the requested page is filled, so this only caps the pathological case
 * (a very common term in a very long log).
 */
const CHAT_SEARCH_SCAN_CAP = 5_000;

/** Escape the LIKE metacharacters so a user term is matched literally. */
function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Free-text search over the chat log, for EVERY role (REQ-CHT-050, REQ-ACH-012).
 *
 * The result set is produced by walking the candidate rows newest-first and
 * handing every one of them to `redactForViewer` — the exact function
 * `chat:history` and the join snapshot use, which in turn mirrors
 * `buildPayloadForSocket` on the broadcast path. There is deliberately NO
 * search-specific visibility rule: a second predicate is a second place to get
 * it wrong, and the requirement forbids it.
 *
 * Storage note: spec 09 describes an FTS5 index, which does not exist in the
 * schema yet (creating it is a migration, owned by the database workstream).
 * Until then the match is a `LIKE` over `json_extract(data,'$.content')`,
 * backed by the `idx_chat_ts_id` index for the ordering. Behaviour visible to
 * the caller is the same; only the cost is.
 */
export function buildChatSearchHandler(deps: ChatHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = ChatSearchRequestSchema.safeParse(rawPayload);
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

    const term = req.q.trim();
    if (term.length === 0) {
      return {
        ok: false,
        code: "VALIDATION_FAILED" as const,
        message: "Empty search term",
      };
    }

    const privileged = isRolePrivileged(ctx.role);
    const pattern = `%${escapeLikeTerm(term)}%`;
    const skip = req.page * req.limit;

    const statement = deps.db.prepare(
      `SELECT id, data FROM chat_messages
       WHERE json_extract(data, '$.content') LIKE ? ESCAPE '\\'
       ORDER BY timestamp DESC, id DESC
       LIMIT ?`,
    );

    const messages: ChatMessage[] = [];
    let visibleSeen = 0;
    let hasMore = false;

    for (const raw of statement.iterate(pattern, CHAT_SEARCH_SCAN_CAP)) {
      const row = raw as { id: string; data: string };

      let msg: ChatMessage;
      try {
        msg = JSON.parse(row.data) as ChatMessage;
      } catch {
        continue;
      }

      // THE predicate — same function as chat:history / join snapshot.
      const redacted = redactForViewer(msg, ctx.userId, privileged);
      if (redacted === null) continue;

      // Paging counts VISIBLE results only: an invisible message never takes a
      // slot and is never signalled (REQ-CHT-050).
      visibleSeen++;
      if (visibleSeen <= skip) continue;

      if (messages.length >= req.limit) {
        hasMore = true;
        break;
      }
      messages.push(redacted);
    }

    return {
      ok: true,
      seq: deps.seqStore.peek(),
      result: {
        messages,
        page: req.page,
        hasMore,
      },
    };
  };
}

// ---------------------------------------------------------------------------
// chat:context handler — REQ-CHT-051 / REQ-ACH-013
// ---------------------------------------------------------------------------

/**
 * Upper bound of rows walked per side of the window. Only caps the pathological
 * case (a visible message buried under thousands of private ones); the walk
 * stops as soon as the requested side is filled.
 */
const CHAT_CONTEXT_SCAN_CAP = 2_000;

/** A stored chat row, parsed and redacted for one viewer. Null when unreadable. */
function readVisibleRow(data: string, viewerId: string, privileged: boolean): ChatMessage | null {
  let msg: ChatMessage;
  try {
    msg = JSON.parse(data) as ChatMessage;
  } catch {
    return null;
  }
  return redactForViewer(msg, viewerId, privileged);
}

/**
 * Context around one message — REQ-CHT-051, presented by REQ-ACH-013.
 *
 * Walks the log outward from the anchor in both directions and keeps only what
 * `redactForViewer` — THE predicate, the same one `chat:history`, `chat:search`
 * and the join snapshot use — hands back for this requester. A message the
 * requester cannot see is skipped silently: it does not consume a slot of the
 * `N`, it contributes no id, no count and no placeholder to the answer. That is
 * the whole point of the requirement: a hole in the window, or a count that did
 * not add up, would let the requester deduce that a private conversation
 * happened right there.
 *
 * The anchor itself must be visible. When it is not — or when it does not exist
 * at all — the refusal is byte-identical in both cases, so the error cannot be
 * used as an oracle for "there IS a message here you may not read".
 */
export function buildChatContextHandler(deps: ChatHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = ChatContextRequestSchema.safeParse(rawPayload);
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

    const privileged = isRolePrivileged(ctx.role);

    const notFound = {
      ok: false as const,
      code: "NOT_FOUND" as const,
      message: CHAT_ERROR_CODES.MESSAGE_NOT_FOUND,
    };

    const anchorRow = deps.db
      .prepare(`SELECT id, data, timestamp FROM chat_messages WHERE id = ?`)
      .get(req.id) as { id: string; data: string; timestamp: number } | undefined;

    if (!anchorRow) return notFound;

    const target = readVisibleRow(anchorRow.data, ctx.userId, privileged);
    // Same answer as a missing id — never leak that a hidden message lives here.
    if (target === null) return notFound;

    /**
     * Walk one side of the anchor collecting VISIBLE messages only. Keyset
     * comparison on `(timestamp, id)` mirrors the ordering of the log itself, so
     * the window is contiguous in the sequence the requester actually reads.
     */
    const collect = (side: "before" | "after"): { messages: ChatMessage[]; hasMore: boolean } => {
      const sql =
        side === "before"
          ? `SELECT data FROM chat_messages
             WHERE timestamp < ? OR (timestamp = ? AND id < ?)
             ORDER BY timestamp DESC, id DESC
             LIMIT ?`
          : `SELECT data FROM chat_messages
             WHERE timestamp > ? OR (timestamp = ? AND id > ?)
             ORDER BY timestamp ASC, id ASC
             LIMIT ?`;

      const messages: ChatMessage[] = [];
      let hasMore = false;

      for (const raw of deps.db
        .prepare(sql)
        .iterate(anchorRow.timestamp, anchorRow.timestamp, anchorRow.id, CHAT_CONTEXT_SCAN_CAP)) {
        const visible = readVisibleRow((raw as { data: string }).data, ctx.userId, privileged);
        if (visible === null) continue; // invisible: takes no slot, is never signalled

        if (messages.length >= req.limit) {
          // One more VISIBLE neighbour exists — that is all `hasMore` reports.
          hasMore = true;
          break;
        }
        messages.push(visible);
      }

      // `before` was walked newest-first; hand both sides back chronologically.
      if (side === "before") messages.reverse();
      return { messages, hasMore };
    };

    const before = collect("before");
    const after = collect("after");

    return {
      ok: true,
      seq: deps.seqStore.peek(),
      result: {
        target,
        before: before.messages,
        after: after.messages,
        hasMoreBefore: before.hasMore,
        hasMoreAfter: after.hasMore,
      },
    };
  };
}

// ---------------------------------------------------------------------------
// chat:invalidate handler — REQ-CHT-005 / REQ-ACH-080..086
// ---------------------------------------------------------------------------

/**
 * Rewrite the stored JSON of one chat message in place.
 *
 * This is the ONLY write the invalidation performs, and it targets exactly one
 * row of `chat_messages` (REQ-ACH-085): no actor is touched, no combat is
 * touched, no effect is removed and nothing is re-rolled. `timestamp` and
 * `author_id` are deliberately left alone — the message keeps its position in
 * the log, which is the whole point of invalidating instead of deleting.
 */
function rewriteChatMessage(db: Db, msg: ChatMessage): void {
  db.prepare(`UPDATE chat_messages SET data = ?, updated_at = ? WHERE id = ?`).run(
    JSON.stringify(msg),
    Date.now(),
    msg._id,
  );
}

/**
 * The Master's numeric role. Widened to `number` on purpose: `ctx.role` arrives
 * from the wire as a plain number, and comparing it against the enum member
 * directly is the "no shared enum type" lint error.
 */
const GAMEMASTER_ROLE: number = UserRole.GAMEMASTER;

/**
 * Decide whether `actor` may move `msg` to `wanted` — REQ-ACH-082/083.
 *
 * Invalidating is the GM's or the AUTHOR's (and nobody else's). Revalidating is
 * the GM's always, and the author's ONLY when the standing invalidation carries
 * his own id: the Master's invalidation is the last word, and the author cannot
 * take it back.
 *
 * Note that the GM check is `role === GAMEMASTER`, strictly, and not
 * `isRolePrivileged` — REQ-ACH-082 names the role literally. `isRolePrivileged`
 * (which also admits ASSISTANT) governs VISIBILITY, a different question,
 * and is still the only predicate used for that above.
 */
function mayChangeInvalidation(
  msg: ChatMessage,
  wanted: boolean,
  actorId: string,
  role: number,
): boolean {
  if (role === GAMEMASTER_ROLE) return true;
  const isAuthor = msg.speaker.userId === actorId;
  if (!isAuthor) return false;
  // Author invalidating his own message — REQ-ACH-082.
  if (wanted) return true;
  // Author revalidating: only what he himself invalidated — REQ-ACH-083.
  return msg.invalidatedBy === actorId;
}

/**
 * Invalidate / revalidate one message — REQ-CHT-005, detailed by
 * REQ-ACH-080..086.
 *
 * Nothing is ever deleted. The message keeps its `_id`, its `timestamp` and its
 * place in the log; it only gains `invalid` plus the record of who voided it and
 * when (REQ-ACH-084). That record SURVIVES revalidation — revalidating clears
 * `invalid` and leaves `invalidatedBy`/`invalidatedAt` standing as the history
 * of the last invalidation.
 *
 * Two properties are worth stating because they are easy to lose:
 *
 * 1. **The operation stops at the log.** It writes one row of `chat_messages`
 *    and emits one broadcast; it applies no damage, reverses no damage, touches
 *    no actor, no combat, no effect, and triggers no automatic follow-up
 *    (REQ-ACH-085). Whether the fiction is rewound is the narrator's call, made
 *    by hand, at the table.
 * 2. **Re-invalidating an already invalid message is a no-op.** Without that,
 *    an author could invalidate a message the GM had already invalidated,
 *    thereby stamping his own id into `invalidatedBy` and buying himself the
 *    right to revalidate it — which is precisely the hole REQ-ACH-083 closes.
 *
 * A message the caller cannot see answers exactly like a message that does not
 * exist (`NOT_FOUND` / `CHT_MESSAGE_NOT_FOUND`), the same choice `chat:context`
 * makes: a distinguishable refusal would itself confirm that a private message
 * lives at that id.
 */
export function buildChatInvalidateHandler(deps: ChatHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = ChatInvalidateRequestSchema.safeParse(rawPayload);
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

    const privileged = isRolePrivileged(ctx.role);

    const notFound = {
      ok: false as const,
      code: "NOT_FOUND" as const,
      message: CHAT_ERROR_CODES.MESSAGE_NOT_FOUND,
    };

    const row = deps.db.prepare(`SELECT data FROM chat_messages WHERE id = ?`).get(req._id) as
      | { data: string }
      | undefined;
    if (!row) return notFound;

    let stored: ChatMessage;
    try {
      stored = JSON.parse(row.data) as ChatMessage;
    } catch {
      return notFound;
    }

    // Visibility first, and by THE predicate — a message the caller may not read
    // is a message the caller may not moderate, and the refusal must not double
    // as an oracle for "something private happened here".
    if (redactForViewer(stored, ctx.userId, privileged) === null) return notFound;

    if (!mayChangeInvalidation(stored, req.invalid, ctx.userId, ctx.role)) {
      return {
        ok: false as const,
        code: "PERMISSION_DENIED" as const,
        message: CHAT_ERROR_CODES.INVALIDATE_DENIED,
      };
    }

    const currentlyInvalid = stored.invalid === true;
    if (currentlyInvalid === req.invalid) {
      // Already in the requested state: nothing is rewritten and nothing is
      // broadcast. Crucially `invalidatedBy` is NOT reassigned (see the note on
      // REQ-ACH-083 above), and no other document is touched either way.
      return {
        ok: true,
        seq: deps.seqStore.peek(),
        result: { message: redactForViewer(stored, ctx.userId, privileged) },
      };
    }

    const now = Date.now();
    const updated: ChatMessage = {
      ...stored,
      invalid: req.invalid,
      // On invalidation, stamp the operator. On revalidation, keep the standing
      // record — REQ-ACH-084 asks it to survive as the history of the last
      // invalidation, not to be erased or overwritten by the restorer.
      invalidatedBy: req.invalid ? ctx.userId : stored.invalidatedBy,
      invalidatedAt: req.invalid ? now : stored.invalidatedAt,
      _stats: {
        ...stored._stats,
        modifiedTime: now,
        version: stored._stats.version + 1,
        lastModifiedBy: ctx.userId,
      },
    };

    rewriteChatMessage(deps.db, updated);

    // Propagated like any other message update, to every eligible client and to
    // nobody else — REQ-ACH-086.
    const seq = broadcastChatMessage(
      deps.ns,
      deps.seqStore,
      updated,
      updated.speaker.userId,
      CHAT_UPDATE_BROADCAST_EVENT,
    );

    return {
      ok: true,
      seq,
      result: { message: redactForViewer(updated, ctx.userId, privileged) },
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
  fullMessage: ChatMessage,
  viewerId: string,
  privileged: boolean,
): ChatMessage | null {
  // Same rule as the live broadcast: the AC of the target is privileged data,
  // the degree of success is not (REQ-ACH-073 / REQ-ACH-092). Applied FIRST so
  // history, search, context, the invalidation ack and the join snapshot — every
  // caller of this function — hand out the same already-redacted body.
  const msg = privileged ? fullMessage : redactChatTargetsForNonPrivileged(fullMessage);

  const whisper = msg.whisper;
  const isPublic = whisper.length === 0;

  if (isPublic) {
    // Everyone sees public messages; GMs see full; non-GMs get the blind result
    // stripped — dice AND the total in the text (REQ-ROL-032 / REQ-ACH-092).
    if (msg.blind && !privileged) {
      return redactBlindRollForNonPrivileged(msg);
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
    return redactBlindRollForNonPrivileged(msg);
  }

  return msg;
}

/**
 * Redact for the message author (used in the ack of `chat:send`).
 *
 * The ack is a payload like any other: the author of a blind roll gets the same
 * confirmation body the broadcast hands him, never the total (REQ-ROL-032 /
 * REQ-ACH-092). A privileged author keeps the full result — his own screen is
 * allowed to show it.
 */
function redactForAuthor(msg: ChatMessage, authorId: string, privileged: boolean): ChatMessage {
  if (privileged) return msg;
  const withoutAc = redactChatTargetsForNonPrivileged(msg);
  if (withoutAc.blind && withoutAc.speaker.userId === authorId) {
    return redactBlindRollForNonPrivileged(withoutAc);
  }
  return withoutAc;
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
// Target portrait — DEC-ACH-09 / REQ-ACH-070..074
// ---------------------------------------------------------------------------

/**
 * Read the AC the server itself derived for an actor: `system.derived.ac.total`
 * when the derivation pipeline has run, falling back to the authored
 * `system.attributes.ac.value` (a bestiary NPC straight out of a pack, before
 * any derivation). Returns null when the actor is unknown or carries no AC — and
 * then no target portrait is written at all, because a degree of success without
 * a DC is a guess presented as a rule (DEC-ACH-09).
 */
function readActorAc(db: Db, actorId: string): number | null {
  try {
    const row = db.prepare(`SELECT data FROM actors WHERE id = ?`).get(actorId) as
      | { data: string }
      | undefined;
    if (!row) return null;
    const doc = JSON.parse(row.data) as Record<string, unknown>;
    const system = doc["system"] as Record<string, unknown> | undefined;

    const derived = system?.["derived"] as Record<string, unknown> | undefined;
    const derivedAc = derived?.["ac"] as { total?: unknown } | undefined;
    if (typeof derivedAc?.total === "number") return derivedAc.total;

    const attributes = system?.["attributes"] as Record<string, unknown> | undefined;
    const authoredAc = attributes?.["ac"] as { value?: unknown } | undefined;
    if (typeof authoredAc?.value === "number") return authoredAc.value;

    return null;
  } catch {
    return null;
  }
}

/** The actor's name, or null when the actor is unknown/unreadable. */
function readActorName(db: Db, actorId: string): string | null {
  try {
    const row = db.prepare(`SELECT name FROM actors WHERE id = ?`).get(actorId) as
      | { name: string }
      | undefined;
    return row && row.name.length > 0 ? row.name : null;
  } catch {
    return null;
  }
}

/**
 * Find a token by `_id` across the scenes of the world. Tokens are embedded in
 * the Scene JSON (DEC-PER-02), so there is no table to index — the world has a
 * handful of scenes and this runs once per targeted roll.
 *
 * A NON-PRIVILEGED requester only ever searches the scenes as the redaction
 * module hands them to him: `redactSceneDocsForNonPrivileged` drops every scene
 * that is not on air (REQ-CEN-071/073) and every hidden token (REQ-VIS-005), so
 * a token he cannot see on the canvas cannot be found here either — no second
 * predicate is written, the canonical one is reused. The token id is not a
 * secret (he saw the token before the Mestre hid it), so the id alone must not
 * buy the name back.
 */
function findTokenById(
  db: Db,
  tokenId: string,
  privileged: boolean,
): { name: string; actorId: string | null } | null {
  let rows: { data: string }[];
  try {
    rows = db.prepare(`SELECT data FROM scenes`).all() as { data: string }[];
  } catch {
    return null;
  }

  for (const row of rows) {
    let scene: Record<string, unknown>;
    try {
      scene = JSON.parse(row.data) as Record<string, unknown>;
    } catch {
      continue;
    }

    // What this requester is allowed to read of this scene — nothing at all for
    // a player when the scene is off air.
    const visibleScenes = privileged ? [scene] : redactSceneDocsForNonPrivileged([scene]);

    for (const visible of visibleScenes) {
      const tokens = visible["tokens"];
      if (!Array.isArray(tokens)) continue;
      for (const raw of tokens as Record<string, unknown>[]) {
        if (raw["_id"] !== tokenId) continue;
        const name = typeof raw["name"] === "string" ? raw["name"] : "";
        const actorId = typeof raw["actorId"] === "string" ? raw["actorId"] : null;
        return { name, actorId };
      }
    }
  }
  return null;
}

/**
 * Whether this requester may name an actor DIRECTLY (a target reference with no
 * token). With a token the visibility comes from the canvas — he is looking at
 * it. Without one, the only thing standing between a guessed id and an actor's
 * name is ownership, so at least OBSERVER is required (REQ-ACH-092). Privileged
 * roles bypass, as everywhere else.
 */
function mayNameActorDirectly(db: Db, actorId: string, ctx: HandlerContext): boolean {
  if (isRolePrivileged(ctx.role)) return true;
  try {
    const row = db.prepare(`SELECT data FROM actors WHERE id = ?`).get(actorId) as
      | { data: string }
      | undefined;
    if (!row) return false;
    const doc = JSON.parse(row.data) as { ownership?: Ownership };
    return testOwnership(doc.ownership ?? {}, ctx.userId, ctx.role, OwnershipLevel.OBSERVER);
  } catch {
    return false;
  }
}

/**
 * Turn the client's target REFERENCE into the PORTRAIT that gets written on the
 * message (REQ-ACH-072): the name as it reads right now and the AC the server
 * itself derived. The client never supplies either — an AC that arrived from the
 * wire would be an AC the attacker chose.
 *
 * A portrait is only produced when BOTH the name and the AC resolve. Returns
 * null otherwise, and a null target means the roll goes out as a plain total,
 * with no degree of success (REQ-ACH-071) — never a hard failure, exactly like a
 * dangling `parentMessageId`.
 *
 * When a token is named, ITS actor decides the AC: a payload that pairs a token
 * with someone else's actorId cannot make the server read the softer defence.
 *
 * The reference is also resolved THROUGH the requester's own visibility: a
 * player who names a hidden token, a token of a scene that is off air, or an
 * actor he does not observe gets `null` — the same "no portrait, no degree"
 * outcome as a dangling reference (REQ-ACH-092). The name of what the Mestre
 * hid is not published by the chat.
 */
function resolveTargetPortrait(db: Db, ref: ChatTargetRef, ctx: HandlerContext): RollTarget | null {
  const privileged = isRolePrivileged(ctx.role);
  let name = "";
  let actorId: string | null = ref.actorId ?? null;

  if (ref.tokenId !== undefined) {
    const token = findTokenById(db, ref.tokenId, privileged);
    if (token === null) return null;
    name = token.name;
    actorId = token.actorId ?? ref.actorId ?? null;
  } else if (actorId !== null && !mayNameActorDirectly(db, actorId, ctx)) {
    return null;
  }

  if (actorId === null) return null;

  const ac = readActorAc(db, actorId);
  if (ac === null) return null;

  if (name.length === 0) {
    const actorName = readActorName(db, actorId);
    if (actorName === null) return null;
    name = actorName;
  }

  return { name, ac };
}

/**
 * Grade an attack roll against the target's AC, on the server, with the same
 * 2e mechanic (and the same nat20/nat1 shift) the save path uses — one source of
 * truth for degree of success. Returns null when the roll carries no d20 to
 * grade: a damage roll aimed at someone is still just damage.
 */
export function computeAttackDegree(roll: RollResultData, ac: number): string | null {
  const natural = readNaturalD20(roll.terms);
  if (natural === null) return null;
  const degree = calculateDegreeOfSuccess(roll.total, ac, natural);
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
