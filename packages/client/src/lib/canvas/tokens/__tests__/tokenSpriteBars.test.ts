/**
 * tokenSpriteBars.test.ts — TK031 (#165), REQ-CNV-090/091/092.
 *
 * `_drawSingleBar` used to draw `const fraction = 1; // placeholder: full bar`
 * unconditionally — the exact opposite of REQ-CNV-090, which requires the
 * REAL value/max off the effective actor's `system` (resolved as a dot-path)
 * and demands the bar be ABSENT (nothing drawn, not even the background)
 * when the path does not resolve or `max <= 0`.
 *
 * PIXI is fully mocked (pattern shared with tokenSpriteRing.test.ts): the
 * assertions are about which `rect`/`fill` calls the bar graphics received,
 * not pixels.
 */

import { describe, it, expect, vi } from "vitest";
import { createDocumentId, defaultTokenDocument, type TokenDocument } from "@fusion/shared";

// --- PIXI stubs (same shape as tokenSpriteRing.test.ts / TokenLayer.actorSync.test.ts) ---
const pixiStubs = vi.hoisted(() => {
  interface RectCall {
    x: number;
    y: number;
    w: number;
    h: number;
  }
  // Every rect() call across ALL Graphics instances, in draw order. bar1 is
  // drawn before bar2 (`_drawBars`), so with bar2 disabled (the default,
  // `attribute: null`) index 0 is bar1's background and index 1 its fill.
  const rects: RectCall[] = [];

  class StubContainer {
    label = "";
    eventMode = "auto";
    position = { set: (): void => undefined };
    pivot = { set: (): void => undefined };
    scale = { set: (): void => undefined };
    alpha = 1;
    rotation = 0;
    visible = true;
    x = 0;
    y = 0;
    children: unknown[] = [];
    addChild(child: unknown): unknown {
      this.children.push(child);
      return child;
    }
    removeChildren(): void {
      this.children = [];
    }
    destroy(): void {
      this.children = [];
    }
  }
  class StubGraphics extends StubContainer {
    rect(x: number, y: number, w: number, h: number): this {
      rects.push({ x, y, w, h });
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
    stroke(): this {
      return this;
    }
    clear(): this {
      return this;
    }
  }
  class StubSprite extends StubContainer {
    anchor = { set: (): void => undefined };
    width = 0;
    height = 0;
    tint = 0xffffff;
  }
  class StubText extends StubContainer {
    text = "";
    style: unknown = {};
    anchor = { set: (): void => undefined };
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
  return { StubContainer, StubGraphics, StubSprite, StubText, StubTextStyle, rects };
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

vi.mock("../../../assets/assetApi.js", () => ({
  resolveAssetUrl: (path: string): string => `resolved:${path}`,
}));
vi.mock("../../../api.js", () => ({ fusionApi: { getToken: (): string => "access-tok" } }));
vi.mock("../../../session.svelte.js", () => ({ session: { user: { id: "user-1" } } }));

const { TokenSprite } = await import("../TokenSprite.js");
const { DocumentMirror } = await import("../../../docs/DocumentMirror.js");

// ---------------------------------------------------------------------------

const ACTOR_ID = createDocumentId();

function mirrorWithActor(
  system: Record<string, unknown> = {},
): InstanceType<typeof DocumentMirror> {
  const mirror = new DocumentMirror();
  mirror.applySnapshot({
    seq: 1,
    activeSceneId: null,
    documents: {
      Actor: [{ _id: ACTOR_ID, name: "Goblin", img: null, system }],
    },
  });
  return mirror;
}

function makeToken(overrides: Partial<TokenDocument> = {}): TokenDocument {
  return { ...defaultTokenDocument(createDocumentId(), ACTOR_ID), ...overrides };
}

describe("TokenSprite bars — REQ-CNV-090 (#165, TK031)", () => {
  it("draws no bar at all when bar1.attribute is null (disabled)", () => {
    pixiStubs.rects.length = 0;
    const mirror = mirrorWithActor({ attributes: { hp: { value: 5, max: 10 } } });
    new TokenSprite(makeToken(), 100, false, mirror);
    expect(pixiStubs.rects).toHaveLength(0);
  });

  it("draws no bar (not even the background) when the attribute path does not resolve", () => {
    pixiStubs.rects.length = 0;
    const mirror = mirrorWithActor({}); // no `attributes.hp` at all
    const token = makeToken({ bar1: { attribute: "attributes.hp" } });
    new TokenSprite(token, 100, false, mirror);
    expect(pixiStubs.rects).toHaveLength(0);
  });

  it("draws no bar when max <= 0 — never a full bar as placeholder", () => {
    pixiStubs.rects.length = 0;
    const mirror = mirrorWithActor({ attributes: { hp: { value: 0, max: 0 } } });
    const token = makeToken({ bar1: { attribute: "attributes.hp" } });
    new TokenSprite(token, 100, false, mirror);
    expect(pixiStubs.rects).toHaveLength(0);
  });

  it("draws a background + a PARTIAL fill for a wounded token (value < max)", () => {
    pixiStubs.rects.length = 0;
    const mirror = mirrorWithActor({ attributes: { hp: { value: 5, max: 10 } } });
    const token = makeToken({ bar1: { attribute: "attributes.hp" } });
    new TokenSprite(token, 100, false, mirror);

    // Background (full width) + fill (half width, REQ-CNV-090 fraction 0.5).
    expect(pixiStubs.rects).toHaveLength(2);
    const [bg, fill] = pixiStubs.rects;
    expect(bg?.w).toBeCloseTo(100);
    expect(fill?.w).toBeCloseTo(50);
    expect(fill?.w).toBeLessThan(bg?.w ?? 0);
  });

  it("draws a full fill when value === max (undamaged token)", () => {
    pixiStubs.rects.length = 0;
    const mirror = mirrorWithActor({ attributes: { hp: { value: 10, max: 10 } } });
    const token = makeToken({ bar1: { attribute: "attributes.hp" } });
    new TokenSprite(token, 100, false, mirror);

    const [bg, fill] = pixiStubs.rects;
    expect(fill?.w).toBeCloseTo(bg?.w ?? 0);
  });

  it("clamps the fraction to [0,1] — value above max never overflows the bar", () => {
    pixiStubs.rects.length = 0;
    const mirror = mirrorWithActor({ attributes: { hp: { value: 999, max: 10 } } });
    const token = makeToken({ bar1: { attribute: "attributes.hp" } });
    new TokenSprite(token, 100, false, mirror);

    const [bg, fill] = pixiStubs.rects;
    expect(fill?.w).toBeCloseTo(bg?.w ?? 0);
  });
});

describe("TokenSprite bars — REQ-CNV-092 repaint on actor change (#165, TK031)", () => {
  it("repaints bar1 when the base Actor's hp changes, with no doc:update on the token itself", () => {
    const mirror = mirrorWithActor({ attributes: { hp: { value: 10, max: 10 } } });
    const token = makeToken({ bar1: { attribute: "attributes.hp" } });
    const sprite = new TokenSprite(token, 100, false, mirror);

    pixiStubs.rects.length = 0;

    // The base Actor is damaged directly (LINKED token — no op ever touches
    // the TokenDocument for this). `update()` is what TokenLayer's Actor
    // subscription calls in that case (see TokenLayer.actorSync.test.ts).
    mirror.feedOp({
      type: "doc:update",
      seq: 2,
      ts: Date.now(),
      payload: {
        documentType: "Actor",
        documents: [
          {
            _id: ACTOR_ID,
            name: "Goblin",
            img: null,
            system: { attributes: { hp: { value: 4, max: 10 } } },
          },
        ],
      },
    });
    sprite.update(token, 100);

    expect(pixiStubs.rects.length).toBeGreaterThan(0);
    const fill = pixiStubs.rects[1];
    expect(fill?.w).toBeCloseTo(40); // 4/10 of 100px
  });

  it("does NOT redraw bars when nothing bar-relevant changed (no re-render espúrio)", () => {
    const mirror = mirrorWithActor({ attributes: { hp: { value: 10, max: 10 } } });
    const token = makeToken({ bar1: { attribute: "attributes.hp" } });
    const sprite = new TokenSprite(token, 100, false, mirror);

    pixiStubs.rects.length = 0;
    // update() with the exact same doc and no actor change (e.g. a
    // no-op reconcile) must not touch the bar graphics at all.
    sprite.update(token, 100);
    expect(pixiStubs.rects).toHaveLength(0);
  });
});
