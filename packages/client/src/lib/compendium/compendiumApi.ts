/**
 * compendiumApi.ts — typed socket calls for the compendium browser.
 *
 * REQ-CMP-010..018
 * Spec: 16-compendiums-e-importacao.md §API e eventos
 *
 * All calls use the "query" socket event (read-only) except import which uses "op".
 * Returns typed results from the server handlers.
 */

import type { Socket } from "socket.io-client";
import type {
  PackManifest,
  PackIndexEntry,
  CompendiumSearchPayload,
  CompendiumSearchAllPayload,
  CompendiumSearchAllResult,
  CompendiumImportResult,
  CompendiumImportToActorResult,
} from "@fusion/shared";
import { searchPackIndex } from "@fusion/shared";
import { sendOp } from "../docs/sendOp.js";

// ---------------------------------------------------------------------------
// Socket availability guard
// ---------------------------------------------------------------------------

/**
 * Thrown by {@link requireConnectedSocket} when there is no usable socket.
 * Callers (e.g. SpellPickerDialog) match on `code === "NOT_CONNECTED"` to
 * show a specific "not connected" message + retry affordance instead of a
 * generic load error.
 */
export class SocketUnavailableError extends Error {
  readonly code = "NOT_CONNECTED";
  constructor() {
    super("Socket is not connected");
    this.name = "SocketUnavailableError";
  }
}

/**
 * Fail-fast guard for compendium calls (bug fix — frozen-socket class).
 *
 * socket.io buffers `emit()` calls on a disconnected/replaced Socket
 * instance silently: the ack callback never fires and the caller's Promise
 * hangs until its timeout (10 s), which the user experiences as an endless
 * spinner with ZERO ops reaching the server. Checking `connected` here turns
 * that failure mode into an immediate, actionable error.
 *
 * @param socket current socket (typically from session's getSocket()).
 * @returns the same socket, narrowed to non-null.
 * @throws {SocketUnavailableError} when null/undefined or not connected.
 */
export function requireConnectedSocket(socket: Socket | null | undefined): Socket {
  if (!socket || !socket.connected) throw new SocketUnavailableError();
  return socket;
}

// ---------------------------------------------------------------------------
// sendQuery helper (mirrors sendOp but uses "query" event)
// ---------------------------------------------------------------------------

/**
 * Why a compendium query failed, in terms the UI can act on.
 *
 *  - `TIMEOUT`: the server never answered within the budget, on every attempt.
 *  - anything else: the server's own ack code (`NOT_FOUND`, `VALIDATION_FAILED`,
 *    `INTERNAL_ERROR`, ...), or `UNKNOWN` when it sent none.
 *
 * `message` is already pt-BR and already says what happened: the screens show it
 * as is (several of them do `error = err.message`).
 */
export class CompendiumQueryError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly queryType: string,
    readonly attempts: number,
  ) {
    super(message);
    this.name = "CompendiumQueryError";
  }
}

interface QueryPolicy {
  /** How long ONE attempt may wait for the ack. */
  readonly timeoutMs: number;
  /** Total attempts (first try included). */
  readonly attempts: number;
}

/**
 * A pack index is megabytes of JSON (feats-core ~2.6 MB, spells-core ~1.8 MB)
 * that has to cross the tunnel to the player, so it gets a budget sized for
 * that — the flat 10 s every query used to share is what made the compendium
 * "fail a lot" on the table's connection. Small queries keep a short budget so
 * a dead server is still noticed quickly.
 */
const BULK_POLICY: QueryPolicy = { timeoutMs: 30_000, attempts: 3 };
const SMALL_POLICY: QueryPolicy = { timeoutMs: 15_000, attempts: 2 };

/** Wait before attempt N+1 (index = attempts already made - 1). */
const BACKOFF_MS = [500, 1_500];

/** Server answers that retrying cannot change. */
const PERMANENT_CODES = new Set([
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "PERMISSION_DENIED",
  "FORBIDDEN",
]);
/** Only failures that may pass on their own are asked again; any other refusal is the server's answer. */
const TRANSIENT_CODES = new Set(["TIMEOUT", "INTERNAL_ERROR", "NOT_CONNECTED"]);

function timeoutMessage(attempts: number): string {
  return attempts > 1
    ? `O compêndio demorou demais para responder (${String(attempts)} tentativas). Confira a conexão com o servidor e tente de novo.`
    : "O compêndio demorou demais para responder. Confira a conexão com o servidor e tente de novo.";
}

function sendQueryOnce<R>(
  socket: Socket,
  type: string,
  payload: unknown,
  timeoutMs: number,
): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new CompendiumQueryError(timeoutMessage(1), "TIMEOUT", type, 1));
    }, timeoutMs);

    socket.emit(
      "query",
      { type, payload, ts: Date.now() },
      (ack: { ok: boolean; result?: R; code?: string; message?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (ack.ok && ack.result !== undefined) {
          resolve(ack.result);
        } else {
          const code = ack.code ?? "UNKNOWN";
          reject(
            new CompendiumQueryError(
              ack.message ?? `Query "${type}" failed: ${code}`,
              code,
              type,
              1,
            ),
          );
        }
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendQuery<R = unknown>(
  socket: Socket,
  type: string,
  payload: unknown,
  policy: QueryPolicy = SMALL_POLICY,
): Promise<R> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await sendQueryOnce<R>(socket, type, payload, policy.timeoutMs);
    } catch (err) {
      const failure =
        err instanceof CompendiumQueryError
          ? err
          : new CompendiumQueryError(String(err), "UNKNOWN", type, 1);
      const last = new CompendiumQueryError(
        failure.code === "TIMEOUT" ? timeoutMessage(attempt) : failure.message,
        failure.code,
        type,
        attempt,
      );
      if (
        PERMANENT_CODES.has(failure.code) ||
        !TRANSIENT_CODES.has(failure.code) ||
        attempt >= policy.attempts
      )
        throw last;
      // A replaced/disconnected socket cannot answer: fail now, the caller shows
      // the "not connected" state instead of waiting out a dead instance.
      requireConnectedSocket(socket);
      await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)] ?? 1_500);
    }
  }
}

// ---------------------------------------------------------------------------
// Per-connection cache + shared in-flight requests
// ---------------------------------------------------------------------------

/**
 * Pack contents do not change while a connection lives (a re-import happens
 * server-side and players reconnect), and the same indexes are asked for by the
 * Plan, the spell picker, the actions tab and the grant healer — each used to
 * download its own copy. Answers are cached per Socket instance (a reconnect
 * gets a fresh socket, hence a fresh cache), storing the PROMISE so two callers
 * asking at once share one request. A rejected promise is dropped so the next
 * caller retries instead of inheriting the failure.
 */
const CACHE_LIMIT = 80;
const caches = new WeakMap<Socket, Map<string, Promise<unknown>>>();

function cached<R>(socket: Socket, key: string, load: () => Promise<R>): Promise<R> {
  let cache = caches.get(socket);
  if (!cache) {
    cache = new Map();
    caches.set(socket, cache);
  }
  const hit = cache.get(key);
  if (hit) return hit as Promise<R>;
  const pending = load();
  cache.set(key, pending);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined && oldest !== key) cache.delete(oldest);
  }
  const owner = cache;
  const forget = (): void => {
    if (owner.get(key) === pending) owner.delete(key);
  };
  // An empty answer is "not there yet" (a pack still loading, a world without
  // it): keep asking later instead of pinning the emptiness for the session.
  pending.then((r) => {
    if (isEmptyAnswer(r)) forget();
  }, forget);
  return pending;
}

/** Cached answer for `key` if one exists (settled or in flight), without asking the server. */
function isEmptyAnswer(r: unknown): boolean {
  if (Array.isArray(r)) return r.length === 0;
  const entries = (r as { entries?: unknown } | null | undefined)?.entries;
  return Array.isArray(entries) && entries.length === 0;
}

function peekCached<R>(socket: Socket, key: string): Promise<R> | undefined {
  return caches.get(socket)?.get(key) as Promise<R> | undefined;
}

/** Forget what was cached for a socket (tests; a manual "reload compendium" action). */
export function clearCompendiumCache(socket: Socket): void {
  caches.delete(socket);
}

const indexKey = (packId: string): string => `index:${packId}`;

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export interface ListPacksResult {
  packs: PackManifest[];
}

/**
 * List all available compendium packs.
 * REQ-CMP-012.
 */
export function listPacks(
  socket: Socket,
  filter?: { systemId?: string; documentType?: string },
): Promise<ListPacksResult> {
  const key = `list:${JSON.stringify(filter ?? {})}`;
  // The pack list is small and can grow while the world runs (a pack that was
  // not there yet): share it for a short while, not for the whole session.
  const stamps = listStamps.get(socket) ?? new Map<string, number>();
  listStamps.set(socket, stamps);
  const at = stamps.get(key);
  if (at !== undefined && Date.now() - at > LIST_TTL_MS) caches.get(socket)?.delete(key);
  if (!peekCached(socket, key)) stamps.set(key, Date.now());
  return cached(socket, key, () =>
    sendQuery<ListPacksResult>(socket, "compendium:list", filter ?? {}),
  );
}

const LIST_TTL_MS = 30_000;
const listStamps = new WeakMap<Socket, Map<string, number>>();

export interface PackIndexResult {
  packId: string;
  entries: PackIndexEntry[];
}

/**
 * Get the full index for a pack (lazy, first call builds it on server).
 * REQ-CMP-007.
 */
export function getPackIndex(socket: Socket, packId: string): Promise<PackIndexResult> {
  return cached(socket, indexKey(packId), () =>
    sendQuery<PackIndexResult>(socket, "compendium:index", { packId }, BULK_POLICY),
  );
}

export interface SearchPackResult {
  packId: string;
  entries: PackIndexEntry[];
}

/**
 * Search/filter a pack's index (text + field filters).
 * REQ-CMP-013, REQ-CMP-014.
 */
export function searchPack(
  socket: Socket,
  query: CompendiumSearchPayload,
): Promise<SearchPackResult> {
  const hasFilter =
    (query.text !== undefined && query.text !== "") ||
    (query.filters !== undefined && Object.keys(query.filters).length > 0);

  // No text and no filter IS the pack index: share its cache and its request
  // instead of downloading the same megabytes a second time under another name.
  if (!hasFilter) {
    // Still asked as `compendium:search` (the server answers it with the whole
    // index, and callers/fakes that only speak search keep working), but stored
    // under the index key so either call fills the cache for the other.
    // A copy: callers sort/splice what they get, and the cached array is shared.
    return cached(socket, indexKey(query.packId), () =>
      sendQuery<PackIndexResult>(
        socket,
        "compendium:search",
        { packId: query.packId },
        BULK_POLICY,
      ),
    ).then((r) => ({
      packId: r.packId,
      entries: r.entries.slice(),
    }));
  }

  // The index is already here (or on its way): filter it in place with the very
  // function the server runs over the very same entries.
  const index = peekCached<PackIndexResult>(socket, indexKey(query.packId));
  if (index) {
    return index.then((r) => ({
      packId: query.packId,
      entries: searchPackIndex(r.entries, query),
    }));
  }

  // A narrow search against an index nobody has loaded: let the server filter,
  // so a 3-item answer does not cost 2.6 MB.
  return cached(socket, `search:${JSON.stringify(query)}`, () =>
    sendQuery<SearchPackResult>(socket, "compendium:search", query, BULK_POLICY),
  );
}

/**
 * All packs, across EVERY source system, whose id ends with `.<packSlug>`
 * (e.g. "pf2e.classes-core" AND "sf2e.classes-core" both match slug
 * "classes-core").
 *
 * B4 (revisão adversarial 3): a mundo misto (composite `pf2e-sf2e`) world
 * has TWO packs of the same slug — one discovered from each source system
 * (DEC-SYS-06-bis) — so `packs.find((p) => p.id.endsWith(...))` (the
 * pattern every ficha picker used to hand-roll) silently picked only the
 * FIRST one and left the other system's classes/ancestries/feats/spells
 * entirely absent from the picker. A pure pf2e or pure sf2e world still
 * has exactly one matching pack per slug, so this returns a single-element
 * array there — same result as `.find` used to, no behavior change outside
 * the composite.
 */
export function findPacksBySlug(packs: PackManifest[], packSlug: string): PackManifest[] {
  // A trailing `*` names a FAMILY of packs of one kind (e.g. "backgrounds-*" =
  // backgrounds-core plus any table pack of backgrounds), so a picker lists
  // them all without naming each one in code.
  if (packSlug.endsWith("*")) {
    const prefix = packSlug.slice(0, -1);
    return packs.filter((p) => p.id.slice(p.id.indexOf(".") + 1).startsWith(prefix));
  }
  return packs.filter((p) => p.id.endsWith(`.${packSlug}`));
}

/**
 * Search every pack matching `packSlug` (see {@link findPacksBySlug}) and
 * merge their entries into one list, deduped by `uuid` (defensive — no two
 * real packs are expected to share a uuid, but a caller merging results
 * should never have to worry about it).
 *
 * This is the composite-aware replacement for the
 * `packs.find(...) → searchPack(one pack)` pattern (B4): callers that used
 * to query exactly one pack now transparently query every source system's
 * pack of that slug and see the union, with no per-caller branching on
 * whether the active system is a composite.
 */
export async function searchPacksBySlug(
  socket: Socket,
  packs: PackManifest[],
  packSlug: string,
  filter?: Omit<CompendiumSearchPayload, "packId">,
): Promise<PackIndexEntry[]> {
  const matches = findPacksBySlug(packs, packSlug);
  const merged: PackIndexEntry[] = [];
  const seenUuids = new Set<string>();
  for (const pack of matches) {
    const { entries } = await searchPack(socket, { packId: pack.id, ...(filter ?? {}) });
    for (const entry of entries) {
      if (seenUuids.has(entry.uuid)) continue;
      seenUuids.add(entry.uuid);
      merged.push(entry);
    }
  }
  return merged;
}

/**
 * Name of the aggregated-search query (spec 43, DEC-CPD-02 / REQ-CPD-030).
 * The server owns the index of every pack visible to the caller and answers
 * already limited — this is NOT N `compendium:search` calls stitched together
 * on the client, which would mean downloading the whole collection to search it.
 */
export const COMPENDIUM_SEARCH_ALL_QUERY = "compendium:searchAll";

/**
 * Search every pack visible to the caller, grouped by document type.
 * REQ-CPD-030..032. The panel reads the answer through
 * `normalizeAggregatedSearchResult`, which tolerates a shape it did not expect
 * instead of throwing inside the render.
 */
export function searchAllPacks(
  socket: Socket,
  payload: CompendiumSearchAllPayload,
): Promise<CompendiumSearchAllResult> {
  return sendQuery<CompendiumSearchAllResult>(
    socket,
    COMPENDIUM_SEARCH_ALL_QUERY,
    payload,
    BULK_POLICY,
  );
}

export interface GetDocumentResult {
  document: Record<string, unknown>;
}

/**
 * Load the full document for a Compendium UUID.
 * REQ-CMP-009, REQ-CMP-015 (preview).
 */
export function getDocument(socket: Socket, uuid: string): Promise<GetDocumentResult> {
  return cached(socket, `get:${uuid}`, () =>
    sendQuery<GetDocumentResult>(socket, "compendium:get", { uuid }),
  );
}

/**
 * Import one or more pack documents into the world.
 * GM-only — uses "op" event (mutation).
 * REQ-CMP-016, REQ-CMP-021.
 */
export function importToWorld(
  socket: Socket,
  uuids: string[],
  options?: { folderId?: string },
): Promise<CompendiumImportResult> {
  return sendOp<CompendiumImportResult>(socket, {
    type: "compendium:import",
    payload: { uuids, folderId: options?.folderId },
  });
}

/**
 * Bring pack document(s) into ONE actor's sheet.
 * Spec 43 §5.7, DEC-CPD-05 — REQ-CPD-061, REQ-CPD-073.
 *
 * The OTHER door of §5.7, and deliberately not a flag on `importToWorld`: this
 * one is open to a player, because what protects it is `OWNER` of the
 * DESTINATION actor rather than the caller's role. The server re-checks that
 * ownership on every call — this function sends no role and no ownership of its
 * own, only the destination it is asking for.
 */
export function importToActor(
  socket: Socket,
  uuids: string[],
  actorId: string,
): Promise<CompendiumImportToActorResult> {
  return sendOp<CompendiumImportToActorResult>(socket, {
    type: "compendium:importToActor",
    payload: { uuids, actorId },
  });
}
