/**
 * Inventário de escolhas do vendor (`ChoiceSet`) e o estado de cada uma no
 * builder — r21.
 *
 * ## Por que este arquivo existe
 *
 * A "Ancestralidade Adotada" foi corrigida como caso isolado. A pergunta certa
 * veio do dono do projeto: *"não tem uma verificação para ver se existem outros
 * casos similares?"* — não tinha. Medido no mesmo dia: **76 ChoiceSets em 57
 * documentos** dos packs, e o builder tratava 10.
 *
 * Um `ChoiceSet` do vendor é sempre a mesma coisa: **uma escolha que o jogador
 * precisa fazer**. Qual grupo de armas o Guerreiro domina no nível 5, qual
 * dragão o Bárbaro de Instinto Dracônico escolhe, se o Fleshwarp é Pequeno ou
 * Médio. Quando o builder não trata, a escolha simplesmente não existe na
 * ficha — sem erro, sem aviso, sem nada. É a pior classe de defeito desta base:
 * silenciosa.
 *
 * Este inventário torna o silêncio impossível. Toda escolha presente nos packs
 * tem de estar listada aqui com um estado; escolha nova que chegue num pack
 * futuro **quebra o teste** até alguém classificá-la.
 *
 * ## Os estados
 *
 * - `eixo` — já vira slot de sub-escolha de classe (Instinto, Malandragem,
 *   Especialidade de Caçador, Tese/Escola Arcana, Estudo Híbrido, Portão
 *   Cinético). O ChoiceSet continua não convertido no doc porque quem resolve é
 *   o `category` derivado da otherTag, não o rule element.
 * - `sub-slot` — vira sub-slot aninhado sob o talento que concede.
 * - `fora-do-builder` — a escolha existe, mas não pertence à construção do PC
 *   (habilidade de familiar, ação de criatura). Não é dívida.
 * - `pendente` — **a escolha não aparece na ficha hoje.** É dívida declarada,
 *   com o jogador perdendo uma decisão que as regras dão a ele.
 *
 * ## O que está pendente e mais dói (medido)
 *
 * | escolha | onde aparece | quem sente |
 * | --- | --- | --- |
 * | `Fighter/fighterSkill` | nível 1 | todo Guerreiro: Acrobacia **ou** Atletismo |
 * | `Fighter Weapon Mastery`, `Weapon Legend` | níveis 5 e 13 | grupo de armas do Guerreiro |
 * | `Fleshwarp/fleshwarpSize` | criação | Pequeno ou Médio — o Finn é Fleshwarp |
 * | `Dragon Instinct`, `Elemental Instinct`, `Giant Instinct`, `Superstition Instinct`, `Animal Instinct` | nível 1 | a escolha DENTRO do instinto do Bárbaro |
 * | `Gate's Threshold` (4 níveis) | 5/9/13/17 | expandir ou bifurcar o portão do Cinetista |
 * | `Avenger`, `Vindicator` | nível 1 | divindade do Ranger |
 * | `Canny Acumen`, `Assurance`, `Armor Proficiency`, `Ancestral Paragon`, ... | vários | talentos que pedem um parâmetro |
 *
 * Nada aqui é conteúdo faltando — os documentos estão todos nos packs. O que
 * falta é o builder oferecer a escolha.
 */

/** Estado de tratamento de uma escolha do vendor no builder. */
export type ChoiceSetState = "eixo" | "sub-slot" | "fora-do-builder" | "pendente";

/**
 * Chave: `<pack>/<nome do documento>/<flag do ChoiceSet>` (flag `-` quando o
 * vendor não nomeia). Um documento pode ter várias escolhas — o Portão
 * Cinético tem quatro.
 */
export const CHOICE_SET_INVENTORY: Record<string, ChoiceSetState> = {
  "actions-core/Breath Weapon/breathDamage": "fora-do-builder",
  "actions-core/Breath Weapon/shape": "fora-do-builder",
  "ancestries-core/Fleshwarp/fleshwarpSize": "pendente",
  "ancestry-features-core/Animal Attack/-": "pendente",
  "ancestry-features-core/Clan Dagger/clanWeapon": "pendente",
  "ancestry-features-core/Draconic Benefactor/draconicBenefactor": "pendente",
  "ancestry-features-core/Draconic Exemplar/draconicExemplar": "pendente",
  "ancestry-features-core/Magiphage/-": "pendente",
  "class-features-core/Animal Instinct/-": "pendente",
  "class-features-core/Arcane School/arcaneSchool": "eixo",
  "class-features-core/Arcane Thesis/arcaneThesis": "eixo",
  "class-features-core/Avenger/deity": "pendente",
  "class-features-core/Dragon Instinct/dragon": "pendente",
  "class-features-core/Eldritch Trickster/eldritchTrickster": "pendente",
  "class-features-core/Elemental Instinct/elementalInstinctDamage": "pendente",
  "class-features-core/Elemental Instinct/elementalInstinctElement": "pendente",
  "class-features-core/Experimental Spellshaping/feat": "pendente",
  "class-features-core/Fighter Weapon Mastery/fighterWeaponMastery": "pendente",
  "class-features-core/Fourth Gate's Threshold/-": "pendente",
  "class-features-core/Fourth Gate's Threshold/element": "pendente",
  "class-features-core/Fourth Gate's Threshold/elementFork": "pendente",
  "class-features-core/Fourth Gate's Threshold/impulseExpand": "pendente",
  "class-features-core/Fury Instinct/furyInstinct": "pendente",
  "class-features-core/Gate's Threshold/-": "pendente",
  "class-features-core/Gate's Threshold/element": "pendente",
  "class-features-core/Gate's Threshold/elementFork": "pendente",
  "class-features-core/Gate's Threshold/impulseExpand": "pendente",
  "class-features-core/Giant Instinct/energy": "pendente",
  "class-features-core/Hunter's Edge/huntersEdge": "eixo",
  "class-features-core/Hybrid Study/hybridStudy": "eixo",
  "class-features-core/Instinct/instinct": "eixo",
  "class-features-core/Kinetic Gate/-": "pendente",
  "class-features-core/Kinetic Gate/elementOne": "eixo",
  "class-features-core/Kinetic Gate/elementTwo": "eixo",
  "class-features-core/Mastermind/mastermind": "pendente",
  "class-features-core/Rogue's Racket/roguesRacket": "eixo",
  "class-features-core/School of Rooted Wisdom/branch": "pendente",
  "class-features-core/School of Unified Magical Theory/feat": "pendente",
  "class-features-core/Second Gate's Threshold/element": "pendente",
  "class-features-core/Second Gate's Threshold/elementFork": "pendente",
  "class-features-core/Second Gate's Threshold/impulseExpand": "pendente",
  "class-features-core/Second Gate's Threshold/threshold": "pendente",
  "class-features-core/Superstition Instinct/ragingResistance": "pendente",
  "class-features-core/Third Gate's Threshold/-": "pendente",
  "class-features-core/Third Gate's Threshold/element": "pendente",
  "class-features-core/Third Gate's Threshold/elementFork": "pendente",
  "class-features-core/Third Gate's Threshold/impulseExpand": "pendente",
  "class-features-core/Vindicator/-": "pendente",
  "class-features-core/Vindicator/deity": "pendente",
  "class-features-core/Weapon Legend/weaponLegend": "pendente",
  "classes-core/Fighter/fighterSkill": "pendente",
  "familiar-abilities-core/Damage Avoidance/save": "fora-do-builder",
  "familiar-abilities-core/Elemental/element": "fora-do-builder",
  "familiar-abilities-core/Fast Movement/speed": "fora-do-builder",
  "familiar-abilities-core/Resistance/resistanceOne": "fora-do-builder",
  "familiar-abilities-core/Resistance/resistanceTwo": "fora-do-builder",
  "familiar-abilities-core/Skilled/skill": "fora-do-builder",
  "feats-core/Adopted Ancestry/ancestry": "sub-slot",
  "feats-core/Advanced Weapon Training/group": "pendente",
  "feats-core/Ancestral Paragon/ancestralParagon": "pendente",
  "feats-core/Armor Proficiency/-": "pendente",
  "feats-core/Assurance/assurance": "pendente",
  "feats-core/Basic Concoction/basicConcoction": "sub-slot",
  "feats-core/Basic Trickery/basicTrickery": "pendente",
  "feats-core/Canny Acumen/cannyAcumen": "pendente",
  "feats-core/Elemental Evolution/damage": "pendente",
  "feats-core/Elemental Lore/elementalLore": "pendente",
  "feats-core/Living Weapon/livingWeapon": "pendente",
  "feats-core/Rogue Dedication/rogueDedication": "pendente",
  "feats-core/Rogue Dedication/skillFeat": "pendente",
  "feats-core/Skill Training/skill": "pendente",
  "feats-core/Specialty Crafting/specialtyCrafting": "pendente",
  "feats-core/Terrain Expertise/terrain": "pendente",
  "feats-core/Terrain Stalker/-": "pendente",
  "feats-core/Virtuosic Performer/performanceType": "pendente",
  "feats-core/Wilderness Spotter/terrain": "pendente",
};

/** Escolhas que o jogador deveria poder fazer e que o builder ainda não oferece. */
export function pendingChoiceSets(): string[] {
  return Object.entries(CHOICE_SET_INVENTORY)
    .filter(([, state]) => state === "pendente")
    .map(([key]) => key)
    .sort();
}
