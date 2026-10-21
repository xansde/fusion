/**
 * soundQuickTracks.test.ts — the GM's one-click "world tracks" list: recents
 * first, capped, pruned against the library, persisted tolerantly.
 */
import { describe, it, expect, vi } from "vitest";
import {
  orderQuickTracks,
  pushRecentTrack,
  loadRecentTracks,
  soundStore,
  soundActions,
  RECENT_LIMIT,
  RECENT_STORAGE_KEY,
} from "../soundStore.svelte.js";

vi.mock("../../docs/sendOp.js", () => ({
  sendOp: vi.fn(async () => ({ state: null })),
  OpError: class OpError extends Error {},
}));

describe("orderQuickTracks", () => {
  it("puts used tracks first (most recent first), then the rest of the library", () => {
    const lib = ["a.mp3", "b.ogg", "c.mp3", "d.ogg"];
    expect(orderQuickTracks(lib, ["c.mp3", "a.mp3"])).toEqual(["c.mp3", "a.mp3", "b.ogg", "d.ogg"]);
  });

  it("drops recent entries that left the library", () => {
    expect(orderQuickTracks(["a.mp3"], ["gone.mp3", "a.mp3"])).toEqual(["a.mp3"]);
  });

  it("caps the list", () => {
    const lib = Array.from({ length: 20 }, (_, i) => `t${String(i)}.mp3`);
    expect(orderQuickTracks(lib, [])).toHaveLength(RECENT_LIMIT);
    expect(orderQuickTracks(lib, [], 3)).toHaveLength(3);
  });

  it("is empty for an empty library", () => {
    expect(orderQuickTracks([], ["a.mp3"])).toEqual([]);
  });
});

describe("pushRecentTrack", () => {
  it("moves a repeated track to the front without duplicating it", () => {
    expect(pushRecentTrack(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });

  it("keeps at most RECENT_LIMIT entries", () => {
    const many = Array.from({ length: RECENT_LIMIT }, (_, i) => `t${String(i)}`);
    const next = pushRecentTrack(many, "new");
    expect(next).toHaveLength(RECENT_LIMIT);
    expect(next[0]).toBe("new");
  });
});

describe("loadRecentTracks", () => {
  const store = (v: string | null) => ({ getItem: () => v });

  it("reads a stored list", () => {
    expect(loadRecentTracks(store('["a.mp3","b.ogg"]'))).toEqual(["a.mp3", "b.ogg"]);
  });

  it.each([null, "not json", '{"a":1}', "[1,2]"])("tolerates %s", (raw) => {
    expect(loadRecentTracks(store(raw))).toEqual(raw === "[1,2]" ? [] : []);
  });

  it("tolerates a missing or throwing storage", () => {
    expect(loadRecentTracks(null)).toEqual([]);
    expect(
      loadRecentTracks({
        getItem: () => {
          throw new Error("denied");
        },
      }),
    ).toEqual([]);
  });
});

describe("soundActions.play remembers the track", () => {
  it("adds it to the front of soundStore.recent once the server acked", async () => {
    soundStore.recent = ["old.mp3"];
    const socket = {} as never;
    await soundActions.play(socket, "new.ogg");
    expect(soundStore.recent).toEqual(["new.ogg", "old.mp3"]);
    expect(RECENT_STORAGE_KEY).toContain("recent");
  });
});
