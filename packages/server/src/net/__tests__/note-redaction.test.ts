/**
 * note-redaction.test.ts - GM-only map pins (Scene.notes) never reach a player.
 *
 * Fail closed: a note is delivered to a non-privileged viewer only when it says
 * `gmOnly: false` explicitly; anything else (true, missing, malformed) stays home.
 */

import { describe, it, expect } from "vitest";
import {
  redactGmOnlyNotes,
  sceneHasGmOnlyNotes,
  redactSceneDocsForNonPrivileged,
  redactAckResultForNonPrivileged,
} from "../redaction.js";

const pub = { id: "n1", x: 1, y: 2, title: "Porta", text: "Rangeu", gmOnly: false };
const secret = { id: "n2", x: 3, y: 4, title: "Armadilha", text: "DC 25", gmOnly: true };
const legacy = { id: "n3", x: 5, y: 6, title: "Sem flag", text: "" };

const scene = (notes: unknown[]): Record<string, unknown> => ({
  _id: "s1",
  active: true,
  tokens: [],
  walls: [],
  notes,
});

describe("redactGmOnlyNotes", () => {
  it("keeps only notes explicitly public", () => {
    const out = redactGmOnlyNotes(scene([pub, secret, legacy, "junk", null]));
    expect(out["notes"]).toEqual([pub]);
  });

  it("returns the same reference when nothing needs cutting", () => {
    const s = scene([pub]);
    expect(redactGmOnlyNotes(s)).toBe(s);
    const noNotes: Record<string, unknown> = { _id: "x", tokens: [] };
    expect(redactGmOnlyNotes(noNotes)).toBe(noNotes);
  });

  it("detects a scene that needs the cut", () => {
    expect(sceneHasGmOnlyNotes(scene([pub, secret]))).toBe(true);
    expect(sceneHasGmOnlyNotes(scene([pub]))).toBe(false);
    expect(sceneHasGmOnlyNotes(null)).toBe(false);
  });
});

describe("emission paths", () => {
  it("scene broadcast/snapshot funnel drops the GM-only pins", () => {
    const [out] = redactSceneDocsForNonPrivileged([scene([pub, secret])], "u1");
    expect((out?.["notes"] as unknown[]).length).toBe(1);
    expect(JSON.stringify(out)).not.toContain("Armadilha");
  });

  it("an ack echoing the scene (documents and parent) drops them too", () => {
    const ack = {
      ok: true,
      result: {
        documentType: "Scene",
        documents: [scene([pub, secret])],
        parent: scene([secret, pub]),
      },
    };
    const out = redactAckResultForNonPrivileged(ack, undefined);
    expect(JSON.stringify(out)).not.toContain("Armadilha");
    expect(JSON.stringify(out)).toContain("Porta");
  });
});
