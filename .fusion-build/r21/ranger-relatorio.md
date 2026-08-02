# r21 — Curadoria da classe Ranger — relatório

Arquivo de configuração: `tools/importer-pf2e/src/curation/classes/ranger.json`.
Vendor lido (read-only): `tools/importer-pf2e/vendor/pf2e/packs/pf2e/`.
Packs atuais lidos (read-only): `systems/pf2e/packs/{classes-core,class-features-core,feats-core,spells-core}/documents.json`.

## 1. Método (comandos rodados)

Todas as contagens abaixo saíram de scripts `node -e` executados nesta sessão
(sem editar nenhum arquivo compartilhado, sem rodar o importer, sem `git`).
Os comandos relevantes, na ordem:

1. Leitura de `classes/ranger.json` → `system.hp/keyAbility/perception/savingThrows/
   attacks/defenses/skillIncreaseLevels/trainedSkills` e `Object.keys(d.system)`
   (revelou `ancestryFeatLevels/classFeatLevels/generalFeatLevels/skillFeatLevels`,
   que não aparecem no `d.system` de forma "achatada" no primeiro dump).
2. Dump completo de `system.items{}` (20 entradas) com nome, uuid, nível.
3. `node -e` percorrendo `systems/pf2e/packs/classes-core/documents.json` — Ranger
   **não** está lá (só Magus e Kineticist), confirmando que é ampliação nova.
4. `node -e` percorrendo `systems/pf2e/packs/class-features-core/documents.json`
   (48 docs) e cruzando `flags.fusion.sourceId` contra os `_id` dos 20 arquivos
   de `class-features/*.json` referenciados pelo Ranger.
5. `node -e` percorrendo **as 27 classes** em `classes/*.json`, extraindo o nome
   canônico (segmento final da uuid) de cada `items{}` para medir quantas classes
   referenciam cada feature do Ranger (compartilhamento).
6. `node -e` percorrendo `feats/class/ranger/**/*.json` (78 arquivos) e
   `feats/class/shared-class-feats/**/*.json` (113 arquivos, filtrando por
   `traits.value.includes('ranger')` → 25) para contar class feats, distribuição
   por nível, categoria e prerequisites.
7. Cruzamento dos 103 feats (78+25) contra `feats-core/documents.json`
   (459 docs) por `_id` — **0 já presentes**.
8. Normalização de nomes (lowercase, remove sufixo `(...)`) para resolver
   prerequisitos textuais contra o próprio conjunto de 103 feats e contra os 20
   nomes canônicos de class-features — 31 cadeias internas resolvidas.
9. Dump de `spells/focus/*.json` filtrando `traits.value.includes('ranger')` → 22
   magias, cruzadas por `_id` contra `spells-core/documents.json` (1.252 docs) —
   **22/22 já presentes**.
10. Dump de `class-features/*.json` filtrando `system.traits.otherTags.includes
    ('ranger-hunters-edge')` → 4 arquivos (Flurry, Outwit, Precision, Vindicator).
11. Verificação de que "Vindicator" não aparece em nenhum `items{}` das 27
    classes e não tem `masterful-hunter-vindicator.json` correspondente (só
    existem `-flurry`, `-outwit`, `-precision`) — confirma que é conteúdo do
    arquétipo Vindicator (`feats/archetype/vindicator/`), fora de escopo.

## 2. O doc da classe (medido)

| Campo | Valor |
| --- | --- |
| hp | 10 |
| keyAbility | dex, str |
| perception | 2 (expert) |
| saves | fort 2, reflex 2, will 1 (expert/expert/trained) |
| attacks | unarmed 1, simple 1, martial 1, advanced 0 |
| defenses | unarmored 1, light 1, medium 1, heavy 0 |
| trainedSkills | survival + 4 adicionais |
| skillIncreaseLevels | 3,5,7,9,11,13,15,17,19 |
| classFeatLevels | 1,2,4,6,8,10,12,14,16,18,20 (11 níveis) |
| skillFeatLevels | 2,4,6,8,10,12,14,16,18,20 (10 níveis) |
| generalFeatLevels | 3,7,11,15,19 (5 níveis) |
| ancestryFeatLevels | 1,5,9,13,17 (5 níveis) |
| spellcasting | `0` (sem spellcasting nativo na progressão) |
| vendor sourceId | `Yix76sfxrIlltSTJ` |
| publicação | ORC, Pathfinder Player Core (remaster) |

## 3. `items{}` da classe — 20 features (nome canônico da uuid + nível)

| Nível | Nome canônico (uuid tail) | entry.name divergente? |
| --- | --- | --- |
| 1 | Hunt Prey | não |
| 1 | Hunter's Edge | não |
| 3 | Will Expertise | não |
| 5 | Ranger Weapon Expertise | não |
| 5 | Trackless Journey | não |
| 7 | Weapon Specialization | não |
| 7 | Natural Reflexes | não |
| 7 | Perception Mastery | não |
| 9 | Nature's Edge | não |
| 9 | Ranger Expertise | não |
| 11 | Medium Armor Expertise | não |
| 11 | Unimpeded Journey | não |
| 11 | Warden's Endurance | não |
| 13 | **Martial Weapon Mastery** | **sim — entry.name diz "Weapon Mastery"** |
| 15 | Greater Weapon Specialization | não |
| 15 | Greater Natural Reflexes | não |
| 15 | Perception Legend | não |
| 17 | Masterful Hunter | não |
| 19 | Medium Armor Mastery | não |
| 19 | Swift Prey | não |

## 4. Armadilhas confirmadas (medidas, não supostas)

### 4.1 A armadilha do `entry.name` (regra 4), reproduzida no Ranger

No `items{}` do Ranger, a entrada de nível 13 (`nvyh4`) tem `entry.name:
"Weapon Mastery"` mas `uuid: "Compendium.pf2e.classfeatures.Item.Martial Weapon
Mastery"`. Nosso pack `class-features-core` **já tem** um documento chamado
"Weapon Mastery" (`sourceId ejP4jVQkS48uKRFz`, traits
`barbarian/commander/guardian/magus/thaumaturge`, nível 13) — mas é um
documento **diferente**: `martial-weapon-mastery.json`
(`_id i6563IU7x4L9oRgC`, traits `champion/investigator/ranger/swashbuckler`,
nível 13). Casar por `entry.name` teria reusado o doc errado, fundindo dois
efeitos mecânicos distintos. A curadoria resolve pelo nome canônico: o Ranger
precisa de **"Martial Weapon Mastery"** (não está em `alreadyInPacks`, entra em
`missingFromPacks`).

### 4.2 Divergência de nível — items{} da classe vs. arquivo genérico (regra 5)

Duas features do Ranger divergem entre o nível declarado no arquivo genérico de
`class-features/` e o nível real que o Ranger concede no `items{}`:

| Feature | Nível no arquivo genérico | Nível no `items{}` do Ranger | Fonte |
| --- | --- | --- | --- |
| Perception Legend | 13 (`class-features/perception-legend.json`) | **15** | `classes/ranger.json`, entrada `epJL1` |
| Medium Armor Mastery | 17 (`class-features/medium-armor-mastery.json`) | **19** | `classes/ranger.json`, entrada `PlY2u` |

Confirmação cruzada (medida, não suposição): varrendo as 27 classes por essas
duas features, o nível realmente varia por classe — Perception Legend é 13 em
Rogue, 15 em Ranger, 19 em Gunslinger; Medium Armor Mastery é 17 em Magus, 19 em
Ranger/Alchemist/Gunslinger/Inventor/Thaumaturge. Isso não é erro de leitura, é
a regra 5 do enunciado se materializando: **o nível é sempre o do `items{}` da
classe**, nunca o do arquivo genérico. `Medium Armor Mastery` já está reusado
dos packs atuais (via Magus, nível 17) — o `grantedBy` (§4.2 do plano) da
integração central precisa registrar `{class: "ranger", level: 19}` **sem**
alterar o nível 17 já gravado para Magus no mesmo doc.

### 4.3 Hunter's Edge: o eixo medido tem 4 documentos, mas só 3 são nativos do Ranger base

O plano cita "4 opções" para `ranger-hunters-edge`, e a contagem bate — mas a
medição revela que uma das 4 (**Vindicator**) não é opção nativa da classe
base:

- `vindicator.json` tem `otherTags: ["class-archetype", "ranger-hunters-edge"]`
  — a tag `class-archetype` não aparece nas outras 3.
- Nenhum dos 27 arquivos `classes/*.json` referencia "Vindicator" no seu
  `items{}` (varredura completa, zero ocorrências).
- Existem `masterful-hunter-flurry.json`, `masterful-hunter-outwit.json` e
  `masterful-hunter-precision.json` (upgrade de nível 17 por edge escolhido),
  mas **não existe** `masterful-hunter-vindicator.json`.
- `feats/archetype/vindicator/vindicator-dedication.json` existe — Vindicator é
  o arquétipo homônimo, que concede esse Hunter's Edge por dedicação. Fora de
  escopo desta rodada (o plano exclui arquétipos de multiclasse, seção 1).

**Decisão**: `choiceAxes[0].optionCount = 3` (Flurry, Outwit, Precision) na
configuração, com nota explicando o 4º documento e por que ele fica de fora.

## 5. Features compartilhadas com outras classes (medido, varredura das 27 classes)

| Feature | Nível no Ranger | Outras classes que também concedem (nível delas) |
| --- | --- | --- |
| Martial Weapon Mastery | 13 | Champion (13), Investigator (13), Swashbuckler (13) |
| Perception Legend | 15 | Gunslinger (19), Investigator\* (13, como "Incredible Senses"), Rogue (13) |
| Perception Mastery | 7 | Barbarian (17), Bard (11), Commander (13), Exemplar (17), Gunslinger (7), Investigator\* (7, como "Vigilant Senses"), Rogue (7), Swashbuckler\* (11, como "Vigilant Senses"), Thaumaturge (9) |
| Will Expertise | 3 | Alchemist (7), Kineticist (3) |
| Medium Armor Expertise | 11 | Alchemist (13), Barbarian (13), Druid (13), Gunslinger (13), Magus (11), Thaumaturge (11) |
| Medium Armor Mastery | 19 | Alchemist (19), Gunslinger (19), Inventor (19), Magus (17), Thaumaturge (19) |
| Weapon Specialization | 7 | 24 outras classes (7 a 13, varia) |
| Greater Weapon Specialization | 15 | 12 outras classes |

\* Investigator e Swashbuckler são outro exemplo da armadilha do `entry.name`
("Incredible Senses"/"Vigilant Senses" apontam para as uuids "Perception
Legend"/"Perception Mastery") — achado colateral, não afeta a curadoria do
Ranger, mas vale registrar porque a mesma armadilha vai aparecer na
curadoria do Investigator/Rogue/Swashbuckler.

As demais 12 features do `items{}` (Hunt Prey, Hunter's Edge, Nature's Edge,
Trackless Journey, Unimpeded Journey, Warden's Endurance, Natural Reflexes,
Greater Natural Reflexes, Swift Prey, Masterful Hunter, Ranger Expertise,
Ranger Weapon Expertise) são **exclusivas do Ranger** (zero outras classes as
referenciam no `items{}`).

## 6. Reuso dos packs atuais (regra 2 e 6 — prioridade ao que já existe)

**5 de 20 features já estão em `class-features-core`** e serão reusadas por
`sourceId` (não recriadas):

- Medium Armor Expertise (`FCEp9jjxxgRJDJV3`)
- Medium Armor Mastery (`cGMSYAErbUG5E8X2`)
- Weapon Specialization (`9EqIasqfI8YIM3Pt`)
- Greater Weapon Specialization (`Z7HX6TeFsaup7Dx9`)
- Will Expertise (`NhcF2CbXA8R1UCg4`)

**22 de 22 focus spells de trait `ranger` já estão em `spells-core`**
(casadas 1:1 por `sourceId`, r12) — nenhuma magia nova a importar: Animal
Feature, Canopy Crawler, Distracting Decoy, Enlarge Companion, Ephemeral
Tracking, Gluttonous Growth, Gravity Weapon, Heal Companion, Hunter's Luck,
Hunter's Vision, Imitate Fauna, Keen Smell, Magic Hide, Pack Breaker,
Pulverizing Wake, Ranger's Bramble, Slime Spit, Snare Hopping, Soothing Mist,
Terrain Transposition, Threatening Mimicry, Warning Stripes.

**0 dos 103 class feats (78 exclusivos + 25 compartilhados com trait ranger)
já estão em `feats-core`** (459 docs, cruzados por `_id`) — todos precisam ser
importados nesta onda.

**15 de 20 features faltam** (precisam ser criadas): Hunt Prey, Hunter's Edge,
Ranger Weapon Expertise, Natural Reflexes, Trackless Journey, Ranger
Expertise, Nature's Edge, Warden's Endurance, Unimpeded Journey, Martial
Weapon Mastery, Perception Legend, Greater Natural Reflexes, Masterful Hunter,
Swift Prey, Perception Mastery.

## 7. Tabela esperada de `proficiencyUpgrades` (com origem)

Derivada de `subfeatures.proficiencies` de cada feature × nível do `items{}` do
Ranger (nunca o nível genérico do arquivo — ver §4.2 para as 2 exceções).

| Nível | Stat | Rank | Origem (feature + arquivo) |
| --- | --- | --- | --- |
| 3 | will | 2 (expert) | Will Expertise — `class-features/will-expertise.json` |
| 5 | martial, simple, unarmed | 2 (expert) | Ranger Weapon Expertise — `class-features/ranger-weapon-expertise.json` |
| 7 | reflex | 3 (master) | Natural Reflexes — `class-features/natural-reflexes.json` |
| 7 | perception | 3 (master) | Perception Mastery — `class-features/perception-mastery.json` |
| 9 | ranger (stat próprio) | 2 (expert) | Ranger Expertise — `class-features/ranger-expertise.json` |
| 11 | light, medium, unarmored | 2 (expert) | Medium Armor Expertise — `class-features/medium-armor-expertise.json` (**reusado**) |
| 13 | martial, simple, unarmed | 3 (master) | Martial Weapon Mastery — `class-features/martial-weapon-mastery.json` |
| 15 | reflex | 4 (legendary) | Greater Natural Reflexes — `class-features/greater-natural-reflexes.json` |
| 15 | perception | 4 (legendary) | Perception Legend — `class-features/perception-legend.json` (**nível 15, não 13 — ver §4.2**) |
| 17 | ranger (stat próprio) | 3 (master) | Masterful Hunter — `class-features/masterful-hunter.json` |
| 19 | light, medium, unarmored | 3 (master) | Medium Armor Mastery — `class-features/medium-armor-mastery.json` (**reusado, nível 19, não 17 — ver §4.2**) |

`Weapon Specialization` e `Greater Weapon Specialization` **não** têm
`subfeatures.proficiencies` (são bônus de dano, não proficiência) — não entram
nesta tabela, mesmo estando no `items{}`.

O stat `"ranger"` (chave própria em `subfeatures.proficiencies`, não `"perception"`
nem `"class"`) aparece em Ranger Expertise e Masterful Hunter — reportado como
está no vendor, sem interpretação; a integração central decide o `PlanSlotType`
correspondente.

## 8. Pré-requisitos

- **59/103 feats** têm algum texto de `prerequisites.value` não-vazio.
- **31 cadeias internas** resolvidas (um feat exige outro feat/feature do
  próprio conjunto ranger), via normalização de nome (lowercase + remoção de
  sufixo `(...)`) contra os 103 nomes de feat e os 20 nomes canônicos de
  feature. 5 exemplos com a forma exata do JSON do vendor:

  ```json
  // feats/class/ranger/level-10/incredible-companion-ranger.json
  "prerequisites": { "value": [{ "value": "Mature Animal Companion" }] }
  // resolve para "Mature Animal Companion (Ranger)" (normalização remove o sufixo)

  // feats/class/ranger/level-10/master-monster-hunter.json
  "prerequisites": { "value": [
    { "value": "master in Nature" },
    { "value": "Monster Hunter" }
  ] }
  // 1ª cláusula = não-mecanizável (proficiência); 2ª = cadeia interna

  // feats/class/ranger/level-10/peerless-warden.json
  "prerequisites": { "value": [{ "value": "Initiate Warden" }] }

  // feats/class/ranger/level-14/shared-prey.json
  "prerequisites": { "value": [
    { "value": "Double Prey" },
    { "value": "Warden's Boon" }
  ] }

  // feats/class/ranger/level-14/stealthy-companion.json
  "prerequisites": { "value": [
    { "value": "Animal Companion" },
    { "value": "Camouflage" }
  ] }
  ```

- **26 cláusulas não-mecanizáveis**: todas do padrão `"<rank> in <Skill>"`
  (ex.: "master in Stealth", "expert in Occultism") — texto de requisito
  preservado (REQ-BC-034), nunca virou predicado.
- **16 referências para fora do conjunto ranger** que não resolveram contra os
  103 feats nem as 20 features:
  - `Snare Crafting` (feat geral de Crafting, referenciado por Snare Hopping e
    Snare Specialist)
  - `Experienced Tracker` (feat de perícia Survival, referenciado por Swift
    Tracker)
  - `Titan Wrestler` (feat geral, referenciado por "The Harder They Fall
    (Kingmaker)")
  - `weapon specialization` (na verdade resolve para a **feature**
    "Weapon Specialization" do próprio `items{}`, não para um feat — contado à
    parte da cadeia de feats)
  - As demais 12 são as variações de texto ligadas à dependência de Animal
    Companion e "warden spells" — ver §9.

## 9. Dependência externa: Animal Companion (spec 29)

O Ranger concede o Animal Companion **por feat**, não por feature do
`items{}` — confirmado: não há entrada "Animal Companion" na progressão
1..20 do doc de classe, só o feat `Animal Companion (Ranger)` (nível 1,
`feats/class/ranger/level-1/animal-companion-ranger.json`).

**11 feats** do conjunto ranger dependem mecanicamente do subsistema de Animal
Companion, que a `specs/29-pets-companions-familiars.md` descreve mas que
**não está implementado em nenhum pack do Fusion hoje** (nenhum
`systems/pf2e/packs/*companion*` existe):

Animal Companion (Ranger), Mature Animal Companion (Ranger), Incredible
Companion (Ranger), Specialized Companion (Ranger), Masterful Companion, Heal
Companion, Side by Side (Ranger), Stealthy Companion, Enlarge Companion,
Companion's Cry, Magic Hide.

**Decisão desta curadoria**: os 11 feats **entram** no `classFeats` normal (são
documentos válidos, com traits/nível/prerequisites corretos) — a curadoria não
filtra por essa dependência (regra: a mecânica executável vem do vendor
`rules[]`, DEC-BC-02). Mas fica **registrado** que os `rules[]`/`GrantItem`
desses feats que referenciam um Actor "animal companion" não vão produzir
efeito no `derived` até a spec 29 ser implementada — isso é esperado e não é
bug desta rodada.

Achado colateral: 5 feats (Warden's Focus, Magic Hide, Snare Hopping,
Natural Conduit, Ranger's Bramble, Animal Strength) referenciam "warden
spells" no prerequisito — é o nome coloquial das 22 focus spells de trait
`ranger` (§6), já cobertas 100% pelo `spells-core`. Não é uma dependência
faltante.

## 10. Colisões e homônimos

Um único caso de colisão confirmado (armadilha do `entry.name`, §4.1):
"Weapon Mastery" (nosso pack, sourceId `ejP4jVQkS48uKRFz`) vs. "Martial
Weapon Mastery" (o que o Ranger realmente precisa, sourceId `i6563IU7x4L9oRgC`)
— documentado em `dedupe.collisionsDetected` no JSON de curadoria.

Não foram encontrados homônimos de **nome de feat** dentro do conjunto de 103
feats do Ranger (nenhuma duplicata de `name` normalizado sem sufixo
desambiguador).

## 11. Preparação para multiclasse (seção 4 do plano)

- Todos os 78 feats do diretório exclusivo `ranger/` têm `category: "class"` e
  **só** o trait `ranger` como trait de classe (sem `archetype`, sem trait de
  ancestria concorrente) — gate deriva limpo para `{"class_level": {"ranger":
  {">=": N}}}`.
- Os 25 feats de `shared-class-feats/` com trait ranger também carregam
  **outro(s)** trait(s) de classe (ex.: Twin Riposte = fighter+ranger; Blind-
  Fight = fighter+investigator+ranger+rogue) — **nenhum** caso de trait
  `archetype` combinado com trait de classe foi encontrado neste conjunto
  (varredura completa dos 25, zero ambiguidades). A ambiguidade real desses 25
  é outra: cada um pode ser concedido por **qualquer uma** das classes que
  compartilham o trait, então o gate de `class_level` correto depende de **qual
  classe concedeu o slot**, não de um único `class_level` fixo — isso é
  responsabilidade da integração central (ela já sabe, por slot, qual classe
  está oferecendo o feat).
- `Hunter's Edge` como eixo é dado (`choiceAxes[]`), pronto para o
  `CLASS_CHOICE_SLOTS` genérico — sem hardcode desta classe.

## 12. Decisões tomadas

1. Nome canônico das features = segmento final da uuid, nunca `entry.name`
   (regra 4) — aplicado sistematicamente, com o caso "Weapon Mastery →
   Martial Weapon Mastery" documentado.
2. Nível das features = nível do `items{}` do Ranger, nunca o nível genérico
   do arquivo — aplicado, com as 2 divergências (Perception Legend, Medium
   Armor Mastery) registradas em `classFeatures.levelDivergences`.
3. `choiceAxes[0].optionCount = 3` para Hunter's Edge (não 4) — Vindicator
   fica de fora por ser conteúdo do arquétipo homônimo, fora de escopo da
   rodada.
4. Os 11 feats dependentes de Animal Companion entram no `classFeats` normal
   (documento válido), com a dependência para spec 29 registrada como nota,
   não como exclusão.
5. `focusSpells` aponta as 22 magias já presentes em `spells-core`; nenhuma
   nova entra nesta rodada.

## 13. Perguntas em aberto para a integração central

1. Qual `PlanSlotType`/slot vai representar o stat próprio `"ranger"` que
   aparece em `subfeatures.proficiencies` de Ranger Expertise e Masterful
   Hunter (não é `perception` nem um dos slots de arma/armadura padrão)?
2. Para os 25 feats de `shared-class-feats` compartilhados entre classes, como
   a integração central vai decidir qual `class_level` usar quando o feat for
   ofertado a partir de um slot do Ranger especificamente (ver §11)?
3. Confirmar com o dono do produto se os 11 feats de Animal Companion devem
   aparecer no builder **antes** da spec 29 estar pronta (documento visível,
   mecânica no-op) ou se devem ficar em `excludeNames` até lá — esta curadoria
   optou pela primeira opção, mas é uma decisão de produto, não só técnica.
