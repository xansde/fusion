/**
 * Tests for the avatar flag contract.
 *
 * The flag is written by the client into an UNVALIDATED region of the document
 * (`flags.*` is `Record<string, unknown>` on the server), so every guarantee the
 * renderer relies on has to be enforced on read. These tests pin that: junk in
 * the flag degrades to "no avatar", never to a throw.
 */

import { describe, expect, it } from "vitest";
import {
  AVATAR_FLAG_KEY,
  AVATAR_FLAG_PATH,
  AVATAR_FLAG_SCOPE,
  AVATAR_FORMAT_VERSION,
  AvatarFlagSchema,
  hasAvatar,
  readAvatarFlag,
} from "../avatar.js";

/** A document carrying `avatar` in the fusion flag namespace. */
function docWith(avatar: unknown): Record<string, unknown> {
  return { _id: "a".repeat(16), flags: { [AVATAR_FLAG_SCOPE]: { [AVATAR_FLAG_KEY]: avatar } } };
}

const VALID = {
  versao: 1,
  corpo: "female",
  selecao: {
    body: { id: "body/body-color", cores: { cor: "ulpc:tan" } },
    head: { id: "head/human-female" },
    hair: { id: "hair/large-curls", cores: { cor: "ulpc:black" } },
  },
  pin: "0f898bb675a1abe16ce430e82e3bf9daed278690",
};

describe("AVATAR_FLAG_PATH", () => {
  it("is the dot path a doc:update patch uses", () => {
    expect(AVATAR_FLAG_PATH).toBe("flags.fusion.avatar");
  });
});

describe("readAvatarFlag", () => {
  it("reads a well-formed avatar back verbatim", () => {
    expect(readAvatarFlag(docWith(VALID))).toEqual(VALID);
  });

  it("keeps every colour channel of a multi-channel piece", () => {
    const helmet = {
      corpo: "male",
      selecao: { hat: { id: "hat/barbarian", cores: { color_1: "ulpc:steel", hat_secondary: "ulpc:brown" } } },
    };
    const read = readAvatarFlag(docWith(helmet));
    expect(read?.selecao["hat"]?.cores).toEqual({
      color_1: "ulpc:steel",
      hat_secondary: "ulpc:brown",
    });
  });

  it("defaults the format version when an older write omitted it", () => {
    const read = readAvatarFlag(docWith({ corpo: "male", selecao: { body: { id: "body/body-color" } } }));
    expect(read?.versao).toBe(AVATAR_FORMAT_VERSION);
  });

  it("returns null when there is no flag at all", () => {
    expect(readAvatarFlag({ _id: "a".repeat(16) })).toBeNull();
    expect(readAvatarFlag({ _id: "a".repeat(16), flags: {} })).toBeNull();
    expect(readAvatarFlag({ _id: "a".repeat(16), flags: { fusion: {} } })).toBeNull();
  });

  it("treats an explicit null (the deleteKey write) as no avatar", () => {
    expect(readAvatarFlag(docWith(null))).toBeNull();
  });

  it("treats an empty selection as no avatar", () => {
    expect(readAvatarFlag(docWith({ corpo: "male", selecao: {} }))).toBeNull();
  });

  it("refuses junk instead of throwing", () => {
    expect(readAvatarFlag(docWith("uma string"))).toBeNull();
    expect(readAvatarFlag(docWith(42))).toBeNull();
    expect(readAvatarFlag(docWith({ selecao: { body: { id: "x" } } }))).toBeNull(); // no corpo
    expect(readAvatarFlag(docWith({ corpo: "", selecao: { body: { id: "x" } } }))).toBeNull();
    expect(readAvatarFlag(docWith({ corpo: "male", selecao: { body: {} } }))).toBeNull(); // piece with no id
    expect(readAvatarFlag(docWith({ corpo: "male", selecao: { body: { id: "x", cores: { cor: 7 } } } }))).toBeNull();
  });

  it("survives non-object documents", () => {
    expect(readAvatarFlag(null)).toBeNull();
    expect(readAvatarFlag(undefined)).toBeNull();
    expect(readAvatarFlag("actor")).toBeNull();
    expect(readAvatarFlag({ flags: "nope" })).toBeNull();
  });
});

describe("hasAvatar", () => {
  it("agrees with readAvatarFlag", () => {
    expect(hasAvatar(docWith(VALID))).toBe(true);
    expect(hasAvatar(docWith({ corpo: "male", selecao: {} }))).toBe(false);
    expect(hasAvatar({})).toBe(false);
  });
});

describe("AvatarFlagSchema", () => {
  it("accepts a body variant the acervo may add later", () => {
    // The variant list belongs to the acervo's `recorte`, not to this schema —
    // pinning an enum here would make an acervo bump fail validation.
    const parsed = AvatarFlagSchema.safeParse({
      corpo: "skeleton",
      selecao: { body: { id: "body/body-color" } },
    });
    expect(parsed.success).toBe(true);
  });
});
