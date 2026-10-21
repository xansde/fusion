/**
 * Ambient table track — the world-wide background audio loop (M3).
 *
 * Scope (discovery D2/D3): one track at a time, chosen by the GM from the
 * world asset library; the server broadcasts the COMMAND (never audio bytes)
 * and every client plays the asset locally, each with its own local volume.
 *
 * Not to be confused with the spec-13 `AmbientSound` canvas placeable
 * (radius/falloff emitter), which is a separate future feature.
 */
import { z } from "zod";

/**
 * A track src is the bare asset file name served by `GET /assets/<name>` —
 * never a path. Only the audio formats the upload gate accepts (spec 20).
 */
export const AMBIENT_TRACK_SRC_PATTERN = /^[^/\\]+\.(mp3|ogg)$/i;

export const AmbientTrackSrcSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(AMBIENT_TRACK_SRC_PATTERN, "src must be a bare .mp3/.ogg asset name");

/**
 * Server-authoritative playback state; `null` means silence.
 *
 * The track always loops. Late joiners derive the loop position locally:
 * `((now - startedAt) / 1000) % duration` (REQ-AUD-022 tolerance ±2s).
 */
export const AmbientTrackStateSchema = z
  .object({
    /** Asset name in the world library (served via `/assets/<src>`). */
    src: AmbientTrackSrcSchema,
    /** Server epoch ms at the moment playback started. */
    startedAt: z.number().int().nonnegative(),
  })
  .nullable();

export type AmbientTrackState = z.infer<typeof AmbientTrackStateSchema>;

/** `sound:play` — GM/Assistant starts looping a library track for everyone. */
export const SoundPlayPayloadSchema = z.object({
  src: AmbientTrackSrcSchema,
});

export type SoundPlayPayload = z.infer<typeof SoundPlayPayloadSchema>;

/** `sound:stop` — GM/Assistant silences the table. */
export const SoundStopPayloadSchema = z.object({});

export type SoundStopPayload = z.infer<typeof SoundStopPayloadSchema>;

/** `sound:state` — server broadcast after every accepted play/stop. */
export const SoundStatePayloadSchema = z.object({
  state: AmbientTrackStateSchema,
});

export type SoundStatePayload = z.infer<typeof SoundStatePayloadSchema>;
