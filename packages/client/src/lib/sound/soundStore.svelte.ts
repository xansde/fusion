/**
 * soundStore.svelte.ts — Svelte 5 runes reactive store for the ambient table
 * track (M3 mapa-som).
 *
 * Mirrors the shape of packages/client/src/lib/combat/combatStore.svelte.ts:
 *   - `$state` module-level reactive state.
 *   - `attachSoundSync(socket)` registers its own `socket.on("op", ...)`
 *     listener filtered by `envelope.type`, and returns a cleanup function.
 *   - Actions (`soundActions.play/stop`) go through `sendOp`.
 *
 * The actual Howl instance lives in ambientPlayer.ts (no Svelte state there);
 * this module wires the two together via a Svelte `$effect` that reacts to
 * `soundStore.track`/`soundStore.volume` — set up lazily inside
 * `attachSoundSync()`, NOT at module load time, so importing this module
 * (e.g. from a test that only exercises the pure reducers below) never
 * touches Howler/AudioContext.
 *
 * Snapshot / late joiner: the world snapshot's optional `ambientTrack` field
 * (absent = null, see packages/shared/src/protocol.ts) is applied via
 * `applyAmbientTrackSnapshot()`, called from worldSync.ts's `_applySnapshot`
 * — the same path `activeScene.svelte.ts`'s `setActiveSceneId` is fed
 * through for the active scene.
 *
 * Contract: packages/shared/src/sound/types.ts (immutable — see project
 * CLAUDE.md).
 */

import type { Socket } from "socket.io-client";
import type { AmbientTrackState, SoundStatePayload } from "@fusion/shared";
import { sendOp } from "../docs/sendOp.js";
import { AmbientPlayer, type AmbientPlayerAuth } from "./ambientPlayer.js";

// ---------------------------------------------------------------------------
// Volume persistence (pure — unit tested with a fake Storage)
// ---------------------------------------------------------------------------

export const VOLUME_STORAGE_KEY = "fusion.audio.volume.music";
export const DEFAULT_VOLUME = 0.8;

/** Clamp a volume value into the valid [0, 1] range. NaN/Infinity → default. */
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, value));
}

/**
 * Read the persisted local volume from `storage`. Falls back to
 * `DEFAULT_VOLUME` for a missing key, a non-numeric value, or a storage that
 * throws (private-mode Safari, quota errors, or simply absent — `storage`
 * itself may be null).
 */
export function loadStoredVolume(storage: Pick<Storage, "getItem"> | null | undefined): number {
  if (!storage) return DEFAULT_VOLUME;
  try {
    const raw = storage.getItem(VOLUME_STORAGE_KEY);
    if (raw === null) return DEFAULT_VOLUME;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampVolume(parsed) : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

/** Persist a (clamped) local volume to `storage`. Silently no-ops on failure. */
export function saveStoredVolume(
  storage: Pick<Storage, "setItem"> | null | undefined,
  value: number,
): void {
  if (!storage) return;
  try {
    storage.setItem(VOLUME_STORAGE_KEY, String(clampVolume(value)));
  } catch {
    // Storage unavailable (private mode, quota) — non-fatal; the in-memory
    // value still applies for the rest of this session.
  }
}

/** `localStorage` accessor guarded for non-browser environments (SSR, tests). */
function _localStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// FilePicker → ambient src extraction (pure — unit tested directly)
// ---------------------------------------------------------------------------

/**
 * Matches our own `/assets/<name>` static route at the start of a path.
 *
 * Expressed as a regex, not `startsWith("/assets/")`, for the same reason
 * `LOCAL_ASSET_PATH_RE` in assets/assetApi.ts is — a bare double-quoted
 * `"/assets/"` string literal survives minification into the built chunk,
 * and packages/server/src/spa/__tests__/routes.test.ts asserts that no built
 * JS chunk embeds one (a guard against a hashed Vite chunk resolving to the
 * world's asset-upload route instead of assets-client/). This prefix check
 * has nothing to do with Vite chunk loading, but it would still trip the
 * guard's letter, so it avoids the literal.
 */
const ASSET_PATH_RE = /^\/assets\//;

/**
 * Extract the bare filename `sound:play` needs (AmbientTrackSrcSchema — no
 * slashes) from what FilePicker's `onSelect` hands back.
 *
 * FilePicker returns either a `/assets/<name>` library path or an arbitrary
 * external URL (its "paste a URL" fallback). Only the former can ever be a
 * valid ambient track src — an external URL, or a nested/traversal path,
 * returns null so the caller can surface a rejection instead of sending a
 * `sound:play` the server will reject anyway.
 */
export function extractAmbientSrc(pickerPath: string): string | null {
  if (!ASSET_PATH_RE.test(pickerPath)) return null;
  const rest = pickerPath.replace(ASSET_PATH_RE, "");
  if (rest.length === 0 || rest.includes("/")) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

export const soundStore: {
  /** Server-authoritative ambient track state, or null when the table is silent. */
  track: AmbientTrackState;
  /** Local playback volume [0, 1], persisted in localStorage. Never sent to the server. */
  volume: number;
  /**
   * Whether local audio playback is unlocked (a user gesture has resolved
   * the browser's autoplay policy). Starts optimistic — the player corrects
   * it via `playerror`/`unlock` once it knows for sure. REQ-AUD-043/044/046.
   */
  unlocked: boolean;
} = $state({
  track: null,
  volume: loadStoredVolume(_localStorage()),
  unlocked: true,
});

// ---------------------------------------------------------------------------
// Reducers (pure mutations of soundStore — unit tested directly)
// ---------------------------------------------------------------------------

/** Apply a `sound:state` broadcast payload. */
export function applySoundState(payload: SoundStatePayload): void {
  soundStore.track = payload.state;
}

/**
 * Apply the world snapshot's `ambientTrack` field (late joiner / full
 * resync). Absent (`undefined`, pre-M3 snapshots) is treated as null —
 * matches the schema's documented contract.
 */
export function applyAmbientTrackSnapshot(ambientTrack: AmbientTrackState | undefined): void {
  soundStore.track = ambientTrack ?? null;
}

// ---------------------------------------------------------------------------
// Player wiring — created lazily by attachSoundSync(), never at module load
// ---------------------------------------------------------------------------

let _player: AmbientPlayer | null = null;
let _stopPlayerEffect: (() => void) | null = null;

/**
 * Create the AmbientPlayer + the $effect that keeps it synced to
 * soundStore.track/volume, exactly once per app lifetime. Idempotent: a
 * second call while already wired is a no-op (returns the existing
 * teardown), same guard shape as SocketManager.connect() reusing a live
 * socket.
 *
 * `getAuth` is passed in by the caller (session.svelte.ts) rather than
 * imported from session.svelte.ts here — this module is imported by
 * worldSync.ts (for the snapshot path), and session.svelte.ts imports
 * worldSync.ts, so importing session.svelte.ts here would close a cycle.
 * See ambientPlayer.ts's module doc for the full chain.
 */
function _ensurePlayerWiring(getAuth: (() => AmbientPlayerAuth | null) | undefined): () => void {
  if (_player && _stopPlayerEffect) return _stopPlayerEffect;

  const player = new AmbientPlayer({
    // Spread conditionally (exactOptionalPropertyTypes): an explicit
    // `getAuth: undefined` is a type error against an optional property,
    // so the key must be OMITTED entirely when no getAuth was supplied.
    ...(getAuth ? { getAuth } : {}),
    onUnlockedChange: (unlocked) => {
      soundStore.unlocked = unlocked;
    },
  });
  _player = player;
  soundStore.unlocked = player.isUnlocked();

  // $effect.root: this runs at attach time (from session lifecycle), not at
  // component render — same pattern combatStore.svelte.ts uses for its
  // module-level activeSceneState effect.
  _stopPlayerEffect = $effect.root(() => {
    $effect(() => {
      const track = soundStore.track;
      const volume = soundStore.volume;
      void player.syncTo(track, volume);
    });
  });

  return _stopPlayerEffect;
}

// ---------------------------------------------------------------------------
// Socket sync (mirrors combatStore.svelte.ts's attachCombatSync)
// ---------------------------------------------------------------------------

/**
 * Attach sound socket event listeners AND wire the AmbientPlayer to the
 * reactive state. Returns a cleanup function.
 *
 * @param socket   Connected socket.
 * @param getAuth  Resolves the current accessToken/userId for asset URL
 *                 resolution — forwarded to AmbientPlayer. Passed in by the
 *                 caller (session.svelte.ts) to keep this module free of a
 *                 direct session.svelte.ts import (see ambientPlayer.ts's
 *                 module doc for why that would cycle back through
 *                 worldSync.ts). Omit only in tests that don't exercise
 *                 playback.
 *
 * Call from session setup (after worldSync is attached) — see
 * session.svelte.ts's `_connectSocket`.
 */
export function attachSoundSync(
  socket: Socket,
  getAuth?: () => AmbientPlayerAuth | null,
): () => void {
  // Wires the AmbientPlayer once, session-lifetime — recreating it on every
  // reconnect would drop in-flight playback. Intentionally NOT torn down by
  // this function's own cleanup (see below); only the socket listener is.
  _ensurePlayerWiring(getAuth);

  const onOp = (envelope: { type: string; payload: unknown }) => {
    if (envelope.type === "sound:state") {
      applySoundState(envelope.payload as SoundStatePayload);
    }
  };

  socket.on("op", onOp);
  return () => {
    socket.off("op", onOp);
  };
}

// ---------------------------------------------------------------------------
// Actions — emit via sendOp (mirrors combatStore.svelte.ts's combatActions)
// ---------------------------------------------------------------------------

export const soundActions = {
  /**
   * GM/Assistant starts looping a library track for everyone.
   * `src` must be a bare asset filename (AmbientTrackSrcSchema) — callers
   * pass the FilePicker/asset-grid selection, never a `/assets/...` path.
   * Throws {@link OpError} on ack failure/timeout; callers surface it inline.
   */
  async play(socket: Socket, src: string): Promise<void> {
    await sendOp<{ state: AmbientTrackState }>(socket, {
      type: "sound:play",
      payload: { src },
    });
  },

  /** GM/Assistant silences the table. Throws {@link OpError} on failure. */
  async stop(socket: Socket): Promise<void> {
    await sendOp<{ state: AmbientTrackState }>(socket, {
      type: "sound:stop",
      payload: {},
    });
  },

  /** Update the local playback volume (never sent to the server) and persist it. */
  setVolume(value: number): void {
    const clamped = clampVolume(value);
    soundStore.volume = clamped;
    saveStoredVolume(_localStorage(), clamped);
  },
};
