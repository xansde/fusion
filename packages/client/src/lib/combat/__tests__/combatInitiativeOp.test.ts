/**
 * combatInitiativeOp.test.ts — what `combat:rollInitiative` actually puts on the wire (G053).
 *
 * The sibling component tests (`CombatSetup.test.ts`) prove what the montagem *draws* and
 * that the panel wires the chosen statistic into the roll gesture. They cannot prove the
 * other half of REQ-CBA-066 — "registrar a escolha no participante" — because that half is a
 * claim about the PAYLOAD: the slug rides the existing `options` bag of the roll operation,
 * and the server writes the statistic it used onto the participant. A regression that renamed
 * the key, dropped the argument on the way to `sendOp`, or added a second operation would
 * leave every markup assertion green. So this file emits the op against a fake socket and
 * reads the envelope.
 *
 * The emitted payload is also parsed by the REAL wire schema
 * (`CombatRollInitiativePayloadSchema`, `.strict()`), which is what the server handler parses
 * — the test is bound to the contract, not to a copy of it.
 *
 * Covers REQ-CBA-063 (rolar todos / só as criaturas), REQ-CBA-065 (o jogador rola os seus)
 * and REQ-CBA-066 (a escolha de estatística no mesmo gesto de rolar).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Socket } from "socket.io-client";
import { CombatRollInitiativePayloadSchema } from "@fusion/shared";

import { combatActions, combatStore } from "../combatStore.svelte.js";
import { initiativeRollOptions } from "../combatSetup.js";

// ---------------------------------------------------------------------------
// Fake socket — acks every op immediately, records the envelopes
// ---------------------------------------------------------------------------

type EmitAck = (ack: unknown) => void;

interface FakeSocket {
  socket: Socket;
  envelopes: () => { type: string; payload: Record<string, unknown> }[];
}

function makeFakeSocket(): FakeSocket {
  const sent: { type: string; payload: Record<string, unknown> }[] = [];

  const socket = {
    emit: vi.fn((_event: string, envelope: unknown, ack: EmitAck) => {
      sent.push(envelope as { type: string; payload: Record<string, unknown> });
      ack({ ok: true, result: {} });
    }),
  } as unknown as Socket;

  return { socket, envelopes: () => sent };
}

/** The single envelope the op emitted — fails loudly if it emitted zero or many. */
function onlyEnvelope(fake: FakeSocket): { type: string; payload: Record<string, unknown> } {
  const sent = fake.envelopes();
  expect(sent).toHaveLength(1);
  return sent[0]!;
}

/** What survives serialization to the server — `undefined` keys do not travel. */
function onTheWire(payload: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

beforeEach(() => {
  combatStore.busy = false;
  combatStore.error = null;
});

// ---------------------------------------------------------------------------
// REQ-CBA-066 — the chosen statistic rides the roll
// ---------------------------------------------------------------------------

describe("a estatística escolhida viaja no payload da própria rolagem (REQ-CBA-066)", () => {
  it("o envelope leva a escolha na mesma operação, e não numa operação nova", async () => {
    const fake = makeFakeSocket();

    await combatActions.rollInitiative(
      fake.socket,
      "combat1",
      ["pc1"],
      initiativeRollOptions("stealth"),
    );

    expect(onlyEnvelope(fake)).toMatchObject({
      type: "combat:rollInitiative",
      payload: { combatId: "combat1", combatantIds: ["pc1"], options: { skill: "stealth" } },
    });
    expect(combatStore.error).toBeNull();
  });

  it("sem escolha, o payload chega ao servidor sem options — a fórmula decide sozinha", async () => {
    const fake = makeFakeSocket();

    await combatActions.rollInitiative(
      fake.socket,
      "combat1",
      ["pc1"],
      initiativeRollOptions(null),
    );

    const { payload } = onlyEnvelope(fake);

    expect(payload["options"]).toBeUndefined();
    expect(onTheWire(payload)).not.toHaveProperty("options");
  });

  it("o payload emitido é aceito pelo esquema estrito que o servidor usa para lê-lo", () => {
    const chosen = { combatId: "combat1", combatantIds: ["pc1"], options: { skill: "stealth" } };
    const unchosen = { combatId: "combat1", combatantIds: ["pc1"] };

    expect(CombatRollInitiativePayloadSchema.safeParse(chosen).success).toBe(true);
    expect(CombatRollInitiativePayloadSchema.safeParse(unchosen).success).toBe(true);
    // The bag is the one the formula reads; a stray top-level key is not the contract.
    expect(
      CombatRollInitiativePayloadSchema.safeParse({ ...unchosen, skill: "stealth" }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REQ-CBA-063 / REQ-CBA-065 — who the roll is for
// ---------------------------------------------------------------------------

describe("a quem a rolagem se destina, dito no payload (REQ-CBA-063)", () => {
  it("'rolar todos' não nomeia ninguém — quem escolhe os alvos é o servidor", async () => {
    const fake = makeFakeSocket();

    await combatActions.rollInitiative(fake.socket, "combat1");

    const { payload } = onlyEnvelope(fake);

    expect(payload["combatId"]).toBe("combat1");
    expect(onTheWire(payload)).not.toHaveProperty("combatantIds");
    expect(onTheWire(payload)).not.toHaveProperty("options");
  });

  it("'só as criaturas' nomeia exatamente a lista de criaturas, e nada além dela", async () => {
    const fake = makeFakeSocket();

    await combatActions.rollInitiative(fake.socket, "combat1", ["npc1", "npc2"]);

    expect(onlyEnvelope(fake).payload["combatantIds"]).toEqual(["npc1", "npc2"]);
  });

  it("o jogador rolando os seus manda só o participante dele (REQ-CBA-065)", async () => {
    const fake = makeFakeSocket();

    await combatActions.rollInitiative(fake.socket, "combat1", ["pc1"], initiativeRollOptions(""));

    const { payload } = onlyEnvelope(fake);

    expect(payload["combatantIds"]).toEqual(["pc1"]);
    expect(payload["options"]).toBeUndefined();
  });
});
