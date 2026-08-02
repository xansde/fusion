# r21 — Wizard: relatório de curadoria

> Agente da classe **Wizard** (slug `wizard`). Escopo, regras e schema em
> `.fusion-build/r21-plan.md`. Entregas: este relatório +
> `tools/importer-pf2e/src/curation/classes/wizard.json`. **Nenhum arquivo
> compartilhado foi tocado; o importer não foi rodado; nenhum comando git.**

---

## 1. Método — comandos que produziram cada número

Todos os scripts foram escritos no scratchpad da sessão
(`…/scratchpad/*.mjs`) e rodados com `node` a partir da raiz do repo. Nenhum
número deste relatório vem de memória ou de estimativa.

| #   | Script / comando                                   | O que mediu                                                                                        |
| --- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | `node -e` sobre `classes/wizard.json`              | hp, keyAbility, perception, saves, attacks, defenses, trainedSkills, featLevels, skillIncrease     |
| 2   | `node -e` — dump do `system.items{}`               | 15 features, nome canônico = segmento final da uuid, nível do `items{}`                            |
| 3   | `node -e` — varredura das 27 `classes/*.json`      | quantas classes referenciam cada feature do Wizard                                                 |
| 4   | `node -e` — cruzamento com `class-features/`       | `system.level` do arquivo genérico × nível do `items{}`, `subfeatures.proficiencies`, `otherTags`  |
| 5   | `node -e` — mesmo cruzamento para Magus/Kineticist | reverse-engineering do mapa `subfeature key → stat` da tabela atual                                |
| 6   | `scratchpad/x.mjs`                                 | `otherTags` `wizard-*` e contagem de opções por eixo                                               |
| 7   | `scratchpad/feats.mjs`                             | 5.987 feats do vendor → 63 com trait `wizard`, categoria, pasta, nível, rarity, traits múltiplos   |
| 8   | `scratchpad/dedupe.mjs`                            | cruzamento dos 53 class feats com `feats-core` (sourceId **e** nome) + parsing dos `prerequisites` |
| 9   | `scratchpad/focus.mjs`                             | 458 focus spells do vendor × `spells-core`; as 26 school spells do Wizard                          |
| 10  | `scratchpad/j.mjs` / `j2.mjs`                      | localização e extração do journal `classes.json` → page `wDukeO3euLEGn6FA` (Wizard)                |
| 11  | `scratchpad/ez.mjs`                                | slots das fichas pregen oficiais `iconics/ezren` (níveis 1, 3, 5)                                  |
| 12  | `scratchpad/curr.mjs`                              | 257 referências de magia nas 14 escolas × `spells-core`; rarity/rules de teses e escolas           |
| 13  | `scratchpad/risks.mjs`                             | homônimos no vendor, colisão de nome × sourceId nos packs, "Counterspell", "Quick Recognition"     |

---

## 2. O doc da classe (medido em `classes/wizard.json`, `_id` `RwjIZzIxzPpUglnK`)

```
hp = 6
keyAbility = ["int"]                       (uma única opção)
perception = 1                             (treinado)
savingThrows = fortitude 1, reflex 1, will 2   << will já EXPERT no nível 1
attacks = simple 1, unarmed 1, martial 0, advanced 0
defenses = unarmored 1, light 0, medium 0, heavy 0
spellcasting = 1                           (proficiência de conjuração: treinado @1)
trainedSkills = ["arcana"] + 2 adicionais
ancestryFeatLevels = [1,5,9,13,17]
classFeatLevels    = [2,4,6,8,10,12,14,16,18,20]
generalFeatLevels  = [3,7,11,15,19]
skillFeatLevels    = [2,4,6,8,10,12,14,16,18,20]
skillIncreaseLevels= [3,5,7,9,11,13,15,17,19]
publication = { license: "ORC", remaster: true, title: "Pathfinder Player Core" }
```

**`classDC` não existe no doc do vendor** (nem no do Magus). O `transform.mjs`
já resolve isso com `classDC: src.classDC ?? system.classDC ?? 1`
(`transform.mjs:1736`) — e o journal confirma "Trained in wizard class DC".
Nada a fazer, mas fica registrado para não parecer omissão.

### 2.1 `items{}` — 15 features, nome canônico + nível de classe

| Nível | Nome canônico (segmento final da uuid) | `entry.name` diverge? |
| ----- | -------------------------------------- | --------------------- |
| 1     | Wizard Spellcasting                    | não                   |
| 1     | Arcane School                          | não                   |
| 1     | Arcane Bond                            | não                   |
| 1     | Arcane Thesis                          | não                   |
| 5     | Reflex Expertise                       | não                   |
| 7     | Expert Spellcaster                     | não                   |
| 9     | Magical Fortitude                      | não                   |
| 11    | Perception Expertise                   | não                   |
| 11    | Weapon Expertise                       | não                   |
| 13    | Defensive Robes                        | não                   |
| 13    | Weapon Specialization                  | não                   |
| 15    | Master Spellcaster                     | não                   |
| 17    | Prodigious Will                        | não                   |
| 19    | Archwizard's Spellcraft                | não                   |
| 19    | Legendary Spellcaster                  | não                   |

**15/15 sem divergência `entry.name` × uuid** — ao contrário do `magus.json`.
A regra do nome canônico foi aplicada mesmo assim (é o que o loader deve usar).

---

## 3. Compartilhamento e nível — a armadilha do nível genérico

Medição sobre as **27 classes** do vendor.

| Feature                 | Nível no Wizard | Nº de classes | `system.level` do arquivo | Divergência  |
| ----------------------- | --------------: | ------------: | ------------------------: | ------------ |
| Wizard Spellcasting     |               1 |             1 |                         1 | —            |
| Arcane School           |               1 |             1 |                         1 | —            |
| Arcane Bond             |               1 |             1 |                         1 | —            |
| Arcane Thesis           |               1 |             1 |                         1 | —            |
| Reflex Expertise        |               5 |            12 |                     **3** | **sim (+2)** |
| Expert Spellcaster      |               7 |            10 |                         7 | —            |
| Magical Fortitude       |               9 |             4 |                     **5** | **sim (+4)** |
| Perception Expertise    |              11 |            12 |                     **3** | **sim (+8)** |
| Weapon Expertise        |              11 |            14 |                     **5** | **sim (+6)** |
| Defensive Robes         |              13 |             4 |                        13 | —            |
| Weapon Specialization   |              13 |        **25** |                     **7** | **sim (+6)** |
| Master Spellcaster      |              15 |            10 |                        15 | —            |
| Prodigious Will         |              17 |             1 |                        17 | —            |
| Archwizard's Spellcraft |              19 |             1 |                        19 | —            |
| Legendary Spellcaster   |              19 |             8 |                        19 | —            |

**5 de 15 features têm nível genérico mentiroso.** Ler `system.level` do arquivo
produziria: Reflex Expertise em 3 (é 5), Perception Expertise em 3 (é 11),
Weapon Expertise em 5 (é 11), Magical Fortitude em 5 (é 9), Weapon
Specialization em 7 (é 13). Todos os cinco são exatamente os docs que o
`grantedBy[]` do plano §4.2 precisa carregar por classe.

Exemplo do porquê: **Weapon Specialization** aparece em 25 das 27 classes; no
Fighter, no Ranger e no Barbarian o nível é outro. Não existe "o nível" dela.

---

## 4. Tabela esperada de `proficiencyUpgrades` (com a origem de cada linha)

O nível é sempre o do `items{}` **da classe Wizard**; o rank sempre o de
`system.subfeatures.proficiencies` do arquivo da feature. O nome do `stat`
segue a convenção já usada nos packs (verificada no doc do Magus e do
Kineticist em `systems/pf2e/packs/classes-core/documents.json`): categorias de
arma → `weapons.<cat>`, categorias de armadura → `armor.<cat>`, o resto literal.

| level | stat            | rank | Origem (feature + arquivo)                                                         |
| ----: | --------------- | ---: | ---------------------------------------------------------------------------------- |
|     5 | reflex          |    2 | Reflex Expertise — `class-features/reflex-expertise.json` `{"reflex":{"rank":2}}`  |
|     7 | spellcasting    |    2 | Expert Spellcaster — `expert-spellcaster.json` `{"spellcasting":{"rank":2}}`       |
|     9 | fortitude       |    2 | Magical Fortitude — `magical-fortitude.json` `{"fortitude":{"rank":2}}`            |
|    11 | perception      |    2 | Perception Expertise — `perception-expertise.json` `{"perception":{"rank":2}}`     |
|    11 | weapons.simple  |    2 | Weapon Expertise — `weapon-expertise.json` `{"simple":{"rank":2}}`                 |
|    11 | weapons.unarmed |    2 | Weapon Expertise — `weapon-expertise.json` `{"unarmed":{"rank":2}}`                |
|    13 | armor.unarmored |    2 | Defensive Robes — `defensive-robes.json` `{"unarmored":{"rank":2}}`                |
|    15 | spellcasting    |    3 | Master Spellcaster — `master-spellcaster.json` `{"spellcasting":{"rank":3}}`       |
|    17 | will            |    3 | Prodigious Will — `prodigious-will.json` `{"will":{"rank":3}}`                     |
|    19 | spellcasting    |    4 | Legendary Spellcaster — `legendary-spellcaster.json` `{"spellcasting":{"rank":4}}` |

Sem linha (medido: `subfeatures.proficiencies` ausente ou vazio):
**Wizard Spellcasting, Arcane School, Arcane Bond, Arcane Thesis,
Weapon Specialization (bônus de dano), Archwizard's Spellcraft (slot de rank 10)**.

Progressão de conjuração resultante, por nível de **classe**:
`trained@1 → expert@7 → master@15 → legendary@19`. Medida, não assumida —
o `system.spellcasting: 1` do doc da classe dá o trained inicial e os três
`Spellcaster` dão os degraus.

### 4.1 Armadilha que NÃO é do Wizard mas quebra o portão 4 do plano

`weapon-expertise.json` declara em `subfeatures.proficiencies` apenas
`simple` e `unarmed`. O rank 2 de **martial** vem de um rule element:

```json
{
  "key": "ActiveEffectLike",
  "mode": "upgrade",
  "path": "system.proficiencies.attacks.martial.rank",
  "predicate": [
    {
      "or": [
        "class:champion",
        "class:exemplar",
        "class:guardian",
        "class:investigator",
        "class:magus",
        "class:swashbuckler",
        "class:thaumaturge"
      ]
    }
  ],
  "value": 2
}
```

A tabela atual do Magus no pack tem `{level:5, stat:"weapons.martial", rank:2}`.
Uma derivação genérica que leia **só** `subfeatures.proficiencies` **perde essa
linha** e o portão 6.4 ("reproduz Magus item a item") falha. O Wizard **não**
está no predicate — e nem é treinado em marciais —, então para esta classe o
resultado é o mesmo por qualquer caminho. Fica registrado porque é a integração
central que vai pisar nisso.

---

## 5. Eixos de sub-escolha

Medido em `system.traits.otherTags` dos 827 arquivos de `class-features/`
(1 arquivo ignorado: `_folders.json`, que não tem `system`).

| Eixo          | otherTag do vendor     | Feature no `items{}` | Nível | Opções |
| ------------- | ---------------------- | -------------------- | ----: | -----: |
| Arcane Thesis | `wizard-arcane-thesis` | **Arcane Thesis**    |     1 |  **5** |
| Arcane School | `wizard-arcane-school` | **Arcane School**    |     1 | **14** |

Bate com a tabela do plano §R3 (5 e 14). Os dois eixos acendem no **nível 1**,
o que significa que a verificação viva (portão 9) já vê os dois na primeira
tela do builder — não precisa subir de nível.

**Teses (5, todas common, Player Core):** Experimental Spellshaping
`89zWKD2CN7nRu2xp` · Improved Familiar Attunement `SNZ46g3u7U6x0XJj` ·
Spell Blending `OAcxS625AXSGrQIC` · Spell Substitution `QzWXMCSGNfvvpYgF` ·
Staff Nexus `Klb35AwlkNrq1gpB`.

**Escolas (14):** 7 common — Ars Grammatica `wObrT6PytPdS5aUi`, Battle Magic
`E4GZDMn4DYk6qSEV`, Civic Wizardry `YZ2XPmx1WHyWtM0g`, Mentalism
`L5FiuXsfW6Sa31gO`, Protean Form `ZBFICTkzUjE4BDGJ`, the Boundary
`ZpFCZnVzIfZLfNii`, Unified Magical Theory `xYYhJtGhFSWNifcO`;
6 uncommon — Red Mantis `srcPBNjhq7FBSmi3`, Gates `XXnGHBxNZvRsdkKM`,
Kalistrade `jtAqb5rnhQblZuM8`, Magical Technologies `dPAwM9IdabdH68mW`,
Rooted Wisdom `KGkWSv9rARpwWzXW`, the Reclamation `n2LRzksKVSzOuzqN`;
1 rare — **Runelord** `HYTaibaCGE85rhbZ`.

**Nenhuma das 19 opções está hoje em `class-features-core`** (medido por
sourceId: 0/5 e 0/14). São 19 documentos novos.

### 5.1 Um terceiro `wizard-*` que NÃO é eixo

`wizard-elemental-school` existe, com 2 docs (`Elemental School`
`5rFzX6JK6CXLFxUP` e `School of Unified Magical Theory`). É a variante legada
da escola elemental (`elemental-magic.json` também referencia a tag). **Não
gerar slot a partir dela.** E note que _School of Unified Magical Theory_
carrega as **duas** tags — dedupe por sourceId no pack de eixos é obrigatório,
senão ela entra duas vezes.

---

## 6. Class feats

Universo: **5.987** arquivos de feat no vendor (excluindo `_folders.json`).
Com trait `wizard`: **63** — **todos** com `system.category === "class"`.

Desses 63, **10 vivem em `feats/archetype/wizard/`** e carregam
`traits: ["archetype","druid","wizard"]`, rarity `rare`, nível 20 (os "\* Mask"
de Lost Omens). São feats de arquétipo → **excluídos** (estão em
`classFeats.excludeNames`).

**Conjunto do Wizard: 53 class feats.** 31 em `feats/class/wizard/**`,
22 em `feats/class/shared-class-feats/**`.

### 6.1 Distribuição por nível (53)

| Nível |   N | Feats                                                                                                                   |
| ----: | --: | ----------------------------------------------------------------------------------------------------------------------- |
|     1 |   5 | Counterspell (Prepared), Familiar, Reach Spell, Spellbook Prodigy, Widen Spell                                          |
|     2 |   5 | Cantrip Expansion, Conceal Spell, Energy Ablation, Enhanced Familiar, Nonlethal Spell                                   |
|     4 |   5 | Bespell Strikes, Call Wizardly Tools, Linked Focus, Spell Protection Array, Undying Conviction                          |
|     6 |   6 | Convincing Illusion, Detonating Spell, Explosive Arrival, Irresistible Magic, Split Slot, Steady Spellcasting           |
|     8 |   6 | Advanced School Spell, Bond Conservation, Chaotic Spell, Form Retention, Helt's Spelldance, Knowledge is Power (Wizard) |
|    10 |   3 | Overwhelming Energy, Quickened Casting, Scroll Adept                                                                    |
|    12 |   5 | Clever Counterspell, Forcible Energy, Keen Magical Detection, Magic Sense, Necromancer's Visage                         |
|    14 |   6 | Bonded Focus, Reflect Spell, Secondary Detonation Array, Sepulchral Sublimation, Shift Spell, Superior Bond             |
|    16 |   3 | Effortless Concentration, Scintillating Spell, Spell Tinker                                                             |
|    18 |   3 | Infinite Possibilities, Reprepare Spell, Second Thoughts                                                                |
|    20 |   6 | Archwizard's Might, Reclaim Spell, Spell Combination, Spell Mastery, Spellshape Mastery, Worldsphere Gravity            |

Rarity: 44 common, 9 uncommon (Necromancer's Visage, Sepulchral Sublimation,
Undying Conviction, Detonating Spell, Chaotic Spell, Helt's Spelldance, Shift
Spell, Reclaim Spell, Worldsphere Gravity), 0 rare.

### 6.2 Já em `feats-core` (459 docs) — **3**

Cruzados por `flags.fusion.sourceId` **e** por nome normalizado; os dois
critérios deram o mesmo resultado (0 casos de nome batendo com sourceId
diferente — sem homônimo entre o conjunto novo e o pack atual).

| Feat              | sourceId           | Nível |
| ----------------- | ------------------ | ----: |
| Familiar          | `bcxIg7wi8ZAhvhOD` |     1 |
| Cantrip Expansion | `A7ofsoPva0UtjqrX` |     2 |
| Enhanced Familiar | `N7dTFxpjXGn4ddq8` |     2 |

**50 feats a criar.** Os três acima vieram junto do Magus (trait compartilhado)
e devem ser **reusados**, nunca recriados.

---

## 7. Pré-requisitos

**18 dos 53** feats têm `system.prerequisites.value` não vazio (23 cláusulas no
total).

### 7.1 Cadeias internas — 11 arestas do mapa de nós

`Familiar → Enhanced Familiar` · `Arcane Bond → Call Wizardly Tools` ·
`Arcane Bond → Linked Focus` · `Arcane Bond → Bond Conservation` ·
`Arcane Bond → Bonded Focus` · `Arcane Bond → Superior Bond` ·
`Arcane School → Advanced School Spell` ·
`Archwizard's Spellcraft → Archwizard's Might` ·
`Reprepare Spell → Reclaim Spell` ·
`Counterspell (Prepared) → Reflect Spell` ·
`Counterspell (Prepared) → Clever Counterspell`.

5 delas apontam para **class features** (Arcane Bond, Arcane School,
Archwizard's Spellcraft), não para feats — o resolvedor de arestas do §5 do
plano tem de considerar features, senão 6 arestas somem.

### 7.2 Cinco exemplos com a forma exata do JSON

```jsonc
// feats/class/wizard/level-4/linked-focus.json
"prerequisites": { "value": [ { "value": "arcane bond" }, { "value": "curriculum spells" } ] }

// feats/class/wizard/level-12/clever-counterspell.json
"prerequisites": { "value": [ { "value": "Counterspell" }, { "value": "Quick Recognition" } ] }

// feats/class/wizard/level-1/spellbook-prodigy.json
"prerequisites": { "value": [ { "value": "trained in Arcana" } ] }

// feats/class/shared-class-feats/level-12/necromancers-visage.json
"prerequisites": { "value": [ { "value": "ability to create or control undead" },
                              { "value": "cleric with a negative font, oracle of bones, or necromancer wizard" } ] }

// feats/class/wizard/level-20/archwizards-might.json
"prerequisites": { "value": [ { "value": "Archwizard's Spellcraft" } ] }
```

Ou seja: `prerequisites.value` é um array de **objetos `{value: string}`**,
não de strings — quem tratar como `string[]` recebe `"[object Object]"`.

### 7.3 Fora do conjunto (1) e não mecanizáveis (10)

- **Fora, mas resolvível:** `Clever Counterspell → Quick Recognition` —
  `Quick Recognition` existe no vendor como **feat de perícia** (`category:
"skill"`, nível 7, `2rSyTfPgAmNAo01r`). Não está no conjunto do Wizard.
  Decisão sugerida: **atributo do nó**, não aresta, enquanto skill feats não
  entrarem no mapa.
- **Fora e não é documento:** `Linked Focus → "curriculum spells"` — propriedade
  da escola escolhida.
- **Não mecanizáveis (10 cláusulas, 6 feats):** 4 perícias
  (`trained in Arcana`, `expert in Crafting`, `expert in Deception`,
  `expert in Performance`) + 6 de ficção/build de outra classe
  (`ability to create or control undead`, `cleric with a negative font, oracle
of bones, or necromancer wizard`, nas três variantes). Vão como **texto
  exibido** (REQ-BC-034), nunca como predicado inventado.

---

## 8. Tabela de conjuração — as duas evidências

### Evidência 1 — journal do vendor

`tools/importer-pf2e/vendor/pf2e/packs/pf2e/journals/classes.json`,
entry `kzxu2dI7tFxv6Ix6` ("Classes"), page **`wDukeO3euLEGn6FA` ("Wizard")**,
tabela _Wizard Spells per Day_ (15.839 caracteres de HTML; extraída com
`scratchpad/j2.mjs`).

### Evidência 2 — fichas oficiais (pregen), independentes do journal

`packs/pf2e/iconics/ezren/ezren-level-{1,3,5}.json`, entry
`Arcane Prepared Spells`:

| Ficha   | slot0 (cantrips) | slot1 | slot2 | slot3 |
| ------- | ---------------: | ----: | ----: | ----: |
| nível 1 |                5 |     2 |     — |     — |
| nível 3 |                5 |     3 |     2 |     — |
| nível 5 |                5 |     3 |     3 |     2 |

Bate item a item com as linhas 1, 3 e 5 do journal.

### Evidência 3 (bônus, prosa do próprio vendor)

`class-features/wizard-spellcasting.json` (ORC, Player Core): _"you can prepare
up to **two 1st-rank spells and five cantrips** each morning ... as well as
**one extra curriculum cantrip and one extra curriculum spell of each rank** you
can cast from your arcane school"_.

### A tabela adotada (base, sem o extra da escola)

```
lvl   cant  1  2  3  4  5  6  7  8  9  10
 1     5    2  -  -  -  -  -  -  -  -   -
 2     5    3  -  -  -  -  -  -  -  -   -
 3     5    3  2  -  -  -  -  -  -  -   -
 4     5    3  3  -  -  -  -  -  -  -   -
 5     5    3  3  2  -  -  -  -  -  -   -
 6     5    3  3  3  -  -  -  -  -  -   -
 7     5    3  3  3  2  -  -  -  -  -   -
 8     5    3  3  3  3  -  -  -  -  -   -
 9     5    3  3  3  3  2  -  -  -  -   -
10     5    3  3  3  3  3  -  -  -  -   -
11     5    3  3  3  3  3  2  -  -  -   -
12     5    3  3  3  3  3  3  -  -  -   -
13     5    3  3  3  3  3  3  2  -  -   -
14     5    3  3  3  3  3  3  3  -  -   -
15     5    3  3  3  3  3  3  3  2  -   -
16     5    3  3  3  3  3  3  3  3  -   -
17     5    3  3  3  3  3  3  3  3  2   -
18     5    3  3  3  3  3  3  3  3  3   -
19     5    3  3  3  3  3  3  3  3  3   1*
20     5    3  3  3  3  3  3  3  3  3   1*
```

`*` = slot de 10º rank da class feature **Archwizard's Spellcraft** (o próprio
journal marca com asterisco). O schema aceita a chave `"10"`
(`SpellSlotsMapSchema` em `systems/pf2e/src/schema-primitives.ts:234-246`
declara `"0"`..`"10"`), então ele foi incluído — mas é um slot de natureza
diferente e a integração central deve tratá-lo como tal.

### Os três erros do plano §3.4, um a um

- **(a) "cantrips e slots sobem em pares"** — isso é a regra do **Magus**
  (conjurador parcial: ranks entram em pares e o rank inferior é descartado).
  O Wizard é **conjurador pleno**: cantrips ficam em 5 de 1 a 20 e **nenhum
  rank é descartado**. Confirmado no journal (linha 19 tem 3 slots em todos os
  ranks de 1 a 9) e nas fichas do Ezren (nível 5 mantém 1º e 2º rank em 3).
- **(b) "manter ranks que a progressão já descartou"** — não se aplica; o Wizard
  não descarta nada. O risco simétrico existe: **copiar o formato do Magus e
  descartar ranks por analogia** teria sido o erro.
- **(c) "confundir o slot extra da escola com os slots normais"** — o extra
  (+1 cantrip de currículo e +1 slot por rank conjurável, ambos restritos ao
  currículo da escola) **não** foi somado à tabela. Ele fica documentado em
  `notes` do config. Somá-lo daria 4/4/4… por rank, o que é errado, e ainda
  perderia a restrição de currículo.

---

## 9. O que será REUSADO dos packs atuais (regra R2)

### 9.1 `class-features-core` (48 docs) — 6 features reusadas

| Feature               | sourceId           | Também usada por  |
| --------------------- | ------------------ | ----------------- |
| Reflex Expertise      | `TUOeATt52P43r5W0` | Magus (mesmo doc) |
| Expert Spellcaster    | `cD3nSupdCvONuHiE` | Magus (mesmo doc) |
| Perception Expertise  | `JCqACxgrm5ixX0Jy` | Kineticist        |
| Weapon Expertise      | `9XLUh9iMepZesdmc` | Magus, Kineticist |
| Weapon Specialization | `9EqIasqfI8YIM3Pt` | Magus, Kineticist |
| Master Spellcaster    | `l1InYvhnQSz6Ucxc` | Magus (mesmo doc) |

Resposta direta à pergunta do briefing: **sim, Expert/Master Spellcaster são
exatamente os mesmos docs que vieram do Magus** — sourceId idêntico
(`cD3nSupdCvONuHiE` / `l1InYvhnQSz6Ucxc`). Não recriar.

### 9.2 `spells-core` (1.252 docs) — 26 focus spells reusadas, 0 a importar

Todas as **458** focus spells do vendor estão em `spells-core` (medido:
458/458). As 26 school spells do Wizard (13 _initial_ + 13 _advanced_):

| Escola                           | Initial (rank 1)                          | Advanced (rank 4)                                |
| -------------------------------- | ----------------------------------------- | ------------------------------------------------ |
| Red Mantis Magic School          | Debilitating Terror `AzTFMy9E9HQcLNRg`    | Shroud of the Mantis `VVigI4uNdWr1XZgG`          |
| School of Ars Grammatica         | Protective Wards `lY9fOk1qBDDhBT8s`       | Rune of Observation `4LSf04FFvDgMyDk6`           |
| School of Battle Magic           | Force Bolt `Hu38hoAUSYeFpkVa`             | Energy Absorption `LoBjvguamA12iyW0`             |
| School of Civic Wizardry         | Earthworks `ffz6wlSMzhaDpjg6`             | Community Restoration `6RNymgUvS87lmQOj`         |
| School of Gates                  | Friendly Push `cCFDnmFB1EGeQUeA`          | Rapid Retreat `6sNjsNPipZvQ3BGe`                 |
| School of Kalistrade             | Unexpected Windfall `KR8WgdazifDBjDkW`    | Capital Dividend `jXcsCpko8qNrWZ4x`              |
| School of Magical Technologies   | Augmented Body `pSepsfCrrAKuwA0N`         | Conjured Clockwork `eob29LrDMH2IoeAj`            |
| School of Mentalism              | Charming Push `KMFRKzNCq7hVNH7H`          | Invisibility Cloak `Nun72GTmb31YqSKh`            |
| School of Protean Form           | Scramble Body `XcMObj2p9nIBp53b`          | Shifting Form `SDkIFrrO1PsE02Kd`                 |
| School of Rooted Wisdom          | Halcyon Mists `IERHT6v4o5ISvuJG`          | Call the Ten `REBo9wSxDDx7Qdcc`                  |
| School of the Boundary           | Fortify Summoning `tWzxuJdbXqvskdIo`      | Spiral of Horrors `KPGGkyBFbKse7KpK`             |
| School of the Reclamation        | Grasping Vine `cQgPIohUja0DUiRL`          | Unsettling Knowledge `iAmHJbFN3lOoOkNG`          |
| School of Unified Magical Theory | Hand of the Apprentice `bSDTWUIvgXkBaEv8` | Interdisciplinary Incantation `sGenGMmE1ntkXCtN` |

**Runelord não tem school spells próprias** (usa as da School of Thassilonian
Rune Magic, que não é opção do eixo).

Currículo: **257** referências de magia nas descrições das 14 escolas;
**256 já estão em `spells-core`**. A única ausente é o ritual **Atone**
(`7Fd4lxozd11MQ55N`), citado no texto de anátema do Runelord.

### 9.3 `feats-core` (459 docs) — 3 feats reusados

Familiar `bcxIg7wi8ZAhvhOD`, Cantrip Expansion `A7ofsoPva0UtjqrX`,
Enhanced Familiar `N7dTFxpjXGn4ddq8`.

### 9.4 Resumo do delta a criar

| Família                      | Já nos packs | A criar |
| ---------------------------- | -----------: | ------: |
| class                        |            0 |       1 |
| class features (items{})     |            6 |       9 |
| opções de eixo (tese+escola) |            0 |      19 |
| class feats                  |            3 |      50 |
| focus spells                 |           26 |   **0** |

---

## 10. Armadilhas encontradas

1. **`prerequisites.value` é `Array<{value: string}>`, não `string[]`.**
   Tratar como string dá `"[object Object]"` e o resolvedor de arestas
   silenciosamente não casa nada.
2. **"Counterspell" não existe.** `Reflect Spell` e `Clever Counterspell`
   declaram `{"value":"Counterspell"}`, mas o doc do conjunto chama-se
   **`Counterspell (Prepared)`** (`EpBG4CFMNSZQx7vI`). Casar por nome
   normalizado **falha** — e existe ainda `Counterspell (Spontaneous)`
   (`deoHKUzpzT7iwWhL`, sorcerer) como homônimo parcial. Duas arestas reais se
   perdem sem uma normalização que remova o sufixo entre parênteses.
3. **Nível genérico mentiroso em 5 de 15 features** (§3). É o dado que o
   `grantedBy[]` do §4.2 do plano existe para consertar.
4. **10 feats "Mask" passariam como class feat do Wizard** por trait +
   `category: "class"`, apesar de estarem em `feats/archetype/wizard/` e
   carregarem trait `archetype` e traits de **duas** classes (`druid` +
   `wizard`). Excluídos explicitamente.
5. **32 dos 63 feats com trait `wizard` têm trait de 2+ classes.** O gate
   `class_level` derivado por trait é **ambíguo** para todos eles (§11).
6. **`wizard-elemental-school`** é um terceiro `otherTag` que _parece_ um eixo e
   não é (variante legada, 2 docs). E **School of Unified Magical Theory carrega
   duas tags** — dedupe por sourceId obrigatório.
7. **Runelord não é uma escola.** É arquétipo de classe raro: exige um feat de
   dedicação no nível 2, **substitui o arcane thesis**, obriga uma escola que
   não está no eixo (`School of Thassilonian Rune Magic`, `aYWPtW5T4Lx07Occ`,
   sem o tag), adiciona proficiência marcial via `MartialProficiency` e é a
   **única** fonte de referência a magia fora de `spells-core` (o ritual Atone).
8. **School of Rooted Wisdom tem escolha aninhada**: `ChoiceSet` de 5 ramos
   (Cascade Bearers, Emerald Boughs, Rain-Scribes, Tempest-Sun Mages, Uzunjati).
   Os 5 arquivos existem em `class-features/`, mas são 5 docs extras e um
   sub-slot — o caso REQ-BC-024.
9. **O journal chama a feature de nível 19 de "legendary archwizard"**; o nome
   canônico da uuid é **Legendary Spellcaster**. Mais uma prova de que prosa não
   é chave.
10. **Nenhum homônimo** dentro de `class-features/` do vendor (0 nomes
    repetidos em 827 arquivos) e **nenhuma colisão** nome × sourceId entre os
    53 feats novos e os 459 de `feats-core`. Este risco, medido, é zero aqui.

---

## 11. Preparação para o multiclasse (plano §4)

- **Gate derivado dos 53 class feats:** `class_level`, por serem
  `category: "class"` sem trait `archetype`.
- **Onde a derivação é AMBÍGUA:** nos **32** feats com trait de duas ou mais
  classes. Exemplos medidos:
  `Reach Spell` → `["bard","cleric","concentrate","druid","oracle","sorcerer","spellshape","witch","wizard"]` (7 classes);
  `Cantrip Expansion` → 8 classes;
  `Familiar` → `["magus","sorcerer","thaumaturge","wizard"]`;
  `Counterspell (Prepared)` → `["witch","wizard"]`;
  `Spellshape Mastery` → `["sorcerer","wizard"]`.
  Emitir um único `{"class_level": {"wizard": {">=": N}}}` seria **errado**:
  um Bard de nível 6 atende `Reach Spell` sem ter nível de Wizard. A forma
  correta é um `any` sobre **todas** as classes do trait:
  `{"any": [{"class_level":{"bard":{">=":1}}}, {"class_level":{"cleric":{">=":1}}}, …]}`.
  Note que traits como `concentrate`, `spellshape`, `manipulate`, `aura`,
  `detection`, `light`, `mythic` **não** são classes — a derivação precisa
  filtrar contra a lista real das 27 classes, não contra "qualquer trait".
- **Segundo caso ambíguo:** os 10 "Mask" têm `archetype` + `druid` + `wizard`.
  Pela regra do plano, `archetype` vence → `character_level`. Ficam fora desta
  rodada, mas quando entrarem, entram por essa porta.
- **`grantedBy[]`:** as 9 features compartilhadas do Wizard precisam da entrada
  `{"class":"wizard","level":N}` com o N da §3 — em especial as 5 cujo
  `system.level` mente.
- **`levelBasis: "class"`** declarado no config (`notes[0]`).

---

## 12. Decisões que tomei

| #   | Decisão                                                                                                            | Motivo                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `spellcasting.slots` carrega só a tabela **base**; o slot de currículo fica em `notes`                             | erro (c) do plano §3.4; o schema `ClassSpellcastingSchema` não tem campo para slot restrito, e inventar chave quebraria o loader       |
| 2   | Incluí `"10": 1` nos níveis 19-20                                                                                  | é a tabela do journal e `SpellSlotsMapSchema` aceita a chave `"10"`; omitir esconderia a feature                                       |
| 3   | Mantive `optionCount: 14` no eixo de escola, com Runelord/Rooted Wisdom sinalizados em `notes` em vez de removidos | o `choiceAxes[]` do §3.3 não tem campo de exclusão; inventá-lo quebraria o schema fechado. A decisão de cortar é da integração central |
| 4   | Os 10 "Mask" foram para `classFeats.excludeNames`                                                                  | o briefing manda não incluir feats de arquétipo, e o predicado do plano confirma (`archetype` vence)                                   |
| 5   | `Quick Recognition` ficou em `referencesOutsideSelection`, não em `internalChains`                                 | é feat de perícia (`category: "skill"`), fora do conjunto da classe                                                                    |
| 6   | `slotType` sugerido: `arcaneThesis` / `arcaneSchool`                                                               | o próprio schema diz "sugestão; o wiring central confirma"                                                                             |
| 7   | Não incluí os 5 ramos da Rooted Wisdom em `classFeatures.extraNames`                                               | são sub-opções de um eixo aninhado, não features do `items{}`; forçá-las como feature criaria concessão fantasma no nível 1            |

---

## 13. Perguntas em aberto (para a integração central)

1. **Slot de currículo**: modelar como uma segunda entrada de conjuração
   (restrita à lista da escola) ou como flag no slot normal? Hoje o
   `ClassSpellcastingSchema` não expressa nenhum dos dois.
2. **Runelord entra?** Recomendo **não** nesta rodada (arquétipo de classe,
   raro, arrasta `School of Thassilonian Rune Magic` + `Runelord Dedication` +
   o ritual Atone + regra de `MartialProficiency`).
3. **School of Rooted Wisdom entra?** Só se o eixo aninhado (REQ-BC-024) for
   suportado; senão são 5 docs órfãos e um slot que não abre.
4. **Escopo por rarity**: incluímos as 6 escolas _uncommon_? A r21 não define
   política de raridade; Magus/Kineticist trouxeram os eixos inteiros.
5. **Currículo por escola vira dado?** As listas de currículo (257 refs) hoje só
   existem como prosa com `@UUID`. Estruturá-las é o que permitiria o builder
   marcar quais magias o slot extra aceita — fora do escopo desta rodada, mas é
   a diferença entre "o Wizard funciona" e "o Wizard funciona certo".
6. **Normalização de nome para arestas**: aceitar o sufixo entre parênteses
   (`Counterspell (Prepared)` ↔ `Counterspell`) como match? Sem isso, 2 arestas
   reais somem; com isso, corre-se o risco de casar com
   `Counterspell (Spontaneous)`. Sugiro casar **dentro do conjunto da classe**
   primeiro, o que desambigua sozinho.
7. **`Archwizard's Might`** concede um segundo slot de 10º rank — precisa de
   suporte a slot condicionado a feat, hoje inexistente.

---

## 14. Conformidade

- Não editei nenhum arquivo compartilhado; escrevi exatamente dois arquivos.
- Não rodei o importer nem nenhum comando git.
- Nenhuma prosa de lore da Paizo foi transcrita (REQ-LEG-010): as citações são
  de **regra mecânica** e limitadas ao mínimo necessário para justificar um
  número. As tabelas contêm apenas dado numérico e identificadores.
- Nenhuma arte/ícone da Paizo referenciada (o `img` do vendor,
  `systems/pf2e/icons/classes/wizard.webp`, **não** entra — o pipeline já
  substitui por placeholder, como no doc do Magus).
