/**
 * chatReveal.test.ts — display decision + op building for "Revelar" (etapa 2).
 *
 * REQ-CHT-045: only a privileged role may reveal an already-sent private message.
 * REQ-CHT-047: a revealed message must be visually flagged as revealed by the GM.
 * REQ-CHT-048: revealing a public message is a no-op — so the button must not
 *   even be offered for one; the client must not invite a call the server will
 *   answer with "nothing to do".
 * DEC-CHT-10: "private" is derived ONLY from `whisper`/`blind`. `revealedAt` /
 *   `revealedBy` are display metadata and never take part in that decision —
 *   these tests pin that separation down on the client too.
 *
 * The matrix (GM × player) × (private × public × already revealed) lives here
 * instead of inside ChatMessage.svelte because the client's vitest project runs
 * in a plain `node` environment: there is no jsdom, so `.svelte` components are
 * never mounted in tests. Anything worth asserting has to be a pure function.
 */

import { describe, it, expect } from "vitest";
import type { ChatMessage, RollResultData } from "@fusion/shared";
import {
  canRevealMessage,
  canViewerReveal,
  isRevealedMessage,
  buildRevealOp,
} from "../chatReveal.js";
import { LOCAL_ID_PREFIX } from "../chatOptimistic.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    _id: "msg-1",
    _stats: {
      createdTime: 1000,
      modifiedTime: 1000,
      version: 1,
      lastModifiedBy: "user1",
      createdBy: "user1",
      coreVersion: "0.1.0",
      systemId: null,
      systemVersion: null,
      engineSchemaVersion: 1,
      systemSchemaVersion: null,
    },
    sort: 0,
    ownership: { default: 0 },
    flags: {},
    type: "text",
    worldId: "world1",
    content: "hello",
    speaker: { userId: "user1", alias: "Alice" },
    timestamp: 1000,
    whisper: [],
    blind: false,
    ...overrides,
  };
}

const roll = {
  formula: "1d20",
  total: 17,
  terms: [],
  rollMode: "gmroll",
} as unknown as RollResultData;

/** `/gmroll` as the server persists it: GMs listed in whisper[], not blind. */
const gmroll = makeMessage({ type: "roll", rolls: [roll], whisper: ["gm-1"] });
/** `/blindroll`: whispered to the GMs AND blind. */
const blindroll = makeMessage({ type: "roll", rolls: [roll], whisper: ["gm-1"], blind: true });
/** A plain `/w` whisper — private for the same reason a gmroll is. */
const whisperText = makeMessage({ type: "whisper", whisper: ["user2"] });
/** A public roll — nothing to reveal. */
const publicRoll = makeMessage({ type: "roll", rolls: [roll] });
/** The same gmroll AFTER the server revealed it (DEC-CHT-10 mutation). */
const revealed = makeMessage({
  type: "roll",
  rolls: [roll],
  whisper: [],
  blind: false,
  revealedAt: 5000,
  revealedBy: "gm-1",
});

// ---------------------------------------------------------------------------
// canRevealMessage — the (GM × player) × (private × public × revealed) matrix
// ---------------------------------------------------------------------------

describe("canRevealMessage — REQ-CHT-045 / REQ-CHT-048", () => {
  const privateCases: Array<[string, ChatMessage]> = [
    ["gmroll", gmroll],
    ["blindroll", blindroll],
    ["whisper", whisperText],
  ];

  for (const [label, message] of privateCases) {
    it(`offers the button to a GM on a ${label}`, () => {
      expect(canRevealMessage({ privileged: true, message })).toBe(true);
    });

    it(`hides the button from a player on a ${label}`, () => {
      expect(canRevealMessage({ privileged: false, message })).toBe(false);
    });
  }

  it("hides the button on a public message even for a GM (revealing it is a no-op)", () => {
    expect(canRevealMessage({ privileged: true, message: publicRoll })).toBe(false);
  });

  it("hides the button on a public message for a player", () => {
    expect(canRevealMessage({ privileged: false, message: publicRoll })).toBe(false);
  });

  it("hides the button on an already-revealed message even for a GM", () => {
    expect(canRevealMessage({ privileged: true, message: revealed })).toBe(false);
  });

  it("hides the button on an already-revealed message for a player", () => {
    expect(canRevealMessage({ privileged: false, message: revealed })).toBe(false);
  });

  it("never offers the button on an optimistic local echo (the server has no such id)", () => {
    const provisional = makeMessage({
      _id: `${LOCAL_ID_PREFIX}abc`,
      whisper: ["user2"],
    });
    expect(canRevealMessage({ privileged: true, message: provisional })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canViewerReveal — the role gate must match the server's, not the `isGm` prop
// ---------------------------------------------------------------------------

describe("canViewerReveal — REQ-CHT-045", () => {
  // Roles: 1 PLAYER, 2 TRUSTED, 3 ASSISTANT, 4 GAMEMASTER (spec 05 REQ-USR-005).
  // The Assistant GM case is the one that matters: the server's
  // `isRolePrivileged` accepts it, so a client gate of `role === 4` would leave
  // an Assistant with the permission and no button to use it.
  it.each([
    [0, false],
    [1, false],
    [2, false],
    [3, true],
    [4, true],
  ])("role %i → %s", (role, expected) => {
    expect(canViewerReveal(role)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// isRevealedMessage — the badge (REQ-CHT-047)
// ---------------------------------------------------------------------------

describe("isRevealedMessage — REQ-CHT-047", () => {
  it("flags a message carrying the audit stamp", () => {
    expect(isRevealedMessage(revealed)).toBe(true);
  });

  it("does not flag a plain public message", () => {
    expect(isRevealedMessage(publicRoll)).toBe(false);
  });

  it("does not flag a legacy message persisted before the field existed", () => {
    // Absent (not null) is the ONE spelling of "never revealed" — a client
    // testing `!== null` would badge the whole legacy history as revealed.
    const legacy = makeMessage();
    expect("revealedAt" in legacy).toBe(false);
    expect(isRevealedMessage(legacy)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildRevealOp — wire shape (REQ-CHT-045)
// ---------------------------------------------------------------------------

describe("buildRevealOp — REQ-CHT-045", () => {
  it("builds the chat:reveal envelope with only worldId and messageId", () => {
    expect(buildRevealOp("world1", "msg-1")).toEqual({
      type: "chat:reveal",
      payload: { worldId: "world1", messageId: "msg-1" },
    });
  });

  it("sends nothing about the roll itself — the server owns the mutation", () => {
    // REQ-CHT-049: the client must not be able to influence the revealed
    // payload; it only says WHICH message.
    const op = buildRevealOp("world1", "msg-1");
    expect(Object.keys(op.payload).sort()).toEqual(["messageId", "worldId"]);
  });
});
