# r21 — Fighter — relatório de curadoria

Arquivo de configuração produzido: `tools/importer-pf2e/src/curation/classes/fighter.json`.

## 1. Método (comandos rodados)

Todas as contagens abaixo vieram de scripts `node -e` executados contra
`tools/importer-pf2e/vendor/pf2e/packs/pf2e/` (fonte, somente leitura) e
`systems/pf2e/packs/*/documents.json` (packs atuais do Fusion). Nenhum arquivo
compartilhado foi tocado; nenhum `git` ou importer foi rodado. Os comandos
relevantes (reconstruíveis a partir deste relatório):

- Leitura de `classes/fighter.json` do vendor → `system.items{}`, `hp`,
  `keyAbility`, `perception`, `savingThrows`, `attacks`, `defenses`,
  `featLevels` (na verdade `ancestryFeatLevels`/`classFeatLevels`/
  `generalFeatLevels`/`skillFeatLevels`, ver §2), `skillIncreaseLevels`,
  `trainedSkills`.
- Varredura das 27 pastas de `classes/*.json` do vendor contando quantas
  referenciam cada um dos 16 nomes canônicos do `items{}` do Fighter (união
  dos nomes = segmento final da uuid, nunca `entry.name`).
- Leitura de `systems/pf2e/packs/class-features-core/documents.json` (48 docs)
  e cruzamento por `name` + `flags.fusion.sourceId`.
- Varredura recursiva de `feats/class/fighter/level-*/` (72 arquivos) e
  `feats/class/shared-class-feats/level-*/` (113 arquivos, filtrados para os
  38 com trait `fighter`) — a pasta `shared-class-feats` é subdividida por
  nível, não plana, o que exigiu recursão (o primeiro `readdirSync` direto
  retornou 0 arquivos `.json`).
- Leitura de `systems/pf2e/packs/feats-core/documents.json` (459 docs) e
  cruzamento por `sourceId` dos 110 candidatos — 0 de overlap.
- Leitura de `spells/focus/*.json` do vendor filtrando trait `fighter` — 0.
- Leitura de `tools/importer-pf2e/src/transform.mjs` (só leitura, para
  entender a convenção já usada no Kineticist de mapear a chave de subfeature
  igual ao slug da classe para o stat `classDC`).

## 2. Doc da classe (medido)

| Campo | Valor |
| --- | --- |
| hp | 10 |
| keyAbility | `["dex","str"]` (não há restrição de ordem no vendor; ambas STR e DEX são válidas) |
| perception | 2 (expert em nível 1) |
| savingThrows | fortitude 2, reflex 2, will 1 (fort/reflex expert; will trained) |
| attacks | simple 2, martial 2, advanced 1, unarmed 2, other `{name:"", rank:0}` |
| defenses | heavy 1, light 1, medium 1, unarmored 1 (trained em tudo) |
| ancestryFeatLevels | 1, 5, 9, 13, 17 |
| classFeatLevels | 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20 |
| generalFeatLevels | 3, 7, 11, 15, 19 |
| skillFeatLevels | 2, 4, 6, 8, 10, 12, 14, 16, 18, 20 |
| skillIncreaseLevels | 3, 5, 7, 9, 11, 13, 15, 17, 19 |
| trainedSkills | `value: []`, `additional: 3` |
| spellcasting | `0` (sem conjuração) |

**Nota de schema:** o doc do vendor não tem um campo único `featLevels` — são
quatro campos separados (`ancestryFeatLevels`, `classFeatLevels`,
`generalFeatLevels`, `skillFeatLevels`). O schema do plano (§3.3) fala em
"featLevels (class/skill/general/ancestry)" — reportando aqui para a
integração central mapear os quatro campos do vendor para a estrutura
combinada esperada.

### `items{}` (16 entradas, nome canônico = segmento final da uuid)

| Nível (items{} da classe) | Feature | Nível genérico do arquivo (`class-features/*.json`) | Divergência? |
| --- | --- | --- | --- |
| 1 | Reactive Strike | 1 | não |
| 1 | Shield Block | 1 | não |
| 3 | Bravery | 3 | não |
| 5 | Fighter Weapon Mastery | 5 | não |
| 7 | Battlefield Surveyor | 7 | não |
| 7 | Weapon Specialization | 7 | não |
| 9 | Battle Hardened | 9 | não |
| 9 | Combat Flexibility | 9 | não |
| 11 | Armor Expertise | **7** | **SIM — armadilha confirmada** |
| 11 | Fighter Expertise | 11 | não |
| 13 | Weapon Legend | 13 | não |
| 15 | Greater Weapon Specialization | 15 | não |
| 15 | Improved Flexibility | 15 | não |
| 15 | Tempered Reflexes | 15 | não |
| 17 | Armor Mastery | **13** | **SIM — segunda armadilha, não citada no plano** |
| 19 | Versatile Legend | 19 | não |

Os 16 nomes do `items{}` batem exatamente com o segmento final da uuid em
todos os casos — não há aqui o problema do Magus (`entry.name` "Lightning
Reflexes" ≠ uuid tail "Reflex Expertise"). Verificado por comparação direta
`v.name === uuid.split('.').pop()` para as 16 entradas.

**Duas divergências de nível, não uma:** o plano cita Armor Expertise
(7 genérico → 11 no Fighter) como exemplo da armadilha. A varredura encontrou
uma segunda, do mesmo tipo, não mencionada no plano: **Armor Mastery** diz
nível 13 no arquivo genérico (`armor-mastery.json`) mas o Fighter concede no
nível **17** do seu `items{}`. Ambas estão registradas em
`dedupe.collisionsDetected` no JSON de curadoria.

## 3. Features compartilhadas com outras classes (união de `items{}` das 27 classes do vendor)

| Feature do Fighter | Nº de classes do vendor que a referenciam | Classes |
| --- | --- | --- |
| Shield Block | 7 | Champion, Commander, Druid, Exemplar, Fighter, Guardian, Inventor |
| Weapon Specialization | 25 | quase todas as classes (exceção: Guardian não tem? conferir — lista completa no script) |
| Greater Weapon Specialization | 13 | Champion, Commander, Fighter, Guardian, Gunslinger, Inventor, Investigator, Magus, Monk, Ranger, Rogue, Swashbuckler, Thaumaturge |
| Armor Mastery | 4 | Barbarian, Champion, Commander, Fighter |
| Battle Hardened | 2 | Fighter, Guardian |
| Armor Expertise | 3 | Champion, Commander, Fighter |
| Weapon Legend | 1 | só Fighter |
| Fighter Expertise | 1 | só Fighter |
| Reactive Strike | 1 | só Fighter (o nome genérico "Attack of Opportunity" de outras classes usa outra feature) |
| Tempered Reflexes | 1 | só Fighter |
| Improved Flexibility | 1 | só Fighter |
| Battlefield Surveyor | 1 | só Fighter |
| Bravery | 1 | só Fighter |
| Combat Flexibility | 1 | só Fighter |
| Fighter Weapon Mastery | 1 | só Fighter |
| Versatile Legend | 1 | só Fighter |

**Shield Block confirmado como caso-teste do plano: 7 classes.**

## 4. Já existe nos packs (`class-features-core`, 48 docs) — REUSAR

Cruzamento por `name` e por `flags.fusion.sourceId`:

- **Weapon Specialization** — já em `class-features-core`, `sourceId`
  `9EqIasqfI8YIM3Pt`. Confirmado idêntico ao `_id` do vendor
  `class-features/weapon-specialization.json` (`9EqIasqfI8YIM3Pt`). **Reusar,
  não recriar.**
- **Greater Weapon Specialization** — já em `class-features-core`, `sourceId`
  `Z7HX6TeFsaup7Dx9`, idêntico ao `_id` do vendor
  `class-features/greater-weapon-specialization.json`
  (`Z7HX6TeFsaup7Dx9`). **Reusar.**

Faltam nos packs (14 de 16 features do `items{}` do Fighter): Armor Expertise,
Armor Mastery, Battle Hardened, Battlefield Surveyor, Bravery, Combat
Flexibility, Fighter Expertise, Fighter Weapon Mastery, Improved Flexibility,
Reactive Strike, Shield Block, Tempered Reflexes, Versatile Legend, Weapon
Legend.

## 5. Eixo de sub-escolha

**Fighter não tem eixo.** Varredura de `system.traits.otherTags` em todos os
827 arquivos de `class-features/*.json` procurando prefixo `fighter` retornou
lista vazia. `choiceAxes: []` no JSON de curadoria.

## 6. Class feats

- **72** feats exclusivos em `feats/class/fighter/level-*/` (pasta dividida
  por subpasta de nível: level-1=5, level-2=9, level-4=7, level-6=10,
  level-8=7, level-10=11, level-12=7, level-14=6, level-16=4, level-18=2,
  level-20=4 — soma 72).
- **38** feats de `feats/class/shared-class-feats/level-*/` (113 arquivos no
  total da pasta) que carregam o trait `fighter`.
- **Total candidato: 110** class feats com trait `fighter` e
  `system.category === "class"` (confirmado — nenhum tem categoria
  diferente).
- **0 de 110 já estão em `feats-core`** (459 docs, 75 de categoria `class`,
  0 com trait `fighter`). Confirmado por nome e por `sourceId` — sem overlap.
  Todos os 110 são novos.
- Distribuição por nível (exclusivos + compartilhados combinados, contagem
  aproximada por pasta — o número exato por nível não foi tabulado
  separadamente para os 38 compartilhados; a soma total de 110 está
  verificada).
- Fighter é de fato a classe com mais class feats: 110 candidatos é o maior
  volume entre as classes tocadas nesta rodada (Barbarian/Rogue/Ranger têm
  bem menos feats exclusivos + compartilhados, por comparação de tamanho de
  pasta feita rapidamente — não medido linha a linha para as outras 4
  classes, que são responsabilidade de outros agentes).

Vendor já desambigua homônimos com sufixo `(Fighter)`: 5 dos 110 feats têm
esse sufixo (`Dueling Dance (Fighter)`, `Improved Twin Riposte (Fighter)`,
`Twinned Defense (Fighter)`, `Guardian's Deflection (Fighter)`,
`Ricochet Stance (Fighter)`), indicando que o mesmo feat-base existe também
para outra classe (ex.: Monk tem sua própria "Dueling Dance"). Nenhuma
colisão de nome sem desambiguação foi encontrada dentro do conjunto de 110.

## 7. Pré-requisitos

- **38 de 110** feats candidatos têm `system.prerequisites.value` não vazio.
- **27** exigem outro feat OU feature da própria classe (Fighter) —
  resolvem para um nó dentro do próprio conjunto de 110 feats + 16 features:
  21 apontam para outro **feat** (ex.: Crashing Slam → Slam Down), 6 apontam
  para uma **feature** do `items{}` (ex.: Shield Warden → "shield block",
  minúsculo no texto original; Resounding Bravery → "bravery"; Ultimate
  Flexibility → "improved flexibility"; Disorienting Opening / Impassable
  Wall Stance → "Reactive Strike"; Quick Shield Block → "shield block").
- **1** aponta para fora do conjunto da classe: **Master of Many Styles**
  exige `Opening Stance (Fighter)` (interno) **e** `Reflexive Stance (Monk)`
  (externo — feat do Monk, fora da seleção do Fighter). Registrado em
  `referencesOutsideSelection`.
- **10** são não-mecanizáveis nesta rodada (texto de perícia/proficiência, não
  convertido em predicado): "trained in Athletics" (5x — Disarming Twist,
  Slam Down, Disarming Stance, Barreling Charge, Knight's Retaliation),
  "expert in Fortitude saves" (2x — Inured to Alchemy, Pain Tolerance),
  "expert in Intimidation" (Dazzling Display), "trained in Acrobatics and
  medium armor" (Farabellus Flip), "master in Perception" (Blind-Fight).
  Todos preservados como texto de requisito, sem predicado inventado
  (REQ-BC-034).

Total: 27 + 1 + 10 = 38 — confere com o total de feats com prerequisites.

### 5 exemplos com a forma exata do JSON do vendor

```json
// feats/class/fighter/level-10/crashing-slam.json — system.prerequisites
{ "value": [ { "value": "Slam Down" } ] }
```

```json
// feats/class/fighter/level-4/powerful-shove.json — system.prerequisites
{ "value": [ { "value": "Aggressive Block or Brutish Shove" } ] }
```

```json
// feats/class/shared-class-feats/level-6/shield-warden.json — system.prerequisites
{ "value": [ { "value": "shield block" } ] }
```

```json
// feats/class/shared-class-feats/level-16/master-of-many-styles.json — system.prerequisites
{ "value": [ { "value": "Opening Stance (Fighter)" }, { "value": "Reflexive Stance (Monk)" } ] }
```

```json
// feats/class/fighter/level-20/ultimate-flexibility.json — system.prerequisites
{ "value": [ { "value": "improved flexibility" } ] }
```

## 8. Preparação para multiclasse (§4 do plano)

- Gate derivado para os 110 class feats: trait `fighter` + `category:"class"`
  → `{"class_level": {"fighter": {">=": N}}}`, N = nível do arquivo do feat
  (que já é nível de classe, não genérico — feats não têm o problema de
  "nível genérico mente" que as features têm).
- **Ambiguidade real encontrada (diferente da citada no plano como
  archetype-vs-classe):** nenhum dos 110 tem trait `archetype`, então não há
  o conflito archetype-vence-classe aqui. Mas **38 dos 110** também carregam
  trait de **outra classe** (ex.: Sudden Charge = `barbarian` + `fighter`;
  Blind-Fight = `fighter`+`investigator`+`ranger`+`rogue`). Quando o mesmo
  feat aparece na configuração de duas classes curadas nesta rodada (Fighter
  e Barbarian, por exemplo), a regra do plano (§4.1, "trait de classe X +
  category:class → class_level:{X:N}") não diz qual `X` usar quando há mais
  de um trait de classe no mesmo doc. **Pergunta em aberto para a integração
  central:** o predicado deveria virar
  `{"any":[{"class_level":{"fighter":{">=":N}}}, {"class_level":{"barbarian":{">=":N}}}]}`
  (o feat fica disponível por qualquer uma das classes que o concedem), ou
  o doc precisa de um `grantedBy`-like por classe também para feats (não só
  features, como o §4.2 já prevê)? Não decidido aqui — fora do escopo deste
  agente (só features passam por `grantedBy` no plano).

## 9. Focus spells

Zero. `system.spellcasting` do doc de classe do vendor é `0`; varredura de
`spells/focus/*.json` por trait `fighter` retornou 0 arquivos.

## 10. Ambiguidade `classDC`

Duas das 16 features do Fighter carregam `subfeatures.proficiencies` com uma
chave igual ao **slug da própria classe**:

- Fighter Expertise (items{} nível 11): `{"fighter":{"attribute":null,"rank":2}}`
- Versatile Legend (items{} nível 19): inclui `"fighter":{"attribute":null,"rank":3}` além de `advanced/martial/simple/unarmed`

O mesmo padrão existe hoje para o Kineticist (`"kineticist":{...}` mapeado
para o stat `classDC`, comentário em `transform.mjs` linhas ~1479-1509,
tabela hardcoded ainda não generalizada por esta rodada). **Risco:** ao
contrário de Magus e Kineticist, o doc `classes/fighter.json` do vendor
**não tem** o campo `system.classDC` (confirmado: `'classDC' in doc.system`
→ `false`). A tabela esperada abaixo assume, por analogia com o Kineticist,
que a chave `fighter` mapeia para `classDC` — mas a integração central
precisa decidir explicitamente se o Fighter ganha um `classDC` inicial
(rank 1) e se essa é de fato a leitura correta, ou se a chave `fighter` aqui
representa outra coisa (ex.: `attacks.other`, o "peso" de arma que o doc de
classe já expõe como `{"name":"","rank":0}` e que nenhuma feature do
`items{}` parece preencher). **Não resolvido — reportado, não decidido.**

## 11. Tabela esperada de `proficiencyUpgrades` (derivação central deve reproduzir)

Todas as linhas abaixo usam o **nível do `items{}` do Fighter**, nunca o
nível genérico do arquivo (ver §2 para as duas divergências).

| level | stat | rank | origem (feature + arquivo) |
| --- | --- | --- | --- |
| 3 | will | 2 | Bravery — `class-features/bravery.json` |
| 7 | perception | 3 | Battlefield Surveyor — `class-features/battlefield-surveyor.json` |
| 9 | fortitude | 3 | Battle Hardened — `class-features/battle-hardened.json` |
| 11 | armor.heavy | 2 | Armor Expertise — `class-features/armor-expertise.json` (nível genérico 7, usar 11) |
| 11 | armor.light | 2 | Armor Expertise |
| 11 | armor.medium | 2 | Armor Expertise |
| 11 | armor.unarmored | 2 | Armor Expertise |
| 11 | classDC | 2 | Fighter Expertise — `class-features/fighter-expertise.json` (ver §10, ambíguo) |
| 13 | weapons.advanced | 2 | Weapon Legend — `class-features/weapon-legend.json` |
| 13 | weapons.martial | 3 | Weapon Legend |
| 13 | weapons.simple | 3 | Weapon Legend |
| 13 | weapons.unarmed | 3 | Weapon Legend |
| 15 | reflex | 3 | Tempered Reflexes — `class-features/tempered-reflexes.json` |
| 17 | armor.light | 3 | Armor Mastery — `class-features/armor-mastery.json` (nível genérico 13, usar 17) |
| 17 | armor.medium | 3 | Armor Mastery |
| 17 | armor.unarmored | 3 | Armor Mastery |
| 19 | weapons.advanced | 3 | Versatile Legend — `class-features/versatile-legend.json` |
| 19 | weapons.martial | 4 | Versatile Legend |
| 19 | weapons.simple | 4 | Versatile Legend |
| 19 | weapons.unarmed | 4 | Versatile Legend |
| 19 | classDC | 3 | Versatile Legend (ver §10, ambíguo) |

**Nota:** Armor Mastery no vendor não inclui `heavy` no seu
`subfeatures.proficiencies` (só light/medium/unarmored) — medido, não
suposto; o Fighter fica sem upgrade de `armor.heavy` além do rank 2 dado
por Armor Expertise no nível 11.

## 12. Decisões tomadas

- `choiceAxes: []` — sem eixo, confirmado por varredura completa dos 827
  arquivos de `class-features`.
- `spellcasting: null`, `focusSpells: {names:[], alreadyInPacks:[]}` — Fighter
  não conjura.
- Reuso de Weapon Specialization e Greater Weapon Specialization confirmado
  por `sourceId`, não só por nome.
- As duas divergências de nível genérico×items{} (Armor Expertise, Armor
  Mastery) foram registradas em `dedupe.collisionsDetected` com o nível
  correto (o do `items{}`) documentado na tabela do §11.
- `classFeats.trait: "fighter"`, `includeSharedClassFeats: true` — nenhuma
  lista de 110 nomes foi hardcoded no JSON de curadoria (R3 do plano); a
  seleção fica por predicado (trait + category) na integração central.

## 13. Perguntas em aberto para a integração central

1. **`classDC` do Fighter** (§10): emitir `classDC: 1` inicial no doc de
   classe do Fighter (que hoje não tem esse campo) para sustentar os upgrades
   de Fighter Expertise/Versatile Legend? Ou a chave de subfeature `fighter`
   significa outra coisa aqui?
2. **Gate de class feat com múltiplos traits de classe** (§8): 38 dos 110
   feats do Fighter também têm trait de outra classe — o predicado
   `class_level` deve virar `any` entre as classes-trait presentes, ou os
   feats também precisam de um `grantedBy`-like (hoje só previsto para
   features no plano §4.2)?
3. **`featLevels` combinado**: o vendor separa em quatro campos
   (`ancestryFeatLevels`/`classFeatLevels`/`generalFeatLevels`/
   `skillFeatLevels`); o schema do plano fala de um único `featLevels`
   estruturado — confirmar o formato de saída esperado.
4. Distribuição exata por nível dos 38 feats compartilhados não foi tabulada
   separadamente (só o total combinado 110 foi verificado) — se o mapa de
   nós (§5 do plano) precisar da distribuição por nível separando exclusivo
   vs. compartilhado, medir de novo a partir do array salvo (não persistido
   fora desta sessão).
