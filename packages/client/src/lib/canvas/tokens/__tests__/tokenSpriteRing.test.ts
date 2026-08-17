/**
 * tokenSpriteRing.test.ts — a token with `disposition: null` draws the
 * neutral disposition ring, not the "secret" gray one.
 *
 * REQ-TOK-080 (specs/41-token.md): disposition "DEVE ser herdada do ator
 * quando não sobrescrita". Full inheritance from the actor is TK042 (Fase 3,
 * out of this task's scope — no Actor document carries a `disposition` field
 * yet). Until then, `null` (the schema default since TK024 made the field
 * nullable) MUST fall back to neutral so REQ-TOK-081 / REQ-CNV-027's
 * hostile/neutral/friendly ring keeps showing on every token — not regress
 * to the gray `SECRET_RING_COLOR`, which DEC-TOK-12 already retired as a
 * disposition value.
 *
 * PIXI is fully mocked (pattern shared with sceneGrantReuse.test.ts): none of
 * this needs a renderer, and the assertion is about which color `stroke()`
 * receives for the ring, not pixels.
 */

import { describe, it, expect, vi } from "vitest";
import { createDocumentId, defaultTokenDocument, type TokenDocument } from "@fusion/shared";
import { DISPOSITION_COLORS, SECRET_RING_COLOR } from "../token-visuals.js";

// --- PIXI stubs -------------------------------------------------------------
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
  const strokes: Array<{ color: number }> = [];
  class StubGraphics extends StubContainer {
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
      strokes.push({ color: opts.color });
      return this;
    }
    clear(): this {
      return this;
    }
  }
  class StubSprite extends StubContainer {
    anchor = { set: (): void => undefined };
    x = 0;
    y = 0;
    width = 0;
    height = 0;
    tint = 0xffffff;
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
  return { StubContainer, StubGraphics, StubSprite, StubText, StubTextStyle, strokes };
});

vi.mock("pixi.js", () => ({
  Container: pixiStubs.StubContainer,
  Graphics: pixiStubs.StubGraphics,
  Sprite: pixiStubs.StubSprite,
  Text: pixiStubs.StubText,
  TextStyle: pixiStubs.StubTextStyle,
  Assets: { load: async (): Promise<unknown> => ({ width: 100, height: 100 }) },
  Texture: class {},
}));

vi.mock("../../api.js", () => ({ fusionApi: { getToken: (): string => "access-tok" } }));
vi.mock("../../session.svelte.js", () => ({ session: { user: { id: "user-1" } } }));

const { TokenSprite } = await import("../TokenSprite.js");
const { DocumentMirror } = await import("../../../docs/DocumentMirror.js");

// ---------------------------------------------------------------------------

const ACTOR_ID = createDocumentId();

function mirrorWithActor(): InstanceType<typeof DocumentMirror> {
  const mirror = new DocumentMirror();
  mirror.applySnapshot({
    seq: 1,
    activeSceneId: null,
    documents: {
      Actor: [{ _id: ACTOR_ID, name: "Goblin", img: null, system: {} }],
    },
  });
  return mirror;
}

function makeToken(overrides: Partial<TokenDocument> = {}): TokenDocument {
  return { ...defaultTokenDocument(createDocumentId(), ACTOR_ID), ...overrides };
}

describe("TokenSprite ring color — REQ-TOK-080, REQ-TOK-081, DEC-TOK-12", () => {
  it("draws the neutral ring, not secret gray, for a token with disposition: null and a resolved actor", () => {
    pixiStubs.strokes.length = 0;
    const mirror = mirrorWithActor();
    const token = makeToken();
    expect(token.disposition).toBeNull(); // sanity: TK024's schema default

    new TokenSprite(token, 100, false, mirror);

    expect(pixiStubs.strokes[0]?.color).toBe(DISPOSITION_COLORS[0]);
    expect(pixiStubs.strokes[0]?.color).not.toBe(SECRET_RING_COLOR);
  });

  it("still draws hostile/neutral/friendly when disposition is explicitly overridden", () => {
    pixiStubs.strokes.length = 0;
    const mirror = mirrorWithActor();

    new TokenSprite(makeToken({ disposition: -1 }), 100, false, mirror);
    expect(pixiStubs.strokes[0]?.color).toBe(DISPOSITION_COLORS[-1]);

    pixiStubs.strokes.length = 0;
    new TokenSprite(makeToken({ disposition: 1 }), 100, false, mirror);
    expect(pixiStubs.strokes[0]?.color).toBe(DISPOSITION_COLORS[1]);
  });
});
