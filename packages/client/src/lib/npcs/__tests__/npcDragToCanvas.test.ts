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

import { DocCreatePayloadSchema } from "@fusion/shared";

import { NPC_DRAG_MIME, buildNpcDragPayload, readNpcDragPayload } from "../moveActor.js";
import { buildActorDropTokenOp, buildTokenFromActorFields } from "../../actors/actorDirectory.js";

const LOBO = {
  _id: "act-lobo00000001",
  name: "Lobo",
  type: "npc",
  img: "worlds/img/lobo.webp",
  folder: "fld-bosque0000001",
};

/**
 * Source with every comment removed (same helper as `npcsFooter.test.ts`), so prose
 * ABOUT a call is never read as the call itself. Required here: the resolved
 * `handleCanvasDragOver` explains in a comment why `getData()` cannot be used during
 * `dragover`, and a naive read would then see "getData(" inside the very function the
 * A031 assertion proves is free of it.
 */
function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
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

  it("REQ-NPC-063 / REQ-UIF-045 (A031): dragover accepts by advertised MIME type, never by reading the payload (getData is empty during dragover)", () => {
    // HTML5 drag data store is in protected mode during `dragover`: getData() returns "".
    // Deciding preventDefault() from the payload made the browser refuse every drop
    // (item A031 of the r1 review). The gate must look at dataTransfer.types — which
    // is what `hasActorDragType`/`hasCompendiumDragType` (lib/canvas/canvasDragTypes.ts)
    // do, and the reason the predicates live in a module of their own instead of inline
    // in the component: canvasDragTypes.test.ts exercises the rule directly.
    const table = source("../../../components/TableScreen.svelte");
    const start = table.indexOf("function handleCanvasDragOver(");
    const end = table.indexOf("function handleCanvasDrop(");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const dragOver = table.slice(start, end);
    expect(dragOver).not.toContain("getData(");
    expect(dragOver).not.toContain("_getActorDragPayload(");
    expect(dragOver).toContain("hasActorDragType(event.dataTransfer)");
    expect(dragOver).toContain("hasCompendiumDragType(event.dataTransfer)");

    // … and the predicates themselves decide from `.types`, never from `getData()`.
    // `NPC_DRAG_MIME` is pinned to "application/fusion-actor" by the first test above.
    const dragTypes = source("../../canvas/canvasDragTypes.ts");
    expect(dragTypes).not.toContain("getData(");
    expect(dragTypes).toContain(".types.includes(NPC_DRAG_MIME)");
    expect(dragTypes).toContain('.types.includes("text/plain")');
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
    expect(fields).toMatchObject({ x: 300, y: 600 });
    // TK023 (REQ-TOK-010, REQ-TOK-012, REQ-TOK-060): the presence carries no
    // name or art of its own — it inherits both from the actor by `actorId`,
    // it does not duplicate "Lobo" / the wolf's img here.
    expect(fields).not.toHaveProperty("name");
    expect(fields).not.toHaveProperty("texture");
    // Q-NPC-03 is not answered here: nothing in the presence says linked or not.
    expect(Object.keys(fields)).not.toContain("actorLink");
  });

  it("REQ-NPC-063: the drop wires the actor-drag branch through buildActorDropTokenOp", () => {
    const table = source("../../../components/TableScreen.svelte");
    const dropFnStart = table.indexOf("function handleCanvasDrop");
    expect(dropFnStart).toBeGreaterThan(-1);
    const dropFn = table.slice(dropFnStart);

    // Isolate the actor-drag branch only. handleCanvasDrop also has a
    // compendium-drag branch right below it that builds the very same
    // doc:create/Token/embedded shape — slicing to EOF would let a deleted
    // actor branch hide undetected behind the compendium one.
    const actorBranchStart = dropFn.indexOf("const actorPayload = _getActorDragPayload(event);");
    const compBranchStart = dropFn.indexOf("const compPayload = _getCompendiumDragPayload(event);");
    expect(actorBranchStart).toBeGreaterThan(-1);
    expect(compBranchStart).toBeGreaterThan(actorBranchStart);
    const drop = dropFn.slice(actorBranchStart, compBranchStart);

    // TK022-client: the branch hands the drop straight to the shared
    // buildActorDropTokenOp (packages/client/src/lib/actors/actorDirectory.ts)
    // and sends its result verbatim — this only proves the WIRING calls the
    // real function; the next test proves what that function actually emits.
    expect(drop).toContain("buildActorDropTokenOp(");
    // A004 review (REQ-NPC-063, REQ-CPD-060): sent through `sendOp` so a server
    // refusal is AWAITED and surfaced to the Master, never a fire-and-forget
    // `sock.emit` that swallows a VALIDATION_FAILED ack.
    expect(drop).toContain("await sendOp(sock, op)");
    expect(drop).not.toContain('sock.emit("op"');
    // The old broken shape — `documentType`/`embedded`/`documents` built inline —
    // must be gone: `DocCreatePayloadSchema` has never accepted `embedded`/
    // `documents`, only `data` (required) and an optional `parent`.
    expect(drop).not.toContain("embedded:");
    expect(drop).not.toContain("documents:");
  });

  it("REQ-NPC-063: what buildActorDropTokenOp emits is a doc:create the server accepts", () => {
    const op = buildActorDropTokenOp({
      payload: {
        kind: "actor",
        uuid: LOBO._id,
        documentType: "Actor",
        subtype: "npc",
        name: LOBO.name,
        img: LOBO.img,
        origin: "sidebar",
      },
      sceneId: "scn-clareira001",
      x: 317,
      y: 642,
      gridSize: 100,
    });

    // The exact payload the socket carries — not the source text that builds
    // it — is what has to satisfy the server's wire schema (spec 41 §7.2).
    const result = DocCreatePayloadSchema.safeParse(op.payload);
    expect(result.success, `DocCreatePayload parse failed: ${JSON.stringify(result)}`).toBe(true);

    expect(op.type).toBe("doc:create");
    expect(op.payload.documentType).toBe("Token");
    expect(op.payload.parent).toEqual({ type: "Scene", id: "scn-clareira001" });

    const created = op.payload.data[0] as Record<string, unknown>;
    expect(created["actorId"]).toBe(LOBO._id);
    expect(created).toMatchObject({ x: 300, y: 600 });
    // TK023 (REQ-TOK-010, REQ-TOK-012, REQ-TOK-060): still no name/art of its
    // own once it is the actual wire payload, not just the fields object.
    expect(created).not.toHaveProperty("name");
    expect(created).not.toHaveProperty("texture");
    expect(Object.keys(created)).not.toContain("actorLink");
  });
});
