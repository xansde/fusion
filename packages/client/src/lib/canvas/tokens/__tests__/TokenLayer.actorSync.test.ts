/**
 * TokenLayer.actorSync.test.ts — a piece's art and nameplate follow the actor
 * even when the Actor document changes without the Scene/Token changing.
 *
 * Spec: 06-canvas-e-renderizacao.md REQ-CNV-025 ("a arte do ator efetivo")
 * Spec: 41-token.md TK023 (RNF-TOK-01) — `resolveEffectiveActor` is the ONE
 *   place that resolves a token's effective actor; the piece must reflect it
 *   whenever the base Actor changes, not just when the token doc changes.
 *
 * Root cause fixed here: TokenLayer only subscribed to DocumentMirror "Scene"
 * (tokens are embedded there). An Actor edited on its own — or an Actor that
 * arrives in the mirror AFTER its token (compendium drop) — never touches the
 * Scene document, so `TokenSprite._resolveActor` never re-ran and the piece's
 * art/name froze after the first draw (or stayed a placeholder forever).
 *
 * PIXI is fully mocked (pattern shared with tokenSpriteRing.test.ts): none of
 * this needs a renderer — the assertions are about which texture URL / text
 * are drawn, not pixels. DocumentMirror is the REAL class (not a stub) so the
 * "Actor" subscription wiring is exercised end-to-end.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createDocumentId,
  defaultTokenDocument,
  defaultSceneDocument,
  type TokenDocument,
} from "@fusion/shared";
import type { Container } from "pixi.js";

// --- PIXI stubs (same shape as tokenSpriteRing.test.ts) ---------------------
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

const SCENE_ID = createDocumentId();
const ACTOR_ID = createDocumentId();
const GRID_SIZE = 100;

function makeToken(overrides: Partial<TokenDocument> = {}): TokenDocument {
  return { ...defaultTokenDocument(createDocumentId(), ACTOR_ID), ...overrides };
}

describe("TokenLayer — Actor subscription (REQ-CNV-025, TK023/RNF-TOK-01)", () => {
  it("redraws a piece's art after the actor gains an img with no token/scene change", async () => {
    pixiStubs.loadedUrls.length = 0;
    const mirror = new DocumentMirror();
    const token = makeToken();
    const scene = { ...defaultSceneDocument(SCENE_ID), tokens: [token] };

    mirror.applySnapshot({
      seq: 1,
      activeSceneId: SCENE_ID,
      documents: {
        Scene: [scene],
        Actor: [{ _id: ACTOR_ID, name: "Kobold", img: null, system: {} }],
      },
    });

    const layer = new TokenLayer(
      new pixiStubs.StubContainer() as unknown as Container,
      mirror,
      SCENE_ID,
      GRID_SIZE,
      false,
    );

    // Sanity: no art URL was loaded yet — the actor has no img.
    await Promise.resolve();
    expect(pixiStubs.loadedUrls).toHaveLength(0);

    // Actor gains art WITHOUT any change to the token or the scene document —
    // this is exactly the event the prototype demonstrates ("Trocar a arte
    // do ator"). Only the Actor collection changes.
    mirror.feedOp({
      type: "doc:update",
      seq: 2,
      ts: Date.now(),
      payload: {
        documentType: "Actor",
        documents: [{ _id: ACTOR_ID, name: "Kobold", img: "kobold.webp", system: {} }],
      },
    });

    // _loadArt is async — flush the microtask queue.
    await Promise.resolve();
    await Promise.resolve();

    expect(pixiStubs.loadedUrls).toContain("resolved:kobold.webp");

    layer.destroy();
  });

  it("redraws the nameplate after the actor's name changes with no token/scene change", () => {
    const mirror = new DocumentMirror();
    const token = makeToken();
    const scene = { ...defaultSceneDocument(SCENE_ID), tokens: [token] };

    mirror.applySnapshot({
      seq: 1,
      activeSceneId: SCENE_ID,
      documents: {
        Scene: [scene],
        Actor: [{ _id: ACTOR_ID, name: "Kobold", img: null, system: {} }],
      },
    });

    const layer = new TokenLayer(
      new pixiStubs.StubContainer() as unknown as Container,
      mirror,
      SCENE_ID,
      GRID_SIZE,
      false,
    );

    const sprite = layer.getSprite(token._id);
    expect(sprite).toBeDefined();
    const nameplateBefore = (
      sprite as unknown as { _nameplate: InstanceType<typeof pixiStubs.StubText> }
    )._nameplate.text;
    expect(nameplateBefore).toBe("Kobold");

    mirror.feedOp({
      type: "doc:update",
      seq: 2,
      ts: Date.now(),
      payload: {
        documentType: "Actor",
        documents: [{ _id: ACTOR_ID, name: "Kobold Alfa", img: null, system: {} }],
      },
    });

    const nameplateAfter = (
      sprite as unknown as { _nameplate: InstanceType<typeof pixiStubs.StubText> }
    )._nameplate.text;
    expect(nameplateAfter).toBe("Kobold Alfa");

    layer.destroy();
  });

  it("resolves the actor once it arrives AFTER the token (compendium-drop ordering)", async () => {
    pixiStubs.loadedUrls.length = 0;
    const mirror = new DocumentMirror();
    const token = makeToken();
    const scene = { ...defaultSceneDocument(SCENE_ID), tokens: [token] };

    // Token/Scene present, but the Actor has NOT arrived in the mirror yet —
    // reproduces TableScreen.svelte's compendium-drop ordering where a
    // doc:create for the Actor can race behind the token's own doc:create.
    mirror.applySnapshot({
      seq: 1,
      activeSceneId: SCENE_ID,
      documents: { Scene: [scene] },
    });

    const layer = new TokenLayer(
      new pixiStubs.StubContainer() as unknown as Container,
      mirror,
      SCENE_ID,
      GRID_SIZE,
      false,
    );

    const sprite = layer.getSprite(token._id);
    expect(sprite).toBeDefined();
    // No actor resolved yet → placeholder path, no name.
    expect(
      (sprite as unknown as { _nameplate: InstanceType<typeof pixiStubs.StubText> })._nameplate
        .text,
    ).toBe("");

    // The Actor arrives afterwards.
    mirror.feedOp({
      type: "doc:create",
      seq: 2,
      ts: Date.now(),
      payload: {
        documentType: "Actor",
        documents: [{ _id: ACTOR_ID, name: "Kobold", img: "kobold.webp", system: {} }],
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(
      (sprite as unknown as { _nameplate: InstanceType<typeof pixiStubs.StubText> })._nameplate
        .text,
    ).toBe("Kobold");
    expect(pixiStubs.loadedUrls).toContain("resolved:kobold.webp");

    layer.destroy();
  });
});
