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
import type { ChatMessage } from "@fusion/shared";
import {
  stripHiddenTokens,
  redactSceneDocsForNonPrivileged,
  stripActorHp,
  stripPrivilegedActorFields,
  redactActorDocsForViewer,
  stripTokenActorDeltaHp,
  redactTokenActorDeltaHp,
  type ContactViewer,
  redactChatEffectExpiryForNonPrivileged,
  redactChatSpeakerForNonPrivileged,
  tokenLookupSourceFromStore,
  lookupSourceForOnePass,
  UNKNOWN_SPEAKER_ALIAS,
  type TokenLookupSource,
} from "../redaction.js";
import { DocumentNotFoundError, type DocumentStore } from "../../documents/store.js";
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

// ---------------------------------------------------------------------------
// I-3 (revisão da onda 2) — effect-expiry chat line of a hidden combatant
// ---------------------------------------------------------------------------

describe("redactChatEffectExpiryForNonPrivileged — turn automation card", () => {
  const automationMsg = (hidden: boolean) =>
    ({
      _id: "m2",
      content: "Dano persistente: Emboscador sofre 5 de fogo.",
      speaker: { userId: "system", alias: "Sistema", actorId: "actor-S" },
      whisper: [],
      flags: { fusion: { turnAutomation: { kind: "persistent", ...(hidden ? { hidden: true } : {}) } } },
    }) as unknown as ChatMessage;

  it("cuts the name and the actor id of a hidden combatant's automation card", () => {
    const out = redactChatEffectExpiryForNonPrivileged(automationMsg(true));
    expect(JSON.stringify(out)).not.toContain("Emboscador");
    expect(JSON.stringify(out)).not.toContain("actor-S");
    expect(JSON.stringify(out)).not.toContain("persistent");
  });

  it("keeps the card of a visible combatant", () => {
    const msg = automationMsg(false);
    expect(redactChatEffectExpiryForNonPrivileged(msg)).toBe(msg);
  });
});

describe("redactChatEffectExpiryForNonPrivileged", () => {
  const expiryMsg = (hidden: boolean) =>
    ({
      _id: "m1",
      content: "Efeito Apoio terminou em Emboscador.",
      speaker: { userId: "system", alias: "Sistema", actorId: "actor-S" },
      whisper: [],
      flags: {
        fusion: {
          effectExpiry: {
            itemId: "eff-S",
            actorId: "actor-S",
            ...(hidden ? { hidden: true } : {}),
          },
        },
      },
    }) as unknown as ChatMessage;

  it("drops the name, the actor id and the item id for a hidden holder", () => {
    const out = redactChatEffectExpiryForNonPrivileged(expiryMsg(true));
    expect(out.content).toBe("Um efeito terminou.");
    expect(JSON.stringify(out)).not.toContain("Emboscador");
    expect(JSON.stringify(out)).not.toContain("actor-S");
    expect(JSON.stringify(out)).not.toContain("eff-S");
  });

  it("returns the same message when the holder is not hidden", () => {
    const msg = expiryMsg(false);
    expect(redactChatEffectExpiryForNonPrivileged(msg)).toBe(msg);
  });
});

// ---------------------------------------------------------------------------
// BAR-F4-01 — redactChatSpeakerForNonPrivileged: the speaker answers to the contact knowledge (spec 39)
// ---------------------------------------------------------------------------

describe("redactChatSpeakerForNonPrivileged (BAR-F4-01)", () => {
  const VIEWER = "viewerUser";
  const MY_PC = "pcOfTheViewer";
  const OTHER_PC = "pcOfSomeoneElse";

  /** The Actor table of the world, reduced to what the cut reads. */
  function sourceOf(actors: Record<string, Record<string, unknown>>): TokenLookupSource {
    return {
      findToken: () => undefined,
      findActor: (id) => actors[id],
      contacts: {
        listCharacterOwnership: () => [
          { id: MY_PC, ownership: { default: 0, [VIEWER]: 3 } },
          { id: OTHER_PC, ownership: { default: 0 } },
        ],
      },
    };
  }

  const contact = (
    name: string,
    flags?: Record<string, unknown>,
    ownership?: Record<string, number>,
  ) => ({
    _id: `id-${name}`,
    name,
    type: "npc",
    ownership: ownership ?? { default: 0 },
    ...(flags !== undefined ? { flags } : {}),
  });
  const known = (general: 0 | 1 | 2, exceptions: Record<string, 0 | 1 | 2> = {}) => ({
    fusion: { knowledge: { general, exceptions } },
  });

  /** A roll message spoken as `actorId`, the way chat:send writes it. */
  const spoken = (actorId: string | undefined, alias: string): ChatMessage =>
    ({
      _id: "m1",
      content: "Garras (MAP 0): 17",
      speaker: {
        userId: "gm",
        alias,
        ...(actorId !== undefined ? { actorId, tokenId: "tok-1" } : {}),
      },
      whisper: [],
      flags: {},
    }) as unknown as ChatMessage;

  it("a hidden contact (no knowledge map at all) speaks without name, actor id and token id", () => {
    const hidden = contact("Goblin Oculto");
    const out = redactChatSpeakerForNonPrivileged(
      spoken(hidden._id, "Goblin Oculto"),
      VIEWER,
      sourceOf({ [hidden._id]: hidden }),
    );
    expect(out.speaker).toEqual({ userId: "gm", alias: UNKNOWN_SPEAKER_ALIAS });
    expect(JSON.stringify(out)).not.toContain("Goblin Oculto");
    expect(JSON.stringify(out)).not.toContain(hidden._id);
    expect(JSON.stringify(out)).not.toContain("tok-1");
    // The roll itself is still the viewer's to read: only WHO is cut.
    expect(out.content).toBe("Garras (MAP 0): 17");
  });

  it("a glimpsed contact is cut the same way (a glimpse carries no name)", () => {
    const glimpsed = contact("Goblin Entrevisto", known(1));
    const out = redactChatSpeakerForNonPrivileged(
      spoken(glimpsed._id, "Goblin Entrevisto"),
      VIEWER,
      sourceOf({ [glimpsed._id]: glimpsed }),
    );
    expect(out.speaker.alias).toBe(UNKNOWN_SPEAKER_ALIAS);
    expect(out.speaker.actorId).toBeUndefined();
  });

  it("a contact the viewer's characters know is left alone: the SAME message comes back", () => {
    const knownContact = contact("Goblin Conhecido", known(2));
    const msg = spoken(knownContact._id, "Goblin Conhecido");
    expect(
      redactChatSpeakerForNonPrivileged(
        msg,
        VIEWER,
        sourceOf({ [knownContact._id]: knownContact }),
      ),
    ).toBe(msg);
  });

  it("the exception of one character wins over the general rule, for the viewer whose character it names", () => {
    const forMe = contact("Goblin do Viewer", known(0, { [MY_PC]: 2 }));
    const forOther = contact("Goblin do Outro", known(0, { [OTHER_PC]: 2 }));
    const source = sourceOf({ [forMe._id]: forMe, [forOther._id]: forOther });
    const mine = spoken(forMe._id, "Goblin do Viewer");
    expect(redactChatSpeakerForNonPrivileged(mine, VIEWER, source)).toBe(mine);
    const theirs = redactChatSpeakerForNonPrivileged(
      spoken(forOther._id, "Goblin do Outro"),
      VIEWER,
      source,
    );
    expect(theirs.speaker.alias).toBe(UNKNOWN_SPEAKER_ALIAS);
  });

  it("nobody is a stranger to what they own: the owner of a hidden contact reads its name", () => {
    const hireling = contact("Mercenário", undefined, { default: 0, [VIEWER]: 3 });
    const msg = spoken(hireling._id, "Mercenário");
    expect(
      redactChatSpeakerForNonPrivileged(msg, VIEWER, sourceOf({ [hireling._id]: hireling })),
    ).toBe(msg);
  });

  it("what is not a contact answers to ownership, not to knowledge: a character, a familiar and a chest are left alone", () => {
    for (const type of ["character", "familiar", "loot"]) {
      const actor = { _id: `id-${type}`, name: `Um ${type}`, type, ownership: { default: 0 } };
      const msg = spoken(actor._id, actor.name);
      expect(
        redactChatSpeakerForNonPrivileged(msg, VIEWER, sourceOf({ [actor._id]: actor })),
        type,
      ).toBe(msg);
    }
  });

  it("a hazard is a contact too", () => {
    const trap = {
      _id: "id-trap",
      name: "Armadilha Secreta",
      type: "hazard",
      ownership: { default: 0 },
    };
    const out = redactChatSpeakerForNonPrivileged(
      spoken(trap._id, trap.name),
      VIEWER,
      sourceOf({ [trap._id]: trap }),
    );
    expect(out.speaker.alias).toBe(UNKNOWN_SPEAKER_ALIAS);
  });

  it("with no actor named, or no source that resolves actors, the speaker is left as sent", () => {
    const noActor = spoken(undefined, "Player1");
    expect(redactChatSpeakerForNonPrivileged(noActor, VIEWER, sourceOf({}))).toBe(noActor);

    const hidden = contact("Goblin Oculto");
    const msg = spoken(hidden._id, "Goblin Oculto");
    expect(redactChatSpeakerForNonPrivileged(msg, VIEWER, undefined)).toBe(msg);
    expect(redactChatSpeakerForNonPrivileged(msg, VIEWER, { findToken: () => undefined })).toBe(
      msg,
    );
  });

  it("an actor that is gone (deleted since) or cannot be read is a stranger: the speaker is cut (fail closed)", () => {
    // The alias was written from the name of an actor nobody can say the viewer knows any more.
    const gone = spoken("id-deleted", "Goblin Apagado");
    const out = redactChatSpeakerForNonPrivileged(gone, VIEWER, sourceOf({}));
    expect(out.speaker).toEqual({ userId: "gm", alias: UNKNOWN_SPEAKER_ALIAS });
    expect(JSON.stringify(out)).not.toContain("Goblin Apagado");
    expect(JSON.stringify(out)).not.toContain("id-deleted");
    expect(JSON.stringify(out)).not.toContain("tok-1");
    expect(out.content).toBe("Garras (MAP 0): 17");
  });

  it("a viewer with no identity is a stranger to every contact (fail closed, like every cut of this module)", () => {
    const knownToOneCharacter = contact("Goblin Conhecido de um", known(0, { [MY_PC]: 2 }));
    const out = redactChatSpeakerForNonPrivileged(
      spoken(knownToOneCharacter._id, "Goblin Conhecido de um"),
      undefined,
      sourceOf({ [knownToOneCharacter._id]: knownToOneCharacter }),
    );
    expect(out.speaker.alias).toBe(UNKNOWN_SPEAKER_ALIAS);
  });

  it("the cut answers with the present: the same stored message reads differently once the contact is revealed", () => {
    const actor = contact("Goblin Oculto");
    const stored = spoken(actor._id, "Goblin Oculto");
    expect(
      redactChatSpeakerForNonPrivileged(stored, VIEWER, sourceOf({ [actor._id]: actor })).speaker
        .alias,
    ).toBe(UNKNOWN_SPEAKER_ALIAS);
    const revealed = { ...actor, flags: known(2) };
    expect(
      redactChatSpeakerForNonPrivileged(stored, VIEWER, sourceOf({ [actor._id]: revealed })).speaker
        .alias,
    ).toBe("Goblin Oculto");
  });
});

describe("redactChatSpeakerForNonPrivileged — the server's own messages (BAR-F4-01)", () => {
  const VIEWER = "viewerUser";
  const hidden = {
    _id: "id-hidden",
    name: "Goblin Oculto",
    type: "npc",
    ownership: { default: 0 },
  };
  const source: TokenLookupSource = {
    findToken: () => undefined,
    findActor: (id) => (id === hidden._id ? hidden : undefined),
    contacts: { listCharacterOwnership: () => [] },
  };

  it("a system line ABOUT an unknown contact keeps its own alias and only loses the ids", () => {
    // combat, effects and damage lines are written under "Sistema" with the actor they are about in `speaker.actorId`.
    const line = {
      _id: "m-sys",
      content: "Alvo sofreu 5 de dano.",
      speaker: { userId: "system", alias: "Sistema", actorId: hidden._id, tokenId: "tok-1" },
      whisper: [],
      flags: {},
    } as unknown as ChatMessage;
    const out = redactChatSpeakerForNonPrivileged(line, VIEWER, source);
    expect(out.speaker).toEqual({ userId: "system", alias: "Sistema" });
    expect(out.content).toBe("Alvo sofreu 5 de dano.");
  });

  it("a system line about an actor that is gone keeps its alias too, and loses the ids", () => {
    const line = {
      _id: "m-sys-gone",
      content: "Alvo sofreu 5 de dano.",
      speaker: { userId: "system", alias: "Sistema", actorId: "id-deleted", tokenId: "tok-1" },
      whisper: [],
      flags: {},
    } as unknown as ChatMessage;
    expect(redactChatSpeakerForNonPrivileged(line, VIEWER, source).speaker).toEqual({
      userId: "system",
      alias: "Sistema",
    });
  });
});

/**
 * A store over one contact whose knowledge the test rewrites, counting what the speaker cut reads. Every read hands
 * out a FRESH copy, like the real store (it parses the row each time): a test that mutated a shared object would
 * see the write even through a stale memo, and prove nothing.
 */
function worldStore() {
  const reads = { actors: 0, characters: 0 };
  const contact: Record<string, unknown> = {
    _id: "id-npc",
    name: "Goblin Conhecido",
    type: "npc",
    ownership: { default: 0 },
    flags: { fusion: { knowledge: { general: 2, exceptions: {} } } },
  };
  const setGeneral = (general: 0 | 1 | 2): void => {
    contact["flags"] = { fusion: { knowledge: { general, exceptions: {} } } };
  };
  const store = {
    get: (table: string, id: string) => {
      if (table !== "actors") throw new Error(`unexpected table ${table}`);
      reads.actors += 1;
      if (id === "id-npc") return structuredClone(contact);
      // A row that does not parse (what `JSON.parse` throws inside `store.get`).
      if (id === "id-corrupt") throw new SyntaxError("Unexpected end of JSON input");
      throw new DocumentNotFoundError("actors", id);
    },
    getAll: (table: string, query?: { type?: string }) => {
      if (table === "actors" && query?.type === "character") {
        reads.characters += 1;
        return [{ _id: "pc-1", type: "character", ownership: { default: 0, viewer: 3 } }];
      }
      return [];
    },
  } as unknown as DocumentStore;
  return { reads, setGeneral, store };
}

const spokenBy = (actorId = "id-npc", alias = "Goblin Conhecido"): ChatMessage =>
  ({
    _id: "m1",
    content: "x",
    speaker: { userId: "gm", alias, actorId },
    whisper: [],
    flags: {},
  }) as unknown as ChatMessage;

describe("tokenLookupSourceFromStore — the world's source reads the present on every call (BAR-F4-01)", () => {
  it("a write made in the SAME synchronous task is seen by the next message: nothing is remembered between reads", () => {
    // What a socket does when one chunk carries several frames: chat:send as the NPC, actor:setKnowledge
    // general=0 and chat:send again, all in one task, with no microtask in between. The source a handler built
    // when the world was registered must not answer the third op with what it read for the first.
    const { setGeneral, store } = worldStore();
    const source = tokenLookupSourceFromStore(store);
    const first = spokenBy();
    expect(redactChatSpeakerForNonPrivileged(first, "viewer", source)).toBe(first);

    setGeneral(0);
    const third = redactChatSpeakerForNonPrivileged(spokenBy(), "viewer", source);
    expect(third.speaker.alias).toBe(UNKNOWN_SPEAKER_ALIAS);
    expect(JSON.stringify(third)).not.toContain("Goblin Conhecido");
    expect(JSON.stringify(third)).not.toContain("id-npc");
  });

  it("an actor that is gone or does not parse reads as undefined, never as a throw, and its speaker is cut", () => {
    const { store } = worldStore();
    const source = tokenLookupSourceFromStore(store);
    expect(source.findActor?.("id-gone")).toBeUndefined();
    expect(source.findActor?.("id-corrupt")).toBeUndefined();
    const out = redactChatSpeakerForNonPrivileged(
      spokenBy("id-corrupt", "Goblin Corrompido"),
      "viewer",
      source,
    );
    expect(out.speaker).toEqual({ userId: "gm", alias: UNKNOWN_SPEAKER_ALIAS });
  });
});

describe("lookupSourceForOnePass — one pass (a broadcast, a page) reads each speaker and the characters once (BAR-F4-01)", () => {
  it("a page of messages from the same speaker reads the actor and the characters ONCE", () => {
    const { reads, setGeneral, store } = worldStore();
    setGeneral(0);
    const page = lookupSourceForOnePass(tokenLookupSourceFromStore(store));
    for (let i = 0; i < 25; i++) {
      expect(redactChatSpeakerForNonPrivileged(spokenBy(), "viewer", page).speaker.alias).toBe(
        UNKNOWN_SPEAKER_ALIAS,
      );
    }
    expect(reads).toEqual({ actors: 1, characters: 1 });
  });

  it("each pass reads again: what the Mestre changed between two passes is what the second one shows", () => {
    const { reads, setGeneral, store } = worldStore();
    const world = tokenLookupSourceFromStore(store);
    const first = spokenBy();
    expect(redactChatSpeakerForNonPrivileged(first, "viewer", lookupSourceForOnePass(world))).toBe(
      first,
    );
    setGeneral(0);
    expect(
      redactChatSpeakerForNonPrivileged(spokenBy(), "viewer", lookupSourceForOnePass(world)).speaker
        .alias,
    ).toBe(UNKNOWN_SPEAKER_ALIAS);
    expect(reads).toEqual({ actors: 2, characters: 2 });
  });

  it("an actor that is gone is remembered as absent for the pass, and never throws", () => {
    const { reads, store } = worldStore();
    const page = lookupSourceForOnePass(tokenLookupSourceFromStore(store));
    expect(page.findActor?.("id-gone")).toBeUndefined();
    expect(page.findActor?.("id-gone")).toBeUndefined();
    expect(reads.actors).toBe(1);
  });

  it("a source with nothing to remember stays that way: no actor resolver is invented", () => {
    const bare: TokenLookupSource = { findToken: () => undefined };
    const page = lookupSourceForOnePass(bare);
    expect(page.findActor).toBeUndefined();
    expect(page.contacts).toBeUndefined();
    const msg = spokenBy();
    expect(redactChatSpeakerForNonPrivileged(msg, "viewer", page)).toBe(msg);
  });
});
