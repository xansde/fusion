import { describe, it, expect } from "vitest";
import type { MapNote } from "@fusion/shared";
import {
  visibleNotes,
  noteAbilities,
  draftIsValid,
  createPayload,
  updatePayload,
  EMPTY_DRAFT,
} from "../noteModel.js";

const pub: MapNote = {
  id: "a",
  x: 1,
  y: 2,
  title: "Porta",
  text: "",
  gmOnly: false,
  playersCanEdit: false,
};
const secret: MapNote = { ...pub, id: "b", title: "Armadilha", gmOnly: true };

describe("visibleNotes", () => {
  it("shows everything to the GM and only public pins to a player", () => {
    expect(visibleNotes([pub, secret], true).map((n) => n.id)).toEqual(["a", "b"]);
    expect(visibleNotes([pub, secret], false).map((n) => n.id)).toEqual(["a"]);
  });

  it("ignores junk and a missing list", () => {
    expect(visibleNotes(undefined, true)).toEqual([]);
    expect(visibleNotes([1, null, { id: "x" }], true)).toEqual([]);
  });
});

describe("noteAbilities", () => {
  it("lets the GM do everything", () => {
    expect(noteAbilities(secret, true)).toEqual({ manage: true, editText: true });
  });

  it("lets a player edit text only where the GM allowed it, never manage", () => {
    expect(noteAbilities(pub, false)).toEqual({ manage: false, editText: false });
    expect(noteAbilities({ ...pub, playersCanEdit: true }, false)).toEqual({
      manage: false,
      editText: true,
    });
    expect(noteAbilities({ ...secret, playersCanEdit: true }, false).editText).toBe(false);
  });
});

describe("payload builders", () => {
  it("requires a non-blank title", () => {
    expect(draftIsValid(EMPTY_DRAFT)).toBe(false);
    expect(draftIsValid({ ...EMPTY_DRAFT, title: "  x " })).toBe(true);
  });

  it("builds a create payload with rounded coordinates and trimmed title", () => {
    const p = createPayload(
      "s1",
      { x: 10.6, y: 3.2 },
      { ...EMPTY_DRAFT, title: " Cofre ", gmOnly: true },
    );
    expect(p).toEqual({
      sceneId: "s1",
      note: { x: 11, y: 3, title: "Cofre", text: "", gmOnly: true, playersCanEdit: false },
    });
  });

  it("sends a player only title and text", () => {
    const draft = { title: "Novo", text: "t", gmOnly: true, playersCanEdit: true };
    expect(updatePayload("s", pub, draft, false).patch).toEqual({ title: "Novo", text: "t" });
    expect(updatePayload("s", pub, draft, true).patch).toEqual({
      title: "Novo",
      text: "t",
      gmOnly: true,
      playersCanEdit: true,
    });
  });
});
