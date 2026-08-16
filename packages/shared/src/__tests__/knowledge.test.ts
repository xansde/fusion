/**
 * Contact knowledge model — pure helpers (spec 39 §5.8).
 *
 * Covers REQ-CTT-070, REQ-CTT-071, REQ-CTT-072, REQ-CTT-073, REQ-CTT-074 and
 * REQ-CTT-076 at the level where the rules actually live: a general rule plus
 * a per-character exception map stored on the contact's own Actor document.
 */

import { describe, it, expect } from "vitest";
import {
  KnowledgeState,
  KNOWLEDGE_STATES,
  KNOWLEDGE_FLAG_PATH,
  DEFAULT_KNOWLEDGE_STATE,
  emptyKnowledgeMap,
  readKnowledgeMap,
  knowledgeFlagPatch,
  touchesKnowledgeFlag,
  normalizeKnowledge,
  resolveKnowledge,
  resolveUserKnowledge,
  withGeneralKnowledge,
  withKnowledgeException,
  dropCharacterFromKnowledge,
  clearKnowledgeExceptions,
  cycleKnowledgeState,
  knowledgeMapsEqual,
  applyKnowledgeEdit,
  ActorSetKnowledgePayloadSchema,
  isKnowledgeState,
} from "../knowledge.js";

const ALICE = "aaaaaaaaaaaaaaaa";
const BOB = "bbbbbbbbbbbbbbbb";
const CAROL = "cccccccccccccccc";

function contactDoc(knowledge?: unknown): Record<string, unknown> {
  return {
    _id: "dddddddddddddddd",
    name: "A Innkeeper",
    type: "npc",
    flags: knowledge === undefined ? {} : { fusion: { knowledge } },
  };
}

describe("REQ-CTT-070 — three ordered states, stored on the contact's own document", () => {
  it("REQ-CTT-070: names hidden 0, glimpsed 1 and known 2, in ascending order", () => {
    expect(KnowledgeState.Hidden).toBe(0);
    expect(KnowledgeState.Glimpsed).toBe(1);
    expect(KnowledgeState.Known).toBe(2);
    expect(KNOWLEDGE_STATES).toEqual([0, 1, 2]);
    expect(DEFAULT_KNOWLEDGE_STATE).toBe(KnowledgeState.Hidden);
  });

  it("REQ-CTT-070: a fourth state is not a state", () => {
    expect(isKnowledgeState(3)).toBe(false);
    expect(isKnowledgeState(-1)).toBe(false);
    expect(isKnowledgeState("2")).toBe(false);
  });

  it("REQ-CTT-070: the map lives at flags.fusion.knowledge on the contact — no table of its own", () => {
    expect(KNOWLEDGE_FLAG_PATH).toBe("flags.fusion.knowledge");
    const patch = knowledgeFlagPatch({ general: KnowledgeState.Glimpsed, exceptions: {} });
    expect(patch).toEqual({
      flags: { fusion: { knowledge: { general: 1, exceptions: {} } } },
    });
    expect(touchesKnowledgeFlag(patch)).toBe(true);
    expect(touchesKnowledgeFlag({ flags: { fusion: { other: 1 } } })).toBe(false);
    expect(touchesKnowledgeFlag({ name: "x" })).toBe(false);
  });

  it("REQ-CTT-070: a document with no flag, or a corrupted one, reads as hidden for everyone", () => {
    expect(readKnowledgeMap(contactDoc())).toEqual(emptyKnowledgeMap());
    expect(readKnowledgeMap(contactDoc("nonsense"))).toEqual(emptyKnowledgeMap());
    expect(readKnowledgeMap(undefined)).toEqual(emptyKnowledgeMap());
    // A forged fourth state is dropped rather than believed.
    expect(readKnowledgeMap(contactDoc({ general: 7, exceptions: { [ALICE]: 9 } }))).toEqual({
      general: 0,
      exceptions: {},
    });
  });
});

describe("REQ-CTT-072 — general rule, exceptions, and the exception that is not one", () => {
  it("REQ-CTT-072: the exception prevails over the general rule", () => {
    const doc = contactDoc({ general: KnowledgeState.Hidden, exceptions: { [ALICE]: 2 } });
    expect(resolveKnowledge(doc, ALICE)).toBe(KnowledgeState.Known);
    expect(resolveKnowledge(doc, BOB)).toBe(KnowledgeState.Hidden);
  });

  it("REQ-CTT-072: writing an exception EQUAL to the general rule removes it instead of duplicating it", () => {
    const map = { general: KnowledgeState.Glimpsed, exceptions: { [BOB]: KnowledgeState.Known } };
    const after = withKnowledgeException(map, ALICE, KnowledgeState.Glimpsed);
    expect(after.exceptions).toEqual({ [BOB]: KnowledgeState.Known });
    expect(ALICE in after.exceptions).toBe(false);
    // ...and the effective state is unchanged, which is the point.
    expect(resolveKnowledge(after, ALICE)).toBe(KnowledgeState.Glimpsed);
  });

  it("REQ-CTT-072: an exception that the general rule catches up with is dropped, not left stale", () => {
    const map = { general: KnowledgeState.Hidden, exceptions: { [ALICE]: KnowledgeState.Known } };
    const after = withGeneralKnowledge(map, KnowledgeState.Known);
    expect(after).toEqual({ general: KnowledgeState.Known, exceptions: {} });
  });

  it("REQ-CTT-072: normalization is idempotent and drops non-states", () => {
    const raw = {
      general: KnowledgeState.Glimpsed,
      exceptions: { [ALICE]: 1, [BOB]: 2, [CAROL]: 9 },
    } as unknown as Parameters<typeof normalizeKnowledge>[0];
    const once = normalizeKnowledge(raw);
    expect(once).toEqual({ general: 1, exceptions: { [BOB]: 2 } });
    expect(normalizeKnowledge(once)).toEqual(once);
  });

  it("REQ-CTT-072: clearing exceptions aligns the whole row on the general rule", () => {
    const map = {
      general: KnowledgeState.Glimpsed,
      exceptions: { [ALICE]: KnowledgeState.Known, [BOB]: KnowledgeState.Hidden },
    };
    expect(clearKnowledgeExceptions(map)).toEqual({ general: 1, exceptions: {} });
  });

  it("REQ-CTT-072: the cycle is hidden → glimpsed → known → hidden", () => {
    expect(cycleKnowledgeState(KnowledgeState.Hidden)).toBe(KnowledgeState.Glimpsed);
    expect(cycleKnowledgeState(KnowledgeState.Glimpsed)).toBe(KnowledgeState.Known);
    expect(cycleKnowledgeState(KnowledgeState.Known)).toBe(KnowledgeState.Hidden);
  });
});

describe("REQ-CTT-071 — the user's state is the highest among their characters", () => {
  it("REQ-CTT-071: a user with one glimpsed and one known character is at known", () => {
    const doc = contactDoc({
      general: KnowledgeState.Hidden,
      exceptions: { [ALICE]: 1, [BOB]: 2 },
    });
    expect(resolveUserKnowledge(doc, [ALICE, BOB])).toBe(KnowledgeState.Known);
    expect(resolveUserKnowledge(doc, [ALICE])).toBe(KnowledgeState.Glimpsed);
    expect(resolveUserKnowledge(doc, [CAROL])).toBe(KnowledgeState.Hidden);
  });

  it("REQ-CTT-071: a user with no character sits at the general rule", () => {
    const doc = contactDoc({ general: KnowledgeState.Glimpsed, exceptions: {} });
    expect(resolveUserKnowledge(doc, [])).toBe(KnowledgeState.Glimpsed);
  });
});

describe("REQ-CTT-073 — a character created later inherits the general rule", () => {
  it("REQ-CTT-073: a character no rule ever mentioned resolves to the general rule in force", () => {
    const doc = contactDoc({ general: KnowledgeState.Known, exceptions: { [ALICE]: 0 } });
    // CAROL was created after the map was written: no operation from the GM,
    // no entry in the map, and yet the general rule already applies to her.
    expect(resolveKnowledge(doc, CAROL)).toBe(KnowledgeState.Known);
    expect(readKnowledgeMap(doc).exceptions[CAROL]).toBeUndefined();
  });

  it("REQ-CTT-073: moving the general rule moves every character that has no exception", () => {
    const before = readKnowledgeMap(
      contactDoc({ general: KnowledgeState.Hidden, exceptions: { [ALICE]: 2 } }),
    );
    const after = withGeneralKnowledge(before, KnowledgeState.Glimpsed);
    expect(resolveKnowledge(after, BOB)).toBe(KnowledgeState.Glimpsed);
    expect(resolveKnowledge(after, CAROL)).toBe(KnowledgeState.Glimpsed);
    expect(resolveKnowledge(after, ALICE)).toBe(KnowledgeState.Known);
  });
});

describe("REQ-CTT-076 — deleting a character removes the exceptions that cite it", () => {
  it("REQ-CTT-076: the named exception goes and the general rule stays untouched", () => {
    const map = {
      general: KnowledgeState.Glimpsed,
      exceptions: { [ALICE]: KnowledgeState.Known, [BOB]: KnowledgeState.Hidden },
    };
    const after = dropCharacterFromKnowledge(map, ALICE);
    expect(after).toEqual({
      general: KnowledgeState.Glimpsed,
      exceptions: { [BOB]: KnowledgeState.Hidden },
    });
  });

  it("REQ-CTT-076: dropping a character nobody excepted changes nothing", () => {
    const map = { general: KnowledgeState.Hidden, exceptions: { [ALICE]: KnowledgeState.Known } };
    expect(knowledgeMapsEqual(dropCharacterFromKnowledge(map, CAROL), map)).toBe(true);
  });
});

describe("REQ-CTT-074 — knowledge only restricts; it is not ownership", () => {
  it("REQ-CTT-074: no helper reads, produces or widens an ownership level", () => {
    const doc = {
      ...contactDoc({ general: KnowledgeState.Known, exceptions: {} }),
      ownership: { default: 0, [ALICE]: 3 },
    };
    // The map is the same whichever ownership the document carries, and the
    // resolved state names no ownership level.
    expect(resolveKnowledge(doc, ALICE)).toBe(KnowledgeState.Known);
    expect(resolveKnowledge({ ...doc, ownership: { default: 3 } }, ALICE)).toBe(
      KnowledgeState.Known,
    );
    expect(Object.keys(readKnowledgeMap(doc))).toEqual(["general", "exceptions"]);
  });
});

describe("actor:setKnowledge payload and edit application (REQ-CTT-072, REQ-CTT-076)", () => {
  it("REQ-CTT-072: rejects a state outside the three, and an empty batch", () => {
    expect(
      ActorSetKnowledgePayloadSchema.safeParse({
        updates: [{ actorId: "x", general: 3 }],
      }).success,
    ).toBe(false);
    expect(ActorSetKnowledgePayloadSchema.safeParse({ updates: [] }).success).toBe(false);
    expect(
      ActorSetKnowledgePayloadSchema.safeParse({
        updates: [{ actorId: "x", exceptions: { [ALICE]: null } }],
      }).success,
    ).toBe(true);
  });

  it("REQ-CTT-072: an edit can raise the general rule and still pin one character below it", () => {
    const map = emptyKnowledgeMap();
    const after = applyKnowledgeEdit(map, {
      actorId: "x",
      general: KnowledgeState.Known,
      exceptions: { [ALICE]: KnowledgeState.Glimpsed, [BOB]: KnowledgeState.Known },
    });
    // BOB's write equalled the new general rule → removed, not duplicated.
    expect(after).toEqual({
      general: KnowledgeState.Known,
      exceptions: { [ALICE]: KnowledgeState.Glimpsed },
    });
  });

  it("REQ-CTT-076: an explicit null removes one exception without touching the rest", () => {
    const map = {
      general: KnowledgeState.Hidden,
      exceptions: { [ALICE]: KnowledgeState.Known, [BOB]: KnowledgeState.Glimpsed },
    };
    const after = applyKnowledgeEdit(map, { actorId: "x", exceptions: { [ALICE]: null } });
    expect(after).toEqual({
      general: KnowledgeState.Hidden,
      exceptions: { [BOB]: KnowledgeState.Glimpsed },
    });
  });

  it("REQ-CTT-063: clearExceptions aligns the row before the explicit exceptions land", () => {
    const map = {
      general: KnowledgeState.Hidden,
      exceptions: { [ALICE]: KnowledgeState.Known, [BOB]: KnowledgeState.Known },
    };
    const after = applyKnowledgeEdit(map, {
      actorId: "x",
      general: KnowledgeState.Glimpsed,
      clearExceptions: true,
      exceptions: { [CAROL]: KnowledgeState.Known },
    });
    expect(after).toEqual({
      general: KnowledgeState.Glimpsed,
      exceptions: { [CAROL]: KnowledgeState.Known },
    });
  });
});
