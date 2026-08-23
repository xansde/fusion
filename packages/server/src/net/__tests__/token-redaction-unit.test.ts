/**
 * token-redaction-unit.test.ts — pure unit tests for the token-specific
 * additions to `net/redaction.ts` made by spec 41-token.md's Fase 6:
 *
 *   TK070 — `seenBy` exception to `hidden` (REQ-TOK-050/051/052, DEC-TOK-08)
 *   TK072 — hit points cut at OWNER (REQ-TOK-070/071/072, DEC-TOK-10)
 *   REQ-DOC-062 — an unlinked token's own `actorDelta.system.attributes.hp`
 *     is redacted for every non-privileged viewer, BY ROLE (fail-closed —
 *     not by ownership of the base Actor, unlike TK072's Actor-level cut).
 *
 * These pin the pure functions in isolation; `token-hidden-seenby-e2e.test.ts`,
 * `token-hp-redaction-e2e.test.ts` and `token-actor-delta-hp-redaction-e2e.test.ts`
 * prove the same rules hold across the real boot()+socket path (the four
 * REQ-NET-096 emission paths).
 */

import { describe, it, expect } from "vitest";
import {
  stripHiddenTokens,
  redactSceneDocsForNonPrivileged,
  stripActorHp,
  stripPrivilegedActorFields,
  redactActorDocsForViewer,
  stripTokenActorDeltaHp,
  redactTokenActorDeltaHp,
  type ContactViewer,
} from "../redaction.js";
// ---------------------------------------------------------------------------
// TK070 — stripHiddenTokens / redactSceneDocsForNonPrivileged: seenBy
// ---------------------------------------------------------------------------

function makeScene(tokens: Record<string, unknown>[]): Record<string, unknown> {
  return { _id: "scene1", active: true, tokens, walls: [] };
}

describe("stripHiddenTokens — seenBy exception (TK070, REQ-TOK-050/051/052)", () => {
  it("strips a hidden token from a viewer with no userId (conservative default)", () => {
    const scene = makeScene([{ _id: "tok1", hidden: true, seenBy: [] }]);
    const result = stripHiddenTokens(scene);
    expect(result["tokens"]).toEqual([]);
  });

  it("strips a hidden token from a userId NOT in seenBy", () => {
    const scene = makeScene([{ _id: "tok1", hidden: true, seenBy: ["userA"] }]);
    const result = stripHiddenTokens(scene, "userB");
    expect(result["tokens"]).toEqual([]);
  });

  it("keeps a hidden token for a userId IN seenBy (CA-TOK-007's exception)", () => {
    const token = { _id: "tok1", hidden: true, seenBy: ["userA", "userB"] };
    const scene = makeScene([token]);
    const result = stripHiddenTokens(scene, "userA");
    expect(result["tokens"]).toEqual([token]);
  });

  it("does not touch a non-hidden token regardless of seenBy or userId", () => {
    const token = { _id: "tok1", hidden: false, seenBy: [] };
    const scene = makeScene([token]);
    const result = stripHiddenTokens(scene, "anyone");
    expect(result).toBe(scene); // referential equality — zero-allocation fast path
  });

  it("returns the original scene reference when nothing needed stripping for this viewer", () => {
    const token = { _id: "tok1", hidden: true, seenBy: ["userA"] };
    const scene = makeScene([token]);
    const result = stripHiddenTokens(scene, "userA");
    expect(result).toBe(scene);
  });
});

describe("redactSceneDocsForNonPrivileged threads userId to seenBy (TK070)", () => {
  it("a scene's hidden token with a seenBy exception survives for that viewer only", () => {
    const scene = makeScene([{ _id: "tok1", hidden: true, seenBy: ["userA"] }]);
    const [forA] = redactSceneDocsForNonPrivileged([scene], "userA");
    const [forB] = redactSceneDocsForNonPrivileged([scene], "userB");
    expect((forA?.["tokens"] as unknown[]).length).toBe(1);
    expect((forB?.["tokens"] as unknown[]).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TK072 — stripActorHp / stripPrivilegedActorFields: hp cut at OWNER
// ---------------------------------------------------------------------------

function makeActor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: "actor1",
    name: "Tobias",
    type: "character",
    ownership: { default: 0 },
    system: { attributes: { hp: { value: 12, max: 20 } }, traits: { size: "med" } },
    flags: {},
    ...overrides,
  };
}

describe("stripActorHp (TK072, REQ-TOK-070)", () => {
  it("removes system.attributes.hp, keeping the rest of system intact", () => {
    const doc = makeActor();
    const stripped = stripActorHp(doc);
    const system = stripped["system"] as Record<string, unknown>;
    const attributes = system["attributes"] as Record<string, unknown>;
    expect("hp" in attributes).toBe(false);
    expect((system["traits"] as Record<string, unknown>)["size"]).toBe("med");
  });

  it("returns the original reference when there is no hp to strip", () => {
    const doc = makeActor({ system: { traits: { size: "med" } } });
    expect(stripActorHp(doc)).toBe(doc);
  });
});

describe("stripPrivilegedActorFields — viewer-aware hp cut (TK072, REQ-TOK-070/071/072)", () => {
  it("strips hp for a non-privileged viewer who is not OWNER of the actor", () => {
    const doc = makeActor({ ownership: { default: 0 } });
    const viewer: ContactViewer = { userId: "stranger", role: 1, ownedCharacterIds: [] };
    const result = stripPrivilegedActorFields(doc, viewer);
    const attributes = (result["system"] as Record<string, unknown>)["attributes"] as Record<
      string,
      unknown
    >;
    expect("hp" in attributes).toBe(false);
  });

  it("keeps hp for the viewer who OWNS the actor", () => {
    const doc = makeActor({ ownership: { default: 0, playerId: 3 } });
    const viewer: ContactViewer = { userId: "playerId", role: 1, ownedCharacterIds: ["actor1"] };
    const result = stripPrivilegedActorFields(doc, viewer);
    const attributes = (result["system"] as Record<string, unknown>)["attributes"] as Record<
      string,
      unknown
    >;
    expect(attributes["hp"]).toEqual({ value: 12, max: 20 });
  });

  it("keeps hp for a privileged viewer (GM) regardless of ownership", () => {
    const doc = makeActor({ ownership: { default: 0 } });
    const viewer: ContactViewer = { userId: "gm", role: 4, ownedCharacterIds: [] };
    const result = stripPrivilegedActorFields(doc, viewer);
    const attributes = (result["system"] as Record<string, unknown>)["attributes"] as Record<
      string,
      unknown
    >;
    expect(attributes["hp"]).toBeDefined();
  });

  it("without a viewer, hp is left untouched (attitude/knowledge only — no real caller reaches this)", () => {
    const doc = makeActor({ ownership: { default: 0 } });
    const result = stripPrivilegedActorFields(doc);
    const attributes = (result["system"] as Record<string, unknown>)["attributes"] as Record<
      string,
      unknown
    >;
    expect(attributes["hp"]).toBeDefined();
  });
});

describe("redactActorDocsForViewer — hp cut applies across the batch (TK072, CA-TOK-010)", () => {
  it("a player sees no hp for the NPC's actor nor for another player's character, only their own", () => {
    // "Known" (state 2) so the NPC reaches the same stripPrivilegedActorFields
    // call the character branch reaches — an unknown NPC would be dropped
    // entirely by the knowledge filter (a different rule, spec 39), which
    // would make this assertion pass for the wrong reason.
    const npc = makeActor({
      _id: "npc1",
      type: "npc",
      ownership: { default: 0 },
      flags: { fusion: { knowledge: { general: 2, exceptions: {} } } },
    });
    const otherPc = makeActor({ _id: "pc-other", ownership: { default: 0, otherUser: 3 } });
    const ownPc = makeActor({ _id: "pc-mine", ownership: { default: 0, me: 3 } });

    const viewer: ContactViewer = { userId: "me", role: 1, ownedCharacterIds: ["pc-mine"] };
    const { documents } = redactActorDocsForViewer([npc, otherPc, ownPc], viewer);

    const byId = new Map(documents.map((d) => [d["_id"], d]));
    const hpOf = (d: Record<string, unknown> | undefined): unknown =>
      d &&
      (
        (d["system"] as Record<string, unknown> | undefined)?.["attributes"] as
          | Record<string, unknown>
          | undefined
      )?.["hp"];

    expect(hpOf(byId.get("npc1"))).toBeUndefined();
    expect(hpOf(byId.get("pc-other"))).toBeUndefined();
    expect(hpOf(byId.get("pc-mine"))).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// REQ-DOC-062 / REQ-TOK-072 — stripTokenActorDeltaHp / redactTokenActorDeltaHp:
// an unlinked token's OWN actorDelta.system.attributes.hp is cut BY ROLE
// (fail-closed), never by ownership of the base Actor.
// ---------------------------------------------------------------------------

function makeUnlinkedToken(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: "tok1",
    actorId: "actor1",
    actorLink: false,
    actorDelta: {
      system: { attributes: { hp: { value: 3, max: 6 } }, traits: { size: "sm" } },
    },
    hidden: false,
    seenBy: [],
    ...overrides,
  };
}

describe("stripTokenActorDeltaHp (REQ-DOC-062, REQ-TOK-072)", () => {
  it("removes actorDelta.system.attributes.hp, keeping the rest of the delta intact", () => {
    const token = makeUnlinkedToken();
    const stripped = stripTokenActorDeltaHp(token);
    const delta = stripped["actorDelta"] as Record<string, unknown>;
    const system = delta["system"] as Record<string, unknown>;
    const attributes = system["attributes"] as Record<string, unknown>;
    expect("hp" in attributes).toBe(false);
    expect((system["traits"] as Record<string, unknown>)["size"]).toBe("sm");
  });

  it("returns the original reference when actorDelta is null (linked token)", () => {
    const token = makeUnlinkedToken({ actorLink: true, actorDelta: null });
    expect(stripTokenActorDeltaHp(token)).toBe(token);
  });

  it("returns the original reference when the delta carries no hp", () => {
    const token = makeUnlinkedToken({
      actorDelta: { system: { traits: { size: "sm" } } },
    });
    expect(stripTokenActorDeltaHp(token)).toBe(token);
  });
});

describe("redactTokenActorDeltaHp — scene-level, applies to every token (REQ-DOC-062)", () => {
  it("strips the delta hp from a scene's unlinked token", () => {
    const scene = makeScene([makeUnlinkedToken()]);
    const result = redactTokenActorDeltaHp(scene);
    const tokens = result["tokens"] as Array<Record<string, unknown>>;
    const delta = tokens[0]!["actorDelta"] as Record<string, unknown>;
    const attributes = (delta["system"] as Record<string, unknown>)["attributes"] as Record<
      string,
      unknown
    >;
    expect("hp" in attributes).toBe(false);
  });

  it("returns the original scene reference when no token carries a delta hp", () => {
    const scene = makeScene([{ _id: "tok1", actorLink: true, actorDelta: null }]);
    expect(redactTokenActorDeltaHp(scene)).toBe(scene);
  });
});

describe("redactSceneDocsForNonPrivileged also strips actorDelta hp (REQ-DOC-062)", () => {
  it("a linked player OWNER of the base Actor still loses the delta's hp — cut is by ROLE, not ownership", () => {
    // REQ-TOK-072/REQ-DOC-062: the cut on an unlinked token's OWN delta is
    // read by role, fail-closed — unlike TK072's Actor-level cut, ownership
    // of the base Actor does not restore it. The known cost (documented in
    // specs/02-modelo-de-dados.md DEC's rationale) is that even the OWNER of
    // the base Actor reads the base actor's hp, never the token's own delta.
    const scene = makeScene([makeUnlinkedToken()]);
    const [redacted] = redactSceneDocsForNonPrivileged([scene], "anyUserId");
    const tokens = redacted!["tokens"] as Array<Record<string, unknown>>;
    const delta = tokens[0]!["actorDelta"] as Record<string, unknown>;
    const attributes = (delta["system"] as Record<string, unknown>)["attributes"] as Record<
      string,
      unknown
    >;
    expect("hp" in attributes).toBe(false);
  });

  it("leaves the rest of the token untouched — only hp is cut, not the whole delta", () => {
    const scene = makeScene([makeUnlinkedToken()]);
    const [redacted] = redactSceneDocsForNonPrivileged([scene], "anyUserId");
    const tokens = redacted!["tokens"] as Array<Record<string, unknown>>;
    const delta = tokens[0]!["actorDelta"] as Record<string, unknown>;
    const system = delta["system"] as Record<string, unknown>;
    expect((system["traits"] as Record<string, unknown>)["size"]).toBe("sm");
  });
});
