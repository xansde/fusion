/**
 * TokenLayer.artFollowsFootprint.test.ts
 *
 * REQ-TOK-017 (specs/41-token.md): "uma criatura que muda de tamanho em jogo DEVE ter o footprint dos
 * seus tokens alterado sem qualquer escrita nos tokens" — and what the player SEES of that is the ART.
 *
 * Found on screen, not in a test (core #288, roteiro `jogavel-O22-tamanho`): a Minotaur token on the
 * map that turned Medium (its player picked the Littlehorn heritage) kept drawing its 2×2 art. The
 * hit rectangle, the ring, the bars and the nameplate followed the new footprint — `TokenSprite.update`
 * repaints them when the footprint changes — but the art (the portrait sprite, or the placeholder
 * rectangle with its initials) is measured in pixels at load time and was only rebuilt when the
 * actor's `img` changed. Every test that pinned the repaint (`footprintRegistryArrival`,
 * `gridSizeChange`) read the hit rectangle, which is not what the table looks at.
 *
 * Until spec 17 DEC-PF2-13 nothing ever changed a character's size, so the defect had no way to show;
 * a derived size makes it routine (a heritage swap, a feat that enlarges). The same gap left the art at
 * the old cell size after a grid change (R4), so this pins that too.
 *
 * Spec: 41-token.md REQ-TOK-012, REQ-TOK-017, CA-TOK-002; 17-sistema-pf2e.md REQ-PF2-154.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDocumentId, defaultTokenDocument, defaultSceneDocument } from "@fusion/shared";
import type { Container } from "pixi.js";

// --- PIXI stubs: like TokenLayer.footprintRegistryArrival.test.ts, but they REMEMBER what was drawn ---
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
    destroyed = false;
    addChild(child: unknown): unknown {
      this.children.push(child);
      return child;
    }
    removeChildren(): void {
      this.children = [];
    }
    destroy(): void {
      this.destroyed = true;
      this.children = [];
    }
  }
  class StubGraphics extends StubContainer {
    /** `roundRect(x, y, width, height, radius)` calls, in order. */
    rects: number[][] = [];
    rect(): this {
      return this;
    }
    roundRect(x: number, y: number, width: number, height: number): this {
      this.rects.push([x, y, width, height]);
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
  return { StubContainer, StubGraphics, StubSprite, StubText, StubTextStyle, StubRectangle };
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
const GRID = 100;
const TABLE = { med: { width: 1, height: 1 }, lg: { width: 2, height: 2 } };

type Layer = InstanceType<typeof TokenLayer>;
type Mirror = InstanceType<typeof DocumentMirror>;

/** A character whose size the sheet DERIVED (spec 17 DEC-PF2-13) — `traits.size` sits at the default. */
function characterOf(size: string, img: string | null, version = 1): Record<string, unknown> {
  return {
    _id: ACTOR_ID,
    name: "Tobias",
    img,
    _stats: { version },
    system: { derived: { size }, traits: { size: "med" } },
  };
}

function setUp(
  size: string,
  img: string | null,
): { layer: Layer; mirror: Mirror; scene: Record<string, unknown> } {
  const mirror = new DocumentMirror();
  const token = { ...defaultTokenDocument(TOKEN_ID, ACTOR_ID) };
  const scene = { ...defaultSceneDocument(SCENE_ID), tokens: [token] };
  mirror.applySnapshot({
    seq: 1,
    activeSceneId: SCENE_ID,
    documents: { Scene: [scene], Actor: [characterOf(size, img)] },
  });
  const layer = new TokenLayer(
    new pixiStubs.StubContainer() as unknown as Container,
    mirror,
    SCENE_ID,
    GRID,
    true,
  );
  return { layer, mirror, scene };
}

/** The art container of the sprite: what the table actually sees of the token. */
function artOf(layer: Layer): unknown[] {
  const sprite = layer.getSprite(TOKEN_ID);
  const artContainer = (
    sprite?.container as unknown as InstanceType<typeof pixiStubs.StubContainer>
  ).children[0] as InstanceType<typeof pixiStubs.StubContainer>;
  return artContainer.children;
}

/** The pixel width the placeholder rectangle was drawn with (the last `roundRect` of the live one). */
function placeholderWidth(layer: Layer): number {
  const placeholder = artOf(layer).find((child) => child instanceof pixiStubs.StubGraphics) as
    | InstanceType<typeof pixiStubs.StubGraphics>
    | undefined;
  const rect = placeholder?.rects.at(-1);
  return rect?.[2] ?? -1;
}

function textureSprite(layer: Layer): InstanceType<typeof pixiStubs.StubSprite> | undefined {
  return artOf(layer).find((child) => child instanceof pixiStubs.StubSprite) as
    | InstanceType<typeof pixiStubs.StubSprite>
    | undefined;
}

/** Let the async `_loadArt` (Assets.load) finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

/** The actor changes and the mirror announces it — the path a live `doc:update` takes. */
function changeActor(mirror: Mirror, size: string, img: string | null, version: number): void {
  mirror.applySnapshot({
    seq: 2,
    activeSceneId: SCENE_ID,
    documents: {
      Scene: [
        {
          ...defaultSceneDocument(SCENE_ID),
          tokens: [{ ...defaultTokenDocument(TOKEN_ID, ACTOR_ID) }],
        },
      ],
      Actor: [characterOf(size, img, version)],
    },
  });
}

describe("the art of a token follows its footprint (REQ-TOK-017)", () => {
  beforeEach(() => {
    resetFootprintRegistry();
    seedFootprintRegistry(TABLE);
  });

  it("a placeholder token that shrinks Large → Medium is DRAWN 1×1, not just hit-tested 1×1", async () => {
    const { layer, mirror } = setUp("lg", null);
    await settle();
    expect(placeholderWidth(layer)).toBe(GRID * 2);

    changeActor(mirror, "med", null, 2);
    await settle();

    expect(placeholderWidth(layer)).toBe(GRID);
    layer.destroy();
  });

  it("and back: a Medium token that grows to Large is drawn 2×2", async () => {
    const { layer, mirror } = setUp("med", null);
    await settle();
    expect(placeholderWidth(layer)).toBe(GRID);

    changeActor(mirror, "lg", null, 2);
    await settle();

    expect(placeholderWidth(layer)).toBe(GRID * 2);
    layer.destroy();
  });

  it("a token with a portrait: the SAME sprite is re-measured — the texture is not reloaded", async () => {
    const { layer, mirror } = setUp("lg", "assets/x/tobias.webp");
    await settle();
    const before = textureSprite(layer);
    expect(before?.width).toBe(GRID * 2);
    expect(before?.height).toBe(GRID * 2);

    changeActor(mirror, "med", "assets/x/tobias.webp", 2);
    await settle();

    const after = textureSprite(layer);
    expect(after).toBe(before);
    expect(after?.width).toBe(GRID);
    expect(after?.height).toBe(GRID);
    // Still centred in the (now smaller) footprint.
    expect(after?.x).toBe(GRID / 2);
    expect(after?.y).toBe(GRID / 2);
    layer.destroy();
  });

  it("the hit rectangle still follows too (what the older tests pinned)", async () => {
    const { layer, mirror } = setUp("lg", null);
    changeActor(mirror, "med", null, 2);
    await settle();

    const hit = layer.getSprite(TOKEN_ID)?.container.hitArea as { width?: number } | null;
    expect(hit?.width).toBe(GRID);
    layer.destroy();
  });

  it("an actor change that leaves the size alone does not touch the art (no churn, no flicker)", async () => {
    const { layer, mirror } = setUp("lg", "assets/x/tobias.webp");
    await settle();
    const before = textureSprite(layer);

    changeActor(mirror, "lg", "assets/x/tobias.webp", 2);
    await settle();

    expect(textureSprite(layer)).toBe(before);
    expect(before?.destroyed).toBe(false);
    layer.destroy();
  });

  it("the art also follows a change of the GRID's cell size (R4): 100px → 140px", async () => {
    const { layer, scene } = setUp("lg", null);
    await settle();
    expect(placeholderWidth(layer)).toBe(GRID * 2);

    layer.setGridSize(140, scene["tokens"] as never);
    await settle();

    expect(placeholderWidth(layer)).toBe(140 * 2);
    layer.destroy();
  });

  it("a size that changes while the portrait is still LOADING lands the art at the new size, not the old one", async () => {
    const { layer, mirror } = setUp("lg", "assets/x/tobias.webp");
    // No `await settle()`: the texture has not arrived when the creature shrinks.
    changeActor(mirror, "med", "assets/x/tobias.webp", 2);
    await settle();

    expect(textureSprite(layer)?.width).toBe(GRID);
    layer.destroy();
  });
});
