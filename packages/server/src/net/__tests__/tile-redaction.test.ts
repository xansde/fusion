/**
 * Hidden tiles must NEVER reach a non-GM socket.
 *
 * A scene can be composed of several images, and `hidden` on a tile is the GM
 * saying "not yet" — the flooded lower level, the room past the door, the
 * after version of the courtyard. Sending the tile and trusting the client not
 * to draw it would put the reveal one devtools panel away, so the tile is
 * removed from the payload entirely.
 *
 * The M1-C hidden-token saga is the reason these tests exist in this shape:
 * three emission paths were fixed and the fourth (the ack echoed back to the
 * requester) leaked the whole Scene, with the guard tests passing throughout.
 * The four paths are:
 *   1. join snapshot        — buildSnapshot        → stripHiddenTiles
 *   2. live broadcast       — broadcastToWorld     → stripHiddenTiles
 *   3. delta resync replay  — filterOpsForRole     → stripHiddenTiles
 *   4. ack echoed to sender — redactAckResultForNonPrivileged
 *
 * Paths 1–3 call stripHiddenTiles directly, so they are covered by testing it
 * plus the detectors that gate them. Path 4 has its own structural walk and is
 * tested through its real entry point below.
 */

import { describe, it, expect } from "vitest";
import {
  stripHiddenTiles,
  sceneHasHiddenTiles,
  scenePayloadHasHiddenTiles,
  redactAckResultForNonPrivileged,
} from "../redaction.js";

const VISIBLE_TILE = { _id: "tileVisible00001", name: "Térreo", texture: "/assets/a.webp" };
const SECRET_TILE = {
  _id: "tileSecret000001",
  name: "Porão inundado",
  texture: "/assets/porao.webp",
  hidden: true,
};

const scene = (tiles: unknown[]): Record<string, unknown> => ({
  _id: "scene00000000001",
  name: "Cripta",
  tiles,
});

describe("stripHiddenTiles", () => {
  it("removes a hidden tile", () => {
    const result = stripHiddenTiles(scene([VISIBLE_TILE, SECRET_TILE]));
    expect(result["tiles"]).toEqual([VISIBLE_TILE]);
  });

  it("removes the tile entirely — the texture path must not survive", () => {
    const serialized = JSON.stringify(stripHiddenTiles(scene([VISIBLE_TILE, SECRET_TILE])));
    expect(serialized).not.toContain("porao.webp");
    expect(serialized).not.toContain("Porão inundado");
  });

  it("keeps everything when nothing is hidden, without allocating", () => {
    const original = scene([VISIBLE_TILE]);
    expect(stripHiddenTiles(original)).toBe(original);
  });

  it("leaves a document with no tiles array alone", () => {
    const actor = { _id: "actor00000000001", name: "Torvin" };
    expect(stripHiddenTiles(actor)).toBe(actor);
  });

  it("does not mutate the document it was given", () => {
    const original = scene([VISIBLE_TILE, SECRET_TILE]);
    stripHiddenTiles(original);
    expect((original["tiles"] as unknown[]).length).toBe(2);
  });

  it("removes every hidden tile, not just the first", () => {
    const second = { ...SECRET_TILE, _id: "tileSecret000002" };
    const result = stripHiddenTiles(scene([SECRET_TILE, VISIBLE_TILE, second]));
    expect(result["tiles"]).toEqual([VISIBLE_TILE]);
  });

  it("treats only a literal true as hidden", () => {
    // A truthy-but-not-true value would be a schema violation; failing open
    // here would be the wrong direction, but failing closed on `false` would
    // hide tiles the GM meant to show. Zod guarantees a boolean upstream.
    const odd = { _id: "tileOdd000000001", hidden: false };
    expect(stripHiddenTiles(scene([odd]))["tiles"]).toEqual([odd]);
  });
});

describe("the fast-path detectors that gate the strip", () => {
  it("sees a hidden tile", () => {
    expect(sceneHasHiddenTiles(scene([VISIBLE_TILE, SECRET_TILE]))).toBe(true);
  });

  it("reports nothing to do when all tiles are visible", () => {
    expect(sceneHasHiddenTiles(scene([VISIBLE_TILE]))).toBe(false);
  });

  it("survives junk instead of a document", () => {
    expect(sceneHasHiddenTiles(null)).toBe(false);
    expect(sceneHasHiddenTiles("scene")).toBe(false);
    expect(sceneHasHiddenTiles({ tiles: "not an array" })).toBe(false);
  });

  it("scans a whole batch", () => {
    expect(scenePayloadHasHiddenTiles([scene([VISIBLE_TILE]), scene([SECRET_TILE])])).toBe(true);
    expect(scenePayloadHasHiddenTiles([scene([VISIBLE_TILE])])).toBe(false);
    expect(scenePayloadHasHiddenTiles([])).toBe(false);
  });
});

describe("path 4 — the ack echoed back to the requester", () => {
  it("redacts tiles in the documents array", () => {
    const ack = {
      ok: true,
      result: { documentType: "Scene", documents: [scene([VISIBLE_TILE, SECRET_TILE])] },
    };
    const redacted = redactAckResultForNonPrivileged(ack) as {
      result: { documents: Array<Record<string, unknown>> };
    };
    expect(redacted.result.documents[0]?.["tiles"]).toEqual([VISIBLE_TILE]);
  });

  it("redacts tiles in the parent scene of an embedded op", () => {
    // Moving a token echoes the whole parent Scene back — the path that leaked
    // hidden tokens in M1-C.
    const ack = {
      ok: true,
      result: {
        documentType: "Token",
        documents: [{ _id: "token00000000001" }],
        parent: scene([VISIBLE_TILE, SECRET_TILE]),
      },
    };
    const redacted = redactAckResultForNonPrivileged(ack) as {
      result: { parent: Record<string, unknown> };
    };
    expect(redacted.result.parent["tiles"]).toEqual([VISIBLE_TILE]);
    expect(JSON.stringify(redacted)).not.toContain("porao.webp");
  });

  it("leaves an ack with nothing hidden untouched", () => {
    const ack = {
      ok: true,
      result: { documentType: "Scene", documents: [scene([VISIBLE_TILE])] },
    };
    expect(redactAckResultForNonPrivileged(ack)).toBe(ack);
  });

  it("does not mutate the original ack — the GM's copy must stay whole", () => {
    const original = scene([VISIBLE_TILE, SECRET_TILE]);
    const ack = { ok: true, result: { documentType: "Scene", documents: [original] } };
    redactAckResultForNonPrivileged(ack);
    expect((original["tiles"] as unknown[]).length).toBe(2);
  });

  it("redacts tiles alongside hidden tokens in the same scene", () => {
    const mixed = {
      _id: "scene00000000002",
      tokens: [{ _id: "tokenHidden00001", hidden: true }, { _id: "tokenVisible0001" }],
      tiles: [VISIBLE_TILE, SECRET_TILE],
    };
    const ack = { ok: true, result: { documentType: "Scene", documents: [mixed] } };
    const redacted = redactAckResultForNonPrivileged(ack) as {
      result: { documents: Array<Record<string, unknown>> };
    };
    const doc = redacted.result.documents[0];
    expect(doc?.["tiles"]).toEqual([VISIBLE_TILE]);
    expect(doc?.["tokens"]).toEqual([{ _id: "tokenVisible0001" }]);
  });

  it("leaves an error ack alone", () => {
    const ack = { ok: false, error: { code: "PERMISSION_DENIED" } };
    expect(redactAckResultForNonPrivileged(ack)).toBe(ack);
  });
});
