/**
 * ChatPanelMenuOutsideClick.test.ts — task A021 (docs/design/gaveta-lateral/tasks-ajustes-r1.md).
 *
 * The "⋯" menu (`.chat-panel__menu-anchor`, REQ-ACH-015) used to close only via `Escape`
 * or the toggle button itself — never on an outside click, which is the standard behaviour
 * for a menu/popover. This proves the fix wires `use:clickOutside` (`lib/ui/clickOutside.ts`)
 * onto the anchor, and that `Escape` keeps working (REQ-ACH-015 is unaffected structurally).
 *
 * `svelte/server`'s `render()` only produces the FIRST paint of the markup — Svelte actions
 * never run during that static render (no client JS executes), so this cannot dispatch a real
 * `pointerdown` and observe the menu close; that behaviour is instead proven directly against
 * the action in `lib/ui/__tests__/clickOutside.test.ts`. What THIS file proves is the wiring:
 * the compiled panel actually calls the action on the right anchor, with a callback that
 * closes the menu — read from the component's own source, the same source the Svelte
 * compiler reads to emit the client-side effect.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";

import ChatPanel from "../ChatPanel.svelte";
// Importing the barrel pre-loads the pt-BR/en bundles, so `t()` resolves real labels.
import "../../../lib/i18n/index.js";

import type { Socket } from "socket.io-client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAT_PANEL_SOURCE = readFileSync(resolve(__dirname, "../ChatPanel.svelte"), "utf8");

const socket = {} as unknown as Socket;

describe("ChatPanel — '⋯' menu closes on outside click (task A021)", () => {
  it("imports the shared clickOutside action from lib/ui", () => {
    expect(CHAT_PANEL_SOURCE).toMatch(
      /import\s*\{\s*clickOutside\s*\}\s*from\s*"\.\.\/\.\.\/lib\/ui\/clickOutside\.js"/,
    );
  });

  it("applies use:clickOutside to the menu anchor, closing menuOpen", () => {
    // `.chat-panel__menu-anchor` is the div that wraps both the "⋯" button and the
    // dropdown itself — the popover region a click must land OUTSIDE of to count.
    const anchorOpenTag = CHAT_PANEL_SOURCE.match(
      /<div\s+class="chat-panel__menu-anchor"[\s\S]*?<button/,
    )?.[0];
    expect(anchorOpenTag).toBeDefined();
    expect(anchorOpenTag).toContain("use:clickOutside=");
    expect(anchorOpenTag).toMatch(/menuOpen\s*=\s*false/);
  });

  it("still renders the anchor and menu structurally (the wiring did not change the shape)", () => {
    const { body } = render(ChatPanel, {
      props: { socket, worldId: "world-abc", userId: "user-1", isGm: false },
    });
    expect(body).toContain('class="chat-panel__menu-anchor');
    expect(body).toContain('class="chat-panel__menu ');
    expect(body).toContain('role="menu"');
  });

  it("keeps Escape closing the menu (handleMenuKeydown untouched by the outside-click change)", () => {
    expect(CHAT_PANEL_SOURCE).toMatch(
      /function handleMenuKeydown[\s\S]*?Escape[\s\S]*?menuOpen = false/,
    );
  });
});
