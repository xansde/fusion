/**
 * BHR-F4-11 (DC-08, REQ-PET-122) — the server hands the roll resolver the re-derived OWNER of an ACTIVE animal
 * companion (and only of it), so the system can share the Hunt Prey with it. The sharing itself is the system's
 * (pf2e `roll-resolution-hook.test.ts`); this pins who counts as "the active companion of whom".
 */
import { describe, it, expect } from "vitest";
import { defineSystem } from "@fusion/system-api";
import type { RollResolutionInput } from "@fusion/system-api";
import type { FusionRollContext } from "@fusion/shared";
import { prepareRollResolution } from "../chat/roll-resolution.js";
import type { DocumentStore } from "../documents/store.js";
import { UserRole } from "../documents/ownership.js";

const seen: RollResolutionInput[] = [];

const system = defineSystem(
  {
    id: "companion-roll-test",
    title: "Companion roll test",
    version: "0.1.0",
    engineCompat: ">=0.1.0 <2.0.0",
    authors: [{ name: "Test" }],
    documentTypes: {},
    languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
  },
  (r) => {
    r.registerRollResolver({
      resolve(input) {
        seen.push(input);
        return { modifiers: [], total: 0, notes: [] };
      },
    });
  },
);

function storeOf(actors: Record<string, Record<string, unknown>>): DocumentStore {
  return {
    get: (_collection: string, id: string) => {
      const doc = actors[id];
      if (doc === undefined) throw new Error(`not found ${id}`);
      return doc;
    },
    getAll: () => Object.values(actors),
  } as unknown as DocumentStore;
}

const GM = { userId: "gm", role: UserRole.GAMEMASTER };

function companion(
  master: string,
  companionBlock?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    _id: "bear",
    type: "familiar",
    name: "Urso",
    system: {
      companionKind: "animalCompanion",
      masterActorId: master,
      ...(companionBlock === undefined ? {} : { companion: companionBlock }),
    },
  };
}

const ranger = { _id: "ranger", type: "character", name: "Caçador", system: { marker: "owner" } };

function roll(actors: Record<string, Record<string, unknown>>): RollResolutionInput {
  seen.length = 0;
  const ctx: FusionRollContext = { actorId: "bear", selectors: ["intimidation"], options: [] };
  prepareRollResolution({ store: storeOf(actors), systemModule: system }, ctx, GM, []);
  expect(seen).toHaveLength(1);
  return seen[0] as RollResolutionInput;
}

describe("prepareRollResolution — o dono do companheiro ativo vai ao resolvedor", () => {
  it("companheiro ativo (campo ausente ou true): o dono re-derivado entra em masterActor", () => {
    const legacy = roll({ bear: companion("ranger"), ranger });
    expect(legacy.masterActor?.["_id"]).toBe("ranger");
    const explicit = roll({ bear: companion("ranger", { active: true }), ranger });
    expect(explicit.masterActor?.["_id"]).toBe("ranger");
  });

  it("companheiro inativo não leva o dono", () => {
    expect(
      roll({ bear: companion("ranger", { active: false }), ranger }).masterActor ?? null,
    ).toBeNull();
  });

  it("dono ausente do mundo (órfão): sem dono, a rolagem segue", () => {
    expect(roll({ bear: companion("ghost") }).masterActor ?? null).toBeNull();
  });

  it("ator comum e familiar comum não levam dono", () => {
    expect(
      roll({ bear: { _id: "bear", type: "character", name: "X", system: {} } }).masterActor ?? null,
    ).toBeNull();
    const familiar = {
      _id: "bear",
      type: "familiar",
      name: "Gato",
      system: { companionKind: "familiar", masterActorId: "ranger" },
    };
    expect(roll({ bear: familiar, ranger }).masterActor ?? null).toBeNull();
  });
});
