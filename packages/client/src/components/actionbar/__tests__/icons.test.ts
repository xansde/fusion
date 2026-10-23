/**
 * icons.test.ts — the drawn icons of the action bar (BAR-F1-04; spec 53 REQ-BAR-029, RNF-BAR-07).
 *
 * The icons are injected with `{@html}`, which is only defensible when nothing reaches it from
 * outside the constant table — so every icon runs through the rail's allowlist, and an unknown or
 * hostile key can only ever resolve to an icon of the table.
 */

import { describe, expect, it } from "vitest";

import { isDrawnSvgIcon } from "../../../lib/sidebar/iconMarkup.js";
import type { ActionBarEntryKind } from "../../../lib/actionbar/types.js";
import { ICON_KEYS, TAB_ICON, iconKeyFor, iconSvg } from "../icons.js";
import { makeStubEntries } from "../../../lib/actionbar/__tests__/stubProvider.js";

const KINDS: ActionBarEntryKind[] = [
  "strike",
  "spell",
  "action",
  "item",
  "reaction",
  "toggle",
  "check",
];

describe("o conjunto de ícones livres", () => {
  it("tem os ícones que o protótipo usa", () => {
    for (const key of [
      "sword",
      "bow",
      "spark",
      "foot",
      "flask",
      "react",
      "d20",
      "star",
      "shield",
      "paw",
      "eye",
    ]) {
      expect(ICON_KEYS).toContain(key);
    }
  });

  it("todo ícone é um SVG desenhado que passa pela lista de permissão da gaveta (nada de script, de URL, de texto)", () => {
    for (const key of ICON_KEYS) {
      expect(isDrawnSvgIcon(iconSvg(key)), `ícone "${key}"`).toBe(true);
    }
  });

  it("segue a convenção da gaveta: 24×24, traço de 1,75, sem preenchimento, aria-hidden", () => {
    const svg = iconSvg("sword");

    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('stroke-width="1.75"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('aria-hidden="true"');
  });

  it("chave desconhecida desenha a faísca, não quebra", () => {
    expect(iconSvg("nao-existe")).toBe(iconSvg("spark"));
    expect(iconSvg("constructor")).toBe(iconSvg("spark"));
    expect(iconSvg("__proto__")).toBe(iconSvg("spark"));
  });
});

describe("iconKeyFor — qual ícone a entrada ganha", () => {
  it("o que ela pede, se o conjunto tem", () => {
    expect(iconKeyFor("bow", "strike")).toBe("bow");
    expect(iconKeyFor("shield", "toggle")).toBe("shield");
  });

  it("apelidos de desenhos que já existem (o provedor de teste pede 'boot')", () => {
    expect(iconKeyFor("boot", "action")).toBe("foot");
    expect(iconKeyFor("heal", "spell")).toBe("heart");
  });

  it("sem ícone, ou com um que o conjunto não tem: o do tipo", () => {
    const expected: Record<ActionBarEntryKind, string> = {
      strike: "sword",
      spell: "spark",
      action: "foot",
      item: "bag",
      reaction: "react",
      toggle: "hood",
      check: "d20",
    };
    for (const kind of KINDS) {
      expect(iconKeyFor(undefined, kind)).toBe(expected[kind]);
      expect(iconKeyFor("arte-da-paizo", kind)).toBe(expected[kind]);
    }
  });

  it("nomes herdados do Object não viram ícone", () => {
    expect(iconKeyFor("constructor", "strike")).toBe("sword");
    expect(iconKeyFor("toString", "item")).toBe("bag");
    expect(iconKeyFor("__proto__", "check")).toBe("d20");
  });

  it("todo ícone que o provedor de teste usa resolve para um desenho do conjunto", () => {
    for (const entry of makeStubEntries()) {
      expect(ICON_KEYS).toContain(iconKeyFor(entry.icon, entry.kind));
    }
  });
});

describe("o conjunto único do app (Lucide, @fusion/shared) também desenha na barra", () => {
  it("um nome do conjunto compartilhado vira ícone (a aba Testes dá um desenho por perícia)", () => {
    expect(iconKeyFor("mountain", "check")).toBe("mountain");
    expect(iconKeyFor("lock-open", "check")).toBe("lock-open");
    expect(ICON_KEYS).toContain("heart-pulse");
    expect(iconSvg("mountain")).not.toBe(iconSvg("spark"));
  });

  it("um nome que a barra já desenha continua com o desenho da barra", () => {
    expect(iconSvg("sword")).toContain('<path d="M20.5 3.5');
  });
});

describe("TAB_ICON", () => {
  it("cada aba tem um desenho diferente", () => {
    expect(new Set(Object.values(TAB_ICON)).size).toBe(7);
  });

  it("cada aba tem um ícone do conjunto", () => {
    for (const [tab, key] of Object.entries(TAB_ICON)) {
      expect(ICON_KEYS, `aba ${tab}`).toContain(key);
    }
    expect(Object.keys(TAB_ICON)).toHaveLength(7);
  });
});
