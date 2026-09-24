/**
 * system-vocabulary.test.ts — the door a ficha's per-system config (skills,
 * currency, spell traditions) comes through (I1, revisão adversarial 3,
 * spec 15). Same shape as system-footprint.test.ts.
 *
 * Before this door existed, `sheets/pf2e/src/lib/sheets/pf2e/
 * systemSheetConfig.ts` hard-copied the skill/currency tables per systemId
 * by hand — this test proves the server-side handler that replaces that
 * copy hands the client exactly what the manifest declared, unchanged.
 */

import { describe, expect, it } from "vitest";

import {
  buildSystemVocabularyHandler,
  type VocabularyManifestSource,
  type SystemVocabulary,
} from "../net/handlers/system.js";
import type { HandlerContext } from "../net/handler-registry.js";
import { UserRole } from "../documents/ownership.js";

function ctx(role: number): HandlerContext {
  return { userId: "user-1", role, worldId: "world-1" };
}

function systemWith(vocabulary?: SystemVocabulary) {
  return { manifest: { id: "pf2e", vocabulary } };
}

function vocabularyOf(source: VocabularyManifestSource | undefined, role = UserRole.PLAYER) {
  const ack = buildSystemVocabularyHandler(source)({}, ctx(role));
  if (!("ok" in ack) || !ack.ok) throw new Error("handler refused");
  return ack.result;
}

describe("system:vocabulary (I1)", () => {
  it("hands the client the manifest's vocabulary intact", () => {
    const vocabulary: SystemVocabulary = {
      skills: [
        { slug: "acrobatics", ability: "dex" },
        { slug: "computers", ability: "int" },
      ],
      currency: ["pp", "gp", "sp", "cp"],
      spellTraditions: ["arcane", "divine", "occult", "primal"],
    };

    const result = vocabularyOf(systemWith(vocabulary));

    expect(result.systemId).toBe("pf2e");
    expect(result.vocabulary).toEqual(vocabulary);
  });

  it("answers vocabulary: null when the system declares none, never an error", () => {
    const result = vocabularyOf(systemWith(undefined));

    expect(result).toEqual({ systemId: "pf2e", vocabulary: null });
  });

  it("answers vocabulary: null when the world has no system at all, never an error", () => {
    const result = vocabularyOf(undefined);

    expect(result).toEqual({ systemId: null, vocabulary: null });
  });

  it("is the same for every seat — a player receives what the Mestre receives", () => {
    const vocabulary: SystemVocabulary = {
      skills: [{ slug: "stealth", ability: "dex" }],
      currency: ["credits"],
      spellTraditions: ["arcane"],
    };
    const source = systemWith(vocabulary);

    expect(vocabularyOf(source, UserRole.PLAYER)).toEqual(
      vocabularyOf(source, UserRole.GAMEMASTER),
    );
  });
});
