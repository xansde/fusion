# Escolhas do vendor que o builder ainda não oferece (r21)

Levantado em 2026-08-02 a partir dos packs, depois da pergunta do dono do projeto:
*"a correção foi apenas na ancestralidade adotada? não tem uma verificação para ver se
existem outros casos similares?"* — não tinha. Agora tem: `choiceSetInventory.ts` +
`__tests__/choice-sets.test.ts`, que **não reprova** a suíte por dívida conhecida, só
por escolha nova não classificada.

**Total: 58 escolhas pendentes** de 76 mapeadas em 57 documentos.

Cada linha é uma decisão que as regras dão ao jogador e que hoje não aparece na ficha.

## ancestries-core (1)

| documento | flag |
| --- | --- |
| Fleshwarp | `fleshwarpSize` |

## ancestry-features-core (5)

| documento | flag |
| --- | --- |
| Animal Attack | `-` |
| Clan Dagger | `clanWeapon` |
| Draconic Benefactor | `draconicBenefactor` |
| Draconic Exemplar | `draconicExemplar` |
| Magiphage | `-` |

## class-features-core (34)

| documento | flag |
| --- | --- |
| Animal Instinct | `-` |
| Avenger | `deity` |
| Dragon Instinct | `dragon` |
| Eldritch Trickster | `eldritchTrickster` |
| Elemental Instinct | `elementalInstinctDamage` |
| Elemental Instinct | `elementalInstinctElement` |
| Experimental Spellshaping | `feat` |
| Fighter Weapon Mastery | `fighterWeaponMastery` |
| Fourth Gate's Threshold | `-` |
| Fourth Gate's Threshold | `element` |
| Fourth Gate's Threshold | `elementFork` |
| Fourth Gate's Threshold | `impulseExpand` |
| Fury Instinct | `furyInstinct` |
| Gate's Threshold | `-` |
| Gate's Threshold | `element` |
| Gate's Threshold | `elementFork` |
| Gate's Threshold | `impulseExpand` |
| Giant Instinct | `energy` |
| Kinetic Gate | `-` |
| Mastermind | `mastermind` |
| School of Rooted Wisdom | `branch` |
| School of Unified Magical Theory | `feat` |
| Second Gate's Threshold | `element` |
| Second Gate's Threshold | `elementFork` |
| Second Gate's Threshold | `impulseExpand` |
| Second Gate's Threshold | `threshold` |
| Superstition Instinct | `ragingResistance` |
| Third Gate's Threshold | `-` |
| Third Gate's Threshold | `element` |
| Third Gate's Threshold | `elementFork` |
| Third Gate's Threshold | `impulseExpand` |
| Vindicator | `-` |
| Vindicator | `deity` |
| Weapon Legend | `weaponLegend` |

## classes-core (1)

| documento | flag |
| --- | --- |
| Fighter | `fighterSkill` |

## feats-core (17)

| documento | flag |
| --- | --- |
| Advanced Weapon Training | `group` |
| Ancestral Paragon | `ancestralParagon` |
| Armor Proficiency | `-` |
| Assurance | `assurance` |
| Basic Trickery | `basicTrickery` |
| Canny Acumen | `cannyAcumen` |
| Elemental Evolution | `damage` |
| Elemental Lore | `elementalLore` |
| Living Weapon | `livingWeapon` |
| Rogue Dedication | `rogueDedication` |
| Rogue Dedication | `skillFeat` |
| Skill Training | `skill` |
| Specialty Crafting | `specialtyCrafting` |
| Terrain Expertise | `terrain` |
| Terrain Stalker | `-` |
| Virtuosic Performer | `performanceType` |
| Wilderness Spotter | `terrain` |

## Ordem sugerida de correção

1. **`Fighter/fighterSkill`** — nível 1, todo Guerreiro escolhe Acrobacia ou Atletismo. É o único ChoiceSet que vive no doc de CLASSE, e o pipeline nunca exercitou esse caminho.
2. **`Fleshwarp/fleshwarpSize`** — Pequeno ou Médio, na criação. O Finn é Fleshwarp.
3. **Sub-escolha dentro do instinto do Bárbaro** (Dragon/Elemental/Giant/Superstition/Animal) — o eixo já funciona, falta a escolha aninhada.
4. **`Fighter Weapon Mastery` / `Weapon Legend`** — grupo de armas, níveis 5 e 13.
5. **`Gate's Threshold`** ×4 — expandir/bifurcar o portão do Cinetista.
6. **`Avenger` / `Vindicator`** — divindade do Ranger.
7. **Talentos com parâmetro** (Canny Acumen, Assurance, Armor Proficiency, Ancestral Paragon, Basic Trickery, Advanced Weapon Training, Living Weapon, Elemental Lore...).

O mecanismo genérico que resolveria a maioria de uma vez: consumir o `ChoiceSet` do
vendor como fonte de sub-slot — lista estática vira seletor de valor, `itemType` vira
seletor de documento filtrado. Hoje cada caminho é escrito à mão no builder.

