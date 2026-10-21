/**
 * compendiumApi.resilience.test.ts — "Carregar o compêndio está demorando e
 * falhando muitas vezes" (mesa de A Queda, 19/10/2026).
 *
 * Cause: every picker/sheet asked the server for the SAME multi-megabyte pack
 * index again (feats-core alone is ~2.6 MB of JSON) with a flat 10 s timeout and
 * no retry, and several of them in parallel on every sheet open. Over the
 * tunnel the tail of that queue blew the 10 s budget and the user saw a failure.
 *
 * The API layer now (1) caches the answers per socket, (2) shares an in-flight
 * request between callers, (3) filters a cached index locally with the very same
 * `searchPackIndex` the server runs, (4) gives indexes a timeout sized for
 * megabytes, (5) retries transient failures with backoff and (6) fails with a
 * pt-BR message that says what happened.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Socket } from "socket.io-client";
import type { PackIndexEntry } from "@fusion/shared";
import {
  CompendiumQueryError,
  getDocument,
  getPackIndex,
  listPacks,
  searchPack,
} from "../compendiumApi.js";

type Ack = (a: { ok: boolean; result?: unknown; code?: string; message?: string }) => void;

interface Sent {
  type: string;
  payload: unknown;
}

/** A socket driven by a script: each emit is answered by the next behaviour for that query type. */
function scriptedSocket(
  sent: Sent[],
  answer: (n: number, env: Sent) => "never" | { ok: boolean; result?: unknown; code?: string; message?: string },
): Socket {
  return {
    connected: true,
    emit: (_event: string, env: Sent, ack: Ack) => {
      sent.push({ type: env.type, payload: env.payload });
      const a = answer(sent.length, env);
      if (a !== "never") ack(a);
    },
  } as unknown as Socket;
}

function entry(id: string, name: string, level: number): PackIndexEntry {
  return { _id: id, uuid: `Compendium.pf2e.feats-core.Item.${id}`, name, img: "", type: "feat", index: { "system.level": level } } as unknown as PackIndexEntry;
}

const INDEX = {
  packId: "pf2e.feats-core",
  entries: [entry("a", "Power Attack", 1), entry("b", "Shield Block", 1), entry("c", "Reactive Shield", 3)],
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("cache e requisição compartilhada", () => {
  it("duas chamadas simultâneas do mesmo índice viram UMA ida ao servidor", async () => {
    const sent: Sent[] = [];
    const socket = scriptedSocket(sent, () => ({ ok: true, result: INDEX }));
    const [a, b] = await Promise.all([
      getPackIndex(socket, "pf2e.feats-core"),
      getPackIndex(socket, "pf2e.feats-core"),
    ]);
    expect(sent).toHaveLength(1);
    expect(a.entries).toHaveLength(3);
    expect(b).toBe(a);
  });

  it("reabrir a ficha (segunda chamada depois da primeira) não baixa o índice de novo", async () => {
    const sent: Sent[] = [];
    const socket = scriptedSocket(sent, () => ({ ok: true, result: INDEX }));
    await getPackIndex(socket, "pf2e.feats-core");
    await getPackIndex(socket, "pf2e.feats-core");
    expect(sent).toHaveLength(1);
  });

  it("o cache é por conexão: socket novo (reconexão) pergunta de novo", async () => {
    const sent: Sent[] = [];
    await getPackIndex(scriptedSocket(sent, () => ({ ok: true, result: INDEX })), "pf2e.feats-core");
    await getPackIndex(scriptedSocket(sent, () => ({ ok: true, result: INDEX })), "pf2e.feats-core");
    expect(sent).toHaveLength(2);
  });

  it("falha não fica no cache: a próxima chamada tenta de novo", async () => {
    const sent: Sent[] = [];
    const socket = scriptedSocket(sent, (n) =>
      n === 1 ? { ok: false, code: "NOT_FOUND", message: "Pack not found" } : { ok: true, result: INDEX },
    );
    await expect(getPackIndex(socket, "pf2e.feats-core")).rejects.toBeInstanceOf(CompendiumQueryError);
    await expect(getPackIndex(socket, "pf2e.feats-core")).resolves.toMatchObject({ packId: "pf2e.feats-core" });
    expect(sent).toHaveLength(2);
  });

  it("listPacks com o mesmo filtro também é compartilhado", async () => {
    const sent: Sent[] = [];
    const socket = scriptedSocket(sent, () => ({ ok: true, result: { packs: [] } }));
    await Promise.all([
      listPacks(socket, { systemId: "pf2e", documentType: "Item" }),
      listPacks(socket, { systemId: "pf2e", documentType: "Item" }),
    ]);
    await listPacks(socket, { systemId: "pf2e", documentType: "Item" });
    expect(sent).toHaveLength(1);
  });
});

describe("o que não fica guardado", () => {
  it("lista de packs vale por pouco tempo: depois de 30 s pergunta de novo (pack que chegou depois aparece)", async () => {
    const sent: Sent[] = [];
    const socket = scriptedSocket(sent, () => ({ ok: true, result: { packs: [] } }));
    await listPacks(socket, { systemId: "pf2e" });
    await listPacks(socket, { systemId: "pf2e" });
    expect(sent).toHaveLength(1);
    vi.setSystemTime(Date.now() + 31_000);
    await listPacks(socket, { systemId: "pf2e" });
    expect(sent).toHaveLength(2);
  });

  it("índice vazio (pack ainda não carregado) não fica no cache", async () => {
    const sent: Sent[] = [];
    const socket = scriptedSocket(sent, () => ({ ok: true, result: { packId: "pf2e.feats-core", entries: [] } }));
    await getPackIndex(socket, "pf2e.feats-core");
    await getPackIndex(socket, "pf2e.feats-core");
    expect(sent).toHaveLength(2);
  });

  it("recusa do servidor sem código transitório não é repetida", async () => {
    const sent: Sent[] = [];
    const socket = scriptedSocket(sent, () => ({ ok: false, message: "down" }));
    await expect(getPackIndex(socket, "pf2e.feats-core")).rejects.toThrow();
    expect(sent).toHaveLength(1);
  });
});

describe("searchPack reaproveita o índice", () => {
  it("busca sem filtro usa o mesmo cache do índice (uma ida só para getPackIndex + searchPack)", async () => {
    const sent: Sent[] = [];
    const socket = scriptedSocket(sent, (_n, env) =>
      env.type === "compendium:index"
        ? { ok: true, result: INDEX }
        : { ok: true, result: { packId: "pf2e.feats-core", entries: INDEX.entries } },
    );
    await getPackIndex(socket, "pf2e.feats-core");
    const all = await searchPack(socket, { packId: "pf2e.feats-core" });
    expect(all.entries).toHaveLength(3);
    expect(sent.map((s) => s.type)).toEqual(["compendium:index"]);
  });

  it("quem ordena o resultado da busca não mexe no índice compartilhado", async () => {
    const sent: Sent[] = [];
    const socket = scriptedSocket(sent, () => ({ ok: true, result: INDEX }));
    const all = await searchPack(socket, { packId: "pf2e.feats-core" });
    all.entries.reverse();
    const again = await getPackIndex(socket, "pf2e.feats-core");
    expect(again.entries.map((e) => e.name)).toEqual(["Power Attack", "Shield Block", "Reactive Shield"]);
  });

  it("com o índice já em cache, a busca filtrada roda LOCAL com a mesma regra do servidor", async () => {
    const sent: Sent[] = [];
    const socket = scriptedSocket(sent, () => ({ ok: true, result: INDEX }));
    await getPackIndex(socket, "pf2e.feats-core");
    const shields = await searchPack(socket, { packId: "pf2e.feats-core", text: "shield" });
    expect(shields.entries.map((e) => e.name)).toEqual(["Shield Block", "Reactive Shield"]);
    expect(sent).toHaveLength(1);
  });

  it("busca filtrada SEM índice em cache vai ao servidor (não baixa megabytes para achar 3 itens) e é cacheada", async () => {
    const sent: Sent[] = [];
    const socket = scriptedSocket(sent, () => ({
      ok: true,
      result: { packId: "pf2e.feats-core", entries: [INDEX.entries[2]] },
    }));
    const q = { packId: "pf2e.feats-core", text: "reactive" };
    const [a, b] = await Promise.all([searchPack(socket, q), searchPack(socket, q)]);
    await searchPack(socket, q);
    expect(sent.map((s) => s.type)).toEqual(["compendium:search"]);
    expect(a.entries).toHaveLength(1);
    expect(b.entries).toHaveLength(1);
  });
});

describe("tempo, nova tentativa e mensagem", () => {
  it("índice não estoura em 10 s (era o teto antigo): ainda espera a resposta", async () => {
    const sent: Sent[] = [];
    let release: (() => void) | undefined;
    const socket = {
      connected: true,
      emit: (_e: string, env: Sent, ack: Ack) => {
        sent.push(env);
        release = () => ack({ ok: true, result: INDEX });
      },
    } as unknown as Socket;
    const p = getPackIndex(socket, "pf2e.feats-core");
    let settled = false;
    void p.then(
      () => (settled = true),
      () => (settled = true),
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(settled).toBe(false);
    release?.();
    await expect(p).resolves.toMatchObject({ packId: "pf2e.feats-core" });
    expect(sent).toHaveLength(1);
  });

  it("tentativa que não responde é repetida e a segunda resolve", async () => {
    const sent: Sent[] = [];
    const socket = scriptedSocket(sent, (n) => (n === 1 ? "never" : { ok: true, result: INDEX }));
    const p = getPackIndex(socket, "pf2e.feats-core");
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(p).resolves.toMatchObject({ packId: "pf2e.feats-core" });
    expect(sent).toHaveLength(2);
  });

  it("três tentativas sem resposta: erro TIMEOUT com mensagem em pt-BR dizendo o que aconteceu", async () => {
    const sent: Sent[] = [];
    const socket = scriptedSocket(sent, () => "never");
    const p = getPackIndex(socket, "pf2e.feats-core");
    const assertion = expect(p).rejects.toMatchObject({
      name: "CompendiumQueryError",
      code: "TIMEOUT",
      attempts: 3,
      message: expect.stringMatching(/compêndio.*demor.*3 tentativas/i),
    });
    await vi.advanceTimersByTimeAsync(300_000);
    await assertion;
    expect(sent).toHaveLength(3);
  });

  it("erro permanente do servidor (pack inexistente) não é repetido", async () => {
    const sent: Sent[] = [];
    const socket = scriptedSocket(sent, () => ({ ok: false, code: "NOT_FOUND", message: "Pack not found" }));
    await expect(getPackIndex(socket, "pf2e.nada")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(sent).toHaveLength(1);
  });

  it("erro transitório do servidor (INTERNAL_ERROR) é repetido", async () => {
    const sent: Sent[] = [];
    const socket = scriptedSocket(sent, (n) =>
      n === 1 ? { ok: false, code: "INTERNAL_ERROR", message: "boom" } : { ok: true, result: INDEX },
    );
    const p = getPackIndex(socket, "pf2e.feats-core");
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(p).resolves.toMatchObject({ packId: "pf2e.feats-core" });
    expect(sent).toHaveLength(2);
  });

  it("getDocument (preview) continua rejeitando quando o ack nunca chega, agora em pt-BR e com uma nova tentativa", async () => {
    const sent: Sent[] = [];
    const socket = scriptedSocket(sent, () => "never");
    const p = getDocument(socket, "Compendium.pf2e.spells-core.Item.s1");
    const assertion = expect(p).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
    expect(sent).toHaveLength(2);
  });
});
