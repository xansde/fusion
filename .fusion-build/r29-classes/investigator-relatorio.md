# r29 — Investigator — relatório de curadoria

Arquivo de configuração produzido: `tools/importer-pf2e/src/curation/classes/investigator.json`.

## 1. Método (comandos rodados)

Todas as contagens vieram de scripts `node -e` (Node 22, sem dependências) rodados
contra `tools/importer-pf2e/vendor/pf2e/packs/pf2e/` (fonte, somente leitura) e
`systems/pf2e/packs/*/documents.json` (packs atuais do Fusion), nesta sessão, no
diretório da worktree. Nenhum arquivo compartilhado foi tocado; nenhum `git`,
`pnpm` ou importer foi rodado. Os scripts descartáveis não foram persistidos (só
o `node -e` inline); os comandos relevantes, reconstruíveis a partir deste
relatório:

- Leitura direta de `classes/investigator.json` do vendor (`system.items`, `hp`,
  `keyAbility`, `perception`, `savingThrows`, `attacks`, `defenses`, os quatro
  `*FeatLevels`, `skillIncreaseLevels`, `trainedSkills`, `spellcasting`,
  `classDC in system`) — inclusive um `grep`/`sed` direto no JSON cru para
  confirmar `skillFeatLevels`/`skillIncreaseLevels` (achado do §2).
- Varredura de `system.items` (21 entradas) comparando `entry.name` com o
  segmento final de `entry.uuid` — 5 divergências (§2).
- Para cada uma das 21 entradas: leitura do arquivo genérico correspondente em
  `class-features/<slug>.json` e comparação `system.level.value` (genérico) ×
  `level` do `items{}` — 1 divergência (Fortitude Expertise).
- Varredura das 27 pastas de `classes/*.json` do vendor, união dos nomes
  canônicos de `items{}` de cada uma, para achar quais das 21 features do
  Investigator são compartilhadas com outras classes.
- Leitura de `systems/pf2e/packs/class-features-core/documents.json` (318 docs)
  e cruzamento por `flags.fusion.sourceId` contra o `_id` de cada um dos 21
  arquivos genéricos do vendor.
- Grep recursivo por `"investigator-methodology"` em `class-features/**` (6
  arquivos: os 5 docs de opção + o nó concessor `methodology.json`, que não
  carrega a otherTag) e varredura completa de `otherTags` com prefixo
  `investigator` nos 841 arquivos de `class-features/` (mais `_folders.json`,
  sem `system`) — confirma que só existe UM eixo.
- Leitura direta dos 5 arquivos de metodologia (`alchemical-sciences-
  methodology.json`, `empiricism-methodology.json`, `forensic-medicine-
  methodology.json`, `interrogation-methodology.json`, `palatine-
  detective.json`) e do nó concessor `methodology.json` — `level`, `category`,
  `otherTags`, `rules[]` completos de cada um.
- Leitura direta dos `rules[]` de todo documento citado por GrantItem dentro das
  5 metodologias (Alchemical Crafting, Quick Tincture, Formula Book (Blank),
  Versatile Vials, That's Odd, Expeditious Inspection, Forensic Acumen, Battle
  Medicine, No Cause for Alarm, Pointed Question, Quick Identification, Palatine
  Detective Dedication) e cruzamento de cada `_id` contra `feats-core` (2205
  docs)/`actions-core` (521 docs)/`equipment-core` (249 docs) por `sourceId`.
- Leitura direta de `on-the-case.json`, `devise-a-stratagem.json` (class-feature
  E a ação em `actions/class/investigator/`), `strategic-strike.json`,
  `skillful-lessons.json`, `deductive-improvisation.json`, `dogged-will.json`,
  `keen-recollection.json`, `investigator-expertise.json`, `savvy-
  reflexes.json`, `master-detective.json`, `greater-dogged-will.json` —
  `rules[]`, `subfeatures.proficiencies`, descrição completa.
- Varredura recursiva de `feats/class/investigator/level-*/` (45 arquivos) e de
  `feats/class/shared-class-feats/level-*/` (113 arquivos, filtrados para os 11
  com trait `investigator`) — a pasta `shared-class-feats` é subdividida por
  nível (mesma armadilha documentada nos relatórios do Fighter/Thaumaturge).
- Cruzamento dos 56 candidatos por `sourceId` contra `feats-core` — 11/56
  presentes (todos os 11 compartilhados); confirmação de qual classe já
  curada (rogue/ranger/gunslinger/fighter) traz cada trait via
  `classFeats.includeSharedClassFeats: true`.
- Varredura de `system.prerequisites.value` dos 56 candidatos (20 não-vazios) e
  classificação de cada texto (documento interno / opção de eixo em minúsculas
  / disjunção / atributo de perícia não-mecanizável / externo — nenhum externo).
- Busca pontual (arquivo por nome exato) de "Person of Interest", "Shared
  Stratagem", "Predictive Purchase (Investigator)", "Clue Them All In",
  "Thorough Research" entre os próprios 45 exclusivos, para resolver os alvos
  dos 9 pares internos.
- Leitura de `tools/importer-pf2e/vendor/pf2e/packs/pf2e/spells/**` (1797
  arquivos) filtrando trait `investigator` — 0.
- Leitura de `journals/remaster-changes.json` (páginas `Feats` e `Class
  Features`, parse do HTML) buscando `"Investigator"` — 1 ocorrência total, na
  página `Feats` (Red Herring → Renamed → Eliminate Red Herrings).
- Leitura de `packs/iconics/quinn/quinn-level-{1,3,5}.json` (o iconic do
  Investigator — confirmado pelo conjunto de feats/features de nível 1) para
  conferência independente (não-circular).
- Tentativa de cruzamento com `~/pessoal/Wayfinder/pipeline/base/index.json`
  (20083 registros) por chave contendo "investigator" — 0 resultados (ver §11).
- Leitura de `tools/importer-pf2e/src/curation/index.mjs`
  (`validateClassCuration`, `axisCategoryByOtherTag`) e de
  `tools/importer-pf2e/src/curation/classes/cleric.json`/`druid.json`/
  `thaumaturge.json` — para confirmar a política já fixada (r22) sobre opção de
  eixo com tag `class-archetype` (Battle Creed) e o padrão de leitura de
  `rules[]` do Weapon Expertise compartilhado (Champion/Magus/Thaumaturge).
- Validação final: `node --input-type=module -e "import {validateClassCuration}
  ..."` (comando do §5 do PLANO.md) — saída colada na seção 12; e
  `loadClassCuration({force:true})` para confirmar carga limpa junto com as
  outras 26 classes já curadas (sem colisão de slug/arquivo).

## 2. Doc da classe (medido)

| Campo               | Valor                                                                |
| -------------------- | --------------------------------------------------------------------- |
| hp                  | **8**                                                                 |
| keyAbility          | `["int"]` (opção única)                                              |
| perception          | 2 (expert em nível 1)                                                |
| savingThrows        | fortitude 1 (trained), reflex 2 (expert), will 2 (expert)            |
| attacks             | simple 1, martial 1, unarmed 1 (trained), advanced 0                 |
| defenses            | light 1, unarmored 1 (trained), medium 0, heavy 0                    |
| ancestryFeatLevels  | 1, 5, 9, 13, 17                                                       |
| classFeatLevels     | 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20                                 |
| generalFeatLevels   | 3, 7, 11, 15, 19                                                      |
| skillFeatLevels     | **2, 3, 4, 5, 6, 7, 8, ..., 20 (todo nível de 2 a 20 — 19 entradas)** |
| skillIncreaseLevels | **2, 3, 4, 5, 6, 7, 8, ..., 20 (idêntico ao skillFeatLevels)**        |
| trainedSkills       | `value: ["society"]`, `additional: 4`                                |
| spellcasting        | `0` (sem conjuração)                                                  |
| classDC (no doc)    | **ausente** (`'classDC' in system` → `false`, igual a Fighter/Thaumaturge) |

**Confirma a medição preliminar**: hp 8, atributo-chave int, sem conjuração.
**Divergência/achado sobre `skillFeatLevels`/`skillIncreaseLevels`**: medi o
JSON cru diretamente (grep, não só o parser) e confirmei que **os dois campos
são idênticos**: `[2..20]`, todo nível de 2 a 20 — muito além do padrão
`[2,4,...,20]`/`[3,5,...,19]` de outras classes. A cadência extra de
**skill feat** é explicada pela class feature "Skillful Lessons" (items{} L3,
texto: "At 3rd level and every odd-numbered level thereafter, you gain a
skill feat" — `rules: []`, puramente textual), o que confirma REQ-MCL-043 da
spec 30 ("Investigador: skill increase" — mas o texto da feature fala de skill
**feat**, não skill increase). A cadência extra de **skill increase** (o
campo `skillIncreaseLevels` também `[2..20]`) **não tem nenhuma class feature
textual correspondente** entre as 21 do `items{}` — nenhuma das 21 descrições
menciona "skill increase". Isso é uma divergência entre o dado medido e o
texto de REQ-MCL-043 (que cita só "skill increase" para o Investigator, não
skill feat) — reportada no §10, não resolvida (esses dois campos não fazem
parte do schema de curadoria desta rodada; são lidos direto do doc de classe
pelo `transform.mjs`).

### `items{}` — 21 entradas, nome canônico = segmento final da uuid

**Confirma 21 features (9 já nos packs), como a medição preliminar previu.**
Mas **5/21 divergências** entre `entry.name` e a uuid tail — a pior taxa
medida até agora nesta rodada (Fighter 0/16, Druid 0/17, Thaumaturge 0/24).

| Nível (`items{}`) | Nome canônico (uuid tail)     | `entry.name` no vendor                    | Nível genérico | Divergência de nível? |
| ------------------- | ------------------------------ | -------------------------------------------- | ---------------- | ------------------------ |
| 1                  | On the Case                    | (igual)                                       | 1                | não                     |
| 1                  | Methodology                    | (igual)                                       | 1                | não                     |
| 1                  | Devise a Stratagem             | (igual)                                       | 1                | não                     |
| 1                  | Strategic Strike               | (igual)                                       | 1                | não                     |
| 3                  | Keen Recollection              | (igual)                                       | 3                | não                     |
| 3                  | Skillful Lessons               | (igual)                                       | 3                | não                     |
| 5                  | Weapon Expertise               | (igual)                                       | 5                | não                     |
| 7                  | **Perception Mastery**         | **Vigilant Senses**                           | 7                | não                     |
| 7                  | Weapon Specialization          | (igual)                                       | 7                | não                     |
| 9                  | Fortitude Expertise            | (igual)                                       | **3**            | **SIM — usar 9**        |
| 9                  | Investigator Expertise         | (igual)                                       | 9                | não                     |
| 11                 | Deductive Improvisation        | (igual)                                       | 11               | não                     |
| 11                 | Dogged Will                    | (igual)                                       | 11               | não                     |
| 13                 | **Perception Legend**          | **Incredible Senses**                         | 13               | não                     |
| 13                 | **Martial Weapon Mastery**     | **Weapon Mastery**                            | 13               | não                     |
| 13                 | Light Armor Expertise          | (igual)                                       | 13               | não                     |
| 15                 | Savvy Reflexes                 | (igual)                                       | 15               | não                     |
| 15                 | **Greater Weapon Specialization** | **Greater Weapon Specialization (Level 15)** | 15                | não                     |
| 17                 | Greater Dogged Will            | (igual)                                       | 17               | não                     |
| 19                 | **Light Armor Mastery**        | **Light Armor Mastery (Level 19)**            | 19               | não                     |
| 19                 | Master Detective               | (igual)                                       | 19               | não                     |

Usei o **nome canônico** (segmento final da uuid) em todo o arquivo de
curadoria — casar por `entry.name` criaria 5 documentos fantasma (mesma
armadilha do Magus, citada no PLANO §4). A única divergência de **nível**
(genérico × `items{}`) é Fortitude Expertise (genérico 3 → Investigator usa
9); registrada em `dedupe.collisionsDetected`.

## 3. Features compartilhadas com outras classes (união de `items{}` das 27 classes)

9 das 21 features do Investigator aparecem em `items{}` de outras classes
(nomes canônicos):

| Feature                   | Nº classes | Classes                                                                  |
| --------------------------- | ---------- | --------------------------------------------------------------------------- |
| Weapon Specialization      | 25         | quase todas                                                                 |
| Weapon Expertise            | 14         | Champion, Druid, Exemplar, Guardian, Kineticist, Magus, Oracle, Psychic, Sorcerer, Swashbuckler, Thaumaturge, Witch, Wizard, Investigator |
| Greater Weapon Specialization | 13       | Champion, Commander, Fighter, Guardian, Gunslinger, Inventor, Magus, Monk, Ranger, Rogue, Swashbuckler, Thaumaturge, Investigator |
| Fortitude Expertise         | 7          | Animist, Bard, Commander, Druid, Psychic, Swashbuckler, Investigator         |
| Perception Mastery          | 10         | Barbarian, Bard, Commander, Exemplar, Gunslinger, Ranger, Rogue, Swashbuckler, Thaumaturge, Investigator |
| Light Armor Expertise       | 6          | Bard, Kineticist, Oracle, Rogue, Swashbuckler, Investigator                  |
| Perception Legend           | 4          | Gunslinger, Ranger, Rogue, Investigator                                     |
| Martial Weapon Mastery      | 4          | Champion, Ranger, Swashbuckler, Investigator                                |
| Light Armor Mastery         | 4          | Kineticist, Rogue, Swashbuckler, Investigator                               |

As outras 12 features (Deductive Improvisation, Dogged Will, On the Case, Keen
Recollection, Methodology, Investigator Expertise, Savvy Reflexes, Master
Detective, Devise a Stratagem, Strategic Strike, Skillful Lessons, Greater
Dogged Will) são exclusivas do Investigator.

## 4. Já existe nos packs (`class-features-core`, 318 docs) — REUSAR

Cruzamento por `flags.fusion.sourceId` contra o `_id` do vendor — as mesmas 9
features do §3 já estão presentes e reusadas: Perception Legend, Fortitude
Expertise, Martial Weapon Mastery, Weapon Expertise, Perception Mastery, Light
Armor Mastery, Greater Weapon Specialization, Light Armor Expertise, Weapon
Specialization.

Faltam as 12 exclusivas listadas no §3. A árvore da metodologia (§5) **não
acrescenta nenhum documento faltante** — ver achado-chave abaixo.

## 5. Eixo de sub-escolha — `investigator-methodology`

**Confirma o eixo único com 5 opções**, como a medição preliminar previu, com
duas armadilhas medidas a fundo (a citada na tarefa e uma nova).

- **5 opções**: Alchemical Sciences, Empiricism, Forensic Medicine,
  Interrogation, Palatine Detective — todas `category="classfeature"`,
  `level=1`, `otherTags` incluindo `"investigator-methodology"`. 0/5 já em
  `class-features-core`.
- **Palatine Detective carrega também `"class-archetype"`** — é o MESMO padrão
  já registrado para "Battle Creed" no eixo `cleric-doctrine` (`cleric.json`):
  um doc de arquétipo (aqui, Esoteric Order of the Palatine Eye) reusa a
  otherTag do eixo core. A política já fixada pela integração central (r22)
  para esse padrão é **incluir**, não excluir, a opção no `optionCount` — apliquei
  a mesma política: `optionCount: 5`. Palatine Detective concede "Quick
  Identification" (feat geral, já em `feats-core`) e um `GrantItem`
  condicional (`self:level>=2`) para "Palatine Detective Dedication" (feat de
  arquétipo, fora dos packs) — mesma dívida aceita do "Battle Harbinger
  Dedication" do Battle Creed.
- **Cada metodologia concede perícia + feat inicial — medido documento por
  documento** (a armadilha específica da tarefa): Alchemical Sciences ⇒
  `crafting` treino **fixo** + feat "Alchemical Crafting" + ação "Quick
  Tincture" + equipamento "Formula Book (Blank)" + `SpecialResource`
  "Versatile Vials" (o kit do Alchemist inteiro — dívida, ver §10). Empiricism
  ⇒ feat "That's Odd" + ação "Expeditious Inspection" + `ChoiceSet` de perícia
  (arcana/crafting/occultism/society, **escolha livre**) + treino na
  escolhida. Forensic Medicine ⇒ `medicine` treino **fixo** + feats "Forensic
  Acumen" + "Battle Medicine". Interrogation ⇒ `diplomacy` treino **fixo** +
  feat "No Cause for Alarm" + ação "Pointed Question". Palatine Detective ⇒
  `ChoiceSet` occultism/religion + feat "Quick Identification" + Dedication
  condicional.
- **ACHADO-CHAVE (refuta a hipótese de que a metodologia precisaria de
  `extraNames`, ao contrário do Thaumaturge)**: cruzei TODOS os documentos
  concedidos por `GrantItem` nas 5 metodologias contra os packs atuais por
  `sourceId` — **100% já existem**: os 5 feats concedidos (Alchemical
  Crafting, Battle Medicine, Forensic Acumen, No Cause for Alarm, Quick
  Identification) são feats **gerais de perícia** (`category: "skill"`, trait
  `general`+`skill`, NÃO `class`) já em `feats-core`; as 4 ações concedidas
  (Quick Tincture, Expeditious Inspection, Pointed Question, e também "Pursue
  a Lead"/"Clue In" de "On the Case") já estão em `actions-core`; o
  equipamento (Formula Book (Blank)) já está em `equipment-core`. Isso é
  diferente do Thaumaturge, cujos 10 "Initiate Benefit (\*)" eram documentos
  NOVOS de `class-features` que exigiram `classFeatures.extraNames`. Aqui,
  `classFeatures.extraNames: []` — nada falta.
- **O que NÃO é mecanizado**: o treino de perícia (fixo ou por `ChoiceSet`)
  concedido por cada metodologia não tem consumidor hoje — mesma dívida já
  registrada em `druid.json` para "perícia da ordem não aplicada". A pergunta
  do PLANO ("o pipeline sabe aplicar cada tipo?") — resposta: **não, nenhum
  tipo é aplicado hoje** (nem o fixo nem o `ChoiceSet`), e é a MESMA lacuna do
  Druid, não uma pior — porque, ao contrário do Druid, aqui todos os
  documentos-alvo dos `GrantItem` já existem nos packs (o problema do
  Investigator é só "quem aplica a perícia", não "o documento não existe").

## 6. Class feats

**Confirma 56 candidatos**, como a medição preliminar previu, incluindo os 11
já em pack:

- **45** exclusivos em `feats/class/investigator/level-*/` (L1=7, L2=6, L4=7,
  L6=4, L8=3, L10=3, L12=7, L14=2, L16=2, L18=1, L20=3 — soma 45).
- **11** de `shared-class-feats/` com trait `investigator`: Trap Finder (L1,
  +rogue), Sense the Unseen (L14, +ranger/rogue), Reconstruct the Scene (L16,
  +rogue), Trickster's Ace (L18, +rogue), Blind-Fight (L8,
  +fighter/ranger/rogue), Greenwatch Initiate (L4, +gunslinger/ranger), Defy
  Fey (L6, +gunslinger/ranger), Fey Tracker (L6, +gunslinger/ranger),
  Greenwatcher (L10, +gunslinger/ranger), Greenwatch Veteran (L8,
  +gunslinger/ranger), Unseen Passage (L8, +gunslinger/ranger).
- **Total candidato: 56.** Todos `category === "class"`. 0 com trait
  `archetype`.
- **11 de 11 compartilhados JÁ em `feats-core`** por `sourceId` (evidência de
  R2 — reusar, não recriar): Rogue traz Trap Finder, Sense the Unseen,
  Reconstruct the Scene, Trickster's Ace, Blind-Fight; Ranger traz Sense the
  Unseen, Blind-Fight, e os 6 "Greenwatch\*"/"Fey\*"/"Unseen Passage"; Gunslinger
  traz os mesmos 6 "Greenwatch\*"/"Fey\*"/"Unseen Passage"; Fighter traz
  Blind-Fight. Todas as 4 classes (Rogue, Ranger, Gunslinger, Fighter) já
  curadas com `classFeats.includeSharedClassFeats: true` confirmado — os 11
  entraram nos packs por ELAS, não pelo Investigator. **Nenhum dos 11 precisou
  ser recriado.**

## 7. Pré-requisitos

- **20 de 56** candidatos têm `system.prerequisites.value` não vazio.
- **9 resolvem para dentro do conjunto** (feat ou feature do próprio
  Investigator): Ongoing Strategy → Strategic Strike (feature, texto em
  minúsculas "strategic strike"); Suspect of Opportunity → Person of Interest;
  Didactic Strike → Shared Stratagem; Implausible Purchase (Investigator) →
  Predictive Purchase (Investigator) (vendor omite o sufixo "(Investigator)"
  no texto, mesma família do "Mature Animal Companion (Druid)"); Lead
  Investigator → Clue Them All In; Just the Facts → Thorough Research;
  Greenwatcher → Defy Fey; Defy Fey → Greenwatch Initiate; Fey Tracker →
  Greenwatch Initiate. Registrados em `prerequisites.internalChains` (9
  pares).
- **6 referenciam uma opção do eixo `investigator-methodology` em minúsculas**
  (mesmo padrão do "animal order"/"leaf order" do `druid.json`): Empiricist's
  Eye → "empiricism methodology"; Make 'Em Sweat → "interrogation
  methodology"; Share Tincture / Alchemical Discoveries → "alchemical sciences
  methodology"; Surgical Shock / Scalpel's Point → "forensic medicine
  methodology".
- **1 é disjunção entre duas opções do eixo NUMA entrada** (mesmo padrão do
  "flame stone storm or wave order" do `druid.json`): Lie Detector →
  "empiricism or interrogation methodology".
- **4 são atributo de perícia não-mecanizável** (texto preservado, sem
  predicado inventado): Athletic Strategist → "trained in Athletics";
  Strategic Repose → "trained in Religion"; Greenwatch Initiate → "trained in
  Survival"; Blind-Fight → "master in Perception".
- **0 apontam para fora do conjunto do Investigator** — diferente do Fighter
  (→ Monk) e do Thaumaturge (→ Bard). Resultado medido, registrado mesmo sendo
  "nenhum achado".
- **Armadilha "condicionado à metodologia escolhida" — parcialmente
  confirmada**: 8 dos 20 prerequisites (6 diretos + 2 na disjunção) SÃO
  condicionados a qual metodologia foi escolhida — mas via texto da opção do
  eixo (mesmo mecanismo do `druid-order`), não via nome de documento
  específico. Nenhum feat exige o nome de um dos documentos concedidos pela
  metodologia (ex.: nenhum prerequisites.value cita "That's Odd" ou "Alchemical
  Crafting").

## 8. Preparação para multiclasse

- Gate derivado para os 45 exclusivos: trait `investigator` +
  `category:"class"` → `{"class_level":{"investigator":{">=":N}}}`, sem
  ambiguidade.
- Os 11 compartilhados têm a mesma ambiguidade "any entre as classes do
  trait" já registrada em `fighter.json`/`druid.json`/`thaumaturge.json` (não
  resolvida aqui, decisão da integração central).
- 0/56 com trait `archetype`. "Investigator Dedication" não entra nesta rodada
  (fora do escopo §9 do plano).

## 9. Conjuração e focus spells

**Confirma "sem conjuração" e "0 magias"**, como a medição preliminar previu.
`system.spellcasting` do doc de classe = `0`; varredura das 1797 magias do
vendor por trait `investigator` = 0 arquivos. `spellcasting: null`,
`focusSpells: {names: [], alreadyInPacks: []}`.

## 10. Riscos, dívidas e perguntas em aberto para a integração central

1. **Cadência extra de `skillIncreaseLevels` sem explicação textual** (§2):
   `skillFeatLevels` e `skillIncreaseLevels` do doc de classe do vendor são
   IDÊNTICOS ([2..20], 19 níveis). A extensão de `skillFeatLevels` é explicada
   por "Skillful Lessons" (texto claro). A de `skillIncreaseLevels` **não tem
   nenhuma class feature correspondente** entre as 21 do `items{}` — e
   REQ-MCL-043 (spec 30) cita só "skill increase" para o Investigator, não
   skill feat, o que é o INVERSO do que a evidência textual sustenta. Esses
   dois campos não fazem parte do schema de curadoria (são lidos direto do doc
   de classe pelo `transform.mjs`), então não há nada a corrigir NESTE
   arquivo — mas é uma divergência entre dado medido e spec que vale
   reconciliar centralmente antes de multiclasse (REQ-MCL-042/043) depender
   desse número.
2. **Metodologia sem perícia mecanizada** (§5): nenhum consumidor hoje aplica
   o treino de perícia (fixo ou por `ChoiceSet`) concedido pela escolha de
   metodologia — mesma família da "perícia da ordem" do Druid, mas aqui SEM
   o problema adicional de documento faltante (todos os alvos de `GrantItem`
   já existem nos packs).
3. **"Versatile Vials" (Alchemical Sciences) — dívida antecipada pelo PLANO**:
   a metodologia Alchemical Sciences importa o `SpecialResource` inteiro do
   Alchemist (vials versáteis escaláveis por nível/INT) — é exatamente o
   "formulário de alquimista" que o PLANO §4 já listava como dívida esperada
   ("companheiro animal, eidolon como criatura, **formulário de
   alquimista**"). Não modelado; dívida confirmada, não nova.
4. **Devise a Stratagem (ação de rolagem antecipada)** — conforme a armadilha
   apontada na tarefa: é uma ação com mecânica de "role agora, use depois"
   (Attack Stratagem / Skill Stratagem), não uma seleção. Incluída via
   `fromItemsMap` como feature (que só concede a ação via `GrantItem`); a
   mecânica de rolagem em si não é mecanizada — fora do escopo de curadoria de
   conteúdo. Dívida declarada, sem predicado inventado.
5. **Gate `class_level` com múltiplos traits de classe** (§8): mesma pergunta
   já registrada em `fighter.json`/`druid.json`/`thaumaturge.json` para os 11
   feats compartilhados — não resolvida aqui.
6. **Palatine Detective (opção de eixo com tag `class-archetype`)**: apliquei
   a política já fixada pela integração central (r22, `cleric.json` —
   Battle Creed) de incluir a opção no `optionCount`. Se essa política mudar
   centralmente, revisar também `cleric.json`/`druid.json` e este arquivo
   juntos (mesmo padrão, política única).

## 11. Conferência independente

- **Iconic (Quinn, `packs/iconics/quinn/quinn-level-{1,3,5}.json`)** — fonte
  não-circular. Bate 100% com a curadoria medida: L1 mostra a metodologia
  Empiricism escolhida concedendo exatamente "That's Odd" (confirma o
  `GrantItem` lido do arquivo); L3 mostra o ganho de skill feat extra via
  Skillful Lessons na prática; L5 mostra Weapon Expertise (items{} L5) e mais
  feats extras consistentes com "skill feat todo nível ímpar desde L3".
  Nenhuma divergência encontrada.
- **Waybuilder** (`~/pessoal/Wayfinder/pipeline/base/index.json`, 20083
  registros): **zero entradas para Investigator** (busquei por chave contendo
  "investigator", maiúsculo/minúsculo — 0 resultados). Diferente do Druid
  (que bateu 100% no chassi), o Waybuilder não cobre esta classe — não serve
  de segunda fonte aqui. A conferência independente ficou só com o iconic
  (Quinn), que já é suficiente e não-circular.

## 12. Validação (§5 do PLANO.md)

```
$ node --input-type=module -e "import {validateClassCuration} from './tools/importer-pf2e/src/curation/index.mjs'; import {readFileSync} from 'node:fs'; const f='investigator.json'; const cfg=validateClassCuration(JSON.parse(readFileSync('tools/importer-pf2e/src/curation/classes/'+f,'utf8')), f); console.log('OK', cfg.class, 'eixos:', cfg.choiceAxes.length, 'feats.trait:', cfg.classFeats.trait);"
OK investigator eixos: 1 feats.trait: investigator
```

Confirmação adicional — carga completa junto com as outras 26 classes já
curadas (sem colisão de slug/arquivo):

```
$ node --input-type=module -e "import { loadClassCuration } from './tools/importer-pf2e/src/curation/index.mjs'; const map = loadClassCuration({force:true}); console.log('total curated classes:', map.size); console.log('investigator loaded:', map.has('investigator'));"
total curated classes: 27
investigator loaded: true
```
