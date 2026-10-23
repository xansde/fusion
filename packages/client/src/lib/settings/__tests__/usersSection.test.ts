/**
 * usersSection.test.ts — pure render/write logic for the "Usuários" section
 * (spec 37 §5.6, G105, REQ-CFG-050..054).
 */

import { describe, expect, it } from "vitest";
import "../../i18n/index.js";
import { t } from "../../i18n/i18n.js";
import ptBR from "../../i18n/pt-BR.json" assert { type: "json" };
import type { AdminUser } from "../usersApi.js";
import {
  buildFieldPatch,
  CONFIRM_REMOVE_KEY,
  mergeConnectionStatus,
  userRoleLabelKey,
  USER_ROLE_OPTIONS,
} from "../usersSection.js";

function makeUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: "u1",
    name: "Alice",
    role: 1,
    color: "#ff0000",
    avatar: null,
    active: true,
    ...overrides,
  };
}

describe("USER_ROLE_OPTIONS — REQ-USR-005: the four real roles, never NONE", () => {
  it("is exactly [1,2,3,4]", () => {
    expect(USER_ROLE_OPTIONS).toEqual([1, 2, 3, 4]);
  });
});

describe("userRoleLabelKey", () => {
  it("maps every role to its FUSION.Role.* key", () => {
    expect(userRoleLabelKey(4)).toBe("FUSION.Role.GM");
    expect(userRoleLabelKey(3)).toBe("FUSION.Role.Assistant");
    expect(userRoleLabelKey(2)).toBe("FUSION.Role.Trusted");
    expect(userRoleLabelKey(1)).toBe("FUSION.Role.Player");
  });
});

describe("mergeConnectionStatus — REQ-CFG-050 / REQ-USR-031: connection state per line", () => {
  it("marks a user present in onlineUsers with online:true as online", () => {
    const rows = mergeConnectionStatus(
      [makeUser({ id: "u1" }), makeUser({ id: "u2", name: "Bob" })],
      [{ userId: "u1", userName: "Alice", color: "#ff0000", online: true }],
    );

    expect(rows.find((r) => r.id === "u1")?.online).toBe(true);
    expect(rows.find((r) => r.id === "u2")?.online).toBe(false);
  });

  it("a user marked online:false in presence still reads as offline", () => {
    const rows = mergeConnectionStatus(
      [makeUser({ id: "u1" })],
      [{ userId: "u1", userName: "Alice", color: "#ff0000", online: false }],
    );

    expect(rows[0]?.online).toBe(false);
  });

  it("a user absent from presence entirely defaults to offline, never an assumed online", () => {
    const rows = mergeConnectionStatus([makeUser({ id: "u1" })], []);
    expect(rows[0]?.online).toBe(false);
  });

  it("preserves every other field of the admin user unchanged", () => {
    const user = makeUser({ id: "u1", role: 3, color: "#123456", avatar: "a.png", active: false });
    const rows = mergeConnectionStatus([user], []);
    expect(rows[0]).toMatchObject(user);
  });
});

describe("buildFieldPatch — REQ-CFG-080: one field applied at a time, only when it changed", () => {
  it("returns a single-key patch when the field actually changed", () => {
    const user = makeUser({ name: "Alice" });
    expect(buildFieldPatch(user, "name", "Alicia")).toEqual({ name: "Alicia" });
  });

  it("returns null when the field is unchanged (a blur with no edit)", () => {
    const user = makeUser({ name: "Alice" });
    expect(buildFieldPatch(user, "name", "Alice")).toBeNull();
  });

  it("compares role/color/active by the actual field, independently of one another", () => {
    const user = makeUser({ role: 1, color: "#ff0000", active: true });
    expect(buildFieldPatch(user, "role", 2)).toEqual({ role: 2 });
    expect(buildFieldPatch(user, "role", 1)).toBeNull();
    expect(buildFieldPatch(user, "color", "#00ff00")).toEqual({ color: "#00ff00" });
    expect(buildFieldPatch(user, "active", false)).toEqual({ active: false });
  });

  it("compares avatar against the original's null, not against an empty string", () => {
    const user = makeUser({ avatar: null });
    expect(buildFieldPatch(user, "avatar", null)).toBeNull();
    expect(buildFieldPatch(user, "avatar", "path.png")).toEqual({ avatar: "path.png" });
  });
});

describe("REQ-CFG-054: desconectar/desativar share the SAME nominal confirmation", () => {
  it("the pt-BR template is the literal 'Tirar <nome> da mesa?' the spec quotes", () => {
    expect(ptBR[CONFIRM_REMOVE_KEY as keyof typeof ptBR]).toBe("Tirar {{name}} da mesa?");
  });

  it("interpolated through t(), it reads the exact nominal prompt", () => {
    expect(t(CONFIRM_REMOVE_KEY, { name: "Fulano" })).toBe("Tirar Fulano da mesa?");
  });
});
