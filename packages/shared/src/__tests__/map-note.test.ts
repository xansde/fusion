import { describe, it, expect } from "vitest";
import {
  MapNoteSchema,
  NoteCreatePayloadSchema,
  NoteUpdatePayloadSchema,
  parseMapNotes,
  MAP_NOTE_TITLE_MAX,
} from "../map-note.js";

describe("MapNoteSchema", () => {
  it("accepts a pin and defaults text and playersCanEdit", () => {
    const n = MapNoteSchema.parse({ id: "a", x: 1, y: 2, title: " Porta ", gmOnly: false });
    expect(n.title).toBe("Porta");
    expect(n.text).toBe("");
    expect(n.playersCanEdit).toBe(false);
  });

  it("rejects an empty title, a long title and non-finite coordinates", () => {
    expect(MapNoteSchema.safeParse({ id: "a", x: 0, y: 0, title: " ", gmOnly: true }).success).toBe(
      false,
    );
    expect(
      MapNoteSchema.safeParse({
        id: "a",
        x: 0,
        y: 0,
        title: "x".repeat(MAP_NOTE_TITLE_MAX + 1),
        gmOnly: true,
      }).success,
    ).toBe(false);
    expect(
      MapNoteSchema.safeParse({ id: "a", x: Infinity, y: 0, title: "t", gmOnly: true }).success,
    ).toBe(false);
  });

  it("requires gmOnly on create but not on an update patch", () => {
    expect(
      NoteCreatePayloadSchema.safeParse({ sceneId: "s", note: { x: 0, y: 0, title: "t" } }).success,
    ).toBe(false);
    expect(
      NoteUpdatePayloadSchema.safeParse({ sceneId: "s", noteId: "n", patch: { text: "novo" } })
        .success,
    ).toBe(true);
  });
});

describe("parseMapNotes", () => {
  it("skips junk entries", () => {
    const list = parseMapNotes([
      { id: "a", x: 0, y: 0, title: "t", gmOnly: true },
      "junk",
      { id: "b" },
    ]);
    expect(list.map((n) => n.id)).toEqual(["a"]);
    expect(parseMapNotes(undefined)).toEqual([]);
  });
});
