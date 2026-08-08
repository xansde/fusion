import { describe, expect, it } from "vitest";

import {
  AmbientTrackStateSchema,
  EnvelopeTypeSchema,
  SoundPlayPayloadSchema,
  SoundStatePayloadSchema,
  SoundStopPayloadSchema,
  WorldSnapshotPayloadSchema,
} from "../index.js";

describe("sound protocol contract (M3 mapa-som)", () => {
  describe("envelope types", () => {
    it.each(["sound:play", "sound:stop", "sound:state"])("accepts %s", (type) => {
      expect(EnvelopeTypeSchema.safeParse(type).success).toBe(true);
    });
  });

  describe("SoundPlayPayloadSchema", () => {
    it("accepts a bare .mp3 asset name", () => {
      expect(SoundPlayPayloadSchema.safeParse({ src: "tavern-theme.mp3" }).success).toBe(true);
    });

    it("accepts a bare .ogg asset name, case-insensitive", () => {
      expect(SoundPlayPayloadSchema.safeParse({ src: "Storm.OGG" }).success).toBe(true);
    });

    it("rejects path traversal with forward slashes", () => {
      expect(SoundPlayPayloadSchema.safeParse({ src: "../secret/track.mp3" }).success).toBe(false);
    });

    it("rejects path traversal with backslashes", () => {
      expect(SoundPlayPayloadSchema.safeParse({ src: "..\\track.mp3" }).success).toBe(false);
    });

    it("rejects non-audio extensions the upload gate does not accept", () => {
      expect(SoundPlayPayloadSchema.safeParse({ src: "track.wav" }).success).toBe(false);
      expect(SoundPlayPayloadSchema.safeParse({ src: "map.png" }).success).toBe(false);
    });

    it("rejects an empty src", () => {
      expect(SoundPlayPayloadSchema.safeParse({ src: "" }).success).toBe(false);
    });
  });

  describe("SoundStopPayloadSchema", () => {
    it("accepts an empty payload", () => {
      expect(SoundStopPayloadSchema.safeParse({}).success).toBe(true);
    });
  });

  describe("AmbientTrackStateSchema", () => {
    it("accepts a playing state with src and startedAt", () => {
      const parsed = AmbientTrackStateSchema.safeParse({
        src: "dungeon-drone.ogg",
        startedAt: 1_754_000_000_000,
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts null (silence)", () => {
      expect(AmbientTrackStateSchema.safeParse(null).success).toBe(true);
    });

    it("rejects a negative startedAt", () => {
      expect(
        AmbientTrackStateSchema.safeParse({ src: "a.mp3", startedAt: -1 }).success,
      ).toBe(false);
    });
  });

  describe("SoundStatePayloadSchema", () => {
    it("wraps a playing state", () => {
      const parsed = SoundStatePayloadSchema.safeParse({
        state: { src: "a.mp3", startedAt: 123 },
      });
      expect(parsed.success).toBe(true);
    });

    it("wraps silence as state: null", () => {
      expect(SoundStatePayloadSchema.safeParse({ state: null }).success).toBe(true);
    });
  });

  describe("WorldSnapshotPayloadSchema.ambientTrack", () => {
    const base = { seq: 0, activeSceneId: null, documents: {} };

    it("remains valid without the field (pre-M3 snapshots)", () => {
      expect(WorldSnapshotPayloadSchema.safeParse(base).success).toBe(true);
    });

    it("carries the current track for late joiners", () => {
      const parsed = WorldSnapshotPayloadSchema.safeParse({
        ...base,
        ambientTrack: { src: "a.ogg", startedAt: 1 },
      });
      expect(parsed.success).toBe(true);
    });

    it("carries explicit silence as null", () => {
      expect(
        WorldSnapshotPayloadSchema.safeParse({ ...base, ambientTrack: null }).success,
      ).toBe(true);
    });
  });
});
