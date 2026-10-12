/**
 * favoritesStore.test.ts — the favourites kept in the ACTOR (BAR-F3-01; spec 53 REQ-BAR-061..066,
 * CA-BAR-05, CA-BAR-06, DEC-BAR-06/08, D-BA08; tasks.md §2.5).
 *
 * The store is a `.svelte.ts` module the Svelte plugin compiles under Vitest, so it is exercised
 * here without a DOM (§2.10). What it must get right is mostly CONCURRENCY, so the harness is a fake
 * of the one thing it talks to: a server that holds ONE actor, applies the favourites diff and
 * refuses a write whose `expectedVersion` is not the stored version (`STALE_WRITE`) exactly as
 * `doc-handlers.ts` does — and a client mirror that only learns the new document when the test says
 * the broadcast arrived. Two devices are two rigs on the same server.
 *
 * The rules under test:
 *  - the row lives in `flags.fusion.actionBar.favorites`, written WHOLE with `seeded: true`, always
 *    with the version the row was computed on — the Mestre's writes too (his version is optional on
 *    the server, and that is the hole two devices fall through);
 *  - a refused write is redone from the FRESH document, never resent as it was: that is what keeps a
 *    pin made on another device (REQ-BAR-063);
 *  - the seed is written once, and never again — not after the player empties the row, not when a
 *    new strike shows up, not by the second device that opened at the same instant (D-BA08).
 */

import { actionBarFavoritesPatch } from "@fusion/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../i18n/index.js";
import { FAVORITES_MAX_ATTEMPTS } from "../favoritesStore.svelte.js";
import { ACTOR, FakeServer, rig, row } from "./favoritesWorld.js";

const SAVE_FAILED = "Não foi possível salvar os Favoritos. Tente de novo.";

/** The store logs why a write failed; the tests that make one fail read it from here instead of the terminal. */
let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  logged.mockRestore();
});

/** One macrotask: every promise already resolved has run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The row the server holds (each rig brings its own `shared` state, so tests share nothing). */
const seededOn = (server: FakeServer): Array<string | null> => server.favorites ?? [];

// ---------------------------------------------------------------------------
// Reading the row
// ---------------------------------------------------------------------------

describe("the row the bar draws", () => {
  it("an actor with no bar: twelve empty positions, and nothing is written", () => {
    const r = rig({ server: new FakeServer({}) });

    expect(r.store.slots()).toEqual(row());
    expect(r.server.attempts).toHaveLength(0);
  });

  it("an actor with a stored row: the stored positions, holes included — the position is the key", () => {
    const r = rig({
      server: new FakeServer({ favorites: row("strike:a", null, "spell:m:b"), seeded: true }),
    });

    expect(r.store.slots()).toEqual(row("strike:a", null, "spell:m:b"));
    expect(r.store.isPinned("spell:m:b")).toBe(true);
    expect(r.store.isPinned("strike:zzz")).toBe(false);
  });

  it("follows the document: when the mirror brings a row written on another device, the row changes", () => {
    const r = rig();
    expect(r.store.slots()).toEqual(row());

    r.server.external(row("strike:x"));
    r.mirror.sync();

    expect(r.store.slots()).toEqual(row("strike:x"));
  });

  it("slots() is a copy: whoever edits it does not edit the store", () => {
    const r = rig({ server: new FakeServer({ favorites: row("strike:a"), seeded: true }) });

    (r.store.slots() as Array<string | null>)[0] = "strike:hack";

    expect(r.store.slots()[0]).toBe("strike:a");
  });

  it("a favourite whose entry left the sheet stays pinned: the store does not know the sheet, only the player unpins it (REQ-BAR-066)", async () => {
    const r = rig({ server: new FakeServer({ favorites: row("item:vendido"), seeded: true }) });

    expect(r.store.isPinned("item:vendido")).toBe(true);
    r.store.unpin("item:vendido");
    await r.store.settled();

    expect(r.store.isPinned("item:vendido")).toBe(false);
    expect(seededOn(r.server)).toEqual(row());
  });
});

// ---------------------------------------------------------------------------
// The seed (REQ-BAR-064, REQ-BAR-065, D-BA08)
// ---------------------------------------------------------------------------

describe("the first-opening seed", () => {
  it("until it is written the bar already shows it, so the row is not empty for a moment", () => {
    const r = rig({ server: new FakeServer({}), seed: ["strike:a", "spell:m:b"] });

    expect(r.store.slots()).toEqual(row("strike:a", "spell:m:b"));
    expect(r.server.attempts).toHaveLength(0);
  });

  it("is written ONCE, whole, with `seeded: true` and the version it was computed on (REQ-BAR-064)", async () => {
    const r = rig({ server: new FakeServer({ version: 3 }), seed: ["strike:a", "action:c"] });

    r.store.ensureSeeded();
    await r.store.settled();

    expect(r.server.attempts).toHaveLength(1);
    expect(r.server.attempts[0]?.payload).toEqual({
      documentType: "Actor",
      updates: [
        {
          _id: ACTOR,
          diff: actionBarFavoritesPatch(row("strike:a", "action:c")),
          expectedVersion: 3,
        },
      ],
    });
    expect(r.server.seeded).toBe(true);
    expect(seededOn(r.server)).toEqual(row("strike:a", "action:c"));
    expect(r.notices).toEqual([]);
  });

  it("asking again does not write again (the shell asks every time its entries change)", async () => {
    const r = rig({ server: new FakeServer({}), seed: ["strike:a"] });

    r.store.ensureSeeded();
    r.store.ensureSeeded();
    await r.store.settled();
    r.mirror.sync();
    r.store.ensureSeeded();
    await r.store.settled();

    expect(r.server.accepted).toHaveLength(1);
    expect(r.server.attempts).toHaveLength(1);
  });

  it("a seed that FAILED is not asked again every time the entries change: one failure, one notice", async () => {
    const r = rig({ server: new FakeServer({}), seed: ["strike:a"] });
    r.server.failWith = Object.assign(new Error("No OWNER access"), { code: "PERMISSION_DENIED" });

    r.store.ensureSeeded();
    await r.store.settled();
    // The shell asks again whenever the provider's list changes.
    r.seed.ids = ["strike:a", "strike:b"];
    r.store.ensureSeeded();
    r.store.ensureSeeded();
    await r.store.settled();

    expect(r.server.attempts).toHaveLength(1);
    expect(r.notices).toEqual([SAVE_FAILED]);
    // …and the row the player sees is the one the document has, not a seed that was never written.
    expect(r.store.slots()).toEqual(row("strike:a", "strike:b"));
  });

  it("for an actor that is already seeded, asking queues NOTHING — it is the common case, on every change of the list", async () => {
    const r = rig({
      server: new FakeServer({ favorites: row("strike:a"), seeded: true }),
      seed: ["strike:a", "strike:novo"],
    });

    r.store.ensureSeeded();

    expect(r.shared.chains.size).toBe(0);
    await r.store.settled();
    expect(r.server.attempts).toHaveLength(0);
  });

  it("with nothing to seed yet (the provider has not loaded) it writes nothing and waits for the next ask", async () => {
    const r = rig({ server: new FakeServer({}), seed: [] });

    r.store.ensureSeeded();
    await r.store.settled();
    expect(r.server.attempts).toHaveLength(0);
    expect(r.store.slots()).toEqual(row());

    r.seed.ids = ["strike:a"];
    r.store.ensureSeeded();
    await r.store.settled();

    expect(seededOn(r.server)).toEqual(row("strike:a"));
  });

  it("D-BA08: once seeded, a NEW strike never enters the row — it goes to its tab", async () => {
    const r = rig({
      server: new FakeServer({ favorites: row("strike:a", "spell:m:b"), seeded: true }),
      seed: ["strike:a", "spell:m:b", "strike:novo"],
    });

    r.store.ensureSeeded();
    await r.store.settled();

    expect(r.server.attempts).toHaveLength(0);
    expect(r.store.slots()).toEqual(row("strike:a", "spell:m:b"));
    expect(r.store.isPinned("strike:novo")).toBe(false);
  });

  it("…and not after the player emptied the whole row either: `seeded` stays true, nothing comes back", async () => {
    const r = rig({
      server: new FakeServer({ favorites: row(), seeded: true }),
      seed: ["strike:a", "spell:m:b"],
    });

    r.store.ensureSeeded();
    await r.store.settled();

    expect(r.server.attempts).toHaveLength(0);
    expect(r.store.slots()).toEqual(row());
  });

  it("a row somebody already arranged is not seeded over, even without the flag", async () => {
    const r = rig({
      server: new FakeServer({ favorites: row(null, "strike:meu") }),
      seed: ["strike:a", "spell:m:b"],
    });

    r.store.ensureSeeded();
    await r.store.settled();

    expect(r.server.attempts).toHaveLength(0);
    expect(r.store.slots()).toEqual(row(null, "strike:meu"));
  });

  it("a pin made before the seed was written builds on the seed the player was looking at", async () => {
    const r = rig({ server: new FakeServer({}), seed: ["strike:a", "strike:b"] });

    r.store.pin("item:potion");
    await r.store.settled();

    expect(seededOn(r.server)).toEqual(row("strike:a", "strike:b", "item:potion"));
    expect(r.server.seeded).toBe(true);
  });

  it("the seed and a pin right after it are two writes in order, the second on the first's version — no STALE_WRITE", async () => {
    const r = rig({ server: new FakeServer({ version: 3 }), seed: ["strike:a"] });

    r.store.ensureSeeded();
    r.store.pin("item:potion");
    await r.store.settled();

    expect(r.server.attempts.map((a) => [a.outcome, a.expectedVersion])).toEqual([
      ["ok", 3],
      ["ok", 4],
    ]);
    expect(seededOn(r.server)).toEqual(row("strike:a", "item:potion"));
  });

  it("two devices that open at the same instant seed ONCE: one write wins, the other finds it seeded and writes nothing more", async () => {
    const server = new FakeServer({ version: 3 });
    const player = rig({ server, seed: ["strike:do-jogador", "spell:m:b"] });
    const gm = rig({ server, seed: ["strike:do-mestre", "action:seek"] });

    player.store.ensureSeeded();
    gm.store.ensureSeeded();
    await Promise.all([player.store.settled(), gm.store.settled()]);

    expect(server.accepted).toHaveLength(1);
    expect(server.attempts.filter((a) => a.outcome === "stale")).toHaveLength(1);
    expect(server.attempts).toHaveLength(2);
    expect(server.version).toBe(4);
    expect(server.seeded).toBe(true);
    const stored = seededOn(server);
    expect([
      row("strike:do-jogador", "spell:m:b"),
      row("strike:do-mestre", "action:seek"),
    ]).toContainEqual(stored);
    // Both devices end up showing the one row that was stored.
    expect(player.store.slots()).toEqual(stored);
    expect(gm.store.slots()).toEqual(stored);
    expect(player.notices).toEqual([]);
    expect(gm.notices).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pin, unpin, move — each one write, with the version (REQ-BAR-063)
// ---------------------------------------------------------------------------

describe("pin, unpin and move", () => {
  it("pin goes to the first empty slot and is written whole, with the version it was computed on", async () => {
    const r = rig({
      server: new FakeServer({ version: 7, favorites: row("strike:a"), seeded: true }),
    });

    expect(r.store.pin("item:potion")).toBe(true);
    await r.store.settled();

    expect(r.server.attempts).toHaveLength(1);
    expect(r.server.attempts[0]?.payload).toEqual({
      documentType: "Actor",
      updates: [
        {
          _id: ACTOR,
          diff: actionBarFavoritesPatch(row("strike:a", "item:potion")),
          expectedVersion: 7,
        },
      ],
    });
  });

  it("every write carries expectedVersion — there is no write without the lock, whoever the writer is", async () => {
    const r = rig({
      server: new FakeServer({ version: 9, favorites: row("strike:a"), seeded: true }),
    });

    r.store.pin("item:potion");
    r.store.unpin("strike:a");
    r.store.move(1, 4);
    await r.store.settled();

    expect(r.server.attempts.length).toBeGreaterThanOrEqual(3);
    for (const attempt of r.server.attempts) expect(attempt.expectedVersion).toBeTypeOf("number");
  });

  it("pinning what is already pinned is a no-op: true, no write, the slot does not move", async () => {
    const r = rig({
      server: new FakeServer({ favorites: row("strike:a", "strike:b"), seeded: true }),
    });

    expect(r.store.pin("strike:b")).toBe(true);

    expect(r.shared.chains.size).toBe(0);
    await r.store.settled();
    expect(r.server.attempts).toHaveLength(0);
    expect(r.store.slots()).toEqual(row("strike:a", "strike:b"));
  });

  it("12 of 12: pin says no, writes nothing, and the row is as it was", async () => {
    const full = Array.from({ length: 12 }, (_, index) => `action:n${String(index)}`);
    const r = rig({ server: new FakeServer({ favorites: full, seeded: true }) });

    expect(r.store.pin("action:extra")).toBe(false);
    await r.store.settled();

    expect(r.server.attempts).toHaveLength(0);
    expect(r.store.slots()).toEqual(full);
    expect(r.store.isPinned("action:extra")).toBe(false);
  });

  it("a hole left by an unpin is the next free slot", async () => {
    const r = rig({
      server: new FakeServer({ favorites: row("strike:a", null, "strike:c"), seeded: true }),
    });

    r.store.pin("item:potion");
    await r.store.settled();

    expect(seededOn(r.server)).toEqual(row("strike:a", "item:potion", "strike:c"));
  });

  it("unpin empties the slot and leaves the others where they are — no slot slides to the left", async () => {
    const r = rig({
      server: new FakeServer({
        favorites: row("strike:a", "strike:b", "strike:c"),
        seeded: true,
      }),
    });

    r.store.unpin("strike:b");
    await r.store.settled();

    expect(seededOn(r.server)).toEqual(row("strike:a", null, "strike:c"));
    expect(r.store.isPinned("strike:b")).toBe(false);
  });

  it("unpinning what is not pinned writes nothing — and does not even queue", async () => {
    const r = rig({ server: new FakeServer({ favorites: row("strike:a"), seeded: true }) });

    r.store.unpin("strike:zzz");

    expect(r.shared.chains.size).toBe(0);
    await r.store.settled();
    expect(r.server.attempts).toHaveLength(0);
  });

  it("move swaps with an occupied slot and moves to an empty one", async () => {
    const r = rig({
      server: new FakeServer({ favorites: row("strike:a", "strike:b"), seeded: true }),
    });

    r.store.move(0, 1);
    await r.store.settled();
    expect(seededOn(r.server)).toEqual(row("strike:b", "strike:a"));

    r.store.move(0, 5);
    await r.store.settled();
    expect(seededOn(r.server)).toEqual(row(null, "strike:a", null, null, null, "strike:b"));
  });

  it("a move that changes nothing — the same slot, outside the row, two empty slots — writes nothing", async () => {
    const r = rig({ server: new FakeServer({ favorites: row("strike:a"), seeded: true }) });

    r.store.move(0, 0);
    r.store.move(-1, 3);
    r.store.move(0, 12);
    r.store.move(4, 7);

    expect(r.shared.chains.size).toBe(0);
    await r.store.settled();
    expect(r.server.attempts).toHaveLength(0);
  });

  it("the keys do not shift: after an unpin the entry in slot 3 is still in slot 3", async () => {
    const r = rig({
      server: new FakeServer({
        favorites: row("strike:a", "strike:b", "strike:c"),
        seeded: true,
      }),
    });

    r.store.unpin("strike:a");
    await r.store.settled();

    expect(r.store.slots()[2]).toBe("strike:c");
  });
});

// ---------------------------------------------------------------------------
// The display while a write is on its way
// ---------------------------------------------------------------------------

describe("the display while a write is in flight", () => {
  it("a pin shows at once, before the server answers, and isPinned agrees", async () => {
    const r = rig();
    let release!: () => void;
    r.server.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    r.store.pin("strike:a");
    await flush();

    expect(r.server.attempts).toHaveLength(0);
    expect(r.store.slots()).toEqual(row("strike:a"));
    expect(r.store.isPinned("strike:a")).toBe(true);

    release();
    await r.store.settled();
    expect(r.store.slots()).toEqual(row("strike:a"));
  });

  it("edits stack in order on the display: pin A, pin B, unpin A", async () => {
    const r = rig();
    r.server.gate = new Promise<void>(() => {
      // never released: the write stays in flight for the whole test
    });

    r.store.pin("strike:a");
    r.store.pin("strike:b");
    r.store.unpin("strike:a");

    expect(r.store.slots()).toEqual(row(null, "strike:b"));
  });

  it("after the ack, with the mirror still behind, the row stays — the answer's document is used, not the old copy", async () => {
    const r = rig({ onDelay: () => undefined });

    r.store.pin("strike:a");
    await r.store.settled();

    // The server is at version 4 and this client's copy is still the old one (version 3).
    expect(r.server.version).toBe(4);
    expect((r.mirror.doc?.["_stats"] as { version: number }).version).toBe(3);
    expect(r.store.slots()).toEqual(row("strike:a"));
    expect(r.store.isPinned("strike:a")).toBe(true);
  });

  it("when the mirror catches up it takes over, and a later change from another device shows", async () => {
    const r = rig();
    r.store.pin("strike:a");
    await r.store.settled();

    r.server.external(row("strike:a", "strike:outro"));
    r.mirror.sync();

    expect(r.store.slots()).toEqual(row("strike:a", "strike:outro"));
  });
});

// ---------------------------------------------------------------------------
// Concurrent writes (REQ-BAR-063, DEC-NET-05)
// ---------------------------------------------------------------------------

describe("concurrent writes — STALE_WRITE is redone on the fresh document", () => {
  it("another device pinned in between: the refused pin is redone on the new row, and BOTH pins survive", async () => {
    const r = rig({
      server: new FakeServer({ version: 5, favorites: row("strike:a"), seeded: true }),
    });
    let first = true;
    r.server.beforeWrite = () => {
      if (!first) return;
      first = false;
      // The other device pins C. This client's mirror does not know yet.
      r.server.external(row("strike:a", "strike:c"));
    };

    expect(r.store.pin("strike:b")).toBe(true);
    await r.store.settled();

    expect(r.server.attempts.map((a) => [a.outcome, a.expectedVersion])).toEqual([
      ["stale", 5],
      ["ok", 6],
    ]);
    expect(seededOn(r.server)).toEqual(row("strike:a", "strike:c", "strike:b"));
    expect(r.notices).toEqual([]);
  });

  it("the same, when the other device's broadcast had already arrived: redone at once, no wait", async () => {
    const r = rig({
      server: new FakeServer({ version: 5, favorites: row("strike:a"), seeded: true }),
      onDelay: () => undefined,
    });
    let first = true;
    r.server.beforeWrite = () => {
      if (!first) return;
      first = false;
      r.server.external(row("strike:a", "strike:c"));
      r.mirror.sync();
    };

    r.store.pin("strike:b");
    await r.store.settled();

    expect(r.delays).toEqual([]);
    expect(seededOn(r.server)).toEqual(row("strike:a", "strike:c", "strike:b"));
  });

  it("when the broadcast is late, it waits for it instead of resending a write it knows is stale", async () => {
    const r = rig({
      server: new FakeServer({ version: 5, favorites: row("strike:a"), seeded: true }),
    });
    let first = true;
    r.server.beforeWrite = () => {
      if (!first) return;
      first = false;
      r.server.external(row("strike:a", "strike:c"));
    };

    r.store.pin("strike:b");
    await r.store.settled();

    expect(r.delays.length).toBeGreaterThanOrEqual(1);
    expect(r.delays.every((ms) => ms > 0)).toBe(true);
    // One refused attempt and one accepted — never a second attempt on the stale version.
    expect(r.server.attempts.filter((a) => a.expectedVersion === 5)).toHaveLength(1);
  });

  it("a pin refused and redone while the player ALSO unpins: both edits are in the final row", async () => {
    const r = rig({
      server: new FakeServer({ version: 2, favorites: row("strike:a", "strike:b"), seeded: true }),
    });
    let first = true;
    r.server.beforeWrite = () => {
      if (!first) return;
      first = false;
      r.server.external(row("strike:a", "strike:b", "strike:c"));
    };

    r.store.pin("strike:d");
    r.store.unpin("strike:a");
    await r.store.settled();

    expect(seededOn(r.server)).toEqual(row(null, "strike:b", "strike:c", "strike:d"));
  });

  it("the other device already pinned the same entry: the redone write has nothing to add and sends nothing", async () => {
    const r = rig({
      server: new FakeServer({ version: 5, favorites: row("strike:a"), seeded: true }),
    });
    let first = true;
    r.server.beforeWrite = () => {
      if (!first) return;
      first = false;
      r.server.external(row("strike:a", "strike:b"));
    };

    r.store.pin("strike:b");
    await r.store.settled();

    expect(r.server.attempts.map((a) => a.outcome)).toEqual(["stale"]);
    expect(seededOn(r.server)).toEqual(row("strike:a", "strike:b"));
    expect(r.store.slots()).toEqual(row("strike:a", "strike:b"));
    expect(r.notices).toEqual([]);
  });

  it("two quick pins while the mirror lags: the second builds on the first's answer, so nothing is refused and nothing is lost", async () => {
    const r = rig({ server: new FakeServer({ version: 1 }), onDelay: () => undefined });

    r.store.pin("strike:a");
    r.store.pin("strike:b");
    await r.store.settled();

    expect(r.server.attempts.map((a) => [a.outcome, a.expectedVersion])).toEqual([
      ["ok", 1],
      ["ok", 2],
    ]);
    expect(seededOn(r.server)).toEqual(row("strike:a", "strike:b"));
    expect(r.delays).toEqual([]);
  });

  it("writes to one actor go one at a time, in the order they were made", async () => {
    const r = rig({ server: new FakeServer({ version: 1 }), onDelay: () => undefined });

    r.store.pin("strike:a");
    r.store.pin("strike:b");
    r.store.pin("strike:c");
    r.store.unpin("strike:a");
    await r.store.settled();

    expect(r.server.maxInFlight).toBe(1);
    expect(seededOn(r.server)).toEqual(row(null, "strike:b", "strike:c"));
  });

  it("a hot actor that is stale every time gives up after the attempts the store allows, and says so", async () => {
    const r = rig({ server: new FakeServer({ version: 1, favorites: row(), seeded: true }) });
    r.server.beforeWrite = () => {
      // Hit points change all the time in combat: the version moves before every write lands.
      r.server.external(r.server.favorites ?? row());
      r.mirror.sync();
    };

    r.store.pin("strike:a");
    await r.store.settled();

    expect(r.server.accepted).toHaveLength(0);
    expect(r.server.attempts).toHaveLength(FAVORITES_MAX_ATTEMPTS);
    expect(r.notices).toEqual([SAVE_FAILED]);
    expect(logged).toHaveBeenCalledTimes(1);
    // The pin the player never got does not stay on the display.
    expect(r.store.slots()).toEqual(row());
    expect(r.store.isPinned("strike:a")).toBe(false);
  });

  it("when nothing newer ever arrives it gives up without resending the stale write", async () => {
    const r = rig({
      server: new FakeServer({ version: 1, favorites: row(), seeded: true }),
      onDelay: () => undefined,
    });
    r.server.beforeWrite = () => {
      r.server.version += 1;
    };

    r.store.pin("strike:a");
    await r.store.settled();

    expect(r.server.attempts).toHaveLength(1);
    expect(r.server.attempts[0]?.outcome).toBe("stale");
    expect(r.delays.length).toBeGreaterThan(1);
    expect(r.notices).toEqual([SAVE_FAILED]);
    expect(r.store.slots()).toEqual(row());
  });
});

// ---------------------------------------------------------------------------
// Failures that are not a stale version
// ---------------------------------------------------------------------------

describe("a write that fails", () => {
  it("a refusal other than STALE_WRITE (no permission) is not retried: one notice, and the optimistic pin is gone", async () => {
    const r = rig();
    r.server.failWith = Object.assign(new Error("No OWNER access"), { code: "PERMISSION_DENIED" });

    r.store.pin("strike:a");
    expect(r.store.isPinned("strike:a")).toBe(true);
    await r.store.settled();

    expect(r.server.attempts).toHaveLength(1);
    expect(r.notices).toEqual([SAVE_FAILED]);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(r.store.isPinned("strike:a")).toBe(false);
    expect(r.store.slots()).toEqual(row());
  });

  it("a dead socket (the write rejects with a plain Error) is the same", async () => {
    const r = rig();
    r.server.failWith = new Error("Sem conexão com o servidor.");

    r.store.unpin("strike:x");
    r.store.pin("strike:a");
    await r.store.settled();

    expect(r.notices).toEqual([SAVE_FAILED]);
    expect(r.store.slots()).toEqual(row());
  });

  it("one failed write does not block the next: the queue keeps going", async () => {
    const r = rig({ server: new FakeServer({ version: 1 }), onDelay: () => undefined });
    r.server.failWith = new Error("boom");
    r.store.pin("strike:a");
    await r.store.settled();
    r.server.failWith = null;

    r.store.pin("strike:b");
    await r.store.settled();

    expect(seededOn(r.server)).toEqual(row("strike:b"));
  });
});
