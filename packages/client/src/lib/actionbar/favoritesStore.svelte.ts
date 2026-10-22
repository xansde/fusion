/**
 * favoritesStore.svelte.ts — the favourites row kept in the ACTOR (BAR-F3-01; spec 53
 * REQ-BAR-061..066, CA-BAR-05, DEC-BAR-06/08, D-BA06/08; tasks.md §2.5, §2.8).
 *
 * `flags.fusion.actionBar.favorites` is twelve positions that follow the character to any device
 * and that the Mestre sees. This store is the `FavoritesSource` the bar uses: it reads the row off
 * the actor document, and pin / unpin / move write it back.
 *
 * ## Why not just `makeSendOpFn`
 *
 * The row travels WHOLE (an array is replaced, never merged — REQ-DOC-037), so a write is a
 * read-modify-write, and what protects it from another device is the version it was computed on.
 * `makeSendOpFn` fills `expectedVersion` at SEND time and, on `STALE_WRITE`, resends the SAME diff:
 * a pin computed on an old row would land on top of the new one and take another device's pin with
 * it (REQ-BAR-063: "refeita sobre o estado fresco, sem sobrescrever"). So this store computes the row
 * from the freshest document it knows AT THE MOMENT OF THE WRITE, sends the version of THAT document
 * (the Mestre's write too — his version is optional on the server, and that is the hole), and on
 * `STALE_WRITE` waits for the newer document and computes again. The ack comes back through
 * `ActionBarServices.request`, the envelope call that answers.
 *
 * ## The pieces
 *
 *  - **One write at a time per actor**, in the order the edits were made (a chain of promises, kept in
 *    `FavoritesSharedState`). Two quick pins are two writes, the second on the first's answer.
 *  - **The freshest document**: the mirror's, or the one the last ACK carried when it is newer. The
 *    mirror learns a write from a separate broadcast with no ordering guarantee against the ack
 *    (`sendOp.ts` documents the same), so the second quick pin must not depend on it.
 *  - **Optimistic display**: the edits not yet answered are folded over the stored row, so a pin
 *    shows at once and an unpin vanishes at once. A write that fails leaves the display where the
 *    document says it is, and says so on the strip.
 *  - **The seed** (REQ-BAR-064, D-BA08): while the actor is due it, the row shown is the seed the
 *    provider gives (so the bar is not empty for a moment); `ensureSeeded()` writes it, ONCE, together
 *    with `seeded: true`. It is re-checked on the fresh document at write time, so the second device
 *    that opened at the same instant finds it already done and writes nothing.
 *
 * Nothing here knows the sheet: an id that no entry answers to any more (an orphan, REQ-BAR-066)
 * stays pinned until the player unpins it.
 */

import { actionBarFavoritesPatch } from "@fusion/shared";

import { t } from "../i18n/i18n.js";
import {
  emptyRow,
  isSeeded,
  moveWithin,
  needsSeed,
  pinInto,
  rowFromIds,
  sameRow,
  storedRowOf,
  unpinFrom,
  type FavoriteRow,
  type FavoritesSource,
} from "./favoritesSource.js";

type Json = Record<string, unknown>;

/** Writes tried before giving up on a document that keeps moving under us (a hot actor in combat). */
export const FAVORITES_MAX_ATTEMPTS = 6;

/**
 * From the second refusal of the same edit on, the next try waits a short random time first. Two
 * devices that keep refusing each other's writes do it in lockstep — the broadcast of one write
 * reaches both at the same instant and both try again at once — and one of them can starve (found
 * with two devices pinning ten entries as fast as they could). The first retry stays immediate:
 * almost always the only one needed. Random on purpose; the seed, which must be deterministic, has
 * nothing to do with this.
 */
const RETRY_JITTER_MS = 80;

/** After a refused write: how long one wait for the newer document is, and how many of them. */
const WAIT_STEP_MS = 60;
const WAIT_STEPS = 20;

// ---------------------------------------------------------------------------
// The edits
// ---------------------------------------------------------------------------

type Mutation =
  | { readonly kind: "seed" }
  | { readonly kind: "pin"; readonly id: string }
  | { readonly kind: "unpin"; readonly id: string }
  | { readonly kind: "move"; readonly from: number; readonly to: number };

interface Pending {
  readonly token: number;
  readonly mutation: Mutation;
}

/** What an edit comes to on the document it is about to be written to. */
type Plan =
  | { readonly kind: "write"; readonly row: (string | null)[] }
  /** Nothing to write: the document already says it (another device did it), or the edit changes nothing. */
  | { readonly kind: "nothing" }
  /** A pin that no longer fits: another device filled the row while this one was on its way. */
  | { readonly kind: "full" };

const NOTHING: Plan = { kind: "nothing" };
const FULL: Plan = { kind: "full" };

/** One edit applied to a row. The seed is not an edit of the row: it IS the base row while it is due. */
function applyMutation(row: FavoriteRow, mutation: Mutation): (string | null)[] {
  switch (mutation.kind) {
    case "pin":
      return pinInto(row, mutation.id).row;
    case "unpin":
      return unpinFrom(row, mutation.id);
    case "move":
      return moveWithin(row, mutation.from, mutation.to);
    case "seed":
      return [...row];
  }
}

// ---------------------------------------------------------------------------
// What several stores of one client share
// ---------------------------------------------------------------------------

/**
 * The state that belongs to the ACTOR, not to one store: the chain of writes in flight and the last
 * document an ack carried. A store is rebuilt when the active actor changes (and back), and the old
 * one may still have a write on the wire — the new one must queue behind it. Tests build one per
 * simulated device.
 */
export interface FavoritesSharedState {
  readonly chains: Map<string, Promise<void>>;
  readonly acked: Map<string, Json>;
}

export function createFavoritesShared(): FavoritesSharedState {
  return { chains: new Map(), acked: new Map() };
}

const liveShared = createFavoritesShared();

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

export interface FavoritesStoreDeps {
  readonly actorId: string;
  /**
   * The document of actor `actorId` in the mirror, right now (reactive when read inside a `$derived`).
   * The store always asks for ITS actor, by id: a store whose actor is no longer the one on screen
   * can still have a write to finish, and it must finish it on its own document — a reader that
   * closed over "the active actor" would hand it another character's row.
   */
  readActor(actorId: string): Json | undefined;
  /** `doc:update` with an answer: resolves with the ack's result, rejects with an error that carries `code`. */
  write(payload: Json): Promise<unknown>;
  /**
   * The ids the first-opening seed would pin right now for actor `actorId` (`provider.seed` or the
   * shell's own); nothing once the bar shows another actor. `[]` is "nothing to seed (yet)".
   */
  seedIds(actorId: string): readonly string[];
  /** A short message on the bar's strip. */
  notify(message: string): void;
  /** A wait of `ms`; injectable so a test does not sleep. */
  delay?: ((ms: number) => Promise<void>) | undefined;
  shared?: FavoritesSharedState | undefined;
}

export interface FavoritesStore extends FavoritesSource {
  /**
   * Writes the first-opening seed if this actor is still due it (REQ-BAR-064). Safe to call as often
   * as the bar's entries change: it asks once, and only when there is something to seed.
   */
  ensureSeeded(): void;
  /** Resolves when every write queued for this actor has settled. */
  settled(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Reading what the document carries
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `_stats.version` of a document; a document that carries none counts as 0, as the server counts it. */
function versionOf(doc: Json | undefined): number {
  const stats = doc?.["_stats"];
  const version = isRecord(stats) ? stats["version"] : undefined;
  return typeof version === "number" && Number.isFinite(version) ? version : 0;
}

function isStaleWrite(error: unknown): boolean {
  return isRecord(error) && error["code"] === "STALE_WRITE";
}

const realDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

class FavoritesStoreImpl implements FavoritesStore {
  readonly #deps: FavoritesStoreDeps;
  readonly #shared: FavoritesSharedState;
  readonly #delay: (ms: number) => Promise<void>;

  /** Edits made and not yet answered, in order. Folded over the stored row for the display. */
  #pending = $state.raw<readonly Pending[]>([]);
  #nextToken = 0;
  /** The seed was asked for by this store: it is not asked again, whatever happens to the write. */
  #seedAsked = false;

  constructor(deps: FavoritesStoreDeps) {
    this.#deps = deps;
    this.#shared = deps.shared ?? liveShared;
    this.#delay = deps.delay ?? realDelay;
  }

  // -------------------------------------------------------------------------
  // The row
  // -------------------------------------------------------------------------

  /** The newest document this client knows: the mirror's, or the one an ack carried when it is newer. */
  #latestDoc(): Json | undefined {
    const mirrored = this.#deps.readActor(this.#deps.actorId);
    const acked = this.#shared.acked.get(this.#deps.actorId);
    if (acked === undefined) return mirrored;
    if (mirrored === undefined) return acked;
    return versionOf(acked) > versionOf(mirrored) ? acked : mirrored;
  }

  /**
   * The row of a document: the stored one, or — while the seed is due — the seed the provider gives.
   * `shown` is the seed the player was looking at when he made the edit that is being written now. It
   * counts only when the provider has nothing to say any more — the bar went to another actor while a
   * refused write waited to be redone — so the edit is applied over THAT row, not over an empty one,
   * which would burn the flag on a row without the seed.
   */
  #baseRow(doc: Json | undefined, shown: readonly string[] = []): (string | null)[] {
    if (!needsSeed(doc)) return storedRowOf(doc) ?? emptyRow();
    const live = this.#deps.seedIds(this.#deps.actorId);
    return rowFromIds(live.length > 0 ? live : shown);
  }

  /** The seed on screen right now, when the seed is due (an edit made now is made over it); else nothing. */
  #seedOnScreen(): readonly string[] {
    return needsSeed(this.#latestDoc()) ? [...this.#deps.seedIds(this.#deps.actorId)] : [];
  }

  slots(): ReadonlyArray<string | null> {
    let row = this.#baseRow(this.#latestDoc());
    for (const { mutation } of this.#pending) row = applyMutation(row, mutation);
    return row;
  }

  isPinned(entryId: string): boolean {
    return this.slots().includes(entryId);
  }

  // -------------------------------------------------------------------------
  // The edits
  // -------------------------------------------------------------------------

  pin(entryId: string): boolean {
    const { outcome } = pinInto(this.slots(), entryId);
    if (outcome === "full") return false;
    if (outcome === "pinned") this.#enqueue({ kind: "pin", id: entryId });
    return true;
  }

  unpin(entryId: string): void {
    if (!this.isPinned(entryId)) return;
    this.#enqueue({ kind: "unpin", id: entryId });
  }

  move(from: number, to: number): void {
    const row = this.slots();
    if (sameRow(moveWithin(row, from, to), row)) return;
    this.#enqueue({ kind: "move", from, to });
  }

  ensureSeeded(): void {
    if (this.#seedAsked) return;
    const doc = this.#latestDoc();
    if (!needsSeed(doc)) return;
    // Nothing to seed yet (the provider has not loaded): not asked, so the next call tries again.
    if (rowFromIds(this.#deps.seedIds(this.#deps.actorId)).every((id) => id === null)) return;
    this.#seedAsked = true;
    this.#enqueue({ kind: "seed" });
  }

  async settled(): Promise<void> {
    for (;;) {
      const chain = this.#shared.chains.get(this.#deps.actorId);
      if (chain === undefined) return;
      await chain;
    }
  }

  // -------------------------------------------------------------------------
  // Writing: one at a time per actor, each computed on the freshest document
  // -------------------------------------------------------------------------

  #enqueue(mutation: Mutation): void {
    this.#nextToken += 1;
    const token = this.#nextToken;
    this.#pending = [...this.#pending, { token, mutation }];

    const { chains } = this.#shared;
    const { actorId } = this.#deps;
    // The seed is not an edit over a row: it is the row. Only the edits carry the seed they were made over.
    const shown = mutation.kind === "seed" ? [] : this.#seedOnScreen();
    const previous = chains.get(actorId) ?? Promise.resolve();
    const run = previous.then(() => this.#run(token, mutation, shown));
    chains.set(actorId, run);
    void run.then(() => {
      if (chains.get(actorId) === run) chains.delete(actorId);
    });
  }

  /** Never rejects: a failed write is a message on the strip, and the display goes back to the document. */
  async #run(token: number, mutation: Mutation, shown: readonly string[]): Promise<void> {
    try {
      await this.#commit(mutation, shown);
    } catch (error) {
      console.error("[actionbar] could not save the favourites", error);
      this.#say(t("FUSION.ActionBar.Favorites.SaveFailed"));
    } finally {
      // After the ack was remembered (inside #commit): the display never has a gap between "pending" and "stored".
      this.#pending = this.#pending.filter((candidate) => candidate.token !== token);
    }
  }

  /**
   * The strip is a courtesy: a message that cannot be shown must not stop the writes queued behind
   * it. This run's promise is what the next one waits on, and a rejected one would be waited on for ever.
   */
  #say(message: string): void {
    try {
      this.#deps.notify(message);
    } catch (error) {
      console.error("[actionbar] could not tell the player", error);
    }
  }

  async #commit(mutation: Mutation, shown: readonly string[]): Promise<void> {
    const { actorId } = this.#deps;
    // The version of the last write this edit saw refused. -1: none yet.
    let refusedAt = -1;
    let refusals = 0;

    for (let attempt = 1; attempt <= FAVORITES_MAX_ATTEMPTS; attempt += 1) {
      let doc = this.#latestDoc();
      if (versionOf(doc) <= refusedAt) {
        // Refused on this very version and nothing newer has reached us: the writer who got there
        // first has a broadcast on its way. Wait for it — never resend a write known to be stale.
        doc = await this.#waitForNewerThan(refusedAt);
        if (versionOf(doc) <= refusedAt) {
          // Nothing newer came. What an ack carried may be AHEAD of the server (a world restored from an
          // older backup): forget it, so the next edit starts from the mirror's document instead of
          // failing the same way until the page is reloaded.
          this.#shared.acked.delete(actorId);
          throw new Error("the document did not move after a refused write");
        }
      }
      const version = versionOf(doc);

      const plan = this.#plan(mutation, doc, shown);
      if (plan.kind === "full") {
        // Not dropped in silence: the player saw this pin on the display and it did not fit.
        this.#say(t("FUSION.ActionBar.Favorites.Full"));
        return;
      }
      if (plan.kind === "nothing") return; // nothing to change on the fresh document

      try {
        const result = await this.#deps.write({
          documentType: "Actor",
          updates: [
            { _id: actorId, diff: actionBarFavoritesPatch(plan.row), expectedVersion: version },
          ],
        });
        this.#remember(result);
        return;
      } catch (error) {
        if (!isStaleWrite(error)) throw error;
        refusedAt = version;
        refusals += 1;
        if (refusals >= 2 && attempt < FAVORITES_MAX_ATTEMPTS) {
          await this.#delay(Math.random() * RETRY_JITTER_MS);
        }
      }
    }
    throw new Error(`the document kept moving: ${String(FAVORITES_MAX_ATTEMPTS)} writes refused`);
  }

  /**
   * What this edit comes to on THIS document. The edit is judged on the fresh document, not on the
   * one it was made on: a seed another device already wrote is not written again, a pin another
   * device already made is not pinned twice, and a pin the row no longer has room for says so.
   */
  #plan(mutation: Mutation, doc: Json | undefined, shown: readonly string[]): Plan {
    const seedDue = needsSeed(doc);
    const base = this.#baseRow(doc, shown);
    if (mutation.kind === "seed") {
      return seedDue && base.some((id) => id !== null) ? { kind: "write", row: base } : NOTHING;
    }
    if (mutation.kind === "pin" && pinInto(base, mutation.id).outcome === "full") return FULL;
    const next = applyMutation(base, mutation);
    // Same row on a document that already carries the flag: not a write.
    if (!seedDue && isSeeded(doc) && sameRow(next, base)) return NOTHING;
    return { kind: "write", row: next };
  }

  /** Waits, in steps, until the newest known document is newer than `version`; returns the newest either way. */
  async #waitForNewerThan(version: number): Promise<Json | undefined> {
    for (let step = 0; step < WAIT_STEPS; step += 1) {
      await this.#delay(WAIT_STEP_MS);
      const doc = this.#latestDoc();
      if (versionOf(doc) > version) return doc;
    }
    return this.#latestDoc();
  }

  /** Keeps the document the ack carried: the mirror only learns it from a broadcast with no order against the ack. */
  #remember(result: unknown): void {
    const documents = isRecord(result) ? result["documents"] : undefined;
    if (!Array.isArray(documents)) return;
    const mine = documents.find(
      (candidate): candidate is Json =>
        isRecord(candidate) && candidate["_id"] === this.#deps.actorId,
    );
    if (mine !== undefined) this.#shared.acked.set(this.#deps.actorId, mine);
  }
}

export function createFavoritesStore(deps: FavoritesStoreDeps): FavoritesStore {
  return new FavoritesStoreImpl(deps);
}
