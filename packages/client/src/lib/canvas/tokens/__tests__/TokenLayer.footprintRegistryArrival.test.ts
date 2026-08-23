/**
 * TokenLayer.footprintRegistryArrival.test.ts
 *
 * R5 (integração pós-#194): the size→footprint table arrives ASYNCHRONOUSLY
 * (the `system:footprint` ack, TK041) and nothing was repainting when it did.
 *
 * `footprintOf` reads `footprintRegistry` imperatively and fails open to 1×1
 * while the table is empty (REQ-TOK-012, DEC-TOK-03). That is the right
 * default, but before this fix it was also PERMANENT for any sprite already
 * drawn: `TokenLayer` only reconciles on a Scene or Actor mirror change, so a
 * "grande" creature reconciled before the ack landed stayed 1×1 until some
 * unrelated broadcast happened to touch the scene. #194's `_loadedSceneId`
 * guard removed the scene reload that used to paper over this, which makes
 * the race routine rather than rare: the canvas mounts, the table answers a
 * few hundred ms later, and the map is wrong until someone moves something.
 *
 * The fix mirrors what `tokenDisplayPrefs` already does in `tick()`: the
 * registry hands out a NEW Map object whenever the table changes, so a
 * reference comparison per frame is exactly "the table changed since last
 * frame", with no extra event wiring.
 *
 * Spec: 41-token.md REQ-TOK-012, REQ-TOK-017, CA-TOK-002; 15-api-de-sistemas.md
 * REQ-SYS-009.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDocumentId, defaultTokenDocument, defaultSceneDocument } from "@fusion/shared";
import type { Container } from "pixi.js";

// --- PIXI stubs (same shape as TokenLayer.actorArtAcrossScenes.test.ts) -----
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
    hitArea: unknown = null;
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
  class StubRectangle {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
  }
  return {
    StubContainer,
    StubGraphics,
    StubSprite,
    StubText,
    StubTextStyle,
    StubRectangle,
  };
});

vi.mock("pixi.js", () => ({
  Container: pixiStubs.StubContainer,
  Rectangle: pixiStubs.StubRectangle,
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

const { TokenLayer } = await import("../TokenLayer.js");
const { DocumentMirror } = await import("../../../docs/DocumentMirror.js");
const { resetFootprintRegistry, seedFootprintRegistry } = await import(
  "../footprintRegistry.svelte.js"
);

// ---------------------------------------------------------------------------

const SCENE_ID = createDocumentId();
const ACTOR_ID = createDocumentId();
const TOKEN_ID = createDocumentId();
const GRID_SIZE = 100;

/** The sprite's hit rectangle is drawn from footprint × gridSize — read the width off it. */
function spriteWidthOf(layer: InstanceType<typeof TokenLayer>, tokenId: string): number {
  const sprite = layer.getSprite(tokenId);
  const hit = sprite?.container.hitArea as { width?: number } | null | undefined;
  return hit?.width ?? -1;
}

describe("TokenLayer + late footprint registry (R5, REQ-TOK-012 / REQ-SYS-009)", () => {
  beforeEach(() => {
    resetFootprintRegistry();
  });

  it("repaints a 'lg' token to 2x2 on the first tick after the registry answers", () => {
    const mirror = new DocumentMirror();
    const token = { ...defaultTokenDocument(TOKEN_ID, ACTOR_ID) };
    const scene = { ...defaultSceneDocument(SCENE_ID), tokens: [token] };

    mirror.applySnapshot({
      seq: 1,
      activeSceneId: SCENE_ID,
      documents: {
        Scene: [scene],
        Actor: [
          {
            _id: ACTOR_ID,
            name: "Ogro",
            img: null,
            system: { traits: { size: "lg" } },
          },
        ],
      },
    });

    // The canvas mounts BEFORE the `system:footprint` ack lands — the table is
    // still empty, so `footprintOf` fails open to 1x1.
    const layer = new TokenLayer(
      new pixiStubs.StubContainer() as unknown as Container,
      mirror,
      SCENE_ID,
      GRID_SIZE,
      true,
    );
    expect(spriteWidthOf(layer, TOKEN_ID)).toBe(GRID_SIZE);

    // The ack arrives. Nothing touches the Scene or the Actor.
    seedFootprintRegistry({ lg: { width: 2, height: 2 } });

    // One frame later the sprite is the size the system declared.
    layer.tick(16, 1);
    expect(spriteWidthOf(layer, TOKEN_ID)).toBe(GRID_SIZE * 2);

    layer.destroy();
  });

  it("does not reconcile again while the table stays the same", () => {
    const mirror = new DocumentMirror();
    const token = { ...defaultTokenDocument(TOKEN_ID, ACTOR_ID) };
    const scene = { ...defaultSceneDocument(SCENE_ID), tokens: [token] };

    mirror.applySnapshot({
      seq: 1,
      activeSceneId: SCENE_ID,
      documents: {
        Scene: [scene],
        Actor: [{ _id: ACTOR_ID, name: "Ogro", img: null, system: { traits: { size: "lg" } } }],
      },
    });

    seedFootprintRegistry({ lg: { width: 2, height: 2 } });

    const layer = new TokenLayer(
      new pixiStubs.StubContainer() as unknown as Container,
      mirror,
      SCENE_ID,
      GRID_SIZE,
      true,
    );
    const spriteBefore = layer.getSprite(TOKEN_ID);
    expect(spriteWidthOf(layer, TOKEN_ID)).toBe(GRID_SIZE * 2);

    layer.tick(16, 1);
    layer.tick(16, 1);

    // Same sprite instance — a steady table must not churn the layer.
    expect(layer.getSprite(TOKEN_ID)).toBe(spriteBefore);
    expect(spriteWidthOf(layer, TOKEN_ID)).toBe(GRID_SIZE * 2);

    layer.destroy();
  });
});
