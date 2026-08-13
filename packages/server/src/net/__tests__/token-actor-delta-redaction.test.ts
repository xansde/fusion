/**
 * An unlinked token's `actorDelta` must NEVER reach a non-GM socket — REQ-DOC-062.
 *
 * REQ-NET-096 keeps an `Actor` away from a viewer below LIMITED on it, because
 * the `Actor` is where `system.attributes.hp` lives. For an UNLINKED token that
 * stops being true: its hit points live in `Token.actorDelta`, inside a
 * `Scene`, and Scenes are shared world state that every player receives. The
 * gate the HP indicator was built on is therefore one document away from being
 * pointless unless the delta is cut too.
 *
 * The emission paths, same four as every other redaction in this module:
 *   1. join snapshot        — buildSnapshot        → stripTokenActorDeltas
 *   2. live broadcast       — broadcastToWorld     → stripTokenActorDeltas
 *   3. delta resync replay  — filterOpsForRole     → stripTokenActorDeltas
 *   4. ack echoed to sender — redactAckResultForNonPrivileged
 * ...plus a fifth producer that also puts whole Scenes on the wire and is easy
 * to forget: the wall/light/door broadcaster in vision-handlers.
 *
 * Paths 1–3 and the fifth call `stripTokenActorDeltas` directly, so they are
 * covered by testing it plus the detectors that gate them. Path 4 has its own
 * structural walk and is exercised through its real entry point below.
 *
 * The end-to-end proof over real sockets lives in
 * `__tests__/token-actor-delta-e2e.test.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  stripTokenActorDeltas,
  sceneHasTokenActorDeltas,
  scenePayloadHasTokenActorDeltas,
  redactAckResultForNonPrivileged,
} from "../redaction.js";

const LINKED_TOKEN = {
  _id: "tokenLinked00001",
  name: "Heroína",
  actorId: "actorHero0000001",
  actorLink: true,
  actorDelta: {},
};

const WOUNDED_SKELETON = {
  _id: "tokenSkeleton001",
  name: "Esqueleto 3",
  actorId: "actorSkeleton001",
  actorLink: false,
  actorDelta: { system: { attributes: { hp: { value: 2 } } } },
};

const scene = (tokens: unknown[]): Record<string, unknown> => ({
  _id: "sceneCripta00001",
  name: "Cripta",
  tokens,
  walls: [],
});

describe("stripTokenActorDeltas", () => {
  it("empties the delta of every token that carries one", () => {
    const redacted = stripTokenActorDeltas(scene([LINKED_TOKEN, WOUNDED_SKELETON]));
    const tokens = redacted["tokens"] as Record<string, unknown>[];

    expect(tokens).toHaveLength(2);
    expect(tokens[1]?.["actorDelta"]).toEqual({});
    // Everything else about the token survives — the token itself is not
    // secret, only the sheet it is carrying.
    expect(tokens[1]?.["name"]).toBe("Esqueleto 3");
    expect(tokens[1]?.["actorLink"]).toBe(false);
    expect(tokens[1]?.["actorId"]).toBe("actorSkeleton001");
  });

  it("returns the SAME object when no token carries a delta", () => {
    const original = scene([LINKED_TOKEN]);
    expect(stripTokenActorDeltas(original)).toBe(original);
  });

  it("never mutates the scene it was given — the payload is shared with the GM's socket", () => {
    const original = scene([WOUNDED_SKELETON]);
    stripTokenActorDeltas(original);
    const tokens = original["tokens"] as Record<string, unknown>[];
    expect(tokens[0]?.["actorDelta"]).toEqual({ system: { attributes: { hp: { value: 2 } } } });
  });

  it("tolerates a scene without a tokens array", () => {
    const odd = { _id: "sceneOdd00000001", name: "Sem tokens" };
    expect(stripTokenActorDeltas(odd)).toBe(odd);
  });
});

describe("the detectors that gate the strip", () => {
  it("sceneHasTokenActorDeltas sees a delta, and only a real one", () => {
    expect(sceneHasTokenActorDeltas(scene([WOUNDED_SKELETON]))).toBe(true);
    expect(sceneHasTokenActorDeltas(scene([LINKED_TOKEN]))).toBe(false);
    expect(sceneHasTokenActorDeltas(scene([]))).toBe(false);
    expect(sceneHasTokenActorDeltas(null)).toBe(false);
    expect(sceneHasTokenActorDeltas({ _id: "x" })).toBe(false);
  });

  it("scenePayloadHasTokenActorDeltas answers for a whole broadcast payload", () => {
    expect(scenePayloadHasTokenActorDeltas([scene([LINKED_TOKEN])])).toBe(false);
    expect(
      scenePayloadHasTokenActorDeltas([scene([LINKED_TOKEN]), scene([WOUNDED_SKELETON])]),
    ).toBe(true);
  });
});

describe("path 4 — the ack echoed back to the requester", () => {
  it("strips the delta from a Scene in result.documents", () => {
    const ack = {
      ok: true,
      result: { documentType: "Scene", documents: [scene([WOUNDED_SKELETON])] },
    };

    const redacted = redactAckResultForNonPrivileged(ack) as {
      result: { documents: Record<string, unknown>[] };
    };
    const tokens = redacted.result.documents[0]?.["tokens"] as Record<string, unknown>[];
    expect(tokens[0]?.["actorDelta"]).toEqual({});
  });

  it("strips the delta from the Scene sent back as result.parent", () => {
    // The shape an embedded create/delete ack uses: the token in `documents`,
    // the whole Scene in `parent`.
    const ack = {
      ok: true,
      result: {
        documentType: "Token",
        documents: [WOUNDED_SKELETON],
        parent: scene([WOUNDED_SKELETON]),
      },
    };

    const redacted = redactAckResultForNonPrivileged(ack) as {
      result: { parent: Record<string, unknown> };
    };
    const tokens = redacted.result.parent["tokens"] as Record<string, unknown>[];
    expect(tokens[0]?.["actorDelta"]).toEqual({});
  });

  it("leaves an ack with nothing to redact untouched (no allocation)", () => {
    const ack = { ok: true, result: { documentType: "Scene", documents: [scene([LINKED_TOKEN])] } };
    expect(redactAckResultForNonPrivileged(ack)).toBe(ack);
  });

  it("does not touch an error ack", () => {
    const ack = { ok: false, code: "PERMISSION_DENIED", message: "nope" };
    expect(redactAckResultForNonPrivileged(ack)).toBe(ack);
  });
});
