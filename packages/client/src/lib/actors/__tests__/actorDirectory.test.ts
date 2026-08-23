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
  buildActorDropTokenOp,
  type ActorDocument,
} from "../actorDirectory.js";
import { OwnershipLevel, DocCreatePayloadSchema } from "@fusion/shared";

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

  it("sets _id to actor._id — never a uuid (#170)", () => {
    const actor = makeActor("Aaaa0000000000a1", "Valeros");
    const payload = buildActorDragPayload(actor);
    expect(payload._id).toBe("Aaaa0000000000a1");
    expect(payload).not.toHaveProperty("uuid");
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

  // REQ-TOK-010, REQ-TOK-012, REQ-TOK-060: the fields a token no longer
  // carries — no fixed name (it inherits the actor's), no art/footprint of
  // its own — must not reappear here as the token schema evolves.
  it("carries no name, texture, width or height — the token inherits those from the actor", () => {
    const fields = buildTokenFromActorFields({
      payload,
      sceneId: "SceneXXXXXXXXXXXX",
      x: 0,
      y: 0,
      gridSize: 100,
    });
    expect(fields).not.toHaveProperty("name");
    expect(fields).not.toHaveProperty("texture");
    expect(fields).not.toHaveProperty("width");
    expect(fields).not.toHaveProperty("height");
    expect(Object.keys(fields).sort()).toEqual(["actorId", "x", "y"]);
  });

  it("sets actorId from payload._id", () => {
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
});

// ---------------------------------------------------------------------------
// buildActorDropTokenOp (ajustes r1 A004 review — REQ-NPC-063, REQ-CPD-062 —
// composed with the spec-41 token form, TK022-client)
// ---------------------------------------------------------------------------

describe("buildActorDropTokenOp() — REQ-NPC-063 / REQ-CPD-062: the drop payload the server accepts", () => {
  const payload = buildActorDragPayload(makeActor("Aaaa0000000000a1", "Valeros", "character"));
  const opts = {
    payload,
    sceneId: "SceneXXXXXXXXXXXX",
    x: 100,
    y: 200,
    gridSize: 100,
  };
  const fields = buildTokenFromActorFields(opts);

  it("builds a doc:create of Token, embedded under the scene as parent", () => {
    const op = buildActorDropTokenOp(opts);
    expect(op.type).toBe("doc:create");
    expect(op.payload.documentType).toBe("Token");
    expect(op.payload.data).toEqual([fields]);
    expect(op.payload.parent).toEqual({ type: "Scene", id: "SceneXXXXXXXXXXXX" });
  });

  it("satisfies DocCreatePayloadSchema — the real wire contract the server parses", () => {
    const op = buildActorDropTokenOp(opts);
    const result = DocCreatePayloadSchema.safeParse(op.payload);
    expect(result.success).toBe(true);
  });

  it("REQ-TOK-010/012/022: the wire payload carries nothing the server derives or refuses", () => {
    // §7.2 DERIVED/REFUSED: `validateTokenCreateContract`
    // (packages/server/src/tokens/tokenValidation.ts) answers VALIDATION_FAILED
    // to any of these, so a drop that smuggled one in would land nothing at all.
    const created = buildActorDropTokenOp(opts).payload.data[0] as Record<string, unknown>;
    for (const derived of ["width", "height", "texture", "img", "ownership", "userId"]) {
      expect(created).not.toHaveProperty(derived);
    }
    expect(created).not.toHaveProperty("actorDelta");
    expect(created).not.toHaveProperty("name");
    expect(created).not.toHaveProperty("_id");
    expect(created["actorId"]).toBe("Aaaa0000000000a1");
  });

  it("REQ-NPC-063/REQ-CPD-062 regression: the OLD payload shape TableScreen.svelte sent — `embedded`/`documents` instead of `data`/`parent` — is rejected by the same schema", () => {
    const oldShapePayload = {
      documentType: "Token",
      embedded: { type: "Token", sceneId: "SceneXXXXXXXXXXXX" },
      documents: [fields],
    };
    const result = DocCreatePayloadSchema.safeParse(oldShapePayload);
    expect(result.success).toBe(false);
  });
});
