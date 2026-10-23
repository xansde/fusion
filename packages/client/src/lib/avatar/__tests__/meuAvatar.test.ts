/**
 * Tests for "whose avatar is in the corner".
 *
 * The rule that matters is the one about the GM: permission-based ownership
 * would hand them every actor in the world and the corner would show a random
 * goblin labelled as their character.
 */

import { describe, expect, it } from "vitest";
import { AVATAR_FLAG_KEY, AVATAR_FLAG_SCOPE, OwnershipLevel } from "@fusion/shared";
import { escolherAvatarDoUsuario, possuiExplicitamente, type AtorComAvatar } from "../meuAvatar.js";

const EU = "u".repeat(16);
const OUTRO = "v".repeat(16);

const AVATAR = { versao: 1, corpo: "male", selecao: { body: { id: "body/body-color" } } };

function ator(over: Partial<AtorComAvatar> & { _id: string }): AtorComAvatar {
  return {
    name: "Alguém",
    type: "character",
    ownership: { default: OwnershipLevel.NONE, [EU]: OwnershipLevel.OWNER },
    flags: { [AVATAR_FLAG_SCOPE]: { [AVATAR_FLAG_KEY]: AVATAR } },
    ...over,
  };
}

describe("possuiExplicitamente", () => {
  it("requires the user to be named in the ownership map", () => {
    expect(possuiExplicitamente(ator({ _id: "a1" }), EU)).toBe(true);
    expect(possuiExplicitamente(ator({ _id: "a1" }), OUTRO)).toBe(false);
  });

  it("does not accept a default-level grant as ownership", () => {
    const publico = ator({ _id: "a1", ownership: { default: OwnershipLevel.OWNER } });
    expect(possuiExplicitamente(publico, EU)).toBe(false);
  });

  it("does not accept a lesser explicit level", () => {
    const observador = ator({
      _id: "a1",
      ownership: { default: 0, [EU]: OwnershipLevel.OBSERVER },
    });
    expect(possuiExplicitamente(observador, EU)).toBe(false);
  });
});

describe("escolherAvatarDoUsuario", () => {
  it("picks the actor the user explicitly owns", () => {
    const escolha = escolherAvatarDoUsuario(
      [
        ator({ _id: "a1", name: "Fofurinha" }),
        ator({ _id: "a2", name: "Outro", ownership: { default: 0 } }),
      ],
      EU,
    );
    expect(escolha).toMatchObject({ actorId: "a1", nome: "Fofurinha" });
    expect(escolha?.avatar).toEqual(AVATAR);
  });

  it("gives a GM nothing when the GM owns nothing explicitly", () => {
    // The GM holds implicit OWNER on every document; using that here would
    // label an arbitrary NPC as the GM's own character.
    const mundo = [
      ator({ _id: "npc1", name: "Goblin", type: "npc", ownership: { default: 0 } }),
      ator({
        _id: "pc1",
        name: "PC do jogador",
        ownership: { default: 0, [OUTRO]: OwnershipLevel.OWNER },
      }),
    ];
    expect(escolherAvatarDoUsuario(mundo, EU)).toBeNull();
  });

  it("shows the GM their own character when they do own one", () => {
    const mundo = [
      ator({ _id: "npc1", type: "npc", ownership: { default: 0 } }),
      ator({ _id: "pc1", name: "Meu PC" }),
    ];
    expect(escolherAvatarDoUsuario(mundo, EU)?.actorId).toBe("pc1");
  });

  it("ignores owned actors that have no avatar yet", () => {
    const semAvatar = ator({ _id: "a1", flags: {} });
    expect(escolherAvatarDoUsuario([semAvatar], EU)).toBeNull();
  });

  it("ignores an avatar flag that is junk", () => {
    const lixo = ator({ _id: "a1", flags: { [AVATAR_FLAG_SCOPE]: { [AVATAR_FLAG_KEY]: "???" } } });
    expect(escolherAvatarDoUsuario([lixo], EU)).toBeNull();
  });

  it("prefers a character over another owned actor type", () => {
    const mundo = [
      ator({ _id: "fam", name: "Aaa Familiar", type: "familiar" }),
      ator({ _id: "pc", name: "Zzz PC", type: "character" }),
    ];
    expect(escolherAvatarDoUsuario(mundo, EU)?.actorId).toBe("pc");
  });

  it("breaks ties by name then id, so two clients agree", () => {
    const mundo = [ator({ _id: "b", name: "Beta" }), ator({ _id: "a", name: "Alfa" })];
    expect(escolherAvatarDoUsuario(mundo, EU)?.actorId).toBe("a");
    const mesmoNome = [ator({ _id: "b", name: "Igual" }), ator({ _id: "a", name: "Igual" })];
    expect(escolherAvatarDoUsuario(mesmoNome, EU)?.actorId).toBe("a");
  });

  it("returns null without a user", () => {
    expect(escolherAvatarDoUsuario([ator({ _id: "a1" })], null)).toBeNull();
    expect(escolherAvatarDoUsuario([ator({ _id: "a1" })], "")).toBeNull();
  });
});
