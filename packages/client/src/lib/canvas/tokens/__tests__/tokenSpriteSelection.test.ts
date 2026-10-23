/**
 * tokenSpriteSelection.test.ts — #296.
 *
 *  - The selection outline is part of the ring: `update()` repainted the ring with
 *    `_drawRing` alone, so any repaint (a disposition change, a new grid size, a
 *    footprint change) wiped the highlight of a token that was still selected.
 *  - Swapping the art destroyed the placeholder rectangle but only DETACHED its initials
 *    label (`removeChildren()` does not destroy), so every art change leaked one Text.
 *
 * PIXI is mocked (same pattern as tokenSpriteRing.test.ts): the assertions are about
 * which strokes the ring graphics receives and which display objects get destroyed.
 */

import { describe, it, expect, vi } from "vitest";
import { createDocumentId, defaultTokenDocument, type TokenDocument } from "@fusion/shared";

const pixiStubs = vi.hoisted(() => {
  class StubContainer {
    label = "";
    eventMode = "auto";
    position = { set: (): void => undefined };
    pivot = { set: (): void => undefined };
    scale = { set: (): void => undefined };
    alpha = 1;
    rotation = 0;
    visible = true;
    destroyed = false;
    children: unknown[] = [];
    addChild(child: unknown): unknown {
      this.children.push(child);
      return child;
    }
    removeChildren(): void {
      this.children = [];
    }
    destroy(): void {
      this.destroyed = true;
      this.children = [];
    }
  }
  class StubGraphics extends StubContainer {
    strokes: Array<{ color: number }> = [];
    rect(): this {
      return this;
    }
    roundRect(): this {
      return this;
    }
    circle(): this {
      return this;
    }
    fill(): this {
      return this;
    }
    stroke(opts: { color: number }): this {
      this.strokes.push({ color: opts.color });
      return this;
    }
    clear(): this {
      this.strokes = [];
      return this;
    }
  }
  class StubSprite extends StubContainer {
    anchor = { set: (): void => undefined };
    x = 0;
    y = 0;
    width = 0;
    height = 0;
  }
  class StubText extends StubContainer {
    text = "";
    style: unknown = {};
    anchor = { set: (): void => undefined };
    x = 0;
    y = 0;
    constructor(opts?: { text?: string; style?: unknown }) {
      super();
      this.text = opts?.text ?? "";
      this.style = opts?.style ?? {};
    }
  }
  class StubTextStyle {
    constructor(opts?: unknown) {
      Object.assign(this, opts ?? {});
    }
  }
  return { StubContainer, StubGraphics, StubSprite, StubText, StubTextStyle };
});

vi.mock("pixi.js", () => ({
  Container: pixiStubs.StubContainer,
  Rectangle: class StubRectangle {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
  },
  Graphics: pixiStubs.StubGraphics,
  Sprite: pixiStubs.StubSprite,
  Text: pixiStubs.StubText,
  TextStyle: pixiStubs.StubTextStyle,
  Assets: { load: async (): Promise<unknown> => ({ width: 100, height: 100 }) },
  Texture: class {},
}));

vi.mock("../../../api.js", () => ({
  fusionApi: {
    getToken: (): string => "access-tok",
    getFreshToken: (): Promise<string> => Promise.resolve("access-tok"),
  },
}));
vi.mock("../../../session.svelte.js", () => ({ session: { user: { id: "user-1" } } }));

const { TokenSprite } = await import("../TokenSprite.js");
const { DocumentMirror } = await import("../../../docs/DocumentMirror.js");

const ACTOR_ID = createDocumentId();
const WHITE = 0xffffff;

function mirror(): InstanceType<typeof DocumentMirror> {
  const m = new DocumentMirror();
  m.applySnapshot({
    seq: 1,
    activeSceneId: null,
    documents: { Actor: [{ _id: ACTOR_ID, name: "Goblin", img: null, system: {} }] },
  });
  return m;
}

function makeToken(overrides: Partial<TokenDocument> = {}): TokenDocument {
  return { ...defaultTokenDocument(createDocumentId(), ACTOR_ID), ...overrides };
}

interface Internals {
  _ringGraphics: InstanceType<typeof pixiStubs.StubGraphics>;
  _artContainer: InstanceType<typeof pixiStubs.StubContainer>;
  _loadArt: (doc: TokenDocument) => Promise<void>;
}

const internals = (s: unknown): Internals => s as Internals;
const hasSelectionStroke = (s: unknown): boolean =>
  internals(s)._ringGraphics.strokes.some((st) => st.color === WHITE);

describe("selection outline survives a repaint (#296)", () => {
  it("is drawn on select and removed on deselect", () => {
    const sprite = new TokenSprite(makeToken(), 100, true, mirror());
    expect(hasSelectionStroke(sprite)).toBe(false);
    sprite.setSelected(true);
    expect(hasSelectionStroke(sprite)).toBe(true);
    sprite.setSelected(false);
    expect(hasSelectionStroke(sprite)).toBe(false);
  });

  it("stays after the disposition changes (a ring repaint)", () => {
    const token = makeToken();
    const sprite = new TokenSprite(token, 100, true, mirror());
    sprite.setSelected(true);
    sprite.update({ ...token, disposition: -1 }, 100);
    expect(hasSelectionStroke(sprite)).toBe(true);
  });

  it("stays after the grid cell size changes (a recalibration)", () => {
    const token = makeToken();
    const sprite = new TokenSprite(token, 100, true, mirror());
    sprite.setSelected(true);
    sprite.update(token, 140);
    expect(hasSelectionStroke(sprite)).toBe(true);
  });

  it("stays after the token moves", () => {
    const token = makeToken();
    const sprite = new TokenSprite(token, 100, true, mirror());
    sprite.setSelected(true);
    sprite.update({ ...token, x: token.x + 100 }, 100);
    expect(hasSelectionStroke(sprite)).toBe(true);
  });

  it("an unselected token does not gain an outline from a repaint", () => {
    const token = makeToken();
    const sprite = new TokenSprite(token, 100, true, mirror());
    sprite.update({ ...token, disposition: 1 }, 100);
    expect(hasSelectionStroke(sprite)).toBe(false);
  });
});

describe("swapping the art does not leak the placeholder label (#296)", () => {
  it("destroys every old child of the art container, not just the placeholder rectangle", async () => {
    const token = makeToken();
    const sprite = new TokenSprite(token, 100, true, mirror());
    await Promise.resolve();
    const before = [...internals(sprite)._artContainer.children] as Array<{ destroyed: boolean }>;
    // Rectangle + initials label.
    expect(before.length).toBe(2);

    await internals(sprite)._loadArt(token);

    expect(before.every((child) => child.destroyed)).toBe(true);
    const after = internals(sprite)._artContainer.children as Array<{ destroyed: boolean }>;
    expect(after.length).toBe(2);
    expect(after.some((child) => before.includes(child))).toBe(false);
  });
});
