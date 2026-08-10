/**
 * token-sprite-bars.test.ts — the HP bar as it is actually painted.
 *
 * REQ-CNV-089 / DEC-CNV-15 (spec 06): who may see a token's resource bars, by
 * `displayBars` level × the viewer's ownership over the token's Actor × hover.
 * REQ-CNV-090 (spec 06): the bar shows the REAL value of the attribute; it is
 * ABSENT — not full — when the path does not resolve, when the token has no
 * actor, or when `max <= 0`.
 *
 * This file instantiates the REAL `TokenSprite` and inspects the REAL PIXI
 * scene graph it built (labels + `GraphicsContext.instructions` + local
 * bounds), following `token-sprite-hittest.test.ts`. It deliberately does NOT
 * re-implement the fill formula and compare against itself: a test that copies
 * the production maths passes just as happily when both copies are wrong.
 *
 * PIXI containers construct fine under the node environment (no renderer).
 */

import { describe, it, expect } from "vitest";
import { Graphics, type Container, type FederatedPointerEvent } from "pixi.js";
import { TokenSprite } from "../TokenSprite.js";
import type { TokenBarContext } from "../token-bars.js";
import { TokenDocumentSchema, OwnershipLevel } from "@fusion/shared";
import type { TokenDocument } from "@fusion/shared";

const GRID = 100;

function makeToken(over: Partial<TokenDocument> = {}): TokenDocument {
  return TokenDocumentSchema.parse({
    _id: "tok0000000000001",
    name: "Tobias",
    actorId: "act0000000000001",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    bar1: { attribute: "attributes.hp" },
    ...over,
  });
}

/** A bar context that always resolves the same actor, at a fixed level. */
function contextFor(
  hp: { value: number; max: number } | null,
  level: number,
  privileged = false,
): TokenBarContext {
  return {
    privileged,
    resolve: (actorId) => {
      if (!actorId) return null;
      return { system: hp ? { attributes: { hp } } : {}, level };
    },
  };
}

// ---------------------------------------------------------------------------
// Scene-graph probes — no production maths duplicated here
// ---------------------------------------------------------------------------

function barsContainer(sprite: TokenSprite): Container {
  const bars = sprite.container.getChildByLabel("bars");
  if (!bars) throw new Error("token sprite has no 'bars' container");
  return bars;
}

function fillOf(sprite: TokenSprite, label: "bar1-fill" | "bar2-fill"): Graphics {
  const g = barsContainer(sprite).getChildByLabel(label);
  if (!(g instanceof Graphics)) throw new Error(`no Graphics labelled ${label}`);
  return g;
}

/** True when anything at all was drawn into that bar's fill. */
function isDrawn(sprite: TokenSprite, label: "bar1-fill" | "bar2-fill"): boolean {
  return fillOf(sprite, label).context.instructions.length > 0;
}

/** Painted width of the fill, in local pixels (0 when nothing was drawn). */
function fillWidth(sprite: TokenSprite, label: "bar1-fill" | "bar2-fill" = "bar1-fill"): number {
  const g = fillOf(sprite, label);
  if (g.context.instructions.length === 0) return 0;
  const b = g.getLocalBounds();
  return b.maxX - b.minX;
}

// ---------------------------------------------------------------------------
// REQ-CNV-090 — the bar shows the real value
// ---------------------------------------------------------------------------

describe("TokenSprite bars — the value is real (REQ-CNV-090)", () => {
  it("paints a full-width fill at full HP", () => {
    const sprite = new TokenSprite(
      makeToken(),
      GRID,
      true,
      contextFor({ value: 40, max: 40 }, OwnershipLevel.OWNER),
    );
    expect(fillWidth(sprite)).toBeCloseTo(GRID, 5);
  });

  it("paints half the width at half HP — not a placeholder full bar", () => {
    const sprite = new TokenSprite(
      makeToken(),
      GRID,
      true,
      contextFor({ value: 20, max: 40 }, OwnershipLevel.OWNER),
    );
    expect(fillWidth(sprite)).toBeCloseTo(GRID / 2, 5);
  });

  it("paints nothing at 0 HP", () => {
    const sprite = new TokenSprite(
      makeToken(),
      GRID,
      true,
      contextFor({ value: 0, max: 40 }, OwnershipLevel.OWNER),
    );
    expect(fillWidth(sprite)).toBe(0);
  });

  it("is ABSENT when the token has no actor", () => {
    const sprite = new TokenSprite(
      makeToken({ actorId: null }),
      GRID,
      true,
      contextFor({ value: 40, max: 40 }, OwnershipLevel.OWNER),
    );
    expect(isDrawn(sprite, "bar1-fill")).toBe(false);
  });

  it("is ABSENT when the attribute path does not resolve on the actor", () => {
    const sprite = new TokenSprite(
      makeToken({ bar1: { attribute: "attributes.sanity" } }),
      GRID,
      true,
      contextFor({ value: 40, max: 40 }, OwnershipLevel.OWNER),
    );
    expect(isDrawn(sprite, "bar1-fill")).toBe(false);
  });

  it("is ABSENT when max <= 0 — the old code drew a full bar here", () => {
    const sprite = new TokenSprite(
      makeToken(),
      GRID,
      true,
      contextFor({ value: 3, max: 0 }, OwnershipLevel.OWNER),
    );
    expect(isDrawn(sprite, "bar1-fill")).toBe(false);
  });

  it("is ABSENT when the bar is not configured", () => {
    const sprite = new TokenSprite(
      makeToken({ bar1: { attribute: null } }),
      GRID,
      true,
      contextFor({ value: 40, max: 40 }, OwnershipLevel.OWNER),
    );
    expect(isDrawn(sprite, "bar1-fill")).toBe(false);
  });

  it("is ABSENT when no bar context was injected at all (no actor source)", () => {
    const sprite = new TokenSprite(makeToken(), GRID, true);
    expect(isDrawn(sprite, "bar1-fill")).toBe(false);
  });

  it("keeps bar2 independent of bar1", () => {
    const sprite = new TokenSprite(
      makeToken({ bar2: { attribute: "resources.focus" } }),
      GRID,
      true,
      {
        privileged: true,
        resolve: () => ({
          system: {
            attributes: { hp: { value: 40, max: 40 } },
            resources: { focus: { value: 1, max: 4 } },
          },
          level: OwnershipLevel.OWNER,
        }),
      },
    );
    expect(fillWidth(sprite, "bar1-fill")).toBeCloseTo(GRID, 5);
    expect(fillWidth(sprite, "bar2-fill")).toBeCloseTo(GRID / 4, 5);
  });
});

// ---------------------------------------------------------------------------
// Repaint — the silent-staleness trap
// ---------------------------------------------------------------------------

describe("TokenSprite bars — repaint (the overlay must not freeze)", () => {
  it("shrinks the fill when the actor takes damage (refreshBars)", () => {
    const hp = { value: 40, max: 40 };
    const ctx: TokenBarContext = {
      privileged: true,
      resolve: () => ({ system: { attributes: { hp } }, level: OwnershipLevel.OWNER }),
    };
    const sprite = new TokenSprite(makeToken(), GRID, true, ctx);
    const before = fillWidth(sprite);

    hp.value = 10;
    sprite.refreshBars();

    const after = fillWidth(sprite);
    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(GRID / 4, 5);
  });

  it("repaints when the token's bar attribute changes via update()", () => {
    const ctx: TokenBarContext = {
      privileged: true,
      resolve: () => ({
        system: {
          attributes: { hp: { value: 40, max: 40 } },
          resources: { focus: { value: 1, max: 4 } },
        },
        level: OwnershipLevel.OWNER,
      }),
    };
    const sprite = new TokenSprite(makeToken(), GRID, true, ctx);
    expect(fillWidth(sprite)).toBeCloseTo(GRID, 5);

    // Nothing else about the token changed: x/y/width/name are identical. The
    // old `visualChanged` list did not watch bar1/bar2 at all, so this repaint
    // never happened and the bar kept showing the previous attribute.
    sprite.update(makeToken({ bar1: { attribute: "resources.focus" } }), GRID);
    expect(fillWidth(sprite)).toBeCloseTo(GRID / 4, 5);
  });

  it("repaints when displayBars changes via update()", () => {
    const ctx = contextFor({ value: 40, max: 40 }, OwnershipLevel.OBSERVER);
    const sprite = new TokenSprite(makeToken({ displayBars: "observer" }), GRID, false, ctx);
    expect(isDrawn(sprite, "bar1-fill")).toBe(true);

    sprite.update(makeToken({ displayBars: "never" }), GRID);
    expect(isDrawn(sprite, "bar1-fill")).toBe(false);
  });

  it("repaints when the token is reassigned to another actor via update()", () => {
    const ctx: TokenBarContext = {
      privileged: true,
      resolve: (actorId) =>
        actorId === "act0000000000001"
          ? { system: { attributes: { hp: { value: 40, max: 40 } } }, level: OwnershipLevel.OWNER }
          : { system: { attributes: { hp: { value: 10, max: 40 } } }, level: OwnershipLevel.OWNER },
    };
    const sprite = new TokenSprite(makeToken(), GRID, true, ctx);
    expect(fillWidth(sprite)).toBeCloseTo(GRID, 5);

    sprite.update(makeToken({ actorId: "act0000000000002" }), GRID);
    expect(fillWidth(sprite)).toBeCloseTo(GRID / 4, 5);
  });

  it("follows the footprint — a 2x2 token gets a 2-cell-wide bar", () => {
    const sprite = new TokenSprite(
      makeToken({ width: 2, height: 2 }),
      GRID,
      true,
      contextFor({ value: 40, max: 40 }, OwnershipLevel.OWNER),
    );
    expect(fillWidth(sprite)).toBeCloseTo(GRID * 2, 5);
  });
});

// ---------------------------------------------------------------------------
// REQ-CNV-089 / DEC-CNV-15 — who sees the bar
// ---------------------------------------------------------------------------

describe("TokenSprite bars — the permission cut (DEC-CNV-15)", () => {
  const FULL = { value: 40, max: 40 };

  function drawnFor(
    displayBars: TokenDocument["displayBars"],
    level: number,
    privileged: boolean,
    hovered: boolean,
  ): boolean {
    const sprite = new TokenSprite(
      makeToken({ displayBars }),
      GRID,
      privileged,
      contextFor(FULL, level, privileged),
    );
    if (hovered) sprite.setHovered(true);
    return isDrawn(sprite, "bar1-fill");
  }

  it("never: hidden from everyone, GM included", () => {
    expect(drawnFor("never", OwnershipLevel.OWNER, true, true)).toBe(false);
    expect(drawnFor("never", OwnershipLevel.OWNER, false, false)).toBe(false);
  });

  it("observer: OBSERVER and above see it without hovering", () => {
    expect(drawnFor("observer", OwnershipLevel.OWNER, false, false)).toBe(true);
    expect(drawnFor("observer", OwnershipLevel.OBSERVER, false, false)).toBe(true);
  });

  it("observer: LIMITED and NONE do not see it — this is the leak the cut closes", () => {
    expect(drawnFor("observer", OwnershipLevel.LIMITED, false, false)).toBe(false);
    expect(drawnFor("observer", OwnershipLevel.NONE, false, false)).toBe(false);
    expect(drawnFor("observer", OwnershipLevel.NONE, false, true)).toBe(false);
  });

  it("observer: a privileged role sees it regardless of the ownership map", () => {
    expect(drawnFor("observer", OwnershipLevel.NONE, true, false)).toBe(true);
  });

  it("hoverObserver: the observer cut, gated on hover", () => {
    expect(drawnFor("hoverObserver", OwnershipLevel.OBSERVER, false, true)).toBe(true);
    expect(drawnFor("hoverObserver", OwnershipLevel.OBSERVER, false, false)).toBe(false);
    expect(drawnFor("hoverObserver", OwnershipLevel.LIMITED, false, true)).toBe(false);
    expect(drawnFor("hoverObserver", OwnershipLevel.NONE, true, true)).toBe(true);
  });

  it("hoverAll: anyone, while hovering", () => {
    expect(drawnFor("hoverAll", OwnershipLevel.NONE, false, true)).toBe(true);
    expect(drawnFor("hoverAll", OwnershipLevel.NONE, false, false)).toBe(false);
  });

  it("always: anyone, at all times", () => {
    expect(drawnFor("always", OwnershipLevel.NONE, false, false)).toBe(true);
    expect(drawnFor("always", OwnershipLevel.LIMITED, false, true)).toBe(true);
  });

  it("un-hovering hides a hover-gated bar again", () => {
    const sprite = new TokenSprite(
      makeToken({ displayBars: "hoverAll" }),
      GRID,
      false,
      contextFor(FULL, OwnershipLevel.NONE),
    );
    expect(isDrawn(sprite, "bar1-fill")).toBe(false);
    sprite.setHovered(true);
    expect(isDrawn(sprite, "bar1-fill")).toBe(true);
    sprite.setHovered(false);
    expect(isDrawn(sprite, "bar1-fill")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The hit-test regression this file must not reintroduce
// ---------------------------------------------------------------------------

describe("TokenSprite bars — the clickable surface survives", () => {
  it("keeps the hitArea and eventMode after wiring hover listeners", () => {
    const sprite = new TokenSprite(
      makeToken(),
      GRID,
      true,
      contextFor({ value: 40, max: 40 }, OwnershipLevel.OWNER),
    );
    expect(sprite.container.eventMode).toBe("static");
    expect(sprite.container.hitArea?.contains(GRID / 2, GRID / 2)).toBe(true);
  });

  it("keeps every child non-interactive — including the new bar graphics", () => {
    const sprite = new TokenSprite(
      makeToken(),
      GRID,
      true,
      contextFor({ value: 40, max: 40 }, OwnershipLevel.OWNER),
    );
    for (const child of sprite.container.children) {
      expect(child.eventMode).toBe("none");
    }
    for (const child of barsContainer(sprite).children) {
      expect(child.eventMode).toBe("none");
    }
  });

  it("reacts to the PIXI pointer events, not only to setHovered()", () => {
    const sprite = new TokenSprite(
      makeToken({ displayBars: "hoverAll" }),
      GRID,
      false,
      contextFor({ value: 40, max: 40 }, OwnershipLevel.NONE),
    );
    // The handlers ignore the event payload; PIXI's typed emit still wants one.
    const evt = {} as FederatedPointerEvent;
    expect(isDrawn(sprite, "bar1-fill")).toBe(false);
    sprite.container.emit("pointerover", evt);
    expect(isDrawn(sprite, "bar1-fill")).toBe(true);
    sprite.container.emit("pointerout", evt);
    expect(isDrawn(sprite, "bar1-fill")).toBe(false);
  });
});
