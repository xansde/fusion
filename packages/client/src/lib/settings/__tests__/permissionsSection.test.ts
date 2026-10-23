/**
 * permissionsSection.test.ts — G104 (Fase 9 — Aba Configurações), Seção
 * Permissões: pure render/write logic (spec 37 §5.5, REQ-USR-008/009,
 * REQ-CFG-040..042).
 */

import { describe, expect, it } from "vitest";

import {
  buildPermissionWriteOp,
  isPermissionChanged,
  permissionLabelKey,
  PERMISSION_ROLE_OPTIONS,
  type PermissionRow,
} from "../permissionsSection.js";

const DEFAULT_ROW: PermissionRow = {
  key: "JOURNAL_CREATE",
  minRole: 2,
  defaultMinRole: 2,
};

describe("PERMISSION_ROLE_OPTIONS — REQ-CFG-040/REQ-USR-005: a selector, never a matrix", () => {
  it("offers exactly the four real roles, in ascending order, never NONE", () => {
    expect(PERMISSION_ROLE_OPTIONS).toEqual([1, 2, 3, 4]);
  });
});

describe("permissionLabelKey", () => {
  it("namespaces every permission key under FUSION.Settings.Permissions.Keys", () => {
    expect(permissionLabelKey("ACTOR_CREATE")).toBe(
      "FUSION.Settings.Permissions.Keys.ACTOR_CREATE",
    );
    expect(permissionLabelKey("TOKEN_CREATE")).toBe(
      "FUSION.Settings.Permissions.Keys.TOKEN_CREATE",
    );
  });
});

describe("isPermissionChanged — REQ-CFG-041: a row is 'alterada' exactly when it differs from the default", () => {
  it("a row still at its default is not marked changed", () => {
    expect(isPermissionChanged(DEFAULT_ROW)).toBe(false);
  });

  it("a row whose effective floor was lowered below the default is marked changed", () => {
    expect(isPermissionChanged({ ...DEFAULT_ROW, minRole: 1 })).toBe(true);
  });

  it("a row whose effective floor was raised above the default is marked changed", () => {
    expect(isPermissionChanged({ ...DEFAULT_ROW, minRole: 4 })).toBe(true);
  });
});

describe("buildPermissionWriteOp — REQ-CFG-042/071: writes go through Setting, doc:create/doc:update", () => {
  it("no fusion.permissions Setting written yet (settingId === null) creates one", () => {
    const op = buildPermissionWriteOp(null, "JOURNAL_CREATE", 1);

    expect(op).toEqual({
      type: "doc:create",
      payload: {
        documentType: "Setting",
        data: [{ key: "fusion.permissions", value: { JOURNAL_CREATE: 1 } }],
      },
    });
  });

  it("an existing fusion.permissions Setting is updated in place by _id", () => {
    const op = buildPermissionWriteOp("setting-perms-1", "ITEM_CREATE", 2);

    expect(op).toEqual({
      type: "doc:update",
      payload: {
        documentType: "Setting",
        updates: [{ _id: "setting-perms-1", diff: { value: { ITEM_CREATE: 2 } } }],
      },
    });
  });

  it("the diff carries ONLY the one key that changed — DocumentStore's deep merge (documents/store.ts) is what preserves every other row's override, this file never resends them", () => {
    const op = buildPermissionWriteOp("setting-perms-1", "TOKEN_CREATE", 1);
    const diff = (op.payload["updates"] as Array<{ diff: { value: Record<string, number> } }>)[0]!
      .diff.value;

    expect(Object.keys(diff)).toEqual(["TOKEN_CREATE"]);
  });
});
