/**
 * compendium:import announces the documents it creates on the ordinary `doc:create` channel, so the
 * NPCs panel (and every mirror) shows an imported NPC at once instead of after a reload.
 */
import { describe, expect, it, vi } from "vitest";
import type { Namespace } from "socket.io";
import { buildCompendiumImportHandler } from "../handlers.js";
import { OpBuffer } from "../../net/op-buffer.js";

function setup() {
  const gmEmit = vi.fn();
  const ns = {
    emit: vi.fn(),
    to: vi.fn(() => ({ emit: vi.fn() })),
    sockets: new Map([["gm", { data: { role: 4, userId: "gm" }, emit: gmEmit }]]),
  } as unknown as Namespace;
  const opBuffer = new OpBuffer();
  let seq = 10;
  const importToWorld = vi.fn(() => ({
    created: ["npc-1"],
    failed: [],
    createdDocs: [{ documentType: "Actor", doc: { _id: "npc-1", name: "Eagle", type: "npc" } }],
  }));
  const handler = buildCompendiumImportHandler({
    compendium: { importToWorld },
    db: {},
    ns,
    seqStore: { next: () => ++seq },
    opBuffer,
  } as never);
  return { handler, gmEmit, opBuffer };
}

describe("compendium:import", () => {
  it("emits a doc:create op carrying the created document and keeps it out of the ack", async () => {
    const { handler, gmEmit } = setup();
    const ack = await handler({ uuids: ["Compendium.x.y"] }, {
      role: 4,
      userId: "gm",
      worldId: "w",
    } as never);
    expect(ack).toMatchObject({ ok: true, result: { created: ["npc-1"], failed: [] } });
    expect((ack as { result: Record<string, unknown> }).result).not.toHaveProperty("createdDocs");
    const ops = gmEmit.mock.calls.filter((c) => c[0] === "op").map((c) => c[1]);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      type: "doc:create",
      seq: 11,
      payload: { documentType: "Actor", documents: [{ _id: "npc-1" }] },
    });
  });
});
