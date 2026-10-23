/**
 * canvasDragTypes.test.ts — the canvas drop zone accepts a drag from its MIME
 * type alone, never from `getData()` (REQ-UIF-045).
 *
 * The e2e for token-fase1 found that `handleCanvasDragOver` (`TableScreen.svelte`)
 * never fired `preventDefault()` on a real drag: it read `_getActorDragPayload`/
 * `_getCompendiumDragPayload`, both calling `event.dataTransfer.getData(...)` — a
 * call that HTML5 DnD spec always answers with `""` during `dragover` ("protected
 * mode"), no payload ever readable before `drop`. `hasActorDragType`/
 * `hasCompendiumDragType` are the fix: each test below hands a `dataTransfer`-like
 * object with `types` populated but with NO `getData` method defined at all — so if
 * either function regressed to calling `getData()`, the call would throw
 * "getData is not a function" and the test would fail for that reason, not pass by
 * accident on an empty string.
 */

import { describe, expect, it } from "vitest";

import { hasActorDragType, hasCompendiumDragType } from "../canvasDragTypes.js";
import { NPC_DRAG_MIME } from "../../npcs/moveActor.js";

/** A `dataTransfer` as the browser hands it during `dragover`: types only. */
function protectedModeDataTransfer(types: readonly string[]): Pick<DataTransfer, "types"> {
  return { types: types as unknown as DataTransfer["types"] };
}

describe("REQ-UIF-045: hasActorDragType reads dataTransfer.types, never getData", () => {
  it("accepts a drag carrying the actor MIME during protected mode (dragover)", () => {
    const dt = protectedModeDataTransfer([NPC_DRAG_MIME]);
    expect(hasActorDragType(dt)).toBe(true);
  });

  it("refuses a drag that does not carry the actor MIME", () => {
    const dt = protectedModeDataTransfer(["text/plain"]);
    expect(hasActorDragType(dt)).toBe(false);
  });

  it("refuses a missing dataTransfer without throwing", () => {
    expect(hasActorDragType(null)).toBe(false);
    expect(hasActorDragType(undefined)).toBe(false);
  });
});

describe("REQ-UIF-045: hasCompendiumDragType reads dataTransfer.types, never getData", () => {
  it("accepts a drag carrying text/plain during protected mode (dragover)", () => {
    const dt = protectedModeDataTransfer(["text/plain"]);
    expect(hasCompendiumDragType(dt)).toBe(true);
  });

  it("refuses a drag with no text/plain type at all", () => {
    const dt = protectedModeDataTransfer([NPC_DRAG_MIME]);
    expect(hasCompendiumDragType(dt)).toBe(false);
  });

  it("refuses a missing dataTransfer without throwing", () => {
    expect(hasCompendiumDragType(null)).toBe(false);
    expect(hasCompendiumDragType(undefined)).toBe(false);
  });
});
