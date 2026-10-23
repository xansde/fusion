/**
 * ModsSection.test.ts — "Mods" content (G106).
 *
 * Server-rendered snapshot via `svelte/server`'s `render()`, same technique the
 * other section tests use. The section is entirely static (no store, no socket,
 * no fetch) — REQ-CFG-064 keeps this spec from ever defining what a mod is, so
 * there is nothing dynamic to seed or mock here.
 *
 * Covers REQ-CFG-060, REQ-CFG-063, REQ-CFG-064.
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";

import ModsSection from "../ModsSection.svelte";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

function renderSection(): string {
  const { body } = render(ModsSection);
  return body;
}

describe("ModsSection — REQ-CFG-060/081: empty state with no mods installed", () => {
  it("shows the fixed 'nenhum mod instalado neste mundo' empty state", () => {
    const html = renderSection();
    expect(html).toContain(t("FUSION.Settings.Mods.Empty"));
  });
});

describe("ModsSection — REQ-CFG-063: install control disabled with a legible reason", () => {
  it("renders the install control as disabled", () => {
    const html = renderSection();
    const buttonMatch = /<button[^>]*class="mods-section__install[^"]*"[^>]*>/.exec(html);
    expect(buttonMatch).not.toBeNull();
    expect(buttonMatch?.[0]).toMatch(/\bdisabled\b/);
  });

  it("surfaces a legible reason for the disabled state, not just a mute control", () => {
    const html = renderSection();
    expect(html).toContain(t("FUSION.Settings.Mods.InstallDisabledReason"));
  });
});

describe("ModsSection — REQ-CFG-064: no mod model, no network I/O", () => {
  it("renders no <table>/<select>/<input> — there is nothing to list or configure yet", () => {
    const html = renderSection();
    expect(html).not.toMatch(/<table/);
    expect(html).not.toMatch(/<select/);
    expect(html).not.toMatch(/<input/);
  });
});
