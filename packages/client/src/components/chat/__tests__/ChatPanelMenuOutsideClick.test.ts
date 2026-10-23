/**
 * ChatPanelMenuOutsideClick.test.ts — task A021 (docs/design/gaveta-lateral/tasks-ajustes-r1.md).
 *
 * The "⋯" menu (`.chat-panel__menu-anchor`) used to close only via `Escape` or the toggle
 * button itself — never on an outside click, which is the standard behaviour for a
 * menu/popover. `ChatPanel.svelte` now wires `use:clickOutside` (`lib/ui/clickOutside.ts`)
 * onto the anchor with a callback that closes `menuOpen`.
 *
 * REVIEW FIX (Ajustes r1 — Fase 2, findings 1+2): this file previously asserted the wiring
 * by `readFileSync`-ing `ChatPanel.svelte` and matching regexes against the source text
 * (the import line, the anchor's opening tag, `handleMenuKeydown`'s body). That is an
 * implementation-detail test — it passes unchanged under an equivalent refactor (e.g.
 * `use:clickOutside={closeMenu}` with a named `closeMenu` function) and it does NOT prove
 * the callback actually runs or that `menuOpen` actually flips; a regex match on the
 * source is not a behavioural assertion. Those tests were removed. The header also used
 * to cite REQ-ACH-015 as covered here; REQ-ACH-015 (`specs/38-aba-chat.md:279`) defines the
 * "⋯" menu's *content* contract (favourites editor for every role, GM-only export/clear) —
 * it says nothing about outside-click behaviour, and this file exercises none of it. Task
 * A021's own "Manda" section only invokes REQ-ACH-015 for context ("a menu behaves like a
 * menu"), and its "Pronto quando" has no literal `Cobre:` line — so nothing here is
 * mis-citing a requirement it doesn't prove.
 *
 * What IS behaviourally proven, and where:
 *   - `lib/ui/__tests__/clickOutside.test.ts` proves the action itself against a fake
 *     `document`: a `pointerdown` outside the node fires the callback, one inside it (e.g.
 *     a "menu item" click) does not, `update()` swaps the live callback, `destroy()` removes
 *     the listener. That is the actual close-on-outside-click mechanism.
 *   - `svelte/server`'s `render()` only produces the FIRST paint of the markup — Svelte
 *     actions never run during that static render (no client JS executes), so nothing in
 *     THIS file can dispatch a real `pointerdown` against the rendered panel and observe
 *     the menu close, and the project's Vitest runs `environment: "node"` (no jsdom) to add
 *     that capability. The end-to-end wiring — the real anchor, in the real panel, closing
 *     on a real outside click — is instead proven visually by the roteiro e2e for this
 *     phase (menu open / menu closed-by-outside-click prints, per the phase's e2e rule).
 *   - This file is left with exactly what IS honestly verifiable in this environment: that
 *     wiring `use:clickOutside` onto the anchor did not change the panel's rendered shape.
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";

import ChatPanel from "../ChatPanel.svelte";
// Importing the barrel pre-loads the pt-BR/en bundles, so `t()` resolves real labels.
import "../../../lib/i18n/index.js";

import type { Socket } from "socket.io-client";

const socket = {} as unknown as Socket;

describe("ChatPanel — '⋯' menu closes on outside click (task A021)", () => {
  it("still renders the anchor and menu structurally (the wiring did not change the shape)", () => {
    const { body } = render(ChatPanel, {
      props: { socket, worldId: "world-abc", userId: "user-1", isGm: false },
    });
    expect(body).toContain('class="chat-panel__menu-anchor');
    expect(body).toContain('class="chat-panel__menu ');
    expect(body).toContain('role="menu"');
  });
});
