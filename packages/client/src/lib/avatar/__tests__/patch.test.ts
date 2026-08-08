/**
 * Tests for the save diff.
 *
 * These assert the exact SHAPE of the patch, including every explicit null,
 * because the nulls are the whole point: the server deep-merges, so an omitted
 * key is a key that survives. The matching end-to-end assertion — that this
 * shape really produces the intended document — lives in the server package
 * (`avatar-flag-merge.test.ts`), which is where the merge itself can be
 * exercised without the client importing @fusion/server (REQ-ARQ-003).
 */

import { describe, expect, it } from "vitest";
import { AVATAR_FLAG_PATH, type AvatarFlag } from "@fusion/shared";
import { diffDoAvatar } from "../patch.js";

function flag(selecao: AvatarFlag["selecao"], corpo = "male"): AvatarFlag {
  return { versao: 1, corpo, selecao, pin: "pin123" };
}

describe("diffDoAvatar", () => {
  it("writes the whole avatar when there was none", () => {
    const novo = flag({ body: { id: "body/body-color", cores: { cor: "ulpc:tan" } } });
    expect(diffDoAvatar(null, novo)).toEqual({
      [AVATAR_FLAG_PATH]: {
        versao: 1,
        corpo: "male",
        pin: "pin123",
        selecao: { body: { id: "body/body-color", cores: { cor: "ulpc:tan" } } },
      },
    });
  });

  it("nulls a slot the player unequipped", () => {
    const antes = flag({ body: { id: "body/body-color" }, hat: { id: "hat/tricorne" } });
    const depois = flag({ body: { id: "body/body-color" } });
    const diff = diffDoAvatar(antes, depois) as Record<string, { selecao: Record<string, unknown> }>;
    // Without this null the merge would keep the hat — "the hat came back".
    expect(diff[AVATAR_FLAG_PATH]?.selecao["hat"]).toBeNull();
    expect(diff[AVATAR_FLAG_PATH]?.selecao["body"]).toEqual({ id: "body/body-color" });
  });

  it("nulls the colours of a piece that was replaced", () => {
    const antes = flag({ hat: { id: "hat/barbarian", cores: { color_1: "ulpc:steel", hat_secondary: "ulpc:brown" } } });
    const depois = flag({ hat: { id: "hat/tricorne" } });
    const diff = diffDoAvatar(antes, depois) as Record<string, { selecao: Record<string, unknown> }>;
    expect(diff[AVATAR_FLAG_PATH]?.selecao["hat"]).toEqual({
      id: "hat/tricorne",
      cores: { color_1: null, hat_secondary: null },
    });
  });

  it("nulls only the channels that went away", () => {
    const antes = flag({ hat: { id: "hat/barbarian", cores: { color_1: "ulpc:steel", hat_secondary: "ulpc:brown" } } });
    const depois = flag({ hat: { id: "hat/barbarian", cores: { color_1: "ulpc:gold" } } });
    const diff = diffDoAvatar(antes, depois) as Record<string, { selecao: Record<string, unknown> }>;
    expect(diff[AVATAR_FLAG_PATH]?.selecao["hat"]).toEqual({
      id: "hat/barbarian",
      cores: { color_1: "ulpc:gold", hat_secondary: null },
    });
  });

  it("changes the body variant without touching the pieces", () => {
    const antes = flag({ body: { id: "body/body-color" } }, "male");
    const depois = flag({ body: { id: "body/body-color" } }, "female");
    const diff = diffDoAvatar(antes, depois) as Record<string, Record<string, unknown>>;
    expect(diff[AVATAR_FLAG_PATH]?.["corpo"]).toBe("female");
  });

  it("removes the avatar with a single null at the flag root", () => {
    expect(diffDoAvatar(flag({ body: { id: "body/body-color" } }), null)).toEqual({
      [AVATAR_FLAG_PATH]: null,
    });
  });

  it("omits `pin` instead of writing undefined", () => {
    const novo: AvatarFlag = { versao: 1, corpo: "male", selecao: { body: { id: "x" } } };
    const valor = (diffDoAvatar(null, novo) as Record<string, Record<string, unknown>>)[AVATAR_FLAG_PATH]!;
    expect("pin" in valor).toBe(false);
  });

  it("never leaves an empty `cores` object behind", () => {
    const novo = flag({ hat: { id: "hat/tricorne", cores: {} } });
    const valor = (diffDoAvatar(null, novo) as Record<string, { selecao: Record<string, unknown> }>)[AVATAR_FLAG_PATH]!;
    expect(valor.selecao["hat"]).toEqual({ id: "hat/tricorne" });
  });
});
