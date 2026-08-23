/**
 * createNpc.test.ts — the two doors of the creation window (spec 42 §5.6, G074).
 *
 * Covers REQ-NPC-041 (two doors, one window — here: two entry points, one module),
 * REQ-NPC-042 (the bestiary searches the ACTOR packs and imports through the spec
 * 16 mechanism, with no second importer), REQ-NPC-043 (subtype and name),
 * REQ-NPC-044 (only `npc` and `hazard`), REQ-NPC-045 and REQ-NPC-046 (the preset
 * pre-fills the sheet and leaves no trace in the document), REQ-NPC-047 (folder
 * and attitude chosen at creation) and REQ-NPC-048 (a preset added without this
 * tab changing).
 *
 * What the fake socket records is the WIRE: every test that says "no second
 * importer" reads the ops that were emitted, not the source of the function.
 */

import { describe, expect, it } from "vitest";
import type { Socket } from "socket.io-client";
import type { PackIndexEntry, PackManifest } from "@fusion/shared";

import {
  NPC_CREATABLE_SUBTYPES,
  buildCreateNpcOp,
  createNpcFromScratch,
  findNpcPreset,
  importFromBestiary,
  isNpcCreatableSubtype,
  listNpcPresets,
  loadActorPacks,
  registerNpcPreset,
  searchBestiary,
  subtypeAcceptsAttitude,
  type BestiaryHit,
} from "../createNpc.js";
import { UNFILED_FOLDER_ID } from "../folderTree.js";

// ---------------------------------------------------------------------------
// Fake socket — records what went on the wire and acks it
// ---------------------------------------------------------------------------

interface Sent {
  readonly event: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

interface Replies {
  packs?: PackManifest[];
  entriesByPack?: Record<string, PackIndexEntry[]>;
  created?: string[];
}

function fakeSocket(sent: Sent[], replies: Replies = {}): Socket {
  return {
    connected: true,
    emit(
      event: string,
      envelope: { type: string; payload: Record<string, unknown> },
      ack: (result: unknown) => void,
    ): void {
      sent.push({ event, type: envelope.type, payload: envelope.payload });
      switch (envelope.type) {
        case "compendium:list":
          ack({ ok: true, result: { packs: replies.packs ?? [] } });
          return;
        case "compendium:search": {
          const packId = String(envelope.payload["packId"]);
          ack({
            ok: true,
            result: { packId, entries: replies.entriesByPack?.[packId] ?? [] },
          });
          return;
        }
        case "compendium:import":
          ack({
            ok: true,
            result: { created: replies.created ?? ["act-imported001"], failed: [] },
          });
          return;
        default:
          ack({ ok: true, result: {} });
      }
    },
  } as unknown as Socket;
}

function pack(id: string, label: string, documentType: string): PackManifest {
  return { id, label, documentType, systemId: "pf2e", audience: "gm" } as unknown as PackManifest;
}

function entry(id: string, name: string, type: string, level?: number): PackIndexEntry {
  return {
    _id: id,
    uuid: `Compendium.pf2e.bestiary-core.Actor.${id}`,
    name,
    img: null,
    type,
    index: level === undefined ? {} : { "system.level.value": level },
  };
}

/** The single `data[0]` of a `doc:create` op. */
function createdDoc(op: ReturnType<typeof buildCreateNpcOp>): Record<string, unknown> {
  if (op === null) throw new Error("expected an op");
  const data = op.payload.data;
  const first = data[0];
  if (first === undefined) throw new Error("expected one document");
  return first;
}

// ---------------------------------------------------------------------------
// The "from scratch" door
// ---------------------------------------------------------------------------

describe("REQ-NPC-043 / REQ-NPC-044: the door that asks for a subtype and a name", () => {
  it("REQ-NPC-043: the op carries the name and the subtype the form asked for", () => {
    const doc = createdDoc(buildCreateNpcOp({ name: "  Bram  ", subtype: "npc" }));

    expect(doc["name"]).toBe("Bram");
    expect(doc["type"]).toBe("npc");
  });

  it("REQ-NPC-043: a blank name is not a creation", () => {
    expect(buildCreateNpcOp({ name: "   ", subtype: "npc" })).toBeNull();
  });

  it("REQ-NPC-044: the offered subtypes are exactly `npc` and `hazard`", () => {
    expect([...NPC_CREATABLE_SUBTYPES]).toEqual(["npc", "hazard"]);
    expect(isNpcCreatableSubtype("npc")).toBe(true);
    expect(isNpcCreatableSubtype("hazard")).toBe(true);
  });

  it("REQ-NPC-044: character, familiar, loot and a vehicle are refused by this door", () => {
    // `character` is born with the player, `familiar` glued to a master, `loot`
    // is the chest — and a vehicle was never declared by any system at all.
    for (const subtype of ["character", "familiar", "loot", "vehicle"]) {
      expect(isNpcCreatableSubtype(subtype)).toBe(false);
      expect(buildCreateNpcOp({ name: "Qualquer", subtype })).toBeNull();
    }
  });
});

describe("REQ-NPC-047: the folder and the attitude are chosen at creation", () => {
  it("REQ-NPC-047: the chosen folder is the folder the document is born in", () => {
    const doc = createdDoc(
      buildCreateNpcOp({ name: "Bram", subtype: "npc", folderId: "fld-taverna000001" }),
    );

    expect(doc["folder"]).toBe("fld-taverna000001");
  });

  it('REQ-NPC-047: "Sem pasta" is a destination, in every spelling', () => {
    for (const folderId of [null, undefined, UNFILED_FOLDER_ID, ""]) {
      const doc = createdDoc(buildCreateNpcOp({ name: "Bram", subtype: "npc", folderId }));
      expect(doc["folder"]).toBeNull();
    }
  });

  it("REQ-NPC-047: the chosen attitude is written where the actor stores it", () => {
    const doc = createdDoc(buildCreateNpcOp({ name: "Bram", subtype: "npc", attitude: "enemy" }));

    // Nested, because `doc:create` stores the item as given — only the update
    // path expands dot paths.
    expect(doc["flags"]).toEqual({ fusion: { attitude: "enemy" } });
  });

  it("REQ-NPC-047: a hazard is born with no attitude, even when one is chosen", () => {
    expect(subtypeAcceptsAttitude("hazard")).toBe(false);
    const doc = createdDoc(
      buildCreateNpcOp({ name: "Fosso", subtype: "hazard", attitude: "enemy" }),
    );

    expect(JSON.stringify(doc)).not.toContain("attitude");
  });
});

describe("REQ-NPC-045 / REQ-NPC-046: the preset pre-fills, and is not stored", () => {
  it("REQ-NPC-045: the preset's patch reaches the sheet of the created actor", () => {
    const preset = findNpcPreset("merchant");
    expect(preset).not.toBeNull();

    const doc = createdDoc(
      buildCreateNpcOp({ name: "Bram", subtype: "npc", presetId: "merchant", attitude: null }),
    );

    expect(doc["system"]).toEqual(preset?.patch["system"]);
  });

  it("REQ-NPC-046: no preset id, and no word `preset`, survives into the document", () => {
    const op = buildCreateNpcOp({ name: "Bram", subtype: "npc", presetId: "merchant" });
    const wire = JSON.stringify(op);

    expect(wire).not.toContain("merchant");
    expect(wire).not.toContain("preset");
    expect(wire).not.toContain("Preset");
  });

  it("REQ-NPC-045: the preset suggests an attitude, and an explicit choice overrides it", () => {
    const suggested = createdDoc(
      buildCreateNpcOp({ name: "Chefe", subtype: "npc", presetId: "boss" }),
    );
    expect(suggested["flags"]).toEqual({ fusion: { attitude: "enemy" } });

    const chosen = createdDoc(
      buildCreateNpcOp({ name: "Chefe", subtype: "npc", presetId: "boss", attitude: "ally" }),
    );
    expect(chosen["flags"]).toEqual({ fusion: { attitude: "ally" } });

    const none = createdDoc(
      buildCreateNpcOp({ name: "Chefe", subtype: "npc", presetId: "boss", attitude: null }),
    );
    expect(JSON.stringify(none)).not.toContain("attitude");
  });

  it("REQ-NPC-048: a preset added later is offered and applied with no change to this tab", () => {
    registerNpcPreset({
      id: "cultist-g074",
      subtype: "npc",
      labelKey: "FUSION.Npcs.Create.Preset.cultist",
      attitude: "enemy",
      patch: { system: { details: { level: { value: 3 } } } },
    });

    expect(listNpcPresets("npc").map((preset) => preset.id)).toContain("cultist-g074");

    const doc = createdDoc(
      buildCreateNpcOp({ name: "Encapuzado", subtype: "npc", presetId: "cultist-g074" }),
    );
    expect(doc["system"]).toEqual({ details: { level: { value: 3 } } });
    // And it is still not stored (REQ-NPC-046) — a new preset does not open a
    // door the catalogued ones do not have.
    expect(JSON.stringify(doc)).not.toContain("cultist-g074");
  });

  it("REQ-NPC-044: a hazard is offered no preset written for an npc", () => {
    expect(listNpcPresets("hazard")).toHaveLength(0);
    // ...and a stale id from another subtype leaks no field into the document.
    const doc = createdDoc(
      buildCreateNpcOp({ name: "Fosso", subtype: "hazard", presetId: "merchant" }),
    );
    expect(doc["system"]).toBeUndefined();
  });
});

describe("REQ-NPC-043: creating from scratch is one op, and it is a doc:create", () => {
  it("REQ-NPC-043: exactly one `doc:create` of an Actor goes on the wire", async () => {
    const sent: Sent[] = [];
    const created = await createNpcFromScratch(fakeSocket(sent), { name: "Bram", subtype: "npc" });

    expect(created).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe("doc:create");
    expect(sent[0]?.payload["documentType"]).toBe("Actor");
  });

  it("REQ-NPC-044: a refused subtype sends nothing at all", async () => {
    const sent: Sent[] = [];
    const created = await createNpcFromScratch(fakeSocket(sent), {
      name: "Fofurinha",
      subtype: "character",
    });

    expect(created).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The bestiary door
// ---------------------------------------------------------------------------

const PACKS = [
  pack("pf2e.bestiary-core", "Bestiário", "Actor"),
  pack("pf2e.hazards-core", "Perigos", "Actor"),
  pack("pf2e.equipment-core", "Equipamento", "Item"),
];

const ENTRIES: Record<string, PackIndexEntry[]> = {
  "pf2e.bestiary-core": [
    entry("gob-piro00000001", "Goblin Piromaníaco", "npc", 1),
    entry("gob-guerreiro001", "Goblin Guerreiro", "npc", 1),
    // Neither of these is authored by this tab, so neither is listed.
    entry("chr-aventureiro1", "Aventureiro", "character"),
    entry("lot-bau000000001", "Baú", "loot"),
  ],
  "pf2e.hazards-core": [entry("haz-fosso000001", "Fosso", "hazard", 2)],
};

describe("REQ-NPC-042: the bestiary door searches the actor packs", () => {
  it("REQ-NPC-042: only the ACTOR packs are searched, one `compendium:search` each", async () => {
    const sent: Sent[] = [];
    const socket = fakeSocket(sent, { packs: PACKS, entriesByPack: ENTRIES });

    const packs = await loadActorPacks(socket);
    expect(packs.map((manifest) => manifest.id)).toEqual([
      "pf2e.bestiary-core",
      "pf2e.hazards-core",
    ]);

    await searchBestiary(socket, packs, "gob", "pt-BR");

    const searched = sent
      .filter((op) => op.type === "compendium:search")
      .map((op) => op.payload["packId"]);
    expect(searched).toEqual(["pf2e.bestiary-core", "pf2e.hazards-core"]);
    expect(sent.some((op) => op.payload["packId"] === "pf2e.equipment-core")).toBe(false);
  });

  it("REQ-NPC-042: the results carry only the subtypes this tab authors", async () => {
    const sent: Sent[] = [];
    const socket = fakeSocket(sent, { packs: PACKS, entriesByPack: ENTRIES });

    const hits = await searchBestiary(socket, await loadActorPacks(socket), "o", "pt-BR");

    expect(hits.map((hit) => hit.name)).toEqual([
      "Fosso",
      "Goblin Guerreiro",
      "Goblin Piromaníaco",
    ]);
    expect(hits.every((hit) => hit.subtype === "npc" || hit.subtype === "hazard")).toBe(true);
    expect(hits.find((hit) => hit.name === "Fosso")?.level).toBe(2);
    expect(hits.find((hit) => hit.name === "Fosso")?.packLabel).toBe("Perigos");
  });

  it("REQ-NPC-042: an empty term asks the server nothing", async () => {
    const sent: Sent[] = [];
    const hits = await searchBestiary(fakeSocket(sent), PACKS, "   ", "pt-BR");

    expect(hits).toEqual([]);
    expect(sent).toHaveLength(0);
  });
});

describe("REQ-NPC-042: importing is the spec 16 mechanism, and there is no second one", () => {
  const HIT: BestiaryHit = {
    uuid: "Compendium.pf2e.bestiary-core.Actor.gob-piro00000001",
    packId: "pf2e.bestiary-core",
    packLabel: "Bestiário",
    name: "Goblin Piromaníaco",
    secondaryName: "Goblin Pyro",
    subtype: "npc",
    level: 1,
  };

  it("REQ-NPC-042: the import is a `compendium:import`, and never a `doc:create` of an Actor", async () => {
    const sent: Sent[] = [];
    await importFromBestiary(fakeSocket(sent), HIT, { folderId: "fld-goblins00001" });

    expect(sent.map((op) => op.type)).toEqual(["compendium:import"]);
    expect(sent[0]?.payload["uuids"]).toEqual([HIT.uuid]);
    // Q-NPC-01, main path taken: the imported actor lands in the folder the
    // creation window had selected.
    expect(sent[0]?.payload["folderId"]).toBe("fld-goblins00001");
    expect(sent.some((op) => op.type === "doc:create")).toBe(false);
  });

  it('REQ-NPC-047: "Sem pasta" imports with no folder at all', async () => {
    const sent: Sent[] = [];
    await importFromBestiary(fakeSocket(sent), HIT, { folderId: UNFILED_FOLDER_ID });

    expect(sent[0]?.payload["folderId"]).toBeUndefined();
  });

  it("REQ-NPC-047: the initial attitude follows the import as an ordinary update", async () => {
    const sent: Sent[] = [];
    await importFromBestiary(fakeSocket(sent, { created: ["act-goblin00001"] }), HIT, {
      attitude: "enemy",
    });

    expect(sent.map((op) => op.type)).toEqual(["compendium:import", "doc:update"]);
    expect(sent[1]?.payload["updates"]).toEqual([
      { _id: "act-goblin00001", diff: { "flags.fusion.attitude": "enemy" } },
    ]);
  });

  it("REQ-NPC-047: a hazard imported with an attitude chosen gets no attitude write", async () => {
    const sent: Sent[] = [];
    await importFromBestiary(
      fakeSocket(sent),
      { ...HIT, subtype: "hazard" },
      {
        attitude: "enemy",
      },
    );

    expect(sent.map((op) => op.type)).toEqual(["compendium:import"]);
  });
});
