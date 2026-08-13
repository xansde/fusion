/**
 * canvasWiring — guards that the canvas interactions are actually REACHABLE.
 *
 * This is a source-level assertion on purpose, and it is worth the ugliness.
 *
 * Three times now a canvas feature has shipped fully implemented, fully unit
 * tested and completely unusable, because nothing constructed it:
 *
 *   1. the target marker — full chain end to end, no gesture on the map;
 *   2. deleteAsset — exported, no button ever called it;
 *   3. TokenInteractionManager and RulerStateMachine — both with green test
 *      files, neither ever constructed in production. Tokens rendered with
 *      eventMode="static" and could not be dragged by anyone; the ruler could
 *      not be started, so the remote-ruler receive path never ran either.
 *      Found by playing the world on 2026-08-07, not by the suite.
 *   4. WallsLayer and TokenAddDialog (issue #83) — WallsLayer had NO unit
 *      tests at all (see WallsLayer.test.ts, added afterwards) and was never
 *      `new`'d anywhere; TokenAddDialog was a complete component with no
 *      button that ever opened it. Neither showed up in a grep for its own
 *      import outside its own file. Found by a live-play sweep of the client
 *      tree on 2026-08-12, not by the suite.
 *
 * Construction alone does not mean reachable, either — issue #83's WallsLayer
 * shipped `new`'d but with its Draw-Wall button, `attachToElement`, and the
 * per-frame `setCamera` call all missing from a first pass at this file's own
 * assertions (found in review, 2026-08-12): the wiring existed enough to make
 * these checks pass while a GM's click on "Draw Wall" still did nothing (no
 * button), or a click landed at the wrong world coordinate (camera never
 * refreshed), or a drawn segment never got a DOM listener at all
 * (`attachToElement` never called). Grep-for-the-symbol is only as good as
 * the FULL list of symbols a feature needs to actually work end to end.
 *
 * Every unit test in this repo asks "does this piece work?". None asked "can a
 * person reach it?". A test that mounts Svelte + PIXI + a socket would answer
 * that properly but needs a browser environment the client suite does not have
 * (environment: "node"). Until it does, this asserts the cheap half: the
 * wiring call-sites exist in the component that owns the canvas.
 *
 * If you renamed something and this failed: do not delete the assertion —
 * point it at the new call-site. A green suite with an unreachable feature is
 * exactly the failure this file exists to make loud.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TABLE_SCREEN = fileURLToPath(
  new URL("../../../components/TableScreen.svelte", import.meta.url),
);

const source = readFileSync(TABLE_SCREEN, "utf8");

describe("TableScreen wires the canvas interactions", () => {
  it("constructs the TokenInteractionManager — otherwise no token can be dragged", () => {
    expect(source).toMatch(/new TokenInteractionManager\(/);
  });

  it("destroys the TokenInteractionManager — its window keydown listener leaks otherwise", () => {
    expect(source).toMatch(/tokenInteraction\?\.destroy\(\)/);
  });

  it("attaches the ruler — otherwise no measurement can be started", () => {
    expect(source).toMatch(/attachRuler\(/);
  });

  it("disposes the ruler on scene switch", () => {
    expect(source).toMatch(/disposeRuler\?\.\(\)/);
  });

  it("feeds token interaction the scene's grid strategy, not a hardcoded size", () => {
    expect(source).toMatch(/canvas\.gridStrategy/);
  });

  it("constructs the WallsLayer — otherwise no wall can ever be drawn (#83)", () => {
    expect(source).toMatch(/new WallsLayer\(/);
  });

  it("destroys the WallsLayer and its mirror subscription on scene switch", () => {
    expect(source).toMatch(/wallsLayer\?\.destroy\(\)/);
    expect(source).toMatch(/disposeWallsSync\?\.\(\)/);
  });

  it("wires a real Draw Wall trigger — otherwise the GM has no gesture to start drawing", () => {
    expect(source).toMatch(/function toggleWallDrawing\(/);
    expect(source).toMatch(/onclick=\{toggleWallDrawing\}/);
  });

  it("attaches WallsLayer to the canvas element — otherwise startDrawing() registers no DOM listener", () => {
    expect(source).toMatch(/newWallsLayer\.attachToElement\(canvasContainer\)/);
  });

  it("feeds WallsLayer a fresh camera every tick — otherwise drawn points land at a stale screen→world offset", () => {
    expect(source).toMatch(/wallsLayer\?\.setCamera\(canvas\.camera\)/);
  });

  it("mounts TokenAddDialog behind a real trigger — otherwise no GM can reach it (#83)", () => {
    expect(source).toMatch(/<TokenAddDialog/);
    expect(source).toMatch(/showingTokenAddDialog\s*=\s*true/);
  });
});

// ---------------------------------------------------------------------------
// #81 — scene-switch teardown race
//
// sceneLoadGeneration.test.ts only unit-tests isCurrentGeneration (a one-line
// equality helper) in isolation — its 4 assertions reaffirm that helper's own
// definition and would stay green even if TableScreen stopped calling it
// entirely, or stopped bumping the counter, or stopped returning the effect
// cleanup. It is the only place #81's actual fix lived, and until this file
// none of it was checked (found in review, 2026-08-12). These are the
// source-level counterparts, same rationale as the rest of this file: does
// TableScreen still WIRE the fix, not "does the helper it calls work".
// ---------------------------------------------------------------------------

describe("TableScreen guards the scene-switch teardown race (#81)", () => {
  it("stamps every effect run with its own generation before awaiting anything", () => {
    expect(source).toMatch(/const myGeneration = \+\+sceneLoadGeneration;/);
  });

  it("returns the previous load's teardown as the $effect's own cleanup — Svelte 5 runs this before the NEXT run's body, pairing load N with teardown-of-N at the end of its lifetime instead of the start of load N+1's", () => {
    expect(source).toMatch(
      /return \(\) => \{\s*_teardownOrchestrator\(\);\s*cleanupScene\?\.\(\);\s*cleanupScene = null;\s*\};/,
    );
  });

  it("bumps the generation counter on unmount too — otherwise a load still in flight when TableScreen unmounts could publish after the component is gone", () => {
    expect(source).toMatch(/sceneLoadGeneration\+\+/);
  });

  it("the second stale checkpoint (after orchestrator.setup()) snapshots this generation's own resources into locals, and disposes THOSE — never the shared fields, which a newer generation may already have overwritten by the time this continuation resumes", () => {
    expect(source).toMatch(/const thisGenOrchestrator = sceneOrchestrator;/);
    expect(source).toMatch(/const thisGenWallsLayer = wallsLayer;/);
    expect(source).toMatch(/const thisGenTokenInteraction = tokenInteraction;/);
    expect(source).toMatch(/thisGenOrchestrator\.teardown\(\);/);
    expect(source).toMatch(/thisGenWallsLayer\?\.destroy\(\);/);
    expect(source).toMatch(/thisGenTokenInteraction\?\.destroy\(\);/);
  });

  it("the second stale checkpoint never calls the shared-field _teardownOrchestrator() helper — that would tear down whatever a NEWER generation already published there, reproducing #81 one await deeper (found in review)", () => {
    const setupIdx = source.indexOf("await sceneOrchestrator.setup();");
    expect(setupIdx).toBeGreaterThan(-1);
    const afterSetup = source.slice(setupIdx);
    const staleBlockEnd = afterSetup.indexOf("return;");
    expect(staleBlockEnd).toBeGreaterThan(-1);
    const staleBlock = afterSetup.slice(0, staleBlockEnd);
    expect(staleBlock).not.toMatch(/_teardownOrchestrator\(\)/);
  });
});
