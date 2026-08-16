/**
 * PermissionsSection.test.ts — G104 (Fase 9 — Aba Configurações), Seção
 * Permissões (spec 37 §5.5, REQ-USR-008/009, REQ-CFG-040..042).
 *
 * Server-rendered snapshots via `svelte/server`'s `render()` — same
 * constraint as `WorldSection`'s and `PreferencesSection`'s tests: no client
 * runtime is attached, so no click/change events fire here. What this file
 * proves is markup shape: one row per permission (REQ-CFG-040, never a
 * matrix), the "alterado" mark exactly on rows that differ from their
 * default (REQ-CFG-041), and a role selector per row.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { render } from "svelte/server";

import PermissionsSection from "../PermissionsSection.svelte";
import {
  resetPermissionsRegistry,
  seedPermissionsRegistry,
} from "../../../lib/settings/permissionsRegistry.svelte.js";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

beforeEach(() => {
  resetPermissionsRegistry();
});

function renderSection(): string {
  const { body } = render(PermissionsSection, { props: { socket: {} as never } });
  return body;
}

describe("PermissionsSection — REQ-CFG-040: uma linha por permissão, nunca matriz", () => {
  it("a permission not yet overridden renders with no 'changed' mark and a select", () => {
    seedPermissionsRegistry({
      settingId: null,
      permissions: [{ key: "JOURNAL_CREATE", minRole: 2, defaultMinRole: 2 }],
    });

    const html = renderSection();

    expect(html).toContain(t("FUSION.Settings.Permissions.Keys.JOURNAL_CREATE"));
    expect(html).toContain("<select");
    expect(html).not.toContain(t("FUSION.Settings.Permissions.Changed"));
  });

  it("REQ-CFG-041: a permission whose floor was lowered below the default carries the 'alterado' mark", () => {
    seedPermissionsRegistry({
      settingId: "setting-perms-1",
      permissions: [{ key: "JOURNAL_CREATE", minRole: 1, defaultMinRole: 2 }],
    });

    const html = renderSection();

    expect(html).toContain(t("FUSION.Settings.Permissions.Changed"));
  });

  it("REQ-CFG-040: never a bidimensional matrix — no <table> anywhere in this markup", () => {
    seedPermissionsRegistry({
      settingId: null,
      permissions: [
        { key: "JOURNAL_CREATE", minRole: 2, defaultMinRole: 2 },
        { key: "TOKEN_CREATE", minRole: 2, defaultMinRole: 2 },
        { key: "ACTOR_CREATE", minRole: 3, defaultMinRole: 3 },
      ],
    });

    const html = renderSection();

    expect(html).not.toContain("<table");
    // Three rows, each its own <li>, all inside the same list.
    expect((html.match(/class="permissions-section__row[^"]*"/g) ?? []).length).toBe(3);
  });

  it("every row's selector offers the four real roles (REQ-USR-005)", () => {
    seedPermissionsRegistry({
      settingId: null,
      permissions: [{ key: "ACTOR_CREATE", minRole: 3, defaultMinRole: 3 }],
    });

    const html = renderSection();

    expect(html).toContain(t("FUSION.Role.Player"));
    expect(html).toContain(t("FUSION.Role.Trusted"));
    expect(html).toContain(t("FUSION.Role.Assistant"));
    expect(html).toContain(t("FUSION.Role.GM"));
  });

  it("the selector for a row is pre-selected at its EFFECTIVE role, not its default", () => {
    seedPermissionsRegistry({
      settingId: "setting-perms-1",
      permissions: [{ key: "ITEM_CREATE", minRole: 2, defaultMinRole: 3 }],
    });

    const html = renderSection();
    const selectMatch = /<select[^>]*>([\s\S]*?)<\/select>/.exec(html);
    expect(selectMatch).not.toBeNull();
    expect(selectMatch?.[1]).toContain('value="2" selected');
  });

  it("REQ-CFG-030-style honest empty state: no configurable permission renders the empty message", () => {
    seedPermissionsRegistry({ settingId: null, permissions: [] });

    const html = renderSection();

    expect(html).toContain(t("FUSION.Settings.Permissions.Empty"));
  });
});
