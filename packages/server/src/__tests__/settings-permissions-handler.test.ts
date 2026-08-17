/**
 * settings-permissions-handler.test.ts — G104 (Fase 9 — Aba Configurações),
 * Seção Permissões: the door a configurable Permission's effective floor
 * crosses to reach the tab (spec 37 §5.5, REQ-USR-008/009, REQ-CFG-040..042).
 *
 * These assertions are about the PAYLOAD `buildSettingsPermissionsHandler`
 * answers with, not a screen — mirrors `settings-declarations.test.ts`'s
 * shape for the Mundo section. The actual write-side enforcement (a GM
 * lowering/raising a floor and the gate honouring it, REQ-CFG-042/073) is
 * exercised end-to-end over a real socket in `world-permissions.test.ts` —
 * this file only proves the READ side: one row per `PERMISSION_KEYS` entry,
 * carrying both the effective floor and the shipped default (REQ-CFG-041).
 */

import { describe, expect, it } from "vitest";

import {
  buildSettingsPermissionsHandler,
  type SettingsPermissionsResult,
} from "../net/handlers/settings-handlers.js";
import type { HandlerContext } from "../net/handler-registry.js";
import { UserRole } from "../documents/ownership.js";
import {
  PERMISSIONS_SETTING_KEY,
  type PermissionsStoreSource,
} from "../documents/world-permissions.js";

function fakeStore(docs: { _id: string; key: string; value: unknown }[]): PermissionsStoreSource {
  return {
    getAll: () => docs.map((d) => ({ _id: d._id, key: d.key, value: d.value })),
  };
}

const EMPTY_STORE: PermissionsStoreSource = { getAll: () => [] };

function ctx(role: number): HandlerContext {
  return { userId: "user-1", role, worldId: "world-1" };
}

function ask(
  store?: PermissionsStoreSource,
  role = UserRole.GAMEMASTER,
): SettingsPermissionsResult {
  const ack = buildSettingsPermissionsHandler(store)({}, ctx(role));
  if (!("ok" in ack) || !ack.ok) throw new Error("handler refused");
  return ack.result;
}

describe("settings:permissions — REQ-CFG-040: one row per configurable Permission", () => {
  it("with no fusion.permissions Setting written yet, every row reports its default as the effective floor", () => {
    const result = ask(EMPTY_STORE);
    const byKey = new Map(result.permissions.map((p) => [p.key, p]));

    expect(result.settingId).toBeNull();
    expect(byKey.get("JOURNAL_CREATE")).toEqual({
      key: "JOURNAL_CREATE",
      minRole: UserRole.TRUSTED,
      defaultMinRole: UserRole.TRUSTED,
    });
    expect(byKey.get("ACTOR_CREATE")).toEqual({
      key: "ACTOR_CREATE",
      minRole: UserRole.ASSISTANT_GM,
      defaultMinRole: UserRole.ASSISTANT_GM,
    });
  });

  it("REQ-CFG-040: lists all 19 Permission Keys from REQ-USR-008 — nothing hardcoded, nothing dropped", () => {
    expect(
      ask(EMPTY_STORE)
        .permissions.map((p) => p.key)
        .sort(),
    ).toEqual(
      [
        "ACTOR_CREATE",
        "DRAWING_CREATE",
        "FILES_BROWSE",
        "FILES_UPLOAD",
        "ITEM_CREATE",
        "JOURNAL_CREATE",
        "MACRO_SCRIPT",
        "MANUAL_ROLLS",
        "MESSAGE_WHISPER",
        "NOTE_CREATE",
        "PING_CANVAS",
        "PLAYLIST_CREATE",
        "SHOW_CURSOR",
        "SHOW_RULER",
        "TABLE_CREATE",
        "TOKEN_CONFIGURE",
        "TOKEN_CREATE",
        "TOKEN_DELETE",
        "WALL_DOORS",
      ].sort(),
    );
  });

  it("REQ-CFG-041: a GM override makes minRole diverge from defaultMinRole for exactly that row, none other", () => {
    const store = fakeStore([
      { _id: "setting-perms-1", key: PERMISSIONS_SETTING_KEY, value: { JOURNAL_CREATE: 1 } },
    ]);
    const result = ask(store);
    const byKey = new Map(result.permissions.map((p) => [p.key, p]));

    expect(result.settingId).toBe("setting-perms-1");
    expect(byKey.get("JOURNAL_CREATE")).toEqual({
      key: "JOURNAL_CREATE",
      minRole: 1,
      defaultMinRole: UserRole.TRUSTED,
    });
    // Untouched row: still identical to its default.
    expect(byKey.get("ITEM_CREATE")).toEqual({
      key: "ITEM_CREATE",
      minRole: UserRole.ASSISTANT_GM,
      defaultMinRole: UserRole.ASSISTANT_GM,
    });
  });

  it("an out-of-range override falls back to the default instead of reporting a bogus floor (REQ-CFG-073's spirit on the read side)", () => {
    const store = fakeStore([
      { _id: "setting-perms-1", key: PERMISSIONS_SETTING_KEY, value: { ITEM_CREATE: 99 } },
    ]);
    const entry = ask(store).permissions.find((p) => p.key === "ITEM_CREATE");

    expect(entry?.minRole).toBe(UserRole.ASSISTANT_GM);
  });
});

describe("settings:permissions — GAMEMASTER-strict gate (REQ-GAV-034, DEC-CFG-05)", () => {
  it("a PLAYER is refused with PERMISSION_DENIED, never handed the permission floors", () => {
    const ack = buildSettingsPermissionsHandler(EMPTY_STORE)({}, ctx(UserRole.PLAYER));
    expect(ack).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
  });

  it("ASSISTANT_GM (role 3) is refused too — DEC-CFG-05 says GAMEMASTER, not the generic privileged threshold", () => {
    const ack = buildSettingsPermissionsHandler(EMPTY_STORE)({}, ctx(UserRole.ASSISTANT_GM));
    expect(ack).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
  });

  it("the GAMEMASTER is admitted and receives the rows", () => {
    expect(ask(EMPTY_STORE, UserRole.GAMEMASTER).permissions.length).toBeGreaterThan(0);
  });
});
