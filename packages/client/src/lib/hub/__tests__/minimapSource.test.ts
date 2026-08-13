/**
 * minimapSource.test.ts — what the minimap is allowed to draw, and when it redraws.
 *
 * The two rules under test are the ones that make the widget safe:
 *   - it draws the canvas's own token list, never a list of its own (DEC-MMT-02);
 *   - it redraws once per frame no matter how many updates landed (CA-MMT-04).
 */

import { describe, it, expect } from "vitest";
import { defaultSceneDocument, defaultTokenDocument } from "@fusion/shared";
import type { SceneDocument, TokenDocument } from "@fusion/shared";
import {
  collectMinimapTokens,
  minimapSceneFrom,
  snapshotChanged,
  type MinimapSnapshot,
} from "../minimapSource.js";

const tokenDoc = (id: string, over: Partial<TokenDocument> = {}): TokenDocument => ({
  ...defaultTokenDocument(id.padEnd(16, "0")),
  ...over,
});

const sceneDoc = (over: Partial<SceneDocument> = {}): SceneDocument => ({
  ...defaultSceneDocument("scene00000000001".padEnd(16, "0")),
  ...over,
});

const snapshot = (over: Partial<MinimapSnapshot> = {}): MinimapSnapshot => ({
  scene: { width: 1000, height: 800, backgroundColor: "#000", background: null, thumb: null },
  gridSize: 100,
  tokens: [],
  camera: { tx: 0, ty: 0, scale: 1 },
  viewportWidth: 800,
  viewportHeight: 600,
  ...over,
});

// ---------------------------------------------------------------------------
// collectMinimapTokens (DEC-MMT-02, REQ-MMT-005)
// ---------------------------------------------------------------------------

describe("collectMinimapTokens", () => {
  it("keeps only the tokens the canvas says it is drawing", () => {
    const drawn = tokenDoc("a");
    const notDrawn = tokenDoc("b");
    const result = collectMinimapTokens([drawn, notDrawn], new Set([drawn._id]), new Set<string>());
    expect(result.map((t) => t.id)).toEqual([drawn._id]);
  });

  it("draws nothing when the canvas is drawing nothing", () => {
    expect(collectMinimapTokens([tokenDoc("a")], new Set(), new Set())).toEqual([]);
  });

  it("never invents a token the canvas did not report", () => {
    // The visible set naming an id that is not in the scene must not conjure it.
    const result = collectMinimapTokens([], new Set(["ghost00000000000"]), new Set());
    expect(result).toEqual([]);
  });

  it("marks a token as controlled when the user owns its actor", () => {
    const mine = tokenDoc("a", { actorId: "actor-1" });
    const theirs = tokenDoc("b", { actorId: "actor-2" });
    const result = collectMinimapTokens(
      [mine, theirs],
      new Set([mine._id, theirs._id]),
      new Set(["actor-1"]),
    );
    expect(result.find((t) => t.id === mine._id)?.controlled).toBe(true);
    expect(result.find((t) => t.id === theirs._id)?.controlled).toBe(false);
  });

  it("treats an actorless token as not controlled", () => {
    const [marker] = collectMinimapTokens(
      [tokenDoc("a", { actorId: null })],
      new Set(["a".padEnd(16, "0")]),
      new Set(["actor-1"]),
    );
    expect(marker?.controlled).toBe(false);
  });

  it("carries position, footprint, disposition, hidden and name through untouched", () => {
    const doc = tokenDoc("a", {
      name: "Fofurinha",
      x: 320,
      y: 640,
      width: 2,
      height: 3,
      disposition: -1,
      hidden: true,
    });
    const [marker] = collectMinimapTokens([doc], new Set([doc._id]), new Set());
    expect(marker).toMatchObject({
      id: doc._id,
      name: "Fofurinha",
      x: 320,
      y: 640,
      width: 2,
      height: 3,
      disposition: -1,
      hidden: true,
    });
  });
});

// ---------------------------------------------------------------------------
// minimapSceneFrom
// ---------------------------------------------------------------------------

describe("minimapSceneFrom", () => {
  it("takes only the fields the widget draws", () => {
    const doc = sceneDoc({
      width: 3000,
      height: 1500,
      backgroundColor: "#123456",
      background: "/maps/room.webp",
    });
    expect(minimapSceneFrom(doc)).toEqual({
      width: 3000,
      height: 1500,
      backgroundColor: "#123456",
      background: "/maps/room.webp",
      thumb: null,
    });
  });

  it("passes null through", () => {
    expect(minimapSceneFrom(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// snapshotChanged — coalescing (REQ-MMT-012, CA-MMT-04)
// ---------------------------------------------------------------------------

describe("snapshotChanged", () => {
  it("sees no change between two identical readings", () => {
    expect(snapshotChanged(snapshot(), snapshot())).toBe(false);
  });

  it("always redraws the first frame", () => {
    expect(snapshotChanged(null, snapshot())).toBe(true);
  });

  it("notices camera pan and zoom", () => {
    expect(snapshotChanged(snapshot(), snapshot({ camera: { tx: 1, ty: 0, scale: 1 } }))).toBe(
      true,
    );
    expect(snapshotChanged(snapshot(), snapshot({ camera: { tx: 0, ty: 0, scale: 2 } }))).toBe(
      true,
    );
  });

  it("notices a resize of the canvas viewport", () => {
    expect(snapshotChanged(snapshot(), snapshot({ viewportWidth: 801 }))).toBe(true);
  });

  it("notices a scene swap and a scene resize (REQ-MMT-014)", () => {
    expect(snapshotChanged(snapshot(), snapshot({ scene: null }))).toBe(true);
    expect(
      snapshotChanged(
        snapshot(),
        snapshot({
          scene: {
            width: 1000,
            height: 800,
            backgroundColor: "#000",
            background: "/other.webp",
            thumb: null,
          },
        }),
      ),
    ).toBe(true);
  });

  it("notices a token moving, appearing or disappearing", () => {
    const one = snapshot({
      tokens: [
        {
          id: "a",
          name: "A",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          disposition: 1,
          hidden: false,
          controlled: false,
        },
      ],
    });
    const moved = snapshot({
      tokens: [{ ...one.tokens[0], x: 10 } as (typeof one.tokens)[number]],
    });
    expect(snapshotChanged(one, moved)).toBe(true);
    expect(snapshotChanged(one, snapshot())).toBe(true);
    expect(snapshotChanged(one, one)).toBe(false);
  });

  it("collapses many updates in the same frame into one redraw", () => {
    // Five tokens move; the widget reads state once and sees a single change.
    const before = snapshot({
      tokens: Array.from({ length: 5 }, (_, i) => ({
        id: `t${String(i)}`,
        name: `T${String(i)}`,
        x: i * 100,
        y: 0,
        width: 1,
        height: 1,
        disposition: 0,
        hidden: false,
        controlled: false,
      })),
    });
    const after = snapshot({ tokens: before.tokens.map((t) => ({ ...t, x: t.x + 50 })) });
    expect(snapshotChanged(before, after)).toBe(true);
    // And once applied, the next read is quiet — no repeated redraw.
    expect(snapshotChanged(after, after)).toBe(false);
  });

  it("notices a token becoming hidden or changing disposition", () => {
    const base = snapshot({
      tokens: [
        {
          id: "a",
          name: "A",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          disposition: 1,
          hidden: false,
          controlled: false,
        },
      ],
    });
    const hidden = snapshot({
      tokens: [{ ...base.tokens[0], hidden: true } as (typeof base.tokens)[number]],
    });
    const hostile = snapshot({
      tokens: [{ ...base.tokens[0], disposition: -1 } as (typeof base.tokens)[number]],
    });
    expect(snapshotChanged(base, hidden)).toBe(true);
    expect(snapshotChanged(base, hostile)).toBe(true);
  });
});
