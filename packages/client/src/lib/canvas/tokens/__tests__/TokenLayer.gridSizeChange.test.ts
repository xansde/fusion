/**
 * TokenLayer.gridSizeChange.test.ts
 *
 * R4 (integração pós-#194): changing the scene's grid cell size must re-lay the
 * sprites already on the map.
 *
 * `TokenLayer.setGridSize` existed but had no production caller, and #194's
 * `_loadedSceneId` guard removed the canvas reload that used to rebuild
 * everything on any Scene mutation — so a Mestre editing the grid with the
 * scene's pencil kept seeing the tokens drawn on the old cell size until F5.
 * `SceneOrchestrator._onSceneChange` now calls this (see
 * scene-orchestrator.test.ts); what this file pins is the other half: that the
 * call actually REDRAWS. `TokenSprite.update` used to repaint only when the
 * footprint (in CELLS), the disposition, the art, … changed — a token whose
 * footprint stays 1×1 while the cell grows from 100px to 140px changed none of
 * those, so it silently kept its old pixel size.
 *
 * Spec: 06-canvas-e-renderizacao.md §REQ-CNV-025..033; 41-token.md REQ-TOK-012.
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
const { resetFootprintRegistry, seedFootprintRegistry } =
  await import("../footprintRegistry.svelte.js");

// ---------------------------------------------------------------------------

const SCENE_ID = createDocumentId();
const ACTOR_ID = createDocumentId();
const TOKEN_ID = createDocumentId();

/** The sprite's hit rectangle is drawn from footprint × gridSize — read the width off it. */
function spriteWidthOf(layer: InstanceType<typeof TokenLayer>, tokenId: string): number {
  const sprite = layer.getSprite(tokenId);
  const hit = sprite?.container.hitArea as { width?: number } | null | undefined;
  return hit?.width ?? -1;
}

describe("TokenLayer.setGridSize (R4)", () => {
  beforeEach(() => {
    resetFootprintRegistry();
    seedFootprintRegistry({ med: { width: 1, height: 1 }, lg: { width: 2, height: 2 } });
  });

  it("redraws a 1x1 token at the new cell size", () => {
    const mirror = new DocumentMirror();
    const token = { ...defaultTokenDocument(TOKEN_ID, ACTOR_ID) };
    const scene = { ...defaultSceneDocument(SCENE_ID), tokens: [token] };

    mirror.applySnapshot({
      seq: 1,
      activeSceneId: SCENE_ID,
      documents: {
        Scene: [scene],
        Actor: [{ _id: ACTOR_ID, name: "Goblin", img: null, system: { traits: { size: "med" } } }],
      },
    });

    const layer = new TokenLayer(
      new pixiStubs.StubContainer() as unknown as Container,
      mirror,
      SCENE_ID,
      100,
      true,
    );
    expect(spriteWidthOf(layer, TOKEN_ID)).toBe(100);

    layer.setGridSize(140, [token]);

    expect(spriteWidthOf(layer, TOKEN_ID)).toBe(140);

    layer.destroy();
  });

  it("redraws a 2x2 token at twice the new cell size", () => {
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

    const layer = new TokenLayer(
      new pixiStubs.StubContainer() as unknown as Container,
      mirror,
      SCENE_ID,
      100,
      true,
    );
    expect(spriteWidthOf(layer, TOKEN_ID)).toBe(200);

    layer.setGridSize(50, [token]);

    expect(spriteWidthOf(layer, TOKEN_ID)).toBe(100);

    layer.destroy();
  });
});
