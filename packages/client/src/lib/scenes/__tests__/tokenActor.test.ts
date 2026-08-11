/**
 * tokenActor.test.ts — a sheet opened from a token writes to THAT token.
 *
 * REQ-DOC-032 (spec 02): a linked token's actor IS the world Actor, so its
 * writes keep going straight there.
 * REQ-DOC-033/034 (spec 02): an unlinked token's actor is base + `actorDelta`,
 * and mutating it is `token:updateActor` — never a `doc:update` on the Actor,
 * which would damage every other token sharing it.
 * REQ-DOC-035 (spec 02): item-granular deltas are V2, which is why an
 * item/effect edit on an unlinked token is refused instead of guessed at.
 * REQ-CNV-094 / DEC-CNV-16 (spec 06): a sheet opened FROM a token shows that
 * token's actor and routes its edits there, with the gap declared rather than
 * guessed at.
 */

import { describe, it, expect, vi } from "vitest";
import {
  buildTokenUpdateActorOp,
  isDeltaSafeDiff,
  makeTokenActorSendOpFn,
  readEffectiveActorDoc,
  routeSheetOp,
  subscribeEffectiveActorDoc,
  type EffectiveActorMirror,
  type TokenActorBinding,
} from "../tokenActor.js";
import { TokenUpdateActorPayloadSchema } from "@fusion/shared";

const SCENE_ID = "scn0000000000001";
const TOKEN_ID = "tok0000000000001";
const ACTOR_ID = "act0000000000001";

const UNLINKED: TokenActorBinding = {
  sceneId: SCENE_ID,
  tokenId: TOKEN_ID,
  actorId: ACTOR_ID,
  linked: false,
};
const LINKED: TokenActorBinding = { ...UNLINKED, linked: true };

/** The shape every sheet VM emits for a field edit (flat, pre-normalisation). */
function hpOp(value: number, actorId = ACTOR_ID): Record<string, unknown> {
  return {
    type: "doc:update",
    documentType: "Actor",
    id: actorId,
    diff: { "system.attributes.hp.value": value },
  };
}

// ---------------------------------------------------------------------------
// The op itself
// ---------------------------------------------------------------------------

describe("buildTokenUpdateActorOp (REQ-DOC-034)", () => {
  it("produces a payload the server's schema accepts", () => {
    const { type, ...payload } = buildTokenUpdateActorOp(UNLINKED, { "system.x": 1 });

    expect(type).toBe("token:updateActor");
    // The flat op minus `type` is exactly the wire payload — this is the whole
    // contract with makeSendOpFn, and a renamed key here would be a runtime
    // VALIDATION_FAILED that no type checker catches.
    expect(() => TokenUpdateActorPayloadSchema.parse(payload)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

describe("routeSheetOp — where an edit lands (REQ-DOC-032/033/034)", () => {
  it("routes an unlinked token's HP edit to the token, not to the Actor", () => {
    const decision = routeSheetOp(hpOp(7), UNLINKED);

    expect(decision.kind).toBe("routed");
    if (decision.kind !== "routed") throw new Error("unreachable");
    expect(decision.op).toEqual({
      type: "token:updateActor",
      sceneId: SCENE_ID,
      tokenId: TOKEN_ID,
      diff: { "system.attributes.hp.value": 7 },
    });
  });

  it("leaves a LINKED token's edit exactly as the sheet built it", () => {
    const op = hpOp(7);
    const decision = routeSheetOp(op, LINKED);

    expect(decision.kind).toBe("passthrough");
    if (decision.kind !== "passthrough") throw new Error("unreachable");
    expect(decision.op).toBe(op);
  });

  it("does not touch ops aimed at another document", () => {
    for (const op of [
      hpOp(7, "act0000000000002"),
      { type: "roll:check", formula: "1d20", actorId: ACTOR_ID, context: {} },
      { type: "doc:update", documentType: "Item", id: ACTOR_ID, diff: { name: "x" } },
      { type: "chat:send", content: "hi" },
      null,
      "not an op",
    ]) {
      expect(routeSheetOp(op, UNLINKED).kind).toBe("passthrough");
    }
  });

  it("REFUSES an item/effect edit rather than corrupting the collection", () => {
    // `items.-<id>` is an instruction to an ARRAY. The delta path expands
    // dotted keys into plain objects and arrays REPLACE on merge, so obeying
    // this would swap the actor's whole item list for `{ "-itm1": true }`.
    const decision = routeSheetOp(
      {
        type: "doc:update",
        documentType: "Actor",
        id: ACTOR_ID,
        diff: { "items.-itm0000000000001": true },
      },
      UNLINKED,
    );

    expect(decision.kind).toBe("refused");
  });

  it("REFUSES an ownership edit on the delta (REQ-USR-015 parity)", () => {
    const decision = routeSheetOp(
      { type: "doc:update", documentType: "Actor", id: ACTOR_ID, diff: { "ownership.u1": 3 } },
      UNLINKED,
    );

    expect(decision.kind).toBe("refused");
  });

  it("accepts the fields a merge patch can actually hold", () => {
    expect(isDeltaSafeDiff({ "system.attributes.hp.value": 1 })).toBe(true);
    expect(isDeltaSafeDiff({ name: "Esqueleto 3" })).toBe(true);
    expect(isDeltaSafeDiff({ img: null })).toBe(true);
    expect(isDeltaSafeDiff({ "flags.fusion.marked": true })).toBe(true);

    expect(isDeltaSafeDiff({})).toBe(false);
    expect(isDeltaSafeDiff({ "items.+": {} })).toBe(false);
    expect(isDeltaSafeDiff({ _id: "x" })).toBe(false);
    expect(isDeltaSafeDiff({ "effects.-eff1": true })).toBe(false);
  });
});

describe("makeTokenActorSendOpFn", () => {
  it("forwards the ROUTED op and swallows the refused one", () => {
    const sent: unknown[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = makeTokenActorSendOpFn((op) => sent.push(op), UNLINKED);

    send(hpOp(3));
    send({
      type: "doc:update",
      documentType: "Actor",
      id: ACTOR_ID,
      diff: { "items.+": { type: "condition" } },
    });

    expect(sent).toHaveLength(1);
    expect((sent[0] as { type: string }).type).toBe("token:updateActor");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Reading the effective actor
// ---------------------------------------------------------------------------

class FakeMirror implements EffectiveActorMirror {
  actor: Record<string, unknown>;
  scene: Record<string, unknown>;
  private _listeners = new Map<string, Array<() => void>>();

  constructor(actorHp: number, tokenDelta: Record<string, unknown> | null, actorLink = false) {
    this.actor = {
      _id: ACTOR_ID,
      name: "Esqueleto",
      system: { attributes: { hp: { value: actorHp, max: 20 } } },
    };
    this.scene = {
      _id: SCENE_ID,
      tokens: [
        {
          _id: TOKEN_ID,
          actorId: ACTOR_ID,
          actorLink,
          ...(tokenDelta ? { actorDelta: tokenDelta } : {}),
        },
      ],
    };
  }

  subscribe<T>(type: string, cb: (docs: T[]) => void): () => void {
    const list = this._listeners.get(type) ?? [];
    const fn = (): void => {
      cb([] as T[]);
    };
    list.push(fn);
    this._listeners.set(type, list);
    return () => {
      this._listeners.set(
        type,
        (this._listeners.get(type) ?? []).filter((f) => f !== fn),
      );
    };
  }

  getDoc<T>(type: string, id: string): T | undefined {
    if (type === "Actor" && id === ACTOR_ID) return this.actor as T;
    if (type === "Scene" && id === SCENE_ID) return this.scene as T;
    return undefined;
  }

  push(type: string): void {
    for (const fn of this._listeners.get(type) ?? []) fn();
  }

  subscriberCount(type: string): number {
    return (this._listeners.get(type) ?? []).length;
  }
}

function hpOf(doc: Record<string, unknown> | null): number | undefined {
  const system = doc?.["system"] as Record<string, unknown> | undefined;
  const attributes = system?.["attributes"] as Record<string, unknown> | undefined;
  const hp = attributes?.["hp"] as Record<string, unknown> | undefined;
  return hp?.["value"] as number | undefined;
}

describe("readEffectiveActorDoc (REQ-DOC-032/033)", () => {
  it("merges the token's delta over the base Actor", () => {
    const mirror = new FakeMirror(20, { system: { attributes: { hp: { value: 4 } } } });

    expect(hpOf(readEffectiveActorDoc(mirror, ACTOR_ID, UNLINKED))).toBe(4);
    // The base Actor is untouched — the other five skeletons still read 20.
    expect(hpOf(mirror.actor)).toBe(20);
  });

  it("returns the world Actor for a linked token, delta or no delta", () => {
    const mirror = new FakeMirror(20, { system: { attributes: { hp: { value: 4 } } } }, true);

    expect(hpOf(readEffectiveActorDoc(mirror, ACTOR_ID, LINKED))).toBe(20);
  });

  it("returns the plain Actor when no token is bound", () => {
    const mirror = new FakeMirror(20, null);

    expect(readEffectiveActorDoc(mirror, ACTOR_ID, null)).toBe(mirror.actor);
  });

  it("returns null when the bound token has left the scene", () => {
    const mirror = new FakeMirror(20, null);
    mirror.scene = { _id: SCENE_ID, tokens: [] };

    expect(readEffectiveActorDoc(mirror, ACTOR_ID, UNLINKED)).toBeNull();
  });
});

describe("subscribeEffectiveActorDoc — the sheet must not freeze", () => {
  it("watches BOTH collections when a token is bound", () => {
    const mirror = new FakeMirror(20, { system: { attributes: { hp: { value: 4 } } } });
    const seen: number[] = [];

    const unsub = subscribeEffectiveActorDoc(mirror, ACTOR_ID, UNLINKED, (doc) => {
      seen.push(hpOf(doc) ?? -1);
    });

    // Fires once immediately, so the sheet never renders an empty first frame.
    expect(seen).toEqual([4]);

    // Damage to THIS token arrives as a Scene op and nothing else.
    mirror.scene = {
      _id: SCENE_ID,
      tokens: [
        {
          _id: TOKEN_ID,
          actorId: ACTOR_ID,
          actorLink: false,
          actorDelta: { system: { attributes: { hp: { value: 1 } } } },
        },
      ],
    };
    mirror.push("Scene");
    expect(seen).toEqual([4, 1]);

    // A change to the base Actor still reaches the sheet (max, name, art…).
    mirror.push("Actor");
    expect(seen).toEqual([4, 1, 1]);

    unsub();
    expect(mirror.subscriberCount("Scene")).toBe(0);
    expect(mirror.subscriberCount("Actor")).toBe(0);
  });

  it("watches only the Actor when nothing is bound", () => {
    const mirror = new FakeMirror(20, null);
    const unsub = subscribeEffectiveActorDoc(mirror, ACTOR_ID, null, () => {});

    expect(mirror.subscriberCount("Actor")).toBe(1);
    expect(mirror.subscriberCount("Scene")).toBe(0);
    unsub();
  });
});
