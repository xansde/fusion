/**
 * partyRoster.test.ts — unit tests for the Comitiva panel's pure logic.
 *
 * Spec: `specs/28-hub-do-jogador.md` — REQ-HUB-043 (one entry per active
 * player character), REQ-HUB-044 (name, portrait, HP, conditions),
 * REQ-HUB-045 (the panel never decides visibility — it renders whatever the
 * server-redacted mirror holds), REQ-HUB-047 (a fresh read reflects a fresh
 * document — no caching inside the builder).
 */

import { describe, it, expect } from "vitest";
import { selectPartyActors, buildPartyMember, type PartyActorDoc } from "../partyRoster.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function actor(overrides: Partial<PartyActorDoc> & { _id: string }): PartyActorDoc {
  return {
    name: "Sem Nome",
    type: "character",
    ownership: { default: 0 },
    ...overrides,
  } as PartyActorDoc;
}

const tobias = actor({
  _id: "a-tobias",
  name: "Tobias",
  img: "/assets/tobias.png",
  ownership: { default: 0, "user-igor": 3 },
  system: {
    derived: { hp: { value: 31, max: 39, temp: 4 } },
    attributes: { hp: { value: 10, max: 12 } },
    resources: { heroPoints: { value: 2, max: 3 } },
  },
  items: [
    { _id: "c1", type: "condition", name: "Amedrontado", system: { slug: "frightened", value: 2 } },
    { _id: "w1", type: "weapon", name: "Arco", system: {} },
  ],
});

// ---------------------------------------------------------------------------
// selectPartyActors — REQ-HUB-043
// ---------------------------------------------------------------------------

describe("selectPartyActors", () => {
  it("keeps only character-type actors with an explicit OWNER user", () => {
    const npc = actor({ _id: "a-npc", name: "Sylas", type: "npc", ownership: { "user-gm": 3 } });
    const unowned = actor({ _id: "a-pre", name: "Pré-gen", ownership: { default: 0 } });
    const picked = selectPartyActors([npc, tobias, unowned]);
    expect(picked.map((a) => a._id)).toEqual(["a-tobias"]);
  });

  it("a default-level OWNER does not make a party member — the owner must be a named user", () => {
    const openActor = actor({ _id: "a-open", name: "Aberto", ownership: { default: 3 } });
    expect(selectPartyActors([openActor])).toEqual([]);
  });

  it("sorts by name with pt-BR collation", () => {
    const a = actor({ _id: "a1", name: "Zora", ownership: { u1: 3 } });
    const b = actor({ _id: "a2", name: "Ágata", ownership: { u2: 3 } });
    expect(selectPartyActors([a, b]).map((x) => x.name)).toEqual(["Ágata", "Zora"]);
  });

  it("an owner below OWNER level (observer) does not qualify", () => {
    const observed = actor({ _id: "a-obs", name: "Observado", ownership: { u1: 2 } });
    expect(selectPartyActors([observed])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildPartyMember — REQ-HUB-044
// ---------------------------------------------------------------------------

describe("buildPartyMember", () => {
  it("reads server-derived HP first, with temp", () => {
    const vm = buildPartyMember(tobias);
    expect(vm.hp).toEqual({ value: 31, max: 39, temp: 4 });
  });

  it("falls back to raw attributes.hp when there is no derived block", () => {
    const raw = actor({
      _id: "a-raw",
      name: "Cru",
      ownership: { u1: 3 },
      system: { attributes: { hp: { value: 7, max: 9 } } },
    });
    expect(buildPartyMember(raw).hp).toEqual({ value: 7, max: 9, temp: 0 });
  });

  it("returns hp null when the document carries no HP at all", () => {
    const bare = actor({ _id: "a-bare", name: "Vazio", ownership: { u1: 3 } });
    expect(buildPartyMember(bare).hp).toBeNull();
  });

  it("collects embedded condition items only, labelled with their value", () => {
    const vm = buildPartyMember(tobias);
    expect(vm.conditions).toEqual([{ key: "frightened", label: "Amedrontado", value: 2 }]);
  });

  it("clamps the HP fraction to [0, 1] even with overheal or negatives", () => {
    const over = actor({
      _id: "a-over",
      name: "Além",
      ownership: { u1: 3 },
      system: { attributes: { hp: { value: 99, max: 10 } } },
    });
    const under = actor({
      _id: "a-under",
      name: "Aquém",
      ownership: { u1: 3 },
      system: { attributes: { hp: { value: -5, max: 10 } } },
    });
    expect(buildPartyMember(over).hpFraction).toBe(1);
    expect(buildPartyMember(under).hpFraction).toBe(0);
  });

  it("exposes hero points when present, null when absent", () => {
    expect(buildPartyMember(tobias).heroPoints).toEqual({ value: 2, max: 3 });
    const plain = actor({ _id: "a-plain", name: "Plano", ownership: { u1: 3 } });
    expect(buildPartyMember(plain).heroPoints).toBeNull();
  });

  it("carries name and img through for the portrait", () => {
    const vm = buildPartyMember(tobias);
    expect(vm.name).toBe("Tobias");
    expect(vm.img).toBe("/assets/tobias.png");
  });
});
