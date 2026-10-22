/**
 * Apoio do urso on a CRITICAL hit, from the REAL pack effect to the server's settlement (BHR-F7-06, review of wave 13,
 * I1/I2).
 *
 * The rule, written here from Player Core and the table's reading (confirmed in the wave 13 review): the Support says
 * "the creature takes 1d8 slashing damage FROM THE BEAR". That is damage of the bear, separate from the Strike, so a
 * critical hit doubles the Strike's own dice and does NOT double the bear's 1d8 (2d8 stays 2d8 for a Nimble or
 * Savage companion).
 *
 * `extra-damage.test.ts` judges the settlement with a hand-made part; this file closes the gap that left open: the
 * effect the compendium actually ships goes through the pf2e roll resolver and into `settleExtraDamage`, and the
 * assertion is the rule above, never the pack's own flag.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pf2eSystem } from "@fusion/system-pf2e";
import type { RollResolutionInput } from "@fusion/system-api";
import { settleExtraDamage } from "../chat/extra-damage.js";

type Rec = Record<string, unknown>;

const PACK = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../external/fusion-systems-2e/systems/pf2e/packs/effects-ranger-homebrew/documents.json",
);

const OWNER = "owner";
const BEAR = "bear";
const FOE = "foe";
const SCENE = "scene1";

/** The copy `effect:apply` embeds: the pack document with the origin the server stamps. */
function embeddedSupport(slug: string): Rec {
  const all = JSON.parse(readFileSync(PACK, "utf8")) as Rec[];
  const doc = all.find((d) => (d["system"] as Rec)["slug"] === slug);
  if (doc === undefined) throw new Error(`effect ${slug} is not in the pack`);
  const system = structuredClone(doc["system"] as Rec);
  const fusion = system["fusion"] as Rec;
  return {
    _id: "sup1",
    name: doc["name"],
    type: "effect",
    system: {
      ...system,
      fusion: { ...fusion, origin: { actorId: OWNER, itemSourceId: slug, companionActorId: BEAR } },
    },
  };
}

function companion(stage: string): Rec {
  return {
    _id: BEAR,
    type: "familiar",
    system: {
      companionKind: "animalCompanion",
      masterActorId: OWNER,
      companion: { typeSlug: "bear", stage, track: null, active: true },
    },
  };
}

/** What the real pack effect makes the server add to a Strike's damage roll against an adjacent foe. */
function settleRealSupport(stage: string, hit: "success" | "criticalSuccess") {
  const input: RollResolutionInput = {
    actor: {
      _id: OWNER,
      type: "character",
      name: "Dono",
      items: [embeddedSupport("effect-support-bear")],
      system: { derived: {} },
    },
    rollContext: {
      actorId: OWNER,
      selectors: ["strike-damage", "damage"],
      options: ["action:strike"],
    },
    target: null,
    origin: null,
    companions: [companion(stage)],
  };
  const resolved = pf2eSystem.rollResolver?.resolve(input);
  const extra = resolved?.extraDamage ?? [];
  // Anchor: the real effect named a part at all, otherwise a "no extra dice" below would prove nothing.
  expect(extra).toHaveLength(1);
  const actors: Record<string, Rec> = {
    [BEAR]: { _id: BEAR, system: { traits: { size: { value: "med" } } } },
    [FOE]: { _id: FOE, system: { traits: { size: { value: "med" } } } },
  };
  return settleExtraDamage({
    extra,
    target: { tokenId: "foeTok", actorId: FOE, sceneId: SCENE },
    hit,
    world: {
      scenes: [
        {
          _id: SCENE,
          grid: { size: 100, distance: 5, type: "square" },
          tokens: [
            { _id: "bearTok", actorId: BEAR, x: 0, y: 0 },
            { _id: "foeTok", actorId: FOE, x: 100, y: 0 },
          ],
        },
      ],
      getActor: (id) => actors[id] ?? null,
    },
  });
}

describe("Apoio do urso, efeito real do pack até o servidor: o 1d8 é dano do urso, não do Golpe", () => {
  it("acerto normal: +1d8 (young) e +2d8 (nimble)", () => {
    expect(settleRealSupport("young", "success").formulaSuffix).toBe(" + 1d8");
    expect(settleRealSupport("nimble", "success").formulaSuffix).toBe(" + 2d8");
  });

  it("acerto crítico: o golpe dobra, o dano do urso continua o mesmo (1d8 e 2d8, nunca 2d8 e 4d8)", () => {
    expect(settleRealSupport("young", "criticalSuccess").formulaSuffix).toBe(" + 1d8");
    expect(settleRealSupport("nimble", "criticalSuccess").formulaSuffix).toBe(" + 2d8");
    expect(settleRealSupport("young", "criticalSuccess").applied[0]?.dice).toBe("1d8");
  });
});
