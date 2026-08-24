# r29 — Summoner — relatório de curadoria

Arquivo de configuração produzido: `tools/importer-pf2e/src/curation/classes/summoner.json`.

## 0. Validação obrigatória (§5 do PLANO) — saída colada

Comando, rodado da raiz da worktree:

```
node --input-type=module -e "import {validateClassCuration} from './tools/importer-pf2e/src/curation/index.mjs'; import {readFileSync} from 'node:fs'; const f='summoner.json'; const cfg=validateClassCuration(JSON.parse(readFileSync('tools/importer-pf2e/src/curation/classes/'+f,'utf8')), f); console.log('OK', cfg.class, 'eixos:', cfg.choiceAxes.length, 'feats.trait:', cfg.classFeats.trait);"
```

Saída:

```
OK summoner eixos: 1 feats.trait: summoner
```

Não lançou. **Nota:** a worktree não tem `node_modules/` (nenhum `pnpm install` foi
rodado, conforme §2), então `prettier --check` não pôde ser executado sobre o JSON
novo. O arquivo foi escrito no mesmo estilo do `druid.json` (indentação 2, linhas de
tabela inline abaixo de 100 colunas, objetos multi-linha quando já quebrados) — a
integração central deve rodar `pnpm format:check` antes de commitar.

## 1. Método (comandos rodados)

Todas as contagens vieram de scripts `node` executados **agora**, contra
`tools/importer-pf2e/vendor/pf2e/packs/pf2e/` (junction somente-leitura) e
`systems/pf2e/packs/*/documents.json`. Nenhum arquivo compartilhado foi tocado;
nenhum `git` de escrita, nenhum `pnpm`, nenhum importer. Os scripts descartáveis
ficaram no scratchpad da sessão, fora da worktree.

1. Leitura de `classes/summoner.json` → `system.{hp,keyAbility,perception,savingThrows,attacks,defenses,ancestryFeatLevels,classFeatLevels,generalFeatLevels,skillFeatLevels,skillIncreaseLevels,trainedSkills,spellcasting,classDC,traits,items}`.
2. Varredura **recursiva** de `class-features/**` → **842 arquivos**; índice por `_id` e por `name`; resolução das 24 entradas do `items{}` pelo **segmento final da uuid** (nunca `entry.name`), com comparação `v.name === uuid.split('.').pop()` e comparação do `system.level.value` genérico contra o nível do `items{}`.
3. Varredura de `system.traits.otherTags` nos mesmos 842 arquivos, filtrando prefixo `summoner`.
4. Varredura recursiva de `feats/class/summoner/level-*/` (**59 arquivos**) e de `feats/class/shared-class-feats/level-*/` (**113 arquivos**, filtrados para os que carregam o trait `summoner`).
5. União dos `items{}` das **27** classes do vendor, contando quantas referenciam cada um dos 24 nomes do Summoner.
6. Cruzamento por **`flags.fusion.sourceId`** contra `feats-core` (**2205 docs**), `class-features-core` (**318**), `spells-core` (**1310**), `actions-core` (**521**) e `conditions` (**43**).
7. Varredura recursiva de `spells/**` (**1797 arquivos**) filtrando trait `summoner`.
8. Parse do HTML de `journals/classes.json`, página `gA4Ud8oSUGkkLwAi` ("Summoner"), tabela nº 1 da página, célula a célula (`<tr>`/`<td>`).
9. Varredura de `iconics/**` (**85 arquivos**, 25 personagens), procurando ator cujo item de tipo `class` seja Summoner.
10. Leitura do registro `wb:class/summoner` da base do Waybuilder (`~/pessoal/Wayfinder/pipeline/base/index.json`, 20.083 registros).
11. Leitura (só leitura) de `build-mvp-subset.mjs` (`isSpellsCoreDoc`), `transform.mjs` (`spellcastingFor`), `planVM.ts` (`CLASS_CHOICE_SLOTS`, `GRANTED_FEAT_CHOICES`, `bloodlineSpellcastingOps`, `resolveBloodlineTradition`), `choiceSetInventory.ts` e `pregen-parity.test.ts`.

## 2. Doc da classe (medido)

| Campo               | Valor                                                              |
| ------------------- | ------------------------------------------------------------------ |
| hp                  | 10                                                                 |
| keyAbility          | `["cha"]`                                                          |
| perception          | 1 (trained)                                                        |
| savingThrows        | fortitude 2, reflex 1, will 2 — **fort E will já expert no nível 1** |
| attacks             | simple 1, unarmed 1, martial 0, advanced 0, other `{name:"",rank:0}` |
| defenses            | unarmored 1; **light 0, medium 0, heavy 0** — nenhuma armadura      |
| ancestryFeatLevels  | 1, 5, 9, 13, 17                                                    |
| classFeatLevels     | 2, 4, 6, 8, 10, 12, 14, 16, 18, 20                                 |
| generalFeatLevels   | 3, 7, 11, 15, 19                                                   |
| skillFeatLevels     | 2, 4, 6, 8, 10, 12, 14, 16, 18, 20                                 |
| skillIncreaseLevels | 3, 5, 7, 9, 11, 13, 15, 17, 19                                     |
| trainedSkills       | `value: []`, `additional: 3` — **nenhuma perícia fixa**            |
| spellcasting        | 1 (trained)                                                        |
| classDC             | **ausente** no vendor (`'classDC' in system` → false)              |
| publication         | `{license:"OGL", remaster:false, title:"Pathfinder Secrets of Magic"}` |

Dois perfis que destoam do conjunto curado e são **dado, não erro**: (a) o Summoner
é a única conjuradora curada com **duas** salvaguardas já expert no nível 1
(fortitude + vontade); (b) é a classe com a defesa mais fraca de todas as 16
(apenas `unarmored` treinado — nem armadura leve).

### `items{}` — 24 entradas, nome canônico = segmento final da uuid

`entry.name === uuid.split('.').pop()` em **24/24** — sem a armadilha do
Magus/Cleric.

| Nível (items{}) | Feature                       | Nível genérico do arquivo | Divergência? |
| --------------- | ----------------------------- | ------------------------- | ------------ |
| 1               | Eidolon                       | 1                         | não          |
| 1               | Evolution Feat                | 1                         | não          |
| 1               | Link Spells                   | 1                         | não          |
| 1               | Spell Repertoire              | 1                         | não          |
| 1               | Summoner Spellcasting         | 1                         | não          |
| 3               | Shared Vigilance              | 3                         | não          |
| 3               | Unlimited Signature Spells    | 3                         | não          |
| 5               | Eidolon Unarmed Expertise     | 5                         | não          |
| 7               | Eidolon Symbiosis             | 7                         | não          |
| 7               | Eidolon Weapon Specialization | 7                         | não          |
| **9**           | **Expert Spellcaster**        | **7**                     | **SIM**      |
| 9               | Shared Reflexes               | 9                         | não          |
| 11              | Eidolon Defensive Expertise   | 11                        | não          |
| 11              | Simple Weapon Expertise       | 11                        | não          |
| 11              | Twin Juggernauts              | 11                        | não          |
| 13              | Defensive Robes               | 13                        | não          |
| 13              | Eidolon Unarmed Mastery       | 13                        | não          |
| **13**          | **Weapon Specialization**     | **7**                     | **SIM**      |
| 15              | Greater Eidolon Specialization| 15                        | não          |
| 15              | Shared Resolve                | 15                        | não          |
| **17**          | **Master Spellcaster**        | **15**                    | **SIM**      |
| 17              | Eidolon Transcendence         | 17                        | não          |
| 19              | Eidolon Defensive Mastery     | 19                        | não          |
| 19              | Instant Manifestation         | 19                        | não          |

**Três divergências de nível**, todas do mesmo eixo: o Summoner é a única classe
curada que **atrasa a escada inteira de conjuração em 2 níveis** (Expert 7→9,
Master 15→17) e a única conjuradora que **nunca chega a Legendary** — não existe
`Legendary Spellcaster` no `items{}`. As três estão em `dedupe.collisionsDetected`.

## 3. Features compartilhadas com outras classes (união dos `items{}` das 27 classes)

| Feature do Summoner           | Nº de classes | Classes                                                                   |
| ----------------------------- | ------------- | ------------------------------------------------------------------------- |
| Weapon Specialization         | 25            | todas as 27 menos Exemplar e Psychic                                      |
| Expert Spellcaster            | 10            | Animist, Bard, Druid, Magus, Oracle, Psychic, Sorcerer, Summoner, Witch, Wizard |
| Master Spellcaster            | 10            | idem                                                                      |
| Spell Repertoire              | 5             | Bard, Oracle, Psychic, Sorcerer, Summoner                                 |
| Defensive Robes               | 4             | Sorcerer, Summoner, Witch, Wizard                                         |
| Simple Weapon Expertise       | 2             | Animist, Summoner                                                        |
| as outras 18                  | 1             | só Summoner                                                              |

**Achado estrutural:** onde Druid/Cleric/Wizard usam os documentos genéricos
`Perception Expertise` / `Fortitude Expertise` / `Reflex Expertise` / `*Willpower`,
o Summoner tem **quatro documentos exclusivos com o mesmo efeito mecânico** —
`Shared Vigilance`, `Shared Reflexes`, `Twin Juggernauts`, `Shared Resolve`. A
derivação genérica funciona igual (os quatro têm `subfeatures.proficiencies`
preenchido), mas a classe **adiciona 4 docs onde outra reusaria 4**.

## 4. O que já existe nos packs — REUSAR

`class-features-core` (318 docs), cruzado por `flags.fusion.sourceId`:

| Feature               | sourceId (= `_id` do vendor) |
| --------------------- | ---------------------------- |
| Spell Repertoire      | `1RfnAiyQ5FR7vnuH`           |
| Expert Spellcaster    | `cD3nSupdCvONuHiE`           |
| Weapon Specialization | `9EqIasqfI8YIM3Pt`           |
| Defensive Robes       | `gU7epgcPSm0TD1UK`           |
| Master Spellcaster    | `l1InYvhnQSz6Ucxc`           |

**5 de 24 reusadas; 19 faltam.** Nenhuma das 13 opções de eidolon está no pack.
`feats-core` (2205 docs): **1 de 60** já existe — `Effortless Concentration`
(`rgs6OZJYCgi5At8J`). `spells-core` (1310 docs): **5 de 7**.

Total novo se a classe for publicada: **32** em `class-features-core` (19 do
`items{}` + 13 opções de eixo), **59** em `feats-core`, **2** em `spells-core`
(bloqueados hoje, ver §9), **1** em `classes-core`.

## 5. Eixo de sub-escolha — `summoner-eidolon`

Varredura de `otherTags` nos 842 arquivos de `class-features/`: **um único eixo**,
`summoner-eidolon`, **13 opções**, todas nível 1, todas `category: classfeature`,
todas `traits.value: ["summoner"]`, **nenhuma** com `class-archetype` (ao contrário
de `Way of the Spellshot`/Gunslinger e `Battle Creed`/Cleric).

| Opção                    | `_id`              | Tradição (prosa) | Perícias treinadas (ActiveEffectLike) |
| ------------------------ | ------------------ | ---------------- | -------------------------------------- |
| Angel Eidolon            | `hippAZGFRtFd26dd` | divine           | Diplomacy, Religion                    |
| Anger Phantom Eidolon    | `IwkAP2FBiU63aUgb` | occult           | Intimidation, Occultism                |
| Beast Eidolon            | `xeD5nNnQAlaowGwR` | primal           | Intimidation, Nature                   |
| Construct Eidolon        | `rwPx9D4PjZhinmmH` | arcane           | Arcana, Crafting                       |
| Demon Eidolon            | `f2JzGk76CPjA2mcV` | divine           | Intimidation, Religion                 |
| Devotion Phantom Eidolon | `XEaO0VrYNaQepXow` | occult           | Medicine, Occultism                    |
| Dragon Eidolon           | `JttI3raKFGG4C8up` | arcane           | Arcana, Intimidation                   |
| Elemental Eidolon        | `sZEQCWsq8MxAmEHp` | primal           | Nature, Survival                       |
| Fey Eidolon              | `J2Oi9MxW2e2gjrKC` | primal (*)       | Deception, Nature                      |
| Plant Eidolon            | `lfwdsx5uJTNw6rF3` | primal           | Nature, Survival                       |
| Psychopomp Eidolon       | `v7DxQ3QRa1WyTLTd` | divine           | Intimidation, Religion                 |
| Swarm Eidolon            | `RyHp6642poxvehjy` | primal           | Nature, Survival                       |
| Undead Eidolon           | `wDSb9LGZhTa0FZB5` | divine           | Intimidation, Religion                 |

(*) o vendor escreve "Tradition primal (but see Fey Gift Spells below)".

**Como o `featureNameInItemsMap` casa:** o granter é `class-features/eidolon.json`
(`qOEpe596B0UjhcG0`), que **está** no `items{}` da classe no nível 1 com o nome
`Eidolon` — igual ao segmento final da uuid. Seu `ChoiceSet` filtra literalmente
por `["item:tag:summoner-eidolon"]` e o `GrantItem` seguinte resolve
`{item|flags.system.rulesSelections.eidolon}` — ou seja, o filtro do vendor **é a
otherTag**, não uma lista de uuids. `slotType: "eidolon"`, `category` derivada
`"eidolon"` (de `summoner-eidolon`), `level: 1`, `choose: 1`, `optionCount: 13`.

As 13 opções **não estão em nenhum `items{}`** — entram só pelo ramo
`axisCategories.has(doc.system.category)` de `isClassFeaturesCoreDoc`, o que torna
obrigatório reprocessar `transform` com `classes` **e** `class-features` no mesmo
`--packs` (ver nota REBUILD no JSON).

## 6. Class feats

- **59** exclusivos em `feats/class/summoner/level-*/`.
- **1** de `feats/class/shared-class-feats/level-*/` (113 arquivos na pasta) com o trait `summoner`: **`Effortless Concentration`** (L16).
- **Total candidato: 60.** Todos com `system.category === "class"` (0 exceções).
- **0 com trait `archetype`** — não há o conflito archetype-vence-classe do Druid.
- **35 com o trait `evolution`** (58,3%) — feats que existem só para customizar o eidolon.
- **1 de 60 já em `feats-core`** por `sourceId` (`Effortless Concentration`, `rgs6OZJYCgi5At8J`); confirmado também por nome — 1 e 1.

### Quebra por nível (exclusivos / compartilhados)

| Nível | Excl. | Compart. | Total |
| ----- | ----- | -------- | ----- |
| 1     | 8     | 0        | 8     |
| 2     | 6     | 0        | 6     |
| 4     | 9     | 0        | 9     |
| 6     | 7     | 0        | 7     |
| 8     | 7     | 0        | 7     |
| 10    | 6     | 0        | 6     |
| 12    | 5     | 0        | 5     |
| 14    | 4     | 0        | 4     |
| 16    | 2     | 1        | 3     |
| 18    | 2     | 0        | 2     |
| 20    | 3     | 0        | 3     |
| **∑** | **59**| **1**    | **60**|

Nenhum homônimo-sem-desambiguação dentro dos 60. Um único sufixo do vendor:
`Trample (Summoner)` (L16). **Mas cinco nomes colidem com magias** — ver §11.

## 7. Pré-requisitos

**13 de 60** feats têm `system.prerequisites.value` não vazio (21,7% — a menor
densidade medida até aqui; o Fighter tem 38/110 = 34,5%). Todos os 13 têm **uma
única entrada** — nenhum caso de duas entradas lidas como AND (o defeito da #30).

- **11 resolvem DENTRO do conjunto da classe:**
  - 10 apontam para outro class feat pelo nome exato → `prerequisites.internalChains`.
  - 1 aponta para uma **class feature** do `items{}` com caixa diferente: `Link Focus` (L12) → `"link spells"` (doc `Link Spells`). Mesmo formato de `"shield block"` no Fighter. Também em `internalChains`.
- **2 apontam para fora / não são mecanizáveis:**
  - `Phase Out` (L6) → `"your eidolon is a phantom"`. **Não é referência a documento**: é predicado sobre o trait do eidolon escolhido — e o trait **não existe como dado**. Medido: `system.traits.value` de `anger-phantom-eidolon.json` e `devotion-phantom-eidolon.json` é literalmente `["summoner"]`; "phantom" só aparece na **prosa** ("Traits eidolon, ethereal, phantom"). Mecanizar exigiria inventar um trait — REQ-BC-034 proíbe. Texto preservado.
  - `Protective Pose` (L8) → `"trained in Medicine"`. Atributo do nó (proficiência). Texto preservado.

Total: 11 + 2 = 13 — confere.

`prerequisiteFixes: []`. Nenhum caso de nome-com-sufixo divergente (o problema
`Incredible Companion (Druid)` do Druid não tem análogo aqui).

### Cadeias internas (11)

```
Dual Energy Heart      -> Energy Heart          Miniaturize      -> Shrink Down
Energy Resistance      -> Energy Heart          Towering Size    -> Hulking Size
Blood Frenzy           -> Bloodletting Claws    Airborne Form    -> Glider Form
Magical Adept          -> Magical Understudy    Legendary Summoner -> Master Summoner
Share Eidolon Magic    -> Magical Understudy    Link Focus       -> Link Spells (feature)
Magical Master         -> Magical Adept
```

### Arquétipo de multiclasse (fora de escopo, §9)

`feats/archetype/summoner/` tem 9 talentos. `Summoner Dedication` (L2) carrega
traits `[archetype, dedication, multiclass]` **sem** o trait `summoner` — nenhum
predicado desta curadoria o alcança, exatamente como `Druid Dedication`.
Registrado porque **dois** deles têm pré-requisito textual sobre a **tradição do
eidolon** ("master in the skill associated with your eidolon's tradition"), que é a
mesma dívida do §8.

## 8. Preparação para multiclasse (§4 do plano)

Gate derivado: `{"class_level": {"summoner": {">=": N}}}`, N = nível do arquivo do
feat. **Inequívoco em 59 dos 60.**

Ambiguidade real: **1** feat carrega trait de mais de uma classe —
`Effortless Concentration` (L16: `bard`, `druid`, `sorcerer`, `summoner`, `witch`,
`wizard`), e ele **já está** em `feats-core`, reusado. O predicado correto é `any`
sobre as 6 classes do trait, nunca uma escolha arbitrária — mesma posição já
registrada em `wizard.json`, `cleric.json`, `barbarian.json`, `psychic.json` e
`druid.json`. É a **menor** ambiguidade de trait-duplo medida até agora (o Druid
tinha 17 de 100).

## 9. Conjuração e magias de foco

### 9.1 A tabela — atípica, transcrita como está

Fonte: `journals/classes.json`, entry `kzxu2dI7tFxv6Ix6`, página
`gA4Ud8oSUGkkLwAi` ("Summoner"), **segunda** `<table>` da página (a primeira é a de
avanço de nível). A página **não tem `<caption>`** — a tabela foi identificada pelo
cabeçalho literal `["Your Level","Cantrips","1st",…,"10th"]`. 21 linhas × 12
colunas, parse célula a célula do HTML.

| Nível | Truques | Slots                        |
| ----- | ------- | ---------------------------- |
| 1     | 5       | 1º: 1                        |
| 2     | 5       | 1º: 2                        |
| 3     | 5       | 1º: 2, 2º: 1                 |
| 4     | 5       | 1º: 2, 2º: 2                 |
| 5–6   | 5       | 2º: 2, 3º: 2                 |
| 7–8   | 5       | 3º: 2, 4º: 2                 |
| 9–10  | 5       | 4º: 2, 5º: 2                 |
| 11–12 | 5       | 5º: 2, 6º: 2                 |
| 13–14 | 5       | 6º: 2, 7º: 2                 |
| 15–16 | 5       | 7º: 2, 8º: 2                 |
| 17–20 | 5       | 8º: 2, 9º: 2                 |

**Três anomalias reais, NÃO corrigidas:**

1. **Nunca mais de 4 slots no dia inteiro**, 2 em cada um dos **dois ranks mais
   altos**. Nada de 3–4 por rank como Druid/Cleric/Sorcerer.
2. **Slots de rank inferior desaparecem** (rank 1 some no nível 5, rank 2 no 7, …).
   A armadilha "slot de rank descartado não persiste" do §8 do PLANO aqui **é o
   mecanismo central da classe**.
3. **Nunca existe slot de rank 10.** A coluna "10th" está vazia nas 20 linhas, e os
   níveis 19–20 são idênticos a 17–18. Não há capstone de conjuração (nada
   equivalente a `Miraculous Spell`/`Primal Hierophant`/`Archwizard's Spellcraft`).

### 9.2 Conferência independente — NÃO HÁ PREGEN

A varredura dos **85 arquivos de `iconics/`** (25 personagens) não encontrou
**nenhum** ator cujo item de tipo `class` seja Summoner. A classe **não tem
icônica** no vendor. Fontes independentes usadas no lugar, ambas citadas em
`spellcasting.source`:

**(a) `class-features/summoner-spellcasting.json`** — arquivo **diferente** do
journal, prosa do próprio vendor, confirma as três propriedades mais distintivas
da tabela, literalmente:

- "Each day, you can cast **one 1st-rank spell and five cantrips**" → linha L1.
- "you begin to **lose lower-rank spell slots once you reach 5th level**" → o rank 1 some em L5.
- "The **maximum number of spell slots** you get from the summoner class **is four, starting when you reach 4th level**" → 2+2 do L4 em diante.

**(b) Waybuilder do Igor** (`wb:class/summoner`, base local com 20.083 registros) —
`slots_per_level` bate **célula a célula com o journal nos 20 níveis**, e
`prov.spellcasting` declara proveniência **"waybuilder (PDF, Secrets of Magic
p.55)"**, isto é, transcrição do PDF, não do Foundry. Confirma também
`type: spontaneous`, `key_ability: cha` e a progressão de proficiência de conjuração
(trained@1 / expert@9 / master@17 — idêntica à derivada do `items{}`).

**Zero divergência entre as três fontes.**

### 9.3 Tradição variável — a pendência de contrato

Cada eidolon define a tradição do Summoner (mapa completo no §5). **Não existe
campo estruturado**: a tradição está só na prosa dos 13 docs (as `rules` deles são
apenas dois `ActiveEffectLike` de perícia). O Waybuilder registra o mesmo:
`tradition = "variavel (definida pela escolha de eidolon; nao ha tradicao fixa na
class-feature)"`.

O schema **já suporta** o caso (`tradition: null` + mapa por opção de eixo,
precedente do Sorcerer, r22). O que **não** suporta é uma classe que não seja o
Sorcerer — dois pontos medidos no código:

1. `transform.mjs::spellcastingFor` encaminha **exclusivamente** a chave
   `traditionByBloodline`; qualquer nome novo (`traditionByEidolon`) é descartado
   **em silêncio**.
2. `planVM.ts::chooseClassChoice` tem `if (slotType === "bloodline")` **literal**
   para disparar `bloodlineSpellcastingOps`.

**Consequência medida se nada for wired:** `applyClass` só cria a entrada de
conjuração quando `classSystem.spellcasting.tradition` é verdadeiro. Com
`tradition: null` e sem ramo para o slotType `eidolon`, o Summoner ficaria **sem
nenhuma entrada de conjuração e sem pool de foco** — pior que uma tradição errada.

**Decisão tomada:** `tradition: null` (honesto — não há uma) e o mapa das 13
tradições preenchido sob `traditionByBloodline`, **único canal que chega ao pack**,
chaveado pelo nome do doc em minúsculas (`"angel eidolon"`, …) — que é exatamente o
que `bloodlineSlugFromDocName` produz para um doc sem o prefixo `"Bloodline: "`
(medido lendo a função). **Nenhuma tradição arbitrária foi escolhida** e **nada foi
wired** (§9 do PLANO proíbe). Ver pergunta 1 do §13.

### 9.4 Magias — 7 com trait `summoner`, 2 faltando

| Magia             | Nível | Traits                                    | No pack? |
| ----------------- | ----- | ----------------------------------------- | -------- |
| Boost Eidolon     | 1     | cantrip, concentrate, summoner            | **NÃO**  |
| Reinforce Eidolon | 1     | cantrip, concentrate, summoner            | **NÃO**  |
| Evolution Surge   | 1     | concentrate, **focus**, manipulate, morph | sim      |
| Extend Boost      | 1     | concentrate, **focus**, spellshape        | sim      |
| Unfetter Eidolon  | 1     | concentrate, **focus**, manipulate        | sim      |
| Lifelink Surge    | 2     | **focus**, healing, manipulate, vitality  | sim      |
| Eidolon's Wrath   | 3     | concentrate, eidolon, **focus**, manipulate | sim    |

**Por que as duas faltam (causa medida):** `isSpellsCoreDoc` seleciona por
`sourceId` já existente, tradição `arcane`, trait `focus`, Player Core 2 ou trait
`composition`. `Boost Eidolon` e `Reinforce Eidolon` são **link cantrips** — trait
`cantrip`, **sem** `focus` e sem tradição. Nenhum ramo as pega. É **exatamente** a
mesma forma do quirk dos 10 truques de composição do Bard (r22), e o único trait
comum às duas é `summoner` (não existe trait `link` no vendor).

**Isso dói de verdade:** a class feature `Link Spells` (L1) concede
explicitamente duas magias a **todo** Summoner de nível 1 — `Evolution Surge` (no
pack) e `Boost Eidolon` (**fora** do pack). Metade da concessão de nível 1 não
existe hoje.

Focus pool: base 1, teto 3, concedido por `Link Spells` (confirmado no Waybuilder).
O vínculo eidolon → magia inicial **não** é problema aqui, ao contrário de
ordem→magia (Druid) e domínio→magia (Cleric): as duas magias de nível 1 são as
mesmas para os 13 eidolons.

## 10. Tabela esperada de `proficiencyUpgrades` (9 linhas)

Derivadas de `subfeatures.proficiencies`, com o nível do `items{}`:

| level | stat            | rank | origem                     |
| ----- | --------------- | ---- | -------------------------- |
| 3     | perception      | 2    | Shared Vigilance           |
| 9     | spellcasting    | 2    | Expert Spellcaster (genérico diz 7) |
| 9     | reflex          | 2    | Shared Reflexes            |
| 11    | weapons.simple  | 2    | Simple Weapon Expertise    |
| 11    | weapons.unarmed | 2    | Simple Weapon Expertise    |
| 11    | fortitude       | 3    | Twin Juggernauts           |
| 13    | armor.unarmored | 2    | Defensive Robes            |
| 15    | will            | 3    | Shared Resolve             |
| 17    | spellcasting    | 3    | Master Spellcaster (genérico diz 15) |

`proficiencyUpgradeExtras: []` — a derivação genérica cobre a classe inteira.
`Defensive Robes` produz **uma** linha só (`unarmored`), não três como o
`Medium Armor Expertise` do Druid: o doc traz apenas `unarmored`, coerente com uma
classe sem armadura nenhuma treinada.

**Tetos:** o Summoner **não chega a Legendary em nada**. Para em Master em
conjuração (17), fortitude (11) e vontade (15); em Expert em percepção, reflexos,
armas simples e desarmado; e nunca sobe defesa acima de Expert-em-`unarmored`.

As outras 15 features do `items{}` têm `subfeatures.proficiencies` **vazio** — 9
delas porque agem sobre o **eidolon** (§12), `Weapon Specialization` porque é bônus
de dano, e as 5 restantes porque são regra de texto.

## 11. Colisões e duplicatas

1. **Três divergências nível-genérico × `items{}`** (§2).
2. **Trait-duplo:** 1 de 60 (`Effortless Concentration`, 6 classes), já no pack (§8).
3. **CINCO nomes duplos entre `feats-core` e `spells-core`** — o dobro do caso
   `Untamed Form` do Druid: `Extend Boost` (feat L1 + magia), `Unfetter Eidolon`
   (feat L1 + magia), `Reinforce Eidolon` (feat L2 + truque), `Lifelink Surge`
   (feat L4 + magia), `Eidolon's Wrath` (feat L6 + magia). Documentos distintos em
   packs distintos — o talento concede a magia homônima. Identidade é `sourceId`;
   nenhum consumidor casa feat com spell por nome hoje, mas um casamento por nome
   futuro erraria em **cinco** pontos.
4. **Doc legado órfão:** `class-features/spell-repertoire-summoner.json`
   (`"Spell Repertoire (Summoner)"`, `Ju2Tp5s5iBB76tQO`, SoM, remaster=false) **não
   é referenciado pelo `items{}` de nenhuma das 27 classes**, não carrega a
   otherTag `summoner-eidolon` e não está no pack. O `items{}` remasterizado aponta
   para o doc **genérico** `Spell Repertoire`. É a issue #10 do Waybuilder na
   prática: a base dele monta um eixo falso `outras-opcoes` cuja única opção é
   justamente esse órfão — mesmo achado que `psychic.json` registrou para
   `spell-repertoire-psychic` e `druid.json` para `druid-weapon-expertise`.
5. **`attacks.other` zerado** (`{name:"", rank:0}`) → `transform.mjs` descarta a
   chave e não perde nada. O Summoner **não** produz divergência
   `classSystem.attacks.other` em pregen-parity (a #50 não o alcança).
   `keyAbility` declarada `["cha"]` — nada do buraco do Psychic.
6. **`isSpellsCoreDoc` não alcança 2 das 7 magias** (§9.4).
7. **Gate que a publicação QUEBRA:** `pregen-parity.test.ts` tem a asserção
   **literal** `expect(CLASSES_WITHOUT_PREGEN).toEqual(["Magus"])`. Como o Summoner
   não tem icônica, publicar a classe faz a lista virar `["Magus","Summoner"]` e o
   teste **reprova** até alguém atualizar a asserção. **Isso é edição de arquivo
   compartilhado — achado, não feito aqui** (§2 do PLANO).

## 12. Classe legado e dívida do eidolon

### 12.1 Classe não remasterizada — a segunda depois do Magus

`publication = {license: "OGL", remaster: false, title: "Pathfinder Secrets of
Magic"}`. Medido no conteúdo: **58 dos 60** class feats são OGL/não-remaster (as
exceções: `Effortless Concentration`, Player Core, e `Protective Pose`, Tian Xia
Character Guide — o único `uncommon` dos 60); **19 das 24** features do `items{}`
(as 5 remaster são justamente as 5 já no pack); **11 das 13** opções de eidolon (as
remaster são `Elemental Eidolon`/Rage of Elements e `Swarm Eidolon`/Battlecry!).

**Precedente:** das 15 classes já curadas, o **Magus** é igualmente
`Secrets of Magic | remaster=false | OGL`. Legado **não é bloqueio** — mas tem
consequência concreta na tradução pt-BR: a prosa das opções de eidolon usa
**vocabulário pré-remaster** — `"Alignment must be good"`, `"Home Plane Nirvana
(if NG), Elysium (if CG), or Heaven (if LG)"`, dano `good`/`evil` (medido em
`angel-eidolon.json` e `demon-eidolon.json`). Alinhamento não existe no remaster.
Fora do escopo desta fase (§9), mas agora em **11 documentos de opção de eixo**.

### 12.2 O eidolon como criatura — a dívida dominante

O eidolon é um **ator separado** com ficha, atributos, ataques e progressão
próprios. Nada disso existe nos packs do Fusion; está fora desta fase (§9).
**Tamanho do buraco, medido:**

- **55 dos 60 class feats (91,7%)** mencionam o eidolon no nome ou no texto. Os 5
  que não: `Lifelink Surge`, `Master Summoner`, `Link Focus`,
  `Effortless Concentration`, `Legendary Summoner`.
- Desses 55, **35 carregam o trait `evolution`** — existem **só** para customizar o eidolon.
- **9 das 24 features do `items{}`** agem exclusivamente sobre o eidolon e por isso
  têm `subfeatures.proficiencies` vazio: Eidolon (1), Eidolon Unarmed Expertise (5),
  Eidolon Symbiosis (7), Eidolon Weapon Specialization (7), Eidolon Defensive
  Expertise (11), Eidolon Unarmed Mastery (13), Greater Eidolon Specialization (15),
  Eidolon Transcendence (17), Eidolon Defensive Mastery (19). A derivação genérica
  não perde nada — não há o que derivar, o alvo é outro ator.
- **Somando: 64 dos 84 documentos jogáveis da classe** (60 feats + 24 features) só
  produzem efeito quando existir ator-eidolon.

Sem ator-eidolon o Summoner é **publicável** e a ficha fecha (chassi, salvaguardas,
conjuração), mas é a classe com a **menor fração de conteúdo vivo** de todas as
curadas — pior que a dívida de companheiro animal do Druid (7 talentos lá, 64
documentos aqui).

### 12.3 Perícias do eidolon

`trainedSkills = {value: [], additional: 3}` — nenhuma perícia fixa. Cada opção de
eidolon carrega **dois** `ActiveEffectLike` que treinam duas perícias (tabela no
§5). **Atenção:** esses efeitos escrevem em `system.skills.<x>.rank` do
**ator-eidolon**, não do Summoner. Hoje nenhum consumidor os aplica, e não há ator
para aplicar. Mesma família da dívida "proficiência por opção de eixo" que
`cleric.json` (doutrina) e `druid.json` (ordem) já pediram.

## 13. Fiação necessária e perguntas em aberto para a integração central

### Fiação medida (custo real desta classe)

| Onde | O quê |
| --- | --- |
| `planVM.ts` | `PlanSlotType` + `SLOT_TYPE_LABELS` + `CLASS_CHOICE_SLOTS["Eidolon"] = "eidolon"` + `CLASS_CHOICE_SLOT_OPTIONS.eidolon` — 4 linhas, mesmo custo do Druid |
| `choiceSetInventory.ts` | **3** entradas novas: `class-features-core/Eidolon/eidolon` (→ `eixo`), `class-features-core/Evolution Feat/evolutionFeat` (→ `pendente`), `feats-core/Ranged Combatant/rangedCombatant` (→ `pendente`) |
| `pregen-parity.test.ts` | atualizar `expect(CLASSES_WITHOUT_PREGEN).toEqual(["Magus"])` → incluir `"Summoner"` |
| `build-mvp-subset.mjs` | ramo novo em `isSpellsCoreDoc` para os link cantrips (senão faltam 2 magias, uma delas concedida no nível 1) |
| `transform.mjs` / `planVM.ts` | generalizar `traditionByBloodline` + `if (slotType === "bloodline")` (senão a classe sai sem entrada de conjuração) |
| `GRANT_TARGET_*` | **nada**. Os 4 GrantItem de alvo fixo (`Manifest Eidolon`, `Act Together`, `Share Senses` em `actions-core`; `Quickened` em `conditions`) já estão nos packs — verificado |

Ou seja: **o Summoner é a primeira classe do "processo-fábrica" que NÃO cabe em
"um arquivo de curadoria + 4 linhas de fiação"** — ela exige mudança em dois
arquivos compartilhados (`build-mvp-subset.mjs` e `transform.mjs`/`planVM.ts`) para
sair correta. É a resposta empírica que o piloto do Druid não pôde dar.

### Perguntas

1. **Tradição por opção de eixo (§9.3).** (a) Renomear `traditionByBloodline` →
   `traditionByAxisOption` (o mapa do `summoner.json` migra verbatim, e o Sorcerer
   também)? (b) Generalizar o `if (slotType === "bloodline")` de
   `chooseClassChoice` para "todo eixo cuja curadoria declare o mapa"? Enquanto isso
   não acontecer, **o Summoner é um conjurador sem entrada de conjuração**. Não
   escolhi tradição nem wirei nada.
2. **Link cantrips (§9.4).** Qual ramo novo em `isSpellsCoreDoc`? O único trait
   comum a `Boost Eidolon` e `Reinforce Eidolon` é `summoner`; não existe trait
   `link`. Um ramo por trait de classe curada seria genérico, mas muda o critério
   do pack inteiro — decisão de escopo, não minha.
3. **`Evolution Feat` — a terceira forma de escolha (§ notas do JSON).** É uma
   **class feature do `items{}`** cujo `ChoiceSet` escolhe um **talento** por filtro
   **declarativo** (`level ≤ 1`, `category: class`, `trait: evolution`) — os três
   predicados que `GrantedFeatPredicate` já sabe expressar. Mas
   `CLASS_CHOICE_SLOTS` oferece docs de class-feature marcados por otherTag, e
   `GRANTED_FEAT_CHOICES` é chaveado por **nome de talento** concedente. Nenhuma das
   duas cobre esse formato. Criar um terceiro caminho, ou estender
   `GRANTED_FEAT_CHOICES` para aceitar chave de class-feature?
4. **Classe legado (§12.1).** O Magus abriu o precedente de publicar OGL/não-remaster.
   Confirma-se para o Summoner, sabendo que 11 docs de opção de eixo carregam
   vocabulário de alinhamento (que não existe no remaster) e vão para a tradução
   pt-BR assim?
5. **Ordem de publicação vs. eidolon (§12.2).** Publicar a classe agora entrega 84
   documentos dos quais 64 são inertes até existir ator-eidolon. Publica-se assim
   (como o Druid fez com companheiro animal, em escala muito menor), ou o Summoner
   espera o pack de criaturas-companheiras?

## 14. Divergências contra a medição preliminar do orquestrador

Nenhuma. Os cinco números conferidos batem: hp 10 ✓, atributo-chave `cha` ✓, 24
features no `items{}` com 5 já nos packs ✓, 60 class feats (59 exclusivos + 1
compartilhado) com 1 já em `feats-core` por `sourceId` ✓, 1 eixo `summoner-eidolon`
com 13 opções ✓, 7 magias com trait `summoner` das quais 5 no pack e 2 faltando ✓.

---

## Errata do orquestrador (2026-08-23) — "classe legado" era falso dilema

A pendência "confirmar publicar classe legado" levantada na seção 13 está mal
calibrada. Medição feita depois da entrega, contra o próprio vendor:

1. **As 27 classes do vendor têm `publication.remaster = true`, menos duas:**
   Magus e Summoner (ambas Secrets of Magic, OGL). O flag marca a FONTE do
   documento (livro OGL ainda não reeditado), não a validade da classe no jogo
   atual — o Summoner segue jogável no PF2e pós-remaster.
2. **O precedente já existe e já foi mergeado:** o Magus é a outra classe
   `remaster=false` e foi a PRIMEIRA classe importada pelo Fusion (r10-B).
   Publicar classe de fonte OGL não é decisão nova desta rodada.
3. **O remaster tocou o Summoner de leve:** a tabela oficial de mudanças
   (`journals/remaster-changes.json`, 370 linhas) traz UMA entrada para o
   Summoner — o feat `Link Wellspring`, removido — e o vendor JÁ não carrega
   esse arquivo. Ou seja, os feats medidos aqui já são o conjunto pós-remaster.
   Comparativo na mesma tabela: Witch 6 mudanças, Swashbuckler 4, Alchemist 2,
   Oracle 1, Investigator 1, Magus 1; Thaumaturge/Inventor/Animist/Commander/
   Guardian/Exemplar 0.
4. **O que sobra de legado é vocabulário, não mecânica:** 6 dos 83 documentos
   varridos (`angel-eidolon`, `demon-eidolon`, `psychopomp-eidolon`,
   `swarm-eidolon`, `eidolons-wrath`, `ranged-combatant`) ainda usam vocabulário
   de alinhamento, que o remaster substituiu por holy/unholy. Isso é tratamento
   de conteúdo na importação/tradução, não impedimento de publicação.

**Portanto:** das cinco perguntas da seção 13, a (4) está respondida pelo
precedente do Magus. A (5) — publicar com 64 documentos inertes enquanto o
eidolon não existe como ator — CONTINUA aberta e é a única decisão de produto
real do Summoner.
