/**
 * sceneGrantReuse.test.ts — the scene pays for ONE grant, background and tokens
 * alike (T025).
 *
 * This is the client half of the design's central claim, tested through the REAL
 * consumers rather than through `resolveAssetUrl` directly: `sceneLoader` mints
 * the scene's grant to paint the background, and every `TokenSprite` of that
 * scene then loads its art out of the same cached bundle without a second
 * round-trip. If a sprite ever asked for a grant of its own — or asked about the
 * wrong document — the mint count here goes up and this file fails.
 *
 * PIXI is fully mocked: none of this needs a renderer, and the assertions are
 * about network shape, not pixels.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TokenDocumentSchema,
  SceneDocumentSchema,
  createDocumentId,
  defaultStats,
  type SceneDocument,
} from "@fusion/shared";

// --- PIXI stubs -------------------------------------------------------------
// Declared with `vi.hoisted` because vi.mock's factory is lifted above imports.
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
  const loaded: string[] = [];
  return { StubContainer, StubGraphics, StubSprite, StubText, StubTextStyle, loaded };
});

vi.mock("pixi.js", () => ({
  Container: pixiStubs.StubContainer,
  Graphics: pixiStubs.StubGraphics,
  Sprite: pixiStubs.StubSprite,
  Text: pixiStubs.StubText,
  TextStyle: pixiStubs.StubTextStyle,
  Assets: {
    load: async (url: string): Promise<unknown> => {
      pixiStubs.loaded.push(url);
      return { width: 100, height: 100 };
    },
  },
  Texture: class {},
}));

// --- session / api stubs ----------------------------------------------------
vi.mock("../../api.js", () => ({ fusionApi: { getToken: (): string => "access-tok" } }));
vi.mock("../../session.svelte.js", () => ({ session: { user: { id: "user-1" } } }));

// Imported AFTER the mocks above so both modules pick up the stubbed pixi.
const { loadSceneDocument } = await import("../../canvas/sceneLoader.js");
const { TokenSprite } = await import("../../canvas/tokens/TokenSprite.js");
const { clearAssetGrantCache } = await import("../assetGrants.svelte.js");
type FusionCanvasLike = Parameters<typeof loadSceneDocument>[0];

// ---------------------------------------------------------------------------

const SCENE_ID = createDocumentId();
const BACKGROUND = "/assets/taverna-bg-8fc539a3.png";
const TOKEN_ART = "/assets/goblin-a3b4c5d6.webp";

const STATS = defaultStats();

function fakeCanvas(): FusionCanvasLike {
  const layer = new pixiStubs.StubContainer();
  return {
    getLayer: () => layer,
    setGrid: () => undefined,
    panTo: () => undefined,
    fitToScene: () => undefined,
  } as unknown as FusionCanvasLike;
}

function scene(): SceneDocument {
  return SceneDocumentSchema.parse({
    _id: SCENE_ID,
    _stats: STATS,
    name: "Taverna",
    width: 1000,
    height: 800,
    background: BACKGROUND,
  });
}

function tokenDoc(): ReturnType<typeof TokenDocumentSchema.parse> {
  return TokenDocumentSchema.parse({
    _id: createDocumentId(),
    name: "Goblin",
    texture: TOKEN_ART,
  });
}

/** Answers the grant endpoint with both names of the scene, and counts calls. */
function routedFetch() {
  return vi.fn().mockImplementation(async (url: string) => {
    if (url === "/api/assets/grant") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          exp: Date.now() + 300_000,
          grants: { [BACKGROUND.slice(8)]: "sig-bg", [TOKEN_ART.slice(8)]: "sig-token" },
        }),
      };
    }
    if (url === "/api/assets/token") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, token: "browse-tok", exp: Date.now() + 300_000 }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

/** Let the sprite's fire-and-forget art load settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe("a scene reuses ONE grant for its background and its tokens", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearAssetGrantCache();
    pixiStubs.loaded.length = 0;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("mints once, and the token sprites add no request of their own", async () => {
    const fetchMock = routedFetch();
    global.fetch = fetchMock as unknown as typeof fetch;

    await loadSceneDocument(fakeCanvas(), scene());
    for (let i = 0; i < 5; i += 1) {
      new TokenSprite(tokenDoc(), 100, false, SCENE_ID);
    }
    await settle();

    const grantCalls = fetchMock.mock.calls.filter((c) => c[0] === "/api/assets/grant");
    expect(grantCalls).toHaveLength(1);
    expect(JSON.parse(grantCalls[0]?.[1]?.body as string)).toEqual({
      table: "scenes",
      id: SCENE_ID,
    });
  });

  it("asks about the SCENE, never about the token, and signs each name with its own grant", async () => {
    const fetchMock = routedFetch();
    global.fetch = fetchMock as unknown as typeof fetch;

    await loadSceneDocument(fakeCanvas(), scene());
    new TokenSprite(tokenDoc(), 100, false, SCENE_ID);
    await settle();

    // Nothing ever asked for a grant over a token id — a token is not a
    // document, its texture is a field of the scene row.
    for (const call of fetchMock.mock.calls) {
      if (call[0] !== "/api/assets/grant") continue;
      expect(JSON.parse(call[1]?.body as string).id).toBe(SCENE_ID);
    }

    const bgUrl = pixiStubs.loaded.find((u) => u.startsWith("/assets/taverna-bg"));
    const tokenUrl = pixiStubs.loaded.find((u) => u.startsWith("/assets/goblin"));
    expect(bgUrl).toBeDefined();
    expect(tokenUrl).toBeDefined();
    expect(new URL(bgUrl as string, "http://x").searchParams.get("at")).toBe("sig-bg");
    expect(new URL(tokenUrl as string, "http://x").searchParams.get("at")).toBe("sig-token");
    expect(new URL(tokenUrl as string, "http://x").searchParams.get("au")).toBe("user-1");
  });

  it("a sprite created before any scene load mints the scene's grant itself, once", async () => {
    // Order independence: whichever consumer of the scene arrives first pays,
    // and the rest ride along. Two sprites, no sceneLoader — still one mint.
    const fetchMock = routedFetch();
    global.fetch = fetchMock as unknown as typeof fetch;

    new TokenSprite(tokenDoc(), 100, false, SCENE_ID);
    new TokenSprite(tokenDoc(), 100, false, SCENE_ID);
    await settle();

    expect(fetchMock.mock.calls.filter((c) => c[0] === "/api/assets/grant")).toHaveLength(1);
  });
});
