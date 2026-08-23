# r29 — Oracle — relatório de curadoria

Arquivo de configuração produzido: `tools/importer-pf2e/src/curation/classes/oracle.json`.

## 1. Método (comandos rodados)

Todos os números deste relatório vieram de scripts `node` executados **nesta
sessão** contra `tools/importer-pf2e/vendor/pf2e/packs/pf2e/` (junction
somente-leitura) e `systems/pf2e/packs/*/documents.json` (packs atuais do
Fusion). Os scripts descartáveis ficaram no scratchpad da sessão, **fora** da
worktree. Nenhum arquivo compartilhado foi tocado; nenhum `git`, `pnpm` ou
importer foi rodado.

Medições, na ordem em que foram feitas:

1. Leitura de `classes/oracle.json` → `system.{hp, keyAbility, perception,
   savingThrows, attacks, defenses, ancestryFeatLevels, classFeatLevels,
   generalFeatLevels, skillFeatLevels, skillIncreaseLevels, trainedSkills,
   spellcasting, items}` e teste `'classDC' in system`.
2. Varredura **recursiva** de `class-features/` (**842** arquivos) indexada por
   `name` → `{_id, system.level.value, traits.value, traits.otherTags}`;
   cruzamento com o `items{}` da classe usando o **segmento final da uuid**
   como nome canônico (`Compendium.pf2e.classfeatures.Item.<canônico>`), nunca
   `entry.name`.
3. União do `items{}` das **27** classes do vendor para contar em quantas
   classes cada feature do Oracle aparece.
4. Cruzamento com `class-features-core` (**318** docs) por
   `flags.fusion.sourceId` **e** por `name` (os dois, para provar que batem).
5. Varredura recursiva de `feats/class/oracle/level-*/` (**39** arquivos) e de
   `feats/class/shared-class-feats/level-*/` (**113** arquivos, filtrados para
   os **17** com trait `oracle`). A pasta compartilhada é subdividida por
   nível — `readdirSync` raso devolve 0, como o relatório do Fighter já
   avisava.
6. Cruzamento dos 56 candidatos com `feats-core` (**2205** docs) por `sourceId`
   e por `name`.
7. Varredura de `spells/` (**1797** arquivos) filtrando trait `oracle`;
   cruzamento com `spells-core` (**1310** docs) por `sourceId`.
8. Parse do HTML de `journals/classes.json`, entry `kzxu2dI7tFxv6Ix6`, página
   `bqaqOx3naiwTozBX` ("Oracle"): as **2** tabelas da página extraídas célula a
   célula (`<tr>` → `<th|td>`), com o texto despido de tags.
9. Descoberta da pregen: varredura de `iconics/**` lendo o `items[]` de cada
   ator e pegando o item `type === "class"` → a icônica do Oracle é
   **Korakai** (`iconics/korakai/korakai-level-{1,3,5}.json`). Não foi pelo
   nome do diretório.
10. Comparação célula a célula da tabela transcrita contra `sorcerer.json` e
    `bard.json` desta mesma pasta (fontes independentes, curadas noutra
    rodada).
11. Parse da prosa HTML dos 11 docs de mistério para extrair
    `@UUID[Compendium.pf2e.spells-srd.Item.<nome>]` sob os rótulos `cantrip/
    1st/2nd/…`, `initial/advanced/greater`, `Related Domains` e
    `Mystery Skill`.
12. Leitura de `curation/index.mjs`, `transform.mjs` (`spellcastingFor`) e
    `build-mvp-subset.mjs` (`isClassFeaturesCoreDoc`,
    `GRANT_TARGET_CLASS_FEATURE_NAMES`) — **só leitura**, para saber qual
    campo do schema sustenta cada achado.

## 2. Doc da classe (medido)

| Campo               | Valor                                                       |
| ------------------- | ----------------------------------------------------------- |
| `_id`               | `pWHx4SXcft9O2udP`                                          |
| hp                  | 8                                                           |
| keyAbility          | `["cha"]`                                                   |
| perception          | 1 (treinado)                                                |
| savingThrows        | fortitude 1, reflex 1, **will 2** (expert já no nível 1)    |
| attacks             | simple 1, unarmed 1, martial 0, advanced 0, other `{"",0}`  |
| defenses            | light 1, unarmored 1, **medium 0, heavy 0**                 |
| ancestryFeatLevels  | 1, 5, 9, 13, 17                                             |
| classFeatLevels     | 2, 4, 6, 8, 10, 12, 14, 16, 18, 20                          |
| generalFeatLevels   | 3, 7, 11, 15, 19                                            |
| skillFeatLevels     | 2, 4, 6, 8, 10, 12, 14, 16, 18, 20                          |
| skillIncreaseLevels | 3, 5, 7, 9, 11, 13, 15, 17, 19                              |
| trainedSkills       | `value: ["religion"]`, `additional: 3`                      |
| spellcasting        | 1                                                           |
| classDC             | **campo ausente** (`'classDC' in system === false`)         |
| publication         | Pathfinder Player Core 2 / ORC / remaster                   |

Confere com o journal ("Trained in Religion", "3 plus your Intelligence
modifier", "Trained in oracle class DC"). O Oracle é a única conjuradora plena
curada até aqui **sem armadura média** (o Druid tem média; Cleric/Wizard/
Sorcerer têm leve como aqui) e com `additional: 3` perícias livres.

### `items{}` — 21 entradas, nome canônico == `entry.name` em **21/21**

Sem a armadilha do Magus (`entry.name` "Lightning Reflexes" ≠ uuid
"Reflex Expertise"): a comparação `entry.name === uuid.split('.').pop()` deu
verdadeiro nas 21.

| Nível (`items{}`) | Feature                    | Nível genérico do arquivo | Divergência?            |
| ----------------- | -------------------------- | ------------------------- | ----------------------- |
| 1                 | Oracle Spellcasting        | 1                         | não                     |
| 1                 | Mystery                    | 1                         | não                     |
| 1                 | Oracular Curse             | 1                         | não                     |
| 1                 | Revelation Spells          | 1                         | não                     |
| 1                 | Spell Repertoire           | 1                         | não                     |
| 3                 | Signature Spells           | 3                         | não                     |
| 7                 | Mysterious Resolve         | 7                         | não                     |
| 7                 | Expert Spellcaster         | 7                         | não                     |
| 9                 | Magical Fortitude          | **5**                     | **SIM**                 |
| 11                | Weapon Expertise           | **5**                     | **SIM**                 |
| 11                | Major Curse                | 11                        | não                     |
| 11                | Divine Access              | 11                        | não                     |
| 11                | Oracular Senses            | 11                        | não                     |
| 13                | Weapon Specialization      | **7**                     | **SIM**                 |
| 13                | Premonition Reflexes       | 13                        | não                     |
| 13                | Light Armor Expertise      | 13                        | não                     |
| 15                | Master Spellcaster         | 15                        | não                     |
| 17                | Greater Mysterious Resolve | 17                        | não                     |
| 17                | Extreme Curse              | 17                        | não                     |
| 19                | Legendary Spellcaster      | 19                        | não                     |
| 19                | Oracular Clarity           | 19                        | não                     |

**Três divergências**, todas em features compartilhadas com muitas classes (o
arquivo genérico carrega o nível de *outra* classe). Registradas em
`dedupe.collisionsDetected`. A fonte de verdade é o nível do `items{}`.

## 3. Features compartilhadas com outras classes (união do `items{}` das 27 classes)

| Feature do Oracle          | Nº de classes | Classes                                                                                                                    |
| -------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Weapon Specialization      | 25            | todas as 27 **exceto `exemplar` e `psychic`** (medido, não estimado) — o caso-teste clássico de redundância                |
| Weapon Expertise           | 14            | champion, druid, exemplar, guardian, investigator, kineticist, magus, oracle, psychic, sorcerer, swashbuckler, thaumaturge, witch, wizard |
| Expert Spellcaster         | 10            | animist, bard, druid, magus, oracle, psychic, sorcerer, summoner, witch, wizard                                            |
| Master Spellcaster         | 10            | idem Expert Spellcaster                                                                                                    |
| Legendary Spellcaster      | 8             | animist, bard, druid, oracle, psychic, sorcerer, witch, wizard                                                             |
| Light Armor Expertise      | 6             | bard, investigator, kineticist, oracle, rogue, swashbuckler                                                                |
| Spell Repertoire           | 5             | bard, oracle, psychic, sorcerer, summoner                                                                                  |
| Signature Spells           | 4             | bard, oracle, psychic, sorcerer                                                                                            |
| Magical Fortitude          | 4             | oracle, sorcerer, witch, wizard                                                                                            |
| Mystery                    | 1             | só oracle                                                                                                                  |
| Oracle Spellcasting        | 1             | só oracle                                                                                                                  |
| Oracular Curse             | 1             | só oracle                                                                                                                  |
| Revelation Spells          | 1             | só oracle                                                                                                                  |
| Mysterious Resolve         | 1             | só oracle                                                                                                                  |
| Greater Mysterious Resolve | 1             | só oracle                                                                                                                  |
| Oracular Senses            | 1             | só oracle                                                                                                                  |
| Premonition Reflexes       | 1             | só oracle                                                                                                                  |
| Major Curse                | 1             | só oracle                                                                                                                  |
| Extreme Curse              | 1             | só oracle                                                                                                                  |
| Divine Access              | 1             | só oracle                                                                                                                  |
| Oracular Clarity           | 1             | só oracle                                                                                                                  |

**9 compartilhadas, 12 exclusivas.** As 9 compartilhadas são exatamente as 9 já
presentes nos packs (§4) — a regra R1 (redundância zero) se aplica sem sobra.

## 4. O que já existe nos packs — REUSAR

Cruzamento por `flags.fusion.sourceId` contra `class-features-core` (318 docs).
Nas 9, `sourceId` do pack == `_id` do arquivo do vendor:

| Feature               | sourceId (= `_id` do vendor) |
| --------------------- | ---------------------------- |
| Spell Repertoire      | `1RfnAiyQ5FR7vnuH`           |
| Signature Spells      | `VKRjmXxBFLrJK01c`           |
| Expert Spellcaster    | `cD3nSupdCvONuHiE`           |
| Magical Fortitude     | `70jqXP2eS4tRZ0Ok`           |
| Weapon Expertise      | `9XLUh9iMepZesdmc`           |
| Light Armor Expertise | `pZYkb12t5DSwtts7`           |
| Weapon Specialization | `9EqIasqfI8YIM3Pt`           |
| Master Spellcaster    | `l1InYvhnQSz6Ucxc`           |
| Legendary Spellcaster | `Hfaa7TuLn3nE8lr3`           |

**Faltam 34 documentos** em `class-features-core`: as 12 features exclusivas do
`items{}` + as **11 opções de mistério** (entram pelo ramo de eixo) + as **11
maldições** (entram por `classFeatures.extraNames`, §5.2). Nenhuma das 11
opções nem das 11 maldições está no pack hoje (conferido por `sourceId`, um a
um).

Nos outros packs: **37/37** magias de foco já em `spells-core` e a **condição
`Cursebound` já em `conditions`** (43 docs) — ver §9. `classes-core` tem 15
classes e **não** tem Oracle.

## 5. Eixo de sub-escolha

### 5.1 O eixo

Um só: **`oracle-mystery`**, categoria derivada `mystery`
(`axisCategoryFromOtherTag("oracle-mystery","oracle")` → `"mystery"`,
conferido rodando a função), nível 1, `choose: 1`, **11 opções** contadas por
varredura da `otherTag` nos 842 arquivos de `class-features/`:

| Opção     | `_id`              | Perícia   | Publicação                        |
| --------- | ------------------ | --------- | --------------------------------- |
| Ancestors | `qvRlih3u7vK3FYUR` | Society   | Player Core 2                     |
| Ashes     | `g3HTg0z3doXZZzAV` | Occultism | Lost Omens Divine Mysteries       |
| Battle    | `gjOGOR30Czpnx3tM` | Athletics | Player Core 2                     |
| Blight    | `1PHDn7WJFtR3NgTr` | Nature    | Lost Omens Divine Mysteries       |
| Bones     | `IaxmCkdsPlA52spu` | Medicine  | Player Core 2                     |
| Cosmos    | `RI2EMRBBPNSoTJXu` | Nature    | Player Core 2                     |
| Flames    | `GTSvbFb36InvuH0w` | Acrobatics| Player Core 2                     |
| Life      | `o1gGG36wpn9mxeop` | Medicine  | Player Core 2                     |
| Lore      | `tZBb3Kh4nJcNoUFI` | Occultism | Player Core 2                     |
| Tempest   | `W9cF7wZztLDb1WGY` | Nature    | Player Core 2                     |
| Time      | `EslxR2sbDK9XJaAl` | Occultism | Dark Archive (Remastered)         |

Todas `common`, `system.category === "classfeature"`, traits `[oracle]`, e
**nenhuma** carrega `class-archetype` (varredura completa) — então
`optionCount: 11` vale para todo caminho, ao contrário do `Battle Creed` no
eixo `cleric-doctrine`.

`featureNameInItemsMap: "Mystery"` casa com o `items{}`: a entrada de nível 1
tem nome canônico `Mystery`, e o doc `Mystery` (`PRJYLksQEwT39bTl`) tem o
`ChoiceSet` `{choices:{filter:["item:tag:oracle-mystery"]}, flag:"mystery"}`
seguido de `GrantItem` do escolhido — a forma canônica que o contrato já cobre.

### 5.2 O achado estrutural: cada mistério concede TRÊS coisas

Medido nos `rules` dos 11 docs. Cada opção faz:

1. `ActiveEffectLike` que treina a perícia do mistério (coluna acima);
2. `GrantItem` de um **talento de nível 1 com trait `cursebound`** — alvo
   dentro dos 56 candidatos, resolvido pelo trait (caso feliz, igual ao Druid);
3. `GrantItem` de uma class-feature **`Curse of …`** que **não está no
   `items{}`** e **não tem a `otherTag` do eixo**.

O item (3) é a armadilha: sem declaração explícita esse grant materializa em
**nada** (é a família da issue #16, que `GRANT_TARGET_CLASS_FEATURE_NAMES`
resolve com lista escrita à mão em arquivo compartilhado). **Não foi preciso
tocar arquivo compartilhado**: as 11 entraram em `classFeatures.extraNames`,
campo que `curatedClassFeatureNames()` já lê — o mesmo mecanismo que
`cleric.json` usou para as 12 doutrinas. Verificado rodando
`curatedClassFeatureNames()` com esta curadoria no disco: as 11 aparecem na
união (228 nomes).

| Mistério  | Talento L1 concedido | Maldição concedida            | `_id` da maldição  |
| --------- | -------------------- | ----------------------------- | ------------------ |
| Ancestors | Whispers of Weakness | Curse of Ancestral Meddling   | `vXnMKFIxqLuCDW9q` |
| Ashes     | Whispers of Weakness | Curse of Creeping Ashes       | `2VclK5CWR1Vz1vqL` |
| Battle    | Oracular Warning     | Curse of the Mortal Warrior   | `zLYqrQdheciiW2nm` |
| Blight    | Whispers of Weakness | Curse of Inevitable Rot       | `5QVUaQGT1FSkFOYP` |
| Bones     | Nudge the Scales     | Curse of the Living Death     | `8ODGE24gqEdzWljj` |
| Cosmos    | Oracular Warning     | Curse of the Sky's Call       | `d03gBFLK4XJlDNNh` |
| Flames    | Foretell Harm        | Curse of Engulfing Flames     | `RI2UHuUZd3TC1OE8` |
| Life      | Nudge the Scales     | Curse of Outpouring Life      | `zO7dvBgLuhdGfP5t` |
| Lore      | Whispers of Weakness | Curse of Torrential Knowledge | `XQjR07LkDedC7tkc` |
| Tempest   | Foretell Harm        | Curse of Inclement Headwinds  | `LIV2gH3ZUFlu0zu4` |
| Time      | Trance of Celerity   | Curse of Turbulent Moments    | `X6GQ4ngqpjP8SpCq` |

Os 5 talentos-alvo distintos são todos L1, traits `[cursebound, divine,
oracle]`, em `feats/class/oracle/level-1/` — já dentro dos 56 pelo trait.

## 6. Class feats

- **39** exclusivos em `feats/class/oracle/level-*/`.
- **17** de `shared-class-feats/level-*/` (113 arquivos) com trait `oracle`.
- **Total candidato: 56.** Todos com `system.category === "class"`
  (0 exceções) e todos os 39 exclusivos carregam o trait `oracle` (0 exceções).
- **17 de 56 já estão em `feats-core` por `sourceId`** — e são **exatamente**
  os 17 compartilhados. Os 39 exclusivos são 100% novos. 0 casos de "mesmo nome,
  `sourceId` diferente".

| Nível | exclusivos | compartilhados | total |
| ----- | ---------- | -------------- | ----- |
| 1     | 6          | 2              | 8     |
| 2     | 3          | 1              | 4     |
| 4     | 2          | 4              | 6     |
| 6     | 3          | 2              | 5     |
| 8     | 4          | 1              | 5     |
| 10    | 5          | 2              | 7     |
| 12    | 3          | 2              | 5     |
| 14    | 4          | 3              | 7     |
| 16    | 3          | 0              | 3     |
| 18    | 2          | 0              | 2     |
| 20    | 4          | 0              | 4     |
| **Σ** | **39**     | **17**         | **56**|

Nenhum dos 56 tem trait `archetype` (varredura completa) — não existe aqui o
conflito "archetype vence trait de classe" que fez `wizard.json`/`druid.json`
excluírem os 10 talentos `* Mask`. `excludeNames` fica vazio.

Licença/raridade: 46 `common`, 9 `uncommon`, 1 `rare` (`Sacral Lord`). 9 são
OGL, mas 8 desses já estão no pack — e `feats-core` já tem 613 docs OGL contra
1592 ORC, ou seja, não há política de exclusão vigente. O **único documento OGL
novo** que esta curadoria acrescenta é `Scapegoat Parallel Self` (L20,
exclusivo, uncommon, *Pathfinder #168: King of the Mountain*).

## 7. Pré-requisitos

**22 dos 56** têm `system.prerequisites` não vazio. Classificação:

- **6 resolvem para outro nó do conjunto da classe** (cadeias internas,
  gravadas em `prerequisites.internalChains`):
  Domain Fluency→Domain Acumen; Lighter than Air→Water Walker;
  Sacral Monarch→Sacral Lord; Diverse Mystery→Advanced Revelation;
  Paradoxical Mystery→Greater Revelation; e
  Oracular Providence→"oracular clarity" (minúsculo, casa case-insensitive com
  a class feature `Oracular Clarity` do `items{}`, L19 — mesma forma de
  "bravery"/"shield block" no Fighter).
  Mais `Knowledge of Shapes` → "Reach Spell or Widen Spell": disjunção cujos
  **dois** alvos estão no conjunto (e já em `feats-core`).
- **6 apontam para uma OPÇÃO DO EIXO** pelo texto `<mistério> mystery`:
  `On Borrowed Time`→"time mystery"; `Roll the Bones of Fate`→"bones or lore
  mystery"; `The Dead Walk`→"ancestors or battle mystery"; `Trial by
  Skyfire`→"cosmos or flames mystery"; `Waters of Creation`→"life or tempest
  mystery"; `Conduit of Void and Vitality`→"any oracle mystery" (curinga).
  É o formato "animal order" do Druid / "dragon instinct" do Barbarian (nome
  da opção em minúsculas + sufixo do eixo), **não** a armadilha do Psychic.
  Como os 11 docs de mistério entram no pack, o casamento resolveria — mas
  nada hoje lê pré-requisito de opção de eixo: **declarado, não mecanizado**.
- **2 apontam para a magia de revelação** ("initial revelation spell":
  `Advanced Revelation` L6 e `Greater Revelation` L12). Esse vínculo não existe
  estruturado em lugar nenhum (§10.2).
- **Não mecanizáveis** (atributo do nó ou classe alheia; texto preservado, sem
  predicado inventado — REQ-BC-034): "divine spells" (2x), "ability to cast
  focus spells", "you follow a good-aligned deity", "trained in Occultism or
  Religion", "master in Occultism or Religion", e as três variantes de
  "…create or control undead" acompanhadas de **"cleric with a negative font,
  oracle of bones, or necromancer wizard"** — única família em que a mesma
  opção de eixo aparece com um **segundo formato** de texto ("oracle of bones",
  não "bones mystery").

`prerequisiteFixes: []` — não há nome legado, typo do vendor nem "AND que
deveria ser OR" (todas as disjunções já vêm numa entrada só; o defeito da
issue #30 era o oposto).

### Forma exata do JSON do vendor (5 exemplos)

```json
// feats/class/oracle/level-10/on-borrowed-time.json
{ "value": [{ "value": "time mystery" }] }
```

```json
// feats/class/oracle/level-4/knowledge-of-shapes.json
{ "value": [{ "value": "Reach Spell or Widen Spell" }] }
```

```json
// feats/class/oracle/level-20/oracular-providence.json
{ "value": [{ "value": "oracular clarity" }] }
```

```json
// feats/class/shared-class-feats/level-14/sacral-monarch.json
{ "value": [{ "value": "Sacral Lord" }, { "value": "master in Occultism or Religion" }] }
```

```json
// feats/class/shared-class-feats/level-4/undying-conviction.json
{
  "value": [
    { "value": "able to create or control undead" },
    { "value": "cleric with a negative font, oracle of bones, or necromancer wizard" }
  ]
}
```

## 8. Preparação para multiclasse (§4 do plano)

- Gate derivado dos 56: trait `oracle` + `category:"class"` →
  `{"class_level":{"oracle":{">=":N}}}`, N = nível do arquivo do feat.
- **Ambiguidade em 17 de 56** (os mesmos que já estão no pack): carregam trait
  de 2+ classes. O predicado correto é `any` sobre as classes do trait, nunca
  uma escolha arbitrária — mesmo achado já registrado em `wizard.json`,
  `cleric.json`, `barbarian.json`, `psychic.json` e `druid.json`. Lista:
  Reach Spell (7 classes), Widen Spell (5), Cantrip Expansion (8),
  Bespell Strikes (3), Prayer-Touched Weapon (2), Sacral Lord (2),
  Undying Conviction (3), Detonating Spell (5), Steady Spellcasting (8),
  Chaotic Spell (5), Consecrate Spell (3), Quickened Casting (5),
  Magic Sense (3), Necromancer's Visage (3), Purifying Breeze (3),
  Sacral Monarch (2), Sepulchral Sublimation (3).
- `Oracle Dedication` **não entra**: traits `[archetype, dedication,
  multiclass]` sem o trait `oracle`, então nenhum predicado a alcança. Mesma
  decisão deliberada do Druid (medir a classe PURA); nada na catraca depende
  dela hoje.

## 9. Cursebound — o miolo mecânico

O que **é** dado hoje, medido:

- A **condição `Cursebound` já está no Fusion**
  (`systems/pf2e/packs/conditions/documents.json`, 43 docs; `_id` do vendor
  `zXZjC8HLaRoLR17U`). É isso que torna a espinha da classe mecanizável em vez
  de fantasia.
- **16 dos 56** class feats carregam o trait `cursebound` (todos exclusivos):
  Foretell Harm, Nudge the Scales, Oracular Warning, Trance of Celerity,
  Whispers of Weakness (L1); Meddling Futures (L2); Knowledge of Shapes,
  Thousand Visions (L4); Debilitating Dichotomy (L8); On Borrowed Time, Roll
  the Bones of Fate, The Dead Walk, Trial by Skyfire, Waters of Creation (L10);
  Conduit of Void and Vitality (L16); Mystery Conduit (L20).
- **5 das 37** magias de foco também: Ash Form, Call to Arms, Debilitating
  Dichotomy, Heroic Feat, Vision of Weakness.
- O **efeito por nível de maldição** vive nas 11 `Curse of …` como `rules` com
  predicado sobre `self:condition:cursebound`. Exemplo integral medido
  (`Curse of Inclement Headwinds`):

  ```json
  [
    { "key": "Weakness", "predicate": ["self:condition:cursebound"], "type": "electricity",
      "value": "ternary(gte(@actor.conditions.cursebound.value,3),5+@actor.level,2)" },
    { "key": "FlatModifier", "predicate": [{ "gte": ["self:condition:cursebound", 2] }],
      "selector": "ranged-attack-roll", "type": "circumstance", "value": -2 },
    { "key": "FlatModifier", "predicate": ["self:condition:cursebound:4"],
      "selector": "speed", "value": -10 }
  ]
  ```

- O doc `Oracular Curse` (L1) **não tem mecânica**: é só um `ItemAlteration`
  que injeta duas notas de descrição nos itens com trait `cursebound`, com o
  teto 1/2/3/4 conforme o personagem tenha `feature:major-curse` /
  `feature:extreme-curse`. As features `Major Curse` (L11) e `Extreme Curse`
  (L17) têm `rules: []` — elas existem só para o predicado do teto.

**Dívida declarada:** o Fusion não tem motor de condição com valor escalar nem
avaliador de fórmula (`@actor.level`, `ternary`/`gte`). Os documentos entram com
os `rules` preservados e **sem consumidor**. Nenhum predicado foi inventado.

## 10. Conjuração e magias de foco

### 10.1 Tabela — conjuradora ESPONTÂNEA divina

Transcrita célula a célula do journal (12 colunas × 20 linhas). Perfil: 5
truques do nível 1 ao 20; 3 slots de rank 1 no nível 1 e **4 por rank** dali em
diante (nunca 2 — ao contrário de Bard e Psychic). Rank 10 nos níveis 19-20 vem
da class feature `Oracular Clarity` (marcado com `*` no journal, "works
differently"), mesmo padrão do Miraculous Spell/Primal Hierophant/Archwizard's
Spellcraft; só o slot base `10:1` está na tabela.

Níveis 1 a 3, explícitos: **L1** = 5 truques + 3 de rank 1; **L2** = 5 + 4 de
rank 1; **L3** = 5 + 4 de rank 1 + 3 de rank 2.

#### Conferência independente — e a divergência

| Fonte                                | L1                | L3                       | L5                           |
| ------------------------------------ | ----------------- | ------------------------ | ---------------------------- |
| Journal (`bqaqOx3naiwTozBX`)         | `{1:3}`           | `{1:4, 2:3}`             | `{1:4, 2:4, 3:3}`            |
| Pregen **Korakai** (`iconics/korakai`)| `{1:3}`          | `{1:4, 2:3, **3:3**}`    | `{1:4, 2:4, 3:3}`            |

Bate em L1 e L5. **Diverge em L3**, e a divergência está sendo reportada, não
varrida: `korakai-level-3.json` traz `slot3: {max:3, value:3}` que o journal não
tem. **Três evidências independentes** identificam a pregen como a fonte
defeituosa, e é por isso que a tabela adotada é a do journal — não por ser "a
mais bonita":

1. o repertório da própria ficha L3 **não tem nenhuma magia de rank 3** (maior
   rank presente = 2), então o slot ficaria vazio por construção;
2. a **primeira** tabela do MESMO journal diz "2nd-rank spells" na linha 3 e
   "3rd-rank spells" só na linha 5;
3. o `slot3` de L3 é **idêntico** ao de L5 (`{max:3, value:3}`) — assinatura de
   cópia não-limpa entre as duas fichas.

**Quarta fonte, totalmente fora do Oracle:** a tabela transcrita é **idêntica
célula a célula** (20/20 linhas, 0 diferenças, conferido por script) à de
`sorcerer.json` desta mesma pasta, curada noutra rodada a partir de outro
journal. `bard.json` **não** bate (2/3 slots), o que descarta a hipótese de eu
ter transcrito a tabela errada da página.

Korakai também confirma `tradition: divine`, `prepared.value: spontaneous`,
`ability: cha` na entrada "Divine Spontaneous Spells", e — de brinde — confirma
o mecanismo de magias concedidas: ela tem 6 truques no nível 1, sendo o sexto
`Electric Arc`, que é exatamente o truque concedido pelo mistério **Tempest**
(o dela). 6 − 1 concedido = **5 escolhidos**, o número do journal.

### 10.2 Magias de foco e o vínculo mistério → revelação

**37** magias com trait `oracle`, **37/37 já em `spells-core` por `sourceId`**
(não por nome). Esta rodada não toca `spells-core`.

O que **falta** é o vínculo mistério → magia de revelação, que **não existe
estruturado em lugar nenhum do vendor**: só na prosa HTML de cada doc de
mistério, como `@UUID[Compendium.pf2e.spells-srd.Item.<nome>]` sob os rótulos
`initial` / `advanced` / `greater`. Extraído por parse (33 pares; os 33 alvos
conferidos presentes em `spells-core`):

| Mistério  | initial             | advanced               | greater                 |
| --------- | ------------------- | ---------------------- | ----------------------- |
| Ancestors | Ancestral Touch     | Ancestral Defense      | Ancestral Form          |
| Ashes     | Ashen Wind          | Incendiary Ashes       | Ash Form                |
| Battle    | Weapon Trance       | Battlefield Persistence| Revel in Retribution    |
| Blight    | Ulcerous Canker     | Purging Toxins         | Accelerated Decomposition |
| Bones     | Soul Siphon         | Armor of Bones         | Claim Undead            |
| Cosmos    | Spray of Stars      | Interstellar Void      | Moonlight Bridge        |
| Flames    | Incendiary Aura     | Whirling Flames        | Flaming Fusillade       |
| Life      | Life Link           | Delay Affliction       | Life-Giving Form        |
| Lore      | Brain Drain         | Access Lore            | Dread Secret            |
| Tempest   | Tempest Touch       | Thunderburst           | Tempest Form            |
| Time      | Temporal Distortion | Time Skip              | Manifold Lives          |

Não há campo no schema de curadoria onde gravar isso — **dívida declarada**,
mesma família do domínio→magia de domínio que `cleric.json` registrou.

### 10.3 Magias concedidas pelo mistério — 7 faltam (dívida medida)

Cada mistério adiciona ao repertório 4 magias divinas **normais** (1 truque + 3
de ranks fixos). São **41 distintas**; **34 já estão em `spells-core`** e
**7 faltam**, medidas nome a nome:

| Magia              | Mistério  | Rank    |
| ------------------ | --------- | ------- |
| Vitality Lash      | Life      | truque  |
| Ill Omen           | Ancestors | 1º      |
| Soothe             | Life      | 1º      |
| Hypercognition     | Lore      | 3º      |
| Hydraulic Torrent  | Tempest   | 4º      |
| Dreaming Potential | Ancestors | 5º      |
| Moon Frenzy        | Cosmos    | 5º      |

É exatamente o buraco de tradição divina que o §9 do plano manda **declarar** e
não fechar aqui. Consequência concreta: 4 dos 11 mistérios ficam com pelo menos
uma magia concedida sem documento no pack, e `Vitality Lash` é **truque** —
aparece já no nível 1 (a própria Korakai tem `Vitality Lash` na ficha de L1).

## 11. Tabela esperada de `proficiencyUpgrades`

Derivável 100% de `subfeatures.proficiencies`; `proficiencyUpgradeExtras: []`.
Todos os níveis são os do `items{}` do Oracle, nunca os genéricos.

| level | stat            | rank | origem                                              |
| ----- | --------------- | ---- | --------------------------------------------------- |
| 7     | will            | 3    | Mysterious Resolve (`{"will":{"rank":3}}`)          |
| 7     | spellcasting    | 2    | Expert Spellcaster                                  |
| 9     | fortitude       | 2    | Magical Fortitude (genérico diz 5 — usar 9)         |
| 11    | perception      | 2    | Oracular Senses                                     |
| 11    | weapons.simple  | 2    | Weapon Expertise (genérico diz 5 — usar 11)         |
| 11    | weapons.unarmed | 2    | Weapon Expertise                                    |
| 13    | reflex          | 2    | Premonition Reflexes                                |
| 13    | armor.light     | 2    | Light Armor Expertise                               |
| 13    | armor.unarmored | 2    | Light Armor Expertise                               |
| 15    | spellcasting    | 3    | Master Spellcaster                                  |
| 17    | will            | 4    | Greater Mysterious Resolve                          |
| 19    | spellcasting    | 4    | Legendary Spellcaster                               |

**12 linhas.** Não produzem linha: Weapon Specialization (L13, bônus de dano),
Oracular Clarity (L19, slot de rank 10), Major Curse (L11), Extreme Curse (L17)
e Divine Access (L11) — `subfeatures` vazio nas cinco.

Perfil resultante, conferido contra a progressão do remaster fora do pack:
**Will é o único stat que chega a legendary** (rank 4 @L17, a defesa-assinatura
da classe); spellcasting chega a legendary @L19; Fortitude e Reflex param em
expert (9 e 13); Perception para em expert (11); armadura para em expert leve
(13); arma para em expert (11). O Oracle **nunca** fica master em Fortitude nem
em Perception, e o **class DC nasce treinado e nunca sobe** (nenhuma das 21
features tem chave de subfeature `oracle` — ao contrário do Fighter, cuja chave
`fighter` vira upgrade de classDC).

## 12. Validação do schema (§5 do PLANO, rodada agora)

```
$ node --input-type=module -e "import {validateClassCuration} from './tools/importer-pf2e/src/curation/index.mjs'; import {readFileSync} from 'node:fs'; const f='oracle.json'; const cfg=validateClassCuration(JSON.parse(readFileSync('tools/importer-pf2e/src/curation/classes/'+f,'utf8')), f); console.log('OK', cfg.class, 'eixos:', cfg.choiceAxes.length, 'feats.trait:', cfg.classFeats.trait);"
OK oracle eixos: 1 feats.trait: oracle
```

Verificação extra (o loader inteiro, que também pega slug duplicado e nome de
arquivo divergente):

```
$ node --input-type=module -e "import {loadClassCuration, axisCategoryByOtherTag, axisLevelByOtherTag, curatedClassFeatureNames} from './tools/importer-pf2e/src/curation/index.mjs'; ..."
classes curadas: 16 barbarian,bard,champion,cleric,druid,fighter,gunslinger,kineticist,magus,monk,oracle,psychic,ranger,rogue,sorcerer,wizard
category do eixo: mystery | level: 1
uniao de class-feature names: 228
  na uniao? Curse of Ancestral Meddling true
  na uniao? Curse of Turbulent Moments true
  na uniao? Mystery true
  na uniao? Oracular Clarity true
```

## 13. Divergências contra a medição preliminar do orquestrador

**Nenhuma.** Todos os números preliminares foram confirmados por medição:
hp 8, atributo-chave `cha`, 21 features no `items{}` (9 já nos packs), 56 class
feats (39 exclusivos + 17 compartilhados), 17 já em `feats-core` por
`sourceId`, 1 eixo `oracle-mystery` com 11 opções, 37 magias com trait `oracle`
todas já em `spells-core`.

O que a medição **acrescentou** ao levantamento preliminar:

- as **11 maldições** (`Curse of …`), que não estão no `items{}` nem no eixo e
  não apareciam em contagem nenhuma — 11 documentos a mais no pack;
- as **3 divergências** entre nível do `items{}` e nível genérico;
- a coincidência exata "17 com trait duplo == 17 já no pack";
- as **7 magias concedidas faltando** em `spells-core`;
- a **divergência L3** journal × pregen Korakai;
- o **1 documento OGL novo** (`Scapegoat Parallel Self`).

## 14. Decisões tomadas

1. `classFeatures.extraNames` recebe as 11 maldições — em vez de pedir edição
   de `GRANT_TARGET_CLASS_FEATURE_NAMES` em `build-mvp-subset.mjs`. É o mesmo
   mecanismo de `cleric.json` e não toca arquivo compartilhado.
2. `spellcasting` no formato **`table[]` + `source`** (modelo do `druid.json`),
   não no formato `cantripsKnown`+`slots` do `sorcerer.json`.
   `spellcastingFor()` em `transform.mjs` aceita os dois e converte — lido, não
   suposto.
3. Tabela do journal adotada, com a divergência L3 documentada em
   `spellcasting.source` e neste relatório (§10.1). Não é "escolher a fonte
   mais bonita": três evidências identificam o defeito na pregen e uma quarta
   fonte (`sorcerer.json`) corrobora a tabela inteira.
4. `Scapegoat Parallel Self` (OGL) **mantido**: excluí-lo mudaria a regra
   vigente do pack (613 docs OGL já lá dentro) em vez de segui-la. Registrado
   para decisão da integração central.
5. `Spell Repertoire (Oracle)` **fora** do pack: o `items{}` aponta para o
   genérico. Consequência documentada (o texto do genérico é um `@Localize` que
   o pipeline não resolve).
6. `excludeNames: []`, `prerequisiteFixes: []`, `proficiencyUpgradeExtras: []`,
   `proficiencyMirrors: {}` — nenhum foi necessário, e cada um foi testado
   contra o dado antes de ficar vazio.
7. `Oracle Dedication` fora (sem trait `oracle`), igual ao Druid.

## 15. Riscos, dívidas e perguntas em aberto para a integração central

**Dívidas declaradas (não mecanizadas, sem predicado inventado):**

- **Cursebound sem motor.** Condição escalar (1→4), fórmulas
  `ternary/gte/@actor.level` e predicados `self:condition:cursebound:N`. Os
  documentos entram completos; nada os consome. É o miolo da classe.
- **Mistério → magia de revelação** (33 pares) e **mistério → domínios**: só na
  prosa; não há campo de curadoria. Mesma família da lacuna domínio→magia que
  `cleric.json` abriu — o Oracle é o **segundo** consumidor, o que a promove de
  lacuna de uma classe a lacuna de contrato.
- **7 magias divinas concedidas faltando** em `spells-core` (§10.3), uma delas
  truque de nível 1.
- **Perícia do mistério** não aplicada (mesma dívida da perícia de ordem do
  Druid). `trainedSkills.additional: 3` está certo e não deve ser mexido.
- **`Diverse Mystery` (L16) e `Paradoxical Mystery` (L20)**: escolha aninhada
  sobre **spell** (filtro `{itemType:'spell', filter:['item:trait:focus',
  'item:trait:oracle',{lte:['item:rank',3]}]}` + 10 rules condicionais por
  magia escolhida) e escolha **diária**. `GRANTED_FEAT_FILTERS` do `planVM.ts`
  só filtra feat; escolha por preparação diária não existe no Fusion.
  Classificar como `pendente` em `choiceSetInventory.ts`.

**Perguntas em aberto:**

1. **Repertório de conjuradora espontânea não cabe no schema.**
   `spellcastingFor()` emite só `{tradition, type, ability, cantripsKnown[],
   slots[]}`. Não há campo para **quantas magias o conjurador espontâneo
   CONHECE por rank**, que no Oracle é **diferente** do número de slots:
   `Spell Repertoire (Oracle)` (`cFe6vFb3gSDyNeS9`) diz "you learn **two**
   1st-rank divine spells and **five** divine cantrips" — 2 conhecidas contra
   **3** slots no nível 1. A lacuna **não é do Oracle**: `bard.json`,
   `sorcerer.json` e `psychic.json` também são espontâneos e nenhum declara
   repertório; hoje `type:"spontaneous"` só diz "não prepara". Duas saídas, sem
   preferência declarada aqui: (a) campo novo
   `repertoire: [{level, known:{rank:count}}]`, preenchido para as 4 classes
   espontâneas de uma vez; (b) derivar de `slots[]` com um delta por classe (no
   Oracle, −1 no rank 1 do nível 1). **Enquanto isso, a ficha de Oracle oferece
   slots sem saber o limite de magias conhecidas.**
2. **`KNOWN_DIVERGENCES` para o gate #48.** Publicar a classe traz **Korakai**
   para dentro de `pregen-parity.test.ts`. Se o teste comparar slots célula a
   célula, a ficha de nível 3 dela vai acusar divergência **real do dado do
   vendor** (§10.1) — candidata a `Oracle/spellSlots@3`, na mesma prateleira
   das entradas de Gunslinger e Psychic. Somado a `Oracle/skillIncreaseCeiling`
   (issue #49, que atinge toda classe).
3. **Gate de class feat com múltiplos traits de classe** (17 de 56): o
   predicado vira `any` entre as classes-trait, ou os feats também ganham um
   `grantedBy`-like? Pergunta herdada do Fighter, ainda sem decisão registrada.
4. **`Scapegoat Parallel Self` (OGL)** entra ou sai? A regra vigente diz que
   entra; se a política mudar, é o único documento afetado nesta classe.
5. **Filtro por publicação.** `isClassFeaturesCoreDoc` não filtra por
   `publication.title`. Se alguém adicionar um filtro por
   `PLAYER_CORE_PUBLICATION_TITLE`, o eixo cai de **11 para 9 opções** (saem
   Ashes, Blight, Time e as maldições correspondentes) sem ninguém perceber.
6. **Fiação do client** (fora desta fase, custo do piloto): 4 linhas em
   `planVM.ts` (`PlanSlotType` ganha `'mystery'`, `SLOT_TYPE_LABELS`,
   `CLASS_CHOICE_SLOTS['Mystery'] = 'mystery'`,
   `CLASS_CHOICE_SLOT_OPTIONS.mystery = {packSlug:'class-features-core',
   category:'mystery'}`) + entradas em `choiceSetInventory.ts` (o ChoiceSet de
   `Mystery` resolvido; os de `Diverse Mystery`/`Paradoxical Mystery`
   pendentes).
7. **Rebuild obrigatório com transform.** As 11 opções entram só pelo ramo
   `axisCategories.has(doc.system.category)`, e `system.category` só vira
   `mystery` quando `transform.mjs` roda **com esta curadoria no disco**. Rodar
   `build-mvp-subset.mjs` sobre um `out/` antigo faz o eixo sair com 0 opções e
   `transform.test.mjs` reprovar em "eixo sem nenhuma opção no pack".
