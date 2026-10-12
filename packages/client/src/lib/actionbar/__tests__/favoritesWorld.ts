/**
 * favoritesWorld.ts — the fake world the favourites store is tested in (BAR-F3-01).
 *
 * NOT a test file (Vitest only runs `*.test.ts`). It is shared by `favoritesStore.test.ts`, which
 * proves the store, and `actionBarController.test.ts`, which proves the number keys keep running the
 * right favourite when the row comes from the persisted store and not from a double.
 *
 * What it fakes is the one thing the store talks to:
 *  - {@link FakeServer}: ONE actor, with the real optimistic lock — a write whose `expectedVersion` is
 *    not the stored version is refused with `STALE_WRITE`, exactly as `doc-handlers.ts` does — that
 *    applies the favourites diff and refuses a malformed one;
 *  - {@link FakeMirror}: the client's copy of the actor, which learns the new document only when the
 *    test says the broadcast arrived (so a late broadcast is a thing a test can do);
 *  - {@link rig}: a store wired to both. Two devices are two rigs on the same server.
 */

import { actionBarFavoritesPatch } from "@fusion/shared";

import {
  createFavoritesShared,
  createFavoritesStore,
  type FavoritesSharedState,
  type FavoritesStore,
} from "../favoritesStore.svelte.js";

export type Json = Record<string, unknown>;

export const ACTOR = "actor-1";

/** A row of 12 with the given ids from the first slot on. */
export function row(...ids: Array<string | null>): Array<string | null> {
  return Array.from({ length: 12 }, (_, index) => ids[index] ?? null);
}

// ---------------------------------------------------------------------------
// The fake server: one actor, the real optimistic lock
// ---------------------------------------------------------------------------

export interface Attempt {
  readonly expectedVersion: number | undefined;
  readonly payload: unknown;
  readonly outcome: "ok" | "stale" | "failed";
}

export class FakeServer {
  version: number;
  favorites: Array<string | null> | undefined;
  seeded: boolean | undefined;
  readonly attempts: Attempt[] = [];
  /** Runs at the start of every write, before the lock is checked: another device writing "in between". */
  beforeWrite: ((attemptNumber: number) => void) | null = null;
  /** While set, a write waits here before it is judged. */
  gate: Promise<void> | null = null;
  /** While set, every write is refused with this error (a permission refusal, a dead socket). */
  failWith: Error | null = null;
  inFlight = 0;
  maxInFlight = 0;

  constructor(init: { version?: number; favorites?: Array<string | null>; seeded?: boolean } = {}) {
    this.version = init.version ?? 3;
    this.favorites = init.favorites;
    this.seeded = init.seeded;
  }

  doc(): Json {
    const bar: Json = {};
    if (this.favorites !== undefined) bar["favorites"] = [...this.favorites];
    if (this.seeded !== undefined) bar["seeded"] = this.seeded;
    return {
      _id: ACTOR,
      type: "character",
      name: "Heroi",
      flags: { fusion: Object.keys(bar).length > 0 ? { actionBar: bar } : {} },
      _stats: { version: this.version },
    };
  }

  /** Another device, or the sheet, writes the row: the version moves, this client's mirror does not. */
  external(favorites: Array<string | null>, seeded = true): void {
    this.favorites = [...favorites];
    this.seeded = seeded;
    this.version += 1;
  }

  /** What the OK attempts, in order, stored. */
  get accepted(): Attempt[] {
    return this.attempts.filter((attempt) => attempt.outcome === "ok");
  }

  async write(payload: unknown): Promise<unknown> {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      this.beforeWrite?.(this.attempts.length);
      if (this.gate !== null) await this.gate;

      const body = payload as {
        documentType?: unknown;
        updates?: Array<{ _id?: unknown; diff?: Json; expectedVersion?: unknown }>;
      };
      const entry = body.updates?.[0];
      const expectedVersion =
        typeof entry?.expectedVersion === "number" ? entry.expectedVersion : undefined;
      const record = (outcome: Attempt["outcome"]): void => {
        this.attempts.push({ expectedVersion, payload, outcome });
      };

      if (this.failWith !== null) {
        record("failed");
        throw this.failWith;
      }
      const wellFormed =
        body.documentType === "Actor" &&
        body.updates?.length === 1 &&
        entry?._id === ACTOR &&
        entry.diff !== undefined &&
        Object.keys(entry.diff).sort().join() ===
          Object.keys(actionBarFavoritesPatch(row())).sort().join();
      if (!wellFormed || entry?.diff === undefined) {
        record("failed");
        throw Object.assign(new Error("malformed doc:update"), { code: "VALIDATION_FAILED" });
      }
      if (expectedVersion !== this.version) {
        record("stale");
        throw Object.assign(new Error("Document has been modified since last read"), {
          code: "STALE_WRITE",
        });
      }
      const patch = entry.diff as ReturnType<typeof actionBarFavoritesPatch>;
      this.favorites = [...patch["flags.fusion.actionBar.favorites"]];
      this.seeded = patch["flags.fusion.actionBar.seeded"];
      this.version += 1;
      record("ok");
      return { documentType: "Actor", documents: [this.doc()] };
    } finally {
      this.inFlight -= 1;
    }
  }
}

/** The client's copy of the document: it changes only when the test says the broadcast arrived. */
export class FakeMirror {
  doc: Json | undefined;
  constructor(private readonly server: FakeServer) {
    this.sync();
  }
  sync(): void {
    this.doc = this.server.doc();
  }
}

export interface Rig {
  server: FakeServer;
  mirror: FakeMirror;
  store: FavoritesStore;
  /** What the store shares with the other stores of this device: the chain of queued writes, the acked documents. */
  shared: FavoritesSharedState;
  notices: string[];
  /** The ids the provider's seed would give right now. */
  seed: { ids: string[] };
  /** The waits the store asked for, in ms. */
  delays: number[];
}

export interface RigOptions {
  server?: FakeServer;
  /** What a wait does. Default: time passes and the broadcast arrives. */
  onDelay?: (rig: Rig) => void;
  seed?: string[];
}

export function rig(options: RigOptions = {}): Rig {
  const server = options.server ?? new FakeServer({ favorites: row(), seeded: true });
  const mirror = new FakeMirror(server);
  const notices: string[] = [];
  const delays: number[] = [];
  const seed = { ids: options.seed ?? [] };
  const shared = createFavoritesShared();
  const result = { server, mirror, notices, seed, delays, shared } as Rig;
  result.store = createFavoritesStore({
    actorId: ACTOR,
    readActor: () => mirror.doc,
    write: (payload) => server.write(payload),
    seedIds: () => seed.ids,
    notify: (message) => {
      notices.push(message);
    },
    delay: (ms) => {
      delays.push(ms);
      if (options.onDelay === undefined) mirror.sync();
      else options.onDelay(result);
      return Promise.resolve();
    },
    shared,
  });
  return result;
}
