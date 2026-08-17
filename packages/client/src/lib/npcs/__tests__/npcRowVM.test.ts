/**
 * npcRowVM.test.ts — the line of the non-playable, as pure data (spec 42 §5.2/§5.4).
 *
 * Covers REQ-NPC-030 (what the line shows), REQ-NPC-031 (no hit points, for any
 * role), REQ-NPC-032 (the free title and its fallback), REQ-NPC-033 (conditions by
 * the contract of spec 39), REQ-NPC-034 (sub-characters inside the owner's line),
 * REQ-NPC-035 (the sheet is opened from the line) and REQ-NPC-036 (how many scene
 * presences, and in which scenes), plus the header block REQ-NPC-010..REQ-NPC-014
 * (search over name and title, folders without a result, pt-BR order, "Sem pasta").
 *
 * Everything here is the view model alone: no DOM, no socket, no store.
 */

import { describe, expect, it } from "vitest";

import {
  NPC_TITLE_FLAG_PATH,
  buildNpcRows,
  countScenePresences,
  foldersWithResults,
  matchesNpcQuery,
  npcLevel,
  npcTitleDiff,
  resolveNpcTitleLine,
  rowsOfFolder,
  toFolderedDocs,
  type NpcActorDoc,
  type NpcSceneDoc,
} from "../npcRowVM.js";
import { buildFolderTree, flattenTree } from "../folderTree.js";
import { CONTACT_TITLE_FLAG_PATH } from "../../contacts/contactsVM.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GOBLIN: NpcActorDoc = {
  _id: "act-goblin00001",
  name: "Goblin Batedor",
  type: "npc",
  img: "worlds/img/goblin.webp",
  folder: "fld-bosque0000001",
  system: {
    details: { level: { value: 3 } },
    // Never read by anything here — see the REQ-NPC-031 block below.
    attributes: { hp: { value: 137, max: 999 } },
  },
  items: [
    {
      _id: "itm-frightened01",
      name: "Amedrontado",
      type: "condition",
      system: { slug: "frightened", value: 2 },
    },
  ],
  flags: { fusion: { title: "Sentinela da trilha", attitude: "enemy" } },
};

const OGRE: NpcActorDoc = {
  _id: "act-ogro000001x",
  name: "Ogro",
  type: "npc",
  folder: "fld-bosque0000001",
  system: { details: { level: 7 } },
};

const TRAP: NpcActorDoc = {
  _id: "act-armadilha01",
  name: "Armadilha de fosso",
  type: "hazard",
  folder: null,
  system: { details: { level: { value: 1 } } },
};

/** A familiar bound to the Goblin: drawn inside its line, never as a line of its own. */
const RAT: NpcActorDoc = {
  _id: "act-rato00000001",
  name: "Rato de estimação",
  type: "familiar",
  folder: "fld-bosque0000001",
  system: { masterActorId: "act-goblin00001", companionKind: "familiar" },
};

/** A player's character — the Contatos tab's population, never this one's. */
const HERO: NpcActorDoc = {
  _id: "act-fofurinha01",
  name: "Fofurinha",
  type: "character",
  folder: "fld-bosque0000001",
};

const SCENES: NpcSceneDoc[] = [
  {
    _id: "scn-bosque00001",
    name: "Clareira",
    tokens: [
      {
        _id: "tok-a0000000000001",
        actorId: "act-goblin00001",
        name: "Goblin A",
        x: 100,
        y: 250,
        hidden: true,
      },
      {
        _id: "tok-b0000000000001",
        actorId: "act-goblin00001",
        name: "Goblin B",
        x: 300,
        y: 250,
        hidden: false,
      },
      { _id: "tok-c0000000000001", actorId: "act-ogro000001x", name: "Ogro", x: 500, y: 250 },
    ],
  },
  {
    _id: "scn-caverna0001",
    name: "Caverna",
    tokens: [
      { _id: "tok-d0000000000001", actorId: "act-goblin00001", name: "Goblin C", x: 40, y: 40 },
    ],
  },
  { _id: "scn-vazia00001", name: "Praça vazia", tokens: [] },
];

const ACTORS: NpcActorDoc[] = [GOBLIN, OGRE, TRAP, RAT, HERO];

function rows(query = ""): ReturnType<typeof buildNpcRows> {
  return buildNpcRows({ actors: ACTORS, scenes: SCENES, isPrivileged: true, query });
}

function rowOf(id: string): NonNullable<ReturnType<typeof rows>[number]> {
  const found = rows().find((row) => row.id === id);
  if (found === undefined) throw new Error(`no row for ${id}`);
  return found;
}

// ---------------------------------------------------------------------------
// REQ-NPC-030 / REQ-NPC-031 — what the line carries, and what it may never carry
// ---------------------------------------------------------------------------

describe("REQ-NPC-030: portrait, name, title, level and attitude", () => {
  it("REQ-NPC-030: the row carries portrait, name, level and the attitude when there is one", () => {
    const row = rowOf(GOBLIN._id);

    expect(row.name).toBe("Goblin Batedor");
    expect(row.img).toBe("worlds/img/goblin.webp");
    expect(row.level).toBe(3);
    expect(row.attitude).toBe("enemy");
    expect(row.subtype).toBe("npc");
  });

  it("REQ-NPC-030: an actor with no attitude declares none instead of a default", () => {
    // REQ-NPC-037: "não-jogável sem atitude aplicável NÃO DEVE exibir indicação alguma".
    expect(rowOf(OGRE._id).attitude).toBeNull();
    expect(rowOf(TRAP._id).attitude).toBeNull();
  });

  it("REQ-NPC-037: a hazard reads no attitude even when its document carries one", () => {
    // CA-NPC-010: a hazard has none. The flag below can only come from a hand
    // edit or a document written before the subtype gate existed — the row is
    // the last place that could turn it into an indication, and it does not.
    const [row] = buildNpcRows({
      actors: [{ ...TRAP, flags: { fusion: { attitude: "enemy" } } }],
      isPrivileged: true,
    });

    expect(row?.subtype).toBe("hazard");
    expect(row?.attitude).toBeNull();
  });

  it("REQ-NPC-030: only the non-playables are rows — a character is not one of them", () => {
    const ids = rows().map((row) => row.id);

    expect(ids).toContain(GOBLIN._id);
    expect(ids).toContain(TRAP._id);
    expect(ids).not.toContain(HERO._id);
  });
});

describe("REQ-CMP-055: a row's name resolves the pt-BR snapshot, never doc.name straight (A041/A034)", () => {
  it("REQ-CMP-055: a compendium-imported NPC shows the pt-BR label from flags.fusion.i18n", () => {
    const EAGLE: NpcActorDoc = {
      _id: "act-eagle0000001",
      name: "Eagle",
      type: "npc",
      img: "worlds/img/eagle.webp",
      folder: null,
      system: { details: { level: { value: 1 } } },
      flags: {
        fusion: {
          packName: "bestiary",
          sourceId: "eagle-001",
          i18n: { "pt-BR": { name: "Águia" } },
        },
      },
    };

    const [row] = buildNpcRows({ actors: [EAGLE], isPrivileged: true });

    expect(row?.name).toBe("Águia");
  });

  it("REQ-CMP-055: an NPC imported before the flag existed (no snapshot) falls back to doc.name", () => {
    const EAGLE_NO_FLAG: NpcActorDoc = {
      _id: "act-eagle0000002",
      name: "Eagle",
      type: "npc",
      img: "worlds/img/eagle.webp",
      folder: null,
      system: { details: { level: { value: 1 } } },
      flags: { fusion: { packName: "bestiary", sourceId: "eagle-001" } },
    };

    const [row] = buildNpcRows({ actors: [EAGLE_NO_FLAG], isPrivileged: true });

    expect(row?.name).toBe("Eagle");
  });
});

describe("REQ-NPC-031: no hit points reach the line, for any role", () => {
  it("REQ-NPC-031: the row of an actor with hp carries no number of it whatsoever", () => {
    const row = rowOf(GOBLIN._id);
    const serialized = JSON.stringify(row);

    // The fixture's hp is 137/999 — values that appear nowhere else — so a leak
    // through any field of the row, named or not, shows up here (DEC-NPC-10).
    expect(serialized).not.toContain("137");
    expect(serialized).not.toContain("999");
    expect(serialized.toLowerCase()).not.toContain("hp");
    expect(serialized.toLowerCase()).not.toContain("attributes");
  });

  it("REQ-NPC-031: the privileged role gets exactly the same shape — there is no hp branch", () => {
    const asGm = buildNpcRows({ actors: ACTORS, scenes: SCENES, isPrivileged: true });
    const asPlayer = buildNpcRows({ actors: ACTORS, scenes: SCENES, isPrivileged: false });

    const gmKeys = Object.keys(asGm[0] ?? {}).sort();
    const playerKeys = Object.keys(asPlayer[0] ?? {}).sort();
    expect(gmKeys).toEqual(playerKeys);
    expect(gmKeys).not.toContain("hp");
  });
});

// ---------------------------------------------------------------------------
// REQ-NPC-032 — the title, and what the line says when there is none
// ---------------------------------------------------------------------------

describe("REQ-NPC-032: the free title, written on the actor itself", () => {
  it("REQ-NPC-032: the title is the SAME field spec 39 writes (flags.fusion.title)", () => {
    // Two tabs, one datum: the Mestre who renamed a contact in the 39 sees it here.
    expect(NPC_TITLE_FLAG_PATH).toBe("flags.fusion.title");
    expect(NPC_TITLE_FLAG_PATH).toBe(CONTACT_TITLE_FLAG_PATH);
    expect(npcTitleDiff("  Sentinela  ")).toEqual({ "flags.fusion.title": "Sentinela" });
  });

  it("REQ-NPC-032: a filled title is shown as a title", () => {
    const line = rowOf(GOBLIN._id).title;

    expect(line.kind).toBe("title");
    expect(line.text).toBe("Sentinela da trilha");
  });

  it("REQ-NPC-032: an empty title falls back to subtype and level, marked as a fallback", () => {
    const line = resolveNpcTitleLine(OGRE, (subtype) => (subtype === "npc" ? "Criatura" : subtype));

    expect(line.kind).toBe("fallback");
    expect(line.text).toBe("Criatura 7");
    // The panel styles the fallback differently (REQ-NPC-032), so the two pieces
    // stay readable apart from the assembled string.
    expect(line.subtype).toBe("npc");
    expect(line.level).toBe(7);
  });

  it("REQ-NPC-032: with no level declared the fallback degrades to the subtype alone", () => {
    const line = resolveNpcTitleLine({ _id: "x", type: "hazard" });

    expect(line.kind).toBe("fallback");
    expect(line.text).toBe("hazard");
    expect(line.level).toBeNull();
  });

  it("REQ-NPC-032: only a privileged role is offered the edit in the line", () => {
    const gm = buildNpcRows({ actors: [GOBLIN], isPrivileged: true })[0];
    const player = buildNpcRows({ actors: [GOBLIN], isPrivileged: false })[0];

    expect(gm?.canEditTitle).toBe(true);
    expect(player?.canEditTitle).toBe(false);
  });

  it("REQ-NPC-030: the level is read from either shape the systems store", () => {
    expect(npcLevel(GOBLIN)).toBe(3);
    expect(npcLevel(OGRE)).toBe(7);
    expect(npcLevel({ _id: "x" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// REQ-NPC-033 — conditions, by the contract of spec 39
// ---------------------------------------------------------------------------

describe("REQ-NPC-033: conditions come from the declared contract, not from this tab", () => {
  it("REQ-NPC-033: the value is glued to the label and the tone is the declared one", () => {
    const declarations = new Map([["frightened", { label: "Amedrontado", tone: "harm" as const }]]);
    const row = buildNpcRows({
      actors: [GOBLIN],
      isPrivileged: true,
      conditionDeclarations: declarations,
    })[0];

    expect(row?.conditions).toHaveLength(1);
    expect(row?.conditions[0]?.label).toBe("Amedrontado 2");
    expect(row?.conditions[0]?.tone).toBe("harm");
  });

  it("REQ-NPC-033: an undeclared condition still shows — the display degrades, it never hides", () => {
    const row = buildNpcRows({ actors: [GOBLIN], isPrivileged: true })[0];

    expect(row?.conditions.map((view) => view.slug)).toEqual(["frightened"]);
    expect(row?.conditions[0]?.tone).toBe("special");
  });
});

// ---------------------------------------------------------------------------
// REQ-NPC-034 — sub-characters
// ---------------------------------------------------------------------------

describe("REQ-NPC-034: a sub-character is part of a line, never a line", () => {
  it("REQ-NPC-034: the familiar is inside its master's row", () => {
    const row = rowOf(GOBLIN._id);

    expect(row.subCharacters.map((sub) => sub.id)).toEqual([RAT._id]);
    expect(row.subCharacters[0]?.name).toBe("Rato de estimação");
    expect(row.subCharacters[0]?.kind).toBe("familiar");
  });

  it("REQ-NPC-034: and it is not a row of its own", () => {
    expect(rows().map((row) => row.id)).not.toContain(RAT._id);
  });

  it("REQ-NPC-034: a familiar whose master is not listed here is dropped with him", () => {
    const orphan: NpcActorDoc = {
      _id: "act-orfao000001",
      name: "Coruja",
      type: "familiar",
      system: { masterActorId: "act-inexistente1" },
    };
    const built = buildNpcRows({ actors: [OGRE, orphan], isPrivileged: true });

    expect(built.map((row) => row.id)).toEqual([OGRE._id]);
    expect(built[0]?.subCharacters).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// REQ-NPC-035 / REQ-NPC-036 — the sheet, and the presences in the scenes
// ---------------------------------------------------------------------------

describe("REQ-NPC-036: how many presences, in which scenes, and nothing of each one", () => {
  it("REQ-NPC-036: the row counts the presences of the actor across every scene", () => {
    const presence = rowOf(GOBLIN._id).presence;

    expect(presence.total).toBe(3);
    expect(presence.scenes.map((scene) => scene.sceneName)).toEqual(["Clareira", "Caverna"]);
    expect(presence.scenes.map((scene) => scene.count)).toEqual([2, 1]);
  });

  it("REQ-NPC-036: a scene where the actor is not present is not named at all", () => {
    expect(rowOf(GOBLIN._id).presence.scenes.map((scene) => scene.sceneId)).not.toContain(
      "scn-vazia00001",
    );
    expect(rowOf(TRAP._id).presence.total).toBe(0);
    expect(rowOf(TRAP._id).presence.scenes).toHaveLength(0);
  });

  it("REQ-NPC-036: no datum of the individual presence travels — only how many, and where", () => {
    const serialized = JSON.stringify(rowOf(GOBLIN._id).presence);

    // The fixture's tokens carry ids, names, coordinates and a hidden flag; the
    // line is about the actor, and none of that describes the actor.
    expect(serialized).not.toContain("tok-");
    expect(serialized).not.toContain("Goblin A");
    expect(serialized).not.toContain("hidden");
    expect(serialized).not.toContain("250");
    expect(Object.keys(rowOf(GOBLIN._id).presence.scenes[0] ?? {}).sort()).toEqual([
      "count",
      "sceneId",
      "sceneName",
    ]);
  });

  it("REQ-NPC-036: counting is by actorId — an anonymous token belongs to nobody", () => {
    const scenes: NpcSceneDoc[] = [
      {
        _id: "scn-solta00001",
        name: "Solta",
        tokens: [{ _id: "tok-e0000000000001", actorId: null, name: "Sem ator" }],
      },
    ];

    expect(countScenePresences(scenes, GOBLIN._id)).toEqual({ total: 0, scenes: [] });
  });

  it("REQ-NPC-035: the row is addressed by the actor id the sheet opens with", () => {
    // The sheet itself is a window (REQ-UIF-009); what the view model owes it is
    // the identity of the document to open, and it is the actor's own id.
    expect(rowOf(GOBLIN._id).id).toBe(GOBLIN._id);
  });
});

// ---------------------------------------------------------------------------
// REQ-NPC-010..014 — search, order, folders without a result, "Sem pasta"
// ---------------------------------------------------------------------------

describe("REQ-NPC-011: the search reads name and title, in the client", () => {
  it("REQ-NPC-011: a name matches, accent-insensitively", () => {
    expect(matchesNpcQuery(GOBLIN, "goblin")).toBe(true);
    expect(matchesNpcQuery(TRAP, "armadilha de FOSSO")).toBe(true);
    expect(matchesNpcQuery(OGRE, "goblin")).toBe(false);
  });

  it("REQ-NPC-011: the title matches too — it is half of what the Mestre named", () => {
    expect(matchesNpcQuery(GOBLIN, "sentinela")).toBe(true);
    expect(rows("sentinela").map((row) => row.id)).toEqual([GOBLIN._id]);
  });

  it("REQ-NPC-011: an empty query keeps everyone", () => {
    expect(
      rows("   ")
        .map((row) => row.id)
        .sort(),
    ).toEqual([GOBLIN._id, OGRE._id, TRAP._id].sort());
  });

  it("REQ-NPC-011: a sub-character's name keeps the line of its master", () => {
    // The familiar is part of that line (REQ-NPC-034), so finding it must not
    // produce a row of its own — it produces the master's.
    expect(rows("rato de estimação").map((row) => row.id)).toEqual([GOBLIN._id]);
  });
});

describe("REQ-NPC-013 / REQ-NPC-014: order inside a folder, and the group without one", () => {
  it("REQ-NPC-013: rows of a folder are alphabetical with localeCompare in pt-BR", () => {
    const built = buildNpcRows({
      actors: [
        { _id: "a1", name: "Zumbi", type: "npc", folder: "f1" },
        { _id: "a2", name: "Ácaro", type: "npc", folder: "f1" },
        { _id: "a3", name: "Basilisco", type: "npc", folder: "f1" },
      ],
      isPrivileged: true,
    });

    // "Ácaro" before "Basilisco" is exactly what a byte comparison gets wrong.
    expect(rowsOfFolder(built, "f1").map((row) => row.name)).toEqual([
      "Ácaro",
      "Basilisco",
      "Zumbi",
    ]);
  });

  it("REQ-NPC-014: an actor with no folder belongs to the group without one", () => {
    expect(rowsOfFolder(rows(), null).map((row) => row.id)).toEqual([TRAP._id]);
    expect(rowsOfFolder(rows(), "fld-bosque0000001").map((row) => row.id)).toEqual([
      GOBLIN._id,
      OGRE._id,
    ]);
  });
});

describe("REQ-NPC-012: during a search, a folder without a result disappears", () => {
  const FOLDERS = [
    { _id: "fld-bosque0000001", name: "Bosque", type: "Actor", parentId: null },
    { _id: "fld-aldeia0000001", name: "Aldeia", type: "Actor", parentId: null },
    { _id: "fld-taverna000001", name: "Taverna", type: "Actor", parentId: "fld-aldeia0000001" },
  ];

  it("REQ-NPC-012: only folders holding a match survive the filter", () => {
    const matched = rows("goblin");
    const tree = buildFolderTree(FOLDERS, toFolderedDocs(matched));
    const visible = foldersWithResults(flattenTree(tree, new Set()), true);

    expect(visible.map((row) => row.node.id)).toEqual(["fld-bosque0000001"]);
  });

  it("REQ-NPC-012: a folder whose CHILD holds the match stays, so the child can be reached", () => {
    const inTavern: NpcActorDoc = {
      _id: "act-taverneiro1",
      name: "Taverneiro",
      type: "npc",
      folder: "fld-taverna000001",
    };
    const matched = buildNpcRows({
      actors: [inTavern, OGRE],
      isPrivileged: true,
      query: "taverneiro",
    });
    const tree = buildFolderTree(FOLDERS, toFolderedDocs(matched));
    const visible = foldersWithResults(flattenTree(tree, new Set()), true);

    expect(visible.map((row) => row.node.id)).toEqual(["fld-aldeia0000001", "fld-taverna000001"]);
  });

  it("REQ-NPC-012: with no search running, an empty folder is kept", () => {
    const tree = buildFolderTree(FOLDERS, toFolderedDocs(rows()));
    const visible = foldersWithResults(flattenTree(tree, new Set()), false);

    expect(visible.map((row) => row.node.id).sort()).toEqual(
      ["fld-aldeia0000001", "fld-bosque0000001", "fld-taverna000001"].sort(),
    );
  });
});
