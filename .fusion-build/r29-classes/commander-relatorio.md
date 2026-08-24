# r29 — Commander — relatório de curadoria

Arquivo de configuração produzido: `tools/importer-pf2e/src/curation/classes/commander.json`.

## 1. Método (comandos rodados)

Todas as contagens vieram de scripts `node -e` (Node 22, sem dependências) rodados
nesta sessão, no diretório da worktree, contra
`tools/importer-pf2e/vendor/pf2e/packs/pf2e/` (fonte, somente leitura) e
`systems/pf2e/packs/*/documents.json` (packs atuais do Fusion). Nenhum arquivo
compartilhado foi tocado; nenhum `git`, `pnpm` ou importer foi rodado. Os scripts
descartáveis ficaram em `/tmp` (fora da worktree); os comandos relevantes,
reconstruíveis a partir deste relatório:

- Leitura direta de `classes/commander.json` do vendor (`system.items`, `hp`,
  `keyAbility`, `perception`, `savingThrows`, `attacks`, `defenses`, os quatro
  `*FeatLevels`, `skillIncreaseLevels`, `trainedSkills`, `spellcasting`,
  `'classDC' in system`) — 18 entradas em `items{}`.
- Comparação `entry.name` vs. segmento final de `entry.uuid` para as 18 entradas
  — 0 divergências.
- Para cada uma das 18: leitura do arquivo genérico `class-features/<slug>.json`
  e comparação `system.level.value` (genérico) × `level` do `items{}` — 4
  divergências (Fortitude Expertise, Armor Expertise, Perception Mastery, Armor
  Mastery).
- Varredura das 27 pastas de `classes/*.json` do vendor, união dos nomes
  canônicos de `items{}` de cada uma, para achar quais das 18 features do
  Commander são compartilhadas com outras classes.
- Leitura de `systems/pf2e/packs/class-features-core/documents.json` (318 docs)
  e cruzamento por `flags.fusion.sourceId` contra o `_id` de cada arquivo
  genérico do vendor das 8 features compartilhadas.
- Varredura recursiva de `feats/class/commander/level-*/` (39 arquivos) e de
  `feats/class/shared-class-feats/level-*/` (113 arquivos, filtrados para os 4
  com trait `commander`).
- Leitura de `systems/pf2e/packs/feats-core/documents.json` (2205 docs) e
  cruzamento por `sourceId` dos 43 candidatos — 4/43 presentes.
- Varredura de `system.prerequisites.value` dos 43 candidatos (16 não-vazios) e
  classificação de cada texto (interno/externo/não-mecanizável), com
  confirmação cruzada de que todo alvo citado está no conjunto de 43 feats.
- Varredura completa de `otherTags` com prefixo `commander` em TODOS os 842
  arquivos de `class-features/**` — 0 ocorrências (confirma a leitura estrita
  do roteiro do PLANO §6).
- Varredura direta de `actions/class/commander/` (38 arquivos) — leitura de
  `traits.value`, `traits.otherTags`, `publication.title` de cada um. Achado:
  37 com trait `tactic`+`commander` (as tactics reais) + 1 mal-arquivado
  (`shift-immanence.json`, trait `exemplar`).
- Leitura direta de `class-features/tactics.json`, `expert-tactician.json`,
  `master-tactician.json`, `legendary-tactician.json`,
  `feats/class/commander/level-2/tactical-expansion.json`,
  `drilled-reactions.json`, `commanders-banner.json`, `plant-banner.json` —
  `system.rules[]` completos, para entender o mecanismo de escolha de tactics.
- Leitura de `systems/pf2e/packs/actions-core/documents.json` (521 docs) e
  filtro por `traits.value` incluindo `tactic`/`commander` — 37/37 já
  presentes, por `sourceId` batendo com os `_id` do vendor.
- Leitura de `tools/importer-pf2e/src/build-mvp-subset.mjs`
  (`ACTIONS_CORE_INCLUDED_CATEGORIES`, `isActionsCoreDoc`) — só leitura, para
  entender por que os 37 já estão no pack sem curadoria dedicada.
- Leitura de `tools/importer-pf2e/src/transform.mjs`
  (`normalizeClassFeatureSystem`, linhas ~1471–1545) — só leitura, para
  confirmar que `choiceAxes`/`axisCategoryByOtherTag` só se aplicam a docs
  `classFeature`, não a docs `action`.
- Leitura de `tools/importer-pf2e/vendor/pf2e/packs/pf2e/spells/**` (1797
  arquivos) filtrando trait `commander` — 0.
- Varredura de `iconics/*/` (25 personagens) procurando `items.find(type==='class').name` contendo "commander" — **encontrado**: `iconics/ulka/` (Orc, level-1/3/5), usado para conferência não-circular.
- Leitura de `journals/classes.json` confirmando a página "Commander"
  (`BhnMSPWXfCshRvR0`, referenciada na descrição do doc de classe) — não
  parseada célula a célula porque não há conjuração a tabular.
- Leitura de `tools/importer-pf2e/src/curation/index.mjs`
  (`validateClassCuration`, `axisCategoryByOtherTag`, `axisLevelByOtherTag`) e
  de `.fusion-build/r21/fighter-relatorio.md` / `fighter.json` /
  `thaumaturge.json` / `thaumaturge-relatorio.md` como modelos.
- Validação final: comando do §5 do PLANO.md — saída colada no §11.

## 2. Doc da classe (medido)

**Confirma a medição preliminar: hp 8, atributo-chave int, 18 features, sem
conjuração.**

| Campo               | Valor                                                             |
| -------------------- | -------------------------------------------------------------------- |
| hp                  | **8**                                                                |
| keyAbility          | `["int"]` (opção única, sem par)                                    |
| perception          | 2 (expert em nível 1)                                                |
| savingThrows        | fortitude 1 (trained), reflex 2 (expert), will 2 (expert)            |
| attacks             | simple 1, martial 1, unarmed 1 (trained), advanced 0                 |
| defenses            | heavy 1, light 1, medium 1, unarmored 1 (trained em tudo, incl. heavy)|
| ancestryFeatLevels  | 1, 5, 9, 13, 17                                                       |
| classFeatLevels     | 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20                                 |
| generalFeatLevels   | 3, 7, 11, 15, 19                                                      |
| skillFeatLevels     | 2, 4, 6, 8, 10, 12, 14, 16, 18, 20                                    |
| skillIncreaseLevels | 3, 5, 7, 9, 11, 13, 15, 17, 19                                        |
| trainedSkills       | `value: ["society"]`, `additional: 2` (sem `custom`, diferente do Thaumaturge) |
| spellcasting        | `0` (sem conjuração)                                                  |
| classDC (no doc)    | **ausente** (`'classDC' in system` → `false`, igual Fighter/Thaumaturge) |

### `items{}` — 18 entradas, nome canônico = segmento final da uuid

**Confirma 18 features, como a medição preliminar previu.** 0/18 divergências
entre `entry.name` e a uuid tail.

| Nível (`items{}`) | Feature                    | Nível genérico | Divergência? |
| ------------------- | ----------------------------- | ---------------- | ------------- |
| 1                   | Commander's Banner            | 1                | não          |
| 1                   | Tactics                       | 1                | não          |
| 1                   | Drilled Reactions             | 1                | não          |
| 1                   | Shield Block                  | 1                | não          |
| 3                   | Warfare Expertise             | 3                | não          |
| 5                   | Military Expertise            | 5                | não          |
| 7                   | Expert Tactician               | 7                | não          |
| 7                   | Weapon Specialization          | 7                | não          |
| 9                   | Fortitude Expertise            | **3**            | **SIM**      |
| 11                  | Commanding Will                | 11               | não          |
| 11                  | Armor Expertise                | **7**            | **SIM**      |
| 13                  | Weapon Mastery                 | 13               | não          |
| 13                  | Perception Mastery             | **7**            | **SIM**      |
| 15                  | Master Tactician                | 15               | não          |
| 15                  | Greater Weapon Specialization  | 15               | não          |
| 15                  | Battlefield Intuition           | 15               | não          |
| 17                  | Armor Mastery                   | **13**           | **SIM**      |
| 19                  | Legendary Tactician             | 19               | não          |

**4 divergências, todas da mesma família já documentada em Fighter/Champion/
Thaumaturge** (arquivo genérico não é autoritativo): Fortitude Expertise
(genérico 3 → usar 9), Armor Expertise (genérico 7 → usar 11, **mesmo nível
que o Fighter usa** para o mesmo arquivo), Perception Mastery (genérico 7 →
usar 13 — o Thaumaturge usa **9** para o mesmo arquivo genérico, confirmando
que cada classe tem seu próprio nível de concessão), Armor Mastery (genérico
13 → usar 17, **mesmo nível que o Fighter usa**). Registradas em
`dedupe.collisionsDetected`.

## 3. Features compartilhadas com outras classes (união de `items{}` das 27 classes)

8 das 18 features do Commander aparecem em `items{}` de outras classes — **bate
exatamente com "8 já nos packs" da medição preliminar**:

| Feature                       | Nº classes | Classes                                                                 |
| ------------------------------ | ---------- | ---------------------------------------------------------------------------- |
| Weapon Specialization          | 25         | quase todas                                                                   |
| Greater Weapon Specialization  | 13         | Champion, Commander, Fighter, Guardian, Gunslinger, Inventor, Investigator, Magus, Monk, Ranger, Rogue, Swashbuckler, Thaumaturge |
| Perception Mastery              | 10         | Barbarian, Bard, Commander, Exemplar, Gunslinger, Investigator, Ranger, Rogue, Swashbuckler, Thaumaturge |
| Fortitude Expertise             | 7          | Animist, Bard, Commander, Druid, Investigator, Psychic, Swashbuckler          |
| Shield Block                    | 7          | Champion, Commander, Druid, Exemplar, Fighter, Guardian, Inventor              |
| Weapon Mastery                  | 5          | Barbarian, Commander, Guardian, Magus, Thaumaturge                             |
| Armor Mastery                   | 4          | Barbarian, Champion, Commander, Fighter                                        |
| Armor Expertise                 | 3          | Champion, Commander, Fighter                                                   |

As outras 10 (Master Tactician, Commander's Banner, Tactics, Legendary
Tactician, Expert Tactician, Drilled Reactions, Commanding Will, Military
Expertise, Battlefield Intuition, Warfare Expertise) são exclusivas do
Commander.

## 4. Já existe nos packs (`class-features-core`, 318 docs) — REUSAR

Cruzamento por `flags.fusion.sourceId` contra o `_id` do vendor — as 8
features do §3 já estão presentes e reusadas (todas trazidas por classes
curadas antes desta rodada: Fighter/Champion/Barbarian para
Armor Expertise/Armor Mastery, Barbarian/Magus/Thaumaturge para Weapon
Mastery, e assim por diante — a lista completa de classes-doadoras está no
§3). Faltam 10 (as exclusivas listadas acima).

## 5. Eixo de sub-escolha — NÃO existe como `choiceAxes`, mas existe como quarta forma

**A hipótese "sem eixo" da tarefa é REFUTADA — mas não do jeito que a
medição preliminar temia.** A afirmação "nenhuma `otherTag` com prefixo
`commander-`" é **verdadeira só dentro de `class-features/**`** (0/842
arquivos, varredura completa) — que é exatamente onde o roteiro do PLANO §6
manda procurar. Só por isso a medição preliminar não achou o eixo real.

**O eixo real vive em `actions/class/commander/`** (pasta diferente,
documentos do tipo `action`, não `classFeature`):

- 38 arquivos na pasta; **37** têm trait `tactic`+`commander` (as tactics de
  verdade); o 38º (`shift-immanence.json`) é um `action` do **Exemplar**
  mal-arquivado (traits `divine`+`exemplar`, sem `tactic`/`commander`) — quem
  contar arquivos da pasta em vez de tactics reais erra por 1.
- **5 `otherTags` com prefixo `commander-` existem de fato**:
  `commander-mobility-tactic` (7), `commander-offensive-tactic` (7),
  `commander-expert-tactic` (7), `commander-master-tactic` (5, +1 com typo —
  ver abaixo), `commander-legendary-tactic` (5). 5 tactics (todas de
  "Pathfinder Adventure Path: Hell's Destiny", não do Battlecry!) não têm
  NENHUMA otherTag de tier.
- **Mecanismo de concessão**: a feature "Tactics" (`items{}` L1) tem **5**
  pares `ChoiceSet`+`GrantItem` embutidos em `system.rules` (o 3º/4º/5º com
  `predicate: ["class:commander"]`), cada `ChoiceSet` filtrando
  `itemType: "action"` por `[item:trait:tactic, {or:[tag:mobility, tag:offensive]}]`.
  "Expert Tactician" (L7), "Master Tactician" (L15) e "Legendary Tactician"
  (L19) repetem o padrão com **2** pares cada, alargando o OR para incluir a
  tag do próprio tier. O feat "Tactical Expansion" (candidato do §6, L2,
  repetível) usa o **mesmo mecanismo**, com o OR do tier expert/master/
  legendary condicionado a `predicate: feature:expert-tactician` /
  `feature:master-tactician` / `feature:legendary-tactician` — **dependência
  real e mecanizada entre feat e tactic**, exatamente o que a tarefa pediu
  para medir. Total de picks ao longo da progressão: 5 (L1) + 2 (L7) + 2
  (L15) + 2 (L19) = **11** tactics no folio por padrão de classe, mais 2 por
  cada cópia de "Tactical Expansion" tomada.
- **É uma quarta forma de escolha**, distinta de `choiceAxes` (eixo declarado
  por `otherTag` em doc `classFeature`), `GRANTED_FEAT_CHOICES` (feat que
  concede escolha de outro **feat**, filtro por category/trait/level) e do
  padrão do Summoner (Evolution Feat — feature que escolhe um talento por
  filtro declarativo, achado #6 do ACHADOS-TRANSVERSAIS): aqui é uma
  **classFeature/feat que concede escolha de um documento `action`** (não
  `feat`, não `classFeature`), filtrado por `trait`+`otherTag`, vivendo numa
  pasta de vendor própria (`actions/class/<slug>/`). Verificado por leitura
  de `transform.mjs`: `normalizeClassFeatureSystem` (que consome
  `axisCategoryByOtherTag`/`axisLevelByOtherTag`) só roda para docs
  `classFeature` — `choiceAxes` é estruturalmente incompatível com essa pool,
  não é só falta de dado.
- **Boa notícia — R2 cumprida da forma mais forte**: o predicado
  `isActionsCoreDoc` (`build-mvp-subset.mjs`) inclui toda ação de
  `fusionCategory: "class"` **sem depender de curadoria por classe**. Medido
  diretamente: `systems/pf2e/packs/actions-core/documents.json` (521 docs) já
  tem os **37/37** tactics do Commander, por `sourceId` batendo com o `_id`
  do vendor. **Zero conteúdo faltando** — o que falta é só o mecanismo de
  escolha do lado cliente (um equivalente a `GRANTED_FEAT_CHOICES` para
  `action`s filtradas por trait+otherTag, incluindo o caso dinâmico de
  "Tactical Expansion"), fora do escopo do schema de `curation/classes/*.json`
  (que não tem campo para declarar pool de `action`s).
- **3 bugs de dado do vendor** (nenhum corrigido aqui): (1)
  `ready-aim-fire.json` tem a tag com typo `vcommander-master-tactic` (v
  extra) — um picker filtrado por tag exata nunca a ofereceria no tier
  master; (2) `shift-immanence.json` mal-arquivado (ver acima); (3) as 5
  tactics de "Hell's Destiny" não batem em nenhum dos 4 filtros de tier
  nativos do vendor (sem otherTag nenhuma) — estão no pack, mas
  mecanicamente inalcançáveis pelos 4 pontos de concessão do vendor.

## 6. Class feats

**Confirma 43 candidatos**, exatamente como a medição preliminar previu:

- **39** exclusivos em `feats/class/commander/level-*/` (L1=5, L2=6, L4=5,
  L6=3, L8=4, L10=4, L12=2, L14=3, L16=2, L18=3, L20=2 — soma 39).
- **4** de `shared-class-feats/` com trait `commander`: Combat Assessment
  (L1, +fighter), Reactive Interference (L12, +rogue), Reactive Strike (L6,
  +barbarian/champion/exemplar/guardian/magus/swashbuckler — 7 classes ao
  todo), Shield Warden (L6, +champion/fighter).
- **Total candidato: 43.** Todos `category === "class"`.
- **4/4 compartilhados já em `feats-core`** por `sourceId` — trazidos por
  Fighter/Rogue/Barbarian-Champion-Exemplar-Guardian-Magus-Swashbuckler/
  Champion-Fighter, todos curados antes desta rodada. **0 dos 39 exclusivos
  está em `feats-core`.**
- 0/43 têm trait `archetype`.

## 7. Pré-requisitos

- **16 de 43** candidatos têm `system.prerequisites.value` não vazio.
- **Todos os 16 resolvem para DENTRO do conjunto** (15 puros + 1 misto):
  Battle-Hardened Companion → Battle-Tested Companion; Drilled Reflexes →
  "drilled reactions" (feature, minúsculo no texto original); Targeting
  Strike / Fortunate Blow → "Guiding Shot or Set-Up Strike" (OR já vem como
  texto único do vendor); Perfected Evaluations → Unrivaled Analysis;
  Contact With the Enemy → Adaptive Stratagem; Confusing Commands →
  Deceptive Tactics; Peerless Mascot Companion → Battle-Hardened Companion;
  Practiced Reflexes → Drilled Reflexes; Observational Analysis → Combat
  Assessment; Shielded Recovery → Officer's Medical Training; Battle-Tested
  Companion → Commander's Companion; Claim the Field → Plant Banner;
  Unrivaled Analysis → Rapid Assessment; Shield Warden → "shield block"
  (feature, minúsculo). **Desperate Resuscitation** é misto: 2 entradas
  separadas no array (AND) — "master in Medicine" (não-mecanizável) **e**
  "Officer's Medical Training" (interno).
- **0 apontam para fora do conjunto** — diferente do Fighter (que tinha 1,
  Master of Many Styles → feat do Monk).
- **1 não-mecanizável isolado**: "master in Medicine" (Desperate
  Resuscitation), texto preservado sem predicado inventado.

## 8. Preparação para multiclasse

- Gate derivado para os 39 exclusivos: trait `commander` + `category:"class"`
  → `{"class_level":{"commander":{">=":N}}}`, sem ambiguidade.
- Os 4 compartilhados têm a mesma ambiguidade "any entre as classes do
  trait" já registrada em `fighter.json`/`druid.json`/`thaumaturge.json` —
  4ª vez que a pergunta aparece nesta rodada+r21, não resolvida aqui.
- 0/43 com trait `archetype`. Dedication de multiclasse do Commander não
  entra nesta rodada (fora do escopo §9 do PLANO).

## 9. Conjuração e focus spells

**Confirma "sem conjuração" e "0 magias"**, como a medição preliminar
previu. `system.spellcasting` do doc de classe = `0`; varredura das 1797
magias do vendor por trait `commander` = 0 arquivos. `spellcasting: null`,
`focusSpells: {names: [], alreadyInPacks: []}`.

## 10. Riscos, dívidas e perguntas em aberto para a integração central

1. **Mecanismo de tactics (§5)**: é a 4ª forma de escolha encontrada nesta
   rodada (ao lado de `choiceAxes`, `GRANTED_FEAT_CHOICES` e o gap do
   Summoner) — precisa de decisão de design: estender o schema de curadoria
   com um campo tipo `actionChoices` (análogo a `GRANTED_FEAT_CHOICES` mas
   para `action`s), ou tratar como puramente client-side (planVM) sem
   passar pela curadoria de classe? O conteúdo (37 `action`s) já está no
   pack `actions-core` — só falta o picker.
2. **Correção ao relatório-padrão do Fighter (r21)**: `armor-mastery.json`
   tem um `ActiveEffectLike` (`{mode:"upgrade", path:"system.proficiencies.
   defenses.heavy.rank", predicate:[{not:"class:barbarian"}], value:3}`) que
   o fighter-relatorio.md §11 não capturou — ele afirma que o Fighter "fica
   sem upgrade de armor.heavy" porque leu só `subfeatures.proficiencies`.
   Como nem Fighter nem Commander são barbarian, esse rule sobe
   `armor.heavy` para rank 3 no nível do `items{}` de cada um (17 para
   ambos). Vale conferir os dois casos juntos na integração central — não
   corrigido aqui porque é doc compartilhado e o Fighter não é meu escopo.
3. **classDC até rank 4 (legendary)**: Expert/Master/Legendary Tactician
   sobem `classDC` do Commander a rank 2/3/4 — nenhuma outra classe já
   curada nesta leva ou nas anteriores (Fighter, Thaumaturge) passa de rank
   3. Não verificado contra as 21 classes já curadas se é a primeira
   ocorrência de rank 4 — vale conferência central.
4. **Gate `class_level` com múltiplos traits de classe** (§8): mesma
   pergunta repetida pela 4ª vez.
5. **3 bugs de dado do vendor na pool de tactics** (§5): typo de tag em
   Ready Aim Fire, arquivo mal-pastado (Exemplar), 5 tactics de splatbook
   sem tag de tier — nenhum corrigido; ficam para a integração central
   decidir se cabe um `prerequisiteFixes`-like para tags de `action`, ou se
   é aceitável como está (a picker fica só um pouco mais pobre).
6. **Achados transversais já conhecidos (verificados contra a lista da
   onda 1)**: o Commander **não** esbarra no item 1 (KNOWN_CLASS_TRAITS —
   `commander` já está na lista de "classes ainda não curadas, falta
   esperada" citada lá, mas passa a ser falta REAL assim que este JSON for
   integrado — mesma classe de defeito do `psychic`, precisa entrar nos dois
   arquivos `planVM.ts`/`characterSheetVM.ts` junto com a integração). Não
   esbarra nos itens 2/3 (sem conjuração). O item 4 (eixo repetível/eixo com
   progressão) não se aplica da mesma forma — o Commander não tem
   `choiceAxes` nenhum, o achado dele é estrutural (documento errado, não
   eixo repetido). Não esbarra no item 5 (R3 quebrada por `otherTag`
   adjetivo) — não há `choiceAxes` para aplicar R3. Não esbarra no item 7
   (pregen ausente — pelo contrário, **encontrei** o pregen que a lista de
   `CLASSES_WITHOUT_PREGEN` provavelmente listará como já coberto: Ulka).
   Esbarra no item 8 (mesma pergunta de gate multi-trait, agora pela 4ª
   vez) e é candidato natural a **adicionar um item novo ao
   ACHADOS-TRANSVERSAIS** sobre a 4ª forma de escolha (ação com
   trait+otherTag) — decisão do orquestrador, não minha.

## 11. Validação (§5 do PLANO.md)

```
$ node --input-type=module -e "import {validateClassCuration} from './tools/importer-pf2e/src/curation/index.mjs'; import {readFileSync} from 'node:fs'; const f='commander.json'; const cfg=validateClassCuration(JSON.parse(readFileSync('tools/importer-pf2e/src/curation/classes/'+f,'utf8')), f); console.log('OK', cfg.class, 'eixos:', cfg.choiceAxes.length, 'feats.trait:', cfg.classFeats.trait);"
OK commander eixos: 0 feats.trait: commander
```
