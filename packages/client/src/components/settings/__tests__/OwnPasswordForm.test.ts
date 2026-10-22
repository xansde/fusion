/**
 * OwnPasswordForm.test.ts — "Trocar a minha senha" (spec 37 REQ-CFG-090, spec 05 REQ-USR-040).
 *
 * Server-rendered markup via `svelte/server` (same technique as the sibling sections): the form is
 * there for any seat, asks for the current password and the new one twice, uses the browser's
 * password-manager hints, and is part of "Minhas preferências". The request itself is proved in
 * `usersApi.test.ts`, the rules in `ownPasswordForm.test.ts`, the server side in `auth.test.ts`.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";

import OwnPasswordForm from "../OwnPasswordForm.svelte";
import PreferencesSection from "../PreferencesSection.svelte";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (): null => null,
      setItem: (): void => undefined,
      removeItem: (): void => undefined,
      clear: (): void => undefined,
    },
  });
});

describe("OwnPasswordForm", () => {
  const html = render(OwnPasswordForm).body;

  it("shows the three password fields", () => {
    expect(html).toContain(t("FUSION.Settings.Preferences.Password.Current"));
    expect(html).toContain(t("FUSION.Settings.Preferences.Password.New"));
    expect(html).toContain(t("FUSION.Settings.Preferences.Password.Confirm"));
    expect([...html.matchAll(/type="password"/g)]).toHaveLength(3);
  });

  it("hints the password manager which field is which", () => {
    expect(html).toContain('autocomplete="current-password"');
    expect([...html.matchAll(/autocomplete="new-password"/g)]).toHaveLength(2);
  });

  it("has a submit button and no stored value", () => {
    expect(html).toContain('type="submit"');
    expect(html).toContain(t("FUSION.Settings.Preferences.Password.Submit"));
    expect(html).not.toMatch(/type="password"[^>]*value="[^"]+"/);
  });

  it("tells a user without a password to leave the current one empty", () => {
    expect(html).toContain(t("FUSION.Settings.Preferences.Password.CurrentHint"));
  });

  it("is part of 'Minhas preferências' for every seat", () => {
    const section = render(PreferencesSection, {
      props: { worldId: "world-1", userId: "user-1" },
    }).body;
    expect(section).toContain(t("FUSION.Settings.Preferences.Password.Title"));
  });
});
