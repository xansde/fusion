/**
 * token-layer-bars.test.ts — the Actor → canvas bridge.
 *
 * REQ-CNV-090 (spec 06): the bar reflects the real value of the actor's
 * attribute. HP lives on the Actor, not on the TokenDocument, so damage
 * produces NO scene op at all — before this bridge existed the canvas simply
 * never heard about it and the bar sat frozen at its birth value, silently.
 * DEC-CNV-15 (spec 06): the `observer` cut is read off the Actor's ownership
 * map, since a token carries none of its own.
 *
 * Runs in the node environment against real PIXI containers and a fake mirror.
 */

import { describe, it, expect } from "vitest";
import { Container, Graphics } from "pixi.js";
import { TokenLayer } from "../TokenLayer.js";
import type { TokenLayerMirror } from "../TokenLayer.js";
import { TokenDocumentSchema, OwnershipLevel } from "@fusion/shared";
import type { TokenDocument } from "@fusion/shared";

const GRID = 100;
const SCENE_ID = "scn0000000000001";
const ACTOR_ID = "act0000000000001";

interface FakeActor {
  _id: string;
  ownership: Record<string, number>;
  system: Record<string, unknown>;
}

function makeToken(over: Partial<TokenDocument> = {}): TokenDocument {
  return TokenDocumentSchema.parse({
    _id: "tok0000000000001",
    name: "Tobias",
    actorId: ACTOR_ID,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    bar1: { attribute: "attributes.hp" },
    ...over,
  });
}

/**
 * A mirror just big enough for the layer: one scene, one actor, and the two
 * subscription channels the layer is expected to open.
 */
class FakeMirror implements TokenLayerMirror {
  scene: { _id: string; tokens: TokenDocument[] };
  actor: FakeActor;
  private _listeners = new Map<string, Array<(docs: unknown[]) => void>>();

  constructor(tokens: TokenDocument[], actor: FakeActor) {
    this.scene = { _id: SCENE_ID, tokens };
    this.actor = actor;
  }

  subscribe<T>(type: string, cb: (docs: T[]) => void): () => void {
    const list = this._listeners.get(type) ?? [];
    list.push(cb as (docs: unknown[]) => void);
    this._listeners.set(type, list);
    return () => {
      this._listeners.set(
        type,
        (this._listeners.get(type) ?? []).filter((f) => f !== cb),
      );
    };
  }

  getDoc<T>(type: string, id: string): T | undefined {
    if (type === "Scene" && id === SCENE_ID) return this.scene as T;
    if (type === "Actor" && id === this.actor._id) return this.actor as T;
    return undefined;
  }

  /** Simulate the server pushing a change of `type` to this client. */
  emitChange(type: string): void {
    const docs = type === "Scene" ? [this.scene] : [this.actor];
    for (const cb of this._listeners.get(type) ?? []) cb(docs);
  }

  subscriberCount(type: string): number {
    return (this._listeners.get(type) ?? []).length;
  }
}

function fillWidth(layer: TokenLayer, tokenId: string): number {
  const sprite = layer.getSprite(tokenId);
  if (!sprite) throw new Error(`no sprite for ${tokenId}`);
  const bars = sprite.container.getChildByLabel("bars");
  const fill = bars?.getChildByLabel("bar1-fill");
  if (!(fill instanceof Graphics)) throw new Error("no bar1-fill graphics");
  if (fill.context.instructions.length === 0) return 0;
  const b = fill.getLocalBounds();
  return b.maxX - b.minX;
}

function buildLayer(
  actorOwnership: Record<string, number>,
  hp: { value: number; max: number },
  viewer: { userId: string; role: number },
): { layer: TokenLayer; mirror: FakeMirror } {
  const mirror = new FakeMirror([makeToken()], {
    _id: ACTOR_ID,
    ownership: actorOwnership,
    system: { attributes: { hp } },
  });
  const layer = new TokenLayer(new Container(), mirror, SCENE_ID, GRID, viewer.role >= 4, viewer);
  return { layer, mirror };
}

// ---------------------------------------------------------------------------
// The bridge itself
// ---------------------------------------------------------------------------

describe("TokenLayer — Actor → sprite bridge (REQ-CNV-090)", () => {
  it("subscribes to Actor as well as Scene", () => {
    const { mirror } = buildLayer(
      { default: 0, u1: OwnershipLevel.OWNER },
      { value: 40, max: 40 },
      {
        userId: "u1",
        role: 1,
      },
    );
    expect(mirror.subscriberCount("Scene")).toBe(1);
    expect(mirror.subscriberCount("Actor")).toBe(1);
  });

  it("paints the actor's real HP on first reconcile", () => {
    const { layer } = buildLayer(
      { default: 0, u1: OwnershipLevel.OWNER },
      { value: 20, max: 40 },
      {
        userId: "u1",
        role: 1,
      },
    );
    expect(fillWidth(layer, "tok0000000000001")).toBeCloseTo(GRID / 2, 5);
  });

  it("repaints when the Actor changes and NO scene op is emitted", () => {
    const { layer, mirror } = buildLayer(
      { default: 0, u1: OwnershipLevel.OWNER },
      { value: 40, max: 40 },
      { userId: "u1", role: 1 },
    );
    expect(fillWidth(layer, "tok0000000000001")).toBeCloseTo(GRID, 5);

    // Damage: only the Actor document moves.
    mirror.actor.system = { attributes: { hp: { value: 10, max: 40 } } };
    mirror.emitChange("Actor");

    expect(fillWidth(layer, "tok0000000000001")).toBeCloseTo(GRID / 4, 5);
  });

  it("stops listening to Actor on destroy()", () => {
    const { layer, mirror } = buildLayer(
      { default: 0, u1: OwnershipLevel.OWNER },
      { value: 40, max: 40 },
      { userId: "u1", role: 1 },
    );
    layer.destroy();
    expect(mirror.subscriberCount("Actor")).toBe(0);
    expect(mirror.subscriberCount("Scene")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The ownership cut, resolved through the mirror (DEC-CNV-15)
// ---------------------------------------------------------------------------

describe("TokenLayer — the bar's ownership cut comes from the Actor", () => {
  const HP = { value: 40, max: 40 };

  it("an OBSERVER of the actor sees the bar", () => {
    const { layer } = buildLayer({ default: 0, u1: OwnershipLevel.OBSERVER }, HP, {
      userId: "u1",
      role: 1,
    });
    expect(fillWidth(layer, "tok0000000000001")).toBeGreaterThan(0);
  });

  it("a user at LIMITED does not", () => {
    const { layer } = buildLayer({ default: 0, u1: OwnershipLevel.LIMITED }, HP, {
      userId: "u1",
      role: 1,
    });
    expect(fillWidth(layer, "tok0000000000001")).toBe(0);
  });

  it("a user absent from the ownership map does not", () => {
    const { layer } = buildLayer({ default: 0 }, HP, { userId: "u9", role: 1 });
    expect(fillWidth(layer, "tok0000000000001")).toBe(0);
  });

  it("the default entry counts when it reaches OBSERVER", () => {
    const { layer } = buildLayer({ default: OwnershipLevel.OBSERVER }, HP, {
      userId: "u9",
      role: 1,
    });
    expect(fillWidth(layer, "tok0000000000001")).toBeGreaterThan(0);
  });

  it("the GM sees it with no entry in the map at all", () => {
    const { layer } = buildLayer({ default: 0 }, HP, { userId: "gm", role: 4 });
    expect(fillWidth(layer, "tok0000000000001")).toBeGreaterThan(0);
  });

  it("an Assistant is privileged too", () => {
    const { layer } = buildLayer({ default: 0 }, HP, { userId: "asst", role: 3 });
    expect(fillWidth(layer, "tok0000000000001")).toBeGreaterThan(0);
  });

  it("no bar when the viewer never received the Actor at all", () => {
    // REQ-NET-096: the server does not emit an Actor to a user who may not see
    // it, so an unresolvable actorId is the normal case for a hidden NPC.
    const mirror = new FakeMirror([makeToken({ actorId: "act-not-in-mirror" })], {
      _id: ACTOR_ID,
      ownership: { default: OwnershipLevel.OWNER },
      system: { attributes: { hp: { value: 40, max: 40 } } },
    });
    const layer = new TokenLayer(new Container(), mirror, SCENE_ID, GRID, false, {
      userId: "u1",
      role: 1,
    });
    expect(fillWidth(layer, "tok0000000000001")).toBe(0);
  });
});
