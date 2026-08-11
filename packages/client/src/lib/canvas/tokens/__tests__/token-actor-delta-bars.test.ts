/**
 * token-actor-delta-bars.test.ts — six skeletons, six hit-point pools, on screen.
 *
 * REQ-DOC-031/032/033 (spec 02): an unlinked token's effective actor is the base
 * Actor with `Token.actorDelta` merged over it; a linked token IS the Actor.
 * REQ-CNV-090 / REQ-CNV-091 (spec 06): the resource bar reflects the real value
 * of the attribute on that EFFECTIVE actor — so two tokens of the same Actor
 * that have taken different damage draw different bars.
 * REQ-CNV-092 (spec 06): the bar repaints when `actorLink` / `actorDelta`
 * change, which is the only signal a damaged unlinked token ever produces.
 *
 * This is the assertion that proves the feature. Without it the model, the
 * router and the redaction of stage 1 are all invisible: the table sees six
 * identical bars and learns the truth only when the third skeleton refuses to
 * die alone.
 *
 * Runs in the node environment against real PIXI containers and a fake mirror —
 * same setup as `token-layer-bars.test.ts`.
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

const GM = { userId: "gm1", role: 4 };

interface FakeActor {
  _id: string;
  ownership: Record<string, number>;
  system: Record<string, unknown>;
}

function skeleton(id: string, over: Partial<TokenDocument> = {}): TokenDocument {
  return TokenDocumentSchema.parse({
    _id: id,
    name: "Esqueleto",
    actorId: ACTOR_ID,
    actorLink: false,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    bar1: { attribute: "attributes.hp" },
    ...over,
  });
}

class FakeMirror implements TokenLayerMirror {
  scene: { _id: string; tokens: TokenDocument[] };
  actor: FakeActor;
  private _listeners = new Map<string, Array<(docs: unknown[]) => void>>();

  constructor(tokens: TokenDocument[], actorSystem: Record<string, unknown>) {
    this.scene = { _id: SCENE_ID, tokens };
    this.actor = {
      _id: ACTOR_ID,
      ownership: { default: 0 },
      system: actorSystem,
    };
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
    if (type === "Actor" && id === ACTOR_ID) return this.actor as T;
    return undefined;
  }

  /** Replace the scene's token list and push it, as a Scene broadcast would. */
  pushTokens(tokens: TokenDocument[]): void {
    this.scene = { _id: SCENE_ID, tokens };
    for (const cb of this._listeners.get("Scene") ?? []) cb([this.scene]);
  }
}

/** Drawn width of a token's bar1 fill, in pixels. 0 means "not drawn at all". */
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

// ---------------------------------------------------------------------------

describe("token bars read the EFFECTIVE actor (REQ-DOC-033 / REQ-CNV-091)", () => {
  it("draws different bars for two unlinked tokens of the same Actor", () => {
    const mirror = new FakeMirror(
      [
        skeleton("tok0000000000001", {
          actorDelta: { system: { attributes: { hp: { value: 20, max: 20 } } } },
        }),
        skeleton("tok0000000000002", {
          actorDelta: { system: { attributes: { hp: { value: 5, max: 20 } } } },
        }),
      ],
      { attributes: { hp: { value: 20, max: 20 } } },
    );

    const layer = new TokenLayer(new Container(), mirror, SCENE_ID, GRID, true, GM);

    // Full pool → full footprint; a quarter left → a quarter of the footprint.
    expect(fillWidth(layer, "tok0000000000001")).toBeCloseTo(GRID, 5);
    expect(fillWidth(layer, "tok0000000000002")).toBeCloseTo(GRID / 4, 5);
  });

  it("ignores the delta of a LINKED token — it is the world Actor (REQ-DOC-032)", () => {
    const mirror = new FakeMirror(
      [
        skeleton("tok0000000000001", {
          actorLink: true,
          // Left over from a period when this token was unlinked. Flipping the
          // link back must restore what the token had, not throw the delta away
          // — so it stays stored, and it must NOT be read while linked.
          actorDelta: { system: { attributes: { hp: { value: 1, max: 20 } } } },
        }),
      ],
      { attributes: { hp: { value: 20, max: 20 } } },
    );

    const layer = new TokenLayer(new Container(), mirror, SCENE_ID, GRID, true, GM);

    expect(fillWidth(layer, "tok0000000000001")).toBeCloseTo(GRID, 5);
  });

  it("repaints the damaged token and ONLY it when its delta changes", () => {
    const alive = skeleton("tok0000000000001", {
      actorDelta: { system: { attributes: { hp: { value: 20, max: 20 } } } },
    });
    const other = skeleton("tok0000000000002", {
      actorDelta: { system: { attributes: { hp: { value: 20, max: 20 } } } },
    });
    const mirror = new FakeMirror([alive, other], { attributes: { hp: { value: 20, max: 20 } } });
    const layer = new TokenLayer(new Container(), mirror, SCENE_ID, GRID, true, GM);

    expect(fillWidth(layer, "tok0000000000001")).toBeCloseTo(GRID, 5);

    // Damage to skeleton 1 arrives as an embedded Token update on the Scene —
    // there is no Actor op at all, which is precisely why the sprite's
    // "did anything visual change" contract has to name the delta.
    mirror.pushTokens([
      skeleton("tok0000000000001", {
        actorDelta: { system: { attributes: { hp: { value: 2, max: 20 } } } },
      }),
      other,
    ]);

    expect(fillWidth(layer, "tok0000000000001")).toBeCloseTo(GRID / 10, 5);
    expect(fillWidth(layer, "tok0000000000002")).toBeCloseTo(GRID, 5);
  });

  it("repaints when a token is unlinked from the Actor mid-session", () => {
    const mirror = new FakeMirror([skeleton("tok0000000000001", { actorLink: true })], {
      attributes: { hp: { value: 20, max: 20 } },
    });
    const layer = new TokenLayer(new Container(), mirror, SCENE_ID, GRID, true, GM);
    expect(fillWidth(layer, "tok0000000000001")).toBeCloseTo(GRID, 5);

    mirror.pushTokens([
      skeleton("tok0000000000001", {
        actorLink: false,
        actorDelta: { system: { attributes: { hp: { value: 10, max: 20 } } } },
      }),
    ]);

    expect(fillWidth(layer, "tok0000000000001")).toBeCloseTo(GRID / 2, 5);
  });

  it("falls back to the base Actor when the delta says nothing about the bar", () => {
    const mirror = new FakeMirror(
      [
        skeleton("tok0000000000001", {
          actorDelta: { name: "Esqueleto Capitão" },
        }),
      ],
      { attributes: { hp: { value: 15, max: 20 } } },
    );
    const layer = new TokenLayer(new Container(), mirror, SCENE_ID, GRID, true, GM);

    expect(fillWidth(layer, "tok0000000000001")).toBeCloseTo(GRID * 0.75, 5);
  });

  it("still applies the ownership cut on the BASE Actor (DEC-CNV-15)", () => {
    // A player with nothing on the Actor sees no bar, however rich the delta is
    // — the delta is not a back door around the ownership ladder. (On the wire
    // the server has already emptied it, REQ-DOC-062; this is the client half.)
    const mirror = new FakeMirror(
      [
        skeleton("tok0000000000001", {
          actorDelta: { system: { attributes: { hp: { value: 5, max: 20 } } } },
        }),
      ],
      { attributes: { hp: { value: 20, max: 20 } } },
    );
    const layer = new TokenLayer(new Container(), mirror, SCENE_ID, GRID, false, {
      userId: "player1",
      role: 1,
    });

    expect(fillWidth(layer, "tok0000000000001")).toBe(0);

    // …and an OBSERVER on the Actor draws whatever delta they legitimately
    // hold. Today no non-privileged socket ever holds one — REQ-DOC-062 empties
    // it by ROLE, so this viewer would in practice receive the base Actor's
    // numbers and draw a full bar. The rule asserted here is the client's, and
    // it is the one that has to already be right on the day DEC-DOC-12's V2
    // note lands and the redaction becomes per-viewer.
    mirror.actor.ownership = { default: OwnershipLevel.OBSERVER };
    const seen = new TokenLayer(new Container(), mirror, SCENE_ID, GRID, false, {
      userId: "player1",
      role: 1,
    });
    expect(fillWidth(seen, "tok0000000000001")).toBeCloseTo(GRID / 4, 5);
  });
});
