/**
 * Initiative chat line in pt-BR (BHR-F7-06, D5). The system chat speaks the
 * table's language: "<nome> rola iniciativa (Percepção): N", never the
 * English "rolls initiative".
 */
import { describe, it, expect } from "vitest";
import type { Database as Db } from "better-sqlite3";
import { buildInitiativeRollBroadcaster } from "../combat-chat.js";

interface Sent {
  content: string;
}

function harness() {
  const persisted: Sent[] = [];
  const emitted: Sent[] = [];
  const db = {
    prepare: (sql: string) => ({
      all: () => (sql.includes("FROM users") ? [] : []),
      get: () => undefined,
      run: (...args: unknown[]) => {
        if (sql.includes("INSERT INTO chat_messages")) {
          persisted.push(JSON.parse(args[1] as string) as Sent);
        }
      },
    }),
  } as unknown as Db;
  const socket = {
    data: { userId: "u1", role: 1 },
    emit: (_ev: string, env: { payload: { documents: Sent[] } }) => {
      emitted.push(...env.payload.documents);
    },
  };
  const ns = { sockets: new Map([["s1", socket]]) };
  const broadcast = buildInitiativeRollBroadcaster({
    db,
    ns: ns as never,
    seqStore: { next: () => 1 } as never,
    worldId: "w1",
    authorId: "u1",
  });
  return { broadcast, persisted, emitted };
}

const base = {
  combatantName: "Bhrotto",
  actorId: null,
  total: 20,
  hidden: false,
  hasPlayerOwner: true,
};

describe("initiative chat line", () => {
  it("is written in pt-BR with the statistic label", () => {
    const h = harness();
    h.broadcast([{ ...base, statistic: "Perception" }]);
    expect(h.persisted[0]?.content).toBe("Bhrotto rola iniciativa (Percepção): 20");
    expect(h.emitted[0]?.content).toBe("Bhrotto rola iniciativa (Percepção): 20");
  });

  it("omits the parenthesis when there is no statistic", () => {
    const h = harness();
    h.broadcast([{ ...base, statistic: null }]);
    expect(h.persisted[0]?.content).toBe("Bhrotto rola iniciativa: 20");
  });
});
