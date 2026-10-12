/**
 * actionBarController.test.ts — what the bar DOES when the user touches it (BAR-F1-04; spec 53
 * REQ-BAR-041, REQ-BAR-042, REQ-BAR-035, REQ-BAR-104, Q-BAR-11, D-15; tasks.md §2.8).
 *
 * The component is markup. Everything that is behaviour — a click, a second click while the first is
 * still running, a refusal, a key, the tab, folding the bar, the short message on the strip, "end
 * turn" — is the controller's, a `.svelte.ts` module: the Svelte plugin compiles its `$state` under
 * Vitest, so it is exercised here without a DOM (§2.10).
 *
 * D-15 / REQ-BAR-104: a FADED entry is clicked all the same. The bar does not decide that a thing
 * cannot be done; the sheet's own function refuses, when it refuses (no target, no quantity, no slot,
 * no focus), and the refusal comes back as a message on the strip.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../i18n/index.js";
import { combatStore, combatActions } from "../../combat/combatStore.svelte.js";
import {
  createActionBarController,
  type ControllerDeps,
  type ResolvedBar,
} from "../actionBarController.svelte.js";
import { seedFromEntries } from "../favoritesSource.js";
import type { ActionBarEntry } from "../types.js";
import { memoryFavoritesOfIds } from "./memoryFavorites.js";
import {
  createStubProvider,
  makeContext,
  makeEntry,
  makeServices,
  STUB_ACTOR_ID,
  type StubExecuteCall,
} from "./stubProvider.js";

// ---------------------------------------------------------------------------
// A controller wired to the stub provider
// ---------------------------------------------------------------------------

interface Setup {
  controller: ReturnType<typeof createActionBarController>;
  favorites: ReturnType<typeof memoryFavoritesOfIds>;
  stub: ReturnType<typeof createStubProvider>;
  services: ReturnType<typeof makeServices>;
  noted: string[];
  targets: { value: string[] };
  bar: { current: ResolvedBar | null };
}

function setup(
  options: {
    entries?: ActionBarEntry[];
    onExecute?: (call: StubExecuteCall) => Promise<void>;
    actorId?: string;
    withFavorites?: boolean;
  } = {},
): Setup {
  const stub = createStubProvider({
    ...(options.entries === undefined ? {} : { entries: options.entries }),
    ...(options.onExecute === undefined ? {} : { onExecute: options.onExecute }),
  });
  const ctx = makeContext(options.actorId === undefined ? {} : { actorId: options.actorId });
  const bar: { current: ResolvedBar | null } = {
    current: { ctx, provider: stub.provider, entries: stub.entries },
  };
  const services = makeServices();
  const noted: string[] = [];
  const targets = { value: [] as string[] };
  // The row the seed would give: the keys 1–9… run the first strikes, spells and actions.
  const favorites = memoryFavoritesOfIds(seedFromEntries(stub.entries));
  const deps: ControllerDeps = {
    current: () => bar.current,
    services: () => services,
    targets: () => targets.value,
    favorites: () => (options.withFavorites === false ? null : favorites),
    noteUsed: (actorId) => {
      noted.push(actorId);
    },
  };
  const controller = createActionBarController(deps);
  // The component hands the provider services whose `notify` writes on the bar's strip; the test
  // wires the recording services the same way, keeping their own record of what was said.
  const recordNotice = services.notify;
  services.notify = (message) => {
    recordNotice(message);
    controller.notify(message);
  };
  return { controller, favorites, stub, services, noted, targets, bar };
}

/** A promise settled by hand — a slow `execute`. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const sword = () => makeEntry("strike:stub-sword", { tab: "strikes", label: "Espada Longa" });

/** A strike that offers the three MAP variants (1º, 2º, 3º ataque), the first one the default. */
function withMapVariants(entry: ActionBarEntry): ActionBarEntry {
  return {
    ...entry,
    variants: [
      { id: "map:0", axis: "map", label: "1º ataque", badge: "+9", isDefault: true },
      { id: "map:1", axis: "map", label: "2º ataque", badge: "+4", hint: "depois deste: MAP −10" },
      { id: "map:2", axis: "map", label: "3º ataque", badge: "−1" },
    ],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  combatStore.combat = null;
  combatStore.error = null;
  combatStore.busy = false;
});

// ---------------------------------------------------------------------------
// runEntry
// ---------------------------------------------------------------------------

describe("runEntry — o clique executa a variante padrão (REQ-BAR-041)", () => {
  it("chama provider.execute(entry, choice, services, ctx) com o ctx do ator ativo", async () => {
    const s = setup();
    const entry = s.stub.entries[0]!;

    await s.controller.runEntry(entry);

    expect(s.stub.calls.execute).toHaveLength(1);
    const call = s.stub.calls.execute[0]!;
    expect(call.entry).toBe(entry);
    expect(call.ctx).toBe(s.bar.current!.ctx);
    expect(call.services).toBe(s.services);
    expect(call.choice).toEqual({ variants: {}, targetTokenIds: [], via: "click" });
  });

  it("o clique comum NÃO escolhe variante: variants sai vazio mesmo quando a entrada tem variantes (o MAP é o que o servidor conta no instante do clique)", async () => {
    const striker = withMapVariants(sword());
    const s = setup({ entries: [striker] });

    await s.controller.runEntry(striker);

    const choice = s.stub.calls.execute[0]?.choice;
    // `toEqual` ignora chave com valor undefined; o que o contrato pede é nenhuma chave, nem a padrão.
    expect(Object.keys(choice?.variants ?? { map: "ausente" })).toEqual([]);
    expect(choice?.via).toBe("click");
  });

  it("REQ-BAR-042: os alvos marcados no instante do clique vão na escolha — o provedor nunca os lê sozinho", async () => {
    const s = setup();
    s.targets.value = ["tok-capitao"];

    await s.controller.runEntry(s.stub.entries[0]!);
    s.targets.value = ["tok-capitao", "tok-lacaio"];
    await s.controller.runEntry(s.stub.entries[0]!);

    expect(s.stub.calls.execute[0]?.choice.targetTokenIds).toEqual(["tok-capitao"]);
    expect(s.stub.calls.execute[1]?.choice.targetTokenIds).toEqual(["tok-capitao", "tok-lacaio"]);
  });

  it("a escolha dada pelo chamador (o menu) vale sobre o padrão", async () => {
    const s = setup();

    await s.controller.runEntry(s.stub.entries[0]!, {
      variants: { map: "map:1" },
      via: "menu",
      targetTokenIds: ["tok-x"],
    });

    expect(s.stub.calls.execute[0]?.choice).toEqual({
      variants: { map: "map:1" },
      targetTokenIds: ["tok-x"],
      via: "menu",
    });
  });

  it("sem barra desenhada (Mestre sem seleção, ator sem provedor), clicar não chama ninguém", async () => {
    const s = setup();
    s.bar.current = null;

    await s.controller.runEntry(s.stub.entries[0]!);

    expect(s.stub.calls.execute).toEqual([]);
  });

  it("execução bem-sucedida anota o ator como o último usado (Q-BAR-01)", async () => {
    const s = setup({ actorId: "actor-bhrotto" });

    await s.controller.runEntry(s.stub.entries[0]!);

    expect(s.noted).toEqual(["actor-bhrotto"]);
  });
});

describe("o slot fica ocupado até o execute resolver (sem rolagem em dobro)", () => {
  it("o segundo clique durante a execução é ignorado; depois dela, o clique volta a valer", async () => {
    const gate = deferred();
    const s = setup({ onExecute: () => gate.promise });
    const entry = s.stub.entries[0]!;

    const first = s.controller.runEntry(entry);
    const second = s.controller.runEntry(entry);
    await second;

    expect(s.stub.calls.execute).toHaveLength(1);
    expect(s.controller.isBusy(entry.id)).toBe(true);

    gate.resolve();
    await first;

    expect(s.controller.isBusy(entry.id)).toBe(false);
    await s.controller.runEntry(entry);
    expect(s.stub.calls.execute).toHaveLength(2);
  });

  it("só o PRÓPRIO slot fica ocupado: outro slot executa enquanto o primeiro corre", async () => {
    const gate = deferred();
    const s = setup({
      onExecute: (call) =>
        call.entry.id === "strike:stub-sword" ? gate.promise : Promise.resolve(),
    });
    const [a, b] = [s.stub.entries[0]!, s.stub.entries[1]!];

    const slow = s.controller.runEntry(a);
    await s.controller.runEntry(b);

    expect(s.stub.calls.execute.map((c) => c.entry.id)).toEqual([a.id, b.id]);
    expect(s.controller.isBusy(a.id)).toBe(true);
    expect(s.controller.isBusy(b.id)).toBe(false);

    gate.resolve();
    await slow;
  });

  it("o mesmo id em outro ator não é o mesmo slot (o id só é único dentro do ator)", async () => {
    const gate = deferred();
    const s = setup({ onExecute: () => gate.promise });
    const entry = s.stub.entries[0]!;

    const first = s.controller.runEntry(entry);
    s.bar.current = { ...s.bar.current!, ctx: makeContext({ actorId: "actor-outro" }) };
    const other = s.controller.runEntry(entry);

    expect(s.stub.calls.execute).toHaveLength(2);
    gate.resolve();
    await Promise.all([first, other]);
  });
});

describe("recusa e erro viram mensagem na faixa (services.notify)", () => {
  it("o erro do provedor vira a mensagem e o slot é liberado", async () => {
    const s = setup({ onExecute: () => Promise.reject(new Error("Sem pontos de foco")) });
    const entry = s.stub.entries[0]!;

    await s.controller.runEntry(entry);

    expect(s.services.notices).toEqual(["Sem pontos de foco"]);
    expect(s.controller.isBusy(entry.id)).toBe(false);
    expect(s.noted).toEqual([]);
  });

  it("erro que não é Error (ou sem texto) cai na mensagem genérica", async () => {
    const s = setup({ onExecute: () => Promise.reject("falhou") });

    await s.controller.runEntry(s.stub.entries[0]!);
    const t = setup({ onExecute: () => Promise.reject(new Error("   ")) });
    await t.controller.runEntry(t.stub.entries[0]!);

    expect(s.services.notices).toEqual(["Não foi possível executar."]);
    expect(t.services.notices).toEqual(["Não foi possível executar."]);
  });

  it("um erro síncrono do provedor também não derruba a barra", async () => {
    const s = setup({
      onExecute: () => {
        throw new Error("quebrou antes de devolver a promessa");
      },
    });

    await expect(s.controller.runEntry(s.stub.entries[0]!)).resolves.toBeUndefined();

    expect(s.services.notices).toEqual(["quebrou antes de devolver a promessa"]);
  });
});

describe("D-15 / REQ-BAR-104 / CA-BAR-17: esmaecer é sinal, não trava", () => {
  it("a entrada indisponível por estado de turno recebe o clique e chega ao provedor", async () => {
    const command = makeEntry("action:stub-command", {
      tab: "actions",
      state: "unavailable",
      reason: "Já comandou neste turno",
    });
    const s = setup({ entries: [command] });

    await s.controller.runEntry(command);

    expect(s.stub.calls.execute).toHaveLength(1);
    expect(s.stub.calls.execute[0]?.entry.id).toBe("action:stub-command");
  });

  it("a gasta até recarregar também (a reação já usada)", async () => {
    const reaction = makeEntry("reaction:stub-reactive-strike", {
      tab: "reactions",
      state: "spent-until-recharge",
      reason: "Reação já gasta",
    });
    const s = setup({ entries: [reaction] });

    await s.controller.runEntry(reaction);

    expect(s.stub.calls.execute).toHaveLength(1);
  });

  it("quatro golpes e um quinto: nenhum fica bloqueado por custo ou por MAP (CA-BAR-04)", async () => {
    const s = setup({ entries: [sword()] });
    const entry = s.stub.entries[0]!;

    for (let i = 0; i < 5; i += 1) await s.controller.runEntry(entry);

    expect(s.stub.calls.execute).toHaveLength(5);
  });

  it("a recusa de quem recusa (a função da ficha) volta como mensagem, e o clique seguinte ainda vale", async () => {
    let calls = 0;
    const s = setup({
      onExecute: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error("Sem alvo marcado")) : Promise.resolve();
      },
    });
    const entry = s.stub.entries[0]!;

    await s.controller.runEntry(entry);
    await s.controller.runEntry(entry);

    expect(s.services.notices).toEqual(["Sem alvo marcado"]);
    expect(s.stub.calls.execute).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// runFavorite — the keys 1–9, 0, − and =
// ---------------------------------------------------------------------------

describe("runFavorite — as teclas (REQ-BAR-048)", () => {
  it("executa o favorito da posição, com via 'key'", async () => {
    const s = setup();

    await s.controller.runFavorite(0);

    expect(s.stub.calls.execute).toHaveLength(1);
    expect(s.stub.calls.execute[0]?.entry.id).toBe("strike:stub-sword");
    expect(s.stub.calls.execute[0]?.choice.via).toBe("key");
  });

  it("a tecla também não escolhe variante: variants sai vazio, mesmo com a entrada tendo variantes", async () => {
    const striker = withMapVariants(sword());
    const s = setup({ entries: [striker] });

    await s.controller.runFavorite(0);

    const choice = s.stub.calls.execute[0]?.choice;
    expect(Object.keys(choice?.variants ?? { map: "ausente" })).toEqual([]);
    expect(choice?.via).toBe("key");
  });

  it("a posição é a da tecla: o slot 2 é o segundo favorito", async () => {
    const s = setup();

    await s.controller.runFavorite(1);

    expect(s.stub.calls.execute[0]?.entry.id).toBe("strike:stub-bow");
  });

  it("slot vazio não faz nada", async () => {
    const s = setup({ entries: [sword()] });

    await s.controller.runFavorite(5);

    expect(s.stub.calls.execute).toEqual([]);
  });

  it("posição fora da linha não faz nada: nem -1, nem 12, nem fracionária", async () => {
    const s = setup();

    for (const index of [-1, 12, 99, 1.5, Number.NaN]) await s.controller.runFavorite(index);

    expect(s.stub.calls.execute).toEqual([]);
  });

  it("as teclas seguem a POSIÇÃO gravada: desafixar o slot 1 não puxa os outros — a tecla 3 continua sendo o terceiro favorito", async () => {
    const s = setup();

    s.favorites.unpin("strike:stub-sword");
    await s.controller.runFavorite(2);

    expect(s.favorites.slots().slice(0, 3)).toEqual([
      null,
      "strike:stub-bow",
      "spell:stub-main:burst",
    ]);
    expect(s.stub.calls.execute.map((call) => call.entry.id)).toEqual(["spell:stub-main:burst"]);
    expect(s.controller.canRunFavorite(0)).toBe(false);
  });

  it("fixar entra no primeiro buraco, e a tecla daquela posição executa o que foi fixado", async () => {
    const s = setup({ entries: [sword(), makeEntry("item:stub-potion", { tab: "items" })] });
    s.favorites.pin("item:stub-potion");

    await s.controller.runFavorite(1);

    expect(s.stub.calls.execute.map((call) => call.entry.id)).toEqual(["item:stub-potion"]);
  });

  it("trocar dois favoritos de lugar troca as teclas: a que era de um passa a ser do outro", async () => {
    const s = setup();

    s.favorites.move(0, 1);
    await s.controller.runFavorite(0);
    await s.controller.runFavorite(1);

    expect(s.stub.calls.execute.map((call) => call.entry.id)).toEqual([
      "strike:stub-bow",
      "strike:stub-sword",
    ]);
  });

  it("favorito que não está mais na ficha não executa nada", async () => {
    const s = setup({ entries: [sword()] });
    s.bar.current = { ...s.bar.current!, entries: [] };

    await s.controller.runFavorite(0);

    expect(s.stub.calls.execute).toEqual([]);
  });

  it("sem fonte de favoritos, ou sem barra, as teclas não fazem nada", async () => {
    const noFavorites = setup({ withFavorites: false });
    await noFavorites.controller.runFavorite(0);
    const noBar = setup();
    noBar.bar.current = null;
    await noBar.controller.runFavorite(0);

    expect(noFavorites.stub.calls.execute).toEqual([]);
    expect(noBar.stub.calls.execute).toEqual([]);
  });

  it("a tecla durante a execução do mesmo slot também é ignorada", async () => {
    const gate = deferred();
    const s = setup({ onExecute: () => gate.promise });

    const first = s.controller.runFavorite(0);
    await s.controller.runFavorite(0);

    expect(s.stub.calls.execute).toHaveLength(1);
    gate.resolve();
    await first;
  });
});

describe("canRunFavorite — a tecla só é consumida se há o que executar (REQ-BAR-048)", () => {
  it("verdadeiro para um favorito que está na ficha", () => {
    const s = setup();

    expect(s.controller.canRunFavorite(0)).toBe(true);
    expect(s.controller.canRunFavorite(1)).toBe(true);
  });

  it("falso para slot vazio, posição inválida, favorito que saiu da ficha, sem barra e sem fonte", () => {
    const s = setup({ entries: [sword()] });
    expect(s.controller.canRunFavorite(5)).toBe(false);
    for (const index of [-1, 12, 1.5, Number.NaN])
      expect(s.controller.canRunFavorite(index)).toBe(false);

    s.bar.current = { ...s.bar.current!, entries: [] };
    expect(s.controller.canRunFavorite(0)).toBe(false);

    s.bar.current = null;
    expect(s.controller.canRunFavorite(0)).toBe(false);
    expect(setup({ withFavorites: false }).controller.canRunFavorite(0)).toBe(false);
  });

  it("concorda com runFavorite: o que ele diz que pode, executa", async () => {
    const s = setup();

    expect(s.controller.canRunFavorite(0)).toBe(true);
    await s.controller.runFavorite(0);

    expect(s.stub.calls.execute).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// tab, fold, hover, notice
// ---------------------------------------------------------------------------

describe("a aba (REQ-BAR-026)", () => {
  it("começa em Favoritos e troca", () => {
    const s = setup();

    expect(s.controller.tab).toBe("favorites");
    s.controller.setTab("spells");
    expect(s.controller.tab).toBe("spells");
    s.controller.setTab("favorites");
    expect(s.controller.tab).toBe("favorites");
  });

  it("trocar de aba fecha o menu e o efeito da condição, e solta o que estava sob o mouse", () => {
    const s = setup();
    s.controller.openMenu("strike:stub-sword", { x: 10, y: 20 }, "pointer");
    s.controller.toggleCondition("frightened");
    s.controller.setHovered(s.stub.entries[0]!);

    s.controller.setTab("actions");

    expect(s.controller.menu).toBeNull();
    expect(s.controller.openCondition).toBeNull();
    expect(s.controller.hovered).toBeNull();
  });
});

describe("recolher (REQ-BAR-033, REQ-BAR-025)", () => {
  it("o botão alterna, em memória", () => {
    const s = setup();

    expect(s.controller.collapsed).toBe(false);
    s.controller.toggleCollapsed();
    expect(s.controller.collapsed).toBe(true);
    s.controller.toggleCollapsed();
    expect(s.controller.collapsed).toBe(false);
  });

  it("recolher fecha o que estava aberto (menu, efeito, tooltip de um slot que sumiu)", () => {
    const s = setup();
    s.controller.openMenu("strike:stub-sword", { x: 1, y: 1 }, "pointer");
    s.controller.setHovered(s.stub.entries[0]!);

    s.controller.toggleCollapsed();

    expect(s.controller.menu).toBeNull();
    expect(s.controller.hovered).toBeNull();
  });

  it("a área livre estreita recolhe sozinha; alargar devolve, se foi ela quem recolheu", () => {
    const s = setup();

    s.controller.syncNarrow(true);
    expect(s.controller.collapsed).toBe(true);

    s.controller.syncNarrow(false);
    expect(s.controller.collapsed).toBe(false);
  });

  it("quem recolheu foi o usuário: alargar a tela não expande por ele", () => {
    const s = setup();
    s.controller.toggleCollapsed();

    s.controller.syncNarrow(true);
    s.controller.syncNarrow(false);

    expect(s.controller.collapsed).toBe(true);
  });

  it("o usuário pode expandir mesmo com a área estreita, e isso vale até a tela mudar de novo", () => {
    const s = setup();
    s.controller.syncNarrow(true);

    s.controller.toggleCollapsed();
    expect(s.controller.collapsed).toBe(false);
    s.controller.syncNarrow(true);
    expect(s.controller.collapsed).toBe(false);

    s.controller.syncNarrow(false);
    s.controller.syncNarrow(true);
    expect(s.controller.collapsed).toBe(true);
  });
});

describe("hovered — a entrada sob o mouse (REQ-BAR-039)", () => {
  it("setHovered / clearHovered", () => {
    const s = setup();
    const entry = s.stub.entries[0]!;

    s.controller.setHovered(entry);
    expect(s.controller.hovered).toBe(entry);

    s.controller.clearHovered(entry);
    expect(s.controller.hovered).toBeNull();
  });

  it("sair de um slot depois de já ter entrado em outro não apaga o do outro", () => {
    const s = setup();
    const [a, b] = [s.stub.entries[0]!, s.stub.entries[1]!];

    s.controller.setHovered(a);
    s.controller.setHovered(b);
    s.controller.clearHovered(a);

    expect(s.controller.hovered).toBe(b);
  });

  it("segue a lista: depois que o provedor recalcula (o MAP andou), devolve a entrada NOVA, e a prévia da faixa não fica velha", () => {
    const s = setup();
    const before = withMapVariants(sword());
    s.bar.current = { ...s.bar.current!, entries: [before] };
    s.controller.setHovered(before);
    expect(s.controller.hovered).toBe(before);

    // O clique foi contado pelo servidor: o provedor devolve a mesma entrada com a dica nova.
    const after: ActionBarEntry = {
      ...before,
      variants: (before.variants ?? []).map((variant) => ({
        ...variant,
        hint: "depois deste: MAP −10",
      })),
    };
    s.bar.current = { ...s.bar.current!, entries: [after] };

    expect(s.controller.hovered).toBe(after);
    expect(s.controller.hovered).not.toBe(before);
  });

  it("some quando a entrada saiu da ficha, ou quando não há barra", () => {
    const s = setup();
    const entry = s.stub.entries[0]!;
    s.controller.setHovered(entry);

    s.bar.current = { ...s.bar.current!, entries: s.stub.entries.filter((e) => e.id !== entry.id) };
    expect(s.controller.hovered).toBeNull();

    s.bar.current = { ...s.bar.current!, entries: s.stub.entries };
    expect(s.controller.hovered).toBe(entry);
    s.bar.current = null;
    expect(s.controller.hovered).toBeNull();
  });
});

describe("notice — a mensagem curta da faixa", () => {
  it("aparece e some sozinha", () => {
    const s = setup();

    s.controller.notify("Sem alvo marcado");
    expect(s.controller.notice).toBe("Sem alvo marcado");

    vi.advanceTimersByTime(3999);
    expect(s.controller.notice).toBe("Sem alvo marcado");
    vi.advanceTimersByTime(1);
    expect(s.controller.notice).toBeNull();
  });

  it("uma mensagem nova reinicia a contagem e não é apagada pelo relógio da anterior", () => {
    const s = setup();

    s.controller.notify("primeira");
    vi.advanceTimersByTime(3000);
    s.controller.notify("segunda");
    vi.advanceTimersByTime(3000);

    expect(s.controller.notice).toBe("segunda");
    vi.advanceTimersByTime(1000);
    expect(s.controller.notice).toBeNull();
  });

  it("o erro de uma execução chega à faixa pelos serviços: services.notify → notice", async () => {
    const s = setup({ onExecute: () => Promise.reject(new Error("Sem foco")) });

    await s.controller.runEntry(s.stub.entries[0]!);

    expect(s.controller.notice).toBe("Sem foco");
  });
});

// ---------------------------------------------------------------------------
// the context menu, the condition effect, Esc
// ---------------------------------------------------------------------------

describe("menu de contexto e efeito da condição", () => {
  it("openMenu guarda qual entrada e onde; closeMenu fecha", () => {
    const s = setup();

    s.controller.openMenu("strike:stub-sword", { x: 120, y: 340 }, "pointer");
    expect(s.controller.menu).toEqual({
      entryId: "strike:stub-sword",
      x: 120,
      y: 340,
      via: "pointer",
    });

    s.controller.closeMenu();
    expect(s.controller.menu).toBeNull();
  });

  it("abrir o menu de outra entrada troca o menu, não empilha", () => {
    const s = setup();
    s.controller.openMenu("strike:stub-sword", { x: 1, y: 1 }, "pointer");

    s.controller.openMenu("strike:stub-bow", { x: 2, y: 2 }, "keyboard");

    expect(s.controller.menu?.entryId).toBe("strike:stub-bow");
    expect(s.controller.menu?.via).toBe("keyboard");
  });

  it("D-B23: clicar no chip revela o efeito; clicar de novo recolhe; outro chip troca", () => {
    const s = setup();

    s.controller.toggleCondition("frightened");
    expect(s.controller.openCondition).toBe("frightened");
    s.controller.toggleCondition("frightened");
    expect(s.controller.openCondition).toBeNull();
    s.controller.toggleCondition("frightened");
    s.controller.toggleCondition("hidden");
    expect(s.controller.openCondition).toBe("hidden");
  });

  it("cancel (Esc) fecha o menu e o efeito; canCancel diz se havia o que fechar", () => {
    const s = setup();
    expect(s.controller.canCancel).toBe(false);

    s.controller.openMenu("strike:stub-sword", { x: 1, y: 1 }, "pointer");
    expect(s.controller.canCancel).toBe(true);
    s.controller.cancel();
    expect(s.controller.menu).toBeNull();
    expect(s.controller.canCancel).toBe(false);

    s.controller.toggleCondition("frightened");
    expect(s.controller.canCancel).toBe(true);
    s.controller.cancel();
    expect(s.controller.openCondition).toBeNull();
  });

  it("reconcile: o menu de uma entrada que saiu da ficha (e não está fixada) fecha de vez, e o Esc volta a seguir para o canvas", () => {
    const s = setup({ withFavorites: false });
    s.controller.openMenu("strike:stub-sword", { x: 1, y: 1 }, "pointer");
    s.bar.current = {
      ...s.bar.current!,
      entries: s.stub.entries.filter((entry) => entry.id !== "strike:stub-sword"),
    };

    s.controller.reconcile();

    expect(s.controller.menu).toBeNull();
    expect(s.controller.canCancel).toBe(false);
  });

  it("reconcile: o menu de uma entrada que continua na ficha fica como está", () => {
    const s = setup();
    s.controller.openMenu("strike:stub-sword", { x: 1, y: 1 }, "pointer");
    s.bar.current = { ...s.bar.current!, entries: [...s.stub.entries] };

    s.controller.reconcile();

    expect(s.controller.menu?.entryId).toBe("strike:stub-sword");
    expect(s.controller.canCancel).toBe(true);
  });

  it("reconcile: fechado de vez, o menu não reabre sozinho quando a entrada volta", () => {
    const s = setup({ withFavorites: false });
    s.controller.openMenu("strike:stub-sword", { x: 1, y: 1 }, "pointer");
    s.bar.current = { ...s.bar.current!, entries: [] };
    s.controller.reconcile();

    s.bar.current = { ...s.bar.current!, entries: [...s.stub.entries] };
    s.controller.reconcile();

    expect(s.controller.menu).toBeNull();
  });

  it("reconcile: o menu de um favorito ÓRFÃO (fora da ficha, mas fixado) segue aberto — o Desafixar dele é a única saída", () => {
    const s = setup();
    s.controller.openMenu("strike:stub-sword", { x: 1, y: 1 }, "pointer");
    s.bar.current = {
      ...s.bar.current!,
      entries: s.stub.entries.filter((entry) => entry.id !== "strike:stub-sword"),
    };

    s.controller.reconcile();

    expect(s.controller.menu?.entryId).toBe("strike:stub-sword");
    expect(s.controller.canCancel).toBe(true);
  });

  it("reconcile: …e fecha de vez quando o órfão é desafixado", () => {
    const s = setup();
    s.controller.openMenu("strike:stub-sword", { x: 1, y: 1 }, "pointer");
    s.bar.current = {
      ...s.bar.current!,
      entries: s.stub.entries.filter((entry) => entry.id !== "strike:stub-sword"),
    };
    s.favorites.unpin("strike:stub-sword");

    s.controller.reconcile();

    expect(s.controller.menu).toBeNull();
    expect(s.controller.canCancel).toBe(false);
  });

  it("reconcile: o efeito de uma condição que passou (saiu da faixa) fecha de vez", () => {
    const s = setup();
    s.bar.current = { ...s.bar.current!, conditionIds: ["frightened", "hidden"] };
    s.controller.toggleCondition("frightened");
    expect(s.controller.canCancel).toBe(true);

    s.bar.current = { ...s.bar.current!, conditionIds: ["hidden"] };
    s.controller.reconcile();

    expect(s.controller.openCondition).toBeNull();
    expect(s.controller.canCancel).toBe(false);

    // Reaplicada depois, não abre sozinha: o chip volta fechado.
    s.bar.current = { ...s.bar.current!, conditionIds: ["frightened", "hidden"] };
    s.controller.reconcile();
    expect(s.controller.openCondition).toBeNull();
  });

  it("reconcile: a condição que continua na faixa fica aberta; sem a lista de condições nada é conferido", () => {
    const s = setup();
    s.bar.current = { ...s.bar.current!, conditionIds: ["frightened"] };
    s.controller.toggleCondition("frightened");
    s.controller.reconcile();
    expect(s.controller.openCondition).toBe("frightened");

    const bar = s.bar.current!;
    s.bar.current = { ctx: bar.ctx, provider: bar.provider, entries: bar.entries };
    s.controller.reconcile();
    expect(s.controller.openCondition).toBe("frightened");
  });

  it("reconcile: o hover num slot que sumiu é solto, e não volta sozinho com a entrada", () => {
    const s = setup();
    const entry = s.stub.entries[0]!;
    s.controller.setHovered(entry);
    s.bar.current = { ...s.bar.current!, entries: s.stub.entries.filter((e) => e.id !== entry.id) };
    s.controller.reconcile();

    s.bar.current = { ...s.bar.current!, entries: [...s.stub.entries] };

    expect(s.controller.hovered).toBeNull();
  });

  it("reconcile: sem barra desenhada, nem menu, nem efeito, nem hover sobram", () => {
    const s = setup();
    s.controller.openMenu("strike:stub-sword", { x: 1, y: 1 }, "pointer");
    s.controller.toggleCondition("frightened");
    s.controller.setHovered(s.stub.entries[0]!);

    s.bar.current = null;
    s.controller.reconcile();

    expect(s.controller.menu).toBeNull();
    expect(s.controller.openCondition).toBeNull();
    expect(s.controller.hovered).toBeNull();
    expect(s.controller.canCancel).toBe(false);
  });

  it("cancel sem nada aberto não faz nada e não lança", () => {
    const s = setup();

    expect(() => {
      s.controller.cancel();
    }).not.toThrow();
  });

  it("trocar de ator fecha o que era do outro (menu, efeito, tooltip) e mantém a aba escolhida", () => {
    const s = setup();
    s.controller.setTab("actions");
    s.controller.openMenu("strike:stub-sword", { x: 1, y: 1 }, "pointer");
    s.controller.toggleCondition("frightened");
    s.controller.setHovered(s.stub.entries[0]!);

    s.controller.resetForActor();

    expect(s.controller.menu).toBeNull();
    expect(s.controller.openCondition).toBeNull();
    expect(s.controller.hovered).toBeNull();
    expect(s.controller.tab).toBe("actions");
  });
});

// ---------------------------------------------------------------------------
// Encerrar turno
// ---------------------------------------------------------------------------

describe("endTurn — a mesma operação da aba Combate (REQ-BAR-035)", () => {
  it("chama combatActions.nextTurn com o socket vivo e o id do encontro em andamento", async () => {
    const nextTurn = vi.spyOn(combatActions, "nextTurn").mockResolvedValue(undefined);
    const socket = { id: "live-socket" };
    const s = setup();
    s.services.getSocket = () => socket as never;
    combatStore.combat = { _id: "combat-1", started: true, ended: false } as never;

    await s.controller.endTurn();

    expect(nextTurn).toHaveBeenCalledTimes(1);
    expect(nextTurn).toHaveBeenCalledWith(socket, "combat-1");
  });

  it("sem encontro, ou sem socket, não faz nada", async () => {
    const nextTurn = vi.spyOn(combatActions, "nextTurn").mockResolvedValue(undefined);
    const s = setup();
    s.services.getSocket = () => ({ id: "x" }) as never;

    await s.controller.endTurn();
    expect(nextTurn).not.toHaveBeenCalled();

    combatStore.combat = { _id: "combat-1", started: true, ended: false } as never;
    s.services.getSocket = () => null;
    await s.controller.endTurn();
    expect(nextTurn).not.toHaveBeenCalled();
  });

  it("com outra operação do combate em voo (busy), não chama de novo nem mostra um erro velho", async () => {
    const nextTurn = vi.spyOn(combatActions, "nextTurn").mockResolvedValue(undefined);
    const s = setup();
    s.services.getSocket = () => ({ id: "x" }) as never;
    combatStore.combat = { _id: "combat-1", started: true, ended: false } as never;
    combatStore.busy = true;
    combatStore.error = "erro de uma jogada anterior";

    await s.controller.endTurn();

    expect(nextTurn).not.toHaveBeenCalled();
    expect(s.services.notices).toEqual([]);
  });

  it("a recusa do servidor (quem não é dono da vez) aparece na faixa", async () => {
    vi.spyOn(combatActions, "nextTurn").mockImplementation(() => {
      combatStore.error = "Não é a sua vez";
      return Promise.resolve();
    });
    const s = setup();
    s.services.getSocket = () => ({ id: "x" }) as never;
    combatStore.combat = { _id: "combat-1", started: true, ended: false } as never;

    await s.controller.endTurn();

    expect(s.services.notices).toEqual(["Não é a sua vez"]);
  });
});

describe("a identidade do ator da barra", () => {
  it("o ator do stub é o do contexto padrão", () => {
    const s = setup();

    expect(s.bar.current?.ctx.actorId).toBe(STUB_ACTOR_ID);
  });
});
