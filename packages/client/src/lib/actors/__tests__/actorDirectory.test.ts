/**
 * actorDirectory.test.ts — what survived the burial of the Actors directory (G078).
 *
 * REQ-UIF-044..046: the drag payload an actor row puts on a drag and the presence
 * built from it when the drop lands on the canvas.
 *
 * The list/filter/group half went with the panel (its tests with it): ownership
 * filtering is `lib/contacts/contactsVM.ts` and folder grouping is
 * `lib/npcs/folderTree.ts`, each with its own suite.
 */

import { describe, it, expect } from "vitest";
import {
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
