/**
 * TokenLayer.actorArtAcrossScenes.test.ts — CA-TOK-001 / REQ-TOK-011: trocar a
 * arte de um ator com três tokens em duas cenas muda o desenho dos três, sem
 * nenhuma escrita em token.
 *
 * Spec: 41-token.md REQ-TOK-010, REQ-TOK-011, CA-TOK-001 (TK040).
 *
 * `TokenLayer.actorSync.test.ts` already proves a single token in a single
 * scene reacts to an Actor-only change; this file is the multi-token,
 * multi-scene acceptance criterion itself, plus the "no escrita em token"
 * half CA-TOK-001 also demands — the TokenDocuments in the mirror (all three,
 * across both scenes) are byte-identical before and after the actor's art
 * changes, because `TokenDocumentSchema` has no art field left to write to
 * (REQ-TOK-010) and nothing in this flow calls `sendOp`/`doc:update` on a
 * token at all — the redraw is driven purely by `resolveEffectiveActor`
 * re-running against the mirror's Actor collection.
 *
 * PIXI is fully mocked (pattern shared with TokenLayer.actorSync.test.ts).
 */

import { describe, it, expect, vi } from "vitest";
import {
  createDocumentId,
  defaultTokenDocument,
  defaultSceneDocument,
  type TokenDocument,
} from "@fusion/shared";
import type { Container } from "pixi.js";

// --- PIXI stubs (same shape as TokenLayer.actorSync.test.ts) ---------------
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
  const loadedUrls: string[] = [];
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
  return { StubContainer, StubGraphics, StubSprite, StubText, StubTextStyle, loadedUrls };
});

vi.mock("pixi.js", () => ({
  Container: pixiStubs.StubContainer,
  Graphics: pixiStubs.StubGraphics,
  Sprite: pixiStubs.StubSprite,
  Text: pixiStubs.StubText,
  TextStyle: pixiStubs.StubTextStyle,
  Assets: {
    load: async (url: string): Promise<unknown> => {
      pixiStubs.loadedUrls.push(url);
      return { width: 100, height: 100 };
    },
  },
  Texture: class {},
}));

vi.mock("../../../assets/assetApi.js", () => ({
  resolveAssetUrl: (path: string): string => `resolved:${path}`,
}));
vi.mock("../../../api.js", () => ({ fusionApi: { getToken: (): string => "access-tok" } }));
vi.mock("../../../session.svelte.js", () => ({ session: { user: { id: "user-1" } } }));

const { TokenLayer } = await import("../TokenLayer.js");
const { DocumentMirror } = await import("../../../docs/DocumentMirror.js");

// ---------------------------------------------------------------------------

const SCENE_A_ID = createDocumentId();
const SCENE_B_ID = createDocumentId();
const ACTOR_ID = createDocumentId();
const GRID_SIZE = 100;

function makeToken(overrides: Partial<TokenDocument> = {}): TokenDocument {
  return { ...defaultTokenDocument(createDocumentId(), ACTOR_ID), ...overrides };
}

describe("CA-TOK-001 (REQ-TOK-010, REQ-TOK-011): art change reaches every token, in every scene", () => {
  it("redraws all three tokens across two scenes, with zero writes to any TokenDocument", async () => {
    pixiStubs.loadedUrls.length = 0;
    const mirror = new DocumentMirror();

    const tokenA1 = makeToken();
    const tokenA2 = makeToken();
    const tokenB1 = makeToken();
    const sceneA = { ...defaultSceneDocument(SCENE_A_ID), tokens: [tokenA1, tokenA2] };
    const sceneB = { ...defaultSceneDocument(SCENE_B_ID), tokens: [tokenB1] };

    mirror.applySnapshot({
      seq: 1,
      activeSceneId: SCENE_A_ID,
      documents: {
        Scene: [sceneA, sceneB],
        Actor: [{ _id: ACTOR_ID, name: "Goblin", img: null, system: {} }],
      },
    });

    // One TokenLayer per scene — exactly how TableScreen mounts one per
    // active scene; CA-TOK-001 spans BOTH.
    const layerA = new TokenLayer(
      new pixiStubs.StubContainer() as unknown as Container,
      mirror,
      SCENE_A_ID,
      GRID_SIZE,
      false,
    );
    const layerB = new TokenLayer(
      new pixiStubs.StubContainer() as unknown as Container,
      mirror,
      SCENE_B_ID,
      GRID_SIZE,
      false,
    );

    await Promise.resolve();
    expect(pixiStubs.loadedUrls).toHaveLength(0); // sanity: no img yet

    // Snapshot every TokenDocument's fields before the actor's art changes —
    // the only write in this whole flow is to the Actor collection.
    const before = mirror.getDoc<Awaited<ReturnType<typeof defaultSceneDocument>>>(
      "Scene",
      SCENE_A_ID,
    );
    const beforeB = mirror.getDoc<Awaited<ReturnType<typeof defaultSceneDocument>>>(
      "Scene",
      SCENE_B_ID,
    );
    const tokensBefore = JSON.stringify([...(before?.tokens ?? []), ...(beforeB?.tokens ?? [])]);

    // Trade the actor's art — the ONLY document touched.
    mirror.feedOp({
      type: "doc:update",
      seq: 2,
      ts: Date.now(),
      payload: {
        documentType: "Actor",
        documents: [{ _id: ACTOR_ID, name: "Goblin", img: "goblin.webp", system: {} }],
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    // All three pieces redrew with the new art.
    const goblinLoads = pixiStubs.loadedUrls.filter((u) => u === "resolved:goblin.webp");
    expect(goblinLoads).toHaveLength(3);

    // No TokenDocument anywhere changed — the redraw was driven purely by the
    // Actor subscription, never by an operation on a token (REQ-TOK-010: the
    // schema has no art field to write to in the first place).
    const after = mirror.getDoc<Awaited<ReturnType<typeof defaultSceneDocument>>>(
      "Scene",
      SCENE_A_ID,
    );
    const afterB = mirror.getDoc<Awaited<ReturnType<typeof defaultSceneDocument>>>(
      "Scene",
      SCENE_B_ID,
    );
    const tokensAfter = JSON.stringify([...(after?.tokens ?? []), ...(afterB?.tokens ?? [])]);
    expect(tokensAfter).toBe(tokensBefore);

    layerA.destroy();
    layerB.destroy();
  });
});
