/**
 * pack-audience.test.mjs — the audience of a published pack is decided by its
 * CONTENT, not by a list of slugs.
 *
 * REQ-CPD-072, REQ-PF2-141, REQ-PF2-142, REQ-PF2-143.
 *
 * The defect this suite exists for: while the rule was `slug === "bestiary-core"`,
 * every pack the system had not yet published fell through to `"all"`. A second
 * bestiary, a monster pack for a new adventure, or the first hazard pack would
 * be generated open to the players — and, because the tripwire in
 * `systems/pf2e/src/__tests__/packs-validation.test.ts` was written against the
 * same literal slug, the suite would have approved it. So the cases that matter
 * here are the packs that do NOT exist today.
 *
 * Execução:
 *   node --test src/__tests__/pack-audience.test.mjs
 *
 * Zero dependências externas — Node 22 ESM nativo + node:test.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { resolvePackAudience } from "../pack-audience.mjs";

const npc = (name) => ({ _id: name, name, type: "npc", system: {} });
const hazard = (name) => ({ _id: name, name, type: "hazard", system: {} });
const feat = (name) => ({ _id: name, name, type: "feat", system: {} });

test("REQ-CPD-072/REQ-PF2-141: today's creature pack resolves to 'gm'", () => {
  assert.equal(resolvePackAudience("bestiary-core", [npc("Goblin Warrior")]), "gm");
});

test("REQ-PF2-141: a creature pack the system does not publish yet is ALSO born 'gm'", () => {
  // The regression that motivated this rule: any slug other than the single
  // enumerated one used to resolve to "all", i.e. the bestiary of the next
  // adventure would ship readable by the players.
  for (const slug of ["bestiary-2", "monsters-abomination-vaults", "npcs-gallery"]) {
    assert.equal(resolvePackAudience(slug, [npc("Something Toothy")]), "gm", slug);
  }
});

test("REQ-PF2-142: the first hazard pack is born 'gm' without anyone editing a list", () => {
  // No hazard pack is generated today. The requirement is prospective and
  // forbids deciding the audience case by case at generation time, so the rule
  // has to already answer for a pack that does not exist.
  assert.equal(resolvePackAudience("hazards-core", [hazard("Hidden Pit")]), "gm");
});

test("REQ-PF2-141/142: one creature or hazard among many documents is enough", () => {
  assert.equal(resolvePackAudience("mixed-pack", [feat("Assurance"), npc("Ghoul")]), "gm");
  assert.equal(resolvePackAudience("mixed-pack", [feat("Assurance"), hazard("Spear Trap")]), "gm");
});

test("REQ-PF2-143: a pack of rules the player needs stays 'all'", () => {
  for (const slug of ["feats-core", "spells-core", "equipment-core", "some-future-rules-pack"]) {
    assert.equal(resolvePackAudience(slug, [feat("Assurance")]), "all", slug);
  }
});

test("REQ-PF2-143: an empty pack is not GM-only by accident", () => {
  assert.equal(resolvePackAudience("empty-pack", []), "all");
});

test("REQ-PF2-141: a malformed document without a type never opens a creature pack", () => {
  assert.equal(
    resolvePackAudience("bestiary-core", [null, { name: "no type" }, npc("Ogre")]),
    "gm",
  );
});
