/**
 * ambientPlayer.ts — Howler wrapper for the ambient table track (M3).
 *
 * Plain module — NO Svelte state/runes here. soundStore.svelte.ts owns the
 * reactive `$state` and reacts to it in an `$effect`; this module owns the
 * single `Howl` instance and its create/destroy/seek lifecycle, and exposes
 * the pure decision functions the store's tests exercise directly.
 *
 * Auth (accessToken/userId, needed to resolve the asset URL) is injected via
 * `AmbientPlayerDeps.getAuth` rather than imported from session.svelte.ts
 * directly — session.svelte.ts imports worldSync.ts, which feeds the world
 * snapshot's ambientTrack into soundStore.svelte.ts (which owns this
 * player), so a direct import here would close an
 * ambientPlayer → session.svelte → worldSync → soundStore.svelte →
 * ambientPlayer cycle. Injection keeps this module a leaf.
 *
 * Contract: packages/shared/src/sound/types.ts (immutable — see project
 * CLAUDE.md). `AmbientTrackState` is `{ src, startedAt } | null`; the track
 * always loops; late joiners derive the loop position locally from the
 * server-authoritative `startedAt` (REQ-AUD-022, tolerance ±2s).
 */

import { Howl, Howler } from "howler";
import type { AmbientTrackState } from "@fusion/shared";
import { resolveAssetUrl } from "../assets/assetApi.js";

// ---------------------------------------------------------------------------
// Pure functions (unit tested directly — see __tests__/ambientPlayer.test.ts)
// ---------------------------------------------------------------------------

/**
 * Loop-relative offset (seconds) a late joiner / reconnecting client should
 * seek to, given the server-authoritative `startedAt` and the track's real
 * duration.
 *
 * `duration <= 0` (unknown/unloaded track) returns 0 — there is nothing to
 * loop against yet, so start from the beginning rather than dividing by zero.
 * Negative elapsed time (clock skew, or a `startedAt` briefly in the future)
 * is normalized into `[0, duration)` instead of returning a negative offset.
 */
export function loopOffsetSeconds(startedAt: number, nowMs: number, duration: number): number {
  if (!(duration > 0)) return 0;
  const elapsedSec = (nowMs - startedAt) / 1000;
  return ((elapsedSec % duration) + duration) % duration;
}

/**
 * Decide whether syncing the player to `next` requires tearing down and
 * recreating the `Howl` instance, or whether `prev`/`next` describe the SAME
 * track already playing.
 *
 * Idempotence (task requirement): receiving the exact same state again
 * (same `src` + `startedAt`) must NOT recreate the `Howl` or skip the audio
 * — only a genuinely different src/startedAt, or a null↔non-null transition
 * (play↔stop), warrants a restart.
 */
export function shouldRestart(prev: AmbientTrackState, next: AmbientTrackState): boolean {
  if (prev === null && next === null) return false;
  if (prev === null || next === null) return true;
  return prev.src !== next.src || prev.startedAt !== next.startedAt;
}

// ---------------------------------------------------------------------------
// AmbientPlayer — owns the single Howl instance
// ---------------------------------------------------------------------------

export interface AmbientPlayerAuth {
  accessToken: string;
  userId: string;
}

export interface AmbientPlayerDeps {
  /**
   * Resolves the current accessToken/userId, called fresh on every
   * restart-worthy syncTo() (the access token can rotate across a session).
   * Returns null when there is no authenticated session yet — the src is
   * used unresolved in that case (matches sceneLoader.ts's fallback).
   */
  getAuth?: () => AmbientPlayerAuth | null;
  /**
   * Called whenever the locally-known unlock state changes — autoplay was
   * blocked (`playerror`) or the audio context unlocked on a user gesture
   * (`unlock`). REQ-AUD-043/044/046.
   */
  onUnlockedChange?: (unlocked: boolean) => void;
}

/**
 * Thin wrapper around a single looping `Howl`. One instance lives for the
 * whole session (created by soundStore's attach); `syncTo()` is called
 * whenever the reactive track/volume state changes.
 */
export class AmbientPlayer {
  private _howl: Howl | null = null;
  private _state: AmbientTrackState = null;
  private _volume = 0.8;
  /** Bumped on every restart-worthy syncTo()/stop() call to invalidate stale async work. */
  private _generation = 0;
  private readonly _deps: AmbientPlayerDeps;

  constructor(deps: AmbientPlayerDeps = {}) {
    this._deps = deps;
  }

  /**
   * Best-effort current unlock state. `Howler.ctx` only exists once a Howl
   * has attempted to play, so this is optimistic (true) before that.
   *
   * @types/howler declares `ctx: AudioContext` (non-nullable), but howler's
   * own source initializes `self.ctx = null` and only creates the real
   * AudioContext lazily — the declaration doesn't reflect that. The disable
   * below keeps the defensive `?.` this runtime gap actually needs.
   */
  isUnlocked(): boolean {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return Howler.ctx?.state !== "suspended";
  }

  /**
   * Sync playback to the server-authoritative state + the local volume.
   *
   * Idempotent per `shouldRestart()`: calling again with the SAME state only
   * updates volume on the existing Howl. A genuinely new state tears down
   * the previous Howl (if any), resolves the asset URL, creates a new
   * looping Howl, and seeks it to the correct loop position once loaded.
   */
  async syncTo(state: AmbientTrackState, volume: number): Promise<void> {
    this._volume = volume;

    if (!shouldRestart(this._state, state)) {
      this._state = state;
      this._howl?.volume(volume);
      return;
    }

    const myGeneration = ++this._generation;
    this._destroyHowl();
    this._state = state;
    if (!state) return;

    const auth = this._deps.getAuth?.() ?? null;
    const url = auth ? await resolveAssetUrl(state.src, auth.accessToken, auth.userId) : state.src;

    // A later syncTo()/stop() call may have superseded this one while the
    // asset URL was resolving — bail out instead of reviving a stale track.
    if (myGeneration !== this._generation) return;

    const howl = new Howl({
      src: [url],
      loop: true,
      html5: false,
      volume: this._volume,
    });
    this._howl = howl;

    howl.once("load", () => {
      if (this._howl !== howl) return; // superseded after load resolved
      const offset = loopOffsetSeconds(state.startedAt, Date.now(), howl.duration());
      howl.seek(offset);
      howl.play();
    });

    // Autoplay blocked (REQ-AUD-043/044) — reflect it so the UI can show the
    // "click to enable audio" badge instead of silently doing nothing.
    howl.on("playerror", () => {
      this._deps.onUnlockedChange?.(false);
    });

    // Fires once this Howl's audio context unlocks on a user gesture
    // (REQ-AUD-046). Time passed while muted, so re-derive the loop offset.
    howl.once("unlock", () => {
      this._deps.onUnlockedChange?.(true);
      if (this._howl !== howl) return;
      const offset = loopOffsetSeconds(state.startedAt, Date.now(), howl.duration());
      howl.seek(offset);
    });
  }

  /** Apply a new local volume to the currently playing Howl, if any. */
  setVolume(volume: number): void {
    this._volume = volume;
    this._howl?.volume(volume);
  }

  /** Tear down playback and forget the current state. */
  stop(): void {
    this._generation++;
    this._destroyHowl();
    this._state = null;
  }

  private _destroyHowl(): void {
    if (this._howl) {
      this._howl.unload();
      this._howl = null;
    }
  }
}
