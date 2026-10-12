/**
 * actionBarServices.test.ts — what the core lends a provider so it can run an entry through the
 * SAME paths as the sheet (BAR-F1-04; spec 53 §7.1, REQ-BAR-016, RNF-BAR-01; tasks.md §2.3).
 *
 * The services are the only door from a provider to the world: a live socket resolved on every op
 * (the frozen socket of a stale window was a real bug of `makeSendOpFn`), the flat-op sender that
 * fills `expectedVersion`, the envelope call that answers, "open the sheet", and a short message on
 * the bar's strip. There is no `requestTargets` yet: aim mode is out of this delivery (D-BA16), so
 * the optional member must be ABSENT, not a stub that resolves `null`.
 */

import { describe, expect, it, vi } from "vitest";
import { OwnershipLevel } from "@fusion/shared";

import "../../i18n/index.js";
import { createActionBarServices, type ServicesDeps } from "../actionBarServices.js";

type FakeSocket = { id: string };

function deps(overrides: Partial<ServicesDeps> = {}): ServicesDeps & {
  sent: unknown[];
  notices: string[];
  opened: Array<{ actorId: string; doc: Record<string, unknown>; opts: Record<string, unknown> }>;
} {
  const sent: unknown[] = [];
  const notices: string[] = [];
  const opened: Array<{
    actorId: string;
    doc: Record<string, unknown>;
    opts: Record<string, unknown>;
  }> = [];
  return {
    sent,
    notices,
    opened,
    getSocket: () => ({ id: "socket-1" }) as never,
    worldId: "world-1",
    userId: "user-1",
    isGm: false,
    notify: (message) => {
      notices.push(message);
    },
    sendOp: (op) => {
      sent.push(op);
    },
    envelope: <R>(_socket: unknown, type: string, payload: Record<string, unknown>) =>
      Promise.resolve({ type, payload } as unknown as R),
    actorDoc: () => undefined,
    openSheet: (actorId, doc, opts) => {
      opened.push({ actorId, doc, opts: opts as unknown as Record<string, unknown> });
    },
    ...overrides,
  };
}

describe("o socket é lido a cada chamada (janela velha congela o socket)", () => {
  it("getSocket() devolve o socket de AGORA, não o do dia em que os serviços nasceram", () => {
    let live: FakeSocket | null = { id: "first" };
    const services = createActionBarServices(deps({ getSocket: () => live as never }));

    expect((services.getSocket() as unknown as FakeSocket).id).toBe("first");
    live = { id: "second" };
    expect((services.getSocket() as unknown as FakeSocket).id).toBe("second");
    live = null;
    expect(services.getSocket()).toBeNull();
  });
});

describe("identidade", () => {
  it("worldId, userId e isGm vêm de quem está sentado à mesa", () => {
    const services = createActionBarServices(deps({ worldId: "w", userId: "u", isGm: true }));

    expect(services.worldId).toBe("w");
    expect(services.userId).toBe("u");
    expect(services.isGm).toBe(true);
  });
});

describe("sendOp — a op plana da ficha", () => {
  it("entrega a op ao enviador que preenche o expectedVersion, sem mexer nela", () => {
    const d = deps();
    const services = createActionBarServices(d);
    const op = { type: "chat:send", content: "oi" };

    services.sendOp(op);

    expect(d.sent).toEqual([op]);
    expect(d.sent[0]).toBe(op);
  });
});

describe("request — o envelope com resposta", () => {
  it("manda o tipo e o payload pelo socket vivo e devolve o resultado", async () => {
    const envelope = vi.fn(() => Promise.resolve({ ok: true }));
    const services = createActionBarServices(deps({ envelope: envelope as never }));

    const result = await services.request<{ ok: boolean }>("item:consume", { itemId: "i-1" });

    expect(result).toEqual({ ok: true });
    expect(envelope).toHaveBeenCalledWith({ id: "socket-1" }, "item:consume", { itemId: "i-1" });
  });

  it("sem socket (desconectado) rejeita com uma mensagem que cabe na faixa da barra", async () => {
    const services = createActionBarServices(deps({ getSocket: () => null }));

    await expect(services.request("item:consume", {})).rejects.toThrow(
      "Sem conexão com o servidor.",
    );
  });

  it("a recusa do servidor chega ao provedor como o erro que ele jogou", async () => {
    const boom = new Error("Quantidade insuficiente");
    const services = createActionBarServices(deps({ envelope: () => Promise.reject(boom) }));

    await expect(services.request("item:consume", {})).rejects.toBe(boom);
  });
});

describe("notify — a mensagem curta da faixa", () => {
  it("repassa o texto", () => {
    const d = deps();
    createActionBarServices(d).notify("Sem alvo marcado");

    expect(d.notices).toEqual(["Sem alvo marcado"]);
  });
});

describe("openActorSheet — Abrir na ficha", () => {
  const doc = {
    _id: "actor-1",
    type: "character",
    ownership: { default: 0, "user-1": OwnershipLevel.OWNER },
  };

  it("abre a ficha do ator, com o dono, o mundo e o enviador de ops", () => {
    const d = deps({ actorDoc: (id) => (id === "actor-1" ? doc : undefined) });
    createActionBarServices(d).openActorSheet("actor-1");

    expect(d.opened).toHaveLength(1);
    expect(d.opened[0]?.actorId).toBe("actor-1");
    expect(d.opened[0]?.doc).toBe(doc);
    expect(d.opened[0]?.opts).toMatchObject({
      userId: "user-1",
      worldId: "world-1",
      isGm: false,
      ownership: OwnershipLevel.OWNER,
    });
    expect(typeof d.opened[0]?.opts["sendOpFn"]).toBe("function");
  });

  it("o nível de posse é o do próprio usuário no ator, lido do documento", () => {
    const observer = { ...doc, ownership: { default: OwnershipLevel.OBSERVER } };
    const d = deps({ actorDoc: () => observer });
    createActionBarServices(d).openActorSheet("actor-1");

    expect(d.opened[0]?.opts["ownership"]).toBe(OwnershipLevel.OBSERVER);
  });

  it("o papel privilegiado abre com posse total", () => {
    const d = deps({ isGm: true, actorDoc: () => ({ ...doc, ownership: { default: 0 } }) });
    createActionBarServices(d).openActorSheet("actor-1");

    expect(d.opened[0]?.opts["ownership"]).toBe(OwnershipLevel.OWNER);
    expect(d.opened[0]?.opts["isGm"]).toBe(true);
  });

  it("ator que não está no espelho: não abre nada e não lança", () => {
    const d = deps({ actorDoc: () => undefined });

    expect(() => createActionBarServices(d).openActorSheet("actor-fantasma")).not.toThrow();
    expect(d.opened).toEqual([]);
  });
});

describe("modo mira (D-BA16)", () => {
  it("requestTargets não existe: o modo mira ficou fora desta entrega", () => {
    const services = createActionBarServices(deps());

    expect("requestTargets" in services).toBe(false);
  });
});
