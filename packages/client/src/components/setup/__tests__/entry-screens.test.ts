/**
 * entry-screens.test.ts — the screens before the table (ui-login-admin, 22/10/2026):
 * join, management (server up, no world), the /setup wizard and the loading shell.
 *
 * The client project runs Vitest in node (no jsdom), so this looks where the
 * requirements are observable: the server-rendered join markup and each
 * component's own stylesheet — the visual language of docs/design/ui (tokens
 * only, nothing below 13px, no caps/italics/letter-spacing, no gradient or
 * shadow, no character used as an icon).
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import "../../../lib/i18n/index.js";
import { session } from "../../../lib/session.svelte.js";
import JoinScreen from "../../JoinScreen.svelte";

const here = fileURLToPath(new URL(".", import.meta.url));
const SCREENS = {
  JoinScreen: resolve(here, "../../JoinScreen.svelte"),
  ManagementScreen: resolve(here, "../../ManagementScreen.svelte"),
  SetupWizard: resolve(here, "../SetupWizard.svelte"),
  QrCode: resolve(here, "../QrCode.svelte"),
  App: resolve(here, "../../../App.svelte"),
};

function parts(path: string): { markup: string; style: string } {
  const source = readFileSync(path, "utf8");
  const style = /<style>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? "";
  const markup = source
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style>[\s\S]*?<\/style>/g, "");
  return { markup, style };
}

describe("entry screens speak the visual language of docs/design/ui", () => {
  for (const [name, path] of Object.entries(SCREENS)) {
    const { markup, style } = parts(path);

    it(`${name}: colours only through tokens (no hex, no rgba, no var() fallback)`, () => {
      // The QR code is the one exception: a phone camera needs black on white in
      // either theme, so its colours are fixed on purpose.
      if (name === "QrCode") return;
      expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(style).not.toMatch(/rgba?\(/);
      expect(style).not.toMatch(/var\(--[\w-]+\s*,/);
    });

    it(`${name}: type sizes from the scale, no caps, italics or tight tracking`, () => {
      for (const decl of style.match(/font-size:[^;]+;/g) ?? []) {
        expect(decl, decl).toMatch(/var\(--fusion-text-/);
      }
      expect(style).not.toMatch(/text-transform:\s*uppercase/);
      expect(style).not.toMatch(/font-style:\s*italic/);
      expect(style).not.toMatch(/letter-spacing/);
    });

    it(`${name}: flat surfaces (no gradient, no shadow)`, () => {
      expect(style).not.toMatch(/gradient\(/);
      expect(style).not.toMatch(/box-shadow/);
    });

    it(`${name}: no character drawn as an icon`, () => {
      expect(markup).not.toMatch(/[✕⚙⚔❯◆✎⚡]|&#1\d{5};|\p{Extended_Pictographic}/u);
    });
  }
});

describe("entry screens scroll themselves (html and body never scroll)", () => {
  // Found live at 390px: the /setup "Concluir" button sat below the fold, unreachable,
  // because base.css locks html/body (the table fills the viewport).
  for (const [name, shell] of [
    ["JoinScreen", "join-shell"],
    ["ManagementScreen", "mgmt-shell"],
    ["SetupWizard", "setup-shell"],
  ] as const) {
    it(`${name}: .${shell} is its own scroll container`, () => {
      const { style } = parts(SCREENS[name]);
      const rule = new RegExp(`\\.${shell} \\{([^}]*)\\}`).exec(style)?.[1] ?? "";
      expect(rule).toMatch(/overflow-y:\s*auto/);
      expect(rule).toMatch(/height:\s*100%/);
    });
  }
});

describe("JoinScreen", () => {
  function renderWith(users: { id: string; name: string; color: string; hasPassword: boolean }[]) {
    session.worldInfo = { id: "w", title: "A Queda", systemId: "pf2e-sf2e", users };
    session.connection = "disconnected";
    session.error = null;
    session.lockedOut = false;
    return render(JoinScreen).body;
  }

  it("keeps the protocol and system id out of the reading text (tooltip only)", () => {
    const html = renderWith([
      { id: "u1", name: "Huo Jinwu", color: "#3aa335", hasPassword: false },
    ]);
    const visible = html.replace(/title="[^"]*"/g, "");
    expect(visible).not.toMatch(/protocol/i);
    expect(visible).not.toContain("pf2e-sf2e");
    expect(html).toMatch(/title="protocolo \d+ · pf2e-sf2e"/);
  });

  it("each character is an option with an initials avatar on its colour", () => {
    const html = renderWith([
      { id: "u1", name: "Huo Jinwu", color: "#3aa335", hasPassword: false },
      { id: "u2", name: "C.L.A.U.D.E.", color: "#d4b400", hasPassword: true },
    ]);
    expect(html.match(/role="option"/g)).toHaveLength(2);
    expect(html).toMatch(/border-color: #3aa335[^>]*>HJ</);
    expect(html).toMatch(/>CL</);
  });

  it("says in words when a character needs a password", () => {
    const html = renderWith([
      { id: "u1", name: "Huo Jinwu", color: "#3aa335", hasPassword: false },
      { id: "u2", name: "Gamemaster", color: "#e04848", hasPassword: true },
    ]);
    expect(html.match(/Pede senha/g)).toHaveLength(1);
  });

  it("the join button is disabled until someone is chosen, with sentence-case text", () => {
    const html = renderWith([
      { id: "u1", name: "Huo Jinwu", color: "#3aa335", hasPassword: false },
    ]);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled[^>]*>[\s\S]*Entrar no mundo/);
  });
});
