/**
 * conditionRegistry.test.ts — the client side of the condition display contract
 * (spec 15 REQ-SYS-043, spec 39 §5.4).
 *
 * `conditionView.ts` is already proved against hand-made declarations; what is
 * proved HERE is that the declarations arrive at all — that the map handed to
 * the chips comes from the system the world is running, and not from an empty
 * Map that silently turns every condition into a tooltip-less situation.
 */

import { describe, expect, it, beforeEach } from "vitest";
import type { Socket } from "socket.io-client";

import {
  conditionRegistry,
  ensureConditionRegistry,
  indexConditionDeclarations,
  resetConditionRegistry,
  seedConditionRegistry,
} from "../conditionRegistry.svelte.js";
import { toConditionView } from "../conditionView.js";

// ---------------------------------------------------------------------------
// A socket that answers `system:conditions` and counts the asks
// ---------------------------------------------------------------------------

interface FakeSocket {
  socket: Socket;
  asks: string[];
}

function fakeSocket(answer: unknown, options: { fail?: boolean } = {}): FakeSocket {
  const asks: string[] = [];
  const socket = {
    emit(event: string, envelope: { type: string; requestId?: string }, ack: (a: unknown) => void) {
      void event;
      asks.push(envelope.type);
      const requestId = envelope.requestId;
      queueMicrotask(() => {
        ack(
          options.fail === true
            ? { ok: false, requestId, code: "PERMISSION_DENIED", message: "no" }
            : { ok: true, requestId, result: answer },
        );
      });
    },
  } as unknown as Socket;
  return { socket, asks };
}

const PF2E_ANSWER = {
  systemId: "pf2e",
  conditions: [
    { slug: "frightened", label: "Amedrontado", tone: "harm", help: "Penalidade de status." },
    {
      slug: "dying",
      label: "Morrendo",
      tone: "harm",
      help: "A um passo da morte.",
      critical: true,
    },
    { slug: "hasted", label: "Célere", tone: "benefit" },
    { slug: "clumsy", label: "Desajeitado" },
  ],
};

beforeEach(() => {
  resetConditionRegistry();
});

// ---------------------------------------------------------------------------
// The declarations reach the chips
// ---------------------------------------------------------------------------

describe("the active system's declarations reach the client (REQ-SYS-043)", () => {
  it("REQ-CTT-031: after the answer, the chip's tone comes from the declaration", async () => {
    const { socket } = fakeSocket(PF2E_ANSWER);
    await ensureConditionRegistry(socket);

    const harmful = toConditionView(
      { slug: "frightened", value: 2 },
      conditionRegistry.declarations.get("frightened"),
    );
    const helpful = toConditionView(
      { slug: "hasted" },
      conditionRegistry.declarations.get("hasted"),
    );

    expect(harmful.tone).toBe("harm");
    expect(helpful.tone).toBe("benefit");
    expect(harmful.label).toBe("Amedrontado 2");
  });

  it("REQ-CTT-032: a condition declared critical arrives declared critical", async () => {
    const { socket } = fakeSocket(PF2E_ANSWER);
    await ensureConditionRegistry(socket);

    expect(
      toConditionView({ slug: "dying", value: 1 }, conditionRegistry.declarations.get("dying"))
        .critical,
    ).toBe(true);
    expect(
      toConditionView({ slug: "frightened" }, conditionRegistry.declarations.get("frightened"))
        .critical,
    ).toBe(false);
  });

  it("REQ-CTT-034: the declared help arrives, so there is a tooltip to draw", async () => {
    const { socket } = fakeSocket(PF2E_ANSWER);
    await ensureConditionRegistry(socket);

    expect(
      toConditionView({ slug: "dying" }, conditionRegistry.declarations.get("dying")).help,
    ).toBe("A um passo da morte.");
    expect(
      toConditionView({ slug: "hasted" }, conditionRegistry.declarations.get("hasted")).help,
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fail open — REQ-CTT-035
// ---------------------------------------------------------------------------

describe("nothing waits on the dictionary (REQ-CTT-035)", () => {
  it("REQ-CTT-035: before any answer the map is empty, never undefined", () => {
    expect(conditionRegistry.declarations.size).toBe(0);
  });

  it("REQ-CTT-035: a refused request leaves the map empty instead of throwing", async () => {
    const { socket } = fakeSocket(PF2E_ANSWER, { fail: true });

    await expect(ensureConditionRegistry(socket)).resolves.toBeUndefined();
    expect(conditionRegistry.declarations.size).toBe(0);
  });

  it("REQ-CTT-035: a declaration with neither tone nor help still lands in the map", async () => {
    const { socket } = fakeSocket(PF2E_ANSWER);
    await ensureConditionRegistry(socket);

    const bare = toConditionView({ slug: "clumsy" }, conditionRegistry.declarations.get("clumsy"));
    expect(bare.name).toBe("Desajeitado");
    expect(bare.tone).toBe("special");
    expect(bare.help).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Asked once per seat
// ---------------------------------------------------------------------------

describe("the dictionary is fetched once", () => {
  it("REQ-GAV-017: reopening the tab does not ask the server again", async () => {
    const { socket, asks } = fakeSocket(PF2E_ANSWER);

    await ensureConditionRegistry(socket);
    await ensureConditionRegistry(socket);
    await ensureConditionRegistry(socket);

    expect(asks).toEqual(["system:conditions"]);
  });

  it("indexes by slug and drops an entry with none", () => {
    const map = indexConditionDeclarations([
      { slug: "prone", label: "Caído" },
      { slug: "  ", label: "Nada" },
    ]);

    expect([...map.keys()]).toEqual(["prone"]);
  });

  it("can be seeded without a socket", () => {
    seedConditionRegistry([{ slug: "prone", label: "Caído", tone: "harm" }]);

    expect(conditionRegistry.declarations.get("prone")?.tone).toBe("harm");
  });
});
