/**
 * tokenSpriteRing.test.ts — a token with `disposition: null` inherits the
 * base Actor's attitude towards the party, never a "secret" gray ring.
 *
 * REQ-TOK-080 (specs/41-token.md): disposition "DEVE ser herdada do ator
 * quando não sobrescrita". TK042 (Fase 3) removed `SECRET_RING_COLOR` and the
 * `secret` disposition value outright (DEC-TOK-12) and wires the inheritance
 * through the base Actor's attitude towards the party (spec 42 §5.5,
 * `flags.fusion.attitude`, REQ-NPC-037) — the same three-way split
 * (enemy/neutral/ally ↔ hostile/neutral/friendly) `resolveDisposition`
 * (token-visuals.ts) maps 1:1. An actor with no attitude flag (a player
 * character has none — party members have no attitude "towards the party")
 * still falls back to neutral, and there is no gray fallback left to regress
 * to (`dispositionColor`'s parameter type is now exactly -1 | 0 | 1).
 * REQ-CNV-027 (specs/06-canvas-e-renderizacao.md): the ring border by
 * disposition is the display this test asserts on (`stroke()`'s color).
 *
 * PIXI is fully mocked (pattern shared with sceneGrantReuse.test.ts): none of
 * this needs a renderer, and the assertion is about which color `stroke()`
 * receives for the ring, not pixels.
 */

import { describe, it, expect, vi } from "vitest";
import { createDocumentId, defaultTokenDocument, type TokenDocument } from "@fusion/shared";
import { DISPOSITION_COLORS } from "../token-visuals.js";

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

vi.mock("../../api.js", () => ({ fusionApi: { getToken: (): string => "access-tok" } }));
vi.mock("../../session.svelte.js", () => ({ session: { user: { id: "user-1" } } }));

const { TokenSprite } = await import("../TokenSprite.js");
const { DocumentMirror } = await import("../../../docs/DocumentMirror.js");

// ---------------------------------------------------------------------------

const ACTOR_ID = createDocumentId();

function mirrorWithActor(
  attitude?: "enemy" | "neutral" | "ally",
): InstanceType<typeof DocumentMirror> {
  const mirror = new DocumentMirror();
  mirror.applySnapshot({
    seq: 1,
    activeSceneId: null,
    documents: {
      Actor: [
        {
          _id: ACTOR_ID,
          name: "Goblin",
          img: null,
          system: {},
          ...(attitude !== undefined ? { flags: { fusion: { attitude } } } : {}),
        },
      ],
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

  it("inherits hostile/neutral/friendly from the actor's attitude when disposition is null (TK042)", () => {
    pixiStubs.strokes.length = 0;
    new TokenSprite(makeToken(), 100, false, mirrorWithActor("enemy"));
    expect(pixiStubs.strokes[0]?.color).toBe(DISPOSITION_COLORS[-1]);

    pixiStubs.strokes.length = 0;
    new TokenSprite(makeToken(), 100, false, mirrorWithActor("ally"));
    expect(pixiStubs.strokes[0]?.color).toBe(DISPOSITION_COLORS[1]);

    pixiStubs.strokes.length = 0;
    new TokenSprite(makeToken(), 100, false, mirrorWithActor("neutral"));
    expect(pixiStubs.strokes[0]?.color).toBe(DISPOSITION_COLORS[0]);
  });

  it("an explicit token disposition overrides the actor's attitude", () => {
    pixiStubs.strokes.length = 0;
    new TokenSprite(makeToken({ disposition: 1 }), 100, false, mirrorWithActor("enemy"));
    expect(pixiStubs.strokes[0]?.color).toBe(DISPOSITION_COLORS[1]);
  });

  it("falls back to neutral when the actor carries no attitude flag (e.g. a player character)", () => {
    pixiStubs.strokes.length = 0;
    new TokenSprite(makeToken(), 100, false, mirrorWithActor());
    expect(pixiStubs.strokes[0]?.color).toBe(DISPOSITION_COLORS[0]);
  });
});
