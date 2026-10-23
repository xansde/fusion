/**
 * resolveRollMode.test.ts — one place decides the audience of a roll (spec 38 §5.5).
 *
 * The precedence under test is DEC-ACH-04: a command that NAMES the mode wins over a
 * locked favorite, which wins over the selector. And the selector never touches the
 * visibility of plain text.
 *
 * These are behaviour tests over the OUTGOING PAYLOAD — the object the client hands the
 * server — because that is what actually decides the audience. The server resolves
 * `payload.rollMode ?? command.mode` (`packages/server/src/chat/chat-handler.ts`), so a
 * client that echoed the selector into `rollMode` on `/gmroll` would silently overrule the
 * command. Asserting the payload is missing `rollMode` in that case is the real guarantee.
 *
 * Covers REQ-ACH-042, REQ-ACH-043, REQ-ACH-044, REQ-ACH-045 and REQ-CHT-017.
 */

import { describe, expect, it } from "vitest";

import { buildChatSendPayload, commandRollMode, resolveRollMode } from "../resolveRollMode.js";

const WORLD_ID = "world-under-test";

describe("commandRollMode — which commands NAME a mode (REQ-ACH-043)", () => {
  it("names the mode for /gmroll, /blindroll and /selfroll and their short aliases", () => {
    expect(commandRollMode("/gmroll 1d20")).toBe("gmroll");
    expect(commandRollMode("/gmr 1d20")).toBe("gmroll");
    expect(commandRollMode("/blindroll 1d20")).toBe("blindroll");
    expect(commandRollMode("/br 1d20")).toBe("blindroll");
    expect(commandRollMode("/selfroll 1d20")).toBe("selfroll");
    expect(commandRollMode("/sr 1d20")).toBe("selfroll");
  });

  it("does NOT treat /roll as naming a mode — REQ-CHT-017 dropped the 'always public' rule", () => {
    expect(commandRollMode("/roll 1d20")).toBeNull();
    expect(commandRollMode("/r 1d20")).toBeNull();
  });

  it("treats the explicit public alias /publicroll as naming public", () => {
    expect(commandRollMode("/publicroll 1d20")).toBe("public");
    expect(commandRollMode("/pr 1d20")).toBe("public");
  });

  it("ignores case and leading whitespace, and returns null for text and other commands", () => {
    expect(commandRollMode("  /GMRoll 1d20")).toBe("gmroll");
    expect(commandRollMode("bom dia")).toBeNull();
    expect(commandRollMode("/w [Tobias] segredo")).toBeNull();
    expect(commandRollMode("/em acena")).toBeNull();
  });
});

describe("resolveRollMode — precedência comando > favorito > seletor (REQ-ACH-042..044)", () => {
  it("REQ-ACH-042 / REQ-CHT-017: /roll obeys the selector, blind included", () => {
    const decision = resolveRollMode({ content: "/roll 1d20", selectorMode: "blindroll" });
    expect(decision.mode).toBe("blindroll");
    expect(decision.source).toBe("selector");
    expect(decision.payloadRollMode).toBe("blindroll");
  });

  it("REQ-ACH-043: /gmroll wins over the selector and leaves rollMode out of the payload", () => {
    const decision = resolveRollMode({ content: "/gmroll 1d20", selectorMode: "blindroll" });
    expect(decision.mode).toBe("gmroll");
    expect(decision.source).toBe("command");
    expect(decision.payloadRollMode).toBeUndefined();
  });

  it("REQ-ACH-044: a locked favorite beats the selector but never the command", () => {
    const fromFavorite = resolveRollMode({
      content: "/roll 2d6+3",
      selectorMode: "public",
      favoriteMode: "selfroll",
    });
    expect(fromFavorite.mode).toBe("selfroll");
    expect(fromFavorite.source).toBe("favorite");
    expect(fromFavorite.payloadRollMode).toBe("selfroll");

    const commandWins = resolveRollMode({
      content: "/gmroll 2d6+3",
      selectorMode: "public",
      favoriteMode: "selfroll",
    });
    expect(commandWins.mode).toBe("gmroll");
    expect(commandWins.source).toBe("command");
  });

  it("REQ-ACH-044: a favorite that 'follows the selector' (null mode) falls through", () => {
    const decision = resolveRollMode({
      content: "/roll 2d6+3",
      selectorMode: "gmroll",
      favoriteMode: null,
    });
    expect(decision.mode).toBe("gmroll");
    expect(decision.source).toBe("selector");
  });

  it("REQ-ACH-045: plain text stays public no matter what the selector says", () => {
    const decision = resolveRollMode({ content: "bom dia, mesa", selectorMode: "blindroll" });
    expect(decision.mode).toBe("public");
    expect(decision.source).toBe("text");
    expect(decision.payloadRollMode).toBeUndefined();
  });

  it("REQ-ACH-045: /w is how text becomes private — the selector does not do it", () => {
    const decision = resolveRollMode({
      content: "/w [Tobias] chega mais perto",
      selectorMode: "selfroll",
    });
    expect(decision.mode).toBe("public");
    expect(decision.source).toBe("text");
    expect(decision.payloadRollMode).toBeUndefined();
  });

  it("REQ-ACH-045: emote and /ooc are text too — the selector never reaches them", () => {
    for (const content of ["/em acena", "/ooc pausa pra café", "/ic Eu avanço"]) {
      const decision = resolveRollMode({ content, selectorMode: "gmroll" });
      expect(decision.source).toBe("text");
      expect(decision.payloadRollMode).toBeUndefined();
    }
  });
});

describe("buildChatSendPayload — o que o servidor recebe (REQ-ACH-043, REQ-CHT-017)", () => {
  it("selector em 'cega': /roll 1d20 sai cego", () => {
    const payload = buildChatSendPayload({
      content: "/roll 1d20",
      worldId: WORLD_ID,
      selectorMode: "blindroll",
    });
    expect(payload).toEqual({ content: "/roll 1d20", worldId: WORLD_ID, rollMode: "blindroll" });
  });

  it("selector em 'cega': /gmroll 1d20 sai ao Mestre — sem rollMode no payload", () => {
    const payload = buildChatSendPayload({
      content: "/gmroll 1d20",
      worldId: WORLD_ID,
      selectorMode: "blindroll",
    });
    // The server does `payload.rollMode ?? command.mode`: an absent key is what lets the
    // command win. Presence of the key with ANY value would overrule /gmroll.
    expect(Object.prototype.hasOwnProperty.call(payload, "rollMode")).toBe(false);
    expect(payload.content).toBe("/gmroll 1d20");
  });

  it("texto puro não carrega rollMode (REQ-ACH-045)", () => {
    const payload = buildChatSendPayload({
      content: "bom dia",
      worldId: WORLD_ID,
      selectorMode: "selfroll",
    });
    expect(Object.prototype.hasOwnProperty.call(payload, "rollMode")).toBe(false);
  });

  it("carrega o modo do favorito travado quando o comando não nomeia (REQ-ACH-044)", () => {
    const payload = buildChatSendPayload({
      content: "/roll 2d6+3",
      worldId: WORLD_ID,
      selectorMode: "public",
      favoriteMode: "gmroll",
    });
    expect(payload.rollMode).toBe("gmroll");
  });

  it("preserva os campos opcionais de quem chama (speaker, flags)", () => {
    const payload = buildChatSendPayload({
      content: "/roll 1d20",
      worldId: WORLD_ID,
      selectorMode: "public",
      speakerActorId: "actor-1",
      flags: { checkContext: { kind: "save", dcValue: 20, saveType: "reflex" } },
    });
    expect(payload.speakerActorId).toBe("actor-1");
    expect(payload.flags?.checkContext?.kind).toBe("save");
  });
});
