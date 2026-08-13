/**
 * NoteDocument — map pins with their own ownership.
 *
 * Spec 02 §NoteData + REQ-DOC-056/057: a Note is the second exception to
 * REQ-DOC-025 (embedded documents inherit the parent's ownership). It carries
 * its own ownership map because a pin's visibility is per-player: the same
 * ruin is unknown to one character, a rumour to another and a place on the map
 * to a third.
 *
 * The rule that matters most here is the default: every pin is born hidden
 * (`ownership.default = NONE`). Revealing is a deliberate act — a pin that
 * defaults to visible leaks the map the moment the GM drops it.
 */

import { describe, it, expect } from "vitest";
import {
  NoteDocumentSchema,
  defaultNoteDocument,
  SceneDocumentSchema,
  defaultSceneDocument,
} from "../scene.js";
import { OwnershipLevel } from "../document.js";

const ID = "aaaaaaaaaaaaaaaa";
const ID2 = "bbbbbbbbbbbbbbbb";

describe("NoteDocumentSchema", () => {
  it("is born hidden from everyone (REQ-DOC-056)", () => {
    const note = defaultNoteDocument(ID);

    expect(note.ownership).toEqual({ default: OwnershipLevel.NONE });
    expect(note.global).toBe(false);
  });

  it("keeps the soft references to the linked journal entry and page", () => {
    const note = NoteDocumentSchema.parse({
      _id: ID,
      entryId: "cccccccccccccccc",
      pageId: "dddddddddddddddd",
      x: 1200,
      y: 850,
    });

    expect(note.entryId).toBe("cccccccccccccccc");
    expect(note.pageId).toBe("dddddddddddddddd");
    expect(note.x).toBe(1200);
    expect(note.y).toBe(850);
  });

  it("defaults the display fields so a pin renders without configuration", () => {
    const note = defaultNoteDocument(ID);

    expect(note.entryId).toBeNull();
    expect(note.pageId).toBeNull();
    expect(note.icon).toBeNull();
    expect(note.iconSize).toBeGreaterThan(0);
    expect(note.text).toBeNull();
    expect(note.fontSize).toBeGreaterThan(0);
    expect(note.elevation).toBe(0);
    expect(note.flags).toEqual({});
  });

  it("accepts a per-user ownership map with the three reveal states", () => {
    const note = NoteDocumentSchema.parse({
      _id: ID,
      ownership: {
        default: OwnershipLevel.NONE,
        "user-rumour": OwnershipLevel.LIMITED,
        "user-knows": OwnershipLevel.OBSERVER,
      },
    });

    expect(note.ownership["user-rumour"]).toBe(OwnershipLevel.LIMITED);
    expect(note.ownership["user-knows"]).toBe(OwnershipLevel.OBSERVER);
  });

  it("rejects an _id that is not a 16-char document id", () => {
    expect(() => NoteDocumentSchema.parse({ _id: "short" })).toThrow();
  });
});

describe("Scene.notes", () => {
  it("is typed: a malformed pin does not survive a scene parse", () => {
    expect(() =>
      SceneDocumentSchema.parse({
        ...defaultSceneDocument(ID),
        notes: [{ nonsense: true }],
      }),
    ).toThrow();
  });

  it("round-trips typed pins through the scene", () => {
    const scene = SceneDocumentSchema.parse({
      ...defaultSceneDocument(ID),
      notes: [defaultNoteDocument(ID2)],
    });

    expect(scene.notes).toHaveLength(1);
    expect(scene.notes[0]?._id).toBe(ID2);
    expect(scene.notes[0]?.ownership).toEqual({ default: OwnershipLevel.NONE });
  });
});
