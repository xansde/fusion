# r29 — Guardian — relatório de curadoria

Arquivo de configuração produzido: `tools/importer-pf2e/src/curation/classes/guardian.json`.

## 1. Método (comandos rodados)

Todos os números abaixo vieram de scripts `node -e`/`.mjs` executados contra
`tools/importer-pf2e/vendor/pf2e/packs/pf2e/` (fonte, somente leitura) e
`systems/pf2e/packs/*/documents.json` (packs atuais do Fusion). Nenhum arquivo
compartilhado foi tocado; nenhum `git`, `pnpm` ou importer foi rodado. Scripts
descartáveis ficaram em
`scratchpad/guardian/m1..m7-*.mjs` (fora da worktree). Os passos:

- `m1-classdoc.mjs` — leitura de `classes/guardian.json` → `system.{hp,
  keyAbility,perception,savingThrows,attacks,defenses,ancestryFeatLevels,
  classFeatLevels,generalFeatLevels,skillFeatLevels,skillIncreaseLevels,
  trainedSkills,spellcasting,classDC,items}`; varredura recursiva de
  `class-features/**.json` (842 arquivos) cruzando nível genérico do arquivo
  contra o nível no `items{}` do Guardian.
- `m2-subfeatures.mjs` — leitura de `subfeatures.proficiencies` e `rules[]`
  das 18 features do `items{}`.
- `m3-shared.mjs` — leitura de `classes/*.json` das 27 classes do vendor,
  contando quantas referenciam cada uma das 18 features do Guardian pelo nome
  canônico (segmento final da uuid).
- `m4-packs.mjs` — leitura de `systems/pf2e/packs/class-features-core/
  documents.json` (318 docs) e `feats-core/documents.json` (2205 docs),
  cruzando por `name` **e** `flags.fusion.sourceId`.
- `m5-feats.mjs` — varredura recursiva de `feats/class/guardian/level-*/`
  (56 arquivos) e `feats/class/shared-class-feats/level-*/` (113 arquivos no
  total, filtrados para os 9 com trait `guardian`).
- `m6-prereq.mjs` — leitura de `system.prerequisites.value` dos 65
  candidatos.
- Varredura de `system.traits.otherTags` com prefixo `guardian` em
  `class-features/**` (842 arquivos) e nos 65 feats candidatos — lista vazia
  nos dois casos.
- Leitura de `journals/remaster-changes.json` inteiro, procurando a string
  `guardian` (case-insensitive) — 0 ocorrências.
- Leitura da página "Guardian" de `journals/classes.json` (`doc.pages.find(p
  => p.name === "Guardian")`, HTML de 9100 caracteres) — fonte independente
  usada na §2 e no §7 para conferência não-circular.
- Verificação de que não há ficha pregen de Guardian em `iconics/*/` e de que
  `pregen-parity.test.ts:192` lista só `["Magus"]` em `CLASSES_WITHOUT_PREGEN`.
- `m7-derive.mjs` — rodou o próprio `deriveProficiencyUpgrades` (Fonte de
  verdade real, `tools/importer-pf2e/src/curation/proficiency-upgrades.mjs`)
  contra `classItemsMap` + a curadoria produzida, para conferir a tabela do
  §9 batendo bit a bit com o que o pipeline real geraria.
- Validação final do schema: comando do §5 do PLANO (ver §10 abaixo).

## 2. Doc da classe (medido) — e conferência não-circular

| Campo | Valor |
| --- | --- |
| hp | **12** |
| keyAbility | `{"selected":null,"value":["str"]}` — **só STR**, sem opção DEX |
| perception | 1 (trained) |
| savingThrows | fortitude 2 (expert), reflex 1 (trained), will 2 (expert) |
| attacks | simple 1, martial 1, unarmed 1, advanced 0, other `{name:"",rank:0}` |
| defenses | heavy 1, light 1, medium 1, unarmored 1 (trained em tudo) |
| ancestryFeatLevels | 1, 5, 9, 13, 17 |
| classFeatLevels | 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20 |
| generalFeatLevels | 3, 7, 11, 15, 19 |
| skillFeatLevels | 2, 4, 6, 8, 10, 12, 14, 16, 18, 20 |
| skillIncreaseLevels | 3, 5, 7, 9, 11, 13, 15, 17, 19 |
| trainedSkills | `value:["athletics"]`, `additional:3` |
| spellcasting | `0` (sem conjuração) |
| classDC no doc | **ausente** (`'classDC' in system` → `false`, igual ao Fighter) |
| publication | `{license:"ORC", remaster:true, title:"Pathfinder Battlecry!"}` |

**Conferência não-circular**: a página "Guardian" de `journals/classes.json`
(prosa/tabela HTML redigida à mão, fonte diferente do `classes/guardian.json`
estruturado) confirma linha por linha: "Hit Points: 12 plus your Constitution
modifier", "Key Attribute: STRENGTH", "Perception: Trained", "Saving Throws:
Expert in Fortitude / Trained in Reflex / Expert in Will", "Skills: Trained
in Athletics... 3 plus Intelligence modifier", "Attacks: Trained in
simple/martial/unarmed", "Defenses: Trained in all armor / unarmored" — bate
100% com a tabela acima. **Achado extra**: o journal também diz "**Class DC:
Trained in guardian class DC**" como proficiência inicial de nível 1 — ver
§6/notas sobre a ambiguidade `classDC`, que aqui fica **resolvida** (ao
contrário do Fighter, onde ficou em aberto).

### `items{}` (18 entradas — bate com a preliminar)

| Nível `items{}` | Feature | Nível genérico do arquivo | Divergência? |
| --- | --- | --- | --- |
| 1 | Guardian's Armor | 1 | não |
| 1 | Guardian's Techniques | 1 | não |
| 1 | Shield Block | 1 | não |
| 1 | Taunt | 1 | não |
| 3 | Tough To Kill | 3 | não |
| 5 | Unbreakable Expertise | 5 | não |
| 5 | Weapon Expertise | 5 | não |
| 7 | Reaction Time | 7 | não |
| 7 | Reflex Expertise | **3** | **SIM** |
| 9 | Battle Hardened | 9 | não |
| 9 | Guardian Expertise | 9 | não |
| 11 | Unbreakable Mastery | 11 | não |
| 11 | Weapon Specialization | **7** | **SIM** (mesma feature diverge no Fighter, também para 11) |
| 13 | Weapon Mastery | 13 | não |
| 15 | Unbreakable Legend | 15 | não |
| 17 | Greater Weapon Specialization | **15** | **SIM** (no Fighter esta MESMA feature NÃO diverge — usa o genérico 15) |
| 17 | Unyielding Resolve | 17 | não |
| 19 | Guardian Mastery | 19 | não |

Todos os 18 nomes canônicos batem exatamente com `entry.name` (nenhum caso
Magus/Lightning-Reflexes). **As três divergências foram confirmadas pela
tabela "Your Level → Class Features" do journal** (fonte independente): a
linha do nível 7 lista "reaction time, reflex expertise"; a do 11 lista
"unbreakable mastery, weapon specialization"; a do 17 lista "greater weapon
specialization, unyielding resolve" — exatamente os níveis do `items{}`, não
os genéricos.

## 3. Features compartilhadas (união das 27 classes do vendor)

| Feature do Guardian | Nº de classes | Classes |
| --- | --- | --- |
| Weapon Specialization | 25 | quase todas (mesma lista do Fighter) |
| Weapon Expertise | 14 | Champion, Druid, Exemplar, Guardian, Investigator, Kineticist, Magus, Oracle, Psychic, Sorcerer, Swashbuckler, Thaumaturge, Witch, Wizard |
| Reflex Expertise | 12 | Barbarian, Bard, Champion, Cleric, Druid, Guardian, Inventor, Magus, Sorcerer, Thaumaturge, Witch, Wizard |
| Greater Weapon Specialization | 13 | Champion, Commander, Fighter, Guardian, Gunslinger, Inventor, Investigator, Magus, Monk, Ranger, Rogue, Swashbuckler, Thaumaturge |
| Shield Block | 7 | Champion, Commander, Druid, Exemplar, Fighter, Guardian, Inventor |
| Weapon Mastery | 5 | Barbarian, Commander, Guardian, Magus, Thaumaturge |
| Battle Hardened | 2 | Fighter, Guardian |
| Guardian's Armor, Guardian's Techniques, Taunt, Tough To Kill, Unbreakable Expertise, Reaction Time, Guardian Expertise, Unbreakable Mastery, Unbreakable Legend, Unyielding Resolve, Guardian Mastery | 1 | só Guardian |

Shield Block confirma de novo o caso-teste da R1 (7 classes). Battle Hardened
(Fighter+Guardian) reproduz a mesma dupla já vista no relatório do Fighter.

## 4. Já existe nos packs — REUSAR (por `sourceId`)

7 das 18 features (as 7 compartilhadas do §3) já estão em
`class-features-core`, confirmadas por `flags.fusion.sourceId` idêntico ao
`_id` do vendor: **Shield Block, Weapon Expertise, Reflex Expertise, Battle
Hardened, Weapon Specialization, Weapon Mastery, Greater Weapon
Specialization**. Bate exatamente com a preliminar ("7 já nos packs").

Faltam 11 (todas exclusivas do Guardian): Guardian's Armor, Guardian's
Techniques, Taunt, Tough To Kill, Unbreakable Expertise, Reaction Time,
Guardian Expertise, Unbreakable Mastery, Unbreakable Legend, Unyielding
Resolve, Guardian Mastery.

## 5. Eixo de sub-escolha

**Guardian não tem eixo** — confirmado, não presumido. Varredura de
`system.traits.otherTags` com prefixo `guardian` em **todos os 842**
arquivos de `class-features/*.json` **e** nos 65 feats candidatos (56
exclusivos + 9 compartilhados) retornou lista vazia nos dois casos.
`choiceAxes: []`.

## 6. Class feats

- **56** exclusivos em `feats/class/guardian/level-*/` (level-1=6, level-2=7,
  level-4=7, level-6=6, level-8=6, level-10=6, level-12=6, level-14=3,
  level-16=3, level-18=4, level-20=2 — soma 56).
- **9** de `feats/class/shared-class-feats/level-*/` (113 arquivos no total)
  com trait `guardian`: Defensive Advance (L1), Reactive Shield (L1),
  Aggressive Block (L2), Reactive Strike (L6), Reflexive Shield (L6),
  Paragon's Guard (L12), Opening Stance (L14), Improved Reflexive Shield
  (L16), Boundless Reprisals (L20).
- **Total: 65** candidatos, todos com `system.category === "class"`.
- **9 de 65 já estão em `feats-core`** — os 9 compartilhados acima,
  confirmados por `sourceId` (não só nome). **56 são novos.**
- Bate **exatamente** com a preliminar: "65 class feats (56 exclusivos + 9
  de shared-class-feats; 9 já em feats-core)".
- Nenhum dos 65 tem trait `archetype`. Todos os 9 compartilhados também
  carregam trait de outra classe (7 com `fighter`, 1 com `champion`, e
  Reactive Strike com 6 traits: barbarian/champion/commander/exemplar/
  guardian/magus/swashbuckler) — mesma pergunta em aberto do Fighter (§9 do
  ACHADOS-TRANSVERSAIS), não decidida aqui.
- Desambiguação de homônimo: 1 dos 65 tem sufixo `(Guardian)` — "Larger Than
  Life (Guardian)". Nenhuma "Larger Than Life" sem sufixo foi encontrada em
  `feats/`, então não há colisão real, só a marca preventiva do vendor.

## 7. Pré-requisitos

**16 de 65** candidatos têm `system.prerequisites.value` não vazio.

- **6** resolvem para um nó **dentro** do conjunto de 65 feats + 18
  features: Devastating Shield Wallop → Shield Wallop; Not So Fast! →
  Hampering Stance; Lock Down → Hampering Stance; Repositioning Block →
  Shield Block; Improved Reflexive Shield → Reflexive Shield; Shield from
  Spells → Shield from Arrows.
- **5** apontam para "Intercept Attack" (Get Behind Me!, Armored
  Counterattack, Energy Interceptor, Disarming Intercept, e Quick Vengeance
  na forma "Intercept Attack or Shield Block"). **Intercept Attack não é um
  feat nem uma class-feature** — é a `action` (`actions/class/guardian/
  intercept-attack.json`) **concedida** pela feature `Guardian's Techniques`
  (nível 1, universal a todo Guardian) via `GrantItem`. Como todo Guardian
  tem Guardian's Techniques desde o nível 1, esses 5 prerequisites são
  **trivialmente satisfeitos** por qualquer personagem da classe — não são
  gates reais dentro da progressão. Registrados em `internalChains` com o
  texto literal ("Intercept Attack"), não substituído por invenção.
- **2** apontam para **fora** do conjunto: Phalanx Formation → "Guardian or
  Knight Vigilant Dedication" e Mighty Bulwark → "Guardian or Sentinel
  Dedication". Confirmei que `Knight Vigilant Dedication` e `Sentinel
  Dedication` existem em `feats/archetype/knight-vigilant/` e
  `feats/archetype/sentinel/` — são feats de dedicação de arquétipo, fora da
  seleção do Guardian. Registrados em `referencesOutsideSelection`.
- **3** não são mecanizáveis nesta rodada (texto de perícia, sem predicado
  inventado): "trained in Athletics" (Punishing Shove, Flying Tackle),
  "master in Athletics" (Right Where You Want Them).

Total: 6 + 5 + 2 + 3 = 16 — confere.

Nenhum `prerequisiteFixes` foi necessário: todo texto resolveu limpo contra o
conjunto de 65 candidatos ou contra um alvo externo identificável.

## 8. Preparação para multiclasse (r21 §4)

- Gate derivado para os 65 candidatos: trait `guardian` + `category:"class"`
  → `{"class_level":{"guardian":{">=":N}}}`, N = nível do arquivo do feat.
- Nenhum dos 65 tem trait `archetype` — sem conflito archetype-vs-classe.
- **9 dos 65** (os compartilhados do §6) também têm trait de outra classe —
  mesma ambiguidade "qual X usar no gate" já levantada pelo Fighter (r21) e
  repetida por Thaumaturge/Exemplar. Não decidida aqui; é a mesma pergunta
  aberta do item 9 do `ACHADOS-TRANSVERSAIS.md`, e o Guardian não traz
  nenhuma variação nova sobre ela.

## 9. Conjuração e focus spells

Zero. `system.spellcasting` do doc de classe é `0`. Varredura de
`spells/**/*.json` por trait `guardian` retornou **0** arquivos (nenhuma
magia, ritual ou focus spell carrega esse trait).

## 10. Validação (comando do §5 do PLANO)

```
node --input-type=module -e "import {validateClassCuration} from './tools/importer-pf2e/src/curation/index.mjs'; import {readFileSync} from 'node:fs'; const f='guardian.json'; const cfg=validateClassCuration(JSON.parse(readFileSync('tools/importer-pf2e/src/curation/classes/'+f,'utf8')), f); console.log('OK', cfg.class, 'eixos:', cfg.choiceAxes.length, 'feats.trait:', cfg.classFeats.trait);"
```

Saída:

```
OK guardian eixos: 0 feats.trait: guardian
```

## 11. Tabela de `proficiencyUpgrades` — rodada de verdade contra o pipeline

Ao contrário do relatório do Fighter (que só documentou a tabela esperada à
mão), aqui rodei o próprio `deriveProficiencyUpgrades` (Fonte de verdade,
`proficiency-upgrades.mjs`) contra `classItemsMap` + a curadoria produzida
(`m7-derive.mjs`). Saída: **22 upgrades, `missing: []`, `ignoredRules: []`**
— a curadoria não precisou de nenhum `proficiencyUpgradeExtras`.

| level | stat | rank | origem |
| --- | --- | --- | --- |
| 5 | armor.heavy | 2 | Unbreakable Expertise (subfeatures) |
| 5 | armor.medium | 2 | Unbreakable Expertise (subfeatures) |
| 5 | weapons.simple | 2 | Weapon Expertise (subfeatures) |
| 5 | weapons.unarmed | 2 | Weapon Expertise (subfeatures) |
| 5 | weapons.martial | 2 | Weapon Expertise (**rule** `ActiveEffectLike`, não subfeatures — ver nota) |
| 7 | perception | 2 | Reaction Time (subfeatures) |
| 7 | reflex | 2 | Reflex Expertise (subfeatures) |
| 9 | fortitude | 3 | Battle Hardened (subfeatures) |
| 9 | classDC | 2 | Guardian Expertise (subfeature key `guardian`) |
| 11 | armor.heavy | 3 | Unbreakable Mastery |
| 11 | armor.light | 2 | Unbreakable Mastery |
| 11 | armor.medium | 3 | Unbreakable Mastery |
| 11 | armor.unarmored | 2 | Unbreakable Mastery |
| 13 | weapons.martial | 3 | Weapon Mastery |
| 13 | weapons.simple | 3 | Weapon Mastery |
| 13 | weapons.unarmed | 3 | Weapon Mastery |
| 15 | armor.heavy | 4 | Unbreakable Legend |
| 15 | armor.light | 3 | Unbreakable Legend |
| 15 | armor.medium | 4 | Unbreakable Legend |
| 15 | armor.unarmored | 3 | Unbreakable Legend |
| 17 | will | 3 | Unyielding Resolve |
| 19 | classDC | 3 | Guardian Mastery (subfeature key `guardian`) |

**Nota sobre `weapons.martial` no nível 5**: `Weapon Expertise.json` só lista
`simple`+`unarmed` em `subfeatures.proficiencies`; o `martial` rank2 vem de
um `rules[]` do tipo `ActiveEffectLike` (`path:
"system.proficiencies.attacks.martial.rank"`, `mode:"upgrade"`, `value:2`,
`predicate:{or:["class:champion","class:exemplar","class:guardian",
"class:investigator","class:magus","class:swashbuckler","class:thaumaturge"]}`).
Esse é exatamente o mecanismo "Fonte 2" que `proficiency-upgrades.mjs` já
implementa (o comentário do próprio arquivo cita `weapon-expertise.json`
como o caso que obrigou essa fonte a existir) — **não precisei declarar
`proficiencyUpgradeExtras`**, a derivação genérica já cobre isso.

**`classDC`**: Guardian Expertise (L9) e Guardian Mastery (L19) usam a chave
de subfeature `guardian` (= slug da própria classe), que `statFromVendorKey`
mapeia para `classDC` automaticamente. Diferente do Fighter (onde essa
ambiguidade ficou em aberto), aqui o **journal confirma explicitamente**:
"Class DC: Trained in guardian class DC" nas proficiências iniciais — o
Guardian deveria emitir `classDC: 1` no nível 1. Reportado para a integração
central resolver as duas classes juntas.

## 12. Riscos, dívidas e perguntas em aberto

1. **`classDC` inicial (rank 1)**: o doc de classe do vendor não tem
   `system.classDC`, mas o journal confirma a proficiência inicial "Trained
   in guardian class DC". A integração central precisa decidir se emite
   `classDC: 1` no nível 1 para o Guardian (e revisitar a mesma pergunta em
   aberto do Fighter à luz desse achado).
2. **Gate de class feat com múltiplos traits de classe** (§8): mesma
   pergunta aberta desde a r21 (Fighter), repetida por Thaumaturge, Exemplar
   e agora Guardian — não decidida aqui.
3. **`Intercept Attack` como alvo de prerequisite**: 5 dos 16 prerequisites
   apontam para uma reaction concedida (não um feat/feature nomeado). Documentei
   o texto literal em `internalChains`, mas o requisito real é "ter Guardian's
   Techniques" — que é universal a nível 1. Se a integração central quiser um
   grafo de nós mais preciso, isso pode precisar virar `grantedBy`-like (mesma
   lacuna que o Fighter já apontou para features, §4.2 do PLANO original da
   r21, mas agora manifestada num feat que aponta para uma AÇÃO concedida por
   uma feature, não para a feature em si).
4. **ACHADO DE VENDOR, não de curadoria**: a página do journal "Guardian"
   embeda o UUID errado (`Military Expertise` do Commander) na seção
   "Unbreakable Expertise" — não afeta o pack (o `items{}` estrutural aponta
   certo), mas registro porque só apareceu ao cruzar contra a fonte
   independente. Ver `dedupe.collisionsDetected` no JSON.
5. **`pregen-parity.test.ts`**: publicar o Guardian vai reprovar
   `CLASSES_WITHOUT_PREGEN === ["Magus"]` até a lista incluir `"Guardian"`
   também (mesmo gate já sinalizado pelo Summoner no `ACHADOS-TRANSVERSAIS`
   item 7) — não existe ficha pregen de Guardian em `iconics/`.
6. **Guardian Mastery (nível 19)** tem uma mecânica única não capturada por
   `proficiencyUpgrades`: usa o bônus de CA da armadura vestida como bônus de
   Reflexo contra efeitos de dano, suprimindo Destreza e o bônus de traço
   `bulwark` nesse cálculo (`rules[]` com `FlatModifier`+`AdjustModifier`
   condicionados a `damaging-effect`). Não é uma lacuna de proficiência — é
   uma regra de combate própria da feature, fora do escopo desta curadoria
   (dívida declarada, não mecanizada aqui).
