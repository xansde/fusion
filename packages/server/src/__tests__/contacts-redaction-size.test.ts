/**
 * The size of a glimpsed contact travels — REQ-CTT-081, amended by spec 17 DEC-PF2-13
 * (core #288; decision of the Alexandre, 29/09/2026: "o token aparece igual para todos").
 *
 * A creature the players only GLIMPSED is drawn on the map (its portrait travels, REQ-TOK-060) and
 * the token occupies its squares — 2×2 for a Large ogre — which only works if the size reaches the
 * player. Before this the view carried NO `system` at all: the token was 1×1 on the player's
 * screen and 2×2 on the GM's, and the two Large tokens of a scene overlapped for the players.
 *
 * The size is the ONE piece of `system` data the view carries, and it is an ALLOW-list of one key:
 * `system.derived.size` — the place the token reads first (REQ-PF2-154) — whatever the source
 * (an NPC's `traits.size`, in either shape, or a character's derived size). Nothing else of the
 * ficha leaks: not the attributes, the hit points, the items, nor free text put where a size goes.
 *
 * This file pins the redaction module's own contract; `contacts-redaction.test.ts` pins that the
 * three emission paths (join snapshot, live broadcast, delta replay) all go through it.
 */

import { describe, it, expect } from "vitest";
import { KnowledgeState } from "@fusion/shared";
import { Role } from "../auth/user-store.js";
import {
  buildContactViewer,
  glimpsedContactView,
  redactActorDocsForViewer,
} from "../net/redaction.js";
import type { ContactKnowledgeSource } from "../net/redaction.js";

const OGRE_NAME = "Ogro do Desfiladeiro";
const OGRE_TITLE = "Terror da Estrada";

/** An NPC contact the viewer only glimpsed, with a real statblock behind it. */
function ogre(system: Record<string, unknown>): Record<string, unknown> {
  return {
    _id: "ogre-1",
    type: "npc",
    name: OGRE_NAME,
    img: "assets/x/ogro.webp",
    _stats: { version: 3 },
    ownership: { default: 2 },
    system: {
      details: { level: { value: 3 } },
      attributes: { hp: { value: 59, max: 59 }, ac: { value: 22 } },
      ...system,
    },
    items: [{ _id: "i1", type: "melee", name: "Clava do Ogro" }],
    flags: {
      fusion: {
        title: OGRE_TITLE,
        knowledge: { general: KnowledgeState.Glimpsed, exceptions: {} },
      },
    },
  };
}

describe("glimpsedContactView — the size is the one piece of `system` that travels (REQ-CTT-081)", () => {
  it("a Large NPC: `system` is exactly `{ derived: { size } }` — nothing else of the ficha", () => {
    const view = glimpsedContactView(ogre({ traits: { size: "lg", value: ["giant"] } }));

    expect(view["system"]).toEqual({ derived: { size: "lg" } });
  });

  it("the raw `{ value }` shape of `traits.size` is read too — an imported NPC", () => {
    const view = glimpsedContactView(ogre({ traits: { size: { value: "huge" } } }));

    expect(view["system"]).toEqual({ derived: { size: "huge" } });
  });

  it("a character's DERIVED size wins over its stored `traits.size` (which sits at the schema default)", () => {
    const view = glimpsedContactView(
      ogre({ derived: { size: "lg", hp: { max: 59 } }, traits: { size: "med" } }),
    );

    expect(view["system"]).toEqual({ derived: { size: "lg" } });
  });

  it("a contact with no size says no `system` at all — as before", () => {
    const view = glimpsedContactView(ogre({}));

    expect(view).not.toHaveProperty("system");
  });

  it("free text where a size goes is not forwarded: the value reaches a player who must not read a name", () => {
    expect(glimpsedContactView(ogre({ traits: { size: OGRE_NAME } }))).not.toHaveProperty("system");
    expect(glimpsedContactView(ogre({ derived: { size: OGRE_TITLE } }))).not.toHaveProperty(
      "system",
    );
    expect(
      glimpsedContactView(ogre({ traits: { size: { value: "Grande demais" } } })),
    ).not.toHaveProperty("system");
  });

  it("everything else the view refused, it still refuses: name, title, attributes, hit points, items", () => {
    const view = glimpsedContactView(ogre({ traits: { size: "lg" } }));
    const wire = JSON.stringify(view);

    expect(view).not.toHaveProperty("name");
    expect(view).not.toHaveProperty("items");
    expect(view).not.toHaveProperty("ownership");
    expect(wire).not.toContain(OGRE_NAME);
    expect(wire).not.toContain(OGRE_TITLE);
    expect(wire).not.toContain("hp");
    expect(wire).not.toContain("attributes");
    expect(wire).not.toContain("Clava");
    // The portrait still travels and the panel's marker is still there (REQ-TOK-060, REQ-CTT-041).
    expect(view["img"]).toBe("assets/x/ogro.webp");
    expect(view["flags"]).toEqual({ fusion: { glimpsed: true } });
  });
});

describe("redactActorDocsForViewer — the size rides the glimpsed degree only", () => {
  const knowledgeSource: ContactKnowledgeSource = {
    listCharacterOwnership: () => [{ id: "char-1", ownership: { default: 0, "user-a": 3 } }],
  };
  const viewer = buildContactViewer(knowledgeSource, "user-a", Role.PLAYER);

  it("a glimpsed Large contact arrives with its size and without its name", () => {
    const { documents } = redactActorDocsForViewer([ogre({ traits: { size: "lg" } })], viewer);

    expect(documents).toHaveLength(1);
    expect(documents[0]?.["system"]).toEqual({ derived: { size: "lg" } });
    expect(documents[0]).not.toHaveProperty("name");
  });

  it("a contact that fell to hidden is still not delivered at all — its size neither (REQ-CTT-082)", () => {
    const hidden = ogre({ traits: { size: "lg" } });
    (hidden["flags"] as { fusion: { knowledge: { general: number } } }).fusion.knowledge.general =
      KnowledgeState.Hidden;

    const { documents, removedIds } = redactActorDocsForViewer([hidden], viewer);

    expect(documents).toEqual([]);
    expect(removedIds).toEqual(["ogre-1"]);
  });

  it("a known contact still arrives whole: the size rule restricts nothing there", () => {
    const known = ogre({ traits: { size: "lg" } });
    (known["flags"] as { fusion: { knowledge: { general: number } } }).fusion.knowledge.general =
      KnowledgeState.Known;

    const { documents } = redactActorDocsForViewer([known], viewer);

    expect(documents[0]?.["name"]).toBe(OGRE_NAME);
    expect((documents[0]?.["system"] as Record<string, unknown>)["traits"]).toEqual({ size: "lg" });
  });
});
