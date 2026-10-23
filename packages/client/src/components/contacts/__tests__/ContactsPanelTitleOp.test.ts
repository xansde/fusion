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
 * it proves the fix in two halves. The first `it` proves the op-building
 * contract: the EXACT same `{ type: "doc:update", documentType: "Actor", id,
 * diff }` shape `commitTitle()` builds (documentType "Actor", `id: card.id`,
 * `diff: contactTitleDiff(next)`), passed through the funnel the fixed
 * component now uses (`toEnvelope`), comes out with `expectedVersion` filled
 * from the mirror. The second `it` proves the call site actually reaches that
 * funnel: it reads `ContactsPanel.svelte`'s own source (same `codeOf()` idiom
 * as ContactsPanelEmpty.test.ts) and asserts `commitTitle()` calls
 * `sendOp(socket, toEnvelope(op))` — never a hand-built wire envelope — so
 * reverting the call site fails this test even though `toEnvelope()` itself
 * is untouched.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toEnvelope } from "../../../lib/docs/sendOp.js";
import { DocumentMirror } from "../../../lib/docs/DocumentMirror.js";
import { contactTitleDiff } from "../../../lib/contacts/contactsVM.js";

const ACTOR_ID = "act-fofurinha01";

/** Same idiom as ContactsPanelEmpty.test.ts's codeOf(): source with comments
 * stripped, so prose (including this file's own doc-comments about the old
 * shape) is never mistaken for the code under test. */
function codeOf(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The body of ContactsPanel.svelte's commitTitle(), isolated so an assertion
 * about "the call site" can't accidentally match some other function. */
function commitTitleSource(): string {
  const code = codeOf("ContactsPanel.svelte");
  const start = code.indexOf("async function commitTitle");
  const end = code.indexOf("function onTitleKeydown", start);
  if (start === -1 || end === -1) {
    throw new Error("commitTitle() or its successor not found in ContactsPanel.svelte");
  }
  return code.slice(start, end);
}

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

  it("ContactsPanel.svelte's commitTitle() calls sendOp through toEnvelope, not a hand-built wire envelope (REQ-CTT-024, REQ-CTT-085)", () => {
    // This is the call-site half of the fix: the previous `it` proves that
    // *if* commitTitle's op is routed through toEnvelope(), expectedVersion
    // comes out filled — but nothing above touches ContactsPanel.svelte's own
    // source. Before the A001 fix, commitTitle() called
    // `sendOp(socket, { type: "doc:update", payload: { documentType, updates: [...] } })`
    // directly: a wire-shaped envelope built by hand, bypassing
    // toEnvelope()/fillExpectedVersion entirely — which is what made the
    // server reject it with "expectedVersion is required for Actor/<id> —
    // reload the document and retry" (doc-handlers.ts) for every
    // non-privileged writer. Reverting the call site to that shape must fail
    // this assertion, independent of what toEnvelope() itself does.
    const source = commitTitleSource();

    expect(source).toContain("sendOp(socket, toEnvelope(op))");
    expect(source).not.toContain("payload: {");
    expect(source).not.toContain("updates: [");
  });
});
