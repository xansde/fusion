/**
 * tokenAddDialogOp.test.ts — the op `TokenAddDialog.svelte` sends to add a
 * token to the active scene (A004, ajustes r1 item 22).
 *
 * Covers REQ-NPC-060 (the write that lands a token onto the scene on air —
 * here proved for the dialog's own call site, the sibling of
 * `npcsFooter.ts`'s `buildPlaceChestTokenOp`, which sends the identical
 * shape).
 *
 * Before this fix, `TokenAddDialog.svelte` built this op inline as a
 * `doc:update` with `diff: { tokens: { $push: {...} } }` — an object the
 * server's Zod schema (`tokens: z.array(TokenDocumentSchema)`) rejects with
 * `tokens: Expected array, received object`. Sending the whole `tokens` array
 * back through `doc:update` is not the fix either — the server's
 * `rejectUnwritableField` refuses that too, on purpose ("Scene.tokens is not
 * writable as a whole through doc:update — use embedded operations"). The
 * real fix — an embedded `doc:create` — is reproduced at the wire level in
 * `packages/server/src/__tests__/scene-tokens-embedded-create.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { buildAddTokenOp, type TokenAddFormData } from "../tokenAddDialogOp.js";

function form(overrides: Partial<TokenAddFormData> = {}): TokenAddFormData {
  return {
    name: "Goblin Warrior",
    texture: "",
    x: 10,
    y: 20,
    width: 1,
    height: 1,
    ...overrides,
  };
}

describe("REQ-NPC-060: buildAddTokenOp sends an embedded doc:create, never a $push nor a whole-array doc:update", () => {
  it("is a doc:create of exactly one Token, parented to the scene", () => {
    const op = buildAddTokenOp("scn-clareira001", form());

    expect(op.type).toBe("doc:create");
    expect(op.payload.documentType).toBe("Token");
    expect(op.payload.parent).toEqual({ type: "Scene", id: "scn-clareira001" });
    expect(op.payload.data).toHaveLength(1);
    expect(op.payload.data[0]?.["name"]).toBe("Goblin Warrior");
    expect(op.payload.data[0]?.["x"]).toBe(10);
    expect(op.payload.data[0]?.["y"]).toBe(20);
  });

  it("REQ-NPC-060: never carries a $push pseudo-operator, and never a tokens array (the two rejected old shapes)", () => {
    const op = buildAddTokenOp("scn-clareira001", form());

    expect(JSON.stringify(op)).not.toContain("$push");
    expect(op.payload).not.toHaveProperty("updates");
    expect(op.payload.data[0]).not.toHaveProperty("tokens");
  });

  it("does not send a client-supplied _id — the server mints it (handleEmbeddedCreate)", () => {
    const op = buildAddTokenOp("scn-clareira001", form());

    expect(op.payload.data[0]).not.toHaveProperty("_id");
  });

  it("trims the name and treats a blank texture as null — same validation the dialog already applied", () => {
    const op = buildAddTokenOp("scn-clareira001", form({ name: "  Goblin  ", texture: "  " }));

    expect(op.payload.data[0]?.["name"]).toBe("Goblin");
    expect(op.payload.data[0]?.["texture"]).toBeNull();
  });
});
