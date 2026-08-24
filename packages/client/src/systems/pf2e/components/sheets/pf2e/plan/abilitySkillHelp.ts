/**
 * abilitySkillHelp.ts — curated, clean-room pt-BR help text for the Plan
 * column's two mechanical pickers (R12 item 2):
 *
 *   - AbilityBoostsDialog: what each of the six ability scores affects
 *     mechanically in the PF2e Remaster (a short, useful sentence per
 *     ability, not a rules dump).
 *   - SkillTrainingDialog: a 1-2 sentence description of each of the 16
 *     canonical skills with typical actions, plus the TEML proficiency legend
 *     (Untrained/Trained/Expert/Master/Legendary and their +0/+2/+4/+6/+8
 *     bonus over level).
 *
 * All text is hand-written for Fusion (NOT copied from any Paizo or Foundry
 * source — clean-room per CLAUDE.md). Strings live here rather than the shared
 * i18n bundle on purpose: this is Plan-territory content, kept inline like the
 * dialogs' other pt-BR literals ("Seleções restantes", etc.). Keeping it in a
 * plain TS module (no Svelte) makes it unit-testable.
 */

import { isLoreSlug } from "../../../../lib/sheets/pf2e/loreSlug.js";

/** Ability slugs, matching planVM.ts's ABILITY_SLUGS order. */
export type AbilityHelpSlug = "str" | "dex" | "con" | "int" | "wis" | "cha";

export interface AbilityHelp {
  /** Full pt-BR ability name (game term stays as the localized full label). */
  name: string;
  /** One-line, mechanically-focused summary of what the ability affects. */
  summary: string;
  /** The concrete things the modifier applies to, as short bullet phrases. */
  affects: string[];
}

/**
 * ABILITY_HELP — what each ability score does in the Remaster, curated for the
 * boost picker's side panel. Keyed by the same slugs planVM uses.
 */
export const ABILITY_HELP: Record<AbilityHelpSlug, AbilityHelp> = {
  str: {
    name: "Força",
    summary:
      "Mede o poder físico bruto. Governa ataques e dano corpo-a-corpo e o quanto você carrega.",
    affects: [
      "Ataques e dano corpo-a-corpo",
      "Perícia Atletismo (escalar, saltar, agarrar)",
      "Capacidade de carga (Volume)",
    ],
  },
  dex: {
    name: "Destreza",
    summary:
      "Mede agilidade e coordenação. Sustenta a defesa leve, os reflexos e os ataques à distância e ágeis.",
    affects: [
      "Classe de Armadura (com armadura leve/sem armadura)",
      "Testes de resistência de Reflexos",
      "Ataques à distância e com armas ágeis (finesse)",
      "Perícias Acrobacia, Furtividade e Ladinagem",
    ],
  },
  con: {
    name: "Constituição",
    summary:
      "Mede vigor e resistência. Determina quantos Pontos de Vida você tem e o quanto aguenta veneno e fadiga.",
    affects: ["Pontos de Vida (por nível)", "Testes de resistência de Fortitude"],
  },
  int: {
    name: "Inteligência",
    summary:
      "Mede raciocínio e memória. Concede perícias treinadas extras na criação e alimenta o saber acadêmico.",
    affects: [
      "Perícias treinadas adicionais no 1º nível",
      "Perícias Arcanismo, Ofício e Sociedade",
      "Conjuração arcana preparada (p. ex. Magus/Mago)",
      "Idiomas conhecidos",
    ],
  },
  wis: {
    name: "Sabedoria",
    summary: "Mede percepção e força de vontade. Sustenta a Percepção, a defesa mental e a cura.",
    affects: [
      "Percepção (e iniciativa por padrão)",
      "Testes de resistência de Vontade",
      "Perícias Medicina, Natureza e Religião",
      "Conjuração divina/primeva (p. ex. Clérigo/Druida)",
    ],
  },
  cha: {
    name: "Carisma",
    summary:
      "Mede presença e força de personalidade. Move a interação social e a conjuração ocultista/espontânea.",
    affects: [
      "Perícias Diplomacia, Intimidação, Enganação e Atuação",
      "Conjuração ocultista/espontânea (p. ex. Bardo/Feiticeiro)",
    ],
  },
};

export interface SkillHelp {
  /** Skill display name (English game term, matching the dialog's SKILL_LABELS). */
  name: string;
  /** Ability slug this skill is keyed to. */
  ability: AbilityHelpSlug;
  /** 1-2 sentence pt-BR description with typical actions. */
  description: string;
}

/**
 * SKILL_HELP — one entry per canonical PF2e skill (keyed by planVM's skill
 * slug). Lore skills share a single generic entry (see `skillHelpFor`).
 */
export const SKILL_HELP: Record<string, SkillHelp> = {
  acrobatics: {
    name: "Acrobatics",
    ability: "dex",
    description:
      "Equilíbrio, esquiva e manobras ágeis. Usada para atravessar terreno traiçoeiro, escapar de agarrões e cair com segurança.",
  },
  arcana: {
    name: "Arcana",
    ability: "int",
    description:
      "Conhecimento da magia arcana, criaturas mágicas e planos. Identifica magias arcanas e itens e recorda saber sobre o arcano.",
  },
  athletics: {
    name: "Athletics",
    ability: "str",
    description:
      "Feitos de poder físico. Usada para escalar, saltar, nadar, agarrar, empurrar e derrubar oponentes em combate.",
  },
  crafting: {
    name: "Crafting",
    ability: "int",
    description:
      "Fabricar e reparar itens, e identificar como algo foi feito. Também cria itens alquímicos e consertos improvisados.",
  },
  deception: {
    name: "Deception",
    ability: "cha",
    description:
      "Enganar por mentiras, disfarces e fintas. Usada para blefar, criar distrações e fintar um inimigo em combate.",
  },
  diplomacy: {
    name: "Diplomacy",
    ability: "cha",
    description:
      "Influenciar pela boa-fé e persuasão. Usada para pedir favores, melhorar atitudes e coletar informações na conversa.",
  },
  intimidation: {
    name: "Intimidation",
    ability: "cha",
    description:
      "Dobrar a vontade alheia por ameaças e presença. Usada para coagir e para Demoralizar (abalar) um oponente em combate.",
  },
  medicine: {
    name: "Medicine",
    ability: "wis",
    description:
      "Tratar ferimentos e doenças sem magia. Usada para Tratar Ferimentos, estabilizar um agonizante e diagnosticar males.",
  },
  nature: {
    name: "Nature",
    ability: "wis",
    description:
      "Conhecimento do mundo natural, feras e do primevo. Identifica plantas, animais e magia primeva e lida com o terreno selvagem.",
  },
  occultism: {
    name: "Occultism",
    ability: "int",
    description:
      "Conhecimento do oculto, do esotérico e do que está além. Identifica magia ocultista, criaturas planares e mistérios antigos.",
  },
  performance: {
    name: "Performance",
    ability: "cha",
    description:
      "Encantar plateias por música, atuação ou oratória. Usada para se apresentar e, em campanha, para ganhar a vida com a arte.",
  },
  religion: {
    name: "Religion",
    ability: "wis",
    description:
      "Conhecimento dos deuses, do divino e do além-túmulo. Identifica magia divina, mortos-vivos e ritos religiosos.",
  },
  society: {
    name: "Society",
    ability: "int",
    description:
      "Conhecimento de povos, leis, história e etiqueta. Usada para decifrar textos, criar identidades falsas e recordar saber social.",
  },
  stealth: {
    name: "Stealth",
    ability: "dex",
    description:
      "Passar despercebido e ocultar coisas. Usada para se Esconder, se Esgueirar sem ser notado e camuflar objetos.",
  },
  survival: {
    name: "Survival",
    ability: "wis",
    description:
      "Sobreviver e se orientar na natureza. Usada para rastrear, caçar, encontrar abrigo e não se perder em viagem.",
  },
  thievery: {
    name: "Thievery",
    ability: "dex",
    description:
      "Feitos de mãos ágeis e furto. Usada para arrombar fechaduras, desarmar armadilhas, bater carteiras e escapar de amarras.",
  },
};

/** Generic help shown for any Lore (custom knowledge) skill. */
export const LORE_HELP: SkillHelp = {
  name: "Lore",
  ability: "int",
  description:
    "Conhecimento especializado sobre um assunto estreito (p. ex. Saber sobre Taverna, Saber sobre Dragões). Recorda fatos daquele tema e, em campanha, pode render sustento.",
};

/**
 * Resolve the help entry for a skill slug, folding lore slugs onto LORE_HELP.
 * `isLoreSlug` (not a local prefix test) so the legacy `<subject>-lore` key
 * matches deliberately instead of landing on the unknown-slug fallback.
 */
export function skillHelpFor(slug: string): SkillHelp {
  if (isLoreSlug(slug)) return LORE_HELP;
  return SKILL_HELP[slug] ?? LORE_HELP;
}

/** Resolve the help entry for an ability slug. */
export function abilityHelpFor(slug: string): AbilityHelp | null {
  return (ABILITY_HELP as Record<string, AbilityHelp>)[slug] ?? null;
}

export interface TemlRow {
  badge: "U" | "T" | "E" | "M" | "L";
  /** pt-BR proficiency-rank name. */
  name: string;
  /** Proficiency bonus contributed OVER level (Untrained adds nothing at all). */
  bonusOverLevel: number;
  /** Short pt-BR gloss of the bonus rule. */
  note: string;
}

/**
 * TEML_LEGEND — the five proficiency ranks and their bonus over level. In the
 * PF2e Remaster a proficiency bonus is `rank×2 + level` once trained, and a
 * flat +0 (level NOT added) while untrained — mirrors planVM's
 * `skillProficiencyBonus`.
 */
export const TEML_LEGEND: TemlRow[] = [
  { badge: "U", name: "Destreinado", bonusOverLevel: 0, note: "+0 e o nível NÃO é somado." },
  { badge: "T", name: "Treinado", bonusOverLevel: 2, note: "+2 sobre o nível." },
  { badge: "E", name: "Especialista", bonusOverLevel: 4, note: "+4 sobre o nível." },
  { badge: "M", name: "Mestre", bonusOverLevel: 6, note: "+6 sobre o nível." },
  { badge: "L", name: "Lendário", bonusOverLevel: 8, note: "+8 sobre o nível." },
];
