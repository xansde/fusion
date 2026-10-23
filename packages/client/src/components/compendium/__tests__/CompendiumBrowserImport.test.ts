/**
 * The panel's two doors, and the one it does not have (G095).
 *
 * Spec 43 §5.7 — REQ-CPD-060 (the world door is privileged), REQ-CPD-061 (the
 * sheet door belongs to whoever OWNS the sheet), REQ-CPD-064 (the in-world seal
 * informs and never blocks) and REQ-CPD-066 (this panel neither creates a
 * document from scratch nor edits a pack document — authoring is spec 42's).
 *
 * Rendered with `render()` from `svelte/server`, like the sibling
 * `CompendiumBrowser.test.ts`: the client's Vitest has no DOM, so the
 * server-rendered markup is what a component test can read. `$effect` never
 * runs there, which is exactly the "no destination known yet" state — the one
 * where a panel must offer nothing rather than guess.
 *
 * The requirements about what must NOT exist (REQ-CPD-064's non-blocking seal,
 * REQ-CPD-066's absent authoring) are checked against the component's own
 * source, because absence has no markup. The wall itself is on the server —
 * `packages/server/src/__tests__/compendium-import-to-actor.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import CompendiumBrowser from "../CompendiumBrowser.svelte";
import "../../../lib/i18n/index.js";

function renderPanel(isGm: boolean): string {
  const { body } = render(CompendiumBrowser, {
    props: {
      socket: { connected: true, emit: () => undefined } as never,
      worldId: "world-1",
      userId: "user-1",
      isGm,
      activeSceneId: null,
    },
  });
  return body;
}

function source(): string {
  return readFileSync(
    fileURLToPath(new URL("../CompendiumBrowser.svelte", import.meta.url)),
    "utf8",
  );
}

describe("where the panel can bring an entry (REQ-CPD-060, REQ-CPD-061)", () => {
  it("REQ-CPD-061: a seat with no world door and no owned sheet is offered nothing", () => {
    const html = renderPanel(false);

    expect(html).not.toContain("compendium-browser__import");
    expect(html).not.toContain("compendium-browser__destination");
  });

  it("REQ-CPD-060: a privileged seat gets the import bar, because the world is a destination", () => {
    const html = renderPanel(true);

    expect(html).toContain("compendium-browser__import");
  });

  it("REQ-CPD-061: the sheet door goes through importToActor, never through the world call", () => {
    const src = source();

    expect(src).toContain("importToActor(socket");
    // The sheet call names the destination actor — that id is the whole point:
    // the server checks ownership of THAT document (REQ-CPD-073).
    expect(src).toMatch(/importToActor\(socket, \[line\.uuid\], target\.target\.actorId\)/);
  });

  it("REQ-CPD-060/061: every line is told which door it opens, so none can mislabel it", () => {
    const src = source();
    const importLines = src.split("\n").filter((line) => line.includes("onImport="));

    expect(importLines.length).toBeGreaterThan(0);
    // CA-CPD-009: the label follows the destination in force. A player has no
    // world door, so a line that never learns the destination would offer him
    // "trazer para o mundo" — the one action this tab must not show him.
    const destinationLines = src.split("\n").filter((line) => line.includes("importDestination="));
    expect(destinationLines).toHaveLength(importLines.length);
    for (const line of destinationLines) {
      expect(line).toContain("activeDestination.kind");
    }
  });

  it("REQ-CPD-061: the destinations come from the shared ownership rule, not a local guess", () => {
    const src = source();

    expect(src).toContain("buildSheetTargets(worldActors, viewer)");
    expect(src).toContain("canBringToSheet(");
  });
});

describe("what the panel must not do (REQ-CPD-064, REQ-CPD-066)", () => {
  it("REQ-CPD-064: the bring action is never gated on the in-world seal", () => {
    const src = source();
    const importLines = src.split("\n").filter((line) => line.includes("onImport="));

    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line).not.toContain("inWorld");
    }
    // And the decision function itself only reads the document type.
    expect(src).toMatch(/function canBring\(documentType: string\)/);
  });

  it("REQ-CPD-066: the panel offers no way to create a document from scratch", () => {
    const src = source();

    // Creating a document is `doc:create`; this panel never emits it, and never
    // sends a document update either — a pack document is not editable here.
    expect(src).not.toContain("doc:create");
    expect(src).not.toContain("doc:update");
  });
});
