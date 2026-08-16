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
});
