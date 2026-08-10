/**
 * `displayBars` must survive server-side validation — on the CREATE path and
 * on the UPDATE path, which are two different schemas.
 *
 * This is the same ratchet as sceneGridSurvives.test.ts, for the same reason.
 * The two paths are asymmetric and only one of them is obviously dangerous:
 *
 *   - CREATE: doc-handlers.ts validates each new embedded token with the
 *     STRICT `TokenDocumentSchema` from @fusion/shared. Zod strips every key
 *     the schema does not declare, so a field added to the client without a
 *     line in that schema is dropped at birth.
 *   - UPDATE: the token lives inside `SceneSchema.tokens`, typed loosely as
 *     `z.array(z.record(...))`, so today it passes anything through. That
 *     looseness is not a guarantee — the day someone tightens `tokens` to the
 *     real token schema (the obvious, correct-looking refactor), an undeclared
 *     field starts disappearing on every save instead.
 *
 * `grid` vanished from every scene for rounds because nobody had this test
 * (docs/lessons.md). REQ-CNV-089.
 */

import { describe, it, expect } from "vitest";
import { TokenDocumentSchema } from "@fusion/shared";
import { SceneSchema } from "../types.js";

const BASE_SCENE = {
  _id: "scene0000000002x",
  name: "Sala do trono",
  width: 2000,
  height: 2000,
  _stats: {
    createdTime: 1,
    modifiedTime: 1,
    version: 1,
    lastModifiedBy: null,
    createdBy: null,
    coreVersion: "0.1.0",
    systemId: null,
    systemVersion: null,
    engineSchemaVersion: 0,
    systemSchemaVersion: null,
  },
};

const TOKEN_ID = "tokenAAAAAAAAAA1";

describe("displayBars round-trip (REQ-CNV-089)", () => {
  it("survives the CREATE path — the strict TokenDocumentSchema", () => {
    const parsed = TokenDocumentSchema.parse({
      _id: TOKEN_ID,
      name: "Fofurinha",
      bar1: { attribute: "attributes.hp" },
      displayBars: "hoverAll",
    }) as Record<string, unknown>;

    expect(parsed["displayBars"]).toBe("hoverAll");
  });

  it("defaults to observer when the client does not send it (REQ-CNV-089)", () => {
    const parsed = TokenDocumentSchema.parse({ _id: TOKEN_ID }) as Record<string, unknown>;
    expect(parsed["displayBars"]).toBe("observer");
  });

  it("survives the UPDATE path — the whole scene round-trip", () => {
    const token = TokenDocumentSchema.parse({
      _id: TOKEN_ID,
      name: "Fofurinha",
      bar1: { attribute: "attributes.hp" },
      displayBars: "never",
    });

    const parsed = SceneSchema.parse({ ...BASE_SCENE, tokens: [token] }) as Record<string, unknown>;

    const tokens = parsed["tokens"] as Record<string, unknown>[];
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.["displayBars"]).toBe("never");
    // The neighbours must not be collateral damage of however displayBars is
    // declared — a bar with no attribute is still a bar the GM configured.
    expect(tokens[0]?.["bar1"]).toEqual({ attribute: "attributes.hp" });
  });

  it("rejects a level outside the five canonical ones (DEC-CNV-15)", () => {
    const result = TokenDocumentSchema.safeParse({ _id: TOKEN_ID, displayBars: "owner" });
    expect(result.success).toBe(false);
  });
});
