/**
 * @fusion/system-sf2e — NpcSystemSchema conformance vs. the REAL committed
 * bestiary pack (audit M4.5-corretor, ISSUE MEDIA).
 *
 * Mirrors systems/pf2e/src/__tests__/schemas-actor.test.ts's "conformance —
 * real bestiary-core pack" suite verbatim (REQ-SF2-004: sf2e NPCs share the
 * same shape as pf2e, both produced by the same importer normalizer). Every
 * real NPC in systems/sf2e/packs/bestiary-core/documents.json previously
 * failed NpcSystemSchema.safeParse (perception required-but-absent,
 * allSaves/traits.size shape mismatch) despite the sf2e test suite being
 * entirely green — no test ever parsed the committed pack data itself. This
 * is a permanent, data-driven guard against the schema drifting away from
 * the importer's real output again.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NpcSystemSchema } from "../schemas/actor-npc.js";

describe("NpcSystemSchema conformance — real bestiary-core pack (sf2e)", () => {
  const packPath = fileURLToPath(
    new URL("../../packs/bestiary-core/documents.json", import.meta.url),
  );
  const pack = JSON.parse(readFileSync(packPath, "utf8")) as Array<{
    name: string;
    system: unknown;
  }>;

  it("the pack fixture itself is non-empty (guards against a silently-empty pack file)", () => {
    expect(pack.length).toBeGreaterThan(0);
  });

  it.each(pack.map((doc) => [doc.name, doc.system] as const))(
    "NPC %s from the real pack parses against NpcSystemSchema",
    (name, system) => {
      const result = NpcSystemSchema.safeParse(system);
      if (!result.success) {
        throw new Error(`${name} failed: ${JSON.stringify(result.error.issues)}`);
      }
      expect(result.success).toBe(true);
    },
  );
});
