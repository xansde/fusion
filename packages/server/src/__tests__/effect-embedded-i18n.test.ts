/**
 * effect-embedded-i18n.test.ts — the effect the SERVER embeds on an actor (Mount, `effect:apply` Support) carries the
 * pt-BR label snapshot (`flags.fusion.i18n["pt-BR"]`), the same way `importToActor` stamps it (REQ-CMP-055).
 *
 * Without it the sheet lists "Effect: Mounted" / "Effect: Antelope Support" in English: the embedded copy has no link
 * back to the pack overlay and the sheet reads only the snapshot (L3 re-run, D8). Reads the REAL shipped pack.
 */

import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CompendiumService } from "../compendium/index.js";
import { buildEmbeddedEffect } from "../net/handlers/effect-handlers.js";
import type { EffectApplyPayload } from "@fusion/shared";

const PACKS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../external/fusion-systems-2e/systems/pf2e/packs",
);
const GM = 4;

function embeddedFrom(docId: string): Record<string, unknown> {
  const svc = new CompendiumService();
  svc.discoverPacks(PACKS, "pf2e");
  const effect = svc.getDocument(GM, `Compendium.pf2e.effects-ranger-homebrew.Item.${docId}`);
  expect(effect, docId).not.toBeNull();
  const payload = { sourceActorId: "src" } as unknown as EffectApplyPayload;
  return buildEmbeddedEffect(
    effect as Record<string, unknown>,
    payload,
    { combatId: null, round: null },
    undefined,
  ).item;
}

function label(item: Record<string, unknown>): unknown {
  const fusion = (item["flags"] as { fusion?: { i18n?: Record<string, unknown> } } | undefined)
    ?.fusion;
  return (fusion?.i18n?.["pt-BR"] as { name?: string } | undefined)?.name;
}

describe("embedded effects carry the pt-BR snapshot (L3 D8)", () => {
  it.each([
    ["HbEfMountedStat1", "Montado"],
    ["effect-support-antelope", "Apoio do antílope"],
    ["effect-support-bear", "Apoio do urso"],
  ])("%s -> %s", (docId, ptName) => {
    expect(label(embeddedFrom(docId))).toBe(ptName);
  });

  it("the name stays EN (identity of the embedded copy)", () => {
    const item = embeddedFrom("HbEfMountedStat1");
    expect(item["name"]).toBe("Effect: Mounted");
  });
});
