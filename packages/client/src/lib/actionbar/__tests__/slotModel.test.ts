/**
 * slotModel.test.ts — what a slot draws, decided from an entry (BAR-F1-04; spec 53 REQ-BAR-029..032,
 * REQ-BAR-037, REQ-BAR-104, DEC-BAR-15; tasks.md §2.2).
 *
 * The client's Vitest has no DOM (§2.10), so the decisions of `Slot.svelte` — the short name under
 * the icon, the seal in the corner, the cost glyph, which bonus the slot shows, which of four
 * states it is in — live in `slotModel.ts` as pure functions of an `ActionBarEntry`.
 *
 * D-15 runs through all of it: the cost, the badge, the uses and the group counters are DISPLAY. No
 * function here reads them as a rule, and none of them turns a state into "blocked".
 */

import { describe, expect, it } from "vitest";

import "../../i18n/index.js";
import type { ActionBarEntry } from "../types.js";
import {
  abbreviateLabel,
  entriesForTab,
  FAVORITE_KEY_LABELS,
  groupEntries,
  slotView,
  tooltipView,
} from "../slotModel.js";
import { makeEntry } from "./stubProvider.js";

describe("abbreviateLabel — o nome curto embaixo do ícone (DEC-BAR-15)", () => {
  it("o que cabe fica como está", () => {
    expect(abbreviateLabel("Deslocar")).toBe("Deslocar");
    expect(abbreviateLabel("Passo")).toBe("Passo");
  });

  it("corta em palavra inteira, nunca no meio dela", () => {
    expect(abbreviateLabel("Rememorar Conhecimento")).toBe("Rememorar");
    expect(abbreviateLabel("Golpe Reativo")).toBe("Golpe");
  });

  it("junta palavras enquanto couberem", () => {
    expect(abbreviateLabel("Mão Fantasma", 12)).toBe("Mão Fantasma");
    expect(abbreviateLabel("Raio de Fogo Grande", 11)).toBe("Raio Fogo");
  });

  it("ignora o conectivo quando a conta aperta (de, do, uma, um, o, a…)", () => {
    expect(abbreviateLabel("Arquitetar uma Estratégia")).toBe("Arquitetar");
    expect(abbreviateLabel("Poção de Cura Menor", 11)).toBe("Poção Cura");
  });

  it("uma palavra só, maior que o espaço, termina em reticências e respeita o limite", () => {
    const out = abbreviateLabel("Impulsionar Eidolon Poderoso", 8);

    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(8);
    expect(out).toBe("Impulsi…");
  });

  it("aperta espaços repetidos e nunca devolve vazio para um nome que existe", () => {
    expect(abbreviateLabel("  Esconder   ")).toBe("Esconder");
    expect(abbreviateLabel("de")).toBe("de");
    expect(abbreviateLabel("")).toBe("");
  });
});

describe("slotView — o que o slot desenha", () => {
  it("o nome curto vem da entrada; sem ele, o núcleo abrevia o rótulo", () => {
    expect(
      slotView(makeEntry("strike:a", { label: "Espada Longa", shortLabel: "Espada" })).shortLabel,
    ).toBe("Espada");
    expect(slotView(makeEntry("action:b", { label: "Rememorar Conhecimento" })).shortLabel).toBe(
      "Rememorar",
    );
    // O nome completo continua inteiro, para o tooltip e para o leitor de tela.
    expect(slotView(makeEntry("action:b", { label: "Rememorar Conhecimento" })).label).toBe(
      "Rememorar Conhecimento",
    );
  });

  it("um shortLabel só de espaços conta como ausente", () => {
    expect(
      slotView(makeEntry("action:b", { label: "Deslocar", shortLabel: "   " })).shortLabel,
    ).toBe("Deslocar");
  });

  describe("custo no canto, só como dado exibido (REQ-BAR-037, D-15)", () => {
    const glyph = (cost: ActionBarEntry["cost"]): string | null =>
      slotView(cost === undefined ? makeEntry("action:x") : makeEntry("action:x", { cost }))
        .costGlyph;

    it("◆ ◆◆ ◆◆◆ para 1, 2 e 3 ações; ⟳ reação; ◇ ação livre", () => {
      expect(glyph({ kind: "action", count: 1 })).toBe("◆");
      expect(glyph({ kind: "action", count: 2 })).toBe("◆◆");
      expect(glyph({ kind: "action", count: 3 })).toBe("◆◆◆");
      expect(glyph({ kind: "reaction" })).toBe("⟳");
      expect(glyph({ kind: "free" })).toBe("◇");
    });

    it("custo variável cabe no canto: de 1 a 3 ações vira ◆–◆◆◆", () => {
      expect(glyph({ kind: "activity", min: 1, max: 3, unit: "action" })).toBe("◆–◆◆◆");
    });

    it("em inglês o formatador escreve 'to' no meio da faixa, e o canto continua ◆–◆◆◆", () => {
      const entry = makeEntry("spell:a:b", {
        cost: { kind: "activity", min: 1, max: 3, unit: "action" },
      });

      expect(slotView(entry, "en").costGlyph).toBe("◆–◆◆◆");
      expect(slotView(entry, "pt-BR").costGlyph).toBe("◆–◆◆◆");
    });

    it("atividade em minutos e custo passivo ou ausente não têm glifo", () => {
      expect(glyph({ kind: "activity", min: 10, unit: "minute" })).toBeNull();
      expect(glyph({ kind: "passive" })).toBeNull();
      expect(glyph({ kind: "none" })).toBeNull();
      expect(glyph(undefined)).toBeNull();
    });

    it("o rótulo do custo vem do formatador que o cliente já tem", () => {
      expect(
        slotView(makeEntry("action:x", { cost: { kind: "action", count: 2 } })).costLabel,
      ).toBe("2 ações");
      expect(slotView(makeEntry("action:x", { cost: { kind: "reaction" } })).costLabel).toBe(
        "reação",
      );
      expect(slotView(makeEntry("action:x")).costLabel).toBeNull();
    });
  });

  describe("o selo do canto (T3, T4, T5)", () => {
    it("patamar da magia", () => {
      expect(slotView(makeEntry("spell:a:b", { rank: 2 })).seal).toEqual({
        kind: "rank",
        text: "2",
      });
    });

    it("MAP: Agarrar, Empurrar e Derrubar contam no próximo ataque", () => {
      expect(slotView(makeEntry("action:grab", { countsForMap: true })).seal).toEqual({
        kind: "map",
        text: "MAP",
      });
    });

    it("quantidade: ×N sem teto; N/M com teto (cargas)", () => {
      expect(slotView(makeEntry("item:a", { uses: { value: 2 } })).seal).toEqual({
        kind: "uses",
        text: "×2",
      });
      expect(slotView(makeEntry("item:b", { uses: { value: 2, max: 3 } })).seal).toEqual({
        kind: "uses",
        text: "2/3",
      });
    });

    it("quantidade zero continua aparecendo (×0), não some", () => {
      expect(slotView(makeEntry("item:a", { uses: { value: 0 } })).seal?.text).toBe("×0");
    });

    it("um selo só: patamar vence MAP, que vence quantidade", () => {
      const all = makeEntry("spell:a:b", { rank: 1, countsForMap: true, uses: { value: 4 } });
      expect(slotView(all).seal?.kind).toBe("rank");
      const noRank = makeEntry("action:a", { countsForMap: true, uses: { value: 4 } });
      expect(slotView(noRank).seal?.kind).toBe("map");
    });

    it("sem nada a dizer, sem selo", () => {
      expect(slotView(makeEntry("action:a")).seal).toBeNull();
    });
  });

  describe("o bônus que o slot mostra", () => {
    it("o da variante padrão em uso (o golpe no MAP corrente), não o da entrada", () => {
      const strike = makeEntry("strike:a", {
        badge: "+9",
        variants: [
          { id: "map:0", axis: "map", label: "1º ataque", badge: "+9" },
          { id: "map:1", axis: "map", label: "2º ataque", badge: "+4", isDefault: true },
          { id: "map:2", axis: "map", label: "3º ataque", badge: "−1" },
        ],
      });

      expect(slotView(strike).badge).toBe("+4");
    });

    it("sem variante com bônus, o da entrada", () => {
      expect(slotView(makeEntry("check:a", { badge: "+8" })).badge).toBe("+8");
    });

    it("com mais de um eixo padrão com bônus, vale o primeiro na ordem: MAP, patamar, custo, elemento", () => {
      const axes = [
        { id: "element:fire", axis: "element", label: "Fogo", badge: "E", isDefault: true },
        { id: "cost:2", axis: "cost", label: "2 ações", badge: "C", isDefault: true },
        { id: "rank:2", axis: "rank", label: "2º patamar", badge: "R", isDefault: true },
        { id: "map:1", axis: "map", label: "2º ataque", badge: "M", isDefault: true },
      ] as const;
      const badgeWithout = (...dropped: string[]): string | null =>
        slotView(
          makeEntry("strike:a", {
            variants: axes.filter((variant) => !dropped.includes(variant.axis)),
          }),
        ).badge;

      expect(badgeWithout()).toBe("M");
      expect(badgeWithout("map")).toBe("R");
      expect(badgeWithout("map", "rank")).toBe("C");
      expect(badgeWithout("map", "rank", "cost")).toBe("E");
    });

    it("variante padrão sem bônus próprio cai no da entrada", () => {
      const spell = makeEntry("spell:a:b", {
        badge: "CD 18",
        variants: [{ id: "cost:2", axis: "cost", label: "2 ações", isDefault: true }],
      });

      expect(slotView(spell).badge).toBe("CD 18");
    });

    it("nada para mostrar", () => {
      expect(slotView(makeEntry("action:a")).badge).toBeNull();
    });
  });

  describe("os quatro estados (REQ-BAR-030)", () => {
    it("sem estado, a entrada está pronta", () => {
      expect(slotView(makeEntry("action:a")).state).toBe("ready");
      expect(slotView(makeEntry("action:a", { state: "ready" })).state).toBe("ready");
    });

    it("esmaecida, gasta até recarregar e ligada", () => {
      expect(slotView(makeEntry("action:a", { state: "unavailable", reason: "x" })).state).toBe(
        "unavailable",
      );
      expect(
        slotView(makeEntry("reaction:a", { state: "spent-until-recharge", reason: "x" })).state,
      ).toBe("spent");
      expect(slotView(makeEntry("toggle:a", { state: "active" })).state).toBe("active");
    });

    it("o motivo acompanha a entrada esmaecida (REQ-BAR-031)", () => {
      const view = slotView(
        makeEntry("action:command", { state: "unavailable", reason: "Já comandou neste turno" }),
      );

      expect(view.reason).toBe("Já comandou neste turno");
    });

    it("D-15 / REQ-BAR-104: esmaecer é sinal — nenhum estado do slot é 'bloqueado'", () => {
      const states = (["ready", "unavailable", "spent-until-recharge", "active"] as const).map(
        (state) =>
          slotView(
            makeEntry(
              "action:a",
              state === "ready" || state === "active" ? { state } : { state, reason: "x" },
            ),
          ),
      );

      for (const view of states) {
        expect(Object.keys(view)).not.toContain("blocked");
        expect(Object.keys(view)).not.toContain("disabled");
      }
    });
  });

  describe("o nome para quem não vê (aria-label)", () => {
    it("rótulo completo, custo e motivo", () => {
      const view = slotView(
        makeEntry("action:command", {
          label: "Comandar um Animal",
          cost: { kind: "action", count: 1 },
          state: "unavailable",
          reason: "Já comandou neste turno",
        }),
      );

      expect(view.ariaLabel).toBe(
        "Comandar um Animal, 1 ação. Indisponível: Já comandou neste turno",
      );
    });

    it("o bônus ou a CD que o olho lê no slot também entra no nome (a variante em uso, não a base)", () => {
      const strike = makeEntry("strike:a", {
        label: "Espada Longa",
        cost: { kind: "action", count: 1 },
        badge: "+9",
        variants: [
          { id: "map:0", axis: "map", label: "1º ataque", badge: "+9" },
          { id: "map:1", axis: "map", label: "2º ataque", badge: "+4", isDefault: true },
        ],
      });
      const spell = makeEntry("spell:a:b", { label: "Medo", badge: "CD 19" });

      expect(slotView(strike).ariaLabel).toBe("Espada Longa, 1 ação, +4");
      expect(slotView(spell).ariaLabel).toBe("Medo, CD 19");
    });

    it("sem custo nem motivo, só o rótulo", () => {
      expect(slotView(makeEntry("check:a", { label: "Percepção" })).ariaLabel).toBe("Percepção");
    });

    it("entrada gasta fala do que é: gasta até recarregar", () => {
      const view = slotView(
        makeEntry("reaction:a", {
          label: "Golpe Reativo",
          cost: { kind: "reaction" },
          state: "spent-until-recharge",
          reason: "Reação já gasta",
        }),
      );

      expect(view.ariaLabel).toBe("Golpe Reativo, reação. Gasto até recarregar: Reação já gasta");
    });
  });
});

describe("FAVORITE_KEY_LABELS — as 12 teclas da linha de Favoritos (D-BA07)", () => {
  it("1–9, 0, − e =, na ordem dos slots", () => {
    expect(FAVORITE_KEY_LABELS).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "0",
      "−",
      "=",
    ]);
  });
});

describe("entriesForTab / groupEntries — a aba e os grupos (REQ-BAR-026)", () => {
  const entries = [
    makeEntry("strike:a", { tab: "strikes" }),
    makeEntry("spell:m:a", { tab: "spells", group: "Truques" }),
    makeEntry("spell:m:b", {
      tab: "spells",
      group: "1º patamar",
      groupUses: { value: 2, max: 3, style: "count" },
    }),
    makeEntry("spell:m:c", { tab: "spells", group: "Truques" }),
    makeEntry("spell:m:d", { tab: "spells" }),
    makeEntry("action:a", { tab: "actions", group: "Básicas" }),
  ];

  it("a aba mostra só as entradas dela, na ordem em que vieram", () => {
    expect(entriesForTab(entries, "spells").map((e) => e.id)).toEqual([
      "spell:m:a",
      "spell:m:b",
      "spell:m:c",
      "spell:m:d",
    ]);
    expect(entriesForTab(entries, "items")).toEqual([]);
  });

  it("agrupa pelo nome do grupo, na ordem da primeira aparição", () => {
    const groups = groupEntries(entriesForTab(entries, "spells"));

    expect(groups.map((g) => g.name)).toEqual(["Truques", "1º patamar", undefined]);
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(["spell:m:a", "spell:m:c"]);
  });

  it("o contador do cabeçalho vem da entrada que o traz (x/y de espaços, pips do foco)", () => {
    const groups = groupEntries(entriesForTab(entries, "spells"));

    expect(groups[1]?.uses).toEqual({ value: 2, max: 3, style: "count" });
    expect(groups[0]?.uses).toBeUndefined();
  });

  it("aba sem entradas: nenhum grupo (a casca mostra o estado vazio, a aba não some)", () => {
    expect(groupEntries([])).toEqual([]);
  });
});

describe("tooltipView — o tooltip curto (REQ-BAR-044, REQ-BAR-039)", () => {
  const sword = makeEntry("strike:a", {
    label: "Hanabi (corpo a corpo)",
    cost: { kind: "action", count: 1 },
    traits: ["Ágil", "Sutil"],
    badge: "+9",
    range: { kind: "reach", feet: 5 },
    effect: "Dano 1d4+4 cortante.",
    variants: [
      {
        id: "map:0",
        axis: "map",
        label: "1º ataque",
        badge: "+9",
        hint: "depois deste: MAP −5",
        isDefault: true,
      },
      { id: "map:1", axis: "map", label: "2º ataque", badge: "+4", hint: "depois deste: MAP −10" },
    ],
  });

  it("nome, custo, traços, bônus, alcance e uma linha de efeito", () => {
    const view = tooltipView(sword, "pt-BR", { hasDetails: false });

    expect(view.title).toBe("Hanabi (corpo a corpo)");
    expect(view.cost).toEqual({ glyphs: "◆", label: "1 ação" });
    expect(view.traits).toEqual(["Ágil", "Sutil"]);
    expect(view.numbers).toEqual({ label: "Bônus", value: "+9", variant: "1º ataque" });
    expect(view.effect).toBe("Dano 1d4+4 cortante.");
  });

  it("REQ-BAR-039: o golpe diz o que muda no ataque seguinte", () => {
    expect(tooltipView(sword, "pt-BR", { hasDetails: false }).hint).toBe("depois deste: MAP −5");
  });

  it("a linha de subtítulo: o que é, o grupo e o alcance", () => {
    expect(tooltipView(sword, "pt-BR", { hasDetails: false }).subtitle).toBe(
      "Golpe · corpo a corpo · alcance 5 pés",
    );
    const spell = makeEntry("spell:m:a", {
      group: "1º patamar",
      range: { kind: "range", feet: 30 },
    });
    expect(tooltipView(spell, "pt-BR", { hasDetails: false }).subtitle).toBe(
      "Magia · 1º patamar · à distância · alcance 30 pés",
    );
    expect(tooltipView(makeEntry("check:a"), "pt-BR", { hasDetails: false }).subtitle).toBe(
      "Teste",
    );
  });

  it("o rótulo 'Bônus' vale para o sinal de mais, para o menos tipográfico e para o hífen; a CD não ganha rótulo", () => {
    const label = (badge: string) =>
      tooltipView(makeEntry("check:a", { badge }), "pt-BR", { hasDetails: false }).numbers?.label;

    expect(label("+9")).toBe("Bônus");
    expect(label("−1")).toBe("Bônus");
    expect(label("-1")).toBe("Bônus");
    expect(label("CD 18")).toBeNull();
  });

  describe("o bônus aparece uma vez: o efeito que já o diz dispensa a linha de números (nota da BAR-F2-02)", () => {
    const view = (badge: string, effect: string) =>
      tooltipView(makeEntry("strike:a", { badge, effect }), "pt-BR", { hasDetails: false });

    it("a linha do protótipo ('Bônus +5 (base +9, MAP −4) · Dano …') já traz o bônus: a linha de números some", () => {
      const effect = "Bônus +5 (base +9, MAP −4) · Dano: 1d8 +4 cortante";

      const shown = view("+5", effect);

      expect(shown.numbers).toBeNull();
      expect(shown.effect).toBe(effect);
      // A linha ocupa o lugar da linha de números, com o número em negrito: onde ele está.
      expect(shown.effectFigure).toEqual({ start: 6, end: 8 });
      expect(effect.slice(6, 8)).toBe("+5");
    });

    it("o menos tipográfico, o travessão e o hífen são o mesmo sinal, e o trecho é um índice do texto original", () => {
      expect(view("−1", "Bônus -1 (base +9, MAP −10)").numbers).toBeNull();
      expect(view("-1", "Bônus −1 (base +9, MAP −10)").numbers).toBeNull();
      expect(view("-1", "Bônus –1 (base +9, MAP −10)").numbers).toBeNull();

      const effect = "Bônus −1 (base +9, MAP −10)";
      const span = view("-1", effect).effectFigure;
      expect(span).toEqual({ start: 6, end: 8 });
      expect(effect.slice(span?.start, span?.end)).toBe("−1");
    });

    it("só o primeiro número dito é o destacado, e o resto do texto fica inteiro nos dois lados", () => {
      const effect = "Bônus +5 e, na presa, +5 de novo";
      const span = view("+5", effect).effectFigure;

      expect(span).toEqual({ start: 6, end: 8 });
      expect(effect.slice(0, 6) + effect.slice(6, 8) + effect.slice(8)).toBe(effect);
    });

    it("uma CD dita no efeito também", () => {
      expect(view("CD 18", "Reflexos, CD 18, 4d6 de eletricidade").numbers).toBeNull();
    });

    it("um número que só aparece DENTRO de outro não conta como dito: 1d4+4 não diz +4, +50 não diz +5", () => {
      expect(view("+4", "Dano 1d4+4 cortante.").numbers).toEqual({
        label: "Bônus",
        value: "+4",
        variant: null,
      });
      expect(view("+5", "Bônus +50 contra a presa").numbers?.value).toBe("+5");
      expect(view("CD 18", "CD 180").numbers?.value).toBe("CD 18");
      // E sem o número dito, o efeito segue como parágrafo, não como linha de números.
      expect(view("+4", "Dano 1d4+4 cortante.").effectFigure).toBeNull();
      expect(view("+5", "Bônus +50 contra a presa").effectFigure).toBeNull();
    });

    it("efeito que não fala do número, ou ausente, deixa a linha de números onde estava", () => {
      expect(view("+9", "1d8 cortante").numbers?.value).toBe("+9");
      const noEffect = tooltipView(makeEntry("strike:a", { badge: "+9" }), "pt-BR", {
        hasDetails: false,
      });
      expect(noEffect.numbers?.value).toBe("+9");
      expect(noEffect.effect).toBeNull();
      expect(noEffect.effectFigure).toBeNull();
    });

    it("sem bônus nenhum, não há linha de números, diga o efeito o que disser", () => {
      expect(
        tooltipView(makeEntry("action:a", { effect: "Bônus +5" }), "pt-BR", { hasDetails: false })
          .numbers,
      ).toBeNull();
      expect(
        tooltipView(makeEntry("action:a", { effect: "Bônus +5" }), "pt-BR", { hasDetails: false })
          .effectFigure,
      ).toBeNull();
    });
  });

  it("CD aparece como vem; bônus ganha o rótulo", () => {
    const dc = makeEntry("spell:m:a", { badge: "CD 18" });
    expect(tooltipView(dc, "pt-BR", { hasDetails: false }).numbers).toEqual({
      label: null,
      value: "CD 18",
      variant: null,
    });
  });

  it("REQ-BAR-031: a entrada esmaecida diz por quê, no próprio tooltip", () => {
    const off = makeEntry("action:command", {
      state: "unavailable",
      reason: "Já comandou neste turno",
    });
    const view = tooltipView(off, "pt-BR", { hasDetails: false });

    expect(view.why).toEqual({ kind: "unavailable", reason: "Já comandou neste turno" });
    const spent = makeEntry("reaction:a", {
      state: "spent-until-recharge",
      reason: "Reação gasta",
    });
    expect(tooltipView(spent, "pt-BR", { hasDetails: false }).why).toEqual({
      kind: "spent",
      reason: "Reação gasta",
    });
    expect(tooltipView(makeEntry("action:a"), "pt-BR", { hasDetails: false }).why).toBeNull();
  });

  it("o rodapé só promete Alt se o sistema tem painel de detalhe", () => {
    expect(tooltipView(sword, "pt-BR", { hasDetails: true }).footer).toBe("alt-and-menu");
    expect(tooltipView(sword, "pt-BR", { hasDetails: false }).footer).toBe("menu");
  });

  it("sem custo, sem traços, sem efeito: o tooltip não inventa nada", () => {
    const bare = tooltipView(makeEntry("check:a", { label: "Percepção" }), "pt-BR", {
      hasDetails: false,
    });

    expect(bare.cost).toBeNull();
    expect(bare.traits).toEqual([]);
    expect(bare.effect).toBeNull();
    expect(bare.numbers).toBeNull();
    expect(bare.hint).toBeNull();
  });
});
