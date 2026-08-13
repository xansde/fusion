/**
 * Per-viewer redaction of map pins — REQ-DOC-057/058.
 *
 * A Note is the first thing in the scene payload whose visibility is
 * **per user**, not per role. Hidden tokens, hidden tiles and secret doors are
 * all binary: the GM sees them, every player does not, so one player payload
 * can be built once and shared across every player socket. A pin breaks that
 * assumption — the same ruin can be unknown to Tobias, a rumour to Comedor and
 * a named place to a third player, in the same broadcast.
 *
 * Three states, from REQ-DOC-057:
 *
 *   none      → the note does not exist for the user. Not sent. Not counted.
 *   limited   → position only, plus the marker that says "something is here".
 *               No name, no icon, no tooltip, no entryId/pageId, no flags.
 *   observer+ → the whole thing.
 *
 * `global: true` reads as observer for everyone (REQ-DOC-056), and a
 * privileged role always sees the authored note.
 */

import { describe, it, expect } from "vitest";
import { OwnershipLevel, defaultNoteDocument } from "@fusion/shared";
import { UserRole } from "../documents/ownership.js";
import { redactNotesForViewer, sceneHasNotes, scenePayloadHasNotes } from "../net/redaction.js";

const GM = UserRole.GAMEMASTER;
const PLAYER = UserRole.PLAYER;

const HIDDEN_ID = "aaaaaaaaaaaaaaaa";
const RUMOUR_ID = "bbbbbbbbbbbbbbbb";
const KNOWN_ID = "cccccccccccccccc";
const GLOBAL_ID = "dddddddddddddddd";

/** A pin authored with everything a reveal would leak. */
function authoredNote(id: string, ownership: Record<string, number>) {
  return {
    ...defaultNoteDocument(id),
    entryId: "eeeeeeeeeeeeeeee",
    pageId: "ffffffffffffffff",
    x: 1200,
    y: 850,
    icon: "/assets/icons/ruin.webp",
    text: "Ruínas de Godford",
    flags: { fusion: { portal: { sceneId: "gggggggggggggggg" } } },
    ownership,
  };
}

function sceneWith(notes: unknown[]): Record<string, unknown> {
  return { _id: "hhhhhhhhhhhhhhhh", name: "Região", notes };
}

describe("redactNotesForViewer", () => {
  const scene = sceneWith([
    authoredNote(HIDDEN_ID, { default: OwnershipLevel.NONE }),
    authoredNote(RUMOUR_ID, { default: OwnershipLevel.NONE, tobias: OwnershipLevel.LIMITED }),
    authoredNote(KNOWN_ID, { default: OwnershipLevel.NONE, tobias: OwnershipLevel.OBSERVER }),
  ]);

  it("drops notes the viewer is at none on — not even an empty slot", () => {
    const out = redactNotesForViewer(scene, "tobias", PLAYER);
    const ids = (out["notes"] as Record<string, unknown>[]).map((n) => n["_id"]);

    expect(ids).not.toContain(HIDDEN_ID);
    expect(ids).toHaveLength(2);
  });

  it("reduces a rumour to position and nothing else (REQ-DOC-057)", () => {
    const out = redactNotesForViewer(scene, "tobias", PLAYER);
    const rumour = (out["notes"] as Record<string, unknown>[]).find((n) => n["_id"] === RUMOUR_ID);

    expect(rumour).toBeDefined();
    expect(rumour!["x"]).toBe(1200);
    expect(rumour!["y"]).toBe(850);
    // Everything a reveal would hand over is gone.
    expect(rumour!["text"]).toBeNull();
    expect(rumour!["icon"]).toBeNull();
    expect(rumour!["entryId"]).toBeNull();
    expect(rumour!["pageId"]).toBeNull();
    expect(rumour!["flags"]).toEqual({});
  });

  it("keeps the authored note for a viewer at observer", () => {
    const out = redactNotesForViewer(scene, "tobias", PLAYER);
    const known = (out["notes"] as Record<string, unknown>[]).find((n) => n["_id"] === KNOWN_ID);

    expect(known!["text"]).toBe("Ruínas de Godford");
    expect(known!["entryId"]).toBe("eeeeeeeeeeeeeeee");
    expect(known!["icon"]).toBe("/assets/icons/ruin.webp");
  });

  it("redacts per viewer: the same broadcast reads differently for two players", () => {
    const forTobias = redactNotesForViewer(scene, "tobias", PLAYER);
    const forComedor = redactNotesForViewer(scene, "comedor", PLAYER);

    expect((forTobias["notes"] as unknown[]).length).toBe(2);
    expect((forComedor["notes"] as unknown[]).length).toBe(0);
  });

  it("treats global: true as observer for everyone", () => {
    const globalScene = sceneWith([
      { ...authoredNote(GLOBAL_ID, { default: OwnershipLevel.NONE }), global: true },
    ]);
    const out = redactNotesForViewer(globalScene, "anyone", PLAYER);
    const pin = (out["notes"] as Record<string, unknown>[])[0];

    expect(pin!["text"]).toBe("Ruínas de Godford");
  });

  it("never redacts for a privileged role, and returns the same reference", () => {
    const out = redactNotesForViewer(scene, "gm-user", GM);

    expect(out).toBe(scene);
  });

  it("returns the same reference when the scene carries no notes", () => {
    const bare = { _id: "iiiiiiiiiiiiiiii", name: "Sem pinos" };

    expect(redactNotesForViewer(bare, "tobias", PLAYER)).toBe(bare);
  });

  it("does not mutate the authored scene", () => {
    redactNotesForViewer(scene, "tobias", PLAYER);
    const original = (scene["notes"] as Record<string, unknown>[])[1];

    expect(original!["text"]).toBe("Ruínas de Godford");
  });
});

describe("sceneHasNotes / scenePayloadHasNotes", () => {
  it("detects a scene carrying pins, so the cheap path can stay cheap", () => {
    expect(sceneHasNotes(sceneWith([defaultNoteDocument(HIDDEN_ID)]))).toBe(true);
    expect(sceneHasNotes(sceneWith([]))).toBe(false);
    expect(sceneHasNotes({ _id: "x" })).toBe(false);
    expect(sceneHasNotes(null)).toBe(false);
  });

  it("detects pins anywhere in a document payload", () => {
    expect(scenePayloadHasNotes([{ _id: "a" }, sceneWith([defaultNoteDocument(RUMOUR_ID)])])).toBe(
      true,
    );
    expect(scenePayloadHasNotes([{ _id: "a" }, sceneWith([])])).toBe(false);
  });
});
