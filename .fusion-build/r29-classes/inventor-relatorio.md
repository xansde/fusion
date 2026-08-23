# r29 — Inventor — relatório de curadoria

Arquivo de configuração produzido: `tools/importer-pf2e/src/curation/classes/inventor.json`.

## 1. Método (comandos rodados)

Todas as contagens vieram de scripts `node -e` (Node 22, sem dependências) rodados
contra `tools/importer-pf2e/vendor/pf2e/packs/pf2e/` (fonte, somente leitura) e
`systems/pf2e/packs/*/documents.json` (packs atuais do Fusion), nesta sessão, na
worktree. Nenhum arquivo compartilhado foi tocado; nenhum `git`, `pnpm` ou importer
foi rodado. Os comandos relevantes, reconstruíveis a partir deste relatório:

- Leitura direta de `classes/inventor.json` do vendor (`system.{hp,keyAbility,
  perception,savingThrows,attacks,defenses,ancestryFeatLevels,classFeatLevels,
  generalFeatLevels,skillFeatLevels,skillIncreaseLevels,trainedSkills,
  spellcasting,items}`, `'classDC' in system`).
- Varredura de `system.items` (26 entradas) comparando `entry.name` com o segmento
  final de `entry.uuid` — 1 divergência (Greater Weapon Specialization).
- Para cada uma das 26 entradas: varredura recursiva de `class-features/**` (827+
  arquivos, incluindo a subpasta `mythic-callings/`) montando um mapa
  `name -> system.level.value` e comparando contra o `level` do `items{}` — 3
  divergências (Reflex Expertise, Perception Expertise, Medium Armor Mastery).
- Varredura das 27 pastas de `classes/*.json` do vendor, união dos nomes canônicos
  de `items{}` de cada uma, para achar quais das 26 features do Inventor são
  compartilhadas com outras classes — 6 compartilhadas, 20 exclusivas.
- Leitura de `systems/pf2e/packs/class-features-core/documents.json` (318 docs) e
  cruzamento por `flags.fusion.sourceId` contra o `_id` de cada um dos 26 arquivos
  do vendor — 6/26 já presentes (batem exatamente as 6 compartilhadas).
- Varredura recursiva de `feats/class/inventor/level-*/` (54 arquivos) e de
  `feats/class/shared-class-feats/level-*/` (113 arquivos, filtrados por trait
  `inventor`) — 0 compartilhados. Segunda varredura dos 54 exclusivos procurando
  um segundo trait de classe em cada um — 0 encontrados.
- Leitura de `systems/pf2e/packs/feats-core/documents.json` (2205 docs) e
  cruzamento por `sourceId` E por `name` dos 54 candidatos — 0/54 em ambos os
  critérios.
- Varredura de `otherTags` com prefixo `inventor` em `class-features/**` — 1 eixo
  (`inventor-innovation`, 4 opções) — e leitura direta dos 4 arquivos-opção
  (`armor-innovation.json`, `construct-innovation.json`,
  `light-mortar-innovation.json`, `weapon-innovation.json`) e do granter
  (`innovation.json`), `rules[]` completos.
- Varredura de `otherTags` contendo "modification" em `class-features/**` — 46
  docs únicos (`weapon-innovation-modification`: 26, `armor-innovation-modification`:
  21, com 1 doc — "Rune Capacity" — nas duas), distribuídos L1=18/L7=14/L15=14; e
  leitura de `breakthrough-innovation.json`/`revolutionary-innovation.json` para
  confirmar que L7/L15 vêm dessas duas features já presentes no `items{}`.
  Cruzamento por `sourceId` contra `class-features-core` — 0/46 presentes.
- Leitura de `systems/pf2e/packs/equipment-core/documents.json` (249 docs) e busca
  por "Power Suit"/"Subterfuge Suit" (base da Armor Innovation) — 0/2 presentes;
  confirmados existindo no vendor em `equipment/power-suit.json` e
  `equipment/subterfuge-suit.json` (nível 0).
- Leitura de `actions/class/inventor/overdrive.json` (a ação concedida pela
  feature "Overdrive") e varredura do trait `unstable` nos 54 class feats — 7
  ocorrências.
- Varredura de `system.prerequisites.value` dos 54 candidatos (41 não-vazios,
  42 valores — 1 feat com 2 prerequisites) e classificação de cada texto
  (feat interno / feature interna / referência a opção de eixo / não-mecanizável
  / referência à árvore de modificação não-curada).
- Leitura de `packs/pf2e/iconics/*/` (25 personagens) extraindo `items.find(type
  === 'class').name` de cada — **Droven é o iconic do Inventor** (com o
  companheiro "Whirp"), refutando a premissa da tarefa. Leitura de
  `droven-level-{1,3,5}.json` para conferência independente não-circular.
- Leitura de `tools/importer-pf2e/src/curation/classes/gunslinger.json` e
  re-medição de 4 afirmações dele contra vendor fresco (peer review pedido pela
  tarefa) — ver §11.
- Leitura de `tools/importer-pf2e/src/curation/index.mjs`
  (`validateClassCuration`) para confirmar o formato aceito.
- Validação final: `node --input-type=module -e "import {validateClassCuration}
  ..."` — saída colada na seção 12.

## 2. Doc da classe (medido)

| Campo               | Valor                                                              |
| -------------------- | --------------------------------------------------------------------- |
| hp                  | **8**                                                               |
| keyAbility          | `["int"]` (opção única)                                            |
| perception          | 1 (trained em nível 1 — mais baixo que Thaumaturge/Gunslinger, ambos expert) |
| savingThrows        | fortitude 2 (expert), reflex 1 (trained), will 2 (expert)           |
| attacks             | simple 1, martial 1, unarmed 1 (trained), advanced 0                |
| defenses            | light 1, medium 1, unarmored 1 (trained), heavy 0                   |
| ancestryFeatLevels  | 1, 5, 9, 13, 17                                                     |
| classFeatLevels     | 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20                                |
| generalFeatLevels   | 3, 7, 11, 15, 19                                                    |
| skillFeatLevels     | 2, 4, 6, 8, 10, 12, 14, 16, 18, 20                                   |
| skillIncreaseLevels | 3, 5, 7, 9, 11, 13, 15, 17, 19                                       |
| trainedSkills       | `value: ["crafting"]`, `additional: 3`                              |
| spellcasting        | `0` (sem conjuração)                                                |
| classDC (no doc)    | ausente (`'classDC' in system` → `false`, mesmo padrão do Fighter/Thaumaturge) |

**Confirma a medição preliminar**: hp 8, atributo-chave int.

### `items{}` — 26 entradas, o maior volume da rodada (CONFIRMADO)

1/26 divergência entre `entry.name` e a uuid tail: nível 15, `entry.name`
`"Greater Weapon Specialization (Level 15)"` → uuid tail `"Greater Weapon
Specialization"` (mesmo padrão do gunslinger.json, mesma feature genérica).

3/26 divergências entre nível genérico do arquivo e nível do `items{}` da classe
(vão para `dedupe.collisionsDetected`):

| Feature                | Nível genérico | Nível `items{}` Inventor | Distância |
| ------------------------ | -------------- | -------------------------- | --------- |
| Reflex Expertise        | 3              | **7**                      | +4        |
| Perception Expertise    | 3              | **13**                     | **+10** (maior desta rodada) |
| Medium Armor Mastery    | 17             | **19**                     | +2 (mesma divergência do Gunslinger) |

As outras 23 batem exatamente. **26 features confirmadas, 6 já nos packs
confirmado** (Shield Block, Weapon Specialization, Reflex Expertise, Perception
Expertise, Medium Armor Mastery, Greater Weapon Specialization — todos os 6
cruzados por `sourceId`).

## 3. Anomalia "zero feats compartilhados / zero já em feats-core" — CONFIRMADA

A tarefa pedia para confirmar ou refutar. **Confirmada com duas medições
independentes**, não é erro de contagem:

1. Varredura recursiva de `feats/class/shared-class-feats/level-*/` (113
   arquivos) filtrando trait `inventor` → **0 resultados**. Nenhum feat
   compartilhado do vendor carrega esse trait.
2. Varredura dos 54 feats exclusivos do Inventor procurando um **segundo** trait
   de classe em cada um (lista de 27 slugs de classe) → **0 resultados**.
   Comparar: Thaumaturge tem 4/42 assim (Familiar, Enhanced Familiar,
   Incredible Familiar, Know-It-All); Fighter tem 38/110.

**Por quê**: nenhum feat do Inventor em Guns & Gears (nem expansões
posteriores presentes neste vendor snapshot) carrega trait de outra classe —
sem Familiar, sem os padrões cross-classe que Thaumaturge/Witch/Sorcerer
compartilham. O Inventor é a única das 12 classes desta rodada com esse
isolamento total. **54 candidatos = 54 exclusivos + 0 compartilhados**, e
**0/54 já em `feats-core`** (2205 docs, cruzado por `sourceId` E por `name` —
nenhuma colisão de nome também, logo nenhum precisa de sufixo desambiguador
tipo "(Inventor)").

## 4. A inovação é um ITEM, não só uma feature (medido em detalhe)

- **Armor Innovation**: concede uma de duas armaduras-base
  (`Compendium.pf2e.equipment-srd.Item.Power Suit` / `Subterfuge Suit`, nível
  0) via ChoiceSet+GrantItem. **Nenhuma das duas está em
  `equipment-core`** (249 docs, 0 match) — confirmadas existindo no vendor
  (`equipment/power-suit.json`, `equipment/subterfuge-suit.json`). **Mesma
  dívida de conteúdo já registrada pelo Alchemist.**
- **Weapon Innovation**: concede uma arma simples/marcial de nível 0 escolhida
  livremente pelo jogador (filtro genérico sobre o inventário de armas, não um
  item fixo) — sem dívida de conteúdo aqui.
- **Construct Innovation**: não concede item nenhum — o "item" dela é o
  companheiro de construto (fora do escopo desta rodada, junto com companheiro
  animal/eidolon, §9 do PLANO).

### Árvore de modificações — dívida declarada, medida com precisão

**46 docs únicos** de class-feature (Rune Capacity conta 1x, carrega as duas
tags) para as modificações de Weapon/Armor Innovation: **L1=18** (iniciais),
**L7=14** (breakthrough, concedidas por "Breakthrough Innovation", já no
`items{}`), **L15=14** (revolutionary, concedidas por "Revolutionary
Innovation", já no `items{}`). **0/46 já em `class-features-core`.** A lista de
opções em cada granter é resolvida por ChoiceSet + `allowedDrops` com
**predicate dinâmico sobre propriedades do item innovation escolhido**
(ex.: `weapon-innovation:melee`, `weapon-innovation:category:advanced`,
`{not: feature:dense-plating}` para excluir modificação já escolhida) — mesma
classe de limitação que o item 4 do ACHADOS-TRANSVERSAIS já registrou para a
árvore Adept/Paragon do Thaumaturge, com um grau a mais de dinamismo (depende
de propriedades do item, não só da opção de eixo). **Não incluída em
`choiceAxes`/`classFeatures`** — dívida declarada, documentada em `notes[]`.

**Construct Innovation** e **Light Mortar Innovation** (a 4ª opção do eixo)
têm suas próprias modificações **em prosa**, sem `@UUID` linkando a
class-features — dívida ainda maior (exigiria transcrição, não só wiring).

### Light Mortar Innovation — 4ª opção real, mas com efeito colateral não coberto

Confirmado via `otherTags: ["inventor-innovation"]`: é opção legítima do eixo,
seguindo a política já estabelecida (gunslinger.json/Way of the Spellshot:
"nada é descartado; requisito sugere, nunca bloqueia"). Mas ela também carrega
`class-archetype` (publicação *Pathfinder Battlecry!*, não Guns & Gears) e
**suprime/reordena** Inventive Expertise (9→7) e Inventive Mastery (17→15) via
`subfeatures.suppressedFeatures`, além de forçar "Munitions Master Dedication"
como feat de nível 2. Nada disso está refletido em `classFeatures`/`classFeats`
(que seguem o `items{}` padrão) — registrado como dívida explícita em
`notes[]`.

## 5. Eixo de sub-escolha — `inventor-innovation`

**Confirma 4 opções**, como a medição preliminar previu: Armor Innovation,
Construct Innovation, Light Mortar Innovation, Weapon Innovation — os 4
arquivos com `otherTags: ["inventor-innovation"]`. Granter: "Innovation"
(`items{}` nível 1), ChoiceSet filtrando `item:tag:inventor-innovation`,
GrantItem resolvendo a escolha. Escolha única, não repetível (diferente do
Thaumaturge). `featureNameInItemsMap: "Innovation"` casa exatamente com o
`items{}`.

## 6. Class feats

**Confirma 54 candidatos** (54 exclusivos + 0 compartilhados), como detalhado
no §3. Distribuição por nível: L1=7, L2=6, L4=6, L6=6, L8=6, L10=5, L12=6,
L14=4, L16=3, L18=3, L20=2 (soma 54). 0/54 já em `feats-core`.

## 7. Pré-requisitos

- **41 de 54** candidatos têm `system.prerequisites.value` não vazio (42
  valores — Dual-Form Weapon tem 2).
- **15 resolvem para dentro do conjunto de feats/features** (`internalChains`):
  8 pares feat→feat (Contingency Gadgets→Gadget Specialist, Gigavolt→Megavolt,
  Shared Overdrive→Overdrive Ally, Ubiquitous Overdrive→Shared Overdrive,
  Xidao Sea Mine Drop→Diving Armor, Gigaton Strike→Megaton Strike, Incredible
  Construct Companion→Advanced Construct Companion, Ubiquitous Gadgets→Gadget
  Specialist) + 6 pares feat→feature do `items{}` (Distracting
  Explosion/Helpful Tinkering/Boost Modulation/Persistent Boost→Offensive
  Boost; Dual-Form Weapon→Expert Overdrive; Overdrive Ally→Overdrive) + 1 par
  com **texto do vendor não batendo o nome canônico**: Paragon Companion exige
  "Incredible Companion", mas o feat do Inventor se chama **"Incredible
  Construct Companion"** (há também "Incredible Companion (Druid)" e
  "Incredible Companion (Ranger)" no vendor — família de nomes por classe, o
  Inventor não segue o padrão de sufixo). Declarado em `prerequisiteFixes`
  (kind "rename") para não deixar a cadeia quebrada.
- **24 referenciam uma opção do eixo `inventor-innovation`**, um padrão NOVO
  não visto nas classes já curadas desta rodada (nem "chain" nem "fora da
  seleção" — dependem de qual opção do eixo foi escolhida). Documentado em
  `prerequisites.axisOptionReferences`: 19 apontam para uma opção específica
  ("armor innovation"/"construct innovation"/"weapon innovation"/"construct
  companion" — as duas últimas resolvidas para "Construct Innovation") e 5 são
  disjunção ("armor, construct, or weapon innovation" → Full Automation,
  Megaton Strike, Clockwork Celerity, Silk Bracelet, Guardian Lion Roar).
- **1 referencia a árvore de modificação não-curada**: Manifold Modifications →
  "initial modification" — não há doc fixo para apontar (a árvore de 46 é
  dívida declarada, §4); preservado como `referencesOutsideSelection`.
- **2 são não-mecanizáveis** (texto de perícia): Reverse Engineer → "trained in
  Crafting"; Gadget Specialist → "expert in Crafting".
- **0 referenciam outra classe** — nenhuma aresta sai do universo
  Inventor+eixo+árvore-de-modificação.

## 8. Preparação para multiclasse

Gate derivado para os 54 exclusivos: trait `inventor` + `category:"class"` →
`{"class_level":{"inventor":{">=":N}}}`, sem ambiguidade (0/54 com segundo
trait de classe, §3). 0/54 com trait `archetype`.

## 9. Conjuração e focus spells

**Confirma "sem conjuração"**: `system.spellcasting` do doc de classe = `0`;
varredura das 1796 magias do vendor por trait `inventor` = 0. `spellcasting:
null`, `focusSpells: {names: [], alreadyInPacks: []}`.

## 10. Unstable / Overdrive

Confirmado como mecânica de risco por uso, **dívida declarada, sem predicado
inventado**. "Overdrive" (`items{}` L1) concede a ação `actions/class/
inventor/overdrive.json`: `Check[crafting]` com DC de nível, 4 graus de
sucesso (crítico: dano extra 1 min + trava 1 min; sucesso: metade do dano
extra; falha: 1 dano de fogo extra; falha crítica: dano de fogo no próprio
Inventor + trava 1d4 rodadas). O trait `unstable` é formal — **7 dos 54 feats**
o carregam (Explosive Leap, Haphazard Repair, Geobukseon Retaliation, Oil
Fire, Searing Restoration, Wukong Extension, Clockwork Celerity). Nada disso
tem onde morar no schema hoje.

## 11. Peer review do `gunslinger.json` (pedido explícito da tarefa)

**Nenhum defeito encontrado.** Re-medi 4 afirmações do arquivo contra vendor
fresco:

1. Total de class feats: 74 = 66 exclusivos (byLevel medido
   `{1:7,2:5,4:5,6:10,8:5,10:8,12:7,14:8,16:4,18:4,20:3}`, bate
   `measuredExclusiveDir: 66`) + 8 compartilhados com trait `gunslinger`. O
   `byLevel` combinado (74) do arquivo reconcilia exatamente: as diferenças
   nível a nível entre exclusivo e combinado somam 8 (L2:+1, L4:+2, L6:+2,
   L8:+2, L10:+1).
2. Eixo `gunslinger-way`: 6 arquivos com `otherTags: ["gunslinger-way"]` — bate
   `optionCount: 6` e os 6 `optionNames`.
3. `items{}` do Gunslinger tem 17 entradas — bate a soma
   `sharedWithOtherClasses`(6) + `missingFromPacks`(11) = 17.
4. As 3 `levelDivergences` declaradas (Medium Armor Expertise 11→13, Medium
   Armor Mastery 17→19, Perception Legend 13→19) reproduzem exatamente contra
   leitura fresca dos 3 arquivos genéricos (11/17/13 respectivamente).

Não encontrei o padrão do defeito da r28 (36 docs de Gunslinger/Psychic sem
descrição pt-BR) — não se manifesta neste artefato, que é medição
(nomes/níveis/contagens) sem descrição nenhuma; a tradução acontece em fase
posterior do pipeline.

## 12. Cruzamento independente — REFUTANDO a premissa da tarefa

A tarefa afirmava "não há pregen de Inventor nos `iconics/`". **Isso está
errado**: `tools/importer-pf2e/vendor/pf2e/packs/pf2e/iconics/droven/` é o
iconic do Inventor (Droven, humano Dromaar, com o companheiro de construto
"Whirp" como personagem próprio/anexo). Usei os 3 níveis (1/3/5) do Droven como
fonte de conferência independente e não-circular (antídoto #48). **Confirma
tudo, sem divergência**: nível 1 — Peerless Inventor, Shield Block, Explode,
Overdrive, Innovation (todos `items{}` L1) + escolheu Construct Innovation
(eixo) + Built-In Tools/Explosive Leap (class feats L1, o segundo com trait
`unstable`); nível 3 — Reconfigure, Expert Overdrive (`items{}` L3) + Searing
Restoration (class feat L2, `unstable`); nível 5 — Inventor Weapon Expertise
(`items{}` L5) + Advanced Construct Companion (class feat L4).

## 13. Riscos, dívidas e perguntas em aberto para a integração central

1. **Árvore de modificações (46 docs, L1/L7/L15)** — mesma lacuna de schema já
   registrada para o Thaumaturge (ACHADOS item 4), com um grau a mais: o
   predicado depende de propriedades do item escolhido no eixo, não só da
   opção do eixo. Não incluída nesta curadoria.
2. **Modificações de Construct Innovation e Light Mortar Innovation** — em
   prosa, sem `@UUID`. Exigem transcrição, não só wiring, se algum dia forem
   mecanizadas.
3. **Power Suit / Subterfuge Suit ausentes de `equipment-core`** — bloqueiam
   Armor Innovation ficar jogável de ponta a ponta. Mesma dívida do Alchemist.
4. **Light Mortar Innovation muda a progressão de 2 features já em `items{}`**
   (Inventive Expertise/Mastery) e força um feat de nível 2 — nenhuma
   representação de "variante de progressão por opção de eixo" existe hoje.
   Mesma extensão de contrato que cleric.json e gunslinger.json já pediram.
5. **`prerequisites.axisOptionReferences`** (24 casos, novo padrão) — a
   integração central quer isso como um `predicate` real (ex.:
   `{"item:tag":"inventor-innovation-weapon"}`, dado que hoje não existe um
   jeito de expressar "ter escolhido a opção X do eixo Y" no formato de
   `class_level`) ou fica como documentação textual permanente?
6. **`prerequisiteFixes` de "Incredible Companion"→"Incredible Construct
   Companion"** — aplicado aqui seguindo o mecanismo já existente
   (issues #26/#28/#30/#46); revisar se a integração concorda com a leitura.
7. **Gate `class_level` com múltiplos traits de classe** (pergunta repetida
   pela 4ª vez, ver fighter.json/druid.json/thaumaturge.json) — não se aplica
   ao Inventor (0/54 com segundo trait), mas resta como pendência geral.

## Achados transversais (ACHADOS-TRANSVERSAIS.md)

- **Item 1 (KNOWN_CLASS_TRAITS)**: `inventor` está entre os 6 traits faltantes
  citados no ACHADOS — confirmado aqui também: o Inventor não está em nenhum
  dos dois `KNOWN_CLASS_TRAITS` (`planVM.ts`/`characterSheetVM.ts`). Como
  0/54 feats do Inventor "parecem taggeados" sem o trait estar na lista (mesmo
  mecanismo do defeito do Psychic), os 54 feats do Inventor vazariam para o
  picker de QUALQUER classe até essa lista ser atualizada — mais 54 casos
  somados aos 44 já quantificados do Psychic.
- **Item 4 (eixo repetível/com progressão)**: a árvore de modificações do
  Inventor (§4/§13.1) é uma variante ADICIONAL desta mesma lacuna — não
  "eixo repetível" como o Thaumaturge, mas "opções filtradas por propriedade
  do item escolhido no eixo", um grau a mais de dinamismo que a decisão da
  integração central (ainda pendente, "1 decisão só, não N") precisa cobrir.
- **Item 9 (gate multi-trait)**: não se aplica ao Inventor (§3) — primeira
  classe da rodada sem essa ambiguidade.

## 14. Validação (§5 do PLANO.md)

```
$ node --input-type=module -e "import {validateClassCuration} from './tools/importer-pf2e/src/curation/index.mjs'; import {readFileSync} from 'node:fs'; const f='inventor.json'; const cfg=validateClassCuration(JSON.parse(readFileSync('tools/importer-pf2e/src/curation/classes/'+f,'utf8')), f); console.log('OK', cfg.class, 'eixos:', cfg.choiceAxes.length, 'feats.trait:', cfg.classFeats.trait);"
OK inventor eixos: 1 feats.trait: inventor
```
