/**
 * ambientPlayerWiring.test.ts — tests for the AmbientPlayer class itself,
 * with Howler and the asset API mocked.
 *
 * Why this file exists, given ambientPlayer.test.ts already covers the pure
 * functions: the pure functions were all green while the player still could
 * not play a single track. The contract `src` is a BARE asset name, and the
 * URL it was handed to Howler was that bare name — a page-relative URL that
 * 404s. Nothing in a pure-function suite can see that; only a test that
 * inspects what actually reaches `new Howl({src})` can.
 *
 * This is the repo's recurring lesson (r22 #48, and the mapa-som discovery's
 * own draft): verifying the inside of a piece proves nothing about the wire
 * that reaches the player's ears.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const howlInstances: MockHowl[] = [];

interface HowlOptions {
  src: string[];
  loop?: boolean;
  html5?: boolean;
  volume?: number;
}

class MockHowl {
  readonly options: HowlOptions;
  readonly handlers = new Map<string, (() => void)[]>();
  played = 0;
  unloaded = false;
  seeked: number | null = null;
  private _duration = 60;

  constructor(options: HowlOptions) {
    this.options = options;
    howlInstances.push(this);
  }

  on(event: string, fn: () => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(fn);
    this.handlers.set(event, list);
    return this;
  }
  once(event: string, fn: () => void): this {
    return this.on(event, fn);
  }
  /** Fire an event the way Howler would. */
  emit(event: string): void {
    for (const fn of this.handlers.get(event) ?? []) fn();
  }
  play(): number {
    this.played += 1;
    return 1;
  }
  seek(pos?: number): number {
    if (typeof pos === "number") this.seeked = pos;
    return this.seeked ?? 0;
  }
  volume(v?: number): number {
    if (typeof v === "number") this.options.volume = v;
    return this.options.volume ?? 1;
  }
  duration(): number {
    return this._duration;
  }
  unload(): void {
    this.unloaded = true;
  }
}

vi.mock("howler", () => ({
  Howl: MockHowl,
  Howler: { ctx: { state: "running" } },
}));

vi.mock("../../assets/assetApi.js", () => ({
  assetUrl: (name: string, queryToken?: { token: string; exp: number; userId: string }) =>
    queryToken ? `/assets/${name}?at=${queryToken.token}` : `/assets/${name}`,
  fetchAssetToken: vi.fn(async () => ({ token: "tok123", exp: 999, userId: "u1" })),
}));

const { AmbientPlayer } = await import("../ambientPlayer.js");

const AUTH = { accessToken: "access", userId: "u1" };
const TRACK = { src: "tavern.mp3", startedAt: 1_000 };

function newPlayer(onUnlockedChange?: (unlocked: boolean) => void) {
  return new AmbientPlayer({
    getAuth: () => AUTH,
    ...(onUnlockedChange ? { onUnlockedChange } : {}),
  });
}

describe("AmbientPlayer — the URL that actually reaches Howler", () => {
  beforeEach(() => {
    howlInstances.length = 0;
  });

  it("builds an /assets/ URL from the bare src, not a page-relative name", async () => {
    const player = newPlayer();
    await player.syncTo(TRACK, 0.5);

    expect(howlInstances).toHaveLength(1);
    const url = howlInstances[0]!.options.src[0]!;
    // The regression this file exists for: a bare "tavern.mp3" would resolve
    // against the page, not the asset route, and 404.
    expect(url.startsWith("/assets/")).toBe(true);
    expect(url).toContain("tavern.mp3");
  });

  it("carries the short-lived asset query token when a session exists", async () => {
    const player = newPlayer();
    await player.syncTo(TRACK, 0.5);
    expect(howlInstances[0]!.options.src[0]).toContain("at=tok123");
  });

  it("still builds a well-formed /assets/ URL without a session", async () => {
    const player = new AmbientPlayer({ getAuth: () => null });
    await player.syncTo(TRACK, 0.5);
    expect(howlInstances[0]!.options.src[0]).toBe("/assets/tavern.mp3");
  });

  it("loops and uses Web Audio mode", async () => {
    const player = newPlayer();
    await player.syncTo(TRACK, 0.5);
    expect(howlInstances[0]!.options.loop).toBe(true);
    expect(howlInstances[0]!.options.html5).toBe(false);
  });
});

describe("AmbientPlayer — lifecycle", () => {
  beforeEach(() => {
    howlInstances.length = 0;
  });

  it("seeks to the loop position and plays once loaded", async () => {
    const player = newPlayer();
    await player.syncTo({ src: "tavern.mp3", startedAt: Date.now() - 90_000 }, 0.5);

    const howl = howlInstances[0]!;
    howl.emit("load");
    // 90s elapsed on a 60s track → 30s into the second loop.
    expect(howl.seeked).toBeCloseTo(30, 0);
    expect(howl.played).toBe(1);
  });

  it("is idempotent: the same state again neither recreates nor restarts", async () => {
    const player = newPlayer();
    await player.syncTo(TRACK, 0.5);
    howlInstances[0]!.emit("load");
    await player.syncTo(TRACK, 0.5);

    expect(howlInstances).toHaveLength(1);
    expect(howlInstances[0]!.played).toBe(1);
    expect(howlInstances[0]!.unloaded).toBe(false);
  });

  it("applies a volume change to the live Howl without recreating it", async () => {
    const player = newPlayer();
    await player.syncTo(TRACK, 0.5);
    await player.syncTo(TRACK, 0.2);

    expect(howlInstances).toHaveLength(1);
    expect(howlInstances[0]!.options.volume).toBe(0.2);
  });

  it("replaces the Howl when the GM switches track", async () => {
    const player = newPlayer();
    await player.syncTo(TRACK, 0.5);
    await player.syncTo({ src: "storm.ogg", startedAt: 2_000 }, 0.5);

    expect(howlInstances).toHaveLength(2);
    expect(howlInstances[0]!.unloaded).toBe(true);
    expect(howlInstances[1]!.options.src[0]).toContain("storm.ogg");
  });

  it("tears the Howl down on stop (silence)", async () => {
    const player = newPlayer();
    await player.syncTo(TRACK, 0.5);
    await player.syncTo(null, 0.5);

    expect(howlInstances).toHaveLength(1);
    expect(howlInstances[0]!.unloaded).toBe(true);
  });
});

describe("AmbientPlayer — autoplay unlock recovery", () => {
  beforeEach(() => {
    howlInstances.length = 0;
  });

  it("reports the blocked state so the UI can show the badge", async () => {
    const seen: boolean[] = [];
    const player = newPlayer((u) => seen.push(u));
    await player.syncTo(TRACK, 0.5);

    howlInstances[0]!.emit("playerror");
    expect(seen).toContain(false);
  });

  it("rebuilds and plays after unlock — a seek alone would leave it silent", async () => {
    const seen: boolean[] = [];
    const player = newPlayer((u) => seen.push(u));
    await player.syncTo(TRACK, 0.5);

    const blocked = howlInstances[0]!;
    blocked.emit("playerror");
    expect(blocked.played).toBe(0);

    blocked.emit("unlock");
    await Promise.resolve();
    await Promise.resolve();

    expect(seen).toContain(true);
    // Howler's unlock path only emits the event; it never resumes playback.
    // A fresh Howl must exist and reach play() once it loads.
    expect(howlInstances).toHaveLength(2);
    expect(blocked.unloaded).toBe(true);

    const rebuilt = howlInstances[1]!;
    rebuilt.emit("load");
    expect(rebuilt.played).toBe(1);
  });
});
