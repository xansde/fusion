/**
 * sendOp — typed socket.io op emitter with ack correlation.
 *
 * REQ-NET-011: requests include requestId (ULID); server echoes it in ack.
 * The promise resolves when the ack with matching requestId arrives.
 * Rejects on timeout (default 10 s) or ack.ok === false.
 *
 * Usage:
 *   const result = await sendOp(socket, { type: "doc:update", payload: {...} });
 */

import type { Socket } from "socket.io-client";
import type { Envelope, Ack, ErrorCode, ChatMessage } from "@fusion/shared";
import { createDocumentId } from "@fusion/shared";
import type { DocumentMirror } from "./DocumentMirror.js";
import { worldMirror } from "./worldSync.js";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class OpError extends Error {
  constructor(
    public readonly code: ErrorCode | "TIMEOUT",
    message: string,
  ) {
    super(message);
    this.name = "OpError";
  }
}

// ---------------------------------------------------------------------------
// sendOp
// ---------------------------------------------------------------------------

export interface SendOpOptions {
  /** Timeout in ms before the promise rejects with TIMEOUT. Default: 10 000. */
  timeoutMs?: number;
}

/**
 * Emit an op via the socket.io "op" event and wait for the ack.
 *
 * Automatically adds `requestId` and `ts` to the envelope.
 * The ack's `requestId` is matched against the sent one for correctness.
 *
 * @param socket  Connected socket.io Socket.
 * @param envelope  Partial envelope (type + payload required; requestId/ts are added).
 * @param options  Optional timeout override.
 * @returns The `result` field of the success ack.
 * @throws {OpError} on ack failure or timeout.
 */
export function sendOp<R = unknown>(
  socket: Socket,
  envelope: Omit<Envelope, "requestId" | "ts"> & { requestId?: string },
  options: SendOpOptions = {},
): Promise<R> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const requestId = envelope.requestId ?? createDocumentId();

  const outgoing: Envelope = {
    ...envelope,
    requestId,
    ts: Date.now(),
  };

  return new Promise<R>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new OpError(
          "TIMEOUT",
          `Op "${outgoing.type}" timed out after ${timeoutMs.toString()}ms (requestId=${requestId})`,
        ),
      );
    }, timeoutMs);

    socket.emit("op", outgoing, (ack: Ack<R>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      // REQ-NET-011: verify requestId echo (advisory — server may not yet echo)
      if (ack.requestId !== undefined && ack.requestId !== requestId) {
        // Mismatched requestId — likely a bug in the server; still resolve if ok
        console.warn(`[sendOp] requestId mismatch: sent=${requestId} got=${ack.requestId}`);
      }

      if (ack.ok) {
        resolve(ack.result);
      } else {
        reject(new OpError(ack.code, ack.message));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// sendChatOpForId — flat chat:send op → resolves the canonical message id
// ---------------------------------------------------------------------------

/**
 * Send a flat `chat:send` op and resolve the CANONICAL message `_id` the server
 * assigned (r18-N1). Every chat:send branch returns `{ result: { message } }`
 * (see chat-handler.ts), so the id is already on the ack — no wire change.
 *
 * Used by the spell-cast flow (SpellsTab) to chain the spell-attack roll under
 * its announcement: send the announcement here, then send the attack with
 * `flags.parentMessageId` = the returned id, so the chat nests them into ONE
 * card instead of two loose messages. Returns null when the ack carries no
 * message (defensive — should not happen for chat:send).
 *
 * Throws {@link OpError} on ack failure / timeout, exactly like sendOp(); the
 * caller decides whether to still fire the child un-nested (the fallback is a
 * top-level roll, never a lost roll).
 */
// T exists so object literals keep excess-property checking; a non-generic
// parameter type would silently accept extra keys.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export async function sendChatOpForId<T extends { readonly type: "chat:send" }>(
  socket: Socket,
  // Accept any flat chat:send op object (an inline literal OR a nominal
  // interface like ChatRollPayload, which lacks an index signature and so isn't
  // assignable to `Record<string, unknown>`). Generic over the op shape so
  // excess-property checks on literals still pass. We only split `type` off and
  // forward the rest as the payload.
  op: T,
  options: SendOpOptions = {},
): Promise<string | null> {
  const { type, ...payload } = op as { type: "chat:send" } & Record<string, unknown>;
  const result = await sendOp<{ message?: ChatMessage }>(socket, { type: type, payload }, options);
  return result.message?._id ?? null;
}

// ---------------------------------------------------------------------------
// makeSendOpFn — adapts sendOp() to the flat `sendOpFn(op)` callback shape
// ---------------------------------------------------------------------------

/**
 * Accessor for a DocumentMirror, in the SAME shape the FROZEN-SOCKET FIX
 * below uses for the socket: either a direct instance, or a closure resolved
 * lazily on every op. Unlike the socket, the mirror instance itself never
 * goes stale across a reconnect (SocketManager.connect() replaces the Socket,
 * never worldMirror), so the closure form exists purely for callers (tests,
 * mainly) that want to inject a mirror without touching the real singleton —
 * not because the direct-instance form would go stale.
 */
export type MirrorAccessor = DocumentMirror | (() => DocumentMirror | null);

/**
 * Resolve a MirrorAccessor, defaulting to the app's real singleton
 * (worldSync.ts's `worldMirror`) when the caller passes nothing at all.
 *
 * T013: this default is what lets every EXISTING call site (ActorDirectory.
 * svelte, ActionsTab.svelte, FamiliarSheet.svelte, PetsTab.svelte — all
 * outside this package's ownership for this task) start filling
 * `expectedVersion` automatically with zero changes on their end: they call
 * `makeSendOpFn(socket)` / `toEnvelope(op)` with a single argument today, and
 * omitting the second (mirror) argument resolves here to the live world
 * mirror rather than to "no mirror at all". A caller that explicitly wants to
 * opt out (or inject a test double) still can, by passing `() => null` or a
 * real DocumentMirror instance.
 */
function resolveMirror(mirror: MirrorAccessor | undefined): DocumentMirror | null {
  if (mirror === undefined) return worldMirror;
  return typeof mirror === "function" ? mirror() : mirror;
}

// ---------------------------------------------------------------------------
// T013 (redesign): per-document write queue + last-acked-version cache
//
// PROBLEM this replaces: a flow that fires several PRIMARY doc:update ops for
// the SAME document in one synchronous tick (no await between sends) had every
// op read `expectedVersion` from the SAME not-yet-advanced DocumentMirror
// snapshot. The first landed; every sibling came back STALE_WRITE and was
// swallowed by makeSendOpFn's fire-and-forget `.catch(console.error)`. The
// previous fix coalesced known offending op arrays inside planVM.ts/
// PlanColumn.svelte — but that only protects call sites someone audited.
// CharacterSheet.svelte's rest() (HP heal + Focus Points refill, two primary
// Actor updates, never coalesced) and PlanColumn's
// handleAbilityBoostsConfirm (which calls sendOpFn in a loop, bypassing
// PlanColumn's own sendAll/coalescing) both escaped it.
//
// FIX (this block): resolve it once, in the funnel every VM already goes
// through — makeSendOpFn's returned function — instead of in each VM.
//   A) primaryWriteQueues serializes writes per document `_id`: a write to a
//      document already in flight waits for that write to SETTLE (not just
//      "be sent") before it normalizes its OWN payload. Because the version
//      read (fillExpectedVersion, below) happens INSIDE the queued task —
//      i.e. after the wait — the second write reads whatever the first
//      write's ack produced, not a stale pre-wait snapshot.
//   B) lastAckedVersion caches the version each of THIS client's own
//      successful doc:update acks confirmed, keyed by `_id`. Consulted by
//      fillExpectedVersion ALONGSIDE the DocumentMirror (the higher of the
//      two wins). This is what actually closes the race for (A): the mirror
//      only learns a document's new version from a SEPARATE broadcast "op"
//      event (worldSync.ts's onOp → DocumentMirror.feedOp) that arrives on
//      its own schedule, independent of the ack — there is no ordering
//      guarantee that broadcast has already reached the mirror by the time
//      the NEXT queued write for that document is ready to read a version
//      (verified by reading worldSync.ts: the mirror is fed exclusively by
//      the "op" listener, never by sendOp's ack callback). Reading the
//      version straight off the ack's OWN returned document (doc-handlers.ts
//      returns the identical `{ documentType, documents }` shape in both the
//      ack's `result` and the broadcast payload — see buildDocUpdateHandler's
//      `ackOk({ documentType, documents: updated }, seq)`) sidesteps that
//      race entirely instead of gambling on delivery order.
//   Retry-on-STALE_WRITE (sendPrimaryDocUpdate, below) is the remaining
//   safety net for staleness this queue can't prevent — a write from OUTSIDE
//   the queue (another client, or a doc:update issued via `toEnvelope`+
//   `sendOp` directly, e.g. PetsTab.svelte/FamiliarSheet.svelte, which this
//   funnel intentionally does not intercept — see their own docstrings).
//
// Scope: PRIMARY doc:update only (embedded doc:update has no expectedVersion
// concept server-side at all — see doc-handlers.ts's handleEmbeddedUpdate
// comment — so there is nothing to serialize or retry there). doc:create/
// doc:delete are untouched: create mints a fresh document (nothing to race a
// version against) and delete has no partial-failure/retry story here.
// ---------------------------------------------------------------------------

/**
 * One promise per document `_id` currently occupied by a queued primary
 * doc:update — resolves (never rejects; see enqueuePrimaryWrite) once that
 * write has fully settled. Absent entry = nothing in flight for that id.
 */
const primaryWriteQueues = new Map<string, Promise<void>>();

/**
 * The `_stats.version` this client most recently confirmed via a SUCCESSFUL
 * doc:update ack, keyed by `_id`. See the block comment above for why this
 * exists instead of relying on the DocumentMirror alone.
 */
const lastAckedVersion = new Map<string, number>();

/**
 * TEST-ONLY: clear both module-level maps. `primaryWriteQueues`/
 * `lastAckedVersion` are process-lifetime singletons (correct in the running
 * app — one funnel, one truth, for the whole session) but that means they
 * ALSO persist across `it()` blocks within one test file/process. Without an
 * explicit reset, an unsettled queue entry left behind by one test (e.g. a
 * test that never triggers its mock ack) would permanently block every LATER
 * test that happens to reuse the same document id — not a flaky failure, a
 * hang. Call this from `beforeEach` in any test that exercises
 * makeSendOpFn's doc:update path.
 */
export function _resetPrimaryWriteStateForTests(): void {
  primaryWriteQueues.clear();
  lastAckedVersion.clear();
}

/**
 * Record the version(s) a successful doc:update ack confirmed, from its
 * `result.documents` (the SAME shape the server broadcasts — see the block
 * comment above).
 */
function rememberAckedVersions(result: { documents?: unknown[] } | undefined): void {
  const documents = result?.documents;
  if (!Array.isArray(documents)) return;
  for (const item of documents) {
    const doc = item as Record<string, unknown>;
    const id = doc["_id"];
    const stats = doc["_stats"] as Record<string, unknown> | undefined;
    const version = stats?.["version"];
    if (typeof id === "string" && typeof version === "number" && Number.isFinite(version)) {
      lastAckedVersion.set(id, version);
    }
  }
}

/**
 * Serialize `task` behind any write already queued for one of `ids`.
 *
 * FAST PATH: when none of `ids` has a write in flight, `task()` is invoked
 * SYNCHRONOUSLY (not via a `.then()` hop) — this preserves makeSendOpFn's
 * existing contract that calling the returned function emits on the socket
 * within the SAME synchronous tick (every VM dispatches ops in a plain
 * `for`/forEach loop with no `await`, and the existing test suite asserts on
 * `socket.emit` immediately after calling `fn(op)` with no `await` in
 * between). Only a write that finds a PENDING predecessor actually defers —
 * exactly the case this queue exists to fix.
 */
function enqueuePrimaryWrite(ids: readonly string[], task: () => Promise<void>): Promise<void> {
  const uniqueIds = Array.from(new Set(ids));
  const priors = uniqueIds
    .map((id) => primaryWriteQueues.get(id))
    .filter((p): p is Promise<void> => p !== undefined);

  const run = priors.length === 0 ? task() : Promise.all(priors).then(task);

  // Never-rejecting companion promise: what the NEXT write behind this one
  // waits on. A failed write must still unblock its queue — it already
  // reported its own error via sendPrimaryDocUpdate's caller.
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  for (const id of uniqueIds) {
    primaryWriteQueues.set(id, settled);
  }
  void settled.then(() => {
    for (const id of uniqueIds) {
      // Only remove OUR entry — a newer write may have already replaced it.
      if (primaryWriteQueues.get(id) === settled) primaryWriteQueues.delete(id);
    }
  });
  return run;
}

/**
 * The `_id`s of every PRIMARY (non-embedded) entry a flat or already-batched
 * doc:update op targets — the set enqueuePrimaryWrite should serialize on.
 * Returns `[]` for an embedded op (nothing to serialize: no expectedVersion
 * concept there) or a malformed payload.
 */
function primaryDocUpdateIds(payload: Record<string, unknown>): string[] {
  if ("updates" in payload) {
    const updates = payload["updates"];
    if (!Array.isArray(updates)) return [];
    return updates
      .map((u) => u as Record<string, unknown>)
      .filter((u) => u["embedded"] === undefined && typeof u["_id"] === "string")
      .map((u) => u["_id"] as string);
  }
  if (payload["embedded"] !== undefined) return [];
  const id = payload["id"];
  return typeof id === "string" ? [id] : [];
}

/**
 * T013: fill a missing `expectedVersion` on a PRIMARY update entry from the
 * best AVAILABLE known version — `lastAckedVersion` and the DocumentMirror,
 * whichever is higher — so sheet VMs (none of which set the field
 * themselves) keep working under doc-handlers.ts's new "expectedVersion is
 * mandatory for non-privileged writers" gate.
 *
 * Deliberately narrow:
 *   - Only fills when `expectedVersion` is ALREADY absent — an explicit value
 *     the caller supplied (e.g. a sheet doing its own optimistic-lock retry)
 *     is never overwritten.
 *   - Never touches an `embedded` entry — the server's mandatory gate is
 *     scoped to the primary path only; embedded doc:update has no version
 *     check at all (see doc-handlers.ts).
 *   - Document absent from BOTH sources, or present but with a missing/
 *     malformed `_stats.version` (a hand-seeded/legacy document — see
 *     doc-handlers.ts's STALE_WRITE comment), leaves the field unset rather
 *     than guessing. Sending a wrong number would either falsely STALE_WRITE
 *     a legitimate edit or falsely let a wrong one through; leaving it unset
 *     hands the decision to the server's own policy (rejected for non-GM,
 *     accepted for GM/ASSISTANT) — the correct outcome for a document the
 *     client never actually saw a version for.
 *   - `lastAckedVersion` and the mirror are compared, not one preferred
 *     outright: `lastAckedVersion` is only ever set from THIS client's own
 *     writes, so a resync/full-snapshot that picked up a version bumped by
 *     ANOTHER client could leave the mirror ahead of it. Taking the max
 *     avoids regressing to a value we already know is stale in either
 *     direction.
 */
function fillExpectedVersion(
  entry: Record<string, unknown>,
  documentType: string,
  mirror: DocumentMirror | null,
): Record<string, unknown> {
  if (entry["expectedVersion"] !== undefined) return entry;
  if (entry["embedded"] !== undefined) return entry;
  const id = entry["_id"];
  if (typeof id !== "string") return entry;

  const cached = lastAckedVersion.get(id);
  const mirrored = readMirrorVersion(mirror, documentType, id);
  const version =
    cached === undefined ? mirrored : mirrored === undefined ? cached : Math.max(cached, mirrored);
  if (version === undefined) return entry;
  return { ...entry, expectedVersion: version };
}

/** The `_stats.version` the mirror currently holds for `type`/`id`, if numeric. */
function readMirrorVersion(
  mirror: DocumentMirror | null,
  documentType: string,
  id: string,
): number | undefined {
  if (!mirror) return undefined;
  const doc = mirror.getDoc<Record<string, unknown>>(documentType, id);
  const stats = doc?.["_stats"] as Record<string, unknown> | undefined;
  const version = stats?.["version"];
  return typeof version === "number" && Number.isFinite(version) ? version : undefined;
}

/**
 * Send ONE primary doc:update through the queue, retrying ONCE if the server
 * rejects with STALE_WRITE.
 *
 * `payload` is the FLAT (pre-normalization) shape makeSendOpFn's returned
 * function received — normalization (where fillExpectedVersion reads the
 * current best-known version) is deliberately deferred until THIS function
 * actually runs, i.e. after enqueuePrimaryWrite has waited its turn. That
 * deferral is the fix for the original bug: by the time this runs, any write
 * this call was queued behind has already settled and updated
 * `lastAckedVersion` (via rememberAckedVersions below), so normalizing HERE
 * sees the version that write produced — never a value read before that
 * write was even sent.
 */
async function sendPrimaryDocUpdate(
  resolveSocket: () => Socket | null,
  payload: Record<string, unknown>,
  mirror: MirrorAccessor | undefined,
): Promise<void> {
  const attempt = async (): Promise<void> => {
    const live = resolveSocket();
    if (!live) {
      console.error(`[sendOpFn] "doc:update" dropped: no live socket (disconnected?)`);
      return;
    }
    const normalized = normalizeDocUpdate(payload, resolveMirror(mirror));
    const result = await sendOp<{ documentType?: string; documents?: unknown[] }>(live, {
      type: "doc:update",
      payload: normalized,
    });
    rememberAckedVersions(result);
  };

  try {
    await attempt();
  } catch (err) {
    if (!(err instanceof OpError) || err.code !== "STALE_WRITE") throw err;
    // T013 item B: exactly ONE retry, never a loop. The STALE_WRITE ack
    // itself carries no version or document to retry with — doc-handlers.ts
    // rejects it as a bare `ackError("STALE_WRITE", "Document has been
    // modified since last read")`, nothing else. The only channel that could
    // have delivered a fresher version by the time we're back here is the
    // CONFLICTING writer's own broadcast "op" event reaching this client's
    // DocumentMirror (worldSync.ts) — which, chronologically, happened
    // before our write was even rejected, so it has had a full round trip to
    // arrive. Re-running normalizeDocUpdate re-reads lastAckedVersion/mirror
    // at this later instant and picks that up if it landed. If it didn't
    // (broadcast still in flight, or the rejection had another cause), the
    // retry sends the SAME version again and fails the same way — on
    // purpose: a second STALE_WRITE propagates to the caller instead of
    // retrying forever.
    await attempt();
  }
}

/**
 * Every sheet VM (CharacterSheetVM, OradorSheetVM, CompositorVM, ...) builds
 * "op" objects shaped as `{ type: "...", ...fields }` (flat — see e.g.
 * DocUpdatePayload in oradorSheetVM.ts or EtmosConjuracaoProporOp in
 * compositorVM.ts) and every sheet component takes a `sendOpFn?: (op) => void`
 * prop with a no-op default (injected for testability, mirroring
 * CharacterSheet.svelte's pattern).
 *
 * `sendOp()` itself expects the split `{ type, payload }` envelope shape.
 * This adapter is the ONE place that bridges the two: split `type` from the
 * rest of the flat op and forward to `sendOp(socket, { type, payload })`.
 *
 * Callers that open a sheet/window (ActorDirectory.svelte, registerEtmosSheets.ts)
 * should build `sendOpFn` via this helper instead of leaving the prop
 * unset — an unset `sendOpFn` silently no-ops (see each sheet's default),
 * which would make every button that only calls `sendOpFn(...)` (autosave,
 * rolls, "Propor ao Narrador") appear to do nothing.
 *
 * doc:update shape mismatch (pre-existing, not introduced by this adapter):
 * every sheet VM's DocUpdatePayload is `{ type: "doc:update", documentType,
 * id, diff, expectedVersion? }` (singular `id`/`diff`), but the WIRE schema
 * (`DocUpdatePayloadSchema`, packages/shared/src/protocol.ts) requires
 * `{ documentType, updates: [{ _id, diff, expectedVersion? }] }` (a batch
 * array). Sending the flat shape gets rejected with VALIDATION_FAILED —
 * verified against a real boot()'d server. Normalizing here (instead of in
 * every VM) fixes autosave for ALL sheets — PF2e's CharacterSheet/NpcSheet
 * included — without touching their (correct, well-tested) VM logic.
 *
 * FROZEN-SOCKET FIX: `socket` may be a Socket instance (legacy — captured at
 * call time) OR an accessor `() => Socket | null` resolved lazily on EVERY
 * op. Sheet windows outlive socket reconnects (SocketManager.connect()
 * creates a brand-new Socket instance, so a captured reference goes stale
 * and its emits are silently buffered forever — see WindowHost's frozen
 * componentProps). Callers that open long-lived windows (ActorDirectory)
 * should pass `() => getSocket()` so ops always ride the LIVE socket. When
 * the accessor returns null/disconnected at op time, the op is dropped with
 * a console.error (the sheet's own UI feedback for that case lives in the
 * feature components, e.g. SpellPickerDialog's not-connected state).
 *
 * @param mirror  T013: accessor for the DocumentMirror used to auto-fill a
 *   missing `expectedVersion` on doc:update (see fillExpectedVersion above).
 *   Optional — omitting it (every existing call site does) resolves to the
 *   app's real `worldMirror` singleton via resolveMirror's default, so this
 *   is opt-OUT (`() => null`), not opt-in.
 */
export function makeSendOpFn(
  socket: Socket | (() => Socket | null),
  mirror?: MirrorAccessor,
): (op: unknown) => void {
  const resolveSocket: () => Socket | null = typeof socket === "function" ? socket : () => socket;
  return (op) => {
    if (op === null || typeof op !== "object" || !("type" in op)) {
      console.error("[sendOpFn] malformed op (missing type):", op);
      return;
    }
    const { type, ...payload } = op as { type: string } & Record<string, unknown>;

    // T013: PRIMARY doc:update writes are serialized per document _id and
    // retried once on STALE_WRITE — see the "per-document write queue" block
    // above (enqueuePrimaryWrite/sendPrimaryDocUpdate). This is the funnel
    // fix for a caller (rest(), handleAbilityBoostsConfirm, ...) that fires
    // several primary doc:update ops for the SAME document in one
    // synchronous tick with no await between them. An embedded doc:update
    // (ids.length === 0) falls through to the plain path below unchanged —
    // there is no expectedVersion concept to race there.
    if (type === "doc:update") {
      const ids = primaryDocUpdateIds(payload);
      if (ids.length > 0) {
        void enqueuePrimaryWrite(ids, () =>
          sendPrimaryDocUpdate(resolveSocket, payload, mirror),
        ).catch((err: unknown) => {
          console.error(`[sendOpFn] "doc:update" failed:`, err);
        });
        return;
      }
    }

    const live = resolveSocket();
    if (!live) {
      console.error(`[sendOpFn] "${type}" dropped: no live socket (disconnected?)`);
      return;
    }
    let normalizedPayload = payload;
    if (type === "doc:update")
      normalizedPayload = normalizeDocUpdate(payload, resolveMirror(mirror));
    else if (type === "doc:create") normalizedPayload = normalizeDocCreate(payload);
    else if (type === "doc:delete") normalizedPayload = normalizeDocDelete(payload);
    sendOp(live, { type: type as Envelope["type"], payload: normalizedPayload }).catch(
      (err: unknown) => {
        console.error(`[sendOpFn] "${type}" failed:`, err);
      },
    );
  };
}

/**
 * Normalizes a flat `{ documentType, id, diff, expectedVersion?, embedded? }`
 * doc:update op (every sheet VM's shape) into the wire shape `{ documentType,
 * updates: [{ _id, diff, expectedVersion?, embedded? }] }`. `embedded`
 * (`{ type, id }` — see DocUpdatePayloadSchema, packages/shared/src/protocol.ts)
 * is preserved verbatim into the batched update entry when present, so ops
 * targeting an embedded document (e.g. a spellcastingEntry Item on an Actor)
 * are routed correctly server-side.
 *
 * T013: every entry that comes out of here also passes through
 * fillExpectedVersion — both the freshly-built single-entry batch from the
 * flat legacy shape, AND (for forward-compat with a future multi-doc batch
 * update) each entry of a payload that ALREADY carries `updates`.
 */
function normalizeDocUpdate(
  payload: Record<string, unknown>,
  mirror: DocumentMirror | null,
): Record<string, unknown> {
  const documentType = payload["documentType"];
  if ("updates" in payload) {
    const updates = payload["updates"];
    if (!Array.isArray(updates) || typeof documentType !== "string") return payload;
    return {
      ...payload,
      updates: updates.map((u) =>
        fillExpectedVersion(u as Record<string, unknown>, documentType, mirror),
      ),
    };
  }
  const { id, diff, expectedVersion, embedded } = payload;
  if (typeof id !== "string" || diff === null || typeof diff !== "object") return payload;
  const entry = fillExpectedVersion(
    {
      _id: id,
      diff,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      ...(embedded !== undefined ? { embedded } : {}),
    },
    typeof documentType === "string" ? documentType : "",
    mirror,
  );
  return { documentType, updates: [entry] };
}

/**
 * Normalizes a flat `{ documentType, data, parent? }` doc:create op into the
 * wire shape `{ documentType, data: [...], parent? }` (DocCreatePayloadSchema
 * expects `data` as an array — VM builders pass a single object for
 * ergonomics). `parent` (`{ type, id }`, e.g. `{ type: "Actor", id }` for an
 * embedded Item) is forwarded verbatim. A payload that already carries an
 * array `data` passes through unchanged.
 */
function normalizeDocCreate(payload: Record<string, unknown>): Record<string, unknown> {
  const { data } = payload;
  if (Array.isArray(data)) return payload;
  if (data === undefined) return payload;
  return { ...payload, data: [data] };
}

/**
 * Normalizes a flat `{ documentType, id, parent? }` doc:delete op (single
 * target — the common case for embedded item removal) into the wire shape
 * `{ documentType, ids: [...], parent? }` (DocDeletePayloadSchema). A payload
 * that already carries `ids` passes through unchanged.
 */
function normalizeDocDelete(payload: Record<string, unknown>): Record<string, unknown> {
  if ("ids" in payload) return payload;
  const { id } = payload;
  if (typeof id !== "string") return payload;
  const { id: _drop, ...rest } = payload;
  return { ...rest, ids: [id] };
}

/**
 * Split a flat op `{ type, ...fields }` into the `{ type, payload }` envelope
 * shape `sendOp()` expects, applying the same doc:create/update/delete wire
 * normalization `makeSendOpFn` does. Callers that need the ack promise (e.g.
 * PetsTab awaits familiar creation to surface errors) go through `sendOp`
 * directly and must normalize with THIS — otherwise the flat op is sent
 * verbatim (with a redundant `type` field and an object `data`), which the
 * server's DocCreatePayloadSchema rejects with "Expected array, received
 * object" (r16 pets bug). A payload already in wire shape passes through.
 *
 * @param mirror  T013: same DocumentMirror accessor as makeSendOpFn — see its
 *   docstring. Optional; omitting it defaults to the real `worldMirror`
 *   singleton (e.g. FamiliarSheet.svelte's `toEnvelope(op)` for `buildSetHpOp`,
 *   a primary Actor doc:update sent by a non-privileged familiar owner,
 *   starts filling `expectedVersion` automatically with no call-site change).
 */
export function toEnvelope(
  op: { readonly type: string },
  mirror?: MirrorAccessor,
): {
  type: Envelope["type"];
  payload: Record<string, unknown>;
} {
  // Accept any typed op interface (CreateFamiliarOp, UpdateFamiliarOp, …) —
  // they don't carry an index signature, so widen to a record for the
  // rest-destructure. Every op is a plain object with a `type` discriminator.
  const { type, ...payload } = op as { type: string } & Record<string, unknown>;
  let normalizedPayload: Record<string, unknown> = payload;
  if (type === "doc:update") normalizedPayload = normalizeDocUpdate(payload, resolveMirror(mirror));
  else if (type === "doc:create") normalizedPayload = normalizeDocCreate(payload);
  else if (type === "doc:delete") normalizedPayload = normalizeDocDelete(payload);
  return { type: type as Envelope["type"], payload: normalizedPayload };
}
