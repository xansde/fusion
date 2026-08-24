# r29 — Swashbuckler — relatório de curadoria

Arquivo de configuração produzido: `tools/importer-pf2e/src/curation/classes/swashbuckler.json`.

## 1. Método (comandos rodados)

Todas as contagens vieram de scripts `node -e` (Node 22, sem dependências) rodados
contra `tools/importer-pf2e/vendor/pf2e/packs/pf2e/` (fonte, somente leitura) e
`systems/pf2e/packs/*/documents.json` (packs atuais do Fusion), nesta sessão, no
diretório da worktree. Nenhum arquivo compartilhado foi tocado; nenhum `git`,
`pnpm` ou importer foi rodado. Os scripts descartáveis (inline `node -e`, e um
dump intermediário em `feats.json` no scratchpad da sessão, fora da worktree)
não foram persistidos no repo. Comandos relevantes, reconstruíveis a partir
deste relatório:

- Leitura direta de `classes/swashbuckler.json` do vendor (`system.hp`,
  `keyAbility`, `perception`, `savingThrows`, `attacks`, `defenses`, os quatro
  `*FeatLevels`, `skillIncreaseLevels`, `trainedSkills`, `spellcasting`,
  `classDC in system`, `items{}` — 24 entradas).
- Comparação `entry.name` × segmento final de `entry.uuid` para as 24 entradas
  de `items{}` — 2 divergências.
- Para cada uma das 24: leitura do arquivo genérico em `class-features/<slug>.json`
  e comparação `system.level.value` (genérico) × `level` do `items{}` — 1
  divergência (Perception Mastery).
- Varredura das 27 pastas de `classes/*.json`, união dos nomes canônicos de
  `items{}` de cada uma, para achar as features compartilhadas do Swashbuckler.
- Leitura de `systems/pf2e/packs/class-features-core/documents.json` (318 docs)
  e cruzamento por `flags.fusion.sourceId` contra o `_id` das 24 features do
  vendor — 8 já presentes.
- Varredura completa dos 842 arquivos de `class-features/**` por `otherTags`
  com prefixo `swashbuckler` — 6 arquivos (as 6 opções do eixo), todas
  `category="classfeature"`, `level=1`, tag única `swashbuckler-style`.
- Leitura direta dos 6 arquivos de estilo (`battledancer.json` ..
  `wit.json`) e do arquivo `swashbucklers-style.json` (a feature concessora)
  — `rules[]`, `_id`, `level` completos.
- Leitura direta de `panache.json` (a feature `Panache` do `items{}`) e do
  campo `system.description.value` para localizar a referência
  `Compendium.pf2e.feat-effects.Item.Effect: Panache` — confirma a existência
  de um pack `feat-effects` no vendor (`ls vendor/pf2e/packs/pf2e/ | grep
  feat-effect`), fora do escopo de varredura desta rodada.
- Varredura recursiva de `feats/class/swashbuckler/level-*/` (62 arquivos) e
  de `feats/class/shared-class-feats/level-*/` (113 arquivos, filtrados para
  os 11 com trait `swashbuckler`) — a pasta `shared-class-feats` é subdividida
  por nível (mesma armadilha já documentada no relatório do Fighter).
- Leitura de `systems/pf2e/packs/feats-core/documents.json` (2205 docs) e
  cruzamento por `sourceId`: 0/62 exclusivos já presentes; 11/11
  compartilhados já presentes.
- Extração de `traits`, `prerequisites.value`, `system.rules` e
  `system.description.value` dos 73 candidatos (salvos em
  `scratchpad/swash/feats.json`, fora da worktree) para: (a) contagem do
  trait `finisher`; (b) contagem de menções a "panache" em descrição e em
  `rules` (regex `/panache/i` e busca literal por `self:effect:panache` /
  `Effect: Panache`); (c) classificação dos 31 textos de
  `prerequisites.value` (13 internos, 2 externos, 16 não-mecanizáveis); (d)
  contagem de feats com 2+ traits de classe (11, todos os compartilhados).
- Leitura de `journals/remaster-changes.json` (7 páginas HTML) filtrando
  linhas de tabela (`<tr`) que citam "swashbuckler" — 4 entradas, todas
  `Renamed`, cruzadas contra os 31 textos de prerequisites.
- Leitura de `iconics/jirelle/jirelle-level-{1,3,5}.json` (o iconic do
  Swashbuckler) para conferência independente (não-circular).
- Leitura de `tools/importer-pf2e/src/curation/index.mjs`
  (`validateClassCuration`) e de `tools/importer-pf2e/src/build-mvp-subset.mjs`
  (`GRANT_TARGET_DEDICATION_NAMES`, `GRANT_TARGET_CLASS_FEATURE_NAMES`,
  `isFeatsCoreDoc`) — só leitura, para avaliar se os 3 feats gerais
  concedidos pelos styles (Fascinating Performance, Dirty Trick, Bon Mot)
  precisam de alguma entrada nova nessas listas (não precisam — já estão em
  `feats-core`).
- Validação final: `node --input-type=module -e "import {validateClassCuration}
  ..."` (comando do §5 do PLANO.md) — saída colada na seção 11.

## 2. Doc da classe (medido)

| Campo               | Valor                                                                 |
| -------------------- | --------------------------------------------------------------------- |
| hp                  | **10**                                                                |
| keyAbility          | `["dex"]` (opção única, sem par tipo dex/str do Fighter/Exemplar)     |
| perception          | 2 (expert em nível 1)                                                 |
| savingThrows        | fortitude 1 (trained), reflex 2 (**expert**), will 2 (**expert**)     |
| attacks             | simple 1, martial 1, unarmed 1 (trained), advanced 0                  |
| defenses            | light 1, unarmored 1 (trained), medium 0, heavy 0                     |
| ancestryFeatLevels  | 1, 5, 9, 13, 17                                                       |
| classFeatLevels     | 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20                                 |
| generalFeatLevels   | 3, 7, 11, 15, 19                                                      |
| skillFeatLevels     | **2, 3, 4, 6, 7, 8, 10, 12, 14, 15, 16, 18, 20** (13 valores)         |
| skillIncreaseLevels | 3, 5, 7, 9, 11, 13, 15, 17, 19                                        |
| trainedSkills       | `value: ["acrobatics"]`, `additional: 4`                              |
| spellcasting        | `0` (sem conjuração)                                                  |
| classDC (no doc)    | **ausente** (`'classDC' in system` → `false`, igual a Fighter/Thaumaturge) |

**Confirma a medição preliminar**: hp 10, atributo-chave dex. Dois achados que
a medição preliminar não capturava:

1. **Saves iniciais incomuns**: o Swashbuckler começa com **dois** saves em
   expert (reflex e will) e só fortitude fica trained — o oposto do padrão
   "um save alto" da maioria das classes marciais. Fortitude só alcança
   expert em L3 (Fortitude Expertise).
2. **`skillFeatLevels` tem 13 entradas, não 10**: além da progressão padrão
   par (2,4,6,8,10,12,14,16,18,20), o Swashbuckler ganha slots extras nos
   níveis **3, 7, 15**. Medido diretamente do vendor, não é erro de
   transcrição.

### `items{}` — 24 entradas, nome canônico = segmento final da uuid

**Confirma 24 features (8 já nos packs)**, como a medição preliminar previu.
**2/24 divergências** entre `entry.name` e a uuid tail (armadilha da família
Magus/Lightning Reflexes):

| Nível (`items{}`) | Feature (label)                | Nível genérico do arquivo | Divergência de nível? | Divergência de nome (canônico)? |
| ------------------ | -------------------------------- | -------------------------- | ----------------------- | ---------------------------------- |
| 1                  | Confident Finisher               | 1                          | não                     | não                                |
| 1                  | Panache                          | 1                          | não                     | não                                |
| 1                  | Precise Strike                   | 1                          | não                     | não                                |
| 1                  | Stylish Combatant                | 1                          | não                     | não                                |
| 1                  | Swashbuckler's Style             | 1                          | não                     | não                                |
| 3                  | Fortitude Expertise              | 3                          | não                     | não                                |
| 3                  | Opportune Riposte                | 3                          | não                     | não                                |
| 3                  | Stylish Tricks                   | 3                          | não                     | não                                |
| 3                  | Vivacious Speed                  | 3                          | não                     | não                                |
| 5                  | Weapon Expertise                 | 5                          | não                     | não                                |
| 7                  | Confident Evasion                | 7                          | não                     | não                                |
| 7                  | Weapon Specialization            | 7                          | não                     | não                                |
| 9                  | Exemplary Finisher               | 9                          | não                     | não                                |
| 9                  | Swashbuckler Expertise           | 9                          | não                     | não                                |
| 11                 | Continuous Flair                 | 11                         | não                     | não                                |
| 11                 | Vigilant Senses                  | **7**                      | **SIM**                 | **SIM** → canônico "Perception Mastery" |
| 13                 | Assured Evasion                  | 13                         | não                     | não                                |
| 13                 | Light Armor Expertise            | 13                         | não                     | não                                |
| 13                 | Weapon Mastery                   | 13                         | não                     | **SIM** → canônico "Martial Weapon Mastery" |
| 15                 | Greater Weapon Specialization    | 15                         | não                     | não                                |
| 15                 | Keen Flair                       | 15                         | não                     | não                                |
| 17                 | Reinforced Ego                   | 17                         | não                     | não                                |
| 19                 | Eternal Confidence                | 19                         | não                     | não                                |
| 19                 | Light Armor Mastery              | 19                         | não                     | não                                |

**Uma divergência de nível**: Perception Mastery diz nível genérico 7, mas o
Swashbuckler concede em 11 (label "Vigilant Senses" no `items{}`). **Duas
divergências de nome**: "Vigilant Senses"→"Perception Mastery" (a mesma
feature da divergência de nível acima) e "Weapon Mastery"→"Martial Weapon
Mastery" (sem divergência de nível: genérico 13 = items{} 13). Nível 13 é o
mais carregado, com três features simultâneas.

## 3. Features compartilhadas com outras classes (união de `items{}` das 27 classes)

8 das 24 features do Swashbuckler aparecem em `items{}` de outras classes:

| Feature                        | Nº classes | Classes (amostra)                                                                              |
| -------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| Weapon Specialization            | 25         | quase todas                                                                                         |
| Weapon Expertise                  | 14         | Champion, Druid, Exemplar, Guardian, Investigator, Kineticist, Magus, Oracle, Psychic, Sorcerer, Swashbuckler, Thaumaturge, Witch, Wizard |
| Greater Weapon Specialization    | 13         | Champion, Commander, Fighter, Guardian, Gunslinger, Inventor, Investigator, Magus, Monk, Ranger, Rogue, Swashbuckler, Thaumaturge |
| Perception Mastery                | 10         | Barbarian, Bard, Commander, Exemplar, Gunslinger, Investigator, Ranger, Rogue, Swashbuckler, Thaumaturge |
| Fortitude Expertise               | 7          | Animist, Bard, Commander, Druid, Investigator, Psychic, Swashbuckler                                |
| Light Armor Expertise             | 6          | Bard, Investigator, Kineticist, Oracle, Rogue, Swashbuckler                                         |
| Martial Weapon Mastery            | 4          | Champion, Investigator, Ranger, Swashbuckler                                                        |
| Light Armor Mastery               | 4          | Investigator, Kineticist, Rogue, Swashbuckler                                                       |

As outras 16 features (Panache, Precise Strike, Confident Finisher, Stylish
Combatant, Swashbuckler's Style, Opportune Riposte, Stylish Tricks, Vivacious
Speed, Confident Evasion, Exemplary Finisher, Swashbuckler Expertise,
Continuous Flair, Assured Evasion, Reinforced Ego, Eternal Confidence, Keen
Flair) são exclusivas do Swashbuckler.

## 4. Já existe nos packs (`class-features-core`, 318 docs) — REUSAR

As 8 features do §3 já estão presentes por `flags.fusion.sourceId`: Weapon
Specialization, Weapon Expertise, Greater Weapon Specialization, Perception
Mastery, Light Armor Mastery, Light Armor Expertise, Fortitude Expertise,
Martial Weapon Mastery. Faltam as 16 exclusivas listadas acima.

## 5. Eixo de sub-escolha — `swashbuckler-style`

**Confirma 6 opções**, como a medição preliminar previu.

- Battledancer, Braggart, Fencer, Gymnast, Rascal, Wit — todas
  `category="classfeature"`, `level=1`, `otherTags=["swashbuckler-style"]`.
  0/6 já em `class-features-core`.
- **Feature concessora**: "Swashbuckler's Style" (`items{}` nível 1) é um
  `ChoiceSet` com `filter: ["item:tag:swashbuckler-style"]` + `GrantItem` do
  escolhido — mesma forma exata do `druid-order`.
- **Vínculo style→perícia, medido rule a rule**: cada estilo sobe UMA
  perícia diferente para treinada via `ActiveEffectLike` (`path:
  system.skills.<skill>.rank`, `mode: "upgrade"`, `value: 1`): Battledancer→
  Performance, Braggart→Intimidation, Fencer→Deception, Gymnast→Athletics,
  Rascal→Thievery, Wit→Diplomacy.
- **3 dos 6 estilos também concedem um feat geral/skill grátis** via
  `GrantItem` com `predicate: ["class:swashbuckler"]`: Battledancer→
  Fascinating Performance, Rascal→Dirty Trick, Wit→Bon Mot (Braggart/Fencer/
  Gymnast não concedem feat extra). Os 3 alvos já estão em `feats-core`
  (categoria "skill", trait "general"+"skill", trazidos por outra
  curadoria) — caminho feliz, sem dívida.
- **É A MESMA DÍVIDA que o Druid registrou para a perícia da ordem**: nada
  no pipeline hoje aplica o treino de perícia vindo de uma opção de eixo
  escolhida. **Confirmado NÃO-circular pela ficha da Jirelle**: ela escolhe
  o estilo Fencer (treina Deception) e tem o class feat "Goading Feint" (L1,
  `prerequisites.value` = "trained in Deception") — a própria pregen oficial
  só faz sentido mecânico se a perícia do estilo for aplicada. É prova viva
  de que a dívida não é só teórica.

## 6. Class feats

**Confirma 73 candidatos**, como a medição preliminar previu:

- **62** exclusivos em `feats/class/swashbuckler/level-*/` (L1=9, L2=9, L4=8,
  L6=4, L8=7, L10=7, L12=4, L14=4, L16=3, L18=3, L20=4 — soma 62).
- **11** de `shared-class-feats/` com trait `swashbuckler`: You're Next (L1,
  +rogue), Corpse-Killer's Defiance (L10, +barbarian), Dazzling Display
  (L10, +fighter/ranger/rogue), Fane's Fourberie (L2, +rogue), Devrin's
  Dazzling Diversion (L4, +rogue), Masquerade of Seasons Stance (L4,
  +bard/rogue), Pirouette (L6, +bard/rogue), Reactive Strike (L6,
  +barbarian/champion/commander/exemplar/guardian/magus), Stella's Stab and
  Snag (L6, +rogue), Grand Dance (L8, +bard/rogue), Knight's Retaliation
  (L8, +fighter).
- **Total candidato: 73.** Todos `category === "class"`, 0 com trait
  `archetype`, 0 nomes duplicados.
- **11 de 11 compartilhados já em `feats-core`** por `sourceId` (reusados de
  Barbarian/Bard/Champion/Commander/Exemplar/Fighter/Guardian/Magus/Ranger/
  Rogue, curados em rodadas anteriores). **0 de 62 exclusivos já em pack.**

Distribuição por nível (exclusivos + compartilhados): L1=10, L2=10, L4=10,
L6=7, L8=9, L10=9, L12=4, L14=4, L16=3, L18=3, L20=4 (soma 73).

## 7. Pré-requisitos

- **30 de 73** candidatos têm `system.prerequisites.value` não vazio,
  totalizando **31 entradas** (Flamboyant Leap tem 2 entradas separadas —
  AND, não disjunção escrita numa string só).
- **13 resolvem para dentro do conjunto** (feat ou feature do próprio
  Swashbuckler): Flying Blade→"precise strike" (feature, minúsculo, mesmo
  padrão de "shield block" no Fighter); Twirling Throw→Flying Blade;
  Precise Finisher→Confident Finisher (feature); Flashy Roll→Flashy Dodge;
  Dueling Dance (Swashbuckler)→Extravagant Parry; Reflexive
  Riposte/Impossible Riposte/Parry and Riposte→Opportune Riposte (feature,
  3 feats diferentes apontando para a mesma feature); Incredible Luck
  (Swashbuckler)→Charmed Life; Vivacious Afterimage→"vivacious speed"
  (feature, minúsculo); Flamboyant Leap→Flamboyant Athlete (segunda
  entrada); Pirouette e Grand Dance→Masquerade of Seasons Stance.
- **2 apontam para fora do conjunto**: Focused Fascination→"Fascinating
  Performance" (feat geral/skill, categoria "skill", já em `feats-core`, mas
  sem trait `swashbuckler`); Twinned Defense (Swashbuckler)→"Twin Parry"
  (feat exclusivo do Fighter, trait `fighter`).
- **16 são não-mecanizáveis** (texto de perícia/proficiência/atributo
  preservado, sem predicado inventado): "trained in Deception" (2x —
  Goading Feint, Devrin's Dazzling Diversion), "trained in Diplomacy" (One
  for All), "trained in Acrobatics" (Plummeting Roll), "expert in
  Intimidation" (2x — Get Used to Disappointment, Dazzling Display),
  "master in Athletics" (Flamboyant Leap, primeira entrada), "precise
  strike 6d6" (Lethal Finisher — condição de escala de dano da feature
  Precise Strike, não referência a documento), "Charisma +2" (Charmed
  Life), "expert in Athletics" (2x — Flamboyant Athlete, Agile Maneuvers),
  "trained in Performance" (2x — Leading Dance, Masquerade of Seasons
  Stance), "trained in Intimidation" (You're Next), "expert in Thievery"
  (Stella's Stab and Snag), "trained in Athletics" (Knight's Retaliation).

Total: 13 + 2 + 16 = 31 — confere com o total de entradas.

**Armadilha "condicionado ao estilo/implemento escolhido" — REFUTADA pelos
dados**: nenhum dos 31 textos de prerequisites cita o nome de um estilo
específico (ex.: "Fencer" ou "Rascal"). Os gates ligados a estilo são
implícitos via perícia (ex.: Goading Feint exige "trained in Deception", que
só o Fencer garante de graça) — não bloqueiam a ficha diretamente.

## 8. Preparação para multiclasse

- Gate derivado para os 62 exclusivos: trait `swashbuckler` +
  `category:"class"` → `{"class_level":{"swashbuckler":{">=":N}}}`, sem
  ambiguidade.
- Os 11 compartilhados têm a mesma ambiguidade "any entre as classes do
  trait" já registrada em `fighter.json`/`druid.json`/`thaumaturge.json`
  (não resolvida aqui, decisão da integração central).
- 0/73 com trait `archetype`. "Swashbuckler Dedication" não entra nesta
  rodada (fora do escopo §9 do plano).

## 9. Conjuração e focus spells

**Confirma "sem conjuração" e "0 magias"**, como a medição preliminar
previu. `system.spellcasting` do doc de classe = `0`; varredura das 1797
magias do vendor por trait `swashbuckler` = 0 arquivos. `spellcasting: null`,
`focusSpells: {names: [], alreadyInPacks: []}`.

## 10. Panache — estado de jogo vs. seleção (a armadilha específica da tarefa)

**Confirmada, não refutada.** Medido nos 73 candidatos:

- **31/73 (42%)** mencionam "panache" na descrição ou nas `rules`.
- **15/73** usam de fato um **predicado mecanizado** `self:effect:panache`
  num `RollOption` com `disabledIf` (Derring-Do, Stumbling/Targeting/Mobile/
  Perfect/Revitalizing/Lethal/Retreating/Unbalancing/Bleeding/Dual/Stunning
  Finisher, Flamboyant Athlete, Impaling Finisher, Twirling Throw).
- **2** referenciam o item de efeito diretamente via `Note` (Elegant
  Buckler, Flashy Dodge, ambos citando
  `Compendium.pf2e.feat-effects.Item.Effect: Panache`).
- **16** só mencionam panache em prosa, sem predicado nas `rules`.
- **ZERO dos 73** usa panache em `system.prerequisites.value` — é estado de
  turno-a-turno (o ator tem ou não o efeito "Effect: Panache" ativo agora),
  **nunca** um requisito de seleção do feat. Nenhum predicado de seleção foi
  inventado; o texto de estado ficou como está nas `rules`/descrição
  originais.
- **Dívida declarada**: o item "Effect: Panache" que sustenta o predicado
  vive no pack do vendor `feat-effects/` (confirmado: `ls
  vendor/pf2e/packs/pf2e/ | grep feat-effect` retorna a pasta), que **não
  faz parte da varredura desta rodada** (class-features/feats/spells/
  journals/iconics, conforme roteiro do §6 do PLANO). A feature "Panache"
  (items{} nível 1, canônica) é um class-feature normal e entra nesta
  curadoria; o efeito de ATOR que liga/desliga em combate é um documento de
  outro pack, fora do escopo — registrado para a integração central decidir
  se `feat-effects` entra numa rodada futura.

## 11. Finishers

**14/73** candidatos carregam o trait `finisher`: Stumbling/Targeting/
Mobile/Perfect/Revitalizing/Lethal/Retreating/Unbalancing/Bleeding/Dual/
Illimitable Finisher, Impaling Finisher, Twirling Throw. **Nenhuma
dependência interna entre finishers** — nenhum tem outro finisher como
prerequisite. A única cadeia envolvendo um finisher é Twirling
Throw→Flying Blade (Flying Blade não é finisher). "Lethal Finisher" (L18)
tem prerequisite textual "precise strike 6d6" — condição de escala de dano
da própria feature Precise Strike, não referência a documento (mesma
família de "master in Survival"/"Strength +4" que o Druid já registrou).
"Illimitable Finisher" (L20) é o único finisher **sem** o predicado
`self:effect:panache` — por design ele independe de panache, e sua
descrição referencia `@UUID` a feature "Panache" (items{} L1) diretamente.

## 12. Validação (§5 do PLANO.md)

```
$ node --input-type=module -e "import {validateClassCuration} from './tools/importer-pf2e/src/curation/index.mjs'; import {readFileSync} from 'node:fs'; const f='swashbuckler.json'; const cfg=validateClassCuration(JSON.parse(readFileSync('tools/importer-pf2e/src/curation/classes/'+f,'utf8')), f); console.log('OK', cfg.class, 'eixos:', cfg.choiceAxes.length, 'feats.trait:', cfg.classFeats.trait);"
OK swashbuckler eixos: 1 feats.trait: swashbuckler
```

## 13. Riscos, dívidas e perguntas em aberto para a integração central

1. **`feat-effects` fora do escopo** (§10): sem o pack `feat-effects`, os 15
   feats com predicado `self:effect:panache` (e os 2 com `Note` referenciando
   "Effect: Panache") carregam uma condição que nunca resolve
   true/false em jogo. Entra numa rodada futura?
2. **Perícia por opção de eixo não aplicada** (§5): mesma dívida do Druid,
   confirmada de novo aqui e provada não-circular pela própria ficha da
   Jirelle (Fencer→Deception→Goading Feint). Duas classes já bateram nessa
   lacuna — vale a pena resolver antes da 3ª.
3. **Gate `class_level` com múltiplos traits de classe** (§8): mesma
   pergunta já registrada em fighter.json/druid.json/thaumaturge.json para
   os 11 feats compartilhados — não resolvida aqui.
4. **`remaster-changes.json` — interseção vazia, registrada como resultado**:
   as 4 entradas do journal citando Swashbuckler (todas "Renamed") não
   colidem com nenhum dos 31 textos de prerequisites — os dois casos que
   citam os nomes renomeados (Extravagant Parry, Flashy Dodge) já usam o
   nome novo no vendor. `prerequisiteFixes: []`.

## 14. Nenhuma lacuna do ACHADOS-TRANSVERSAIS.md atingida diretamente

- **Item 1 (KNOWN_CLASS_TRAITS)**: `swashbuckler` está na lista dos 6 traits
  faltantes citados no achado — a mesma correção de arquivo compartilhado
  (`planVM.ts`/`characterSheetVM.ts`) vai precisar incluir `swashbuckler`
  quando a classe for publicada. Não é um achado novo desta classe, é a
  confirmação de que ela também está na lista.
- **Item 2 (repertório de conjuração espontânea)**: não se aplica — Swashbuckler
  não conjura.
- **Item 3 (conjuração dupla)**: não se aplica.
- **Item 4 (eixo repetível/com progressão)**: não se aplica — `swashbuckler-style`
  é um eixo simples de nível único (L1), sem reabertura nem progressão, ao
  contrário de Thaumaturge/Animist/Exemplar.
- **Item 5 (R3 quebrada — nome de eixo ≠ slug da classe)**: não se aplica —
  `swashbuckler-style` segue a convenção `<classe>-<eixo>` normalmente.
