/**
 * sceneGrantReuse.test.ts — a token's art mints ONE grant against the actors
 * table, and repeated sprites of the same actor reuse it (TK023, REQ-CNV-091).
 *
 * TK023 (REQ-TOK-010, REQ-TOK-012) removed `texture`/`width`/`height` from
 * `TokenDocumentSchema`: a token draws whatever its EFFECTIVE actor's `img` is
 * (`resolveEffectiveActor`, `@fusion/shared`), read out of the `DocumentMirror`
 * by `token.actorId` — not out of a `texture` field of its own. That moved the
 * asset grant this file exercises from the scene document (T025's original
 * design) to the actor document: `TokenSprite._loadArt` now asks
 * `POST /api/assets/grant` about `{ table: "actors", id: actorId }`, and this
 * file is the client half of that claim, tested through the real consumer
 * (`TokenSprite`) rather than through `resolveAssetUrl` directly.
 *
 * `sceneLoader` (background) still asks about the `scenes` table — that half
 * of T025 is unchanged and is not what this file re-tests.
 *
 * PIXI is fully mocked: none of this needs a renderer, and the assertions are
 * about network shape, not pixels.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDocumentId, defaultTokenDocument, type TokenDocument } from "@fusion/shared";

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
const { TokenSprite } = await import("../../canvas/tokens/TokenSprite.js");
const { DocumentMirror } = await import("../../docs/DocumentMirror.js");
const { clearAssetGrantCache } = await import("../assetGrants.svelte.js");

// ---------------------------------------------------------------------------

const ACTOR_ID = createDocumentId();
const ACTOR_IMG = "/assets/goblin-a3b4c5d6.webp";

function mirrorWithActor(): InstanceType<typeof DocumentMirror> {
  const mirror = new DocumentMirror();
  mirror.applySnapshot({
    seq: 1,
    activeSceneId: null,
    documents: {
      Actor: [{ _id: ACTOR_ID, name: "Goblin", img: ACTOR_IMG, system: {} }],
    },
  });
  return mirror;
}

function makeToken(overrides: Partial<TokenDocument> = {}): TokenDocument {
  return { ...defaultTokenDocument(createDocumentId(), ACTOR_ID), ...overrides };
}

/** Answers the grant endpoint for the actors table, and counts calls. */
function routedFetch() {
  return vi.fn().mockImplementation(async (url: string, init?: { body?: string }) => {
    if (url === "/api/assets/grant") {
      const body = JSON.parse(init?.body ?? "{}") as { table: string; id: string };
      if (body.table === "actors" && body.id === ACTOR_ID) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            exp: Date.now() + 300_000,
            grants: { [ACTOR_IMG.slice(8)]: "sig-actor" },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, exp: Date.now() + 300_000, grants: {} }),
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

describe("a token's art reuses ONE grant against the actors table (TK023)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearAssetGrantCache();
    pixiStubs.loaded.length = 0;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("mints once, and five sprites of the same actor add no request of their own", async () => {
    const fetchMock = routedFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    const mirror = mirrorWithActor();

    for (let i = 0; i < 5; i += 1) {
      new TokenSprite(makeToken(), 100, false, mirror);
    }
    await settle();

    const grantCalls = fetchMock.mock.calls.filter((c) => c[0] === "/api/assets/grant");
    expect(grantCalls).toHaveLength(1);
    expect(JSON.parse(grantCalls[0]?.[1]?.body as string)).toEqual({
      table: "actors",
      id: ACTOR_ID,
    });
  });

  it("asks about the ACTOR, never about the token, and signs the name with its own grant", async () => {
    const fetchMock = routedFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    const mirror = mirrorWithActor();

    new TokenSprite(makeToken(), 100, false, mirror);
    await settle();

    // Nothing ever asked for a grant over a token id — a token is not a
    // document, and its art is the actor's, not its own (REQ-TOK-010/012).
    for (const call of fetchMock.mock.calls) {
      if (call[0] !== "/api/assets/grant") continue;
      const body = JSON.parse(call[1]?.body as string) as { table: string; id: string };
      expect(body).toEqual({ table: "actors", id: ACTOR_ID });
    }

    const tokenUrl = pixiStubs.loaded.find((u) => u.startsWith("/assets/goblin"));
    expect(tokenUrl).toBeDefined();
    expect(new URL(tokenUrl as string, "http://x").searchParams.get("at")).toBe("sig-actor");
    expect(new URL(tokenUrl as string, "http://x").searchParams.get("au")).toBe("user-1");
  });

  it("when the actor is not (yet) in the mirror, the sprite draws the placeholder and mints nothing", async () => {
    const fetchMock = routedFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    const emptyMirror = new DocumentMirror();
    emptyMirror.applySnapshot({ seq: 1, activeSceneId: null, documents: {} });

    new TokenSprite(makeToken(), 100, false, emptyMirror);
    await settle();

    expect(fetchMock.mock.calls.filter((c) => c[0] === "/api/assets/grant")).toHaveLength(0);
    expect(pixiStubs.loaded).toHaveLength(0);
  });
});
