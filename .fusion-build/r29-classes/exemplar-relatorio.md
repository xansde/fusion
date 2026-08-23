# r29 — Exemplar — relatório de curadoria

Arquivo de configuração produzido: `tools/importer-pf2e/src/curation/classes/exemplar.json`.

## 1. Método (comandos rodados)

Todos os números abaixo vieram de scripts `node` executados contra
`tools/importer-pf2e/vendor/pf2e/packs/pf2e/` (fonte, somente leitura) e
`systems/pf2e/packs/*/documents.json` (packs atuais do Fusion), escritos no
scratchpad (`scratchpad/exemplar/step1..step9-*.mjs`), fora da worktree.
Nenhum arquivo compartilhado foi tocado; nenhum `git`, `pnpm` ou importer foi
rodado. Passos:

1. `step1-items.mjs` — leu `classes/exemplar.json`, casou os 20 `items{}` por
   **segmento final da uuid** (nunca `entry.name`) contra os 842 arquivos de
   `class-features/**` (varredura recursiva), e comparou nível do `items{}`
   contra `system.level.value` do arquivo genérico.
2. `step2-axes.mjs` / `step3-verify-nesting.mjs` — varreram `class-features/**`
   procurando `system.traits.otherTags` com prefixo `exemplar-`, agruparam por
   tag e verificaram interseção real entre os 7 grupos (cross-tagging,
   uniformidade de nível, trait `value`, `system.category`).
3. `step4-feats.mjs` — varredura recursiva de `feats/class/exemplar/level-*/`
   (47 arquivos) e `feats/class/shared-class-feats/level-*/` (113 arquivos,
   filtrados para trait `exemplar`).
4. `step5-cf-overlap.mjs` — cruzou os 20 `items{}` e os 39 docs de opção de
   eixo contra `systems/pf2e/packs/class-features-core/documents.json` (318
   docs) por `flags.fusion.sourceId`; cruzou os 49 candidatos de feat contra
   `feats-core` (2205 docs) pelo mesmo campo.
5. `step6-prereqs.mjs` — extraiu `system.prerequisites.value` dos 49
   candidatos.
6. `step7-shared-features.mjs` — varredura das 27 pastas `classes/*.json` do
   vendor contando quantas referenciam cada um dos 20 nomes canônicos do
   Exemplar via `items{}`.
7. `step9-derive-real.mjs` — chamou **a função de produção real**
   `deriveProficiencyUpgrades` (importada de
   `tools/importer-pf2e/src/curation/proficiency-upgrades.mjs`, a mesma que
   `transform.mjs` usa) contra os dados do vendor para o Exemplar — não uma
   reimplementação, a função em si.
8. Varredura de `feats/`, `class-features/`, `actions/`, `equipment/`
   inteiros procurando ocorrências textuais de `exemplar-worn-ikon` /
   `exemplar-weapon-ikon` / `exemplar-body-ikon` fora dos 21 docs já
   conhecidos (0 encontradas).
9. **Conferência independente** (fonte externa ao vendor pf2e e a este pack):
   `~/pessoal/Wayfinder/pipeline/base/index.json` (registro `wb:class/exemplar`
   e seu `progressao[]`) e os relatórios já produzidos por aquele pipeline —
   `relatorio_eixo_de_ikon.md`, `relatorio_eixo_por_tag.md`,
   `relatorio_subclasses.md`, `relatorio_weapon_expertise.md`,
   `relatorio_gate_arquetipo.md`. Não é o próprio pack sendo montado — é uma
   base de dados de terceiro (Igor), lida como está.

## 2. Doc da classe (medido)

| Campo | Valor |
| --- | --- |
| hp | 10 |
| keyAbility | `["dex","str"]` (par, sem ordem preferencial) |
| perception | 1 (trained em L1) |
| savingThrows | fortitude 2 (expert), reflex 1 (trained), will 2 (expert) — dois saves fortes já em L1 |
| attacks | simple 1, martial 1, advanced 0, unarmed 1, other `{name:"", rank:0}` |
| defenses | heavy 0, light 1, medium 1, unarmored 1 |
| featLevels | ancestry [1,5,9,13,17]; class [1,2,4,6,8,10,12,14,16,18,20]; general [3,7,11,15,19]; skill [2,4,6,8,10,12,14,16,18,20] |
| skillIncreaseLevels | [3,5,7,9,11,13,15,17,19] |
| trainedSkills | `value:["religion"], additional:3` |
| spellcasting | `0` (sem conjuração) |
| classDC | ausente no doc do vendor (ver §9) |

**Conferência independente 100%:** `wb:class/exemplar` (waybuilder do Igor)
bate campo a campo — hp_per_level 10, perception trained, fort
expert/reflex trained/will expert, simple+martial+unarmed trained/advanced
untrained, light+medium+unarmored trained/heavy untrained, skill_training
`{auto:["religion"], free:3}`, os 4 feat_slot, skill_increase, key_ability
`[dex,str]`, spellcasting false. Nenhuma divergência.

### `items{}` (20 entradas, nome canônico = segmento final da uuid)

| Nível (`items{}`) | Feature | Nível genérico do arquivo | Divergência? |
| --- | --- | --- | --- |
| 1 | Shield Block | 1 | não |
| 1 | Humble Strikes | 1 | não |
| 1 | Divine Spark and Ikons | 1 | não |
| 3 | Root Epithet | 3 | não |
| 5 | Weapon Expertise | 5 | não |
| 7 | Spirit Striking | 7 | não |
| 7 | Unassailable Soul | 7 | não |
| 7 | Dominion Epithet | 7 | não |
| 9 | Perception Expertise | **3** | **SIM — usar 9** |
| 9 | Divine Premonition | 9 | não |
| 9 | Godly Expertise | 9 | não |
| 13 | Greater Unassailable Soul | 13 | não |
| 13 | Divine Weapon Mastery | 13 | não |
| 13 | Burnished Armor Expertise | 13 | não |
| 15 | Sovereignty Epithet | 15 | não |
| 15 | Greater Spirit Striking | 15 | não |
| 15 | Mortality Reforged | 15 | não |
| 17 | Deific Mastery | 17 | não |
| 17 | Perception Mastery | **7** | **SIM — usar 17** |
| 19 | Burnished Armor Mastery | 19 | não |

Os 20 nomes canônicos batem exatamente com `entry.name` em 20/20 (sem a
armadilha do Magus/Champion — verificado `v.name === uuid.split('.').pop()`
para as 20). **Duas divergências de nível**, ambas em `dedupe.collisionsDetected`.
**Conferido nível a nível contra o `progressao[]` do waybuilder** (20
entradas, uma por `wb:class-feature/<slug>` e nível) — bate exatamente,
inclusive as duas divergências (perception-expertise em L9, perception-mastery
em L17 no registro dele também).

## 3. Features compartilhadas com outras classes (união de `items{}` das 27 classes)

| Feature | Nº de classes | Classes |
| --- | --- | --- |
| Weapon Expertise | 14 | Champion, Druid, Exemplar, Guardian, Investigator, Kineticist, Magus, Oracle, Psychic, Sorcerer, Swashbuckler, Thaumaturge, Witch, Wizard |
| Perception Expertise | 12 | Alchemist, Animist, Champion, Cleric, Druid, Exemplar, Inventor, Kineticist, Monk, Sorcerer, Witch, Wizard |
| Perception Mastery | 10 | Barbarian, Bard, Commander, Exemplar, Gunslinger, Investigator, Ranger, Rogue, Swashbuckler, Thaumaturge |
| Shield Block | 7 | Champion, Commander, Druid, Exemplar, Fighter, Guardian, Inventor |
| (as outras 16) | 1 | só Exemplar |

## 4. Já existe nos packs — REUSAR

Por `flags.fusion.sourceId`: **4 das 20** `items{}` já em `class-features-core`
— Shield Block, Weapon Expertise, Perception Expertise, Perception Mastery.
As **16 restantes são novas**: Burnished Armor Mastery, Divine Premonition,
Sovereignty Epithet, Greater Spirit Striking, Mortality Reforged, Deific
Mastery, Root Epithet, Greater Unassailable Soul, Divine Weapon Mastery,
Burnished Armor Expertise, Spirit Striking, Humble Strikes, Unassailable
Soul, Dominion Epithet, Divine Spark and Ikons, Godly Expertise.

Dos **39 docs de opção de eixo** (21 ikon + 6 root-epithet + 8
dominion-epithet + 4 sovereignty-epithet): **0 já em `class-features-core`**
— todos novos, todos `system.category:"classfeature"`.

## 5. Eixos de sub-escolha — 4, não 7

**Achado central desta curadoria.** Os 7 grupos de `otherTags` medidos
(`exemplar-ikon`:21, `exemplar-worn-ikon`:8, `exemplar-weapon-ikon`:9,
`exemplar-body-ikon`:4, `exemplar-root-epithet`:6, `exemplar-dominion-epithet`:8,
`exemplar-sovereignty-epithet`:4) **não são 7 eixos de escolha do jogador —
são 4**:

- **Ikon**: `exemplar-worn-ikon`(8) + `exemplar-weapon-ikon`(9) +
  `exemplar-body-ikon`(4) = 21 = `exemplar-ikon`. Confirmado por interseção
  real: todo doc com um subtipo TAMBÉM tem `exemplar-ikon`; todo doc
  `exemplar-ikon` tem **exatamente um** subtipo (nenhum tem zero, nenhum tem
  dois). As 3 `ChoiceSet` de `class-features/divine-spark-and-ikons.json`
  (mais a 4ª, do feat `Additional Ikon`, L8) filtram **todas** por
  `item:tag:exemplar-ikon` — nunca pelos subtipos. Varri `feats/`,
  `class-features/`, `actions/`, `equipment/` inteiros: **zero** ocorrências
  dos 3 subtipos fora dos 21 docs conhecidos. Os subtipos são metadado
  descritivo (ex.: ikon de corpo não pode ser desarmada), não critério de
  escolha.
- **Root Epithet** (L3, 6 opções), **Dominion Epithet** (L7, 8 opções),
  **Sovereignty Epithet** (L15, 4 opções): 3 eixos **paralelos e
  independentes**, um por `items{}`/nível, sem cross-tagging entre eles
  (verificado — nenhum doc carrega mais de uma das 3 tags), diferente da
  hipótese "aninham como o ikon" aventada na medição preliminar.

`featureNameInItemsMap` casa por nome canônico com os 4 itens correspondentes
do `items{}`: Divine Spark and Ikons (L1), Root Epithet (L3), Dominion
Epithet (L7), Sovereignty Epithet (L15) — os 4 sem divergência de nível
genérico×`items{}` (§2).

**Conferência independente, dupla:**
- `relatorio_eixo_de_ikon.md` (waybuilder): 1 classe com o eixo, 21 opções,
  escolhe 3, prosa "Select three ikons", nota que o 4º ikon vem do feat
  `wb:feat/additional-ikon` (= nosso "Additional Ikon") e **não** faz parte
  do eixo base.
- `relatorio_eixo_por_tag.md` + `relatorio_subclasses.md` (waybuilder):
  root-epithet L3/6 opções, dominion-epithet L7/8 opções, sovereignty-epithet
  L15/4 opções — números idênticos aos medidos aqui.

`choiceAxes` no JSON: 4 entradas (`exemplar-ikon` choose 3; `exemplar-root-epithet`,
`exemplar-dominion-epithet`, `exemplar-sovereignty-epithet` choose 1 cada).

**Dívidas dentro dos eixos, declaradas e não resolvidas:**
- `Additional Ikon` (L8, um dos 49 class feats) tem sua própria `ChoiceSet`
  do mesmo tag `exemplar-ikon` — 4º ikon via feat, mesma família de dívida
  "feat concede uma escolha" que `bard.json` já registrou para as muses.
- Ao menos uma opção de eixo tem sub-escolha aninhada própria: "Born of the
  Bones of the Earth" (dominion-epithet) tem `ChoiceSet` literal (earth/fire)
  que concede "Energized Spark" pré-selecionado — mesma forma da "Voice of
  Nature" do Druid. Não auditado exaustivamente nas 39 opções.

## 6. Class feats

- **47** exclusivos em `feats/class/exemplar/level-*/` (L1=4, L2=3, L4=5,
  L6=5, L8=6, L10=5, L12=4, L14=3, L16=5, L18=4, L20=3).
- **2** de `feats/class/shared-class-feats/level-*/` (113 arquivos no total)
  com trait `exemplar`: Lightning Swap (L2, trait também `fighter`) e
  Reactive Strike (L6, trait também `barbarian/champion/commander/guardian/
  magus/swashbuckler`).
- **Total candidato: 49.** Distribuição combinada por nível: L1=4, L2=4,
  L4=5, L6=6, L8=6, L10=5, L12=4, L14=3, L16=5, L18=4, L20=3 (soma 49).
- **2 de 49 já em `feats-core`** por `sourceId` (os mesmos 2 compartilhados).
  Os outros 47 são novos.
- Zero nomes duplicados, zero sufixo `(Exemplar)` de desambiguação (não
  precisou — nenhum outro doc do vendor colide por nome com os 47
  exclusivos).
- Zero candidatos com trait `archetype`: a cadeia de dedicação "Exemplar
  Dedication" (ex.: "Exemplar Resiliency") vive em `feats/archetype/exemplar/`
  — pasta **separada** de `feats/class/exemplar/` — e corretamente não
  aparece nos 49 candidatos. Consistente com PLANO §9 (arquétipos de
  multiclasse ficam de fora desta rodada).

## 7. Pré-requisitos

- **7 de 49** candidatos têm `system.prerequisites.value` não vazio.
- **1** cadeia interna: `Remake the World` (L20) exige `Strike Rivers, Seize
  Winds` (L16) — ambos no conjunto dos 49.
- **5** apontam para o **nome de uma opção do eixo `exemplar-dominion-epithet`
  em minúsculas** — mesmo formato do `druid-order` (texto == nome da opção em
  minúsculas), não mecanizado (nada hoje lê pré-requisito de opção de eixo).
  Todos L8 (um nível após Dominion Epithet L7): "As a Thousand Soldiers" →
  `"plunderer of the hive's riches"`; "Battle Hymn to the Lost" →
  `"of verse unbroken or peerless under heaven"` (disjunção numa string só,
  sem OR estruturado); "Forward Gaze Into Life" → `"trespasser in death's
  realm"`; "Raise Island" → `"born of the bones of the earth or restless as
  the tide"` (disjunção); "Rejoice in Solstice Storm" → `"whose cry is
  thunder or dancer in the seasons"` (disjunção). Juntos cobrem as 8 das 8
  opções do eixo.
- **1** é condição negativa de trait, não referência a documento: "Vow of
  Mortal Defiance" (L1) → `"You are not sanctified with the holy or unholy
  trait"` — não mecanizável, sem predicado inventado (REQ-BC-034).
- **Zero** apontam para fora do conjunto do Exemplar (nenhuma referência a
  feat/feature de outra classe — diferente do "Master of Many Styles →
  Reflexive Stance (Monk)" do Fighter).

Total: 1 + 5 + 1 = 7 — confere.

## 8. Preparação para multiclasse (r21 §4)

- Gate derivado: trait `exemplar` + `category:"class"` →
  `{"class_level":{"exemplar":{">=":N}}}`.
- **2 de 49** candidatos carregam trait de 2+ classes: Lightning Swap
  (+fighter), Reactive Strike (+barbarian/champion/commander/guardian/magus/
  swashbuckler) — mesma ambiguidade "`any` entre as classes do trait" já
  registrada por `fighter.json`/`champion.json`, não redecidida aqui.
- Zero candidatos com trait `archetype`.

## 9. Conjuração e focus spells

Zero. `spellcasting:0` no doc do vendor; varredura de `spells/**/*.json` por
trait `exemplar` retornou 0 arquivos.

## 10. Proficiências derivadas — rodei a função real

Chamei `deriveProficiencyUpgrades` (a mesma função de
`tools/importer-pf2e/src/curation/proficiency-upgrades.mjs` que
`transform.mjs` importa) contra o `items{}` do Exemplar e os 20 docs de
`class-features` correspondentes. Resultado: **20 linhas, `missing: []`,
`ignoredRules: []`** — zero gaps, nenhum `proficiencyUpgradeExtras`
necessário.

| Nível | Stat | Rank | Origem |
| --- | --- | --- | --- |
| 5 | weapons.simple, weapons.unarmed | 2 | Weapon Expertise (subfeatures) |
| 5 | weapons.martial | 2 | Weapon Expertise (**rule** — ver nota abaixo) |
| 7 | will | 3 | Unassailable Soul |
| 9 | perception | 2 | Perception Expertise (nível usado: 9) |
| 9 | reflex | 2 | Divine Premonition |
| 9 | classDC | 2 | Godly Expertise |
| 13 | armor.light/medium/unarmored | 2 | Burnished Armor Expertise |
| 13 | weapons.simple/martial/unarmed | 3 | Divine Weapon Mastery |
| 13 | will | 4 | Greater Unassailable Soul |
| 15 | fortitude | 3 | Mortality Reforged |
| 17 | classDC | 3 | Deific Mastery |
| 17 | perception | 3 | Perception Mastery (nível usado: 17) |
| 19 | armor.light/medium/unarmored | 3 | Burnished Armor Mastery |

Will chega a **legendary em L13** (Greater Unassailable Soul) — único stat
que chega a rank4, e cedo em relação a outras classes plenas. Medido, não
suposto, mas sem tabela de rank-por-nível numa segunda fonte para conferir
essa linha especificamente (waybuilder e vendor só têm o `rules`/
`subfeatures` cru, não uma tabela derivada).

**Duas ambiguidades do relatório do Fighter (r21), verificadas e fechadas
aqui, não reabertas:**

1. **Weapon Expertise / marcial**: não é lacuna. `weapon-expertise.json` tem
   um `rules[0]` `ActiveEffectLike` (`path:
   system.proficiencies.attacks.martial.rank`) com
   `predicate:{or:[...,"class:exemplar",...]}` — Exemplar está no predicate.
   É o **mesmo mecanismo** já documentado em `champion.json`, `magus.json` e
   `thaumaturge.json`; a derivação real já lê `rules[]` como segunda fonte.
2. **`classDC`**: a suposição do relatório do Fighter de que Magus/Kineticist
   têm `classDC:1` no doc do vendor **não se confirma** — medi os 27 docs de
   classe e nenhum tem o campo. `transform.mjs:2035` já aplica
   `classDC: src.classDC ?? system.classDC ?? 1` como default uniforme, e a
   chave `exemplar` em Godly Expertise/Deific Mastery cai na regra já
   documentada ("chave que não é save/perception/spellcasting/arma/armadura
   é o slug da própria classe → classDC"). Nenhuma pergunta em aberto.

## 11. Immanence/Transcendence — a dívida central da classe

"Divine Spark and Ikons" concede a ação "Shift Immanence" (`GrantItem` →
`Compendium.pf2e.actionspf2e.Item.Shift Immanence`), que move a "divine
spark" do personagem entre os ikons escolhidos. Cada ikon tem um efeito
**passivo** (immanence, só ativo enquanto a spark está nele) e uma ação
**ativa** (transcendence, que expulsa a spark ao ser usada) — é **estado
por-ikon**, não um predicado estático; não existe vocabulário de
predicado/efeito no Fusion para "a spark está neste item". Quase toda
feature de nível alto referencia esse estado na prosa (Spirit Striking,
Unassailable Soul, Divine Weapon Mastery, Burnished Armor
Expertise/Mastery, Godly Expertise, Deific Mastery). **Nenhum predicado
inventado** — os 21 docs de ikon e as features entram como texto correto; a
mecânica de troca de spark fica de fora, mesma categoria de dívida que
companheiro animal (Druid) e eidolon (Summoner).

Achado colateral: "Shift Immanence" está arquivado no vendor em
`actions/class/commander/shift-immanence.json` (pasta errada — carrega trait
`["divine","exemplar"]`, não `commander`). Não afeta o pack: `isActionsCoreDoc`
seleciona por `system.fusionCategory:"class"`, não pela pasta, então a ação
entra automaticamente no `actions-core` independente desta curadoria.

## 12. Validação obrigatória (§5 do PLANO)

```
node --input-type=module -e "import {validateClassCuration} from './tools/importer-pf2e/src/curation/index.mjs'; import {readFileSync} from 'node:fs'; const f='exemplar.json'; const cfg=validateClassCuration(JSON.parse(readFileSync('tools/importer-pf2e/src/curation/classes/'+f,'utf8')), f); console.log('OK', cfg.class, 'eixos:', cfg.choiceAxes.length, 'feats.trait:', cfg.classFeats.trait);"
```

Saída:

```
OK exemplar eixos: 4 feats.trait: exemplar
```

## 13. Riscos, dívidas e perguntas em aberto para a integração central

1. **Immanence/transcendence não mecanizado** (§11) — a dívida real de
   jogabilidade da classe. Precisa de vocabulário de estado por-item que o
   Fusion não tem hoje.
2. **Nenhuma ficha iconic para o Exemplar** no snapshot do vendor
   (`iconics/` não tem a classe) — diferente de Fighter/Druid/Thaumaturge, o
   gate `pregen-parity.test.ts` não ganha cobertura nova ao publicar esta
   classe. A única conferência independente disponível foi o waybuilder
   (bateu 100%, mas é dado de terceiro, não uma ficha oficial da Paizo).
3. **2 opções de eixo com sub-escolha própria** ("Additional Ikon" concede
   4º ikon; "Born of the Bones of the Earth" concede Energized Spark
   earth/fire) não auditadas nas 39 opções inteiras — mesma família de
   dívida "feat/opção concede outra escolha" já registrada em `bard.json` e
   `druid.json`, sem campo no schema de `choiceAxes` para declarar isso
   (mesma lacuna que `bard.json` já apontou).
4. **Gate multiclasse `any` entre traits** (§8) — mesma pergunta em aberto já
   levantada por `fighter.json`/`champion.json`, não redecidida aqui: 2 dos
   49 feats têm trait de outra classe além de `exemplar`.
5. Confirmar se a integração central concorda com a leitura de que os 7
   grupos de `otherTags` colapsam em 4 `choiceAxes` (não 7) — a medição
   preliminar do orquestrador sugeria 7 eixos; a medida real (§5) mostra 4,
   confirmada por 2 fontes independentes do waybuilder.
