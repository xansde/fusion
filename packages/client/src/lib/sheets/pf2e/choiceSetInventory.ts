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
  // --- r25: Psychic's two level-1 axes. Both are declared as choiceAxes in
  // curation/classes/psychic.json, so the OPTIONS are in the pack with their own
  // `system.category` (consciousMind / subconsciousMind) — but "Conscious Mind"
  // and "Subconscious Mind" are NOT in planVM's CLASS_CHOICE_SLOTS, so neither
  // slot is offered. `pendente`, NOT `eixo`: the pack half is done and the
  // builder half is not, and marking them `eixo` would claim a slot the player
  // never sees. The subconscious mind is what determines the Psychic's key
  // attribute (Int or Cha), so this gap also leaves keyAbility unresolved.
  "class-features-core/Conscious Mind/consciousMind": "pendente",
  "class-features-core/Subconscious Mind/subconsciousMind": "pendente",
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
  // r28 — Druidic Order é o novo eixo "order" (Druid, nível 1, 9 opções
  // `druid-order` no pack). Ao contrário dos eixos de Psychic e Gunslinger
  // (que ficaram "pendente" porque o pack tinha as opções mas o builder não
  // abria o slot), este entrou COMPLETO: "Druidic Order" está em
  // CLASS_CHOICE_SLOTS e "order" em CLASS_CHOICE_SLOT_OPTIONS, então o slot
  // de nível 1 é oferecido e filtrado pela otherTag. O que continua pendente
  // é o EFEITO da opção escolhida (a perícia treinada da ordem e o vínculo
  // ordem → magia de foco inicial) — declarado em curation/classes/druid.json.
  "class-features-core/Druidic Order/druidicOrder": "eixo",
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
  // r25 — Gunslinger's Way is the new "way" choiceAxis (6 options in the pack,
  // each with `system.category: "way"`). Same state as the two Psychic axes
  // above: the options exist, but "Gunslinger's Way" is not in
  // CLASS_CHOICE_SLOTS, so the level-1 slot is never offered. This is the axis
  // the target sheet picks (Way of the Spellshot).
  "class-features-core/Gunslinger's Way/way": "pendente",
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
  // --- r25: the 6 Psychic conscious minds each carry a `dedicationCantrip`
  // ChoiceSet whose `choices` is a FLAG PATH
  // ("flags.system.psychic.dedication.psiCantrips") rather than a filter — it is
  // the psi cantrip you pick when the conscious mind arrives through Psychic
  // DEDICATION instead of the class. That is exactly the target sheet's route
  // (Ignition via The Oscillating Wave), and the builder offers nothing for it.
  // Note the flag-path form: even the generic ChoiceSet interpretation would not
  // resolve these without knowing how the granting feat filled the flag.
  "class-features-core/The Distant Grasp/dedicationCantrip": "pendente",
  "class-features-core/The Infinite Eye/dedicationCantrip": "pendente",
  "class-features-core/The Oscillating Wave/dedicationCantrip": "pendente",
  "class-features-core/The Silent Whisper/dedicationCantrip": "pendente",
  "class-features-core/The Tangible Dream/dedicationCantrip": "pendente",
  "class-features-core/The Unbound Step/dedicationCantrip": "pendente",
  // r25 — the Pistolero is the one Gunslinger way whose trained skill is a
  // choice (Deception or Intimidation) instead of being fixed; a static
  // two-value pick, same family as the 4 Player Core backgrounds above.
  "class-features-core/Way of the Pistolero/skill": "pendente",
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
  // r28 — Voice of Nature (Druid, nível 1) concede UM talento escolhido entre
  // dois itens LITERAIS (Animal Empathy / Plant Empathy). GRANTED_FEAT_FILTERS
  // no planVM.ts só sabe filtro por predicado declarativo (categoria/trait/
  // nível), não lista literal de uuids, então este caso não é expressável lá
  // hoje. Os dois talentos-alvo ESTÃO em feats-core — falta só o consumidor.
  "class-features-core/Voice of Nature/feat": "pendente",
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
  // r27 — ancestry feats do Player Core 2 (curadoria das 7 ancestralidades
  // novas): cada um parametriza o próprio feat com uma escolha que o builder
  // ainda não oferece — mesma família dos "pendente" vizinhos.
  "feats-core/Benefactor's Resistance/nonPhysicalResistance": "pendente",
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
  // r27 — Dragonblood Paragon escolhe o dragão exemplar (mesma escolha da
  // herança Dragonblood, reapresentada como feat).
  "feats-core/Dragonblood Paragon/dragonbloodParagon": "pendente",
  "feats-core/Elemental Evolution/damage": "pendente",
  "feats-core/Elemental Lore/elementalLore": "pendente",
  // r22 — Monk's "Entwined Energy Ki" feat picks an energy type — not offered.
  "feats-core/Entwined Energy Ki/entwinedEnergyKi": "pendente",
  "feats-core/Iruxi Armaments/iruxiArmaments": "pendente",
  "feats-core/Living Weapon/livingWeapon": "pendente",
  // r22 — Champion's "Mercy" feat parameterizes the condition it removes.
  "feats-core/Mercy/-": "pendente",
  // r22 — Bard's "Multifarious Muse" feat picks a SECOND muse's level-1 free
  // feat (mirrors Crossblooded Evolution above, muse instead of bloodline).
  "feats-core/Multifarious Muse/feat": "pendente",
  "feats-core/Multifarious Muse/muse": "pendente",
  // --- r25: the Psychic archetype chain (reaches feats-core through
  // classFeats.extraNames — none of these carries the `psychic` trait). ---
  // "Parallel Breakthrough" picks one psi cantrip out of an explicit `or` list
  // of slugs; the other two are the same flag-path psi-cantrip pick as the 6
  // conscious minds above. `Psychic Dedication/consciousMind` is the one that
  // matters most for the target sheet: it is the choice that makes the whole
  // level-1 archetype-spellcasting route exist, and nothing offers it.
  "feats-core/Parallel Breakthrough/spell": "pendente",
  "feats-core/Psi Development/dedicationCantrip": "pendente",
  "feats-core/Psychic Dedication/consciousMind": "pendente",
  // --- r28: as 3 escolhas que os 100 class feats do Druid trouxeram. ---
  // "Heart of the Kaiju" (L20) parametriza o tipo de dano do sopro da forma
  // colossal; "Verdant Weapon" (L1) escolhe QUAL arma vira a arma verdejante
  // (3 flags: a escolha em si + os dois ramos "já tenho uma"/"ganho uma"); e
  // "Order Explorer" (L2) escolhe uma SEGUNDA ordem druídica — mesma forma do
  // "Multifarious Muse" do Bardo logo acima (o eixo existe e é oferecido no
  // nível 1, mas a re-escolha por talento não é).
  "feats-core/Heart of the Kaiju/damageType": "pendente",
  "feats-core/Order Explorer/order": "pendente",
  "feats-core/Verdant Weapon/-": "pendente",
  "feats-core/Verdant Weapon/existingVerdantWeapon": "pendente",
  "feats-core/Verdant Weapon/grantedVerdantWeapon": "pendente",
  "feats-core/Rogue Dedication/rogueDedication": "pendente",
  "feats-core/Rogue Dedication/skillFeat": "pendente",
  // r22 — Cleric's "Second Blessing" feat (Blessed One-style) picks a
  // blessing — same family as "Blessing of the Devoted" above.
  "feats-core/Runtsage/-": "pendente",
  "feats-core/Second Blessing/blessing": "pendente",
  "feats-core/Skill Training/skill": "pendente",
  "feats-core/Specialty Crafting/specialtyCrafting": "pendente",
  "feats-core/Terrain Expertise/terrain": "pendente",
  "feats-core/Terrain Stalker/-": "pendente",
  "feats-core/Virtuosic Performer/performanceType": "pendente",
  "feats-core/War Conditioning/warConditioning": "pendente",
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
  // r25, Ancient Elf: two corrections here. (1) The old comment said it "picks
  // an elf-lineage bonus feat" — it does not. Its filter is
  // ["item:category:class","item:trait:dedication","item:trait:multiclass"]:
  // it picks a MULTICLASS DEDICATION, at level 1, waiving the level 2
  // prerequisite ("even though you don't meet its level prerequisite"). That is
  // the whole reason the target sheet can carry a Psychic Dedication at level 1.
  // (2) The PACK half is now done: the importer converts this ChoiceSet into a
  // `feat-choice` descriptor and marks the paired grant-item `inMemoryOnly`, so
  // this key is now collected from `system.rules` instead of
  // `unconvertedRules`. It stays `pendente` because the state in this inventory
  // is about the BUILDER, and the builder still offers no sub-slot on a
  // heritage — the heritage is an AbcCardModel with no slotId. Flip to
  // `sub-slot` when planVM grows that push.
  "heritages-core/Ancient Elf/ancientElf": "pendente",
  // r27 — heranças do Player Core 2 com escolha própria: Dragonblood escolhe
  // o dragão exemplar; Elementheart Kobold escolhe o elemento do sopro.
  "heritages-core/Dragonblood/dragonblood": "pendente",
  "heritages-core/Elementheart Kobold/element": "pendente",
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
