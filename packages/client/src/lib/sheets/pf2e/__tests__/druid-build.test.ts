/**
 * druid-build.test.ts — verificação NÃO-CIRCULAR do Druid, a classe piloto da
 * r28 (a 15ª de `classes-core`).
 *
 * POR QUE ESTE ARQUIVO EXISTE (lição #48): `varredura-classes.test.ts` compara
 * a derivação contra a tabela do PRÓPRIO pack — é consistência interna, e um
 * pack errado passa com louvor (foi assim que 80 testes verdes conviveram com
 * 60 defeitos nas 12 primeiras classes). Aqui os valores esperados são
 * CONSTANTES LITERAIS, transcritas da regra publicada do Pathfinder 2e
 * remaster (Player Core, capítulo do Druid: "Key Attribute WISDOM",
 * "Hit Points 8 plus your Constitution modifier", tabela de proficiências
 * iniciais e a tabela "Druid Spells per Day"), e a mesma leitura que qualquer
 * construtor externo de ficha (Pathbuilder) produz. NENHUM número abaixo foi
 * lido de `systems/pf2e/packs/*` — se o pack estiver errado, ESTE arquivo
 * fica vermelho.
 *
 * Fica deliberadamente restrito aos níveis 1–5, que é a janela em que a mesa
 * de fato joga uma classe nova e a janela para a qual existe ficha oficial
 * publicada da icônica (Lini L1/L3/L5). `pregen-parity.test.ts` cobre a
 * comparação com essas fichas; este arquivo cobre a REGRA, que não depende de
 * ficha nenhuma.
 */

import { describe, it, expect, beforeAll } from "vitest";

import {
  CLASSES,
  CLASS_FEATURES,
  RATFOLK,
  sysOf,
  docName,
  cloneDoc,
  runFullDerivation,
  abilityModOf,
  readAbilities,
  buildCharacterToLevel20,
} from "./helpers/classBuildHarness.js";
import { derivePlan, spellSlotsForLevel, computeAbilityScores } from "../planVM.js";

// ---------------------------------------------------------------------------
// A REGRA, escrita à mão (fonte externa ao pack)
// ---------------------------------------------------------------------------

/** Ranks: 0 destreinado, 1 treinado, 2 perito, 3 mestre, 4 lendário. */
interface ExpectedProfs {
  perception: number;
  fortitude: number;
  reflex: number;
  will: number;
  weapons: { simple: number; martial: number; advanced: number; unarmed: number };
  armor: { unarmored: number; light: number; medium: number; heavy: number };
  classDC: number;
}

/**
 * Proficiências iniciais do Druid (Player Core, "Initial Proficiencies"):
 * treinado em Percepção; treinado em Fortitude e Reflexos, PERITO em Vontade;
 * treinado em armas simples e desarmadas (o Druid remaster não tem armas
 * marciais nem avançadas); treinado em armadura leve, média e defesa
 * desarmada (nunca pesada); treinado em ataque e CD de magia; treinado na CD
 * de classe.
 */
const L1: ExpectedProfs = {
  perception: 1,
  fortitude: 1,
  reflex: 1,
  will: 2,
  weapons: { simple: 1, martial: 0, advanced: 0, unarmed: 1 },
  armor: { unarmored: 1, light: 1, medium: 1, heavy: 0 },
  classDC: 1,
};

/**
 * O que a REGRA manda mudar em cada nível da janela 1–5:
 *  - nível 3: Perception Expertise (perito em Percepção) e Fortitude
 *    Expertise (perito em Fortitude);
 *  - nível 5: Reflex Expertise (perito em Reflexos).
 * Níveis 2 e 4 não mexem em proficiência nenhuma — o Druid ganha só talento
 * de classe/perícia. NADA sobe armadura, arma, CD de classe ou Vontade antes
 * do nível 11 (Wild Willpower) / 13 (Medium Armor Expertise, Weapon
 * Expertise), fora da janela deste arquivo.
 */
const EXPECTED_PROFS: Record<number, ExpectedProfs> = {
  1: L1,
  2: L1,
  3: { ...L1, perception: 2, fortitude: 2 },
  4: { ...L1, perception: 2, fortitude: 2 },
  5: { ...L1, perception: 2, fortitude: 2, reflex: 2 },
};

/**
 * Tabela "Druid Spells per Day" (Player Core) — conjurador PLENO: 5 truques
 * do nível 1 ao 20 e 3 slots por rank, com um rank novo entrando com 2 slots
 * a cada nível ímpar. Transcrita da regra, não do pack.
 */
const EXPECTED_SPELLS: Record<number, { cantrips: number; slots: Record<number, number> }> = {
  1: { cantrips: 5, slots: { 1: 2 } },
  2: { cantrips: 5, slots: { 1: 3 } },
  3: { cantrips: 5, slots: { 1: 3, 2: 2 } },
  4: { cantrips: 5, slots: { 1: 3, 2: 3 } },
  5: { cantrips: 5, slots: { 1: 3, 2: 3, 3: 2 } },
};

/**
 * Features de classe que a REGRA concede em cada nível da janela (Player
 * Core, tabela "Druid Advancement"). Níveis 2 e 4 não concedem feature.
 */
const EXPECTED_FEATURES: Record<number, string[]> = {
  1: [
    "Anathema (Druid)",
    "Druid Spellcasting",
    "Druidic Order",
    "Shield Block",
    "Voice of Nature",
    "Wildsong",
  ],
  2: [],
  3: ["Fortitude Expertise", "Perception Expertise"],
  4: [],
  5: ["Reflex Expertise"],
};

/** As 9 ordens druídicas do remaster (Player Core). */
const EXPECTED_ORDERS = [
  "Animal Order",
  "Cultivation Order",
  "Flame Order",
  "Leaf Order",
  "Spore Order",
  "Stone Order",
  "Storm Order",
  "Untamed Order",
  "Wave Order",
];

/** Player Core: "Hit Points 8 plus your Constitution modifier". */
const EXPECTED_HP_PER_LEVEL = 8;

// ---------------------------------------------------------------------------

describe("Druid (r28, classe piloto) — regra publicada vs. ficha derivada", () => {
  const druidDoc = CLASSES.find((c) => docName(c) === "Druid");
  let built: Record<string, unknown>;

  beforeAll(() => {
    expect(druidDoc, "Druid ausente de classes-core").toBeDefined();
    built = buildCharacterToLevel20(druidDoc!).doc;
  });

  it("o chassi declara Sabedoria como atributo-chave e conjuração primal preparada", () => {
    const sys = sysOf(druidDoc!);
    expect(sys["keyAbility"]).toEqual(["wis"]);
    const sc = sys["spellcasting"] as
      | { tradition?: string; type?: string; ability?: string }
      | undefined;
    expect(sc?.tradition).toBe("primal");
    expect(sc?.type).toBe("prepared");
    expect(sc?.ability).toBe("wis");
  });

  it.each([1, 2, 3, 4, 5])(
    "nível %i — proficiências batem com a regra publicada",
    (level: number) => {
      const want = EXPECTED_PROFS[level]!;
      const clone = cloneDoc(built);
      (sysOf(clone)["level"] as { value: number }).value = level;
      runFullDerivation(clone);
      const sys = sysOf(clone);

      const profs = sys["proficiencies"] as {
        weapons?: Record<string, number>;
        armor?: Record<string, number>;
        classDC?: { rank?: number };
      };
      const saves = sys["saves"] as Record<string, { rank?: number }>;
      const perception = sys["perception"] as { rank?: number };

      expect(perception.rank, `L${String(level)} perception`).toBe(want.perception);
      expect(saves["fortitude"]?.rank, `L${String(level)} fortitude`).toBe(want.fortitude);
      expect(saves["reflex"]?.rank, `L${String(level)} reflex`).toBe(want.reflex);
      expect(saves["will"]?.rank, `L${String(level)} will`).toBe(want.will);
      expect(profs.classDC?.rank, `L${String(level)} classDC`).toBe(want.classDC);

      for (const [cat, rank] of Object.entries(want.weapons)) {
        expect(profs.weapons?.[cat], `L${String(level)} weapons.${cat}`).toBe(rank);
      }
      for (const [cat, rank] of Object.entries(want.armor)) {
        expect(profs.armor?.[cat], `L${String(level)} armor.${cat}`).toBe(rank);
      }
    },
  );

  it.each([1, 2, 3, 4, 5])("nível %i — HP da classe é 8 por nível", (level: number) => {
    const clone = cloneDoc(built);
    (sysOf(clone)["level"] as { value: number }).value = level;
    runFullDerivation(clone);

    const hpMax = (
      (sysOf(clone)["attributes"] as Record<string, unknown> | undefined)?.["hp"] as
        | { max?: number }
        | undefined
    )?.max;
    expect(hpMax, `L${String(level)} sem hp.max`).toBeTypeOf("number");

    const ancestryHp = Number(sysOf(RATFOLK!)["hp"] ?? 0);
    const conMod = abilityModOf(computeAbilityScores(readAbilities(built), level).con);
    expect((hpMax! - ancestryHp) / level - conMod, `L${String(level)} HP por nível`).toBe(
      EXPECTED_HP_PER_LEVEL,
    );
  });

  it.each([1, 2, 3, 4, 5])(
    "nível %i — truques e slots batem com a tabela Druid Spells per Day",
    (level: number) => {
      const want = EXPECTED_SPELLS[level]!;
      const spellcasting = sysOf(druidDoc!)["spellcasting"];
      const { cantripsKnown, slotsByRank } = spellSlotsForLevel(
        spellcasting as Parameters<typeof spellSlotsForLevel>[0],
        level,
      );
      expect(cantripsKnown, `L${String(level)} truques`).toBe(want.cantrips);
      const got = Object.fromEntries(
        Object.entries(slotsByRank ?? {}).filter(([, n]) => Number(n) > 0),
      );
      expect(
        Object.fromEntries(Object.entries(got).map(([k, v]) => [Number(k), Number(v)])),
        `L${String(level)} slots por rank`,
      ).toEqual(want.slots);
    },
  );

  it("Sabedoria é treinada em Natureza no nível 1 (perícia automática da classe)", () => {
    const clone = cloneDoc(built);
    (sysOf(clone)["level"] as { value: number }).value = 1;
    runFullDerivation(clone);
    const skills = sysOf(clone)["skills"] as Record<string, { rank?: number }>;
    expect(skills["nature"]?.rank, "Nature no nível 1").toBeGreaterThanOrEqual(1);
  });

  it.each([1, 2, 3, 4, 5])(
    "nível %i — concede exatamente as features que a regra manda",
    (level: number) => {
      const classSys = sysOf(druidDoc!);
      const featuresByLevel =
        (classSys["featuresByLevel"] as Array<{ level: number; name: string }>) ?? [];
      const got = featuresByLevel
        .filter((f) => f.level === level)
        .map((f) => f.name)
        .sort();
      expect(got, `features do nível ${String(level)}`).toEqual([...EXPECTED_FEATURES[level]!]);
    },
  );

  it("o eixo de Ordem Druídica abre um slot no nível 1 com as 9 ordens do remaster", () => {
    const clone = cloneDoc(built);
    (sysOf(clone)["level"] as { value: number }).value = 1;
    runFullDerivation(clone);
    const plan = derivePlan(clone);

    const level1 = plan.levels.find((l) => l.level === 1);
    expect(level1, "plano sem nível 1").toBeDefined();
    const orderSlot = level1!.slots.find((s) => s.type === "order");
    expect(orderSlot, "nível 1 do Druid não abre slot de Ordem Druídica").toBeDefined();

    // As opções: docs de class-feature marcados com a otherTag do eixo. Os
    // NOMES esperados vêm da regra (constante literal acima), não de uma
    // varredura do pack — se o pack trouxer 8 ou 10 ordens, este teste reprova.
    const orders = CLASS_FEATURES.filter((d) => {
      const tags =
        ((sysOf(d)["traits"] as Record<string, unknown> | undefined)?.["otherTags"] as
          | string[]
          | undefined) ?? [];
      return tags.includes("druid-order");
    })
      .map((d) => docName(d))
      .sort();
    expect(orders).toEqual([...EXPECTED_ORDERS]);
  });
});
