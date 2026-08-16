/**
 * SidebarBadge.test.ts — the badge drawn in the corner of a rail icon (spec 36 §5.3).
 *
 * Rendered with `render()` from `svelte/server`, like `SidebarRail.test.ts`: the
 * client project runs Vitest in a node environment, and everything this component
 * owns is structural — which kind is drawn, what text it carries, and that no
 * drawer state can take part in the decision.
 *
 * Covers REQ-GAV-020, REQ-GAV-021, REQ-GAV-024 and REQ-A11-010.
 */

import { describe, expect, it } from "vitest";
import { render } from "svelte/server";

import SidebarBadge from "../SidebarBadge.svelte";
import { createCounterBadge, createDotBadge } from "../../../lib/sidebar/badges.svelte.js";
// Pre-loads the pt-BR/en bundles so `t()` resolves the badge wording instead of
// the raw key — which is what makes the REQ-A11-010 assertions meaningful.
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

function markup(value: number | boolean | null | undefined, descriptionId?: string): string {
  const { body } = render(SidebarBadge, { props: { value, descriptionId } });
  return body;
}

/** Text of the hidden textual equivalent, or null when none was rendered. */
function descriptionText(html: string): string | null {
  const match = /<span[^>]*data-badge-description[^>]*>([\s\S]*?)<\/span\s*>/.exec(html);
  return match ? match[1]!.trim() : null;
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

describe("SidebarBadge — REQ-A11-010", () => {
  it("REQ-A11-010: o contador tem equivalente textual, não só a forma desenhada", () => {
    // The drawn span is decoration (aria-hidden); without the hidden sibling the
    // count would exist for sighted users only.
    const body = markup(2);
    expect(body).toContain('data-badge-kind="counter"');
    expect(body).toMatch(/data-badge-kind="counter"[^>]*aria-hidden="true"/);

    const spoken = descriptionText(body);
    expect(spoken).toBe(t("FUSION.Sidebar.Badge.CounterMany", { count: 2 }));
    expect(spoken).not.toBe("FUSION.Sidebar.Badge.CounterMany"); // the bundle resolved
    expect(spoken).toContain("2");
  });

  it("REQ-A11-010: o contador de um item usa a forma singular", () => {
    expect(descriptionText(markup(1))).toBe(t("FUSION.Sidebar.Badge.CounterOne"));
  });

  it("REQ-A11-010: acima de 99 o texto anuncia o número real, não o 99+ desenhado", () => {
    const body = markup(150);
    expect(body).toContain("99+");
    expect(descriptionText(body)).toBe(t("FUSION.Sidebar.Badge.CounterMany", { count: 150 }));
  });

  it("REQ-A11-010: o ponto de estado também é anunciado — a cor sozinha não conta", () => {
    const spoken = descriptionText(markup(true));
    expect(spoken).toBe(t("FUSION.Sidebar.Badge.Dot"));
    expect(spoken).not.toBe("");
  });

  it("REQ-A11-010: sem badge não há texto nenhum a anunciar", () => {
    for (const empty of [null, undefined, false, 0]) {
      expect(descriptionText(markup(empty))).toBeNull();
    }
  });

  it("REQ-A11-010: o texto recebe o id que o botão do trilho usa em aria-describedby", () => {
    const body = markup(3, "sidebar-badge-desc-chat");
    expect(body).toMatch(/<span[^>]*id="sidebar-badge-desc-chat"[^>]*data-badge-description/);
  });

  it("REQ-GAV-021: com a gaveta recolhida o badge é o único portador do estado — e ele fala", () => {
    // This component takes nothing about the drawer, so the collapsed rail renders
    // exactly this markup: the textual equivalent travels with the badge.
    const dot = createDotBadge();
    dot.light();
    expect(descriptionText(markup(dot.value))).toBe(t("FUSION.Sidebar.Badge.Dot"));
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
