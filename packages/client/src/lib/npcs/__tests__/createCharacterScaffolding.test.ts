/**
 * createCharacterScaffolding.test.ts — SCAFFOLDING. Delete with G105.
 *
 * G078 buried the legacy Actors directory, whose "+Novo" button was the last gesture in
 * the client able to create a **player's character**. The real address is spec 37's
 * Usuários section — creating a user creates a blank character owned by them
 * (REQ-CFG-051) — which is task G105. Between the two, this temporary control keeps
 * the gesture on the screen, and this file pins the two properties that keep it from
 * rotting into the tab:
 *
 *   1. it really creates a character, with the subtype of the world's system;
 *   2. it does NOT reopen the door REQ-NPC-044 closed — the tab's own creation path
 *      still refuses `character`, and this module reaches it by a separate route.
 *
 * REQ-NPC-044 is asserted here as well as in `createNpc.test.ts` on purpose: the
 * risk this scaffolding introduces is precisely that someone "simplifies" it by
 * adding `character` to the tab's subtype list.
 */

import { describe, expect, it } from "vitest";
import type { Socket } from "socket.io-client";

import {
  buildCreateCharacterOp,
  createCharacterScaffolding,
  defaultPlayableSubtype,
} from "../createCharacterScaffolding.js";
import { NPC_CREATABLE_SUBTYPES, buildCreateNpcOp, isNpcCreatableSubtype } from "../createNpc.js";

interface Sent {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

function fakeSocket(sent: Sent[]): Socket {
  return {
    connected: true,
    emit(
      _event: string,
      envelope: { type: string; payload: Record<string, unknown> },
      ack: (result: unknown) => void,
    ): void {
      sent.push({ type: envelope.type, payload: envelope.payload });
      ack({ ok: true, result: { documentType: "Actor", documents: [{ _id: "act-new00000001" }] } });
    },
  } as unknown as Socket;
}

function createdDoc(op: ReturnType<typeof buildCreateCharacterOp>): Record<string, unknown> {
  if (op === null) throw new Error("expected an op");
  const first = op.payload.data[0];
  if (first === undefined) throw new Error("expected one document");
  return first;
}

describe("REQ-CFG-051 (until G105): the temporary door that creates a character", () => {
  it("REQ-CFG-051: creates an Actor of the system's playable subtype", () => {
    const doc = createdDoc(buildCreateCharacterOp({ name: "Valeros", systemId: "pf2e" }));

    expect(doc["type"]).toBe("character");
    expect(doc["name"]).toBe("Valeros");
  });

  it("REQ-CFG-051: etmos calls its playable subtype `orador`, and the door follows the world", () => {
    // The subtype is the FIRST entry of each system manifest's `documentTypes.Actor`;
    // hardcoding pf2e here would create an actor no etmos sheet can open.
    expect(defaultPlayableSubtype("etmos")).toBe("orador");
    expect(defaultPlayableSubtype("sf2e")).toBe("character");
    expect(createdDoc(buildCreateCharacterOp({ name: "Kaya", systemId: "etmos" }))["type"]).toBe(
      "orador",
    );
  });

  it("REQ-CFG-051: an unknown or absent system still yields a creatable document", () => {
    expect(defaultPlayableSubtype(undefined)).toBe("character");
    expect(defaultPlayableSubtype(null)).toBe("character");
    expect(defaultPlayableSubtype("no-such-system")).toBe("character");
  });

  it("REQ-CFG-051: the name is trimmed, and an empty name sends nothing at all", async () => {
    expect(createdDoc(buildCreateCharacterOp({ name: "  Seelah  " }))["name"]).toBe("Seelah");
    expect(buildCreateCharacterOp({ name: "   " })).toBeNull();

    const sent: Sent[] = [];
    expect(await createCharacterScaffolding(fakeSocket(sent), { name: "" })).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("REQ-CFG-051: the gesture reaches the server as a plain doc:create of an Actor", async () => {
    const sent: Sent[] = [];

    expect(
      await createCharacterScaffolding(fakeSocket(sent), { name: "Ezren", systemId: "pf2e" }),
    ).toBe(true);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe("doc:create");
    expect(sent[0]?.payload["documentType"]).toBe("Actor");
    const data = sent[0]?.payload["data"] as Record<string, unknown>[];
    expect(data[0]?.["type"]).toBe("character");
    expect(data[0]?.["name"]).toBe("Ezren");
  });
});

describe("REQ-NPC-044: the scaffolding does not reopen the door the tab closed", () => {
  it("REQ-NPC-044: the tab's own creation path still refuses `character`", () => {
    // The two doors of the window are unchanged: a character cannot be built by them,
    // which is what makes the block above a fenced-off exception instead of a subtype.
    expect(buildCreateNpcOp({ name: "Valeros", subtype: "character" })).toBeNull();
    expect(isNpcCreatableSubtype("character")).toBe(false);
    expect([...NPC_CREATABLE_SUBTYPES]).toEqual(["npc", "hazard"]);
  });

  it("REQ-NPC-044: what the scaffolding creates is not one of the subtypes this tab lists", () => {
    const doc = createdDoc(buildCreateCharacterOp({ name: "Valeros", systemId: "pf2e" }));

    expect(isNpcCreatableSubtype(doc["type"])).toBe(false);
  });

  it("REQ-NPC-047: it carries none of the tab's authoring vocabulary", () => {
    // Folder, attitude and preset are properties of a non-playable being authored in
    // this tab; a character created here is not authored here at all, so the payload
    // says nothing about any of them.
    const doc = createdDoc(buildCreateCharacterOp({ name: "Valeros", systemId: "pf2e" }));

    expect(doc).not.toHaveProperty("folder");
    expect(JSON.stringify(doc)).not.toContain("attitude");
    expect(JSON.stringify(doc)).not.toContain("preset");
  });
});
