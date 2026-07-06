/**
 * petsWire.test.ts — wire-contract tests for the Pets tab ops (r16-G4 fix,
 * verificação viva r16).
 *
 * Lesson r9: a wire test must validate against the REAL server schema, not a
 * hand-rolled shape. The pets bug ("Expected array, received object" when
 * creating a familiar) slipped through because the VM builders emit a flat,
 * ergonomic op shape (`{ type, documentType, data: {...} }`) that PetsTab sent
 * VERBATIM — bypassing the normalization every other sheet gets via
 * `makeSendOpFn`. These tests pin the contract: `toEnvelope(op).payload` must
 * pass the actual `DocCreate/Update/DeletePayloadSchema` from @fusion/shared.
 */

import { describe, it, expect } from "vitest";
import {
  DocCreatePayloadSchema,
  DocUpdatePayloadSchema,
  DocDeletePayloadSchema,
} from "@fusion/shared";
import { toEnvelope } from "../../../docs/sendOp.js";
import {
  buildCreateFamiliarOp,
  buildSetHpOp,
  buildRenameOp,
  buildSetAppearanceOp,
  buildToggleAbilityOp,
  buildDeleteOp,
  buildMasterRefreshOp,
  type LinkedFamiliar,
} from "../petsVM.js";

function tobias(): Record<string, unknown> {
  return {
    _id: "tob0123456789abc",
    name: "Tobias",
    type: "character",
    ownership: { default: 0, u1: 3 },
    system: {
      level: { value: 3 },
      details: { keyAbility: "int" },
      derived: {
        abilityMods: { int: 4 },
        ac: { total: 19 },
        saves: { fortitude: { total: 8 }, reflex: { total: 10 }, will: { total: 7 } },
        perception: { total: 9 },
      },
    },
    items: [
      {
        _id: "featrat000000001",
        type: "feat",
        name: "Rat Familiar",
        system: {
          rules: [
            {
              selector: "system.attributes.familiarAbilities.value",
              value: 2,
              mode: "upgrade",
            },
          ],
        },
      },
    ],
  };
}

function pickpocket(): LinkedFamiliar {
  return {
    id: "fam0000000000001",
    name: "Pickpocket",
    companionKind: "familiar",
    appearance: "a scruffy black rat",
    hp: { value: 15, max: 15 },
    ac: 19,
    perception: 9,
    saves: { fortitude: 8, reflex: 10, will: 7 },
    attack: 7,
    speed: 25,
    otherSpeeds: [],
    abilitiesBudget: { value: 1, max: 4 },
    selectedAbilities: ["darkvision"],
    orphaned: false,
  };
}

describe("pets wire contract (toEnvelope × real @fusion/shared schemas)", () => {
  it("create familiar → DocCreatePayloadSchema (data is an ARRAY, no `type` field)", () => {
    const op = buildCreateFamiliarOp({
      masterId: "tob0123456789abc",
      masterDoc: tobias(),
      name: "Bigode",
    });
    const env = toEnvelope(op);
    expect(env.type).toBe("doc:create");
    // The bug: the flat op sends `data` as an object; the schema requires an array.
    expect(Array.isArray((env.payload as { data: unknown }).data)).toBe(true);
    // The payload must NOT carry the redundant `type` discriminator.
    expect("type" in env.payload).toBe(false);
    const parsed = DocCreatePayloadSchema.safeParse(env.payload);
    expect(parsed.success).toBe(true);
    // The created familiar doc is the single element of the array.
    const data = (env.payload as { data: unknown[] }).data;
    expect(data).toHaveLength(1);
    expect((data[0] as { type: string }).type).toBe("familiar");
  });

  it("set HP → DocUpdatePayloadSchema (updates:[{_id,diff}])", () => {
    const env = toEnvelope(buildSetHpOp(pickpocket(), 8));
    const parsed = DocUpdatePayloadSchema.safeParse(env.payload);
    expect(parsed.success).toBe(true);
    const updates = (env.payload as { updates: Array<{ _id: string }> }).updates;
    expect(updates[0]!._id).toBe("fam0000000000001");
  });

  it("rename → DocUpdatePayloadSchema", () => {
    const env = toEnvelope(buildRenameOp(pickpocket(), "Whiskers"));
    expect(DocUpdatePayloadSchema.safeParse(env.payload).success).toBe(true);
  });

  it("set appearance → DocUpdatePayloadSchema", () => {
    const env = toEnvelope(buildSetAppearanceOp(pickpocket(), "sleek grey rat"));
    expect(DocUpdatePayloadSchema.safeParse(env.payload).success).toBe(true);
  });

  it("toggle ability → DocUpdatePayloadSchema", () => {
    const op = buildToggleAbilityOp(pickpocket(), "climber");
    expect(op).not.toBeNull();
    const env = toEnvelope(op!);
    expect(DocUpdatePayloadSchema.safeParse(env.payload).success).toBe(true);
  });

  it("master refresh → DocUpdatePayloadSchema (when drift detected)", () => {
    // pickpocket has AC 19 already; give it a stale AC so the refresh op fires.
    const stale = { ...pickpocket(), ac: 1 };
    const op = buildMasterRefreshOp(stale, "tob0123456789abc", tobias());
    expect(op).not.toBeNull();
    const env = toEnvelope(op!);
    expect(DocUpdatePayloadSchema.safeParse(env.payload).success).toBe(true);
  });

  it("delete → DocDeletePayloadSchema (ids:[...])", () => {
    const env = toEnvelope(buildDeleteOp(pickpocket()));
    const parsed = DocDeletePayloadSchema.safeParse(env.payload);
    expect(parsed.success).toBe(true);
    expect((env.payload as { ids: string[] }).ids).toEqual(["fam0000000000001"]);
  });
});
