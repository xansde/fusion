# r29 — Thaumaturge — relatório de curadoria

Arquivo de configuração produzido: `tools/importer-pf2e/src/curation/classes/thaumaturge.json`.

## 1. Método (comandos rodados)

Todas as contagens vieram de scripts `node -e` (Node 22, sem dependências) rodados
contra `tools/importer-pf2e/vendor/pf2e/packs/pf2e/` (fonte, somente leitura) e
`systems/pf2e/packs/*/documents.json` (packs atuais do Fusion), nesta sessão, no
diretório da worktree. Nenhum arquivo compartilhado foi tocado; nenhum `git`,
`pnpm` ou importer foi rodado. Os scripts descartáveis não foram persistidos (só
o `node -e` inline); os comandos relevantes, reconstruíveis a partir deste
relatório:

- Leitura direta de `classes/thaumaturge.json` do vendor (`system.items`, `hp`,
  `keyAbility`, `perception`, `savingThrows`, `attacks`, `defenses`, os quatro
  `*FeatLevels`, `skillIncreaseLevels`, `trainedSkills`, `spellcasting`,
  `classDC in system`).
- Varredura de `system.items` (24 entradas) comparando `entry.name` com o
  segmento final de `entry.uuid` — 0 divergências.
- Para cada uma das 24 entradas: leitura do arquivo genérico correspondente em
  `class-features/<slug>.json` e comparação `system.level.value` (genérico) ×
  `level` do `items{}` — 2 divergências (Perception Mastery, Medium Armor
  Mastery).
- Varredura das 27 pastas de `classes/*.json` do vendor, união dos nomes
  canônicos de `items{}` de cada uma, para achar quais das 24 features do
  Thaumaturge são compartilhadas com outras classes.
- Leitura de `systems/pf2e/packs/class-features-core/documents.json` (318 docs)
  e cruzamento por `flags.fusion.sourceId` contra o `_id` de cada um dos 24
  arquivos genéricos do vendor.
- Grep recursivo por `"thaumaturge-implement"` em `class-features/**` (13
  arquivos: os 10 docs de implemento + 3 falsos-positivos por causa do texto do
  filtro `item:tag:thaumaturge-implement` dentro do `ChoiceSet` dos 3 nós de
  concessão) e varredura completa de `otherTags` com prefixo `thaumaturge` nos
  827 arquivos de `class-features/` — confirma que só existe UM eixo.
- Leitura direta dos 10 arquivos de implemento (`amulet.json` .. `weapon.json`)
  e dos 3 nós de concessão (`first-implement-and-esoterica.json`,
  `second-implement.json`, `third-implement.json`) — `level`, `category`,
  `otherTags`, `rules[]` completos.
- Leitura direta dos 30 arquivos `initiate-benefit-*.json` /
  `adept-benefit-*.json` / `paragon-benefit-*.json` e cruzamento dos 30 `_id`
  contra `class-features-core` por `sourceId` — 0/30 presentes.
- Varredura recursiva de `feats/class/thaumaturge/level-*/` (38 arquivos) e de
  `feats/class/shared-class-feats/level-*/` (113 arquivos, filtrados para os 4
  com trait `thaumaturge`) — a pasta `shared-class-feats` é subdividida por
  nível (mesma armadilha documentada no relatório do Fighter).
- Leitura de `systems/pf2e/packs/feats-core/documents.json` (2205 docs) e
  cruzamento por `sourceId` dos 4 candidatos compartilhados — 3/4 presentes.
- Varredura de `system.prerequisites.value` dos 42 candidatos (22 não-vazios) e
  classificação de cada texto (documento interno / externo / não-mecanizável).
- Leitura de `tools/importer-pf2e/vendor/pf2e/packs/pf2e/spells/**` (1797
  arquivos) filtrando trait `thaumaturge` — 0.
- Leitura de `packs/iconics/mios/mios-level-{1,3,5}.json` (o iconic do
  Thaumaturge — identificado por `items.find(it=>it.type==='class').name`)
  para conferência independente (não-circular).
- Leitura de `tools/importer-pf2e/src/curation/index.mjs`
  (`validateClassCuration`, `axisCategoryByOtherTag`, `axisLevelByOtherTag`) e
  de `tools/importer-pf2e/src/transform.mjs` (linhas ~1471–1545 e ~2035, a
  normalização de class-features e o default de `classDC`) e de
  `tools/importer-pf2e/src/__tests__/transform.test.mjs` (linhas ~590–638, o
  teste de cobertura/optionCount por eixo) — só leitura, para avaliar se
  repetir o mesmo `otherTag` em 3 entradas de `choiceAxes` é seguro.
- Leitura de `tools/importer-pf2e/src/curation/classes/champion.json` e
  `magus.json` para checar se o achado sobre `weapon-expertise.json` já era
  conhecido (era).
- Validação final: `node --input-type=module -e "import {validateClassCuration}
  ..."` (comando do §5 do PLANO.md) — saída colada na seção 11.

## 2. Doc da classe (medido)

| Campo               | Valor                                                                |
| -------------------- | --------------------------------------------------------------------- |
| hp                  | **8**                                                                 |
| keyAbility          | `["cha"]` (opção única, sem par tipo dex/str do Fighter/Exemplar)     |
| perception          | 2 (expert em nível 1)                                                |
| savingThrows        | fortitude 2 (expert), reflex 1 (trained), will 2 (expert)            |
| attacks             | simple 1, martial 1, unarmed 1 (trained), advanced 0                 |
| defenses            | light 1, medium 1, unarmored 1 (trained), heavy 0                    |
| ancestryFeatLevels  | 1, 5, 9, 13, 17                                                       |
| classFeatLevels     | 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20                                 |
| generalFeatLevels   | 3, 7, 11, 15, 19                                                      |
| skillFeatLevels     | 2, 4, 6, 8, 10, 12, 14, 16, 18, 20                                    |
| skillIncreaseLevels | 3, 5, 7, 9, 11, 13, 15, 17, 19                                        |
| trainedSkills       | `value: ["arcana","nature","occultism","religion"]`, `additional: 3`, `custom: "Esoteric Lore"` |
| spellcasting        | `0` (sem conjuração)                                                  |
| classDC (no doc)    | **ausente** (`'classDC' in system` → `false`, igual ao Fighter)       |

**Confirma a medição preliminar**: hp 8, atributo-chave cha. O campo
`trainedSkills.custom` é exclusivo do Thaumaturge entre as classes já lidas
nesta rodada — é a perícia Lore fixa concedida por "Esoteric Lore" (L1).

### `items{}` — 24 entradas, nome canônico = segmento final da uuid

**Confirma 24 features (8 já nos packs), como a medição preliminar previu.**
0/24 divergências entre `entry.name` e a uuid tail (sem a armadilha do Magus).

| Nível (`items{}`) | Feature                       | Nível genérico do arquivo | Divergência? |
| ------------------ | ------------------------------ | -------------------------- | ------------- |
| 1                  | Esoteric Lore                  | 1                          | não          |
| 1                  | Exploit Vulnerability          | 1                          | não          |
| 1                  | First Implement and Esoterica | 1                          | não          |
| 1                  | Implement's Empowerment       | 1                          | não          |
| 3                  | Reflex Expertise               | 3                          | não          |
| 5                  | Second Implement                | 5                          | não          |
| 5                  | Weapon Expertise                | 5                          | não          |
| 7                  | Disciplined Mind                | 7                          | não          |
| 7                  | Implement Adept                 | 7                          | não          |
| 7                  | Weapon Specialization           | 7                          | não          |
| 9                  | Intensify Vulnerability         | 9                          | não          |
| 9                  | Perception Mastery              | **7**                      | **SIM**      |
| 9                  | Thaumaturgic Expertise          | 9                          | não          |
| 11                 | Medium Armor Expertise          | 11                         | não          |
| 11                 | Second Adept                    | 11                         | não          |
| 13                 | Perfected Mind                  | 13                         | não          |
| 13                 | Weapon Mastery                  | 13                         | não          |
| 15                 | Earned Resilience               | 15                         | não          |
| 15                 | Greater Weapon Specialization   | 15                         | não          |
| 15                 | Third Implement                 | 15                         | não          |
| 17                 | Implement Paragon               | 17                         | não          |
| 17                 | Thaumaturgic Mastery            | 17                         | não          |
| 19                 | Medium Armor Mastery            | **17**                     | **SIM**      |
| 19                 | Unlimited Esoterica             | 19                         | não          |

Duas divergências, mesma família da armadilha já vista no Fighter (Armor
Expertise/Armor Mastery) e no Champion (Reflex/Perception Expertise): Perception
Mastery (genérico 7 → usar 9) e Medium Armor Mastery (genérico 17 → usar 19).
Registradas em `dedupe.collisionsDetected`.

## 3. Features compartilhadas com outras classes (união de `items{}` das 27 classes)

8 das 24 features do Thaumaturge aparecem em `items{}` de outras classes:

| Feature                       | Nº classes | Classes (amostra)                                                                 |
| ------------------------------ | ---------- | ------------------------------------------------------------------------------------ |
| Weapon Specialization          | 25         | quase todas                                                                          |
| Weapon Expertise                | 14         | Champion, Druid, Exemplar, Guardian, Investigator, Kineticist, Magus, Oracle, Psychic, Sorcerer, Thaumaturge, Witch, Wizard |
| Greater Weapon Specialization  | 13         | Champion, Commander, Fighter, Guardian, Gunslinger, Inventor, Investigator, Magus, Monk, Ranger, Rogue, Swashbuckler, Thaumaturge |
| Reflex Expertise                | 12         | Barbarian, Bard, Champion, Cleric, Druid, Guardian, Inventor, Magus, Sorcerer, Thaumaturge, Witch, Wizard |
| Perception Mastery               | 10         | Barbarian, Bard, Commander, Exemplar, Gunslinger, Investigator, Ranger, Rogue, Swashbuckler, Thaumaturge |
| Medium Armor Expertise          | 7          | Alchemist, Barbarian, Druid, Gunslinger, Magus, Ranger, Thaumaturge                 |
| Medium Armor Mastery            | 6          | Alchemist, Gunslinger, Inventor, Magus, Ranger, Thaumaturge                          |
| Weapon Mastery                  | 5          | Barbarian, Commander, Guardian, Magus, Thaumaturge                                   |

As outras 16 features (Unlimited Esoterica, First Implement and Esoterica,
Second Adept, Esoteric Lore, Third Implement, Implement's Empowerment, Earned
Resilience, Implement Paragon, Intensify Vulnerability, Thaumaturgic Expertise,
Second Implement, Perfected Mind, Implement Adept, Thaumaturgic Mastery,
Exploit Vulnerability, Disciplined Mind) são exclusivas do Thaumaturge.

## 4. Já existe nos packs (`class-features-core`, 318 docs) — REUSAR

Cruzamento por `flags.fusion.sourceId` contra o `_id` do vendor — as mesmas 8
features do §3 já estão presentes e reusadas: Greater Weapon Specialization,
Medium Armor Expertise, Weapon Mastery, Weapon Expertise, Perception Mastery,
Weapon Specialization, Medium Armor Mastery, Reflex Expertise.

Faltam 16 (as exclusivas listadas acima) + os documentos que a árvore do eixo
implement precisa (§5): 10 docs de implemento + 10 "Initiate Benefit (\*)"
(trazidos via `extraNames`) + 20 "Adept/Paragon Benefit (\*)" (NÃO trazidos —
dívida, ver §10).

## 5. Eixo de sub-escolha — `thaumaturge-implement`

**Confirma o eixo único com 10 opções**, como a medição preliminar previu —
mas com uma armadilha estrutural que a medição preliminar não capturava.

- **10 opções** (Amulet, Bell, Chalice, Lantern, Mirror, Regalia, Shield,
  Tome, Wand, Weapon), todas `category="classfeature"`, `level=1`,
  `otherTags=["thaumaturge-implement"]` no vendor. 0/10 já em
  `class-features-core`.
- **A escolha é REPETÍVEL, não única de nível 1** (a armadilha citada na
  tarefa, confirmada): reabre em **3 pontos de concessão** do `items{}` —
  "First Implement and Esoterica" (L1), "Second Implement" (L5), "Third
  Implement" (L15) — os três com `system.rules[].choices.filter =
  ["item:tag:thaumaturge-implement"]` idêntico, e **nenhum exclui** implementos
  já escolhidos (sem predicate `not:feature:X`, ao contrário dos nós
  Adept/Paragon do §10).
- **`featureNameInItemsMap` casa pelo nome canônico**: as três features
  concessoras ("First Implement and Esoterica", "Second Implement", "Third
  Implement") têm `entry.name` idêntico ao segmento final da `uuid` — evidência
  já coberta pela varredura de 0/24 divergências do §2.
- **Conferência independente (iconics/mios/, não-circular)**: a ficha pregen
  oficial do Thaumaturge (Mios) prova a repetição na prática — L1 escolhe
  Lantern (`First Implement and Esoterica` + `Lantern` + `Initiate Benefit
  (Lantern)` + `Implement's Empowerment`); L5 escolhe **Weapon**, implemento
  DIFERENTE do primeiro (`Second Implement` + `Weapon` + `Initiate Benefit
  (Weapon)` + `Weapon Expertise`). Confirma: o eixo reabre no L5, dá pra
  escolher diferente do já escolhido, e cada pick auto-concede um "Initiate
  Benefit" — sem ele o pick fica mecanicamente incompleto.
- **Representação no schema**: como `choiceAxes` só aceita um `level` por
  objeto, declarei **3 entradas** com o MESMO `otherTag`, cada uma com o
  `featureNameInItemsMap`/`level` da sua concessora, `optionCount: 10`. Testei
  contra o código (leitura, não execução) que isso é seguro hoje: (a)
  `axisCategoryByOtherTag()`/`axisLevelByOtherTag()` são Maps por `otherTag` —
  as 3 entradas escrevem a mesma `category` ("implement"), sem conflito; (b)
  `axisLevelByOtherTag()` só é consultado quando o `level` bruto do doc-opção é
  `0` (mecanismo criado para as ordens zeradas do Druid) — os 10 docs de
  implemento já vêm com `level=1`, então o fallback nunca dispara e o "último
  valor escrito" no Map fica dormente; (c) `transform.test.mjs` checa
  `optionCount` por `category`, então as 3 entradas produzem 3 asserções
  redundantes mas não-conflitantes. **NENHUMA das 14 classes já curadas repete
  o mesmo `otherTag` em 2+ entradas** (Champion/Psychic/Wizard têm 2 eixos,
  mas com `otherTag` diferente cada) — é padrão inédito. Ver pergunta em
  aberto no §10.

## 6. Class feats

**Confirma 42 candidatos**, como a medição preliminar previu, com a resposta à
pergunta de qual dos 4 compartilhados falta:

- **38** exclusivos em `feats/class/thaumaturge/level-*/` (L1=6, L2=4, L4=4,
  L6=3, L8=2, L10=3, L12=4, L14=3, L16=3, L18=3, L20=3 — soma 38).
- **4** de `shared-class-feats/` com trait `thaumaturge`: Familiar (L1, +magus/
  sorcerer/wizard), Enhanced Familiar (L2, +animist/druid/magus/sorcerer/
  witch/wizard), Incredible Familiar (L8, +witch), Know-It-All (L8, +bard).
- **Total candidato: 42.** Todos `category === "class"`.
- **3 de 4 compartilhados já em `feats-core`** por `sourceId`: Familiar,
  Enhanced Familiar, Know-It-All (trazidos por Magus/Sorcerer/Wizard/Bard, já
  curados antes desta rodada). **O que falta é "Incredible Familiar"**
  (trait thaumaturge+witch) — motivo: nem Thaumaturge nem Witch estavam
  curados antes desta rodada, então nenhuma das duas classes-trait o havia
  trazido; passa a entrar agora pelo trait `thaumaturge`.

## 7. Pré-requisitos

- **22 de 42** candidatos têm `system.prerequisites.value` não vazio.
- **16 resolvem para dentro do conjunto** (14 puros + 2 mistos — Sympathetic
  Vulnerabilities e Share Weakness, que também carregam um segundo texto não-
  mecanizável): Esoteric Warden/Breached Defenses/Cursed Effigy/Trespass
  Teleportation/Sympathetic Vulnerabilities/Share Weakness → Exploit
  Vulnerability (feature); Scroll Esoterica → Scroll Thaumaturgy; Elaborate
  Scroll Esoterica → Scroll Esoterica; Grand Scroll Esoterica → Elaborate
  Scroll Esoterica; Elaborate/Grand Talisman Esoterica → Talisman Esoterica;
  Shared Warding → Esoteric Warden; Seven-Part Link → Paired Link; Ubiquitous
  Weakness → Share Weakness; Unlimited Demesne → Thaumaturge's Demesne;
  Incredible Familiar → Enhanced Familiar. Registrados em
  `prerequisites.internalChains` (16 pares).
- **1 aponta para fora do conjunto**: Know-It-All → "enigma muse" (opção de
  musa do Bard, classe não curada nesta rodada).
- **5 são puramente não-mecanizáveis** (texto preservado, sem predicado
  inventado): Enhanced Familiar → "a familiar"; Thaumaturge's Investiture →
  "Charisma +3"; Twin Weakness → "mortal weakness or personal antithesis";
  Esoteric Reflexes → "an implement that grants a reaction"; Wonder Worker →
  "legendary in Arcana, Nature, Occultism, or Religion" (disjunção entre 4
  perícias).
- **Armadilha "condicionado ao implement escolhido" — REFUTADA pelos dados**:
  medi explicitamente os 42 `prerequisites.value` e **nenhum** cita o nome de
  um implemento específico (ex.: "Wand" ou "Amulet"). Os únicos gates ligados a
  implemento (Esoteric Reflexes → "an implement that grants a reaction";
  Implement's Flight/Implement's Assault → "Requirements: holding an
  implement", no corpo da descrição, fora de `prerequisites.value`) são
  requisitos de **estado em tempo de jogo** ("estar segurando um implemento"),
  não gates de seleção do feat — não bloqueiam a ficha, só o efeito em
  combate. Nenhum feat exige um TIPO específico de implemento para ser
  escolhido.

## 8. Preparação para multiclasse

- Gate derivado para os 38 exclusivos: trait `thaumaturge` + `category:"class"`
  → `{"class_level":{"thaumaturge":{">=":N}}}`, sem ambiguidade.
- Os 4 compartilhados têm a mesma ambiguidade "any entre as classes do trait"
  já registrada em `fighter.json`/`druid.json` (não resolvida aqui,
  deliberadamente — é decisão da integração central).
- 0/42 com trait `archetype`. "Thaumaturge Dedication" não entra nesta rodada
  (fora do escopo §9 do plano).

## 9. Conjuração e focus spells

**Confirma "sem conjuração" e "0 magias"**, como a medição preliminar previu.
`system.spellcasting` do doc de classe = `0`; varredura das 1797 magias do
vendor por trait `thaumaturge` = 0 arquivos. `spellcasting: null`,
`focusSpells: {names: [], alreadyInPacks: []}`.

## 10. Riscos, dívidas e perguntas em aberto para a integração central

1. **Representação do eixo repetível** (§5): 3 entradas de `choiceAxes` com o
   mesmo `otherTag` — verifiquei que é seguro com os dados de hoje, mas é
   padrão inédito entre as 14 classes já curadas. A integração central quer
   essa representação, ou prefere estender o schema (`grantLevels: [1,5,15]`
   num único objeto de eixo)?
2. **Árvore Adept/Paragon (achado novo, além do previsto no plano)**: cada
   implemento escolhido também empurra uma entrada dinâmica em
   `flags.system.thaumaturge.adeptChoices` (via `ActiveEffectLike mode:"add"`)
   apontando para "Adept Benefit (\<Implemento\>)". As features "Implement
   Adept" (L7) e "Second Adept" (L11) — já trazidas via `items{}` — são
   `ChoiceSet`s cuja lista de opções é a STRING de caminho
   `"flags.system.thaumaturge.adeptChoices"` (não um filtro estático), e
   "Implement Paragon" (L17) lê `paragonChoices` do mesmo jeito. Os 20 docs-
   alvo (10 "Adept Benefit (\*)" + 10 "Paragon Benefit (\*)", 0/20 em packs)
   **não entraram** nesta curadoria: não há como expressar "opções calculadas
   em tempo de execução a partir de escolhas anteriores" no `choiceAxes`
   atual, e forçá-los via `extraNames` deixaria os 20 docs no pack sem
   consumidor capaz de oferecer a escolha certa. Dívida declarada — é o "miolo
   mecânico provavelmente não mecanizável agora" que o plano previu, só que a
   peça mais dura é esta árvore, não a ação Exploit Vulnerability (que é
   simples de conceder — um único `GrantItem`).
3. **Os 10 "Initiate Benefit (\*)"** FORAM incluídos via `classFeatures.
   extraNames` (diferente da árvore Adept/Paragon): são auto-concedidos sem
   escolha adicional no momento do pick do implemento, e a ficha do Mios prova
   que são parte inseparável do resultado mecânico do pick. Pergunta: a
   integração central concorda com essa linha de corte (Initiate = dado
   agora; Adept/Paragon = dívida), ou prefere tratar a árvore inteira como uma
   coisa só?
4. **Weapon Expertise (doc compartilhado) — confirmado, não é achado novo**:
   `subfeatures.proficiencies` só declara `simple`+`unarmed` rank2, mas
   `rules[0]` é um `ActiveEffectLike` com predicate incluindo `class:
   thaumaturge` que também sobe `weapons.martial` para rank2. `champion.json`
   e `magus.json` já documentaram exatamente isso — citado aqui só para
   confirmar que a derivação central já lê `rules[]`, não só `subfeatures`.
5. **classDC — resolvido, ao contrário do Fighter**: a chave de subfeature
   `thaumaturge` em Thaumaturgic Expertise (L9→rank2)/Thaumaturgic Mastery
   (L17→rank3) mapeia para `classDC` com prova TEXTUAL ("Your proficiency rank
   for your thaumaturge class DC increases to..."). O doc de classe não tem
   `system.classDC` (igual ao Fighter), mas `transform.mjs` já aplica default
   1 (`classDC: src.classDC ?? system.classDC ?? 1`, linha 2035) — nenhuma
   decisão pendente aqui.
6. **Gate `class_level` com múltiplos traits de classe** (§8): mesma pergunta
   já registrada em fighter.json/druid.json para os 4 feats compartilhados —
   não resolvida aqui.

## 11. Validação (§5 do PLANO.md)

```
$ node --input-type=module -e "import {validateClassCuration} from './tools/importer-pf2e/src/curation/index.mjs'; import {readFileSync} from 'node:fs'; const f='thaumaturge.json'; const cfg=validateClassCuration(JSON.parse(readFileSync('tools/importer-pf2e/src/curation/classes/'+f,'utf8')), f); console.log('OK', cfg.class, 'eixos:', cfg.choiceAxes.length, 'feats.trait:', cfg.classFeats.trait);"
OK thaumaturge eixos: 3 feats.trait: thaumaturge
```
