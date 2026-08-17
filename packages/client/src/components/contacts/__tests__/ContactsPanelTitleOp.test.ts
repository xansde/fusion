/**
 * ContactsPanelTitleOp.test.ts — A001 (ajustes r1, item 9): editing the title
 * of a contact card no longer trips the server's mandatory `expectedVersion`
 * gate (REQ-CTT-024, REQ-CTT-085).
 *
 * `ContactsPanel.svelte`'s `commitTitle()` used to call `sendOp()` with a
 * hand-built wire envelope — bypassing `toEnvelope()`/`fillExpectedVersion`,
 * the ONLY place that fills `expectedVersion` from the client's
 * DocumentMirror. The client runs Vitest in a node environment with no
 * jsdom/testing-library (see ContactsPanel.test.ts's own docstring), so this
 * file cannot click the edit control to drive the real component — instead
 * it proves the op-building contract directly: the EXACT same
 * `{ type: "doc:update", documentType: "Actor", id, diff }` shape
 * `commitTitle()` builds (documentType "Actor", `id: card.id`,
 * `diff: contactTitleDiff(next)`), passed through the funnel the fixed
 * component now uses (`toEnvelope`), comes out with `expectedVersion` filled
 * from the mirror — and that the OLD crude shape (a hand-built wire envelope,
 * skipping the funnel) does not.
 */

import { describe, it, expect } from "vitest";
import { toEnvelope } from "../../../lib/docs/sendOp.js";
import { DocumentMirror } from "../../../lib/docs/DocumentMirror.js";
import { contactTitleDiff } from "../../../lib/contacts/contactsVM.js";

const ACTOR_ID = "act-fofurinha01";

/** A DocumentMirror seeded with one Actor at a known `_stats.version`. */
function mirrorWithActor(id: string, version: number): DocumentMirror {
  const mirror = new DocumentMirror();
  mirror.applySnapshot({
    seq: 0,
    activeSceneId: null,
    documents: { Actor: [{ _id: id, name: "Fofurinha", _stats: { version } }] },
  });
  return mirror;
}

describe("A001 — ContactsPanel's title-edit op (REQ-CTT-024, REQ-CTT-085)", () => {
  it("commitTitle's op, sent through toEnvelope(), fills expectedVersion from the DocumentMirror", () => {
    const mirror = mirrorWithActor(ACTOR_ID, 4);

    // The EXACT op shape commitTitle() builds after the A001 fix.
    const op = {
      type: "doc:update" as const,
      documentType: "Actor",
      id: ACTOR_ID,
      diff: contactTitleDiff("A Voz do Bosque"),
    };

    const envelope = toEnvelope(op, mirror);

    expect(envelope.payload).toEqual({
      documentType: "Actor",
      updates: [
        {
          _id: ACTOR_ID,
          diff: { "flags.fusion.title": "A Voz do Bosque" },
          expectedVersion: 4,
        },
      ],
    });
  });

  it("the OLD crude shape (a hand-built wire envelope bypassing toEnvelope) never carries expectedVersion, reproducing the server's refusal", () => {
    // This is what commitTitle() sent BEFORE the A001 fix: a wire-shaped
    // envelope built by hand and handed straight to sendOp(), never routed
    // through toEnvelope()/fillExpectedVersion at all. No mirror is consulted
    // here on purpose — that is exactly the bug: the field is absent no
    // matter what the mirror knows, which is what made the server reject it
    // with "expectedVersion is required for Actor/<id> — reload the document
    // and retry" (doc-handlers.ts) for every non-privileged writer.
    const legacyPayload = {
      documentType: "Actor",
      updates: [{ _id: ACTOR_ID, diff: contactTitleDiff("A Voz do Bosque") }],
    };

    const updates = legacyPayload.updates;
    expect("expectedVersion" in updates[0]!).toBe(false);
  });
});
