# r29 — Animist — relatório de curadoria

Arquivo de configuração produzido:
`tools/importer-pf2e/src/curation/classes/animist.json`.

> **Resumo do que mudou em relação à medição preliminar do orquestrador:** hp 8 /
> wis / 15 features (6 nos packs) / 39 class feats (3 nos packs) / 14 magias
> (todas nos packs) — **todos confirmados**. O que **não** confere: os eixos são
> **DOIS**, não um (`animist-apparition` com 13 opções **e** `animistic-practice`
> com 4), e a conjuração é **DUPLA** (preparada divina + espontânea de aparição
> na mesma tabela), o que o `ClassSpellcastingSchema` não representa.

## 1. Método (comandos rodados)

Todas as contagens vieram de scripts `node` executados **agora**, contra
`tools/importer-pf2e/vendor/pf2e/packs/pf2e/` (junction somente-leitura) e
`systems/pf2e/packs/*/documents.json`. Nenhum arquivo compartilhado foi tocado;
nenhum `git` de escrita, nenhum `pnpm`, nenhum importer. Os scripts descartáveis
ficaram fora da worktree (scratchpad da sessão). Cada medição é reconstruível a
partir da descrição abaixo:

1. **Doc da classe** — leitura de `classes/animist.json`:
   `system.{hp,keyAbility,perception,savingThrows,attacks,defenses,items,
   ancestryFeatLevels,classFeatLevels,generalFeatLevels,skillFeatLevels,
   skillIncreaseLevels,trainedSkills,spellcasting,classDC,rules,publication}`.
2. **Nome canônico** — para as 15 entradas do `items{}`, comparação
   `entry.name === uuid.split(".").pop()`.
3. **Nível genérico × nível do `items{}`** — varredura **recursiva** de
   `class-features/` (828 arquivos), índice por `name`, comparação de
   `system.level.value` contra o nível do `items{}`.
4. **Features compartilhadas** — varredura das **27** pastas `classes/*.json`,
   união dos nomes canônicos do `items{}` de cada uma, contagem por feature.
5. **Eixos** — varredura de `system.traits.otherTags` em `class-features/**`
   procurando o prefixo `animist`; e busca da **literal** `animist-apparition`
   em `class-features/`, `feats/`, `spells/`, `classes/`, `actions/`,
   `campaign-effects/`, `feat-effects/`, `spell-effects/`, `other-effects/` e
   `journals/` (para descobrir quem consome a tag).
6. **Class feats** — varredura recursiva de `feats/class/animist/level-*/`
   (36 arquivos) + `feats/class/shared-class-feats/level-*/` (113 arquivos,
   filtrados pelo trait `animist`). A pasta compartilhada é subdividida por
   nível: `readdirSync` raso devolve 0.
7. **Cruzamento com os packs** — `feats-core` (2.205 docs),
   `class-features-core` (318), `spells-core` (1.310), sempre por
   **`flags.fusion.sourceId`**, com um segundo cruzamento por `name` só para
   detectar homônimo com sourceId diferente.
8. **Tabela de conjuração** — parse do HTML de `journals/classes.json`, página
   `ThFPVuxGiZ2Asgyr` ("Animist"), célula a célula (`<tr>`/`<td>`), com o
   split `A+B` de cada célula feito em código.
9. **Conferência independente** — fichas pregen do icônico **Samo**
   (`iconics/samo/samo-level-{1,3,5}.json`), lendo cada `spellcastingEntry`
   (`system.tradition`, `system.prepared`, `system.ability`, `system.slots`).
10. **Proficiency upgrades** — execução da função pura
    `deriveProficiencyUpgrades` (de
    `tools/importer-pf2e/src/curation/proficiency-upgrades.mjs`) sobre os docs
    **crus** de `class-features/` do vendor, com o `items{}` do Animist.
11. **Validação do §5 do PLANO** — saída colada no §11 deste relatório.
12. **Formatação** — `prettier --check` no JSON produzido (§11).

## 2. Doc da classe (medido)

| Campo               | Valor                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| `_id`               | `9KiqZVG9r5g8mC4V`                                                          |
| hp                  | **8**                                                                       |
| keyAbility          | `["wis"]` (declarado; sem o buraco do Psychic)                              |
| perception          | 1 (trained)                                                                 |
| savingThrows        | fortitude 1, reflex 1, **will 2** (expert já no nível 1)                    |
| attacks             | simple 1, unarmed 1, martial 0, advanced 0, other `{name:"", rank:0}`       |
| defenses            | light 1, medium 1, unarmored 1, heavy 0                                     |
| ancestryFeatLevels  | 1, 5, 9, 13, 17                                                             |
| classFeatLevels     | **2**, 4, 6, 8, 10, 12, 14, 16, 18, 20 (sem talento de classe no nível 1)   |
| generalFeatLevels   | 3, 7, 11, 15, 19                                                            |
| skillFeatLevels     | 2, 4, 6, 8, 10, 12, 14, 16, 18, 20                                          |
| skillIncreaseLevels | 3, 5, 7, 9, 11, 13, 15, 17, 19                                              |
| trainedSkills       | `value: ["religion"]`, `additional: 2`                                      |
| spellcasting        | 1 (trained)                                                                 |
| classDC             | **ausente** (`undefined`) — transform aplica o default 1                    |
| rules               | `[]`                                                                        |
| publication         | `Pathfinder War of Immortals`, license **ORC**, remaster **true**           |

**Divergência journal × doc do vendor:** o journal diz *"Trained in Religion
**and either Nature or Occultism**"* — a escolha Nature-ou-Occultism **não
existe** como dado em lugar nenhum do vendor (nem rule element, nem ChoiceSet).
Lacuna do vendor, não do pipeline. Registrada em `dedupe.collisionsDetected`.

### `items{}` — 15 entradas (nome canônico = segmento final da uuid)

`entry.name === uuid.tail` em **15/15** (sem a armadilha do Magus).

| Nível no `items{}` | Feature                              | Nível genérico do arquivo | Divergência?  | Já em `class-features-core`? |
| ------------------ | ------------------------------------ | ------------------------- | ------------- | ---------------------------- |
| 1                  | Apparition Attunement                | 1                         | não           | **falta**                    |
| 1                  | Animistic Practice                   | 1                         | não           | **falta**                    |
| 1                  | Animist & Apparition Spellcasting    | 1                         | não           | **falta**                    |
| 3                  | Fortitude Expertise                  | 3                         | não           | sim (`F57Na5VxfBp56kke`)     |
| 7                  | Third Apparition                     | 7                         | não           | **falta**                    |
| 7                  | Expert Spellcaster                   | 7                         | não           | sim (`cD3nSupdCvONuHiE`)     |
| 9                  | Perception Expertise                 | **3**                     | **SIM**       | sim (`JCqACxgrm5ixX0Jy`)     |
| 11                 | Expert Protections                   | 11                        | não           | **falta**                    |
| 11                 | Simple Weapon Expertise              | 11                        | não           | **falta**                    |
| 13                 | Master of Mind and Spirit            | 13                        | não           | **falta**                    |
| 13                 | Weapon Specialization                | **7**                     | **SIM**       | sim (`9EqIasqfI8YIM3Pt`)     |
| 15                 | Fourth Apparition                    | 15                        | não           | **falta**                    |
| 15                 | Master Spellcaster                   | 15                        | não           | sim (`l1InYvhnQSz6Ucxc`)     |
| 19                 | Supreme Incarnation                  | 19                        | não           | **falta**                    |
| 19                 | Legendary Spellcaster                | 19                        | não           | sim (`Hfaa7TuLn3nE8lr3`)     |

**Duas divergências de nível** (a armadilha do §4 do plano), ambas em
`dedupe.collisionsDetected`: `Perception Expertise` (3 → 9) e
`Weapon Specialization` (7 → 13).

## 3. Features compartilhadas com outras classes (união dos `items{}` das 27 classes)

| Feature                           | Nº de classes | Classes                                                                                                                                                                                       |
| --------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Weapon Specialization             | 25            | Alchemist, Animist, Barbarian, Bard, Champion, Cleric, Commander, Druid, Fighter, Gunslinger, Inventor, Investigator, Kineticist, Magus, Monk, Oracle, Ranger, Rogue, Sorcerer, Summoner, Swashbuckler, Thaumaturge, Witch, Wizard (+Animist) |
| Perception Expertise              | 12            | Alchemist, Animist, Champion, Cleric, Druid, Exemplar, Inventor, Kineticist, Monk, Sorcerer, Witch, Wizard                                                                                     |
| Expert Spellcaster                | 10            | Animist, Bard, Druid, Magus, Oracle, Psychic, Sorcerer, Summoner, Witch, Wizard                                                                                                                |
| Master Spellcaster                | 10            | idem Expert Spellcaster                                                                                                                                                                        |
| Legendary Spellcaster             | 8             | Animist, Bard, Druid, Oracle, Psychic, Sorcerer, Witch, Wizard                                                                                                                                 |
| Fortitude Expertise               | 7             | Animist, Bard, Commander, Druid, Investigator, Psychic, Swashbuckler                                                                                                                            |
| Simple Weapon Expertise           | 2             | Animist, **Summoner**                                                                                                                                                                          |
| Apparition Attunement             | 1             | só Animist                                                                                                                                                                                     |
| Animistic Practice                | 1             | só Animist                                                                                                                                                                                     |
| Animist & Apparition Spellcasting | 1             | só Animist                                                                                                                                                                                     |
| Third Apparition                  | 1             | só Animist                                                                                                                                                                                     |
| Expert Protections                | 1             | só Animist                                                                                                                                                                                     |
| Master of Mind and Spirit         | 1             | só Animist                                                                                                                                                                                     |
| Fourth Apparition                 | 1             | só Animist                                                                                                                                                                                     |
| Supreme Incarnation               | 1             | só Animist                                                                                                                                                                                     |

`Simple Weapon Expertise` também está declarado em `missingFromPacks` do
`summoner.json` (curadoria irmã desta mesma rodada, escrita em paralelo).
Não é conflito — o pipeline faz a **união** dos nomes (regra R1); a duplicidade
está registrada aqui só para que a integração não a leia como erro.

## 4. O que já existe nos packs — REUSAR

### `class-features-core` (318 docs) — 6 das 15 reusadas

`Fortitude Expertise` `F57Na5VxfBp56kke` · `Expert Spellcaster`
`cD3nSupdCvONuHiE` · `Perception Expertise` `JCqACxgrm5ixX0Jy` ·
`Weapon Specialization` `9EqIasqfI8YIM3Pt` · `Master Spellcaster`
`l1InYvhnQSz6Ucxc` · `Legendary Spellcaster` `Hfaa7TuLn3nE8lr3`.

Todos conferidos por `flags.fusion.sourceId` == `_id` do arquivo do vendor.

**Faltam 9** (declaradas em `classFeatures.missingFromPacks`), **mais** as 17
opções de eixo (13 aparições + 4 práticas, que não estão no `items{}`).
**Total novo em `class-features-core`: 26 documentos.**

### `feats-core` (2.205 docs) — 3 dos 39 reusados

`Conceal Spell` `sIeuPW0j39fTZm08` · `Enhanced Familiar` `N7dTFxpjXGn4ddq8` ·
`Echoing Channel` `T4Xm8vYtnGMOM0Cw`. São exatamente os 3 vindos de
`shared-class-feats`. **0** homônimos com `sourceId` diferente entre os 39.

### `spells-core` (1.310 docs) — 14 de 14 magias de trait `animist`

Todas as 14 (todas `focus`) já estão no pack por `sourceId` — entraram pelo
predicado class-agnóstico de trait `focus`. Nada a fazer.

## 5. Eixos de sub-escolha — são DOIS

A medição preliminar previa **um** eixo. A varredura de `otherTags` com prefixo
`animist` em `class-features/**` devolveu **dois**:

| `otherTag`           | `featureNameInItemsMap` | Nível | `choose` | `optionCount` | `category` derivada  |
| -------------------- | ----------------------- | ----- | -------- | ------------- | -------------------- |
| `animist-apparition` | Apparition Attunement   | 1     | **2**    | **13**        | `apparition`         |
| `animistic-practice` | Animistic Practice      | 1     | 1        | **4**         | `animisticPractice`  |

Os dois `featureNameInItemsMap` casam com entradas reais do `items{}` (nível 1
em ambos). Nenhuma das 17 opções carrega `class-archetype`; todas são `common`.

### 5.1 A tag `animistic-practice` quebra a convenção `<classe>-<eixo>`

O plano §4 R3 diz que o formato é `<classe>-<eixo>`. Aqui a tag é
`animistic-practice` — **adjetivo**, não `animist-practice`.
`axisCategoryFromOtherTag("animistic-practice", "animist")` não casa o prefixo
`animist-` e devolve a tag inteira em camelCase: `animisticPractice`. O valor é
utilizável, mas **foi declarado explicitamente** em `choiceAxes[].category`
para que a intenção não dependa desse detalhe de string matching.
**Opções (4):** Liturgist `Zz7FPvmAaOpebHbu`, Medium `k6c2gesVQ8QuEWGm`,
Seer `NRQOorKeZ310FXuk`, Shaman `haYJQRVJ8RaA74nt`.

### 5.2 O eixo de aparição não é uma escolha permanente — e o schema não o representa

**As 13 opções** (todas nível 1, todas `common`): Crafter in the Vault
`csrF8UOWPl1rr6st`, Custodian of Groves and Gardens `EyRHVD4h2eZYIsk5`, Echo of
Lost Moments `UbOFa3BBHO8HwLJR`, Impostor in Hidden Places `Gss5cYmRySgi1UxP`,
Lurker in Devouring Dark `NNVkvA9fmyFy68ag`, Monarch of the Fey Courts
`95maDg6AsCTLPAmS`, Reveler in Lost Glee `9PYHXFMmbHyp4aTL`, Shepherd of Errant
Winds `aFVxfp7uQ0ac87GN`, Speaker in Sibilance `2XlUg9JXtwnSbWOY`, Stalker in
Darkened Boughs `ImJ09rEZW5WtS26L`, Steward of Stone and Fire `ILGq8LQBnwsAz2jK`,
Vanguard of Roaring Waters `M3q0KIyuMvSgUZH7`, Witness to Ancient Battles
`k9P2mXRjyy5X24rH`.

**Três desvios simultâneos do que o schema modela:**

- **(a) escolhem-se DUAS**, não uma. `choose: 2` foi declarado. As 15 curadorias
  anteriores usam `choose: 1`, e **nada no pipeline lê o campo hoje** (grep:
  só `curation/index.mjs` o normaliza com `axis.choose ?? 1`).
- **(b) o número CRESCE com o nível** — 2 no nível 1, **3 no 7** (class feature
  `Third Apparition`), **4 no 15** (`Fourth Apparition`). `level` e `choose` são
  escalares únicos; não há como declarar uma progressão.
- **(c) a escolha é REFEITA a cada preparação diária**, e existe ainda uma
  sub-escolha de aparição **primária** entre as atuneadas — é ela que dá a
  *vessel spell* e, no nível 19, a forma de avatar —, trocável a cada `Refocus`.

Não é *"escolha 1 de 13 no nível 1"*; é *"escolha N de 13 por dia, com um
destaque re-selecionável"*. **Nada foi forçado**: o eixo foi declarado na forma
mais próxima possível e a inadequação virou pergunta aberta (§10, Q1).

### 5.3 O vendor NÃO mecaniza a escolha de aparição

- `Apparition Attunement` tem `rules: []`.
- A literal `animist-apparition` aparece em **exatamente 13 arquivos** do vendor
  — os 13 documentos de aparição. **Nenhum ChoiceSet a consome.**
- É o **oposto** de `Animistic Practice`, que tem
  `ChoiceSet {filter:["item:tag:animistic-practice"], itemType:"feat"}` +
  `GrantItem {uuid: "{item|flags.system.rulesSelections.animisticPractice}"}`.

Ou seja: a tag do eixo de aparição existe só como **marcação**. Quem for
oferecer a escolha na ficha não terá apoio de rule element nenhum.

### 5.4 As 4 práticas concedem talentos por `GrantItem` — caso feliz

| Prática   | `GrantItem`                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| Liturgist | Circle of Spirits (L1)                                                                                        |
| Medium    | Relinquish Control (L1)                                                                                       |
| Seer      | Apparition Sense (L1) — mais `FlatModifier` e `Resistance` próprios                                            |
| Shaman    | Spirit Familiar (Animist) (L1) · Enhanced Familiar (predicado `self:level>=2`) · Incredible Familiar (Animist) (predicado `self:level>=9`) |

**Todos os alvos carregam o trait `animist`** e entram em `feats-core` pelo
próprio laço da classe. **Nenhuma** entrada em `GRANT_TARGET_DEDICATION_NAMES`
ou `GRANT_TARGET_CLASS_FEATURE_NAMES` é necessária. Cadeia de segunda ordem:
`Spirit Familiar (Animist)` concede o talento **geral** `Pet`
(`feats/general/level-1/pet.json`, `6yPrvbSDaa8glLjn`), que **já está** em
`feats-core` — a cadeia fecha.

**Divergência de nível na prosa do vendor:** a descrição do Shaman diz
*"Invocation of Growth (9th) … You gain the Incredible Familiar feat"* e o
`GrantItem` usa `self:level>=9`, mas o documento `Incredible Familiar (Animist)`
está em `feats/class/animist/level-10/` (nível **10**). Registrado, não
corrigido.

## 6. Class feats

- **36** exclusivos em `feats/class/animist/level-*/`.
- **3** de `shared-class-feats/` com o trait `animist` (de 113 arquivos na pasta).
- **Total candidato: 39.** Todos `category: "class"`, todos `rarity: common`.
- **3 dos 39 já estão em `feats-core` por `sourceId`** (os 3 compartilhados).
  Os outros 36 são novos. **0** homônimos com `sourceId` diferente.
- Publicação: 36 de `Pathfinder War of Immortals`, 3 de `Pathfinder Player Core`.
- **0** com trait `archetype` → `excludeNames` vazio (ao contrário do Druid, que
  precisou excluir 10 talentos `* Mask`).

| Nível | Exclusivos | Compartilhados | Total | Nomes                                                                                     |
| ----- | ---------- | -------------- | ----- | ----------------------------------------------------------------------------------------- |
| 1     | 5          | 0              | 5     | Apparition Sense, Channeler's Stance, Circle of Spirits, Relinquish Control, Spirit Familiar (Animist) |
| 2     | 3          | 2              | 5     | Embodiment of the Balance, Grasping Spirits Spell, Spiritual Expansion Spell · **Conceal Spell**, **Enhanced Familiar** |
| 4     | 3          | 0              | 3     | Apparition's Enhancement, Channeled Protection, Walk the Wilds                             |
| 6     | 5          | 0              | 5     | Apparition Stabilization, Blazing Spirit, Grudge Strike, Medium's Awareness, Roaring Heart |
| 8     | 4          | 0              | 4     | Apparition's Reflection, Instinctive Maneuvers, Spirit Walk, Wind Seeker                   |
| 10    | 3          | 0              | 3     | Apparition's Quickening, Fly on Shadowed Wings, Incredible Familiar (Animist)              |
| 12    | 3          | 0              | 3     | Apparition Cloud, Shadows Within Shadows, Whispers of Warning                              |
| 14    | 2          | 0              | 2     | Banish Falsehoods of Flesh, Cardinal Guardians                                             |
| 16    | 4          | 0              | 4     | Forest's Heart, Jester's Gambol, Monstrous Inclinations, Spiritual Spellshape Stance       |
| 18    | 2          | 1              | 3     | Cycle of Souls, Spirit's Sacrifice · **Echoing Channel**                                   |
| 20    | 2          | 0              | 2     | Eternal Guide, True Channel Spell                                                          |
| —     | **36**     | **3**          | **39**|                                                                                            |

A pasta de nível de cada arquivo bate com `system.level.value` em **39/39** —
não há aqui a mentira de nível que as *features* têm.

## 7. Pré-requisitos

**9 dos 39** têm `system.prerequisites.value` não vazio.

| Feat                          | Nível | Texto do vendor                                     | Classificação                          |
| ----------------------------- | ----- | --------------------------------------------------- | -------------------------------------- |
| Channeled Protection          | 4     | `Channeler's Stance`                                | interno (feat L1)                      |
| Instinctive Maneuvers         | 8     | `Relinquish Control`                                | interno (feat L1)                      |
| Spirit Walk                   | 8     | `Apparition Sense`                                  | interno (feat L1)                      |
| Wind Seeker                   | 8     | `Walk the Wilds`                                    | interno (feat L4)                      |
| Incredible Familiar (Animist) | 10    | `Enhanced Familiar`                                 | interno (feat compartilhado L2)        |
| Apparition Cloud              | 12    | `Spirit Familiar`                                   | **nome sem o sufixo do vendor**        |
| Cycle of Souls                | 18    | `liturgist practice, at least one animist stance`   | **opção de eixo + atributo, na mesma string** |
| Echoing Channel               | 18    | `Embodiment of Balance or Cleric`                   | **nome divergente + identidade de classe** |
| Enhanced Familiar             | 2     | `a familiar`                                        | atributo do nó (posse)                 |

**5 resolvem dentro do conjunto da classe** → `prerequisites.internalChains`.
Os **4** restantes:

1. **`Apparition Cloud` → `Spirit Familiar`.** O documento se chama
   `Spirit Familiar (Animist)`. Não é erro de prosa: a descrição do Shaman
   escreve `@UUID[…Item.Spirit Familiar (Animist)]{Spirit Familiar}` — o vendor
   **exibe** "Spirit Familiar" de propósito. Candidato natural a
   `prerequisiteFixes` kind `rename`; **não aplicado**, mesma decisão do
   `druid.json` para `Mature Animal Companion (Druid)` (mudaria a prosa exibida
   sem que nada dependa disso, e nenhum consumidor resolve pré-requisito por
   nome hoje).
2. **`Echoing Channel` → `Embodiment of Balance or Cleric`.** O documento do
   Animist se chama **`Embodiment of the Balance`** (com o artigo) — nem por
   nome exato casa. `cleric.json` já registrou este pré-requisito (issue #46) e
   o classificou como prosa legítima do vendor, não mecanizável — concordo.
   **Correção a reportar:** a nota do `cleric.json` diz que *"Embodiment of
   Balance é **feature** do Animist"*; medido aqui, é um **class feat de nível
   2** (`feats/class/animist/level-2/embodiment-of-the-balance.json`,
   `8Y9DCalsSnXHDCeV`, trait `animist`, `category: "class"`). O dado está certo;
   a imprecisão está na nota.
3. **`Cycle of Souls` → `liturgist practice, at least one animist stance`.**
   **UMA** entrada com **DUAS** exigências separadas por vírgula. A primeira
   aponta para a opção `Liturgist` do eixo `animistic-practice` pelo texto em
   minúsculas + a palavra "practice" — mesmo formato de `animal order` (Druid) e
   `dragon instinct` (Barbarian); um casamento case-insensitive resolveria
   **quando** alguém ler pré-requisito de opção de eixo (hoje ninguém lê). A
   segunda é atributo do nó: existem **4** feats com trait `stance` entre os 39
   (Channeler's Stance L1, Forest's Heart L16, Jester's Gambol L16, Spiritual
   Spellshape Stance L16), então é satisfazível — mas não há predicado que a
   expresse. É o caso **inverso** da issue #30 (lá duas entradas foram lidas
   como AND; aqui um AND real vem colado numa entrada só). **Não** é kind
   `merge`; nenhum fix aplicável sem inventar.
4. **`Enhanced Familiar` → `a familiar`.** Atributo do nó, idêntico ao já
   registrado em `druid.json`. Preservado como texto (REQ-BC-034).

**Nenhum** dos 39 aponta para documento de **outra classe** (o Fighter tinha 1).
E **não existe `Animist Dedication`** neste snapshot: varredura de `feats/**`
por nome contendo "animist" fora de `feats/class/animist/` devolveu **zero**.
Logo não há sequer a decisão "incluir a dedicação em `extraNames`" que
Druid/Psychic tiveram — a rota de arquétipo do Animist **não existe como dado**.

`prerequisiteFixes: []`.

## 8. Preparação para multiclasse (plano r21 §4)

- Gate derivado dos 39 class feats:
  `{"class_level": {"animist": {">=": N}}}`, N = nível do arquivo do feat
  (nível de classe; sem a mentira de nível das features).
- **Ambiguidade:** apenas **3 dos 39** carregam trait de 2+ classes —
  `Conceal Spell` (animist+witch+wizard), `Enhanced Familiar`
  (animist+druid+magus+sorcerer+thaumaturge+witch+wizard) e `Echoing Channel`
  (animist+cleric). Os três **já estão** em `feats-core`, reusados de
  Wizard/Witch/Druid/Cleric. Nesses 3 o predicado correto é `any` sobre as
  classes do trait, nunca uma escolha arbitrária — mesmo padrão já registrado em
  `wizard.json`, `cleric.json`, `barbarian.json`, `psychic.json` e `druid.json`.
- **7,7% de trait-duplo é a menor taxa medida até agora** (Druid 17%, Fighter
  35%): classe nova, quase nada dela foi retrocompartilhado.
- **0** feats com trait `archetype` → nenhum conflito archetype-vence-classe.

## 9. Conjuração e magias de foco

### 9.1 O achado estrutural: a conjuração do Animist é DUPLA

A tabela do journal tem células no formato **`A+B`**, e o próprio rodapé do
journal explica: *"The number before a plus sign indicates your spell slots via
animist spellcasting, and the number after it indicates your spell slots from
apparition spellcasting."*

| | (a) Animist spellcasting | (b) Apparition spellcasting |
| --- | --- | --- |
| Tipo | **preparada** | **espontânea** |
| Tradição | divina | divina (ver §9.3) |
| Atributo | wis | wis |
| Truques | **2**, fixos nos 20 níveis | 2 → 3 (L7) → 4 (L15), um por aparição |
| Slots por rank | **2** (nunca 3 — é o padrão do Psychic, não o do Cleric/Druid) | 1, subindo a 2 a partir do L10 |
| Rank 10 | **ZERO** | 1 slot no L19, via `Supreme Incarnation` |
| Repertório | prepara da lista divina | dado pelas aparições atuneadas; **todas signature spells** |

A prosa é explícita: *"you can't cast your animist spells using your apparition
spell slots or vice versa"*.

`ClassSpellcastingSchema` (`systems/pf2e/src/schemas/item-equipment.ts`) tem
**um único `type`** (`z.enum(["prepared","spontaneous"])`) e **um único array
`slots`**. Além disso `spellcastingFor()` em `transform.mjs` só propaga
`tradition`, `type`, `ability`, `cantripsKnown`, `slots` e
`traditionByBloodline` — qualquer chave nova que eu inventasse no JSON seria
**silenciosamente descartada**, não rejeitada.

**Decisão tomada:** `spellcasting.table` carrega **somente a metade (a)** — a
conjuração própria da classe, que é a que casa com `type: "prepared"` e
`tradition: "divine"`. A metade (b) está transcrita **por extenso** em
`notes[]` e em §9.4 aqui. Somar as duas metades seria **errado** (deixaria o
jogador preparar magias animistas em slot de aparição); omitir a (b) sem
declarar seria pior. Dívida declarada > invenção.

### 9.2 Metade (a) — emitida em `spellcasting.table`

| Nível | Truques | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| ----- | ------- | - | - | - | - | - | - | - | - | - | -- |
| 1  | 2 | 1 | – | – | – | – | – | – | – | – | – |
| 2  | 2 | 2 | – | – | – | – | – | – | – | – | – |
| 3  | 2 | 2 | 1 | – | – | – | – | – | – | – | – |
| 4  | 2 | 2 | 2 | – | – | – | – | – | – | – | – |
| 5  | 2 | 2 | 2 | 1 | – | – | – | – | – | – | – |
| 6  | 2 | 2 | 2 | 2 | – | – | – | – | – | – | – |
| 7  | 2 | 2 | 2 | 2 | 1 | – | – | – | – | – | – |
| 8  | 2 | 2 | 2 | 2 | 2 | – | – | – | – | – | – |
| 9  | 2 | 2 | 2 | 2 | 2 | 1 | – | – | – | – | – |
| 10 | 2 | 2 | 2 | 2 | 2 | 2 | – | – | – | – | – |
| 11 | 2 | 2 | 2 | 2 | 2 | 2 | 1 | – | – | – | – |
| 12 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | – | – | – | – |
| 13 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 1 | – | – | – |
| 14 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | – | – | – |
| 15 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 1 | – | – |
| 16 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | – | – |
| 17 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 1 | – |
| 18 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | – |
| 19 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | **0** |
| 20 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | **0** |

### 9.3 Conferência contra fonte independente — o icônico Samo

Existe pregen oficial: **Samo** (`iconics/samo/samo-level-{1,3,5}.json`), o
icônico Animist. As entradas de conjuração das três fichas:

| Ficha | Entrada `Animist Spells` (prepared/divine/wis) | Entrada `Apparition Spells` (spontaneous) |
| ----- | ---------------------------------------------- | ----------------------------------------- |
| L1    | `slot0.max=2`, `slot1.max=1`                    | `slot1.max=1`                             |
| L3    | `slot0=2`, `slot1=2`, `slot2=1`                 | `slot1=1`, `slot2=1`                      |
| L5    | `slot0=2`, `slot1=2`, `slot2=2`, `slot3=1`      | `slot1=1`, `slot2=1`, `slot3=1`           |

**Bate célula a célula com o journal, nas DUAS metades, nos três níveis.**
Samo também confirma: prática = `Seer`, e o talento `Apparition Sense` presente
na ficha — ou seja, a cadeia `GrantItem` da prática está certa.

**Única divergência entre as fontes:** a entrada `Apparition Spells` do Samo
declara `tradition: "primal"` (e a entrada de foco vem como
`Arcane Focus Spells` no nível 1 e `Focus Spells`/primal nos níveis 3 e 5). A
prosa da própria class feature diz *"Any of these spells that aren't normally
on the divine list are still **divine** spells if you cast them this way"*, e o
journal lista uma única linha de conjuração ("Trained in spell attack modifier /
Trained in spell DC"). **Adotado `divine`** — 3 fontes contra 1 (journal, prosa
da feature e a entrada **primária** do próprio Samo). A divergência é de rótulo
de tradição nas entradas **secundárias** da pregen; **não toca nenhum número de
slot**, e está registrada em `dedupe.collisionsDetected`. Não houve divergência
numérica em lugar nenhum — se houvesse, este relatório pararia aqui.

### 9.4 Metade (b) — apparition spellcasting (NÃO emitida, dívida declarada)

Truques: **2** (L1–6), **3** (L7–14), **4** (L15–20).

| Nível | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| ----- | - | - | - | - | - | - | - | - | - | -- |
| 1–2   | 1 | – | – | – | – | – | – | – | – | – |
| 3–4   | 1 | 1 | – | – | – | – | – | – | – | – |
| 5–6   | 1 | 1 | 1 | – | – | – | – | – | – | – |
| 7–8   | 1 | 1 | 1 | 1 | – | – | – | – | – | – |
| 9     | 1 | 1 | 1 | 1 | 1 | – | – | – | – | – |
| 10    | 2 | 2 | 2 | 1 | 1 | – | – | – | – | – |
| 11–12 | 2 | 2 | 2 | 2 | 1 | 1 | – | – | – | – |
| 13–14 | 2 | 2 | 2 | 2 | 2 | 1 | 1 | – | – | – |
| 15–16 | 2 | 2 | 2 | 2 | 2 | 2 | 1 | 1 | – | – |
| 17–18 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 1 | 1 | – |
| 19–20 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 1 | 1\* |

\* rank 10 vem de `Supreme Incarnation`, marcado com `*` no journal
(*"works a bit differently"*) — mesmo padrão do `Primal Hierophant` do Druid e
do `Miraculous Spell` do Cleric.

### 9.5 Magias de foco — 14, todas já em `spells-core`

13 são **vessel spells**, uma por aparição (vínculo extraído da prosa de cada
documento de aparição):

| Aparição                        | Vessel spell            | Avatar (nível 19)                 |
| ------------------------------- | ----------------------- | --------------------------------- |
| Crafter in the Vault            | Traveling Workshop      | Incarnate Dungeon                 |
| Custodian of Groves and Gardens | Garden of Healing       | Peaceful Reaches                  |
| Echo of Lost Moments            | Store Time              | Devourer of Lost Time             |
| Impostor in Hidden Places       | Discomfiting Whispers   | Whisper Hiding in Shadows         |
| Lurker in Devouring Dark        | Devouring Dark Form     | Tentacles from the Dark           |
| Monarch of the Fey Courts       | Nymph's Grace           | Queen of the Winter Court         |
| Reveler in Lost Glee            | Trickster's Mirrors     | Ringmaster of the Dark Celebration|
| Shepherd of Errant Winds        | Gift of the Anemos      | Will of the Winds                 |
| Speaker in Sibilance            | Crown of Prophets       | Medusa of Merciless Mysteries     |
| Stalker in Darkened Boughs      | Darkened Forest Form    | Beast of the Boughs               |
| Steward of Stone and Fire       | Earth's Bile            | Blood of Planets                  |
| Vanguard of Roaring Waters      | River Carving Mountains | River that Splits the World       |
| Witness to Ancient Battles      | Embodiment of Battle    | General of Endless Battle         |

**A 14ª é órfã: `Wish Market`** (`cYW9M2yE16dTTnCF`, rarity **uncommon**). Não é
vessel spell de nenhuma das 13, e a varredura de `feats/**`,
`class-features/**`, `spells/**`, `classes/**`, `journals/**`, `equipment/**`,
`heritages/**`, `ancestries/**` e `backgrounds/**` **não achou um único
documento que a referencie**. Provavelmente vessel spell de uma aparição ainda
não publicada neste snapshot. Já está em `spells-core`; registrada para não ser
lida como defeito num teste futuro.

**O vínculo aparição → vessel spell só existe como PROSA.** Não há dado
estruturado — mesma lacuna que `druid.json` registrou para ordem→magia de foco e
`cleric.json` para domínio→magia de domínio. Dívida declarada.

### 9.6 Repertório de aparição — 118 magias, 16 faltando nos packs

Cada aparição concede 10 magias (1 truque + ranks 1 a 9): 13 × 10 = **130
referências, 118 distintas**. Cruzadas por `sourceId`: **102 já estão em
`spells-core`**, **16 faltam**:

`Canticle of Everlasting Grief` (r8) · `Field of Life` (r6) · `Gentle Breeze`
(r2) · `Hydraulic Torrent` (r4) · `Hypercognition` (r3) · `Ill Omen` (r1) ·
`Moment of Renewal` (r8) · `Moon Frenzy` (r5) · `Punishing Winds` (r8) ·
`Rousing Splash` (r1) · `Snake Fangs` (r4) · `Unfathomable Song` (r9) ·
`Unfettered Pack` (r7) · `Volcanic Eruption` (r7) · `Wails of the Damned` (r9) ·
`Wrathful Storm` (r9).

A maioria é primal-only ou occult-only — exatamente o buraco de tradição que o
plano r29 §9 manda **declarar**, não fechar aqui. Sem essas 16, **as 13
aparições ficam com repertório incompleto** (nenhuma escapa).

### 9.7 Pool de foco — não modelado

A prosa diz *"you start with a focus pool of 1 Focus Point"*, e `Third
Apparition` (L7) e `Fourth Apparition` (L15) carregam `ActiveEffectLike` em
`system.resources.focus.max` (+1 cada, teto 3). **O ponto inicial não tem rule
element em lugar nenhum** — `Apparition Attunement` e `Animist & Apparition
Spellcasting` têm `rules: []`; a ficha do Samo simplesmente traz
`resources.focus.value = 1`. `statFromRulePath()` não reconhece o path de foco
(não é proficiência), então a derivação genérica **corretamente** ignora os dois
`ActiveEffectLike`. Dívida declarada.

## 10. Riscos, dívidas e perguntas em aberto para a integração central

### Proficiency upgrades — derivação limpa, zero extras

12 linhas, `missing: []`, `ignoredRules: []` (rodando `deriveProficiencyUpgrades`
sobre os docs crus do vendor):

| Nível | Stat                                                       | Rank | Origem                    |
| ----- | ---------------------------------------------------------- | ---- | ------------------------- |
| 3     | fortitude                                                  | 2    | Fortitude Expertise       |
| 7     | spellcasting                                               | 2    | Expert Spellcaster        |
| 9     | perception                                                 | 2    | Perception Expertise      |
| 11    | armor.light, armor.medium, armor.unarmored, reflex (4 linhas) | 2 | Expert Protections        |
| 11    | weapons.simple, weapons.unarmed (2 linhas)                 | 2    | Simple Weapon Expertise   |
| 13    | will                                                       | 3    | Master of Mind and Spirit |
| 15    | spellcasting                                               | 3    | Master Spellcaster        |
| 19    | spellcasting                                               | 4    | Legendary Spellcaster     |

`proficiencyUpgradeExtras: []` e `proficiencyMirrors: {}`. O Animist para em
**expert** em armadura e em armas simples, chega a **master** em Will (L13) e a
**legendary** só em conjuração (L19); `classDC` **nunca** sai de trained.

### Perguntas em aberto

- **Q1 (bloqueante para a UI, não para o pack) — como representar o eixo de
  aparição?** `choose`/`level` escalares não expressam "2 no L1, 3 no L7, 4 no
  L15", nem "re-selecionável a cada preparação diária", nem a sub-escolha de
  aparição *primária*. Três caminhos possíveis, nenhum escolhido aqui: (i)
  estender `choiceAxes[]` com uma progressão (`chooseByLevel: [{level,choose}]`)
  e um marcador `resetsDaily: true`; (ii) tratar como três eixos com o mesmo
  `otherTag` e níveis 1/7/15 (o loader aceita, mas `axisCategoryByOtherTag` e
  `axisLevelByOtherTag` são `Map` por `otherTag` — o último venceria, então
  **não funciona hoje**); (iii) manter `choose: 2` e resolver a progressão no
  client. Recomendo (i) — o dado pertence à curadoria.
- **Q2 — como representar a conjuração dupla?** `ClassSpellcastingSchema` tem um
  `type` e um `slots`. O Animist precisa de **duas entradas de conjuração
  simultâneas de tipos diferentes**. Sugestão: transformar o campo em array (ou
  adicionar `secondary`), com a metade (b) já pronta em §9.4. Enquanto isso, a
  ficha do Animist vai mostrar **menos slots do que o personagem tem**.
- **Q3 — `KNOWN_CLASS_TRAITS` do `planVM.ts` não contém `animist`.** Com os 39
  class feats no pack, `isFeatEligible()` passa a **oferecer talentos de Animist
  para qualquer outra classe**. Regressão muda: nenhum teste a pega. (Idêntica à
  registrada em `psychic.json`; `psychic` também continua fora do Set.)
- **Q4 — fiação dos dois eixos.** `CLASS_CHOICE_SLOTS` não tem
  `"Apparition Attunement"` nem `"Animistic Practice"`, e `PlanSlotType` não tem
  `apparition` nem `animisticPractice`. Sem isso, os dois eixos de nível 1 não
  viram slot pickável.
- **Q5 — política de licença/remaster.** `Simple Weapon Expertise` é o único doc
  desta curadoria com `license: "OGL"` **e** `remaster: false` (Secrets of
  Magic). Entra em `class-features-core` pelo Animist (é compartilhado com o
  Summoner). A integração decide se isso importa.
- **Q6 — recorte por livro no eixo de aparição.** 11 das 13 opções são de *War of
  Immortals*; 2 (`Shepherd of Errant Winds`, `Speaker in Sibilance`) são de
  *Pathfinder #216: The Acropolis Pyre* (adventure path). `optionCount: 13` é o
  número da tag — que é o que `transform.test.mjs` confere. Se a integração
  quiser recortar por livro, `optionCount` muda junto.
- **Q7 — correção na nota do `cleric.json`.** Ela chama
  `Embodiment of Balance` de *class feature* do Animist; é um **class feat de
  nível 2** chamado `Embodiment of the Balance`. Não muda dado nenhum; muda a
  nota.

### Dívidas declaradas (nada inventado)

1. Metade (b) da conjuração não emitida (§9.1/§9.4).
2. Eixo de aparição declarado como escolha estática (§5.2).
3. Perícia inicial "Nature **ou** Occultism" não existe no vendor (§2).
4. Vínculo aparição → vessel spell só existe como prosa (§9.5).
5. 16 magias do repertório de aparição fora dos packs (§9.6).
6. Pool de foco (ponto inicial + crescimento) não modelado (§9.7).
7. `Wish Market`: magia de foco `animist` sem granter em nenhum documento (§9.5).
8. `prerequisiteFixes` deliberadamente vazio — 3 candidatos de `rename`
   documentados e não aplicados (§7).

### Armadilhas registradas para quem for gerar o pack

- **Rebuild obrigatório do transform.** As 17 opções de eixo entram em
  `class-features-core` **apenas** pelo ramo
  `axisCategories.has(doc.system.category)`, e `system.category` só vira
  `apparition`/`animisticPractice` quando `transform.mjs` roda **com esta
  curadoria no disco**. Rodar `build-mvp-subset.mjs` sobre um `out/` antigo faz
  os eixos saírem com 0 opções e reprova `transform.test.mjs` em "eixo sem
  nenhuma opção no pack".
- **Nome com `&`.** `Animist & Apparition Spellcasting` é o único nome canônico
  com ampersand em toda a curadoria (o journal já escreve `&amp;`). Qualquer
  casamento por nome que passe por escape/unescape de HTML quebra aqui.
- **Gate que esta curadoria aciona.** `pregen-parity.test.ts` filtra os icônicos
  pelas classes presentes em `classes-core`; publicar o Animist traz **Samo**
  para dentro do gate #48 — verificação externa de graça. Nada indica
  divergência nova: `attacks.other` é zerado (não repete a #50 de
  Cleric/Gunslinger) e a #49 já saiu inteira do baseline.

## 11. Validação obrigatória (§5 do PLANO) — saída colada

```
$ node --input-type=module -e "import {validateClassCuration} from './tools/importer-pf2e/src/curation/index.mjs'; import {readFileSync} from 'node:fs'; const f='animist.json'; const cfg=validateClassCuration(JSON.parse(readFileSync('tools/importer-pf2e/src/curation/classes/'+f,'utf8')), f); console.log('OK', cfg.class, 'eixos:', cfg.choiceAxes.length, 'feats.trait:', cfg.classFeats.trait);"
OK animist eixos: 2 feats.trait: animist
```

Carga conjunta com as demais curadorias já presentes na worktree (não lança):

```
$ node --input-type=module -e "import {loadClassCuration, axisCategoryByOtherTag} from './tools/importer-pf2e/src/curation/index.mjs'; const m=loadClassCuration(); console.log('classes curadas:', m.size); console.log('categorias:', axisCategoryByOtherTag().get('animist-apparition'), axisCategoryByOtherTag().get('animistic-practice')); const a=m.get('animist'); console.log('table linhas:', a.spellcasting.table.length);"
classes curadas: 20
categorias: apparition animisticPractice
table linhas: 20
```

Formatação (o worktree não tem `node_modules`; usado o `prettier` do checkout
principal, com o `.prettierrc` **desta** worktree, apenas sobre o arquivo
produzido):

```
$ node <prettier>/bin/prettier.cjs --config .prettierrc --check tools/importer-pf2e/src/curation/classes/animist.json
Checking formatting...
All matched files use Prettier code style!
```
