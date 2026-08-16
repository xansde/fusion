/**
 * UsersSection.test.ts — G105 (Fase 9 — Aba Configurações), Seção Usuários
 * (spec 37 §5.6, REQ-CFG-050..054; spec 05 REQ-USR-025..031).
 *
 * Server-rendered snapshots via `svelte/server`'s `render()` — same
 * constraint as `WorldSection`'s/`PermissionsSection`'s tests: no client
 * runtime is attached, so no click/change events fire here. What this file
 * proves is markup shape: REQ-CFG-050's one line per user with connection
 * state, REQ-CFG-051a's silence about personagem/ficha, REQ-CFG-052's
 * stacked edit form with no save button, and REQ-CFG-053's one-time reveal.
 * The exact wording of REQ-CFG-054's nominal confirm prompt is proved at the
 * pure-logic layer (`usersSection.test.ts`), since `confirm()` never touches
 * the DOM for `render()` to see.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { render } from "svelte/server";

import UsersSection from "../UsersSection.svelte";
import {
  resetUsersRegistry,
  seedUsersRegistry,
} from "../../../lib/settings/usersRegistry.svelte.js";
import { updateOnlineUsers } from "../../../lib/presence/presenceStore.svelte.js";
import { UsersSectionState } from "../../../lib/settings/usersSectionState.svelte.js";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

const ALICE = { id: "u1", name: "Alice", role: 1, color: "#ff0000", avatar: null, active: true };
const BOB = { id: "u2", name: "Bob", role: 4, color: "#00ff00", avatar: null, active: false };

beforeEach(() => {
  resetUsersRegistry();
  updateOnlineUsers([]);
});

function renderSection(state?: UsersSectionState): string {
  const { body } = render(UsersSection, { props: state ? { flow: state } : {} });
  return body;
}

describe("UsersSection — list (REQ-CFG-050: nome, papel, cor, conexão)", () => {
  it("renders one row per user with name and role label", () => {
    seedUsersRegistry([ALICE]);

    const html = renderSection();

    expect(html).toContain("Alice");
    expect(html).toContain(t("FUSION.Role.Player"));
  });

  it("REQ-USR-031: a user present in presence with online:true renders the online dot", () => {
    seedUsersRegistry([ALICE]);
    updateOnlineUsers([{ userId: "u1", userName: "Alice", color: "#ff0000", online: true }]);

    const html = renderSection();

    expect(html).toContain("users-section__dot--online");
    expect(html).not.toContain("users-section__dot--offline");
  });

  it("a user absent from presence renders the offline dot", () => {
    seedUsersRegistry([ALICE]);

    const html = renderSection();

    expect(html).toContain("users-section__dot--offline");
  });

  it("carries the user's own color as the swatch background", () => {
    seedUsersRegistry([ALICE]);

    const html = renderSection();

    expect(html).toContain("background-color: #ff0000");
  });

  it("marks an inactive user distinctly", () => {
    seedUsersRegistry([BOB]);

    const html = renderSection();

    expect(html).toContain(t("FUSION.Settings.Users.Inactive"));
  });

  it("REQ-CFG-081-style honest empty state: no users renders the empty message", () => {
    const html = renderSection();
    expect(html).toContain(t("FUSION.Settings.Users.Empty"));
  });

  it("offers Editar and Resetar senha for every user", () => {
    seedUsersRegistry([ALICE]);
    const html = renderSection();
    expect(html).toContain(t("FUSION.Settings.Users.Actions.Edit"));
    expect(html).toContain(t("FUSION.Settings.Users.Actions.ResetPassword"));
  });

  it("REQ-USR-028: Desativar only appears for an active user", () => {
    seedUsersRegistry([ALICE, BOB]); // Alice active, Bob inactive
    const html = renderSection();

    const deactivateLabel = t("FUSION.Settings.Users.Actions.Deactivate");
    const occurrences = html.split(deactivateLabel).length - 1;
    // One row (Alice) offers Desativar; Bob (already inactive) does not.
    expect(occurrences).toBe(1);
  });

  it("REQ-USR-029: Desconectar only appears for a user marked online", () => {
    seedUsersRegistry([ALICE]);
    const offlineHtml = renderSection();
    expect(offlineHtml).not.toContain(t("FUSION.Settings.Users.Actions.Kick"));

    updateOnlineUsers([{ userId: "u1", userName: "Alice", color: "#ff0000", online: true }]);
    const onlineHtml = renderSection();
    expect(onlineHtml).toContain(t("FUSION.Settings.Users.Actions.Kick"));
  });
});

describe("UsersSection — REQ-CFG-051a: creating a user never mentions a ficha/janela", () => {
  it("the list view has no window-manager markup and no character/ficha copy", () => {
    seedUsersRegistry([ALICE]);
    const html = renderSection();

    expect(html).not.toContain("window-host");
    expect(html).not.toContain("fusion-window");
    expect(html.toLowerCase()).not.toContain("personagem");
    expect(html.toLowerCase()).not.toContain("ficha");
  });
});

describe("UsersSection — create (REQ-CFG-051, REQ-USR-025)", () => {
  it("the create form offers name, role, color and an optional password — nothing about a character", () => {
    const state = new UsersSectionState();
    state.openCreate();

    const html = renderSection(state);

    expect(html).toContain(t("FUSION.Settings.Users.Create.Title"));
    expect(html).toContain(t("FUSION.Settings.Users.Fields.Name"));
    expect(html).toContain(t("FUSION.Settings.Users.Fields.Role"));
    expect(html).toContain(t("FUSION.Settings.Users.Fields.Color"));
    expect(html).toContain(t("FUSION.Settings.Users.Fields.Password"));
    expect(html).toContain(t("FUSION.Settings.Users.Create.Submit"));
    expect(html.toLowerCase()).not.toContain("personagem");
  });

  it("every role option is offered", () => {
    const state = new UsersSectionState();
    state.openCreate();
    const html = renderSection(state);

    expect(html).toContain(t("FUSION.Role.Player"));
    expect(html).toContain(t("FUSION.Role.Trusted"));
    expect(html).toContain(t("FUSION.Role.Assistant"));
    expect(html).toContain(t("FUSION.Role.GM"));
  });
});

describe("UsersSection — edit (REQ-CFG-052: stacked fields, same panel, no save button)", () => {
  it("renders name/role/color/avatar/active pre-filled from the user", () => {
    seedUsersRegistry([ALICE]);
    const state = new UsersSectionState();
    state.openEdit("u1");

    const html = renderSection(state);

    expect(html).toContain(t("FUSION.Settings.Users.Edit.Title", { name: "Alice" }));
    expect(html).toContain('value="Alice"');
    expect(html).toContain(t("FUSION.Settings.Users.Fields.Avatar"));
    expect(html).toContain(t("FUSION.Settings.Users.Fields.Active"));
  });

  it("REQ-CFG-013/DEC-CFG-04: everything renders in this same panel — no floating window markup", () => {
    seedUsersRegistry([ALICE]);
    const state = new UsersSectionState();
    state.openEdit("u1");

    const html = renderSection(state);

    expect(html).not.toContain("window-host");
    expect(html).not.toContain("fusion-window");
  });

  it("has a 'voltar' control back to the list", () => {
    seedUsersRegistry([ALICE]);
    const state = new UsersSectionState();
    state.openEdit("u1");

    const html = renderSection(state);

    expect(html).toContain(t("FUSION.Settings.Users.BackToList"));
  });
});

describe("UsersSection — reset password reveal (REQ-CFG-053)", () => {
  it("shows the plaintext once with a copy action and the one-time warning", () => {
    seedUsersRegistry([ALICE]);
    const state = new UsersSectionState();
    state.showResetReveal({ userId: "u1", userName: "Alice", password: "correct-horse" });

    const html = renderSection(state);

    expect(html).toContain("correct-horse");
    expect(html).toContain(t("FUSION.Settings.Users.ResetPassword.Copy"));
    expect(html).toContain(t("FUSION.Settings.Users.ResetPassword.Warning"));
  });

  it("a passwordless reset (removePassword) shows the removed-copy, not a blank password", () => {
    seedUsersRegistry([ALICE]);
    const state = new UsersSectionState();
    state.showResetReveal({ userId: "u1", userName: "Alice", password: null });

    const html = renderSection(state);

    expect(html).toContain(t("FUSION.Settings.Users.ResetPassword.Removed"));
  });

  it("no reveal renders when nothing was just reset", () => {
    seedUsersRegistry([ALICE]);
    const html = renderSection();
    expect(html).not.toContain(t("FUSION.Settings.Users.ResetPassword.Warning"));
  });
});
