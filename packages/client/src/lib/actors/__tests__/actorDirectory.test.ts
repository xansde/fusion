/**
 * actorDirectory.test.ts — Unit tests for actor directory logic.
 *
 * REQ-UIF-002, REQ-UIF-044..046: actor list filtering, grouping, drag payload,
 * token-from-actor operation builder.
 */

import { describe, it, expect } from "vitest";
import {
  buildActorDirectory,
  buildActorDragPayload,
  buildTokenFromActorFields,
  type ActorDocument,
} from "../actorDirectory.js";
import { OwnershipLevel } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStats() {
  return {
    createdTime: 0,
    modifiedTime: 0,
    version: 1,
    lastModifiedBy: null,
    createdBy: null,
    coreVersion: "0.1.0",
    systemId: null,
    systemVersion: null,
    engineSchemaVersion: 1,
    systemSchemaVersion: null,
  };
}

function makeActor(
  id: string,
  name: string,
  type = "character",
  ownerUserId?: string,
  folder?: string,
): ActorDocument {
  const ownership: Record<string, number> = { default: OwnershipLevel.NONE };
  if (ownerUserId) {
    ownership[ownerUserId] = OwnershipLevel.OWNER;
  }
  return {
    _id: id,
    _stats: makeStats(),
    name,
    type,
    img: null,
    folder: folder ?? null,
    ownership,
    flags: {},
    sort: 0,
  };
}

// ---------------------------------------------------------------------------
// buildActorDragPayload
// ---------------------------------------------------------------------------

describe("buildActorDragPayload()", () => {
  it("sets kind to 'actor'", () => {
    const actor = makeActor("Aaaa0000000000a1", "Valeros");
    const payload = buildActorDragPayload(actor);
    expect(payload.kind).toBe("actor");
  });

  it("sets documentType to 'Actor'", () => {
    const actor = makeActor("Aaaa0000000000a1", "Valeros");
    const payload = buildActorDragPayload(actor);
    expect(payload.documentType).toBe("Actor");
  });

  it("sets uuid to actor._id", () => {
    const actor = makeActor("Aaaa0000000000a1", "Valeros");
    const payload = buildActorDragPayload(actor);
    expect(payload.uuid).toBe("Aaaa0000000000a1");
  });

  it("sets subtype from actor.type", () => {
    const actor = makeActor("Aaaa0000000000a1", "Goblin", "npc");
    const payload = buildActorDragPayload(actor);
    expect(payload.subtype).toBe("npc");
  });

  it("sets origin to sidebar", () => {
    const actor = makeActor("Aaaa0000000000a1", "Valeros");
    expect(buildActorDragPayload(actor).origin).toBe("sidebar");
  });

  it("sets img from actor.img", () => {
    const actor = makeActor("Aaaa0000000000a1", "Valeros");
    actor.img = "/assets/valeros.png";
    expect(buildActorDragPayload(actor).img).toBe("/assets/valeros.png");
  });

  it("sets img to null when actor has no img", () => {
    const actor = makeActor("Aaaa0000000000a1", "Anon");
    expect(buildActorDragPayload(actor).img).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildTokenFromActorFields
// ---------------------------------------------------------------------------

describe("buildTokenFromActorFields()", () => {
  const payload = buildActorDragPayload(makeActor("Aaaa0000000000a1", "Valeros", "character"));

  it("sets name from payload.name", () => {
    const fields = buildTokenFromActorFields({
      payload,
      sceneId: "SceneXXXXXXXXXXXX",
      x: 100,
      y: 200,
      gridSize: 100,
    });
    expect(fields.name).toBe("Valeros");
  });

  it("sets actorId from payload.uuid", () => {
    const fields = buildTokenFromActorFields({
      payload,
      sceneId: "SceneXXXXXXXXXXXX",
      x: 100,
      y: 200,
      gridSize: 100,
    });
    expect(fields.actorId).toBe("Aaaa0000000000a1");
  });

  it("snaps x/y to grid by default", () => {
    const fields = buildTokenFromActorFields({
      payload,
      sceneId: "SceneXXXXXXXXXXXX",
      x: 155,
      y: 248,
      gridSize: 100,
    });
    expect(fields.x).toBe(200); // round(155/100)*100
    expect(fields.y).toBe(200); // round(248/100)*100
  });

  it("does not snap when snapToGrid=false", () => {
    const fields = buildTokenFromActorFields({
      payload,
      sceneId: "SceneXXXXXXXXXXXX",
      x: 155,
      y: 248,
      gridSize: 100,
      snapToGrid: false,
    });
    expect(fields.x).toBe(155);
    expect(fields.y).toBe(248);
  });

  it("uses 1x1 footprint by default", () => {
    const fields = buildTokenFromActorFields({
      payload,
      sceneId: "SceneXXXXXXXXXXXX",
      x: 0,
      y: 0,
      gridSize: 100,
    });
    expect(fields.width).toBe(1);
    expect(fields.height).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildActorDirectory
// ---------------------------------------------------------------------------

describe("buildActorDirectory()", () => {
  const gmId = "gm00000000000001";
  const userId = "pl00000000000001";

  it("returns all actors for GM regardless of ownership", () => {
    const actors = [
      makeActor("A0000000000000a1", "Public Actor"),
      makeActor("A0000000000000a2", "Private Actor"), // default NONE ownership
    ];
    const dir = buildActorDirectory(actors, gmId, true);
    expect(dir.total).toBe(2);
  });

  it("filters actors by OBSERVER+ ownership for non-GMs", () => {
    const owned = makeActor("A0000000000000a1", "Mine", "character", userId);
    const notOwned = makeActor("A0000000000000a2", "Not Mine");
    const dir = buildActorDirectory([owned, notOwned], userId, false);
    expect(dir.total).toBe(1);
    expect(dir.groups[0]!.actors[0]!._id).toBe("A0000000000000a1");
  });

  it("filters by search query (case-insensitive)", () => {
    const actors = [
      makeActor("A0000000000000a1", "Valeros"),
      makeActor("A0000000000000a2", "Seelah"),
    ];
    const dir = buildActorDirectory(actors, gmId, true, "vale");
    expect(dir.total).toBe(1);
    expect(dir.groups[0]!.actors[0]!.name).toBe("Valeros");
  });

  it("returns empty groups when no actors match search", () => {
    const actors = [makeActor("A0000000000000a1", "Valeros")];
    const dir = buildActorDirectory(actors, gmId, true, "zzz");
    expect(dir.total).toBe(0);
    expect(dir.groups).toHaveLength(0);
  });

  it("groups actors by folder", () => {
    const actors = [
      makeActor("A0000000000000a1", "A in Folder 1", "character", undefined, "fold1"),
      makeActor("A0000000000000a2", "B in Folder 2", "character", undefined, "fold2"),
      makeActor("A0000000000000a3", "C no folder"),
    ];
    const dir = buildActorDirectory(actors, gmId, true);
    // 3 groups: fold1, fold2, null (no folder)
    expect(dir.groups).toHaveLength(3);
  });

  it("places null-folder actors in a group last", () => {
    const actors = [
      makeActor("A0000000000000a1", "In Folder", "character", undefined, "fold1"),
      makeActor("A0000000000000a2", "No Folder"),
    ];
    const dir = buildActorDirectory(actors, gmId, true);
    const last = dir.groups[dir.groups.length - 1]!;
    expect(last.folderId).toBeNull();
  });

  it("sorts actors alphabetically within a group", () => {
    const actors = [makeActor("A0000000000000a2", "Zebra"), makeActor("A0000000000000a1", "Apple")];
    const dir = buildActorDirectory(actors, gmId, true);
    const names = dir.groups[0]!.actors.map((a) => a.name);
    expect(names).toEqual(["Apple", "Zebra"]);
  });
});
