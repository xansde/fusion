/**
 * worldSettingsSection.test.ts — G102 (Fase 9 — Aba Configurações), Seção
 * Mundo: pure render/write logic (spec 37 §5.4).
 *
 * `controlForRow` and `buildSettingWriteOp` never branch on a setting's
 * `key` or on any system id — only on `row.kind`/`row.id`. What this file
 * proves is exactly that: a row from a system these functions have NEVER
 * seen before (`"fake-system"`, never `pf2e`) renders and writes correctly,
 * with zero lines changed in `worldSettingsSection.ts` to make it happen
 * (RNF-CFG-02) — and the tab's code carries no knowledge of what that
 * setting even is (REQ-CFG-031).
 */

import { describe, expect, it } from "vitest";

import {
  buildSettingWriteOp,
  controlForRow,
  needsDisableConfirm,
  type WorldSettingRow,
} from "../worldSettingsSection.js";

// ---------------------------------------------------------------------------
// A fake system's brand-new declaration — never referenced by name anywhere
// in worldSettingsSection.ts.
// ---------------------------------------------------------------------------

const NEW_TOGGLE: WorldSettingRow = {
  id: null,
  key: "fake-system:neverSeenBeforeToggle",
  kind: "boolean",
  label: "Nunca visto antes",
  value: false,
};

const NEW_ENUM: WorldSettingRow = {
  id: "setting-enum-1",
  key: "fake-system:verbosityLevel",
  kind: "enum",
  options: ["quiet", "loud"],
  label: "Verbosidade",
  value: "quiet",
};

const NEW_NUMBER: WorldSettingRow = {
  id: "setting-number-1",
  key: "fake-system:maxRetries",
  kind: "number",
  label: "Máximo de tentativas",
  value: 3,
};

describe("controlForRow — REQ-CFG-030: boolean → alternador, enum → seleção, número → campo", () => {
  it("a boolean row from an unseen system draws a toggle at its current value", () => {
    expect(controlForRow(NEW_TOGGLE)).toEqual({ kind: "boolean", checked: false });
    expect(controlForRow({ ...NEW_TOGGLE, value: true })).toEqual({
      kind: "boolean",
      checked: true,
    });
  });

  it("an enum row from an unseen system draws a selection with its declared options", () => {
    expect(controlForRow(NEW_ENUM)).toEqual({
      kind: "enum",
      value: "quiet",
      options: ["quiet", "loud"],
    });
  });

  it("a number row from an unseen system draws a numeric field", () => {
    expect(controlForRow(NEW_NUMBER)).toEqual({ kind: "number", value: 3 });
  });

  it("REQ-CFG-031/RNF-CFG-02: nothing here reads row.key — only row.kind decides the control", () => {
    // Same kind, wildly different key/label — must still produce the exact same
    // control shape. If this function ever grew a per-key branch, one of these
    // two would start to differ.
    const anyBooleanA: WorldSettingRow = {
      id: null,
      key: "system-a:whateverSettingOne",
      kind: "boolean",
      label: "Qualquer coisa",
      value: true,
    };
    const anyBooleanB: WorldSettingRow = {
      id: "id-2",
      key: "totally-different-system:anotherSetting",
      kind: "boolean",
      label: "Outra coisa",
      value: true,
    };

    expect(controlForRow(anyBooleanA)).toEqual(controlForRow(anyBooleanB));
  });

  it("a missing/malformed value falls back to a safe default per kind instead of throwing", () => {
    expect(controlForRow({ ...NEW_ENUM, value: undefined }).kind === "enum").toBe(true);
    expect(controlForRow({ ...NEW_NUMBER, value: "not-a-number" })).toEqual({
      kind: "number",
      value: 0,
    });
  });
});

describe("buildSettingWriteOp — REQ-CFG-071: writes go through Setting, doc:create/doc:update", () => {
  it("a row never written before (id === null) creates a Setting document", () => {
    const op = buildSettingWriteOp(NEW_TOGGLE, true);

    expect(op).toEqual({
      type: "doc:create",
      payload: {
        documentType: "Setting",
        data: [{ key: "fake-system:neverSeenBeforeToggle", value: true }],
      },
    });
  });

  it("a row with an existing Setting document updates it in place by _id", () => {
    const op = buildSettingWriteOp(NEW_ENUM, "loud");

    expect(op).toEqual({
      type: "doc:update",
      payload: {
        documentType: "Setting",
        updates: [{ _id: "setting-enum-1", diff: { value: "loud" } }],
      },
    });
  });

  it("REQ-CFG-035: a setting write is an ordinary Setting doc:update — it rides the same broadcast/sync path every document write does, so re-derivation/propagation needs nothing bespoke here", () => {
    // Nothing distinguishes a variant-rule row's write from any other boolean
    // row's write — same op shape, same generic path (worldSettingsRegistry
    // folds the ack back in; broadcastToWorld/worldMirror propagate it, same
    // as every other doc:update in the app).
    const op = buildSettingWriteOp({ ...NEW_TOGGLE, id: "setting-abc" }, false);
    expect(op.type).toBe("doc:update");
    expect(op.payload["documentType"]).toBe("Setting");
  });
});

// ---------------------------------------------------------------------------
// needsDisableConfirm — REQ-CFG-032/082, DEC-CFG-09: "ligar nunca confirma";
// desligar confirma SÓ quando o sistema declarou requiresConfirmOnDisable.
//
// The two rows below are shaped exactly like PF2e's free-archetype/multiclass
// variant rules would be declared (REQ-CFG-032, REQ-MCL-001/004) — including
// the "pf2e:" namespace prefix — but `needsDisableConfirm` never reads `key`,
// so this file still carries zero PF2e-specific knowledge (REQ-CFG-031): a
// row from ANY system with the same shape decides identically (last test).
// ---------------------------------------------------------------------------

const FREE_ARCHETYPE_ON: WorldSettingRow = {
  id: "setting-fa-1",
  key: "pf2e:freeArchetype",
  kind: "boolean",
  label: "Arquétipo Livre",
  requiresConfirmOnDisable: true,
  value: true,
};

describe("needsDisableConfirm — REQ-CFG-082: desligar confirma, ligar nunca confirma", () => {
  it("turning a requiresConfirmOnDisable row OFF (true -> false) needs confirmation", () => {
    expect(needsDisableConfirm(FREE_ARCHETYPE_ON, false)).toBe(true);
  });

  it("REQ-CFG-082/DEC-CFG-09: turning the SAME row ON never needs confirmation, even starting from off", () => {
    const off: WorldSettingRow = { ...FREE_ARCHETYPE_ON, value: false };
    expect(needsDisableConfirm(off, true)).toBe(false);
  });

  it("a boolean row without requiresConfirmOnDisable never confirms on disable", () => {
    const { requiresConfirmOnDisable: _drop, ...rest } = FREE_ARCHETYPE_ON;
    const plain: WorldSettingRow = rest;
    expect(needsDisableConfirm(plain, false)).toBe(false);
  });

  it("a requiresConfirmOnDisable row that is ALREADY off does not confirm a false->false write (no actual disable happening)", () => {
    const off: WorldSettingRow = { ...FREE_ARCHETYPE_ON, value: false };
    expect(needsDisableConfirm(off, false)).toBe(false);
  });

  it("requiresConfirmOnDisable is meaningless outside a boolean row — enum/number rows never confirm", () => {
    expect(needsDisableConfirm({ ...NEW_ENUM, requiresConfirmOnDisable: true }, "quiet")).toBe(
      false,
    );
    expect(needsDisableConfirm({ ...NEW_NUMBER, requiresConfirmOnDisable: true }, 0)).toBe(false);
  });

  it("REQ-CFG-031: identical shape from an unrelated system's key decides identically — nothing here branches on `key`", () => {
    const fromAnotherSystem: WorldSettingRow = {
      ...FREE_ARCHETYPE_ON,
      key: "totally-different-system:someOtherToggle",
      label: "Qualquer coisa",
    };
    expect(needsDisableConfirm(fromAnotherSystem, false)).toBe(
      needsDisableConfirm(FREE_ARCHETYPE_ON, false),
    );
  });
});
