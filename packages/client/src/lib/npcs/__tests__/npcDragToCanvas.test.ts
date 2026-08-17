/**
 * npcDragToCanvas.test.ts — dragging a row onto the canvas (spec 42 §5.8, G076).
 *
 * REQ-NPC-063: dragging a line of the NPCs tab onto the canvas creates a presence
 * of that actor on the scene (REQ-UIF-044). The row already carries the drag
 * (G071); what this file proves is that the payload it writes is the one the
 * canvas reads, and that what the canvas builds from it is a presence OF THAT
 * ACTOR on the scene being looked at — not a copy of the sheet, not a second
 * actor.
 *
 * Deliberately NOT asserted: whether the presence is born linked or unlinked to
 * the actor (REQ-DOC-031..033). That is Q-NPC-03, pending on spec `41`, so the
 * test pins today's behaviour — the presence carries the actor's id and nothing
 * that decides the question — instead of freezing an answer this spec refuses to
 * give.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { NPC_DRAG_MIME, buildNpcDragPayload, readNpcDragPayload } from "../moveActor.js";
import { buildTokenFromActorFields } from "../../actors/actorDirectory.js";

const LOBO = {
  _id: "act-lobo00000001",
  name: "Lobo",
  type: "npc",
  img: "worlds/img/lobo.webp",
  folder: "fld-bosque0000001",
};

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

describe("REQ-NPC-063: dragging a row onto the canvas creates a presence", () => {
  it("REQ-NPC-063: the row writes the payload under the MIME the canvas reads", () => {
    const panel = source("../../../components/npcs/NpcsPanel.svelte");
    const table = source("../../../components/TableScreen.svelte");

    expect(NPC_DRAG_MIME).toBe("application/fusion-actor");
    // The row is draggable and writes on dragstart …
    expect(panel).toContain('draggable="true"');
    expect(panel).toContain("onNpcDragStart");
    expect(panel).toContain("NPC_DRAG_MIME");
    // … and the canvas reads that exact type on drop.
    expect(table).toContain('getData("application/fusion-actor")');
  });

  it("REQ-NPC-063: dragover accepts by advertised MIME type, never by reading the payload (getData is empty during dragover)", () => {
    // HTML5 drag data store is in protected mode during `dragover`: getData() returns "".
    // Deciding preventDefault() from the payload made the browser refuse every drop
    // (item A031 of the r1 review). The gate must look at dataTransfer.types.
    const table = source("../../../components/TableScreen.svelte");
    const start = table.indexOf("function handleCanvasDragOver(");
    const end = table.indexOf("function handleCanvasDrop(");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const dragOver = table.slice(start, end);
    expect(dragOver).not.toContain("getData(");
    expect(dragOver).not.toContain("_getActorDragPayload(");
    expect(dragOver).toContain("_dragCarriesKnownType(event)");
    expect(table).toContain('.includes("application/fusion-actor")');
  });

  it("REQ-NPC-063: the payload the row writes survives the trip and names the actor", () => {
    const wire = JSON.stringify(buildNpcDragPayload(LOBO));
    const payload = readNpcDragPayload(wire);

    expect(payload).not.toBeNull();
    expect(payload?.uuid).toBe("act-lobo00000001");
    expect(payload?.documentType).toBe("Actor");
    expect(payload?.name).toBe("Lobo");
    expect(payload?.img).toBe("worlds/img/lobo.webp");
  });

  it("REQ-NPC-063: what lands on the scene is a presence of that actor, snapped to the grid", () => {
    const payload = readNpcDragPayload(JSON.stringify(buildNpcDragPayload(LOBO)));
    expect(payload).not.toBeNull();

    const fields = buildTokenFromActorFields({
      payload: {
        kind: "actor",
        uuid: payload!.uuid,
        documentType: "Actor",
        subtype: payload!.subtype,
        name: payload!.name,
        img: payload!.img,
        origin: "sidebar",
      },
      sceneId: "scn-clareira001",
      x: 317,
      y: 642,
      gridSize: 100,
    });

    expect(fields.actorId).toBe("act-lobo00000001");
    expect(fields.name).toBe("Lobo");
    expect(fields.texture).toBe("worlds/img/lobo.webp");
    expect(fields).toMatchObject({ x: 300, y: 600 });
    // Q-NPC-03 is not answered here: nothing in the presence says linked or not.
    expect(Object.keys(fields)).not.toContain("actorLink");
  });

  it("REQ-NPC-063: the drop creates the presence on the scene through a payload the server accepts", () => {
    const table = source("../../../components/TableScreen.svelte");
    const dropFnStart = table.indexOf("function handleCanvasDrop");
    expect(dropFnStart).toBeGreaterThan(-1);
    const dropFn = table.slice(dropFnStart);

    // Isolate the actor-drag branch only. handleCanvasDrop also has a
    // compendium-drag branch right below it that builds the very same
    // doc:create/Token shape — slicing to EOF would let a deleted actor
    // branch hide undetected behind the compendium one.
    const actorBranchStart = dropFn.indexOf("const actorPayload = _getActorDragPayload(event);");
    const compBranchStart = dropFn.indexOf("const compPayload = _getCompendiumDragPayload(event);");
    expect(actorBranchStart).toBeGreaterThan(-1);
    expect(compBranchStart).toBeGreaterThan(actorBranchStart);
    const drop = dropFn.slice(actorBranchStart, compBranchStart);

    expect(drop).toContain("buildTokenFromActorFields");
    // A004 review (REQ-NPC-063, REQ-CPD-062): the wire shape is built by
    // `buildCreateTokenFromActorOp` — `data: [fields]` + `parent: { type:
    // "Scene", id }` — matching `DocCreatePayloadSchema`
    // (`packages/shared/src/protocol.ts`), and sent through `sendOp` so a
    // server refusal is awaited and surfaced (REQ-CPD-060) instead of a
    // fire-and-forget `sock.emit` that swallows a VALIDATION_FAILED ack.
    expect(drop).toContain("buildCreateTokenFromActorOp(fields, scene._id)");
    expect(drop).toContain("await sendOp(sock,");
    // The old broken shape — `documentType`/`embedded`/`documents` built
    // inline — must be gone: `DocCreatePayloadSchema` has never accepted
    // `embedded`/`documents`, only `data` (required) and an optional `parent`.
    expect(drop).not.toContain("embedded:");
    expect(drop).not.toContain("documents:");
    expect(drop).not.toContain('sock.emit("op"');
  });
});
