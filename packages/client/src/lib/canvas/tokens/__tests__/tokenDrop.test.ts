/**
 * tokenDrop.test.ts — verifies buildTokenDropPayload() always produces a
 * payload DocCreatePayloadSchema.parse() accepts.
 *
 * Regression guard for the bug fixed in TableScreen.svelte's handleCanvasDrop:
 * the previous hand-rolled envelope used `embedded`/`documents` instead of
 * `parent`/`data`, so the server rejected every actor-drop-to-token creation
 * with VALIDATION_FAILED — silently, because the emit had no ack callback.
 */

import { describe, it, expect } from "vitest";
import { DocCreatePayloadSchema } from "@fusion/shared";
import type { ActorDragPayload } from "../../../actors/actorDirectory.js";
import { buildTokenDropPayload } from "../tokenDrop.js";

function actorPayload(overrides: Partial<ActorDragPayload> = {}): ActorDragPayload {
  return {
    kind: "actor",
    uuid: "actor0000000001",
    documentType: "Actor",
    subtype: "npc",
    name: "Goblin",
    img: "/assets/goblin.webp",
    origin: "sidebar",
    ...overrides,
  };
}

describe("buildTokenDropPayload", () => {
  it("produces a payload that satisfies DocCreatePayloadSchema", () => {
    const payload = buildTokenDropPayload({
      payload: actorPayload(),
      sceneId: "scene0000000001",
      x: 123,
      y: 456,
      gridSize: 100,
    });

    const result = DocCreatePayloadSchema.safeParse(payload);
    expect(result.success, `DocCreatePayload parse failed: ${JSON.stringify(result)}`).toBe(true);
  });

  it("sets documentType to Token and parent to the Scene", () => {
    const payload = buildTokenDropPayload({
      payload: actorPayload(),
      sceneId: "scene0000000001",
      x: 0,
      y: 0,
      gridSize: 100,
    });

    expect(payload.documentType).toBe("Token");
    expect(payload.parent).toEqual({ type: "Scene", id: "scene0000000001" });
  });

  it("wraps the token fields in a single-element data array", () => {
    const payload = buildTokenDropPayload({
      payload: actorPayload({ name: "Ogre", uuid: "actor0000000002", img: null }),
      sceneId: "scene0000000001",
      x: 250,
      y: 250,
      gridSize: 100,
    });

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({
      name: "Ogre",
      actorId: "actor0000000002",
      texture: null,
      width: 1,
      height: 1,
    });
  });

  it("snaps the drop coordinates to the grid (same logic as buildTokenFromActorFields)", () => {
    const payload = buildTokenDropPayload({
      payload: actorPayload(),
      sceneId: "scene0000000001",
      x: 123,
      y: 178,
      gridSize: 100,
    });

    expect(payload.data[0]).toMatchObject({ x: 100, y: 200 });
  });

  it("passes through for a compendium-imported actor (no snap when gridSize is 0)", () => {
    const payload = buildTokenDropPayload({
      payload: actorPayload({ name: "Imported Actor" }),
      sceneId: "scene0000000001",
      x: 42,
      y: 84,
      gridSize: 0,
    });

    const result = DocCreatePayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    expect(payload.data[0]).toMatchObject({ x: 42, y: 84 });
  });
});
