/**
 * SidebarBadge.test.ts — the badge drawn in the corner of a rail icon (spec 36 §5.3).
 *
 * Rendered with `render()` from `svelte/server`, like `SidebarRail.test.ts`: the
 * client project runs Vitest in a node environment, and everything this component
 * owns is structural — which kind is drawn, what text it carries, and that no
 * drawer state can take part in the decision.
 *
 * Covers REQ-GAV-020, REQ-GAV-021, REQ-GAV-024.
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";

import SidebarBadge from "../SidebarBadge.svelte";
import { createCounterBadge, createDotBadge } from "../../../lib/sidebar/badges.svelte.js";

function markup(value: number | boolean | null | undefined): string {
  const { body } = render(SidebarBadge, { props: { value } });
  return body;
}

describe("SidebarBadge — REQ-GAV-020", () => {
  it("REQ-GAV-020: contador desenha o número", () => {
    const body = markup(7);
    expect(body).toContain('data-badge-kind="counter"');
    expect(body).toContain(">7<");
    expect(body).not.toContain('data-badge-kind="dot"');
  });

  it("REQ-GAV-020: acima de 99 o contador desenha 99+", () => {
    expect(markup(100)).toContain("99+");
    expect(markup(4321)).toContain("99+");
    expect(markup(99)).toContain(">99<");
  });

  it("REQ-GAV-020: ponto de estado não carrega número", () => {
    const body = markup(true);
    expect(body).toContain('data-badge-kind="dot"');
    expect(body).not.toContain('data-badge-kind="counter"');
    // The dot span is empty — the number belongs to the other kind only.
    expect(body).toMatch(/data-badge-kind="dot"[^>]*><\/span>/);
  });

  it("REQ-GAV-020: sem valor não desenha badge nenhum", () => {
    for (const empty of [null, undefined, false, 0]) {
      expect(markup(empty)).not.toContain("data-badge-kind");
    }
  });
});

describe("SidebarBadge — REQ-GAV-021", () => {
  it("REQ-GAV-021: o componente não recebe nada sobre a gaveta — mesmo markup sempre", () => {
    // There is no `open`/`active` prop to pass: the same value renders the same
    // badge whether the drawer is collapsed, open, or open on this very tab.
    const counter = createCounterBadge();
    counter.set(3);
    const first = markup(counter.value);
    const second = markup(counter.value);
    expect(second).toBe(first);
    expect(first).toContain(">3<");
  });

  it("REQ-GAV-021: o ponto de estado da aba ativa continua desenhado", () => {
    const dot = createDotBadge();
    dot.light();
    expect(markup(dot.value)).toContain('data-badge-kind="dot"');
  });
});

describe("SidebarBadge — REQ-GAV-024", () => {
  it("REQ-GAV-024: nada de som, piscar ou animação no markup renderizado", () => {
    for (const value of [5, 150, true]) {
      const body = markup(value);
      expect(body).not.toMatch(/blink|pulse|animation|animate|<audio/i);
    }
  });
});
