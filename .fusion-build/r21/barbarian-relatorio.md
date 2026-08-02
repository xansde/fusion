# Relatório de curadoria — Barbarian (r21)

Fonte primária: `tools/importer-pf2e/vendor/pf2e/packs/pf2e/`. Packs atuais do Fusion:
`systems/pf2e/packs/*/documents.json`. Todos os números abaixo saíram de comandos Node
(`node -e "..."` ou os scripts `.fusion-build/r21/barbarian-measure*.mjs`, também
entregues neste diretório para reprodução).

## Método (comandos rodados)

1. `node .fusion-build/r21/barbarian-measure.mjs` — lê `classes/barbarian.json`,
   deriva nome canônico (segmento final da uuid) e nível de cada entrada do `items{}`;
   varre as 27 classes de `classes/*.json` para contar compartilhamento; casa cada
   feature contra o arquivo em `class-features/` (recursivo, 842 arquivos) e reporta
   nível genérico vs. nível da classe; varre `class-features/` por
   `otherTags: ["barbarian-instinct"]`.
2. `node .fusion-build/r21/barbarian-measure2.mjs` — cruza cada feature/instinct/action
   por `sourceId` (= `_id` do arquivo vendor) contra `class-features-core`,
   `actions-core` e `feats-core` dos packs do Fusion; varre `feats/class/barbarian`
   (80 arquivos) e `feats/class/shared-class-feats` (147 arquivos, filtrado por
   `traits.value` conter `barbarian`) para prerequisites, distribuição por nível e
   reuso; varre `spells/focus` por trait `barbarian`.
3. `node .fusion-build/r21/barbarian-measure3.mjs` — reclassifica os prerequisites com
   normalização de texto (lowercase, sem acento) contra o conjunto
   {feats do Barbarian} ∪ {features do items{}} ∪ {nomes dos 9 instincts}, separando
   cadeia interna / não-mecanizável / referência externa.
4. Inspeção manual de arquivos individuais via `Read` para os casos de divergência e
   armadilhas (`instinct.json`, `rage.json`, `bloodrager.json`, `giant-instinct.json`,
   `greater-weapon-specialization*.json`).

Saída bruta: `.fusion-build/r21/barbarian-measure.out.txt` e
`.fusion-build/r21/barbarian-measure2.out.txt`.

## a) Doc da classe (`classes/barbarian.json`)

- `hp`: 12
- `keyAbility`: `["str"]` (única opção — Barbarian não tem escolha de atributo-chave)
- `perception` inicial: 2 (Expert)
- `savingThrows` iniciais: fortitude 2 (Expert), reflex 1 (Trained), will 2 (Expert)
- `attacks` iniciais: martial 1, simple 1, unarmed 1 (todos Trained), other 0
- `defenses` iniciais: light 1, medium 1 (Trained), heavy 0, unarmored 1 (Trained)
- `trainedSkills`: Athletics + 3 adicionais à escolha
- `classFeatLevels`: 1,2,4,6,8,10,12,14,16,18,20 (11 slots)
- `skillFeatLevels`: 2,4,6,8,10,12,14,16,18,20
- `skillIncreaseLevels`: 3,5,7,9,11,13,15,17,19
- `ancestryFeatLevels`: 1,5,9,13,17
- `generalFeatLevels`: 3,7,11,15,19
- `spellcasting`: 0 (não conjurador)
- `items{}`: 19 entradas (tabela completa abaixo)

Confirmação de regra dura #4 (nome canônico = segmento final da uuid, nunca
`entry.name`): nas 19 entradas do `items{}` do Barbarian, `entry.name` é **sempre
idêntico** ao segmento final da uuid — não há armadilha do tipo Magus/"Lightning
Reflexes"→"Reflex Expertise" neste arquivo específico. Verificado por comparação
programática (nenhum `[entry.name MISMATCH]` no output do script 1).

## Tabela completa do `items{}` (nome canônico, nível da classe)

| Nível | Feature (nome canônico)                   |
| ----- | ----------------------------------------- |
| 1     | Instinct                                  |
| 1     | Rage                                      |
| 1     | Quick-Tempered                            |
| 3     | Furious Footfalls                         |
| 5     | Brutality                                 |
| 7     | Juggernaut                                |
| 7     | Weapon Specialization                     |
| 9     | Reflex Expertise                          |
| 9     | Raging Resistance                         |
| 11    | Mighty Rage                               |
| 13    | Greater Juggernaut                        |
| 13    | Medium Armor Expertise                    |
| 13    | Weapon Mastery                            |
| 15    | Indomitable Will                          |
| 15    | Greater Weapon Specialization (Barbarian) |
| 17    | Perception Mastery                        |
| 17    | Revitalizing Rage                         |
| 19    | Devastator                                |
| 19    | Armor Mastery                             |

## b) Cada feature: compartilhamento, presença nos packs, proficiencies

Compartilhamento medido contra as **27 classes** do vendor (união de todos os
`classes/*.json`), casando por nome canônico:

| Feature                                   | Refs. totais (inclui Barbarian) | Outras classes                                                                                             |
| ----------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Instinct                                  | 1                               | — (exclusiva)                                                                                              |
| Rage                                      | 1                               | — (exclusiva)                                                                                              |
| Quick-Tempered                            | 1                               | — (exclusiva)                                                                                              |
| Furious Footfalls                         | 1                               | — (exclusiva)                                                                                              |
| Brutality                                 | 1                               | — (exclusiva)                                                                                              |
| Juggernaut                                | 2                               | magus@15                                                                                                   |
| Weapon Specialization                     | 25                              | 24 outras classes (quase universal)                                                                        |
| Reflex Expertise                          | 12                              | 11 outras (bard, champion, cleric, druid, guardian, inventor, magus, sorcerer, thaumaturge, witch, wizard) |
| Raging Resistance                         | 1                               | — (exclusiva)                                                                                              |
| Mighty Rage                               | 1                               | — (exclusiva)                                                                                              |
| Greater Juggernaut                        | 1                               | — (exclusiva)                                                                                              |
| Medium Armor Expertise                    | 7                               | alchemist, druid, gunslinger, magus, ranger, thaumaturge                                                   |
| Weapon Mastery                            | 5                               | commander, guardian, magus, thaumaturge                                                                    |
| Indomitable Will                          | 1                               | — (exclusiva)                                                                                              |
| Greater Weapon Specialization (Barbarian) | 1                               | — (exclusiva; ver colisão de nome abaixo)                                                                  |
| Perception Mastery                        | 10                              | bard, commander, exemplar, gunslinger, investigator, ranger, rogue, swashbuckler, thaumaturge              |
| Revitalizing Rage                         | 1                               | — (exclusiva)                                                                                              |
| Devastator                                | 1                               | — (exclusiva)                                                                                              |
| Armor Mastery                             | 4                               | champion, commander, fighter                                                                               |

**Já reusável de `class-features-core` (cruzado por `sourceId` = `_id` do vendor,
não por nome)**: Juggernaut, Weapon Specialization, Reflex Expertise, Medium Armor
Expertise, Weapon Mastery — **5 de 19**. Confirmado programaticamente (`inPacksBySourceId=YES`).

Atenção: `class-features-core` já tem um doc chamado **"Greater Weapon
Specialization"** (genérico, `sourceId Z7HX6TeFsaup7Dx9`, traits inclui champion/
fighter/monk/etc., **sem barbarian**), mas o Barbarian usa um doc **diferente**,
**"Greater Weapon Specialization (Barbarian)"** (`sourceId 7JjhxMFo8DMwpGx0`, trait
`barbarian`). São documentos distintos — não reusar o genérico, importar o
específico do Barbarian com o sufixo preservado no nome.

**Faltam nos packs (14 de 19)**: Instinct, Rage (class-feature), Quick-Tempered,
Furious Footfalls, Brutality, Raging Resistance, Mighty Rage, Greater Juggernaut,
Indomitable Will, Greater Weapon Specialization (Barbarian), Perception Mastery,
Revitalizing Rage, Devastator, Armor Mastery. (Perception Mastery e Armor Mastery
são compartilhadas com outras classes mas **ainda não foram importadas por
nenhuma** — confirmado, `inPacksBySourceId=no` para ambas.)

### Divergência genérico × nível da classe (regra dura #5)

4 das 19 features têm `system.level.value` do arquivo genérico **diferente** do
nível no `items{}` do Barbarian — o genérico mente, o nível correto é o do `items{}`:

| Feature                | Nível genérico do arquivo | Nível real na classe Barbarian |
| ---------------------- | ------------------------- | ------------------------------ |
| Reflex Expertise       | 3                         | **9**                          |
| Medium Armor Expertise | 11                        | **13**                         |
| Perception Mastery     | 7                         | **17**                         |
| Armor Mastery          | 13                        | **19**                         |

Essas 4 features também são compartilhadas com outras classes — cada classe que as
concede tem seu próprio nível (ex.: Reflex Expertise é nível 3 no arquivo genérico
mas nível 5 no Druid, 5 no Magus, 9 no Sorcerer, 9 no Witch, 9 no Barbarian — o
`grantedBy[]` da §4.2 do plano precisa capturar isso por classe).

### `subfeatures.proficiencies` — tabela de origem

| Feature                | proficiencies (bruto do vendor)                                   |
| ---------------------- | ----------------------------------------------------------------- |
| Brutality              | `{"martial":{"rank":2},"simple":{"rank":2},"unarmed":{"rank":2}}` |
| Juggernaut             | `{"fortitude":{"rank":3}}`                                        |
| Reflex Expertise       | `{"reflex":{"rank":2}}`                                           |
| Mighty Rage            | `{"barbarian":{"attribute":null,"rank":2}}`                       |
| Greater Juggernaut     | `{"fortitude":{"rank":4}}`                                        |
| Medium Armor Expertise | `{"light":{"rank":2},"medium":{"rank":2},"unarmored":{"rank":2}}` |
| Weapon Mastery         | `{"martial":{"rank":3},"simple":{"rank":3},"unarmed":{"rank":3}}` |
| Indomitable Will       | `{"will":{"rank":3}}`                                             |
| Perception Mastery     | `{"perception":{"rank":3}}`                                       |
| Devastator             | `{"barbarian":{"attribute":null,"rank":3}}`                       |
| Armor Mastery          | `{"light":{"rank":3},"medium":{"rank":3},"unarmored":{"rank":3}}` |

As demais 8 features do `items{}` (Instinct, Rage, Quick-Tempered, Furious
Footfalls, Raging Resistance, Greater Weapon Specialization (Barbarian),
Revitalizing Rage) não têm `subfeatures.proficiencies` (não bumpam proficiência —
concedem ação, resistência ou dano condicional).

**Achado notável**: a chave usada para a Class DC do Barbarian em
`subfeatures.proficiencies` é **`"barbarian"`** (o slug da classe), não `"class"`
genérico — confirmado em Mighty Rage e Devastator. A derivação genérica de
`proficiencyUpgrades` precisa mapear `subfeatures.proficiencies["<slug-da-classe>"]`
→ Class DC, não uma chave fixa `"class"`.

## c) Eixo de sub-escolha: `barbarian-instinct`

- `otherTag`: `barbarian-instinct`
- Feature no `items{}` que representa a escolha: **Instinct**, nível **1**
- Mecânica no vendor (`class-features/instinct.json`): `rules[]` tem um
  `ChoiceSet` com `choices.filter: ["item:tag:barbarian-instinct"]` (a lista de
  opções é dinâmica, filtrada pela tag — **não hardcoded no arquivo**), seguido de
  um `GrantItem` com `uuid: "{item|flags.system.rulesSelections.instinct}"` (concede
  o item escolhido). Confirma o design do plano (eixo genérico via `otherTags`).
- Arquivos com `otherTags` contendo `barbarian-instinct`: **10** encontrados por
  varredura de `class-features/` inteiro. **9 são instincts "puros"** (Animal,
  Decay, Dragon, Elemental, Fury, Giant, Ligneous, Spirit, Superstition Instinct);
  o 10º é **"Bloodrager"**, que tem `otherTags: ["barbarian-instinct",
"class-archetype"]` — **excluído** da curadoria (ver seção de armadilhas).
- **`optionCount` real desta rodada: 9** (não 10, como o plano assumia antes da
  medição — a divergência é o próprio "cuidado com redundância" que o usuário pediu:
  incluir Bloodrager sem o arquétipo Bloodrager Dedication geraria um doc quebrado).

Cada instinct **não** tem `subfeatures.proficiencies` — o que ele concede é sempre
via `rules[]` estruturado: um `ChoiceSet` de elemento de resistência (quando
aplicável), `Resistance` condicionada a `feature:raging-resistance` +
`self:effect:rage`, e o dano de fúria via `AdjustModifier` com `selector:
"strike-damage"`, `slug: "rage"` e `predicate` (ex.: `class:barbarian` +
`{"gte":["self:level",7]}`). **Confirma a nota da spec do wayfinder (doc 16)**: o
dano condicional de instinct **é número de ficha derivado de regra estruturada**,
não texto solto — o vendor já guarda isso em `rules[]` no formato
`AdjustModifier`/`Resistance`, pronto para o motor de regras do Fusion consumir sem
parsing de prosa. Exemplo (Giant Instinct, dano ao usar arma oversized):

```jsonc
{
  "key": "AdjustModifier",
  "mode": "upgrade",
  "selector": "strike-damage",
  "slug": "rage",
  "predicate": [{ "or": ["class:barbarian", "feat:instinct-ability"] }, "item:oversized"],
  "value": 6,
}
```

**Anathema**: não existe um campo estruturado `anathema` em nenhum dos 10 arquivos
de instinct — a restrição de comportamento é só texto em `description.value` (4 dos
10 instincts mencionam a palavra "anathema" na prosa: Superstition, Decay,
Elemental, Ligneous). Não há mecânica a modelar aqui além do texto — e, por
REQ-LEG-010, esse texto **não foi copiado** para a curadoria (nem deveria ser
transcrito no pack; a integração central decide se referencia ou paráfrasea).

### Checklist pedido explicitamente

| Nome                                                     | Achado                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rage                                                     | Class-feature nível 1, `items{}`. Concede a ação "Rage" (doc `type: action`, `actions/class/barbarian/rage.json`, `sourceId Ah5g9pDwWF9b9VW9`) via `GrantItem`. **Ação já está em `actions-core`** (reusar).                                                                                                                                                                                                                                                                         |
| Deny Advantage                                           | **Não é do Barbarian.** `class-features/deny-advantage.json` tem `traits.value: ["rogue"]`. Citação do plano parece equivocada/genérica — confirmado por leitura direta do arquivo; não entra na curadoria do Barbarian.                                                                                                                                                                                                                                                             |
| Brutality                                                | Class-feature nível 5, `items{}`, upgrade de proficiência em armas martial/simple/unarmed p/ Expert.                                                                                                                                                                                                                                                                                                                                                                                 |
| Juggernaut                                               | Class-feature nível 7, `items{}`, compartilhada com Magus (nível 15 lá), upgrade Fortitude p/ Master. **Já em `class-features-core`.**                                                                                                                                                                                                                                                                                                                                               |
| Weapon Fury                                              | **Não encontrado** no vendor atual (0 hits em `feats/class/barbarian`, `class-features/`, nem em nenhum outro pack via grep). Provável nome de edição anterior ao remaster; sem ação necessária.                                                                                                                                                                                                                                                                                     |
| Greater Juggernaut                                       | Class-feature nível 13, `items{}`, exclusiva do Barbarian, Fortitude p/ Legendary.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Indomitable Will                                         | Class-feature nível 15, `items{}`, exclusiva, Will p/ Master.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Armor of Fury                                            | **Não está no `items{}` do Barbarian.** Existe um arquivo `class-features/armor-of-fury.json` (trait `barbarian`, nível genérico 19) mas ele **não é referenciado** pelo `classes/barbarian.json` atual — só aparece em fichas de iconics/pregens antigas (Amiri). O nome real usado hoje pelo `items{}` no nível 19 é **"Armor Mastery"**. Interpretado como nome legado/pré-remaster de "Armor Mastery" — não entra na curadoria (a feature real, Armor Mastery, já está listada). |
| Devastator                                               | Class-feature nível 19, `items{}`, exclusiva, upgrade Class DC p/ Master.                                                                                                                                                                                                                                                                                                                                                                                                            |
| Mighty Rage                                              | Class-feature nível 11, `items{}`, exclusiva, upgrade Class DC p/ Expert.                                                                                                                                                                                                                                                                                                                                                                                                            |
| Quick Rage                                               | **Não encontrado** no vendor atual (mesma situação de "Weapon Fury" — grep vazio em todo `packs/pf2e`). O item nível-1 real chamado "Quick-Tempered" (ação que permite entrar em fúria como ação livre em certas condições) provavelmente é o equivalente atual; sem nome "Quick Rage" no vendor, não há doc a importar sob esse nome.                                                                                                                                               |
| Draconic/Animal/Giant/Spirit/Fury/Superstition instincts | Confirmados entre os 9 instincts válidos (mais Decay, Elemental, Ligneous — total 9, ver tabela do eixo). "Draconic" no vendor chama-se **"Dragon Instinct"**.                                                                                                                                                                                                                                                                                                                       |

## d) Class feats

- `feats/class/barbarian/`: **80 arquivos**, todos `system.category: "class"`,
  todos com `traits.value` incluindo `barbarian` (nenhum tem trait `archetype`).
- Distribuição por nível:

| Nível | Qtd. |
| ----- | ---- |
| 1     | 6    |
| 2     | 7    |
| 4     | 7    |
| 6     | 11   |
| 8     | 11   |
| 10    | 10   |
| 12    | 8    |
| 14    | 6    |
| 16    | 6    |
| 18    | 4    |
| 20    | 4    |

- `feats/class/shared-class-feats/` filtrado por `traits.value` conter
  `barbarian`: **16 arquivos** (Sudden Charge L1, Intimidating Strike L2, Barreling
  Charge/Brutal Crush/Creature Comforts/Farabellus Flip/Inured to Alchemy/Rip and
  Tear/Swipe L4, Pain Tolerance/Reactive Strike/Sudden Leap L6, Corpse-Killer's
  Defiance/Overpowering Charge L10, Towering Transformation/Whirlwind Strike L14).
- **Já em `feats-core` (por `sourceId`)**: **1** — "Reactive Strike" (compartilhada
  com champion/commander/exemplar/guardian/magus/swashbuckler, já importada por
  outra classe anterior). Os outros 79 do Barbarian + 15 shared restantes = **95
  ainda não estão em `feats-core`**.
- Nenhum feat de arquétipo (`Bloodrager Dedication` etc.) incluído — fora de
  escopo desta rodada.

## e) Pré-requisitos

Medido sobre os 96 docs (80 exclusivos + 16 shared): **47 têm algum texto em
`prerequisites.value`**.

- **Cadeias internas** (prereq resolve, por nome normalizado, para outro feat/
  feature/instinct do próprio conjunto do Barbarian): **30 casos**. Exemplos reais:
  - Feat→Feat: `Great Cleave` (L10) exige `"Cleave"` (outro class feat do Barbarian).
  - Feat→Instinct: `Draconic Arrogance` (L1) exige `"dragon instinct"`;
    `Dragon's Rage Wings` (L12) exige `"dragon instinct"`; `Predator's Pounce`
    (L12) exige `"animal instinct"`; `Spirit's Wrath` (L12) exige `"spirit
instinct"`; `Sunder Spell` (L12) exige `"superstition instinct"`.

Forma exata do JSON de `prerequisites.value` (5 exemplos, do vendor):

```jsonc
// Great Cleave (feats/class/barbarian/level-10/great-cleave.json), sourceId cznEQ1W61MSaXW0u
"prerequisites": { "value": [ { "value": "Cleave" } ] }

// Draconic Arrogance, sourceId EOmTf95t03y4IGdp
"prerequisites": { "value": [ { "value": "dragon instinct" } ] }

// Raging Athlete (L4) — não-mecanizável (perícia)
"prerequisites": { "value": [ { "value": "expert in Athletics" } ] }

// Supernatural Senses (L4) — não-mecanizável (sentido, com "ou")
"prerequisites": { "value": [ { "value": "Acute Scent or scent" } ] }

// Brutal Crush (shared-class-feats, L4) — referência externa (Druid)
"prerequisites": { "value": [ { "value": "animal instinct or untamed order" } ] }
```

- **Não-mecanizáveis** (texto de perícia/sentido treinado, sem nome próprio
  resolvível): **13 casos** — ex.: `trained in Athletics` (Bashing Charge),
  `expert in Athletics` (Raging Athlete, Brutal Bully), `master in Athletics`
  (Furious Bully), `trained in Medicine or Tian Xia Lore` (Meditate on This!),
  `Acute Scent or scent` (Supernatural Senses, Instinctive Strike), `low-light
vision or scent` (Nocturnal Senses). Ficam como atributo textual do nó, nunca
  viram aresta.
- **Referências para fora do conjunto do Barbarian**: **3 casos**, todos o mesmo
  padrão `"animal instinct or untamed order"` (Brutal Crush, Creature Comforts,
  Rip and Tear — todos `shared-class-feats`, compartilhados também com Druid;
  "Untamed Order" é conceito de Druid, fora do escopo desta rodada). Reportado
  como referência externa, não resolvido como aresta.

## f) Preparação para multiclasse (§4 do plano)

- Todos os 80 class feats exclusivos do Barbarian têm `category: "class"` e
  `traits.value` contendo só `barbarian` (mais traits mecânicos como `rage`,
  `flourish`, `press` — nenhum outro trait de classe). Para estes, o gate
  `class_level.barbarian >= N` é **não-ambíguo**.
- **Ambiguidade confirmada nos 16 `shared-class-feats`**: **todos** têm 2 ou mais
  traits de classe simultâneos, ex.:
  - `Sudden Charge` (L1): traits `barbarian`, `fighter`
  - `Reactive Strike` (L6): traits `barbarian`, `champion`, `commander`,
    `exemplar`, `guardian`, `magus`, `swashbuckler` (7 classes!)
  - `Inured to Alchemy` (L4): traits `alchemist`, `barbarian`, `fighter`
  - `Farabellus Flip` (L4): traits `barbarian`, `fighter`, `ranger`
  - `Towering Transformation`, `Brutal Crush`, `Creature Comforts`, `Rip and Tear`
    (todos L4/L14): traits `barbarian`, `druid`

  Para estes, `system.requires` **não pode** ser derivado de um único
  `class_level` — o mesmo feat é obtido em níveis potencialmente diferentes por
  cada classe que o compartilha, e a regra §4.1 do plano (`trait de classe X +
category:class` → `class_level.X`) não diz qual `X` escolher quando há vários.
  Nenhum desses 16 docs tem trait `archetype`, então a regra de desempate
  "archetype vence" não se aplica aqui — é uma ambiguidade **classe×classe**, não
  coberta pela tabela do plano. **Decisão proposta** (não implementada por mim,
  fora do escopo do agente): a integração central precisa derivar `class_level`
  **por classe concedente**, olhando o `items{}`/lista de feats de CADA classe
  curada que referencia o mesmo feat — ou seja, `grantedBy: [{class, level}, ...]`
  (§4.2) também deveria valer para class feats compartilhados, não só features.
  Sem essa extensão, `Reactive Strike` receberia um `class_level` arbitrário e
  errado para 6 das 7 classes que o concedem.

- Nenhum feat do Barbarian tem trait `archetype` — não há caso do tipo "archetype
  vence trait de classe" dentro do conjunto próprio da classe.
- A única ambiguidade dentro do **próprio** eixo de escolha é o caso Bloodrager
  (arquétipo disfarçado de instinct) — já resolvida por exclusão nesta rodada (ver
  seção de armadilhas).

## g) Focus spells

Nenhuma. `classDoc.system.spellcasting = 0` e a varredura de `spells/focus/*.json`
por `traits.value` contendo `barbarian` retornou **0 arquivos**. Confirma a
descrição do plano (Barbarian não é conjurador).

## Riscos e armadilhas concretas

1. **Bloodrager como instinct fantasma**: se alguém filtrar ingenuamente por
   `otherTags: barbarian-instinct` sem checar `class-archetype`, o eixo ganha uma
   10ª opção que concede (via `GrantItem` condicionado a nível 2) um feat de
   arquétipo (`Bloodrager Dedication`) que este round não importa — a ficha
   quebraria ao tentar resolver a uuid. **Mitigado**: excluído explicitamente no
   `dedupe.collisionsDetected` e nas `notes` da curadoria.
2. **Colisão de nome "Greater Weapon Specialization"**: dois docs distintos no
   vendor (genérico já em `class-features-core`, e a versão `(Barbarian)` que
   ainda falta). Um join por nome normalizado sem o sufixo juntaria os dois.
3. **Colisão de nome "Rage" e "Quick-Tempered"**: cada um existe como **dois tipos
   de doc diferentes** (class-feature que concede + action que é a atividade em
   si), com `sourceId` diferentes. Um merge por nome sem checar `type` conflataria
   o class-feature "Rage" (nível 1, `items{}`) com a action "Rage" (já em
   `actions-core`).
4. **Divergência de nível genérico × nível da classe** em 4 features
   compartilhadas (Reflex Expertise, Medium Armor Expertise, Perception Mastery,
   Armor Mastery) — exatamente a armadilha citada na regra dura #5. Se a
   integração central ler `system.level.value` do arquivo em vez do `items{}` da
   classe, o Barbarian ganha essas features 2 a 10 níveis cedo demais.
5. **Chave de Class DC não-genérica** (`"barbarian"` em vez de `"class"` dentro de
   `subfeatures.proficiencies`) — a derivação genérica de `proficiencyUpgrades`
   (regra dura do plano, §"R3") precisa tratar essa chave como "o slug da própria
   classe", não assumir um literal fixo.
6. **16 feats compartilhados sem gate multiclasse não-ambíguo** — ver seção f).
   Bloqueante para a spec 30 rodar corretamente sobre esses feats especificamente
   se a derivação de `class_level` não for estendida para multi-classe por doc.
7. **"Deny Advantage", "Weapon Fury", "Armor of Fury", "Quick Rage"** citados no
   prompt da task não correspondem 1:1 a nomes do vendor atual — Deny Advantage é
   de Rogue (não Barbarian); os outros três não existem no vendor sob esse nome
   exato (prováveis nomes de edição pré-remaster). Nenhum é referenciado pelo
   `classes/barbarian.json`. Documentado para não gerar confusão numa auditoria
   futura — não é uma lacuna de dado, é ausência real confirmada por grep.

## O que será REUSADO dos packs atuais (não recriar)

- **Class-features** (5): Juggernaut, Weapon Specialization, Reflex Expertise,
  Medium Armor Expertise, Weapon Mastery — já em `class-features-core`, casados
  por `sourceId`.
- **Actions** (2): Rage, Quick-Tempered — já em `actions-core`, casados por
  `sourceId` (`Ah5g9pDwWF9b9VW9` e `a9PzINjFTO5GvAJN`).
- **Class feat** (1): Reactive Strike — já em `feats-core`, casado por `sourceId`.

Total reusado: **8 documentos**. Total a criar nesta rodada (pela integração
central, não por mim): 14 class-features exclusivas/faltantes + 9 instincts + 79
class feats exclusivos + 15 shared class feats faltantes = **117 documentos
novos**, todos disjuntos do que já existe (nenhuma colisão de `sourceId`
detectada).

## Perguntas em aberto para a integração central

1. `grantedBy[]` (§4.2) deveria cobrir também class feats compartilhados
   (`Reactive Strike` e os outros 15), não só class-features — sem isso o gate
   multiclasse desses 16 feats fica ambíguo (ver seção f).
2. A chave de Class DC em `subfeatures.proficiencies` usa o **slug da classe**
   (`"barbarian"`), não um literal `"class"` — confirmar que o derivador genérico
   de `proficiencyUpgrades` já assume isso ou precisa de ajuste.
3. Confirmar decisão editorial: instinct "Bloodrager" fica fora até o round de
   arquétipos, ou deve virar uma 10ª opção com o feat "Bloodrager Dedication"
   importado junto (fora do escopo que me foi dado)?
