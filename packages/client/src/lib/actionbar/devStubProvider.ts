/**
 * devStubProvider.ts — SCAFFOLDING (BAR-F1-04; removed by BAR-F2-07).
 *
 * A provider of MADE-UP content, registered only in a development build, so the shell of the action
 * bar (strip, tabs, slots, tooltip, menu, keys) can be seen and driven in the real app before any
 * game system registers its own provider (BAR-F2-07 does that, in `registerPf2eSheets`). It is
 * what the F1-04 card calls "o provedor stub, num registro de dev claramente marcado SCAFFOLDING":
 * the screenshots of the shell are taken with it, and the real content is photographed by BAR-F2-07.
 *
 * How it stays out of the product:
 *  - `TableScreen` loads this module behind `import.meta.env.DEV`, which a production build
 *    compiles to `false`: the dynamic import is dead code and the chunk is never emitted;
 *  - it registers a type only if nothing has registered it yet, so a real provider always wins;
 *  - the names are generic labels written for this stub — no Paizo text, no rules.
 *
 * It does what a provider does and nothing more: `entries` and `status` read the active actor's
 * context; `execute` posts one line to the chat through the sheet's own sender and, for the entry
 * that says so, refuses — to let the strip's message be seen. Nothing here rolls, spends or counts.
 */

import DevDetails from "../../components/actionbar/DevDetails.svelte";
import { actionBarRegistry, composeActionBarProvider } from "./actionBarRegistry.js";
import type {
  ActionBarContext,
  ActionBarEntry,
  ActionBarEntryKind,
  ActionBarProvider,
  ActionBarSlice,
  ActionBarStatus,
} from "./types.js";

const entry = (
  id: string,
  fields: Omit<ActionBarEntry, "id" | "kind"> & { kind?: ActionBarEntryKind },
): ActionBarEntry => {
  const kind = fields.kind ?? (id.slice(0, id.indexOf(":")) as ActionBarEntryKind);
  return { ...fields, id, kind };
};

/** A modifier the way the bar writes it: "+9", "−5" (the typographic minus). */
const signed = (value: number): string =>
  value >= 0 ? `+${String(value)}` : `−${String(Math.abs(value))}`;

/** The strike's MAP: after one attack in the turn the next is the second. */
function strikeVariants(base: number, agile: boolean, current: 0 | 1 | 2) {
  const penalties = agile ? [0, -4, -8] : [0, -5, -10];
  return [0, 1, 2].map((index) => {
    const penalty = penalties[index] ?? 0;
    const next = penalties[Math.min(index + 1, 2)] ?? 0;
    return {
      id: `map:${String(index)}`,
      axis: "map" as const,
      label: `${String(index + 1)}º ataque`,
      badge: signed(base + penalty),
      ...(index < 2
        ? { hint: `depois deste: MAP ${next === 0 ? "0" : `−${String(Math.abs(next))}`}` }
        : {}),
      ...(index === current ? { isDefault: true } : {}),
    };
  });
}

function entriesFor(ctx: ActionBarContext): ActionBarEntry[] {
  const current: 0 | 1 | 2 = ctx.combat.inCombat ? 1 : 0;
  return [
    // Strikes
    entry("strike:dev-sword", {
      tab: "strikes",
      label: "Espada Longa",
      shortLabel: "Espada",
      icon: "sword",
      cost: { kind: "action", count: 1 },
      traits: ["Versátil"],
      range: { kind: "reach", feet: 5 },
      target: "one",
      // The effect line the real strikes provider writes (the prototype's): it says the bonus itself,
      // so the tooltip does not repeat it in a row of its own.
      effect: `Bônus ${signed(9 + (current === 1 ? -5 : 0))} (base +9, MAP ${current === 1 ? "−5" : "0"}) · Dano: 1d8 cortante`,
      variants: strikeVariants(9, false, current),
    }),
    entry("strike:dev-bow", {
      tab: "strikes",
      label: "Arco Curto",
      shortLabel: "Arco",
      icon: "bow",
      cost: { kind: "action", count: 1 },
      traits: ["Propulsão"],
      range: { kind: "range", feet: 60 },
      target: "one",
      uses: { value: 18 },
      effect: "Dano perfurante à distância.",
      variants: strikeVariants(7, false, current),
    }),
    entry("strike:dev-fist", {
      tab: "strikes",
      label: "Punho",
      icon: "fist",
      cost: { kind: "action", count: 1 },
      traits: ["Ágil", "Sutil"],
      range: { kind: "reach", feet: 5 },
      target: "one",
      effect: "Sempre disponível.",
      variants: strikeVariants(9, true, current),
    }),
    // Spells
    entry("spell:dev-main:bolt", {
      tab: "spells",
      group: "Truques",
      label: "Rajada Elétrica",
      shortLabel: "Rajada",
      icon: "bolt",
      cost: { kind: "action", count: 2 },
      traits: ["Truque", "Eletricidade"],
      range: { kind: "range", feet: 30 },
      badge: "CD 18",
      rank: 2,
      target: "many",
      effect: "Uma descarga que salta de um alvo ao outro.",
    }),
    entry("spell:dev-main:ward", {
      tab: "spells",
      group: "Truques",
      label: "Escudo Arcano",
      shortLabel: "Escudo",
      icon: "shield",
      cost: { kind: "action", count: 1 },
      traits: ["Truque"],
      rank: 2,
      effect: "Um escudo de força até o início do seu próximo turno.",
    }),
    entry("spell:dev-main:missiles", {
      tab: "spells",
      group: "1º patamar",
      groupUses: { value: 2, max: 3, style: "count" },
      label: "Chuva de Força",
      shortLabel: "Chuva",
      icon: "missiles",
      cost: { kind: "activity", min: 1, max: 3, unit: "action" },
      traits: ["Evocação", "Força"],
      range: { kind: "range", feet: 120 },
      rank: 1,
      target: "many",
      effect: "Escolha 1, 2 ou 3 ações: um míssil por ação gasta.",
    }),
    entry("spell:dev-main:fear", {
      tab: "spells",
      group: "1º patamar",
      groupUses: { value: 2, max: 3, style: "count" },
      label: "Medo",
      icon: "eye",
      cost: { kind: "action", count: 2 },
      traits: ["Mental"],
      range: { kind: "range", feet: 30 },
      badge: "CD 19",
      rank: 1,
      target: "one",
      effect: "O alvo pode ficar amedrontado.",
    }),
    entry("spell:dev-focus:boost", {
      tab: "spells",
      group: "Foco",
      groupUses: { value: 0, max: 2, style: "pips" },
      label: "Impulsionar Eidolon",
      shortLabel: "Impulso",
      icon: "star",
      cost: { kind: "action", count: 1 },
      traits: ["Foco"],
      state: "unavailable",
      reason: "Sem pontos de foco (0/2). Recupere com Refocar, 10 minutos.",
    }),
    // Actions
    entry("action:dev-stride", {
      tab: "actions",
      group: "Básicas",
      label: "Deslocar",
      icon: "feet",
      cost: { kind: "action", count: 1 },
      effect: "Move até o seu deslocamento.",
    }),
    entry("action:dev-step", {
      tab: "actions",
      group: "Básicas",
      label: "Passo",
      icon: "foot",
      cost: { kind: "action", count: 1 },
      effect: "Move 5 pés sem provocar reações de movimento.",
    }),
    entry("action:dev-interact", {
      tab: "actions",
      group: "Básicas",
      label: "Interagir",
      icon: "hand",
      cost: { kind: "action", count: 1 },
      traits: ["Manipular"],
    }),
    entry("action:dev-seek", {
      tab: "actions",
      group: "Básicas",
      label: "Investigar",
      icon: "eye",
      cost: { kind: "action", count: 1 },
      traits: ["Concentrar", "Secreto"],
      badge: "+8",
    }),
    entry("toggle:dev-sneak", {
      tab: "actions",
      group: "Básicas",
      label: "Esgueirar",
      icon: "hood",
      cost: { kind: "none" },
      traits: ["Exploração"],
      state: "active",
      effect: "Move à metade do deslocamento, rolando Furtividade.",
    }),
    entry("action:dev-grapple", {
      tab: "actions",
      group: "Atletismo +9",
      label: "Agarrar",
      icon: "fist",
      cost: { kind: "action", count: 1 },
      traits: ["Ataque", "Manipular"],
      badge: "+9",
      countsForMap: true,
      target: "one",
    }),
    entry("action:dev-trip", {
      tab: "actions",
      group: "Atletismo +9",
      label: "Derrubar",
      icon: "down",
      cost: { kind: "action", count: 1 },
      traits: ["Ataque"],
      badge: "+9",
      countsForMap: true,
      target: "one",
    }),
    entry("action:dev-command", {
      tab: "actions",
      group: "Patrulheiro",
      label: "Comandar um Animal",
      icon: "paw",
      cost: { kind: "action", count: 1 },
      traits: ["Auditivo", "Concentrar"],
      state: "unavailable",
      reason: "Já comandou neste turno.",
    }),
    entry("action:dev-refuse", {
      tab: "actions",
      group: "Patrulheiro",
      label: "Caçar Presa (recusa de teste)",
      shortLabel: "Caçar",
      icon: "target",
      cost: { kind: "action", count: 1 },
      traits: ["Concentrar"],
      target: "one",
      effect: "Este stub recusa de propósito, para mostrar a mensagem da faixa.",
    }),
    // Items
    entry("item:dev-antidote", {
      tab: "items",
      group: "Consumíveis",
      label: "Antídoto Menor",
      shortLabel: "Antídoto",
      icon: "flask",
      cost: { kind: "action", count: 1 },
      uses: { value: 2 },
    }),
    entry("item:dev-elixir", {
      tab: "items",
      group: "Consumíveis",
      label: "Elixir da Vida Menor",
      shortLabel: "Elixir",
      icon: "flask",
      cost: { kind: "action", count: 1 },
      uses: { value: 0 },
      state: "unavailable",
      reason: "Acabou. Fabrique outro com Elaboração Alquímica.",
    }),
    entry("item:dev-torch", {
      tab: "items",
      group: "Ferramentas",
      label: "Tocha",
      icon: "torch",
      cost: { kind: "action", count: 1 },
      uses: { value: 5 },
    }),
    entry("item:dev-rope", {
      tab: "items",
      group: "Ferramentas",
      label: "Corda",
      icon: "rope",
      cost: { kind: "action", count: 1 },
    }),
    // Reactions
    entry("reaction:dev-reactive", {
      tab: "reactions",
      group: "Reações",
      label: "Golpe Reativo",
      icon: "react",
      cost: { kind: "reaction" },
      traits: ["Ataque"],
    }),
    entry("reaction:dev-dodge", {
      tab: "reactions",
      group: "Reações",
      label: "Esquiva Ágil",
      icon: "react",
      cost: { kind: "reaction" },
      state: "spent-until-recharge",
      reason: "Reação já gasta nesta rodada.",
    }),
    // Checks
    ...[
      ["perception", "Percepção", "+8"],
      ["fortitude", "Fortitude", "+6"],
      ["reflex", "Reflexos", "+11"],
      ["will", "Vontade", "+8"],
    ].map(([slug, label, bonus]) =>
      entry(`check:dev-${slug ?? ""}`, {
        tab: "checks",
        group: "Salvamentos e Percepção",
        label: label ?? "",
        icon: "d20",
        badge: bonus ?? "",
      }),
    ),
    ...[
      ["acrobatics", "Acrobacia", "+9"],
      ["athletics", "Atletismo", "+9"],
      ["stealth", "Furtividade", "+11"],
      ["nature", "Natureza", "+6"],
    ].map(([slug, label, bonus]) =>
      entry(`check:dev-skill-${slug ?? ""}`, {
        tab: "checks",
        group: "Perícias",
        label: label ?? "",
        icon: "d20",
        badge: bonus ?? "",
      }),
    ),
  ];
}

function statusFor(ctx: ActionBarContext): ActionBarStatus {
  const hp = ctx.derived["hp"] as { value?: number; max?: number; temp?: number } | undefined;
  const target = ctx.combat.targets[0];
  const type = typeof ctx.actor["type"] === "string" ? ctx.actor["type"] : "";
  const img = ctx.actor["img"];
  return {
    name: typeof ctx.actor["name"] === "string" ? ctx.actor["name"] : "?",
    subtitle: type === "npc" ? "Criatura" : "Personagem",
    // The stored portrait, as the real provider hands it over: the strip resolves it (ActorPortrait).
    ...(typeof img === "string" && img !== "" ? { portrait: img } : {}),
    hp: { value: hp?.value ?? 0, max: hp?.max ?? 0, temp: hp?.temp ?? 0 },
    // The armour class is the Mestre's (T6): a provider leaves it out for a player.
    ...(ctx.viewer.isGm ? { gmOnly: { ac: 24 } } : {}),
    resources: [
      { id: "focus", label: "Foco", style: "pips", value: 1, max: 2 },
      { id: "hero", label: "Herói", style: "pips", value: 1, max: 3 },
    ],
    conditions: [
      {
        id: "frightened",
        name: "Amedrontado",
        value: 1,
        effect: "Penalidade de status em todos os seus testes e CDs.",
      },
      {
        id: "hidden",
        name: "Escondido",
        effect: "Quem não localiza você exatamente fica desprevenido contra seus ataques.",
      },
    ],
    nextAttack: { mapPenalty: ctx.combat.inCombat ? -5 : 0 },
    target: target === undefined ? null : { tokenId: target.tokenId, name: target.name },
  };
}

/** One slice for every kind: this stub executes them all the same way. */
const ALL_KINDS: readonly ActionBarEntryKind[] = [
  "strike",
  "spell",
  "action",
  "item",
  "reaction",
  "toggle",
  "check",
];

const slice: ActionBarSlice = {
  kinds: ALL_KINDS,
  entries: entriesFor,
  execute(entryToRun, choice, services, ctx) {
    if (entryToRun.id === "action:dev-refuse") {
      return Promise.reject(new Error("Sem alvo marcado: escolha um alvo e tente de novo."));
    }
    services.sendOp({
      type: "chat:send",
      content: `${entryToRun.label} (barra de ações: conteúdo de teste, ${choice.via})`,
      worldId: services.worldId,
      speakerActorId: ctx.actorId,
    });
    return Promise.resolve();
  },
};

/**
 * Builds the stub provider. Composed like a real one, so the shell exercises the real validation of
 * entries (`assertValidEntries`) too.
 */
export function createDevStubProvider(): ActionBarProvider {
  return composeActionBarProvider({ slices: [slice], status: statusFor, details: DevDetails });
}

/**
 * Registers the stub for the actor types that have no provider yet (SCAFFOLDING). A real provider
 * registered before — or after — this wins.
 */
export function registerDevStubProvider(): void {
  for (const type of ["character", "npc", "familiar"]) {
    if (actionBarRegistry.resolve("Actor", type) === null) {
      actionBarRegistry.register("Actor", type, createDevStubProvider());
    }
  }
}
