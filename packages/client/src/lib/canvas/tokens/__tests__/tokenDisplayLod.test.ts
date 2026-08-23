/**
 * tokenDisplayLod.test.ts — TK080 (spec 41-token.md REQ-TOK-074/075/076,
 * DEC-TOK-11): the two token display preferences AND with the zoom-based
 * LOD, never OR — a preference can only SUBTRACT visibility the LOD (or,
 * further upstream, the server's redaction) already granted.
 *
 * PIXI is fully mocked (pattern shared with tokenSpriteBars.test.ts /
 * tokenSpriteRing.test.ts): the assertions are about `nameplate.visible` /
 * `barsContainer.visible`, not pixels.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDocumentId, defaultTokenDocument, type TokenDocument } from "@fusion/shared";

// --- PIXI stubs (same shape as tokenSpriteBars.test.ts) ---
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

vi.mock("../../../assets/assetApi.js", () => ({
  resolveAssetUrl: (path: string): string => `resolved:${path}`,
}));
vi.mock("../../../api.js", () => ({ fusionApi: { getToken: (): string => "access-tok" } }));
vi.mock("../../../session.svelte.js", () => ({ session: { user: { id: "user-1" } } }));

const { TokenSprite } = await import("../TokenSprite.js");
const { DocumentMirror } = await import("../../../docs/DocumentMirror.js");
const { setTokenDisplayPref, resetTokenDisplayPrefsForTest } =
  await import("../tokenDisplayPrefsStore.svelte.js");

// ---------------------------------------------------------------------------

const ACTOR_ID = createDocumentId();
const WORLD_ID = "world-lod-test";
const USER_ID = "user-lod-test";

function mirrorWithActor(): InstanceType<typeof DocumentMirror> {
  const mirror = new DocumentMirror();
  mirror.applySnapshot({
    seq: 1,
    activeSceneId: null,
    documents: { Actor: [{ _id: ACTOR_ID, name: "Goblin", img: null, system: {} }] },
  });
  return mirror;
}

function makeToken(overrides: Partial<TokenDocument> = {}): TokenDocument {
  return { ...defaultTokenDocument(createDocumentId(), ACTOR_ID), ...overrides };
}

// Zoom = 1 grants everything by LOD alone (LOD_THRESHOLDS.NAMEPLATE_MIN=0.4,
// BAR_MIN=0.3) — isolates the preference's effect from the zoom-based one.
const FULL_LOD_ZOOM = 1;

describe("TokenSprite.updateLod — display preferences AND with zoom LOD (TK080)", () => {
  beforeEach(() => {
    resetTokenDisplayPrefsForTest();
  });

  it("both on (default): nameplate and bars are visible at full LOD", () => {
    const mirror = mirrorWithActor();
    const sprite = new TokenSprite(makeToken(), 100, false, mirror);
    sprite.updateLod(FULL_LOD_ZOOM);
    expect(sprite["_nameplate"].visible).toBe(true);
    expect(sprite["_barsContainer"].visible).toBe(true);
  });

  it("REQ-TOK-074: turning off names hides the nameplate, leaves bars alone", () => {
    setTokenDisplayPref(WORLD_ID, USER_ID, "showNames", false);
    const mirror = mirrorWithActor();
    const sprite = new TokenSprite(makeToken(), 100, false, mirror);
    sprite.updateLod(FULL_LOD_ZOOM);
    expect(sprite["_nameplate"].visible).toBe(false);
    expect(sprite["_barsContainer"].visible).toBe(true);
  });

  it("REQ-TOK-074: turning off bars hides the bars, leaves the nameplate alone", () => {
    setTokenDisplayPref(WORLD_ID, USER_ID, "showBars", false);
    const mirror = mirrorWithActor();
    const sprite = new TokenSprite(makeToken(), 100, false, mirror);
    sprite.updateLod(FULL_LOD_ZOOM);
    expect(sprite["_nameplate"].visible).toBe(true);
    expect(sprite["_barsContainer"].visible).toBe(false);
  });

  it("REQ-TOK-075: the preference only SUBTRACTS — it never re-shows what a low zoom's LOD already hid", () => {
    // Below LOD_THRESHOLDS.NAMEPLATE_MIN (0.4) and BAR_MIN (0.3): LOD alone hides both.
    const LOW_ZOOM = 0.1;
    setTokenDisplayPref(WORLD_ID, USER_ID, "showNames", true);
    setTokenDisplayPref(WORLD_ID, USER_ID, "showBars", true);
    const mirror = mirrorWithActor();
    const sprite = new TokenSprite(makeToken(), 100, false, mirror);
    sprite.updateLod(LOW_ZOOM);
    expect(sprite["_nameplate"].visible).toBe(false);
    expect(sprite["_barsContainer"].visible).toBe(false);
  });

  it("re-applying updateLod after a live preference change updates an already-rendered sprite", () => {
    const mirror = mirrorWithActor();
    const sprite = new TokenSprite(makeToken(), 100, false, mirror);
    sprite.updateLod(FULL_LOD_ZOOM);
    expect(sprite["_nameplate"].visible).toBe(true);

    setTokenDisplayPref(WORLD_ID, USER_ID, "showNames", false);
    sprite.updateLod(FULL_LOD_ZOOM); // same zoom — only the preference changed
    expect(sprite["_nameplate"].visible).toBe(false);
  });
});
