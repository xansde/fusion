/**
 * RollModeSelector.test.ts — the one place that decides the audience of a roll.
 *
 * Rendered with `render()` from `svelte/server`: the client project runs Vitest in a node
 * environment with no jsdom and no testing-library, so the assertions are made on the
 * server-rendered markup. Everything this task owns in the markup is structural — the four
 * modes, drawn icons instead of emoji, the active indicator, and the help text that the
 * pointer and the keyboard both reach.
 *
 * Covers REQ-ACH-040, REQ-ACH-041 and RNF-ACH-04.
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";

import RollModeSelector from "../RollModeSelector.svelte";
import { ROLL_MODE_ORDER, rollModeIcons } from "../rollModeIcons.js";
// Importing the barrel pre-loads the pt-BR/en bundles, so `t()` resolves real labels
// instead of raw keys — which is what makes the help-text assertions meaningful.
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

import type { RollMode } from "@fusion/shared";

function renderSelector(mode: RollMode): string {
  const { body } = render(RollModeSelector, {
    props: { mode, onSelect: (): void => undefined },
  });
  return body;
}

/**
 * Pictographs — the exact class of character DEC-ACH-04 bans. Emoji change shape and
 * colour per operating system and never follow the theme; a drawn glyph does.
 */
const PICTOGRAPH = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

describe("RollModeSelector — quatro modos, ícones desenhados (REQ-ACH-040)", () => {
  it("draws exactly the four roll modes, in the spec's order", () => {
    expect(ROLL_MODE_ORDER).toEqual(["public", "gmroll", "blindroll", "selfroll"]);

    const body = renderSelector("public");
    for (const mode of ROLL_MODE_ORDER) {
      expect(body).toContain(`data-mode="${mode}"`);
    }
    expect(body.match(/data-mode="/g)).toHaveLength(4);
  });

  it("uses drawn SVG icons and no emoji anywhere in the markup", () => {
    const body = renderSelector("public");
    expect(body.match(/<svg/g)).toHaveLength(4);
    expect(PICTOGRAPH.test(body)).toBe(false);
    for (const mode of ROLL_MODE_ORDER) {
      expect(rollModeIcons[mode]).toContain("<svg");
      expect(PICTOGRAPH.test(rollModeIcons[mode])).toBe(false);
    }
  });

  it("marks the active mode, and only it", () => {
    const body = renderSelector("blindroll");
    expect(body.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(body).toMatch(
      /data-mode="blindroll"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-mode="blindroll"/,
    );
  });

  it("moves the active mark when the selection changes (REQ-ACH-041 restauração)", () => {
    const asSelf = renderSelector("selfroll");
    expect(asSelf.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(asSelf).toContain('data-active-mode="selfroll"');
    expect(renderSelector("gmroll")).toContain('data-active-mode="gmroll"');
  });
});

describe("RollModeSelector — ajuda e teclado (REQ-ACH-040, RNF-ACH-04)", () => {
  it("gives every mode help text reachable by pointer AND by focus", () => {
    const body = renderSelector("public");
    // `title` covers the pointer; `aria-label` covers focus (screen reader + focus ring).
    // Five `aria-label`s: one per mode, plus the group's own name.
    expect(body.match(/title="/g)).toHaveLength(4);
    expect(body.match(/aria-label="/g)).toHaveLength(5);
    expect(body).toContain(t("FUSION.Chat.RollMode.Public.Help"));
    expect(body).toContain(t("FUSION.Chat.RollMode.Gm.Help"));
    expect(body).toContain(t("FUSION.Chat.RollMode.Blind.Help"));
    expect(body).toContain(t("FUSION.Chat.RollMode.Self.Help"));
  });

  it("is a radio group of real buttons, so Tab and Enter already work", () => {
    const body = renderSelector("public");
    expect(body).toContain('role="radiogroup"');
    expect(body.match(/role="radio"/g)).toHaveLength(4);
    expect(body.match(/<button/g)).toHaveLength(4);
    expect(body).toContain(t("FUSION.Chat.RollMode.GroupLabel"));
  });

  it("names the modes in pt-BR, never in raw i18n keys", () => {
    const body = renderSelector("public");
    expect(body).not.toContain("FUSION.Chat.RollMode.");
    expect(t("FUSION.Chat.RollMode.Public.Label")).toBe("Pública");
  });
});
