# r29 — Alchemist — relatório de curadoria

Arquivo de configuração produzido: `tools/importer-pf2e/src/curation/classes/alchemist.json`.

## 1. Método (comandos rodados)

Todas as contagens vieram de scripts `node -e` (Node 22, sem dependências) rodados
contra `tools/importer-pf2e/vendor/pf2e/packs/pf2e/` (fonte, somente leitura) e
`systems/pf2e/packs/*/documents.json` (packs atuais do Fusion), nesta sessão, na
worktree. Nenhum arquivo compartilhado foi tocado; nenhum `git`, `pnpm` ou
importer foi rodado. Comandos relevantes, reconstruíveis a partir deste
relatório:

- Leitura direta de `classes/alchemist.json` do vendor (`system.items`, `hp`,
  `keyAbility`, `perception`, `savingThrows`, `attacks` — inclui `attacks.other`,
  `defenses`, os quatro `*FeatLevels`, `skillIncreaseLevels`, `trainedSkills`,
  `spellcasting`, `classDC in system`).
- Varredura das 19 entradas de `system.items` comparando `entry.name` com o
  segmento final de `entry.uuid` — **1 divergência** ("(Choice) Greater Field
  Discovery" → canônico "Greater Field Discovery").
- Para cada uma das 19 entradas: leitura do arquivo genérico correspondente em
  `class-features/<slug>.json` e comparação `system.level.value` (genérico) ×
  `level` do `items{}` — **5 divergências** (Perception Expertise, Will
  Expertise, Medium Armor Expertise, Medium Armor Mastery, Weapon
  Specialization).
- Varredura das 27 pastas de `classes/*.json` do vendor, união dos nomes
  canônicos de `items{}`, para achar quais das 19 features do Alchemist são
  compartilhadas com outras classes.
- Leitura de `systems/pf2e/packs/class-features-core/documents.json` (318 docs)
  e cruzamento por `flags.fusion.sourceId` contra o `_id` dos 19 arquivos
  genéricos — 5/19 já presentes.
- Leitura direta de `class-features/research-field.json` (a feature-eixo, L1) e
  varredura de `otherTags` com prefixo `alchemist` nos 842 arquivos de
  `class-features/**` — 4 opções (Bomber, Chirurgeon, Mutagenist, Toxicologist).
- Leitura direta dos 4 arquivos de campo de pesquisa (`rules[]` e
  `description.value` completos) e dos 3 arquivos-container
  `field-discovery.json`/`advanced-vials.json`/`greater-field-discovery.json` —
  confirmação do padrão de `GrantItem` dinâmico
  (`{actor|flags.system.alchemist.*}`).
- Grep recursivo por `field-discovery|advanced-vials|greater-field-discovery`
  em `class-features/` — achado dos 12 docs-variante (3 features × 4 campos).
- Leitura direta de `class-features/alchemy.json` (o container do L1) e dos 5
  sub-features que ele concede via `GrantItem` (`Alchemical Crafting`,
  `Formula Book`, `Advanced Alchemy`, `Versatile Vials`, `Quick Alchemy`) —
  `rules[]` e `description.value` completos de cada um.
- Cruzamento de `Alchemical Crafting` (`feats/skill/level-1/alchemical-crafting.json`,
  trait `general`+`skill`, sem trait `alchemist`) contra `feats-core` por
  `sourceId` — já presente.
- Varredura recursiva de `feats/class/alchemist/level-*/` (65 arquivos) e de
  `feats/class/shared-class-feats/level-*/` (113 arquivos, filtrados para os 2
  com trait `alchemist`).
- Leitura de `systems/pf2e/packs/feats-core/documents.json` (2205 docs) e
  cruzamento por `sourceId` dos 67 candidatos — 2/67 presentes.
- Varredura de `system.prerequisites.value` dos 67 candidatos (14 não-vazios) e
  classificação de cada texto.
- Varredura de `publication.remaster` nos 65 exclusivos (comparação com Fighter
  como controle) — 15/65 `false` no Alchemist vs. 3/72 no Fighter.
- Grep por `"incompatible"|"not automated"` nas descrições dos 65 exclusivos —
  1 ocorrência (`Efficient Alchemy (Paragon)`).
- Leitura de `tools/importer-pf2e/vendor/pf2e/packs/pf2e/spells/**` (1797
  arquivos) filtrando trait `alchemist` — 0.
- Leitura de `equipment/**` (5645 arquivos) filtrando trait `alchemical`,
  quebrado por `type` e por trait secundário (bomb/elixir/mutagen/poison/drug).
  Cruzamento contra `equipment-core` (249 docs) e `weapons-core` (132 docs) por
  trait e por `sourceId` — ver §4-bis.
- Leitura de `tools/importer-pf2e/src/build-mvp-subset.mjs`
  (`EQUIPMENT_CORE_GRANT_TARGET_IDS`, `isEquipmentCoreCuratedDoc`,
  `GRANT_TARGET_CLASS_FEATURE_NAMES`) e de `tools/importer-pf2e/src/transform.mjs`
  (`convertGrantItem`, e grep vazio por `attacks.other`/`weapon-base-alchemical-bomb`)
  — só leitura.
- Parse do HTML de `journals/remaster-changes.json` (página "Feats", 210 linhas
  de `<tr><td>` após regex) filtrando Main Trait = "Alchemist" — 2 linhas.
- Parse do HTML de `journals/classes.json` (página "Alchemist", seção "Class
  Features") — tabela oficial nível-a-nível, célula a célula.
- Leitura de `packs/iconics/fumbus/fumbus-level-{1,3,5}.json` (o pregen do
  Alchemist) para conferência independente.
- Validação final: comando do §5 do PLANO.md — saída colada na seção 11.

## 2. Doc da classe (medido)

| Campo | Valor |
| --- | --- |
| hp | **8** |
| keyAbility | `["int"]` (opção única) |
| perception | 1 (trained em nível 1) |
| savingThrows | fortitude 2 (expert), reflex 2 (expert), will 1 (trained) |
| attacks | simple 1, unarmed 1 (trained); advanced 0, martial 0; **`other: {name:"Alchemical Bombs", rank:1}`** |
| defenses | light 1, medium 1, unarmored 1 (trained); heavy 0 |
| ancestryFeatLevels | 1, 5, 9, 13, 17 |
| classFeatLevels | 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20 |
| generalFeatLevels | 3, 7, 11, 15, 19 |
| skillFeatLevels | 2, 4, 6, 8, 10, 12, 14, 16, 18, 20 |
| skillIncreaseLevels | 3, 5, 7, 9, 11, 13, 15, 17, 19 |
| trainedSkills | `value: ["crafting"]`, `additional: 3` |
| spellcasting | `0` (sem conjuração) |
| classDC (no doc) | ausente (`'classDC' in system` → `false`, igual ao Fighter/Thaumaturge) |

**Confirma a medição preliminar**: hp 8, atributo-chave int. `attacks.other`
("Alchemical Bombs", rank 1) é um campo que Fighter/Druid/Thaumaturge não têm
preenchido — ver §10.

### `items{}` — 19 entradas confirmadas (5 já nos packs)

| Nível (`items{}`) | Feature | Nível genérico | Divergência? |
| --- | --- | --- | --- |
| 1 | Alchemy | 1 | não |
| 1 | Research Field | 1 | não |
| 5 | Field Discovery | 5 | não |
| 5 | Powerful Alchemy | 5 | não |
| 7 | Alchemical Weapon Expertise | 7 | não |
| 7 | Will Expertise | **3** | **SIM — usar 7** |
| 9 | Alchemical Expertise | 9 | não |
| 9 | Double Brew | 9 | não |
| 9 | Perception Expertise | **3** | **SIM — usar 9** |
| 11 | Advanced Vials | 11 | não |
| 11 | Chemical Hardiness | 11 | não |
| 13 | Greater Field Discovery (canônico; entry.name diz "(Choice) Greater Field Discovery") | 13 | não (nível bate; nome diverge — ver abaixo) |
| 13 | Medium Armor Expertise | **11** | **SIM — usar 13** |
| 13 | Weapon Specialization | **7** | **SIM — usar 13 (maior divergência da rodada, 6 níveis)** |
| 15 | Alchemical Weapon Mastery | 15 | não |
| 15 | Explosion Dodger | 15 | não |
| 17 | Abundant Vials | 17 | não |
| 17 | Alchemical Mastery | 17 | não |
| 19 | Medium Armor Mastery | **17** | **SIM — usar 19** |

**5 divergências de nível** (mais que Fighter e Thaumaturge, que tiveram 2
cada) + **1 divergência de nome** (entry.name "(Choice) Greater Field
Discovery" ≠ uuid tail "Greater Field Discovery" — mesma armadilha do
Magus/Lightning Reflexes). Todas registradas em `dedupe.collisionsDetected`.

## 3. Features compartilhadas com outras classes

| Feature | Nº classes | Já em `class-features-core`? |
| --- | --- | --- |
| Weapon Specialization | 25 (quase todas) | sim |
| Perception Expertise | 12 | sim |
| Medium Armor Expertise | 7 | sim |
| Medium Armor Mastery | 6 | sim |
| Will Expertise | 3 (Alchemist, Kineticist, Ranger) | sim |

As outras 14 (Alchemy, Chemical Hardiness, Alchemical Weapon Mastery,
Explosion Dodger, Research Field, Double Brew, Alchemical Weapon Expertise,
Greater Field Discovery, Alchemical Expertise, Abundant Vials, Advanced Vials,
Field Discovery, Powerful Alchemy, Alchemical Mastery) são exclusivas do
Alchemist e faltam no pack — mais os 4 sub-features de "Alchemy" trazidos via
`extraNames` (§5).

## 4. Eixo — `alchemist-research-field` (4 opções, confirmado)

`Research Field` (L1) é `ChoiceSet` (filtro `item:tag:alchemist-research-field`)
+ `GrantItem`. 4 opções, 0/4 em `class-features-core`: Bomber, Chirurgeon,
Mutagenist, Toxicologist — todas `category="classfeature"`, `level=1`.

**Research Field NÃO concede fórmulas via `GrantItem`** (refuta a hipótese
literal da tarefa): os `rules[]` dos 4 docs de campo são só
`ActiveEffectLike`/`RollOption`/`ItemAlteration` (mecânica do Versatile Vial) —
zero `GrantItem` de item. As "Formulas" iniciais (texto: "Two common 1st-level
alchemical bombs/elixirs/mutagens/poisons") são **escolha livre do jogador**,
igual ao "+2 fórmulas por nível" de Formula Book — não há lista fixa a
mecanizar.

**O que o campo de pesquisa REALMENTE concede por `GrantItem` dinâmico** (achado
mais duro que o previsto): os 3 itens do `items{}` "Field Discovery" (L5),
"Advanced Vials" (L11), "Greater Field Discovery" (L13) são *containers* que
fazem `GrantItem` de `{actor|flags.system.alchemist.fieldDiscovery}` etc. — o
alvo real é 1 de 4 variantes por campo (12 docs, 0/12 em pack), decidido pela
`ActiveEffectLike` do campo escolhido no L1. **É a mesma família de problema já
documentada para o Thaumaturge (Adept/Paragon, item 6 do ACHADOS-TRANSVERSAIS)**
— "opções calculadas em tempo de execução a partir de escolha anterior", sem
consumidor no pipeline hoje. Os 12 docs-variante **não** foram trazidos via
`extraNames` (mesma decisão do Thaumaturge — doc sem consumidor é peso morto).

## 5. `classFeatures.extraNames` — os 4 sub-features de "Alchemy"

"Alchemy" (items{} L1) é um *container*: `GrantItem` de 5 sub-features —
`Alchemical Crafting` (feat categoria `skill`, sem trait `alchemist`, **já em
feats-core**, resolve sem ação), `Formula Book`, `Advanced Alchemy`,
`Versatile Vials`, `Quick Alchemy`. As 4 últimas são **incondicionais** (todo
Alchemist ganha as 4 no L1, sem `ChoiceSet`) — trazidas via `extraNames`, mesmo
padrão do "Initiate Benefit" do Thaumaturge.

`Formula Book` faz `GrantItem` de **"Formula Book (Blank)", item de
equipamento** (não class-feature) — resposta à pergunta específica da tarefa
sobre concessão de item de equipamento: o pipeline **tem precedente** disso
(`build-mvp-subset.mjs:1110`, `EQUIPMENT_CORE_GRANT_TARGET_IDS` +
`GRANT_TARGET_CLASS_FEATURE_NAMES`, hoje usado para ancestry/general feats) e o
alvo já está em `equipment-core` (`sourceId qCEOZ6109Yo34tRx`) — mas o
mecanismo é **manual** (Set fixo num arquivo compartilhado), não automático a
partir da curadoria de classe. Trazer "Formula Book" via `extraNames` não basta
sozinho.

`Advanced Alchemy` (`CraftingAbility`) e `Versatile Vials` (`SpecialResource`)
são motores/recursos, sem alvo de documento — dependem de rule-elements que não
apareceram na varredura de `REQ-CMP-035` do topo do `transform.mjs` (só
`GrantItem`/`ActiveEffectLike` lá); não investigado a fundo, registrado como
pergunta em aberto.

## 4-bis. A dívida de conteúdo — MEDIDA (item explícito da tarefa)

Vendor: **824 itens** com trait `alchemical` em `equipment/` (5645 arquivos
varridos), por trait secundário: elixir 217, poison 171, bomb 168, mutagen 70,
drug 24 (+ ammo/outros).

| Traço | No vendor | Já no pack | % | Onde |
| --- | --- | --- | --- | --- |
| elixir | 217 | 31 | 14% | `equipment-core` (predicado aceita só category potion/elixir/talisman, nível ≤8, PC1/PC2/GMCore) |
| bomb | 168 | 24 | 14% | `weapons-core` (Blasting Stone/Blight Bomb/Bottled Lightning/Crystal Shards/Frost Vial/Ghost Charge + Versatile Vial — faltam os staples: Acid Flask, Alchemist's Fire, Tanglefoot Bag) |
| poison | 171 | **0** | **0%** | não existe pack para isso |
| mutagen | 70 | **0** | **0%** | não existe pack para isso |

**Não existe pack `consumables-core`**: `equipment-core` só aceita `consumable`
de `category` potion/elixir/talisman — exclui poison/mutagen por construção.
Sem essa base, feats de bomba (Debilitating Bomb, Directional Bombs, Sticky
Bomb), mutagênico (Regurgitate Mutagen, Perfect Mutagen) e veneno (Double
Poison, Pinpoint Poisoner) não têm alvo mecânico. **Dívida declarada — não é
trabalho desta fase.**

**Correção de uma hipótese própria errada durante o levantamento**: cheguei a
marcar "Versatile Vial" como *critical gap* olhando só `equipment-core`; ele já
está em `weapons-core` (é `type:"weapon"` no vendor, não `equipment`,
`sourceId ljT5pe8D7rudJqus`). "Formula Book (Blank)" também já está em
`equipment-core`. As **duas peças de chassi** já existem; o que falta é o
**catálogo** de itens craftáveis em si.

## 6. Class feats — 67 candidatos confirmados

- **65** exclusivos em `feats/class/alchemist/level-*/` (L1=6, L2=6, L4=10,
  L6=6, L8=8, L10=7, L12=4, L14=4, L16=3, L18=3, L20=8 — soma 65). 0/65 com
  categoria ≠ `class`, 0/65 com trait `archetype`, 0/65 com trait de outra
  classe.
- **2** de `shared-class-feats/` com trait `alchemist`: Poison Resistance (L2,
  alchemist+druid), Inured to Alchemy (L4, alchemist+barbarian+fighter).
- **Total: 67.** **2/67 já em `feats-core`** (os 2 compartilhados, reusados de
  `druid.json`/`fighter.json`).
- **15/65 (23%) exclusivos com `publication.remaster: false`** no vendor
  (Merciful Elixir, Potent Poisoner, Shaped Contaminant, Greater Merciful
  Elixir, Demolition Charge, Astonishing Explosion, Efficient Alchemy
  (Paragon), Perfect Mutagen, Plum Deluge, Wish Alchemy, Calculated Splash,
  Chemical Purification, Artokus's Fire, Perpetual Breadth, Retaliatory
  Cleansing) — proporção bem maior que o Fighter, controle medido a título de
  comparação (3/72, 4%). **Não tratei isso como exclusão** — sem precedente (o
  Fighter já publicado inclui os 3 dele sem ressalva); mantidos todos os 15,
  sinalizado para decisão da integração central.
- **1 caso com nota textual explícita de incompatibilidade**: "Efficient
  Alchemy (Paragon)" (L20) — `"Note: This feat is incompatible with the
  Alchemist class presented in Player Core 2, and is not automated as a
  result."` Mantido no candidate set (mesmo raciocínio acima), sinalizado.

## 7. Pré-requisitos

- **14 de 67** candidatos têm `prerequisites.value` não vazio.
- **11 resolvem internamente**: 9 feat→feat (Advanced Efficient Alchemy→
  Efficient Alchemy (Alchemist); Greater Debilitating Bomb→Debilitating Bomb;
  True Debilitating Bomb→Greater Debilitating Bomb; Supreme/Improved
  Invigorating Elixir→Invigorating Elixir; Uncanny Bombs→Far Lobber; Greater
  Merciful Elixir→Merciful Elixir; Eternal Elixir/Persistent Mutagen→Extend
  Elixir) + 1 feat→**feature** (Potent Poisoner→Powerful Alchemy, items{} L5,
  mesma forma do "Shield Warden→shield block" do Fighter) + 1 feat→sub-feature
  aninhada (Efficient Alchemy (Alchemist)→"advanced alchemy", que resolve para
  o doc "Advanced Alchemy" trazido via `extraNames`, não um top-level do
  `items{}`).
- **0 apontam para fora da classe** (diferente de Fighter/Druid/Thaumaturge,
  que tiveram 1 cada).
- **3 não-mecanizáveis**: Alchemical Assessment→"trained in Crafting" (texto de
  perícia); Inured to Alchemy→"expert in Fortitude saves" (texto idêntico ao já
  registrado em `fighter.json` para o mesmo doc); **Perpetual Breadth→"perpetual
  infusions"** — achado próprio: não resolve para nenhum documento vivo. Existe
  uma família de 15 docs (Perpetual Infusions/Potency/Perfection + 4 variantes
  cada) com o mesmo padrão de `GrantItem` dinâmico do Field Discovery, mas
  **confirmada fora do chassi atual** — ausente da tabela oficial "Class
  Features" do journal (`journals/classes.json`, página Alchemist, célula a
  célula até nível 20) e do `items{}` do doc de classe. "Perpetual Breadth" é
  um dos 15 candidatos com `publication.remaster: false`. Preservado como
  texto, sem predicado inventado.

Total: 11 + 3 = 14 — confere.

## 8. Preparação para multiclasse

- Gate derivado para os 65 exclusivos: trait `alchemist` + `category:"class"`
  → `{"class_level":{"alchemist":{">=":N}}}`, **sem ambiguidade** (0/65 com
  trait de outra classe, 0/65 com trait `archetype`).
- Os 2 compartilhados repetem a mesma pergunta "any entre as classes do trait"
  já registrada 3x (fighter.json, druid.json, thaumaturge.json) — 4ª ocorrência,
  não resolvida aqui.

## 9. Conjuração e focus spells

**Confirma "sem conjuração"**: `system.spellcasting` do doc de classe = `0`;
varredura das 1797 magias do vendor por trait `alchemist` = 0 arquivos.
`spellcasting: null`, `focusSpells: {names: [], alreadyInPacks: []}`.

## 10. Riscos, dívidas e perguntas em aberto

1. **Catálogo de itens alquímicos** (§4-bis): 0% de poison/mutagen em qualquer
   pack, 14% de elixir/bomb. Dívida de conteúdo declarada, fora do escopo desta
   fase.
2. **Família Field Discovery/Advanced Vials/Greater Field Discovery** (§4): 12
   docs-variante não trazidos — mesma família do problema Adept/Paragon do
   Thaumaturge (item 6 do ACHADOS-TRANSVERSAIS). Pergunta: a integração central
   quer generalizar esse mecanismo de uma vez para as duas classes, já que é o
   mesmo formato (`GrantItem` cujo alvo depende de uma escolha anterior)?
3. **`attacks.other` "Alchemical Bombs"** (rank 1 inicial, sobe para rank 2/3
   via `Alchemical Weapon Expertise`/`Alchemical Weapon Mastery` por
   `rules[].path = "system.proficiencies.attacks.weapon-base-alchemical-bomb.rank"`)
   — confirmado por grep que `transform.mjs` não lê esse path hoje. Mesma
   família do risco `classDC` do Fighter (§10 do relatório dele), mas aqui é
   uma trilha de ataque nomeada, não `classDC`.
4. **`classDC` do Alchemist — resolvido**, ao contrário do Fighter: Alchemical
   Expertise (L9→rank2) / Alchemical Mastery (L17→rank3) têm prova textual
   ("Your proficiency rank for your alchemist class DC increases to..."); o
   default `classDC:1` do `transform.mjs` (linha ~2035) já cobre a ausência do
   campo no doc de classe.
5. **`GrantItem` cross-pack de equipamento** (§5): existe precedente
   (`EQUIPMENT_CORE_GRANT_TARGET_IDS`) mas é manual, não automático a partir da
   curadoria — "Formula Book" precisa dessa extensão para resolver de fato.
6. **15/65 candidatos com `publication.remaster: false`**, 1 com nota textual
   explícita de incompatibilidade (Efficient Alchemy (Paragon)) — mantidos sem
   exclusão, sinalizados para decisão.
7. **Gate `class_level` com múltiplos traits** (§8): mesma pergunta repetida
   pela 4ª vez.

## 11. Validação (§5 do PLANO.md)

```
$ node --input-type=module -e "import {validateClassCuration} from './tools/importer-pf2e/src/curation/index.mjs'; import {readFileSync} from 'node:fs'; const f='alchemist.json'; const cfg=validateClassCuration(JSON.parse(readFileSync('tools/importer-pf2e/src/curation/classes/'+f,'utf8')), f); console.log('OK', cfg.class, 'eixos:', cfg.choiceAxes.length, 'feats.trait:', cfg.classFeats.trait);"
OK alchemist eixos: 1 feats.trait: alchemist
```
