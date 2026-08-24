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
 * - `desativado` — **decisão nossa de não oferecer a escolha**, não dívida. O
 *   dado do vendor continua no pack; o que a decisão desliga é a regra que
 *   dependia dela (ver `flags.fusion.disabledRules` do documento e
 *   `tools/importer-pf2e/src/curation/disabled-rules.mjs`). Diferente de
 *   `pendente` em intenção, não em efeito: `pendente` é fila de trabalho,
 *   `desativado` é escopo fechado — só volta se a decisão mudar.
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
export type ChoiceSetState = "eixo" | "sub-slot" | "fora-do-builder" | "pendente" | "desativado";

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
  // issue #1: the 4 Player Core backgrounds below let the player choose
  // BETWEEN two trained skills (e.g. Hermit: "Nature or Occultism") via an
  // ActiveEffectLike rule keyed off `{item|flags.system.rulesSelections.skill}`
  // — same unresolved-choice shape as the class-features/feats "pendente"
  // entries below; `system.skills` stays empty until the player picks.
  "backgrounds-core/Hermit/skill": "pendente",
  "backgrounds-core/Martial Disciple/skill": "pendente",
  "backgrounds-core/Scholar/skill": "pendente",
  "backgrounds-core/Teacher/skill": "pendente",
  "class-features-core/Animal Instinct/-": "pendente",
  "class-features-core/Arcane School/arcaneSchool": "eixo",
  "class-features-core/Arcane Thesis/arcaneThesis": "eixo",
  "class-features-core/Avenger/deity": "pendente",
  // r22 — Blessing of the Devoted (Champion's "Blessed One"-style Cause pick)
  // grants a domain-like Blessing spell; the sub-choice of WHICH blessing
  // isn't offered by the builder yet (same family as Deity/Divine Font).
  "class-features-core/Blessing of the Devoted/blessing": "pendente",
  // r22 — the Sorcerer's Bloodline pick IS the new "bloodline" choiceAxis
  // slot (mirrors Instinct/Hunter's Edge/...). The 4 entries below it are
  // NESTED sub-choices inside individual bloodline docs (which dragon
  // exemplar, which element/genie kind) — not modeled this round, same
  // boundary as School of Rooted Wisdom's "branch" (Wizard).
  "class-features-core/Bloodline/bloodline": "eixo",
  "class-features-core/Bloodline: Draconic/dragonBloodline": "pendente",
  "class-features-core/Bloodline: Elemental/elementalBloodline": "pendente",
  "class-features-core/Bloodline: Genie/genie": "pendente",
  "class-features-core/Bloodline: Wyrmblessed/dragonBloodline": "pendente",
  // r22 — Champion's Cause is the new "cause" choiceAxis slot.
  "class-features-core/Cause/cause": "eixo",
  // r22 — Champion's own deity pick (name-based, no builder support yet —
  // same family as Ranger's Avenger/Vindicator deity picks above).
  "class-features-core/Deity (Champion)/-": "pendente",
  "class-features-core/Deity (Champion)/deity": "pendente",
  // r22 — Cleric's deity pick, same shape/limitation as Champion's above.
  "class-features-core/Deity (Cleric)/-": "pendente",
  "class-features-core/Deity (Cleric)/deity": "pendente",
  // r22 — Cleric's Harm/Heal font choice (Divine Font) — not offered yet.
  "class-features-core/Divine Font/divineFont": "pendente",
  // r22 — Cleric's Doctrine is the new "doctrine" choiceAxis slot. The
  // per-doctrine proficiency numbers stay UNAPPLIED either way (baseline +
  // declared pendency — see curation/classes/cleric.json's notes and
  // check-derivation.mjs), matching the class-integration policy.
  "class-features-core/Doctrine/doctrine": "eixo",
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
  // issue #16 — Gate Junction is the actual mechanical effect the 4 Gate's
  // Threshold features grant (their impulse-slot bookkeeping); its own 2
  // sub-choices (which element, which impulse) aren't offered yet — same
  // "pendente" family as Gate's Threshold's own 3 entries just below.
  "class-features-core/Gate Junction/element": "pendente",
  "class-features-core/Gate Junction/junction": "pendente",
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
  // r22 — Muses is the new "muse" choiceAxis slot (Bard). The chosen muse's
  // own GrantItem (level-1 free feat) already materializes via the existing
  // generic grantMaterializer path — see PR notes; no builder gap here.
  "class-features-core/Muses/muse": "eixo",
  // r22 — Monk's 3 Path to Perfection saves-upgrade ChoiceSets are the
  // documented Monk gap: the class ships with baseline proficiencies (no
  // upgrade applied from any of the 3), and the CHOICE of which save to
  // raise isn't offered by the builder — same policy as Doctrine above (see
  // curation/classes/monk.json's notes and check-derivation.mjs's ignored
  // "feat:qi-spells" predicate report for the companion Monk Expertise gap).
  "class-features-core/Path to Perfection/pathToPerfection": "pendente",
  "class-features-core/Rogue's Racket/roguesRacket": "eixo",
  "class-features-core/School of Rooted Wisdom/branch": "pendente",
  // issue #16 — the Runelord archetype-school forces this school in place of
  // a normal arcane-school pick; its own sub-choice (which of the 7 sins) is
  // not offered by the builder yet — same shape as School of Rooted Wisdom's
  // "branch" above.
  "class-features-core/School of Thassilonian Rune Magic/sin": "pendente",
  "class-features-core/School of Unified Magical Theory/feat": "pendente",
  "class-features-core/Second Gate's Threshold/element": "pendente",
  "class-features-core/Second Gate's Threshold/elementFork": "pendente",
  "class-features-core/Second Gate's Threshold/impulseExpand": "pendente",
  "class-features-core/Second Gate's Threshold/threshold": "pendente",
  "class-features-core/Second Path to Perfection/pathToPerfection": "pendente",
  "class-features-core/Superstition Instinct/ragingResistance": "pendente",
  "class-features-core/Third Gate's Threshold/-": "pendente",
  "class-features-core/Third Gate's Threshold/element": "pendente",
  "class-features-core/Third Gate's Threshold/elementFork": "pendente",
  "class-features-core/Third Gate's Threshold/impulseExpand": "pendente",
  "class-features-core/Third Path to Perfection/pathToPerfection": "pendente",
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
  // r22 — Sorcerer's "Bloodline Mutation" feat: 4 independent sub-choices
  // parameterizing a picked feat (same shape as the pre-existing "Canny
  // Acumen"/"Elemental Evolution" entries above) — none offered by the
  // builder yet.
  "feats-core/Bloodline Mutation/-": "pendente",
  "feats-core/Bloodline Mutation/damageType": "pendente",
  "feats-core/Bloodline Mutation/sense": "pendente",
  "feats-core/Bloodline Mutation/traitOne": "pendente",
  "feats-core/Bloodline Mutation/traitTwo": "pendente",
  // issue #16 — the Barbarian's "Bloodrager" instinct grants this dedication
  // feat, which itself picks a skill to raise (via ActiveEffectLike keyed off
  // the same ChoiceSet selection) — not offered by the builder yet.
  "feats-core/Bloodrager Dedication/skill": "pendente",
  // r22 — Sorcerer's "Crossblooded Evolution" feat picks a SECOND bloodline
  // (distinct from the character's primary one) — parameter not offered.
  "feats-core/Crossblooded Evolution/bloodline": "pendente",
  // r22 — Cleric's "Deity's Domain"/"Domain Initiate" feats pick a domain —
  // same family as the class's own Deity/Divine Font gaps above.
  "feats-core/Deity's Domain/deitysDomain": "pendente",
  "feats-core/Domain Initiate/domainInitiate": "pendente",
  "feats-core/Elemental Evolution/damage": "pendente",
  "feats-core/Elemental Lore/elementalLore": "pendente",
  // r22 — Monk's "Entwined Energy Ki" feat picks an energy type — not offered.
  "feats-core/Entwined Energy Ki/entwinedEnergyKi": "pendente",
  "feats-core/Living Weapon/livingWeapon": "pendente",
  // r22 — Champion's "Mercy" feat parameterizes the condition it removes.
  "feats-core/Mercy/-": "pendente",
  // r22 — Bard's "Multifarious Muse" feat picks a SECOND muse's level-1 free
  // feat (mirrors Crossblooded Evolution above, muse instead of bloodline).
  "feats-core/Multifarious Muse/feat": "pendente",
  "feats-core/Multifarious Muse/muse": "pendente",
  "feats-core/Rogue Dedication/rogueDedication": "pendente",
  "feats-core/Rogue Dedication/skillFeat": "pendente",
  // r22 — Cleric's "Second Blessing" feat (Blessed One-style) picks a
  // blessing — same family as "Blessing of the Devoted" above.
  "feats-core/Second Blessing/blessing": "pendente",
  "feats-core/Skill Training/skill": "pendente",
  "feats-core/Specialty Crafting/specialtyCrafting": "pendente",
  "feats-core/Terrain Expertise/terrain": "pendente",
  "feats-core/Terrain Stalker/-": "pendente",
  "feats-core/Virtuosic Performer/performanceType": "pendente",
  "feats-core/Wilderness Spotter/terrain": "pendente",
  // issue #1 — ancestry feats of the 8 newly curated Player Core ancestries
  // (Dwarf/Elf/Gnome/Goblin/Halfling/Human/Leshy/Orc) that themselves
  // parameterize a further choice (a skill, a cantrip, a weapon group, a
  // second heritage/clan/element...) — same "pendente" shape as the other
  // single-parameter feats above; none of these is offered by the builder.
  "feats-core/Advanced General Training/advancedGeneralTraining": "pendente",
  "feats-core/Arcane Tattoos/cantrip": "pendente",
  "feats-core/Beast Trainer/feat": "pendente",
  "feats-core/Chosen of Lamashtu/heritage": "pendente",
  "feats-core/Clan Lore/clan": "pendente",
  "feats-core/Cultural Adaptability/feat": "pendente",
  "feats-core/Dragon Spit/cantrip": "pendente",
  "feats-core/Elemental Wrath/element": "pendente",
  "feats-core/General Training/feat": "pendente",
  "feats-core/Hold Mark/holdMark": "pendente",
  "feats-core/Multitalented/multitalented": "pendente",
  "feats-core/Natural Ambition/naturalAmbition": "pendente",
  "feats-core/Natural Skill/skillOne": "pendente",
  "feats-core/Natural Skill/skillTwo": "pendente",
  "feats-core/Viking Shieldbearer/weapon": "pendente",
  // issue #1 — heritage-level parameterized choices for the 8 core
  // ancestries (Skilled Human picks a trained skill; Versatile Human picks a
  // general-feat-eligible bonus feat) — same unresolved-ChoiceSet shape as
  // Skilled Human's background cousins above.
  //
  // DEC-MC-01 (2026-08-23): o Ancient Elf sai dessa fila. A escolha dele é
  // "qual dedicação de multiclasse você ganha" — e a multiclasse vai ser
  // refeita do zero, então oferecer a escolha agora seria construir em cima
  // do desenho que vai cair. A concessão (`GrantItem`) foi DESATIVADA no
  // pack; o ChoiceSet continua registrado em `unconvertedRules` porque é o
  // que o vendor manda, e é dele que este inventário se alimenta. Ver
  // docs/design/decisao-elfo-anciao-dedicacao.md.
  "heritages-core/Ancient Elf/ancientElf": "desativado",
  "heritages-core/Skilled Human/skill": "pendente",
  "heritages-core/Versatile Human/versatileHeritage": "pendente",
};

/** Escolhas que o jogador deveria poder fazer e que o builder ainda não oferece. */
export function pendingChoiceSets(): string[] {
  return Object.entries(CHOICE_SET_INVENTORY)
    .filter(([, state]) => state === "pendente")
    .map(([key]) => key)
    .sort();
}
