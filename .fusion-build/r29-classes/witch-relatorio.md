# r29 — Witch — relatório de curadoria

Arquivo de configuração produzido: `tools/importer-pf2e/src/curation/classes/witch.json`.

Fase de **levantamento** (PLANO.md §1): nenhum importer rodou, nenhum pack foi
gerado, nenhum arquivo compartilhado foi tocado, nenhum comando `git` que
altere estado foi executado.

---

## 1. Método (comandos rodados)

Todas as contagens vieram de scripts `.mjs` executados **agora**, contra
`tools/importer-pf2e/vendor/pf2e/packs/pf2e/` (junction somente-leitura) e
`systems/pf2e/packs/*/documents.json`. Os scripts vivem no scratchpad da
sessão (fora da worktree, conforme §3 do plano) e são reconstruíveis a partir
da descrição abaixo — cada um é um `walk()` recursivo + `JSON.parse` + filtro.

| # | O que mediu | Fonte | Resultado-chave |
| --- | --- | --- | --- |
| s1 | `items{}` da classe, nome canônico (cauda da uuid) × `entry.name`, nível do `items{}` × nível genérico do arquivo | `classes/witch.json` + varredura recursiva de `class-features/**` (842 arquivos, 841 com `system` — o 842º é `_folders.json`) | 15 entradas; **1 divergência de nome** e **4 de nível** |
| s2 | União dos `items{}` das **27** classes do vendor; cruzamento com `class-features-core` por `flags.fusion.sourceId` | `classes/*.json` + `systems/pf2e/packs/class-features-core/documents.json` (318 docs) | 9 features compartilhadas / 6 exclusivas; **9 já nos packs** |
| s3 | `system.traits.otherTags` com prefixo `witch` em `class-features/**` | idem | 3 tags, mas só **2 eixos** (ver §5) |
| s4/s5/s6/s7 | `rules[]` de `Patron`, `Witch Spellcasting`, `Hex Spells`, `Familiar (Witch)`, `Patron's Gift`, `Will of the Pupil` e dos **16 patrons** | `class-features/*.json` | tradição vem do patron; **nenhum patron toca atributo** |
| s8 | Class feats: `feats/class/witch/level-*/` (38 arquivos) + `feats/class/shared-class-feats/level-*/` (113 arquivos, filtrados por trait `witch`) | vendor + `feats-core` (2 205 docs) | **53 candidatos**, 14 já nos packs |
| s9 | `system.prerequisites.value` dos 53 | idem | 19 feats / 20 entradas de texto |
| s10 | Quem **consome** cada tag de eixo (varredura de `feats/`, `class-features/`, `classes/`, `campaign-effects/`, `feat-effects/`, `familiar-abilities/`) | vendor | `witch-elementalist-patron`: **zero consumidores** |
| s11 | Magias com trait `witch` (1 796 arquivos em `spells/**`) × `spells-core` (1 310 docs) | vendor + packs | 39 hexes, **22 no pack, 17 fora** |
| s12/s13 | `rules[]` e `@UUID` das descrições das 19 lições e dos 16 patrons | vendor | vínculo opção→hex **só existe na prosa** |
| s14 | Quem cita `Cackle`/`Phase Familiar`/`Patron's Puppet`/`Manifest Will` | vendor | `Manifest Will` é do arquétipo Seneschal |
| s15/s16/s20 | Parse **célula a célula** do HTML das duas tabelas da página "Witch" do journal | `journals/classes.json` | tabela de 20 níveis + proficiências iniciais |
| s17/s18 | Descoberta da icônica **lendo o item `type: "class"`** de cada ator de `iconics/**` (não pelo nome) e leitura das `spellcastingEntry` | `iconics/feiya/feiya-level-{1,3,5}.json` | 3 fichas, batem célula a célula |
| s19 | `deriveProficiencyUpgrades` importada de `curation/proficiency-upgrades.mjs` (módulo puro, leitura) e rodada sobre os docs do vendor | vendor | **10 linhas**, `missing: []`, `ignoredRules: []` |
| s22 | `familiar-abilities-core` (111 docs) × `familiar-abilities/` do vendor (111 arquivos) | packs + vendor | cobertura **111/111** |
| s23 | Homônimos `Improved/Spirit/Incredible Familiar` | vendor + `feats-core` | nenhum em conflito hoje |
| s24 | `wb:class/witch` no Waybuilder (20 083 registros) | `~/pessoal/Wayfinder/pipeline/base/index.json` | terceira fonte da tabela |
| s25/s26 | Parse das 5 tabelas de `journals/remaster-changes.json` (560 linhas de dado) e cruzamento com as 20 entradas de pré-requisito e com os 53 nomes | vendor | **6 linhas Witch; interseção em 2 nomes** (§7.1) |
| s27 | `applyPrerequisiteFixes` (importada de `curation/index.mjs`) rodada sobre cópias em memória dos 53 feats | módulo puro | os 4 fixes aplicam **sem lançar** |

**Validação obrigatória (§5 do plano), rodada da raiz da worktree:**

```
$ node --input-type=module -e "import {validateClassCuration} from './tools/importer-pf2e/src/curation/index.mjs'; import {readFileSync} from 'node:fs'; const f='witch.json'; const cfg=validateClassCuration(JSON.parse(readFileSync('tools/importer-pf2e/src/curation/classes/'+f,'utf8')), f); console.log('OK', cfg.class, 'eixos:', cfg.choiceAxes.length, 'feats.trait:', cfg.classFeats.trait);"
OK witch eixos: 2 feats.trait: witch
```

Rodada duas vezes: antes e **depois** de acrescentar os 4 `prerequisiteFixes`
de §7.1 — mesma saída nas duas.

Carregamento agregado (`loadClassCuration({force:true})`) com o arquivo no
disco: **21 classes**, sem slug duplicado, e o mapa `otherTag → category` sai
sem colisão (`patron ← witch-patron`, `lesson ← witch-lesson`; varredura das
26 categorias declaradas por todas as classes confirma unicidade).

---

## 2. Doc da classe (medido) — `classes/witch.json`, `_id` `bYDXk9HUMKOuym9h`

| Campo | Valor |
| --- | --- |
| hp | **6** |
| keyAbility | `["int"]` — uma só opção |
| perception | 1 (treinado) |
| savingThrows | fortitude 1, reflex 1, **will 2** (expert já no nível 1) |
| attacks | simple 1, unarmed 1, martial 0, advanced 0, other `{name:"", rank:0}` |
| defenses | unarmored 1, **light 0, medium 0, heavy 0** — nenhuma armadura |
| ancestryFeatLevels | 1, 5, 9, 13, 17 |
| classFeatLevels | **2**, 4, 6, 8, 10, 12, 14, 16, 18, 20 (não tem nível 1) |
| generalFeatLevels | 3, 7, 11, 15, 19 |
| skillFeatLevels | 2, 4, 6, 8, 10, 12, 14, 16, 18, 20 |
| skillIncreaseLevels | 3, 5, 7, 9, 11, 13, 15, 17, 19 |
| trainedSkills | `value: []`, `additional: 3` — **value vazio** (a perícia fixa vem do patron) |
| spellcasting | `1` (conjura; **sem campo de tradição**) |
| classDC | **ausente** (`'classDC' in system === false`) |

Confere com o texto "Initial Proficiencies" do journal linha a linha, e com o
`wb:class/witch` do Waybuilder nas cinco linhas de proficiência, no
`skill_training {free:3}` e nos quatro `feat_slot`.

### `items{}` — 15 entradas

| Nível (items{}) | Nome canônico (cauda da uuid) | `entry.name` | Nível genérico do arquivo | Divergência |
| --- | --- | --- | --- | --- |
| 1 | Familiar (Witch) | Familiar (Witch) | 1 | — |
| 1 | **Hex Spells** | **Hexes** | 1 | **SIM — nome (armadilha do Magus)** |
| 1 | Patron | Patron | 1 | — |
| 1 | Witch Spellcasting | Witch Spellcasting | 1 | — |
| 5 | Magical Fortitude | Magical Fortitude | 5 | — |
| 7 | Expert Spellcaster | Expert Spellcaster | 7 | — |
| 9 | Reflex Expertise | Reflex Expertise | **3** | **SIM — nível** |
| 11 | Perception Expertise | Perception Expertise | **3** | **SIM — nível** |
| 11 | Weapon Expertise | Weapon Expertise | **5** | **SIM — nível** |
| 13 | Defensive Robes | Defensive Robes | 13 | — |
| 13 | Weapon Specialization | Weapon Specialization | **7** | **SIM — nível** |
| 15 | Master Spellcaster | Master Spellcaster | 15 | — |
| 17 | Will of the Pupil | Will of the Pupil | 17 | — |
| 19 | Legendary Spellcaster | Legendary Spellcaster | 19 | — |
| 19 | Patron's Gift | Patron's Gift | 19 | — |

**Duas armadilhas confirmadas, uma de cada tipo.**

- **Nome:** a entrada `sbys9` exibe "Hexes" mas aponta para
  `Compendium.pf2e.classfeatures.Item.**Hex Spells**`. Não existe nenhum doc
  chamado "Hexes" nos 841 arquivos de `class-features/` — casar por
  `entry.name` cria documento fantasma. É o mesmo defeito de "Lightning
  Reflexes" → "Reflex Expertise" do `magus.json`. Nas outras 14 entradas
  `entry.name` == cauda da uuid.
- **Nível:** **quatro** divergências (o Fighter tinha duas; é a maior contagem
  registrada até agora). A Witch é a conjuradora de progressão mais tardia
  curada: recebe Reflex Expertise no 9, Perception Expertise e Weapon
  Expertise no 11, Weapon Specialization no 13.

Todas as cinco estão em `dedupe.collisionsDetected`.

---

## 3. Features compartilhadas com outras classes (união dos `items{}` das 27 classes)

| Feature | Nº de classes | Classes |
| --- | --- | --- |
| Weapon Specialization | 25 | quase todas |
| Weapon Expertise | 14 | Champion, Druid, Exemplar, Guardian, Investigator, Kineticist, Magus, Oracle, Psychic, Sorcerer, Swashbuckler, Thaumaturge, Witch, Wizard |
| Reflex Expertise | 12 | Barbarian, Bard, Champion, Cleric, Druid, Guardian, Inventor, Magus, Sorcerer, Thaumaturge, Witch, Wizard |
| Perception Expertise | 12 | Alchemist, Animist, Champion, Cleric, Druid, Exemplar, Inventor, Kineticist, Monk, Sorcerer, Witch, Wizard |
| Expert Spellcaster | 10 | Animist, Bard, Druid, Magus, Oracle, Psychic, Sorcerer, Summoner, Witch, Wizard |
| Master Spellcaster | 10 | idem |
| Legendary Spellcaster | 8 | Animist, Bard, Druid, Oracle, Psychic, Sorcerer, Witch, Wizard |
| Magical Fortitude | 4 | Oracle, Sorcerer, Witch, Wizard |
| Defensive Robes | 4 | Sorcerer, Summoner, Witch, Wizard |
| Witch Spellcasting | 1 | só Witch |
| Familiar (Witch) | 1 | só Witch |
| Hex Spells | 1 | só Witch |
| Patron | 1 | só Witch |
| Will of the Pupil | 1 | só Witch |
| Patron's Gift | 1 | só Witch |

R1 obedecida: as 9 compartilhadas entram **uma vez** (o pipeline faz a união);
esta curadoria só as **declara**.

---

## 4. O que já existe nos packs — REUSAR

Cruzamento por `flags.fusion.sourceId` (não por nome).

**`class-features-core` (318 docs) — 9 de 15 já lá, todas reusáveis:**

| Feature | `sourceId` (= `_id` do vendor) |
| --- | --- |
| Magical Fortitude | `70jqXP2eS4tRZ0Ok` |
| Expert Spellcaster | `cD3nSupdCvONuHiE` |
| Reflex Expertise | `TUOeATt52P43r5W0` |
| Perception Expertise | `JCqACxgrm5ixX0Jy` |
| Weapon Expertise | `9XLUh9iMepZesdmc` |
| Defensive Robes | `gU7epgcPSm0TD1UK` |
| Weapon Specialization | `9EqIasqfI8YIM3Pt` |
| Master Spellcaster | `l1InYvhnQSz6Ucxc` |
| Legendary Spellcaster | `Hfaa7TuLn3nE8lr3` |

Faltam 6: Patron (`KPtF29AaeX2sJW0K`), Witch Spellcasting
(`zT6QiTMxxj8JYoN9`), Familiar (Witch) (`yksPhweBZYVCsE1A`), Hex Spells
(`9uLh5z2uPo6LDFRY`), Will of the Pupil (`FuVO8ksHI1B5ozVI`), Patron's Gift
(`cDnFXfl3i5Z2l7JP`). **Nenhuma** das 16 opções de patron nem das 19 lições
está no pack.

**Total novo em `class-features-core`: 41 documentos** (6 + 16 + 19).

**`feats-core` (2 205 docs) — 14 dos 53 já lá** (por `sourceId` E por nome; os
dois conjuntos coincidem, sem homônimo de `sourceId` diferente): Cantrip
Expansion, Chaotic Spell, Conceal Spell, Counterspell (Prepared), Detonating
Spell, Divine Emissary, Effortless Concentration, Enhanced Familiar, Helt's
Spelldance, Quickened Casting, Reach Spell, Reflect Spell, Steady
Spellcasting, Widen Spell. **39 são novos.**

**`spells-core` (1 310 docs) — 22 dos 39 hexes já lá.** Ver §9.

**`familiar-abilities-core` — 111/111, pack completo.** Os feats `Pet`
(`6yPrvbSDaa8glLjn`) e `Familiar` (`bcxIg7wi8ZAhvhOD`) também já estão em
`feats-core`.

**`classes-core` (15 docs)** — Witch **não** está lá ainda (confirmado).

---

## 5. Eixos de sub-escolha — **DOIS**, não três

### Achado: `witch-elementalist-patron` não é eixo

A medição preliminar da rodada declarava 3 eixos: `witch-patron` (16),
`witch-elementalist-patron` (7), `witch-lesson` (19). **Refutado, com dois
argumentos medidos:**

1. As 7 opções de `witch-elementalist-patron` carregam **também**
   `witch-patron` — `otherTags: ["witch-elementalist-patron","witch-patron"]`
   nas sete. São um **subconjunto** dos 16 patrons: Devourer of Decay,
   Mosquito Witch, Ripple in the Deep, Silence in Snow, The Inscribed One,
   Whisper of Wings, Wilding Steward.
2. A varredura de **quem consome** a tag em `feats/`, `class-features/`,
   `classes/`, `campaign-effects/`, `feat-effects/` e `familiar-abilities/`
   devolveu **zero**: nenhum ChoiceSet, predicado ou filtro do vendor inteiro
   lê `witch-elementalist-patron`. É tag de catalogação morta.

Declará-la como eixo **quebraria o pack**: `transform.mjs` resolve a category
por `otherTags.map(t => axisCategories.get(t)).find(Boolean)`, e como o array
do vendor vem com `witch-elementalist-patron` **primeiro**, os 7 sairiam com
category `elementalistPatron`; o eixo `patron` ficaria com 9 opções e a
asserção de `optionCount` em `transform.test.mjs` reprovaria (`9 != 16`).

### Eixo 1 — `witch-patron` (nível 1, 16 opções, `slotType: "patron"`)

Concessora: a feature **`Patron`** do `items{}` (nível 1). Forma **idêntica**
à do `Druidic Order` — `ChoiceSet {choices:{filter:["item:tag:witch-patron"]}, flag:"patron"}`
seguido de `GrantItem {uuid:"{item|flags.system.rulesSelections.patron}"}`.
`featureNameInItemsMap: "Patron"` casa exatamente com a entrada `tasue` do
`items{}`. Nenhuma das 16 carrega `class-archetype`, então `optionCount: 16`
vale em todo caminho (diferente do `Battle Creed` no eixo `cleric-doctrine`).

| Patron | `_id` | Tradição | Perícia | Elementalista? |
| --- | --- | --- | --- | --- |
| Baba Yaga | `VVMMJdIWL7fAsQf3` | occult | occultism | — |
| Choir Politic | `v2JQB6j3VIKWqPpQ` | divine | society | — |
| Cobyslarni | `CxvLFkrV5LlADQkx` | occult | occultism | — |
| Devourer of Decay | `T9wA833bzZVlB3Lo` | primal | nature | sim |
| Faith's Flamekeeper | `mFqMSQoNl0NMDklv` | divine | religion | — |
| Mosquito Witch | `zy0toWeGIeQstbT4` | primal | nature | sim |
| Paradox of Opposites | `RdOzBNPKLTMUWrJs` | divine | religion | — |
| Ripple in the Deep | `lgv4VIoj5TLhm9u0` | primal | nature | sim |
| Silence in Snow | `9c57R18pfgfqlBCD` | primal | nature | sim |
| Spinner of Threads | `ghIsqhEsJTvjJiNl` | occult | occultism | — |
| Starless Shadow | `r2ZPRAw9c3VGZi8A` | occult | occultism | — |
| The Inscribed One | `FdLx4VODZEYLGOK9` | arcane | arcana | sim |
| The Resentment | `9OwWgOP8ZWxTAqbg` | occult | occultism | — |
| The Unseen Broker | `ydI39ViUy22nBRn6` | occult | occultism | — |
| Whisper of Wings | `4zE3seVFtLPNw9EQ` | primal | nature | sim |
| Wilding Steward | `e0VhUyjz1clW3sC4` | primal | nature | sim |

Distribuição: occult 6, primal 6, divine 3, arcane 1.

### Eixo 2 — `witch-lesson` (19 opções, `slotType: "lesson"`) — **primeiro eixo sem concessora no `items{}`**

Em 16 classes curadas, todo eixo tinha uma feature do `items{}` hospedando o
`ChoiceSet`. A lição **não tem**. Quem hospeda são **três class feats**:

| Concessora | Nível | Filtro do ChoiceSet | Opções oferecidas |
| --- | --- | --- | --- |
| Basic Lesson (`wsq8nncD25Q1fRn2`) | 2 | `item:tag:witch-lesson` + `item:level:2` | 6 |
| Greater Lesson (`qDfTqetM9UEpp8ty`) | 6 | `item:tag:witch-lesson` + `lte item:level 6` | 15 |
| Major Lesson (`ZFkCMl63ogK55Otq`) | 10 | `item:tag:witch-lesson` + `lte item:level 10` | 19 |

As 19 lições, por nível de opção: **nível 2 (6)** Calamity, Dreams, Elements,
Life, Protection, Vengeance; **nível 6 (9)** Decay, Favors, Memory, Mischief,
Shadow, Snow, the Flock, the Shark, Vows; **nível 10 (4)** Bargains, Death,
Renewal, the Frozen Queen.

Consequências medidas:

- A escolha é **repetível** (até três lições) e **nenhuma é automática** — se
  a jogadora não gastar talento de classe, fica com zero lições. Isso não cabe
  no par `(level, choose)` do schema de eixo, que assume uma concessora fixa
  num nível fixo.
- `featureNameInItemsMap` é **obrigatório** no validador
  (`choiceAxes[i].featureNameInItemsMap ausente (nome canônico da uuid)`), e
  não existe entrada de `items{}` para apontar. Foi preenchido com
  `"Basic Lesson"` (a primeira concessora). Impacto medido: o campo hoje é
  lido **só** por `grafo-de-feats.mjs` (`rotulosDoEixo`, para casar rótulo de
  pré-requisito) — não corrompe pack nenhum. Mas o **contrato está esticado**
  e isso vira pergunta aberta (§10).
- `optionCount: 19` foi declarado porque é o único dos três números que a
  asserção de `transform.test.mjs` consome (compara com o nº de docs do pack
  com a category). `level: 2` e `choose: 1` estão ali por obrigação de schema;
  os números reais estão em `notes[]`.
- `axisLevelByOtherTag` **não** é acionado: nenhuma opção de eixo tem
  `system.level.value === 0` (patrons vêm com 1, lições com 2/6/10).

**Confirmação externa da forma:** a ficha da Feiya nível 5 traz o **talento**
`Basic Lesson` (category `class`, L2) e a **class-feature** `Lesson of Life`
(`otherTags: ["witch-lesson"]`) como itens separados — exatamente o desenho
"feat hospeda o ChoiceSet, feature é o resultado".

### Fora dos eixos, e corretamente

Duas class-features com trait `witch` **não** entram: `Seneschal`
(`DFDonF73QRMkEPu7`, `otherTags: ["class-archetype"]`) e `Patron Theme`
(`nocYmxbi4rqCC2qS`, sem tags e sem rules). Nenhuma está no `items{}` nem
carrega otherTag de eixo. O `Seneschal` é o análogo witch do `Battle Creed` do
Cleric — com a diferença decisiva de que **não reusa a otherTag do eixo**,
então aqui não existe a ambiguidade de `optionCount` que o `cleric.json` teve.

---

## 6. Class feats — 53 candidatos

- **38** exclusivos em `feats/class/witch/level-*/` (38 arquivos, **38/38** com
  trait `witch`).
- **15** de `feats/class/shared-class-feats/level-*/` (113 arquivos no total)
  com trait `witch`. A pasta é subdividida por nível — `readdirSync` raso
  devolve 0.
- **Total: 53**, todos com `system.category === "class"`, nenhum com trait
  `archetype`, e **nenhum** com `system.level.value` diferente do nível da
  pasta.

| Nível | Total | Exclusivos | Compartilhados |
| --- | --- | --- | --- |
| 1 | 7 | 4 | 3 |
| 2 | 6 | 3 | 3 |
| 4 | 5 | 5 | 0 |
| 6 | 8 | 5 | 3 |
| 8 | 8 | 5 | 3 |
| 10 | 4 | 3 | 1 |
| 12 | 4 | 4 | 0 |
| 14 | 3 | 2 | 1 |
| 16 | 2 | 1 | 1 |
| 18 | 2 | 2 | 0 |
| 20 | 4 | 4 | 0 |
| **soma** | **53** | **38** | **15** |

**Detalhe que confunde na leitura:** existem 7 class feats de nível 1, mas
`classFeatLevels` da Witch começa em **2**. A Witch só compra o primeiro
talento de classe no nível 2 — é o dado do vendor e do journal, não defeito.

**14 dos 53 já estão em `feats-core`** por `sourceId` (§4). `excludeNames` e
`extraNames` ficaram **vazios**: nenhum feat com trait `archetype` no conjunto
(nada análogo aos 10 "* Mask" do Druid), e `Witch Dedication`
(`y0vdu6DGhKKElmE6`, traits `[archetype, dedication, multiclass]`, sem trait
`witch`) fica de fora deliberadamente — a curadoria mede a classe **pura**,
mesma decisão do `druid.json`.

**Sufixos:** 2 dos 53 carregam desambiguação do vendor —
`Improved Familiar (Witch)` (L4) e `Spirit Familiar (Witch)` (L8). Caso
inverso no mesmo conjunto: `Incredible Familiar` entra **sem** sufixo (é a
versão thaumaturge+witch) e convive com `Incredible Familiar (Animist)` e
`Incredible Familiar (Familiar Master)`, que ficam de fora. Nenhum dos quatro
está em `feats-core` hoje, então não há duplicata a resolver.

---

## 7. Pré-requisitos

**19 dos 53** têm `system.prerequisites.value` não vazio; **20 entradas de
texto** no total (só `Divine Emissary` tem duas).

**12 entradas resolvem dentro do conjunto** (`prerequisites.internalChains`) —
8 diretamente e 4 depois dos `prerequisiteFixes` de §7.1:

| Dependente | Pré-requisito | Tipo do alvo |
| --- | --- | --- |
| Sympathetic Strike (L4) | Witch's Armaments | feat |
| Wild Witch's Armaments (L6) | Witch's Armaments | feat |
| Witch's Bottle (L8) | Cauldron | feat |
| Double, Double (L10) | Cauldron | feat |
| Witch's Communion (L10) | Witch's Charge | feat |
| Incredible Familiar (L8) | Enhanced Familiar | feat (compartilhado) |
| Patron's Truth (L20) | Patron's Gift | **class feature** (vendor escreve `"patron's gift"` minúsculo) |
| Reflect Spell (L14) | Counterspell (Prepared) | feat — **só na documentação**, ver §7.2 |
| Syu Tak-nwa's Skillful Tresses (L4) | Witch's Armaments | feat — **via `prerequisiteFixes`**, §7.1 |
| Syu Tak-nwa's Deadly Hair (L6) | Witch's Armaments | idem |
| Syu Tak-nwa's Hexed Locks (L8) | Witch's Armaments | idem |
| Demon's Hair (L20) | Witch's Armaments | idem |

**As 8 restantes, em quatro famílias — nenhuma mecanizada, texto do vendor
preservado (REQ-BC-034):**

1. **Atributo do nó — `"a familiar"` (4 entradas):** Familiar's Language (L2),
   Enhanced Familiar (L2), Divine Emissary (L6, 1ª entrada), Familiar's Eyes
   (L12). Não aponta para documento nenhum. Para a Witch pura é sempre
   verdadeiro (todo mundo tem `Familiar (Witch)` no nível 1); para as outras
   classes que compartilham esses feats, não.
2. **Tradição da opção de eixo (2 entradas):** `Spirit Familiar (Witch)` (L8)
   → `"divine or occult patron"`; `Stitched Familiar` (L8) → `"arcane or
   primal patron"`. Não aponta para patron nomeado, e sim para o **atributo
   tradição** do patron escolhido. **Família nova**, e só resolve quando a
   integração central decidir onde a tradição por opção de eixo vive (§9/§10).
3. **Proficiência de perícia (1):** `Helt's Spelldance` (L8) → `"expert in
   Performance"`.
4. **Narrativo / pré-remaster (1):** `Divine Emissary` (L6, 2ª entrada) →
   `"you follow a good-aligned deity or patron"`. Linguagem de alinhamento,
   que o remaster aposentou.

### 7.1 Cruzamento com `journals/remaster-changes.json` — 4 `prerequisiteFixes`

A tabela de mudanças do remaster (entry `6L2eweJuM8W7OCf2`, **560 linhas de
dado** em 5 páginas: Class Features, Feats, Spells, Equipment, Bestiaries) tem
**6 linhas de Witch** — a classe mais afetada da rodada:

| Nome antigo | Página | Status | Alvo novo |
| --- | --- | --- | --- |
| Witch Patron Themes | Class Features | Replaced | → a página "Witch" do journal |
| Cauldron | Feats | Altered mechanics | — |
| Eldritch Nails | Feats | Renamed | Witch's Armaments |
| Hex Wellspring | Feats | Removed | — |
| **Living Hair** | Feats | **Merged** | **Witch's Armaments** |
| Temporary Potions | Feats | Merged | Cauldron |

**Cruzando com as 20 entradas de pré-requisito medidas: 6 ocorrências em 2
nomes.**

**(a) `"Living Hair"` × 4 — vira `prerequisiteFixes`, não dívida.** Três
evidências que se sustentam:

- "Living Hair" não é um doc em lugar nenhum do vendor;
- os 4 feats que o citam são **pré-remaster**: `system.publication` =
  `{license: "OGL", remaster: false}`, de *Pathfinder #166 "Despair on Danger
  Island"* (os três Syu Tak-nwa) e *#168 "King of the Mountain"* (Demon's Hair)
  — e `isFeatsCoreDoc` não filtra por licença, então eles entram no pack;
- a linha do journal manda o nome antigo para `Witch's Armaments` (`ORC`,
  Player Core, L1), que **está** no conjunto dos 53.

É o caso canônico de `kind: "rename"` (issues #26/#28/#30/#46). Os 4 fixes
estão declarados, e a aplicação foi **simulada**: `applyPrerequisiteFixes`
importada de `curation/index.mjs` e rodada sobre cópias em memória dos 53 feats
tocou exatamente os 4 nomes e reescreveu cada um para
`[{"value":"Witch's Armaments"}]`, sem lançar.

> **Ressalva honesta, medida:** "Living Hair" também sobrevive como **rótulo**
> de uma das três opções literais do ChoiceSet de `Witch's Armaments`
> (`rollOption: "witchs-armaments"`, valores `nails`/`teeth`/`hair`, cada um
> habilitando um rule `Strike` diferente). O rename torna a aresta resolúvel,
> mas fica **mais permissivo que o RAW**: quem pegou Witch's Armaments com
> Eldritch Nails passa a satisfazer um pré-requisito que exigia a opção do
> cabelo. O predicado exato seria sobre a **seleção dentro do outro feat**
> (`witchs-armaments:hair`), que nenhum consumidor sabe ler hoje. Foi escolhido
> o alvo que o **próprio vendor prescreve** na tabela do remaster, em vez de
> inventar predicado (REQ-BC-034).

**(b) `"Cauldron"` × 2 — verificação negativa: NÃO precisa de fix.** `Witch's
Bottle` (L8) e `Double, Double` (L10) citam "Cauldron", e a tabela tem uma linha
com esse nome — mas o status é **"Altered mechanics"** com alvo `—`: a mecânica
mudou, o **nome não**. `Cauldron` (`zUtdBd3IbM7UX0AD`, ORC, Player Core, L1)
está no conjunto dos 53 e a aresta já resolve internamente.

**Verificação negativa para as outras três linhas:** nenhum dos 53 feats cita
`Eldritch Nails`, `Hex Wellspring` ou `Temporary Potions` em pré-requisito, e
**nenhum dos 53 carrega** um nome que a tabela marque como renomeado ou removido
(a única linha que casa por nome é a do próprio `Cauldron`, que manteve o nome).

**Bônus:** a linha `Witch Patron Themes | Replaced` **explica o doc órfão**
`Patron Theme` (`nocYmxbi4rqCC2qS`, L1, trait witch, sem rules e sem otherTags)
apontado em §5 — é o resíduo pré-remaster do mecanismo de patron. Deixá-lo fora
do pack é o certo, não uma omissão.

### 7.2 Counterspell — e uma correção a um registro existente

`Reflect Spell` (L14, compartilhado sorcerer+witch+wizard) declara
`prerequisites.value = "Counterspell"`, mas o doc do conjunto da Witch chama-se
**`Counterspell (Prepared)`** (`EpBG4CFMNSZQx7vI`, traits `[witch, wizard]`, já
em `feats-core` desde a r22 pelo Wizard).

**`sorcerer.json` está errado sobre isso.** Ele registra: *"o nó correto
depende de qual classe concedeu o Counterspell ao personagem (Spontaneous para
Sorcerer/**Witch**, Prepared para Wizard)"*. Medido: o **único** Counterspell no
conjunto de 53 feats da Witch é o **(Prepared)**; `Counterspell (Spontaneous)`
(`deoHKUzpzT7iwWhL`) tem trait `sorcerer` e não alcança a Witch.

`prerequisiteFixes` continua **vazio de propósito**: `Reflect Spell` é um doc
compartilhado já no pack, e o alvo certo do rename depende da classe que
concedeu o Counterspell (Prepared para Witch/Wizard, Spontaneous para
Sorcerer). Um fix escrito aqui reescreveria a prosa de um doc que a curadoria
do Wizard e a do Sorcerer também governam. É a mesma decisão do `wizard.json`
(registrou o caso, não aplicou fix).

---

## 8. Preparação para multiclasse (§4 do plano)

- Gate derivado dos 53 class feats: trait `witch` + `category:"class"` →
  `{"class_level": {"witch": {">=": N}}}`, N = nível do arquivo do feat
  (medido: `system.level.value` == nível da pasta nos 53, sem exceção).
- **Ambiguidade em 15 dos 53** — feats com trait de duas ou mais classes:

  | Nível | Feat | Classes no trait |
  | --- | --- | --- |
  | 1 | Counterspell (Prepared) | witch, wizard |
  | 1 | Reach Spell | bard, cleric, druid, oracle, sorcerer, witch, wizard |
  | 1 | Widen Spell | druid, oracle, sorcerer, witch, wizard |
  | 2 | Cantrip Expansion | bard, cleric, magus, oracle, psychic, sorcerer, witch, wizard |
  | 2 | Conceal Spell | animist, witch, wizard |
  | 2 | Enhanced Familiar | animist, druid, magus, sorcerer, thaumaturge, witch, wizard |
  | 6 | Detonating Spell | cleric, oracle, sorcerer, witch, wizard |
  | 6 | Divine Emissary | sorcerer, witch |
  | 6 | Steady Spellcasting | bard, cleric, druid, oracle, psychic, sorcerer, witch, wizard |
  | 8 | Chaotic Spell | bard, oracle, sorcerer, witch, wizard |
  | 8 | Helt's Spelldance | bard, sorcerer, witch, wizard |
  | 8 | **Incredible Familiar** | thaumaturge, witch |
  | 10 | Quickened Casting | bard, oracle, sorcerer, witch, wizard |
  | 14 | Reflect Spell | sorcerer, witch, wizard |
  | 16 | Effortless Concentration | bard, druid, sorcerer, summoner, witch, wizard |

  14 dos 15 já estão em `feats-core`, reusados de Wizard/Sorcerer/Bard/Cleric.
  **`Incredible Familiar` é o 15º e entra agora** — não estava. O predicado
  correto para os 15 é `any` sobre as classes do trait, nunca uma escolha
  arbitrária (mesmo padrão já registrado em `wizard.json`, `cleric.json`,
  `sorcerer.json` e `druid.json`).
- Sem ambiguidade em 38 dos 53. Nenhum feat com trait `archetype` no conjunto.

---

## 9. Conjuração e hexes

### 9.1 A tradição depende do patron — o achado central desta classe

O doc de classe tem `system.spellcasting = 1` e **nenhum campo de tradição**. A
feature `Witch Spellcasting` tem `rules: []` e `subfeatures: null` — não carrega
nada; a prosa dela diz literalmente *"you can cast spells of your patron's
tradition"*.

Quem define a tradição é **cada um dos 16 patrons**, por:

```json
{ "key": "ActiveEffectLike", "mode": "override", "priority": 39,
  "path": "system.proficiencies.aliases.witch", "value": "occult" }
```

Distribuição medida: occult 6, primal 6, divine 3, arcane 1 (tabela em §5).

**O atributo NÃO varia.** A hipótese de trabalho da rodada ("cada patron define
tradição **e atributo** de conjuração") está **refutada**: `keyAbility` do
vendor é `["int"]`, e a varredura das rules dos 16 patrons por qualquer path que
toque `system.abilities` / `keyAbility` / `attribute` / `spellcasting.*.ability`
devolveu **zero**. As três fichas da Feiya trazem `ability: "int"` nas duas
`spellcastingEntry`.

**Detalhe de pipeline:** o path `system.proficiencies.aliases.witch` **não** casa
com nenhum padrão de `PROFICIENCY_PATHS`, então `statFromRulePath` devolve
`null` e o rule é descartado sem nem entrar em `ignoredRules` (é o caminho "não
é proficiência: fora do escopo"). Ou seja: **a tradição é jogada fora pelo
pipeline de proficiências** — é exatamente por isso que o mapa por patron tem de
viajar pela curadoria.

### 9.2 Como isso foi declarado — e por que é pergunta, não decisão fechada

`ClassSpellcastingSchema` já aceita `tradition: null` + um mapa
`traditionByBloodline` (opção de eixo → tradição), criado na r22 para o
Sorcerer. É o **único canal que sobrevive ao pipeline**: `spellcastingFor()` em
`transform.mjs` propaga `tradition`, `type`, `ability`, a tabela e —
nominalmente — `traditionByBloodline`; **qualquer outra chave dentro de
`spellcasting` é descartada em silêncio** (e `validateClassCuration` não valida o
interior de `spellcasting`, então um nome de campo inventado sairia como pack
silenciosamente sem tradição).

Por isso o mapa dos 16 patrons foi escrito nesse campo, com as chaves em
**minúsculas do nome exibido** do patron — exatamente o que
`bloodlineSlugFromDocName()` do `planVM.ts` produz (`replace(/^Bloodline:\s*/)` +
`toLowerCase()`; nome de patron não tem o prefixo). **Nenhuma tradição
arbitrária foi escolhida: `tradition` é `null`.**

O que falta, e é decisão da integração central (arquivos compartilhados):

1. **O nome do campo mente para a Witch** — "bloodline" não existe aqui. O certo
   é renomear para algo como `traditionByAxisOption` (com alias de
   compatibilidade), tocando `systems/pf2e/src/schemas/item-equipment.ts`,
   `transform.mjs` e `planVM.ts`.
2. **`planVM.ts` linha ~4099** dispara `bloodlineSpellcastingOps()` apenas
   quando `slotType === "bloodline"`. Com `slotType: "patron"` a Witch **não
   ganha entrada de conjuração nenhuma**. É falha visível (a ficha fica sem
   magia), não valor errado — mas é falha.
3. **`resolveBloodlineTradition()` cai em `"arcane"`** quando não acha a chave —
   default que, para a Witch, estaria errado em **15 dos 16** patrons.

### 9.3 Tabela de conjuração — três fontes independentes, zero divergência

Transcrita **célula a célula** por parse do HTML: `journals/classes.json`, entry
`kzxu2dI7tFxv6Ix6`, página `fYJruhQfzs4dj0mp` ("Witch"), **segunda** tabela da
página (12 colunas × 20 linhas + rodapé).

Conjuradora **plena preparada**: 5 truques do nível 1 ao 20, 3 slots por rank
(nunca 2, ao contrário do Psychic). Célula a célula **idêntica** à do Cleric e à
do Druid — o esperado para conjuradora plena preparada do remaster, e mais uma
conferência cruzada de graça. Níveis 1–3 explícitos: L1 = 5 truques + 2 slots de
rank 1; L2 = 5 + 3; L3 = 5 + 3 de rank 1 + 2 de rank 2. O rank 10 dos níveis
19–20 (`1*`) vem da class feature de nível 19, não da progressão normal — mesmo
padrão do Primal Hierophant e do Miraculous Spell.

**Conferência independente (a) — fichas pregen da icônica.** A icônica foi
descoberta lendo o item `type: "class"` de cada ator de `iconics/**`, não pelo
nome: **Feiya**, com fichas nos níveis 1, 3 e 5.

| Nível | Journal (truques / slots) | Feiya (`system.slots`) | Bate? |
| --- | --- | --- | --- |
| 1 | 5 / 1:2 | `slot0.max=5`, `slot1.max=2` | sim |
| 3 | 5 / 1:3, 2:2 | `slot0=5`, `slot1=3`, `slot2=2` | sim |
| 5 | 5 / 1:3, 2:3, 3:2 | `slot0=5`, `slot1=3`, `slot2=3`, `slot3=2` | sim |

As três fichas também confirmam `prepared: "prepared"`, `ability: "int"`,
`hp: 6`, `keyAbility: ["int"]` — e, decisivamente, `tradition: "occult"`
casando com o patron dela, **The Resentment** (occult). É a prova empírica do
mecanismo patron→tradição.

**Conferência independente (b) — Waybuilder** (`wb:class/witch`, base local com
20 083 registros): `slots_per_level` bate nos **20 níveis**, inclusive o `1*` de
rank 10 preservado em `ranks_raw`. E ele descreve o campo de tradição como
*"variavel (definida pela escolha de patron; nao ha tradicao fixa na
class-feature)"* — terceira fonte confirmando o achado central.

**Três divergências do Waybuilder, todas a favor do vendor** (família da issue
#10 dele, "eixos tortos em 11 de 27 classes"):

1. A `progressao` dele **omite** `hex-spells` no nível 1 (lista só
   familiar-witch, patron e witch-spellcasting, quando o `items{}` tem quatro
   features de nível 1) e **inventa** `lesson-of-elements` como concessão
   automática de nível 2 — lição é escolha comprada com talento, não grant.
2. `subclasses` declara **um** eixo `lesson` (nível 2, escolhe 1, 19 opções),
   achatando os três degraus Basic/Greater/Major, e **não declara o eixo
   patron** — que é a subclasse de verdade da Witch.
3. O array de opções de lição tem 19 entradas, mas uma é
   `wb:lesson/lesson-of-the-elements`, duplicata de *kind* diferente de
   `wb:class-feature/lesson-of-elements` (ele mesmo a marca como
   `so_catalogo`).

**Divergência dentro do próprio journal (de nome, não de número):** o rodapé da
tabela atribui o slot de rank 10 à class feature *"patron conduit"*. Não existe
nenhum doc com esse nome em `class-features/`; a feature de nível 19 do
`items{}` é **`Patron's Gift`** (`cDnFXfl3i5Z2l7JP`), e é a linha 19 da
**primeira** tabela da mesma página que a nomeia corretamente. O **valor** (1 no
rank 10 nos níveis 19–20) é idêntico nas três fontes.

### 9.4 Hexes — 39, e um defeito de seleção de pack

As magias com trait `witch` são **39**, **todas** com trait `hex`, **todas** em
`spells/focus/`. Delas, **22 já estão em `spells-core`** e **17 não**.

**A causa medida:** as 22 presentes carregam também o trait `focus`; as 17
ausentes carregam **`cantrip` no lugar de `focus`**, e o predicado
`hasTrait(doc, "focus")` de `isSpellsCoreDoc` não as vê.

É **exatamente** o defeito dos "composition cantrips" do Bard, que a r22 fechou
acrescentando um ramo `hasTrait(doc, "composition")` a `isSpellsCoreDoc`. O ramo
equivalente aqui é **`hasTrait(doc, "hex")`** — superconjunto estrito dos 22 já
capturados, então nenhum doc dobra. `build-mvp-subset.mjs` é arquivo
compartilhado: **isto é achado, não edição** (§2 do plano).

As 17 ausentes: Buzzing Bites, Clinging Ice, Discern Secrets, Evil Eye,
Information Overload, Manifest Will, Murmuration, Nudge Fate, Pact Broker,
Scrounger's Glee, Share Vision, Shroud of Night, Spirit Object, Sting of the
Sea, Stoke the Heart, Trade Death for Life, Wilding Word.

**Recorte perfeito, e é o que dói:** **16 das 17 são exatamente o hex inicial de
cada um dos 16 patrons** (medido cruzando o `@UUID` de spell citado na descrição
de cada patron com o pack). A 17ª é `Manifest Will`, do arquétipo de classe
Seneschal (War of Immortals), fora desta curadoria. Ou seja: as **19 lições**
têm 100% dos seus hexes no pack; os **16 patrons**, 0%. E a ficha oficial da
Feiya nível 1 tem `Evil Eye`, que é um dos 16.

As 22 presentes = 19 hexes de lição + `Cackle` (do talento homônimo) +
`Phase Familiar` + `Patron's Puppet` (os dois citados pela feature `Hex Spells`).

### 9.5 Vínculo opção → hex: não existe como dado

Os **19 docs de lição têm `rules: []`** — zero `GrantItem`, zero regra de
qualquer tipo. Os **16 patrons não têm `GrantItem`** nenhum. O vínculo só existe
na **prosa**: a descrição de cada lição/patron cita o hex por `@UUID`. Extraído
dessas descrições:

**Patron → hex inicial:** Baba Yaga→Spirit Object · Choir Politic→Share Vision ·
Cobyslarni→Information Overload · Devourer of Decay→Scrounger's Glee · Faith's
Flamekeeper→Stoke the Heart · Mosquito Witch→Buzzing Bites · Paradox of
Opposites→Trade Death for Life · Ripple in the Deep→Sting of the Sea · Silence in
Snow→Clinging Ice · Spinner of Threads→Nudge Fate · Starless Shadow→Shroud of
Night · The Inscribed One→Discern Secrets · The Resentment→Evil Eye · The Unseen
Broker→Pact Broker · Whisper of Wings→Murmuration · Wilding Steward→Wilding Word.

**Lição → hex:** Calamity→Stumbling Curse · Dreams→Veil of Dreams →
Elements→Elemental Betrayal · Life→Life Boost · Protection→Blood Ward ·
Vengeance→Needle of Vengeance · Decay→Mycological Malady · Favors→Return the
Favor · Memory→Unravel Knowledge · Mischief→Deceiver's Cloak · Shadow→Malicious
Shadow · Snow→Personal Blizzard · the Flock→Sheltering Wings · the Shark→Blood in
the Water · Vows→Censure Falsehoods · Bargains→Over the Coals · Death→Curse of
Death · Renewal→Restorative Moment · the Frozen Queen→Glacial Heart.

Cada lição/patron concede **ainda** uma magia comum para a lista da Witch (ex.:
Calamity→Ill Omen, Baba Yaga→Chilling Spray) — também só na prosa. Mesma lacuna
que `cleric.json` (domínio→magia de domínio) e `druid.json` (ordem→magia de foco)
registraram. **Dívida declarada.**

---

## 10. Tabela esperada de `proficiencyUpgrades`

Derivada rodando `deriveProficiencyUpgrades` (importada de
`curation/proficiency-upgrades.mjs`, módulo puro) sobre os docs do vendor, com o
`items{}` da Witch como fonte de nível. Resultado: **10 linhas**, `missing: []`,
`ignoredRules: []`. **Nenhum `proficiencyUpgradeExtras` foi necessário** — a
derivação genérica cobre a classe inteira (como no Druid; ao contrário de Cleric
e Gunslinger).

| level | stat | rank | origem |
| --- | --- | --- | --- |
| 5 | fortitude | 2 | Magical Fortitude |
| 7 | spellcasting | 2 | Expert Spellcaster |
| 9 | reflex | 2 | Reflex Expertise (arquivo genérico diz 3) |
| 11 | perception | 2 | Perception Expertise (arquivo genérico diz 3) |
| 11 | weapons.simple | 2 | Weapon Expertise (arquivo genérico diz 5) |
| 11 | weapons.unarmed | 2 | Weapon Expertise |
| 13 | armor.unarmored | 2 | Defensive Robes |
| 15 | spellcasting | 3 | Master Spellcaster |
| 17 | will | 3 | Will of the Pupil |
| 19 | spellcasting | 4 | Legendary Spellcaster |

Não produzem linha: **Weapon Specialization** (bônus de dano, `subfeatures:
null` — mesma observação de Wizard/Sorcerer/Druid), **Witch Spellcasting**, **Hex
Spells**, **Patron**, **Familiar (Witch)** e **Patron's Gift** (slot especial de
rank 10).

Perfil resultante: a Witch nunca chega a *legendary* em nada exceto conjuração;
para em **expert** em armadura (só `unarmored`, nível 13) e em armas
(simples/desarmado, nível 11), e em **master** em Will (nível 17). `classDC`
nunca sobe de treinado — o journal confirma ("Trained in witch class DC", sem
upgrade em nível nenhum) e nenhuma das 15 features carrega chave de subfeature
igual ao slug `witch`.

---

## 11. Riscos, dívidas e decisões

### Decisões tomadas nesta curadoria

1. **Dois eixos, não três.** `witch-elementalist-patron` descartado como eixo,
   com dois argumentos medidos (§5) — inclusive a prova de que declará-lo
   reprovaria `transform.test.mjs`.
2. **`tradition: null` + mapa por patron.** Nenhuma tradição arbitrária
   escolhida. O mapa viaja no único campo que o pipeline propaga
   (`traditionByBloodline`), com as chaves no formato exato que o `planVM` já
   produz — e o nome errado do campo virou pergunta aberta, não silêncio (§9.2).
3. **`featureNameInItemsMap: "Basic Lesson"`** para o eixo de lição, por falta de
   entrada no `items{}`. Impacto do campo medido antes de decidir (só rótulo de
   pré-requisito em `grafo-de-feats.mjs`).
4. **4 `prerequisiteFixes` de `kind: "rename"`** para `"Living Hair"` →
   `"Witch's Armaments"`, com a linha do journal de remaster como fonte, e a
   ressalva de permissividade registrada (§7.1). **Nenhum fix para
   `"Counterspell"`**: o rename seria correto para a Witch, mas o doc é
   compartilhado e o alvo varia por classe — mesma decisão do `wizard.json`.
5. **`excludeNames: []` e `extraNames: []`.** Nenhum feat de arquétipo no
   conjunto; `Witch Dedication` deliberadamente fora (classe pura).
6. **Nenhuma lista de 53 nomes hardcoded** (R3): a seleção fica por predicado
   (trait + category).

### Dívidas declaradas

- **Perícia do patron** não é modelada. O journal dá "Trained in one skill
  determined by your patron" **além** das 3+Int, e cada patron carrega o
  `ActiveEffectLike` que a concede (medido, um a um). `trainedSkills.additional`
  continua 3 (é o número certo). **Quarta classe** a pedir a mesma extensão de
  contrato — depois de Cleric (doutrina), Gunslinger (way) e Druid (ordem).
- **Vínculo opção → hex inicial / magia extra** (§9.5): só existe na prosa.
- **17 hexes fora do pack** (§9.4), 16 deles os hexes iniciais dos patrons.
  Fechável com uma linha em `build-mvp-subset.mjs`, que é arquivo compartilhado.
- **Familiar** — dívida **menor** do que se supunha. `familiar-abilities-core`
  está **completo** (111/111) e os feats `Pet` e `Familiar` já estão em
  `feats-core` (`Pet` é justamente o `GrantItem` de `Familiar (Witch)`; a Feiya
  nível 5 confirma que ela o tem). Falta (a) o familiar como **ator** (não existe
  pack de pets no Fusion) e (b) a fórmula
  `system.attributes.familiarAbilities.value = "2 + min(3,floor(@actor.level / 6))"`
  — valor **não literal**, que nenhuma derivação atual lê. Existe `petsVM.ts` no
  client, então a fronteira é onde parar. **6 dos 53 talentos** dependem disso
  para ter efeito (Familiar's Language, Improved Familiar (Witch), Spirit
  Familiar (Witch), Stitched Familiar, Incredible Familiar, Familiar's Eyes).
- **`Seneschal`** (class archetype) e **`Patron Theme`** ficam fora do pack — é
  o comportamento correto, registrado para que ninguém os "conserte" depois.

### Rebuild — atenção obrigatória

As 16 opções de patron e as 19 de lição entram em `class-features-core`
**apenas** pelo ramo `axisCategories.has(doc.system.category)` de
`isClassFeaturesCoreDoc` — nenhuma está no `items{}`. E `system.category` só
vira `patron`/`lesson` quando `transform.mjs` roda **com esta curadoria no
disco**. Logo **não basta** rodar `build-mvp-subset.mjs` sobre um `out/` antigo:
é obrigatório reprocessar o transform com `classes` **e** `class-features` no
**mesmo** `--packs`, senão os eixos saem com 0 opções e `transform.test.mjs`
reprova em "eixo sem nenhuma opção no pack".

### Gate acionado

`pregen-parity.test.ts` filtra os ícones pelas classes de `classes-core` — e o
comentário do arquivo cita a Witch nominalmente como excluída hoje. Publicar a
classe traz a **Feiya** (níveis 1/3/5) para dentro do gate da issue #48:
verificação externa de graça, e é ela que prova esta curadoria.

Pelo que foi medido, **nada precisa nascer em `KNOWN_DIVERGENCES`**:
`attacks.other` é placeholder vazio (descartado por `isMeaningfulChassisEntry`,
como no Druid), e `hp`/`perception`/saves/attacks/defenses/`keyAbility` batem
campo a campo com a ficha. A asserção `CLASSES_WITHOUT_PREGEN === ["Magus"]`
continua valendo, porque a Witch **tem** pregen.

---

## 12. Divergências contra a medição preliminar do orquestrador

| Item | Preliminar | Medido | Veredito |
| --- | --- | --- | --- |
| hp / atributo-chave | 6 / int | 6 / int | **confirma** |
| features no `items{}` | 15 (9 já nos packs) | 15 (9 já nos packs) | **confirma** |
| class feats | 53 (38 + 15), 14 em `feats-core` | 53 (38 + 15), 14 em `feats-core` | **confirma** |
| eixos | **3** (patron 16, elementalist-patron 7, lesson 19) | **2** — elementalist-patron é subconjunto de patron, com zero consumidores no vendor | **REFUTA** |
| magias com trait witch | 39, 22 no pack, ~17 faltando | 39, 22 no pack, **17** faltando (exatos) | **confirma e fecha o número** |
| "cada patron define tradição **e atributo**" | hipótese do briefing | tradição **sim**; atributo **não** (`int` para todos, zero rules tocando atributo) | **REFUTA metade** |
| "lesson é escolha repetível por nível" | hipótese do briefing | repetível **sim**, mas por **talento de classe** (Basic/Greater/Major), não por nível automático — e **sem concessora no `items{}`** | **precisa** |
| "familiar provavelmente vira dívida" | hipótese do briefing | dívida **menor**: `familiar-abilities-core` 111/111 completo, `Pet`/`Familiar` já em `feats-core`; falta só o ator e a fórmula | **reduz** |
| "Witch é a mais afetada pela tabela do remaster: 6 entradas" (insumo tardio do orquestrador) | 6 linhas, uma delas `Living Hair → Merged → Witch's Armaments` | 6 linhas confirmadas; interseção com os pré-requisitos em **2 nomes / 6 ocorrências**: `Living Hair` (4× → 4 `prerequisiteFixes`) e `Cauldron` (2× → **não** precisa de fix, o nome não mudou) | **confirma e fecha** |

---

## 13. Perguntas em aberto para a integração central

1. **Tradição por opção de eixo — nome do campo.** O mapa por patron está em
   `spellcasting.traditionByBloodline` porque é o **único** canal que
   `spellcastingFor()` propaga. Renomear para `traditionByAxisOption` (com alias)
   em `item-equipment.ts` + `transform.mjs` + `planVM.ts`, ou manter o nome do
   Sorcerer e documentar? *(Sem decisão, a Witch fica com um campo cujo nome
   mente.)*
2. **`bloodlineSpellcastingOps` só dispara em `slotType === "bloodline"`**
   (`planVM.ts` ~4099). Generalizar para "qualquer eixo que resolva tradição", ou
   acrescentar `"patron"` na condição? *(Sem isso, a Witch não ganha entrada de
   conjuração nenhuma — o pack fica certo e a ficha, vazia.)* E
   `resolveBloodlineTradition()` cai em `"arcane"` por default, errado em 15 dos
   16 patrons.
3. **Eixo cuja concessora é um FEAT, não uma feature do `items{}`.** É o primeiro
   caso em 16 classes. O contrato precisa crescer — sugestão: trocar
   `featureNameInItemsMap` por `grantedByName` + `grantedByKind:
   "classFeature" | "feat"`, e permitir uma lista de concessoras com filtro de
   nível por degrau (Basic 6 opções / Greater 15 / Major 19). Enquanto isso o
   campo está preenchido com `"Basic Lesson"`.
4. **`isSpellsCoreDoc` perde os 17 hexes-cantrip.** Acrescentar
   `if (hasTrait(doc, "hex")) return true;` — superconjunto estrito dos 22 já
   capturados, mesmo padrão do ramo `composition` da r22. Sem isso, 16 dos 16
   patrons entram com o hex inicial faltando e a Feiya (nível 1) referencia uma
   magia que não existe no pack.
5. **Perícia por opção de eixo** (§11) — quarta classe a pedir. Vale abrir o
   contrato de uma vez para Cleric/Gunslinger/Druid/Witch juntos?
6. **`sorcerer.json` tem uma afirmação errada** sobre o Counterspell da Witch
   (diz Spontaneous; é Prepared, `EpBG4CFMNSZQx7vI`). Corrigir a nota lá é
   edição em arquivo de outra classe — reportado, não feito.
7. **`choiceSetInventory.ts`** vai precisar de entradas novas quando a Witch
   entrar. Pelo que foi medido, no mínimo:
   `class-features-core/Patron/patron` (candidato a `"eixo"`, se a pergunta 2 for
   resolvida — senão `"pendente"`), a família de lição pelos três feats
   (`feats-core/Basic Lesson/lesson`, `Greater Lesson`, `Major Lesson`) e
   `feats-core/Witch's Armaments/witchs-armaments` (ChoiceSet de três opções
   literais com rules `Strike`, mesma forma do `Voice of Nature` do Druid —
   `pendente`, porque `GRANTED_FEAT_FILTERS` só sabe filtro por predicado).
8. **`Witch Dedication`** ficou fora (classe pura). Se algum dia entrar,
   precisará de `classFeats.extraNames` — que hoje é validado e **nunca lido**
   pelo consumidor, defeito latente já apontado pelo `psychic.json`.
