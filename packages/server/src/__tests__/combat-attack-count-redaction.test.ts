/**
 * The server's MAP count rides on the combat document as `attackCount` and names
 * the ACTIVE combatant (onda-6 review I-7). When that combatant is hidden, a
 * player must learn neither its id nor its count (REQ-CBT-031) — same rule as
 * `activeCombatantId`.
 */
import { describe, it, expect } from "vitest";
import type { Namespace } from "socket.io";
import type { Envelope } from "@fusion/shared";
import { stripHiddenCombatantsFromCombat } from "../net/redaction.js";
import { broadcastCombatUpdate } from "../combat/combat-handlers.js";

const combat = (hidden: boolean): Record<string, unknown> => ({
  _id: "combat0000000001",
  activeCombatantId: "cbtHero",
  attackCount: { combatantId: "cbtHero", round: 1, count: 2 },
  combatants: [
    { _id: "cbtHero", hidden },
    { _id: "cbtOther", hidden: false },
  ],
});

describe("attackCount redaction", () => {
  it("a visible active combatant keeps its count for everyone", () => {
    const out = stripHiddenCombatantsFromCombat(combat(false));
    expect(out["attackCount"]).toEqual({ combatantId: "cbtHero", round: 1, count: 2 });
  });

  it("a hidden active combatant takes the count (and its id) out of the player view", () => {
    const out = stripHiddenCombatantsFromCombat(combat(true));
    expect(out["activeCombatantId"]).toBeNull();
    expect(out["attackCount"]).toBeNull();
    expect(JSON.stringify(out)).not.toContain("cbtHero");
  });

  it("the combat:updated diff is masked for players, and complete for the Mestre", () => {
    const seen: Record<string, unknown[]> = { gm: [], player: [] };
    const socket = (role: number, key: string) => ({
      data: { role },
      emit: (_event: string, envelope: unknown) => seen[key]?.push(envelope),
    });
    const ns = {
      sockets: new Map([
        ["a", socket(4, "gm")],
        ["b", socket(1, "player")],
      ]),
      emit: () => undefined,
    } as unknown as Namespace;
    const envelope = {
      type: "combat:updated",
      seq: 1,
      ts: 0,
      payload: {
        combatId: "combat0000000001",
        diff: { attackCount: { combatantId: "cbtHero", round: 1, count: 2 } },
      },
    } as unknown as Envelope;
    broadcastCombatUpdate(ns, envelope, combat(true));
    expect(JSON.stringify(seen["gm"])).toContain("cbtHero");
    expect(JSON.stringify(seen["player"])).not.toContain("cbtHero");
  });
});
