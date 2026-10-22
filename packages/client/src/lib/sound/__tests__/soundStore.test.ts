/**
 * soundStore.test.ts — unit tests for the sound store's pure reducers and
 * volume persistence.
 *
 * Intentionally does NOT call attachSoundSync() (that wires the real
 * AmbientPlayer/Howler, which needs a browser AudioContext) — only the
 * reducers and the plain `sendOp`-based actions are exercised here, same
 * split as ambientPlayer.test.ts covering only the pure functions.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Socket } from "socket.io-client";
import type { AmbientTrackState } from "@fusion/shared";
import {
  soundStore,
  soundActions,
  applySoundState,
  applyAmbientTrackSnapshot,
  clampVolume,
  loadStoredVolume,
  saveStoredVolume,
  extractAmbientSrc,
  VOLUME_STORAGE_KEY,
  DEFAULT_VOLUME,
} from "../soundStore.svelte.js";

beforeEach(() => {
  soundStore.track = null;
  soundStore.volume = DEFAULT_VOLUME;
  soundStore.unlocked = true;
});

// ---------------------------------------------------------------------------
// applySoundState — the sound:state broadcast reducer
// ---------------------------------------------------------------------------

describe("applySoundState", () => {
  it("sets soundStore.track to the broadcast state", () => {
    const state: AmbientTrackState = { src: "tavern.mp3", startedAt: 1000 };
    applySoundState({ state });
    expect(soundStore.track).toEqual(state);
  });

  it("sets soundStore.track to null on a stop broadcast", () => {
    soundStore.track = { src: "tavern.mp3", startedAt: 1000 };
    applySoundState({ state: null });
    expect(soundStore.track).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applyAmbientTrackSnapshot — the world-snapshot reducer (late joiner)
// ---------------------------------------------------------------------------

describe("applyAmbientTrackSnapshot", () => {
  it("applies a present ambientTrack from the snapshot", () => {
    const state: AmbientTrackState = { src: "dungeon.ogg", startedAt: 5000 };
    applyAmbientTrackSnapshot(state);
    expect(soundStore.track).toEqual(state);
  });

  it("applies null explicitly", () => {
    soundStore.track = { src: "tavern.mp3", startedAt: 1000 };
    applyAmbientTrackSnapshot(null);
    expect(soundStore.track).toBeNull();
  });

  it("treats an ABSENT field (undefined — pre-M3 snapshot) as null", () => {
    soundStore.track = { src: "tavern.mp3", startedAt: 1000 };
    applyAmbientTrackSnapshot(undefined);
    expect(soundStore.track).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Volume — clamp + persistence (mock Storage)
// ---------------------------------------------------------------------------

describe("clampVolume", () => {
  it("passes through an in-range value", () => {
    expect(clampVolume(0.5)).toBe(0.5);
  });

  it("clamps above 1 down to 1", () => {
    expect(clampVolume(1.7)).toBe(1);
  });

  it("clamps below 0 up to 0", () => {
    expect(clampVolume(-0.3)).toBe(0);
  });

  it("falls back to the default for NaN", () => {
    expect(clampVolume(NaN)).toBe(DEFAULT_VOLUME);
  });

  it("falls back to the default for Infinity", () => {
    expect(clampVolume(Infinity)).toBe(DEFAULT_VOLUME);
  });
});

function makeMockStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  } as Storage;
}

describe("loadStoredVolume", () => {
  it("returns the default when storage is null", () => {
    expect(loadStoredVolume(null)).toBe(DEFAULT_VOLUME);
  });

  it("returns the default when the key is missing", () => {
    expect(loadStoredVolume(makeMockStorage())).toBe(DEFAULT_VOLUME);
  });

  it("reads and clamps a stored value", () => {
    const storage = makeMockStorage({ [VOLUME_STORAGE_KEY]: "1.4" });
    expect(loadStoredVolume(storage)).toBe(1);
  });

  it("reads a valid in-range stored value", () => {
    const storage = makeMockStorage({ [VOLUME_STORAGE_KEY]: "0.3" });
    expect(loadStoredVolume(storage)).toBe(0.3);
  });

  it("falls back to the default for a non-numeric stored value", () => {
    const storage = makeMockStorage({ [VOLUME_STORAGE_KEY]: "not-a-number" });
    expect(loadStoredVolume(storage)).toBe(DEFAULT_VOLUME);
  });

  it("falls back to the default when storage.getItem throws", () => {
    const storage = {
      getItem: () => {
        throw new Error("private mode");
      },
    } as unknown as Storage;
    expect(loadStoredVolume(storage)).toBe(DEFAULT_VOLUME);
  });
});

describe("saveStoredVolume", () => {
  it("writes the clamped value as a string", () => {
    const storage = makeMockStorage();
    saveStoredVolume(storage, 1.9);
    expect(storage.getItem(VOLUME_STORAGE_KEY)).toBe("1");
  });

  it("no-ops when storage is null", () => {
    expect(() => saveStoredVolume(null, 0.5)).not.toThrow();
  });

  it("swallows a throwing storage.setItem", () => {
    const storage = {
      setItem: () => {
        throw new Error("quota exceeded");
      },
    } as unknown as Storage;
    expect(() => saveStoredVolume(storage, 0.5)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// soundActions.setVolume — updates the store and persists
// ---------------------------------------------------------------------------

describe("soundActions.setVolume", () => {
  it("updates soundStore.volume, clamped", () => {
    soundActions.setVolume(1.5);
    expect(soundStore.volume).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// extractAmbientSrc — FilePicker selection → bare asset filename
// ---------------------------------------------------------------------------

describe("extractAmbientSrc", () => {
  it("extracts the bare filename from a /assets/ path", () => {
    expect(extractAmbientSrc("/assets/tavern-a1b2c3d4.mp3")).toBe("tavern-a1b2c3d4.mp3");
  });

  it("decodes a percent-encoded filename", () => {
    expect(extractAmbientSrc("/assets/taverna%20noturna.mp3")).toBe("taverna noturna.mp3");
  });

  it("returns null for an external URL (FilePicker's paste-a-URL fallback)", () => {
    expect(extractAmbientSrc("https://example.com/song.mp3")).toBeNull();
  });

  it("returns null for a nested path (not a bare filename)", () => {
    expect(extractAmbientSrc("/assets/sub/tavern.mp3")).toBeNull();
  });

  it("returns null for an empty /assets/ path", () => {
    expect(extractAmbientSrc("/assets/")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// soundActions.play / stop — sendOp wiring
// ---------------------------------------------------------------------------

function makeMockSocket(ack: { ok: boolean; result?: unknown; code?: string; message?: string }): {
  socket: Socket;
  emit: ReturnType<typeof vi.fn>;
} {
  const emit = vi.fn((_event: string, _envelope: unknown, cb: (ack: unknown) => void) => {
    cb(ack);
  });
  return { socket: { emit } as unknown as Socket, emit };
}

describe("soundActions.play", () => {
  it("sends a sound:play op with the given src", async () => {
    const { socket, emit } = makeMockSocket({ ok: true, result: { state: null } });
    await soundActions.play(socket, "tavern.mp3");
    expect(emit).toHaveBeenCalledTimes(1);
    const [event, envelope] = emit.mock.calls[0]!;
    expect(event).toBe("op");
    expect((envelope as { type: string }).type).toBe("sound:play");
    expect((envelope as { payload: { src: string } }).payload).toEqual({ src: "tavern.mp3" });
  });

  it("rejects when the server acks failure", async () => {
    const { socket } = makeMockSocket({ ok: false, code: "PERMISSION_DENIED", message: "nope" });
    await expect(soundActions.play(socket, "tavern.mp3")).rejects.toThrow("nope");
  });
});

describe("soundActions.stop", () => {
  it("sends a sound:stop op with an empty payload", async () => {
    const { socket, emit } = makeMockSocket({ ok: true, result: { state: null } });
    await soundActions.stop(socket);
    const [event, envelope] = emit.mock.calls[0]!;
    expect(event).toBe("op");
    expect((envelope as { type: string }).type).toBe("sound:stop");
    expect((envelope as { payload: unknown }).payload).toEqual({});
  });
});
