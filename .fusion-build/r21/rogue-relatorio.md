# Relatório de curadoria — Rogue (r21)

> Escopo: levantamento medido do vendor `tools/importer-pf2e/vendor/pf2e/packs/pf2e/`
> para produzir `tools/importer-pf2e/src/curation/classes/rogue.json`. Nenhum arquivo
> compartilhado foi tocado; nenhum comando de importer/git foi executado.

## 1. Método

Todos os números abaixo saem de comandos `node -e` rodados a partir de
`tools/importer-pf2e/vendor/pf2e/packs/pf2e/` (ou da raiz do repo, indicado por
comando), lendo os JSON do vendor/packs diretamente. Nenhum número foi estimado
de memória.

1. `classes/rogue.json` → `system.hp`, `system.keyAbility`, `system.attacks`,
   `system.defenses`, `system.savingThrows`, `system.perception`,
   `system.{ancestry,class,general,skill}FeatLevels`, `system.skillIncreaseLevels`,
   `system.trainedSkills`, `system.classDC` (ausente), `system.items`.
2. Para cada entrada de `system.items`, comparei `entry.name` contra o **segmento
   final da uuid** (`v.uuid.split('.').pop()`) — a regra 4 da rodada.
3. Para cada nome canônico resultante, abri o arquivo correspondente em
   `class-features/<slug>.json` e li `system.level.value` e
   `system.subfeatures.proficiencies`.
4. Cruzei os 20 nomes canônicos do Rogue contra `systems/pf2e/packs/class-features-core/documents.json`
   por `flags.fusion.sourceId` (join estrito, DEC-BC-01/regra 6).
5. Varri as 27 `classes/*.json` do vendor e contei, para cada um dos 20 nomes,
   em quantos `items{}` de outras classes o mesmo nome canônico aparece (feature
   compartilhada).
6. Listei `feats/class/rogue/level-*/*.json` (87 arquivos) e `feats/class/shared-class-feats/*.json`
   (0 arquivos), com `system.traits.value`, `system.category`, `system.level.value`,
   `system.prerequisites.value`.
7. Cruzei os 87 feats contra `systems/pf2e/packs/feats-core/documents.json` por
   `system.traits.value.includes('rogue')` (0 hits) e localizei `Rogue Dedication`
   por busca de nome (existe, mas sem trait `rogue`).
8. `otherTag: "rogue-racket"` — varri `class-features/*.json` por
   `system.traits.otherTags.includes('rogue-racket')` → 6 arquivos.
9. `journals/remaster-changes.json` — busquei os nomes pré-remaster citados no
   prompt da rodada (Slippery Mind, Evasion, Improved Evasion) para confirmar
   renomeação, já que não existem como arquivos de class-feature no vendor atual.
10. Validei o arquivo final rodando `validateClassCuration()` do loader real
    (`tools/importer-pf2e/src/curation/index.mjs`, sem modificá-lo) contra o
    JSON escrito — passou sem erro.

## 2. Doc da classe (medido)

| Campo               | Valor                                                                               |
| ------------------- | ----------------------------------------------------------------------------------- |
| hp                  | 8                                                                                   |
| keyAbility          | `["dex"]` (sem opção alternativa)                                                   |
| perception          | 2 (expert inicial)                                                                  |
| savingThrows        | fortitude 1, reflex 2, will 2 (T/E/E)                                               |
| attacks             | martial 1, simple 1, unarmed 1, advanced 0                                          |
| defenses            | light 1, unarmored 1, heavy 0, medium 0                                             |
| classDC             | **ausente** no doc (`system.classDC === undefined`) — ver §7                        |
| classFeatLevels     | `[1,2,4,6,8,10,12,14,16,18,20]`                                                     |
| ancestryFeatLevels  | `[1,5,9,13,17]`                                                                     |
| generalFeatLevels   | `[3,7,11,15,19]`                                                                    |
| skillFeatLevels     | `[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]` — **todo nível**             |
| skillIncreaseLevels | `[2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]` — **todo nível a partir do 2** |
| trainedSkills       | `stealth` + 7 adicionais (`additional: 7`)                                          |

**Confirma o ponto citado no prompt (regra 15 da spec 30):** Ladino concede skill
feat E skill increase em TODO nível, não só nos ímpares/padrão. Isso é dado
observável direto no doc da classe (`skillFeatLevels`/`skillIncreaseLevels`), não
precisou de inferência.

## 3. `items{}` da classe — 20 entradas, todas nos níveis ímpares 1–19

| Nível | Nome canônico (uuid tail)     | entry.name diverge?                                                                                                |
| ----: | ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
|     1 | Rogue's Racket                | não                                                                                                                |
|     1 | Sneak Attack                  | não                                                                                                                |
|     1 | Surprise Attack               | não                                                                                                                |
|     3 | Deny Advantage                | não                                                                                                                |
|     5 | Weapon Tricks                 | não                                                                                                                |
|     7 | Weapon Specialization         | não                                                                                                                |
|     7 | Perception Mastery            | não                                                                                                                |
|     7 | Evasive Reflexes              | não                                                                                                                |
|     9 | Rogue Resilience              | não                                                                                                                |
|     9 | **Debilitating Strike**       | **sim** — uuid aponta para `Item.Debilitating Strike` (singular), `entry.name` diz "Debilitating Strikes" (plural) |
|    11 | Rogue Expertise               | não                                                                                                                |
|    13 | Master Tricks                 | não                                                                                                                |
|    13 | Light Armor Expertise         | não                                                                                                                |
|    13 | Greater Rogue Reflexes        | não                                                                                                                |
|    13 | Perception Legend             | não                                                                                                                |
|    15 | Greater Weapon Specialization | não                                                                                                                |
|    15 | Double Debilitation           | não                                                                                                                |
|    17 | Agile Mind                    | não                                                                                                                |
|    19 | Light Armor Mastery           | não                                                                                                                |
|    19 | Master Strike                 | não                                                                                                                |

Único caso de mismatch uuid-tail vs. `entry.name` no conjunto do Rogue:
**"Debilitating Strike"** (nome canônico correto, usado no arquivo `debilitating-strike.json`
e no schema) vs. `"Debilitating Strikes"` (o que aparece se alguém casar por
`entry.name` — documento fantasma, exatamente a armadilha da regra 4).

## 4. Já existe nos packs — REUSADO (regra 6)

`class-features-core/documents.json` (48 docs) cruzado por `sourceId`:

| Nome                          | sourceId (packs)   | sourceId (vendor)  | Bate? |
| ----------------------------- | ------------------ | ------------------ | ----- |
| Weapon Specialization         | `9EqIasqfI8YIM3Pt` | `9EqIasqfI8YIM3Pt` | sim   |
| Greater Weapon Specialization | `Z7HX6TeFsaup7Dx9` | `Z7HX6TeFsaup7Dx9` | sim   |
| Light Armor Expertise         | `pZYkb12t5DSwtts7` | `pZYkb12t5DSwtts7` | sim   |
| Light Armor Mastery           | `SHpjmM4A3Sw4GgDz` | `SHpjmM4A3Sw4GgDz` | sim   |

Estes **4 dos 20** nomes do `items{}` do Rogue já estão nos packs e serão
**reusados**, nunca recriados. Os outros **16** faltam
(`classFeatures.missingFromPacks` no JSON de curadoria):
Rogue's Racket, Sneak Attack, Surprise Attack, Deny Advantage, Weapon Tricks,
Perception Mastery, Evasive Reflexes, Rogue Resilience, Debilitating Strike,
Rogue Expertise, Master Tricks, Greater Rogue Reflexes, Perception Legend,
Double Debilitation, Agile Mind, Master Strike.

**Feats:** 0 dos 87 feats candidatos (trait `rogue`, `category: class`) existem
hoje em `feats-core` (`documents.json`, 459 docs, filtro
`system.traits.value.includes('rogue')` → 0 hits).

`Rogue Dedication` **existe** em `feats-core` (sourceId `bCWieNDC1CD35tin`,
`category: "class"`, nível 2) — mas seus traits são
`["archetype", "dedication", "multiclass"]`, **sem** o trait `rogue`. Confirma
o aviso do prompt: dedicação **não é class feat da classe** e é corretamente
excluída pelo predicado `trait:rogue` sem precisar de `excludeNames`.

## 5. Feature compartilhada — quantas das 27 classes referenciam

Varredura de `classes/*.json` (27 arquivos) por nome canônico no `items{}`:

| Feature                       | Classes que concedem | Nível no Rogue | Nível em outras classes (amostra)                |
| ----------------------------- | -------------------: | -------------: | ------------------------------------------------ |
| Weapon Specialization         |                25/27 |              7 | Wizard 13, Kineticist 13, Fighter 7, Barbarian 7 |
| Greater Weapon Specialization |                13/27 |             15 | Fighter 15, Ranger 15, Champion 15               |
| Perception Mastery            |                10/27 |              7 | Ranger 7, Investigator 7, Bard 11                |
| Light Armor Expertise         |                 6/27 |             13 | Swashbuckler 13, Bard 13, Kineticist 13          |
| Perception Legend             |                 4/27 |             13 | Ranger 15, Investigator 13, Gunslinger 19        |
| Light Armor Mastery           |                 4/27 |             19 | Swashbuckler 19, Investigator 19, Kineticist 19  |
| (demais 14 nomes)             |      1/27 (só Rogue) |              — | exclusivas                                       |

**Ponto relevante para a regra 5 (nível do items{} vence sobre nível genérico do
arquivo):** para o Rogue especificamente, o `system.level.value` do arquivo
genérico de CADA UMA das 16 features novas bate exatamente com o nível no
`items{}` do Rogue (ex.: `weapon-specialization.json` diz nível 7, e o Rogue
concede no 7). **Não houve divergência arquivo-vs-classe para o Rogue** — mas a
tabela acima mostra que a divergência existe **entre classes** (Weapon
Specialization é 7 no Rogue e 13 no Wizard/Kineticist/Bard, mesmo arquivo). Isso
confirma que o nível tem de vir sempre do `items{}` de cada classe e nunca do
arquivo isolado — só que, no caso do Rogue, o arquivo "mente" para outras
classes, não para ele.

## 6. `proficiencyUpgrades` esperado

Tabela derivada de `subfeatures.proficiencies` de cada feature × nível do
`items{}` do Rogue (nunca o `system.level` genérico — aqui os dois coincidem,
mas a regra foi aplicada mesmo assim):

| Nível | Stat                           |   Rank (TEML) | Origem                                                            |
| ----: | ------------------------------ | ------------: | ----------------------------------------------------------------- |
|     7 | perception                     |    3 (master) | Perception Mastery / `perception-mastery.json`                    |
|     7 | reflex                         |    3 (master) | Evasive Reflexes / `evasive-reflexes.json`                        |
|     9 | fortitude                      |    2 (expert) | Rogue Resilience / `rogue-resilience.json`                        |
|    11 | classDC (chave vendor `rogue`) |    2 (expert) | Rogue Expertise / `rogue-expertise.json`                          |
|    13 | armor.light + armor.unarmored  |    2 (expert) | Light Armor Expertise / `light-armor-expertise.json` (já reusado) |
|    13 | reflex                         | 4 (legendary) | Greater Rogue Reflexes / `greater-rogue-reflexes.json`            |
|    13 | perception                     | 4 (legendary) | Perception Legend / `perception-legend.json`                      |
|    17 | will                           |    3 (master) | Agile Mind / `agile-mind.json`                                    |
|    19 | armor.light + armor.unarmored  |    3 (master) | Light Armor Mastery / `light-armor-mastery.json` (já reusado)     |
|    19 | classDC (chave vendor `rogue`) |    3 (master) | Master Strike / `master-strike.json`                              |

`weapon-specialization.json` e `greater-weapon-specialization.json` têm
`subfeatures.proficiencies === undefined` (escalam dano, não rank de
proficiência) — corretamente ausentes da tabela.

**Ambiguidade classDC (mesma do agente do Fighter, não resolvida aqui):**
`rogue-expertise.json` e `master-strike.json` usam a chave de proficiência
`"rogue"` (igual ao slug da classe), no mesmo padrão que `kineticist` → `classDC`
já mapeado em `transform.mjs`. O doc de classe do Rogue não tem
`system.classDC` explícito (diferente de Magus/Kineticist, que têm
`classDC: 1`). Mapeei aqui como `classDC` por analogia, mas a integração central
precisa decidir se emite `classDC: 1` inicial também para Rogue (e Fighter) — a
pergunta é idêntica à levantada pelo agente do Fighter.

## 7. Eixo de sub-escolha — `rogue-racket`

`otherTag: "rogue-racket"` em `class-features/*.json`, 6 arquivos:
Avenger (`avenger.json`, também carrega `class-archetype`), Eldritch Trickster,
Mastermind, Ruffian, Scoundrel, Thief — todos nível 1. Feature no `items{}` que
representa a escolha: **"Rogue's Racket"** (nível 1, canônico = uuid tail,
confirmado sem mismatch). `optionCount: 6`, `choose: 1`.

## 8. Class feats (trait `rogue`, `category: class`)

87 arquivos em `feats/class/rogue/level-{1,2,4,6,8,10,12,14,16,18,20}/`, todos
com `system.category === "class"` e `system.traits.value` contendo `"rogue"`
(nenhum falso-positivo — 100% dos 87 confirmados por leitura direta).

Distribuição por nível:

|     Nível |    Qtd |
| --------: | -----: |
|         1 |      5 |
|         2 |      8 |
|         4 |     12 |
|         6 |     10 |
|         8 |     15 |
|        10 |      8 |
|        12 |      9 |
|        14 |      4 |
|        16 |      7 |
|        18 |      3 |
|        20 |      6 |
| **Total** | **87** |

`feats/class/shared-class-feats/` está **vazio** (0 arquivos) — o parâmetro
`includeSharedClassFeats: true` do schema não adiciona nenhum feat extra ao
Rogue nesta rodada, apesar de o plano prever a possibilidade. Reportado como
fato observado, não como decisão minha.

Já em `feats-core`: **0/87** (confirmado por `sourceId`/trait, §4).

## 9. Pré-requisitos

42 dos 87 feats têm `system.prerequisites.value` não-vazio. Classificação por
casamento automático (nome normalizado contra: nomes dos 87 feats, os 20 nomes
canônicos do `items{}`, os 6 nomes de racket):

| Categoria                                                      |    Qtd | Mecanização                                                          |
| -------------------------------------------------------------- | -----: | -------------------------------------------------------------------- |
| Cadeia interna (feat/feature da própria classe)                | **18** | aresta no mapa de nós                                                |
| Gate de racket (`"<racket> racket"`)                           |      9 | predicado `has` sobre a opção do choiceAxis (não é aresta feat→feat) |
| Só proficiência (`trained/expert/master/legendary in <skill>`) |     20 | predicado `proficiency`                                              |
| Referência externa (feat de skill, fora da seleção do Rogue)   |      3 | atributo do nó, sem aresta                                           |
| Não mecanizável (nem proficiência nem doc)                     |      1 | texto puro                                                           |
| Texto ambíguo (não bate com nenhum doc por string)             |      1 | texto puro, reportado                                                |

**5 exemplos com a forma exata do JSON** (`system.prerequisites.value`):

```json
// Twin Distraction (nível 4) — cadeia interna
{"value":[{"value":"Twin Feint"}]}

// Vicious Debilitations (nível 10) — cadeia interna (feature) + racket
{"value":[{"value":"ruffian racket"},{"value":"Debilitating Strike"}]}

// Implausible Purchase (Rogue) (nível 18) — cadeia interna com nome truncado
// (o feat real se chama "Predictive Purchase (Rogue)")
{"value":[{"value":"Predictive Purchase"}]}

// Anticipate Ambush (nível 6) — só proficiência
{"value":[{"value":"expert in Stealth"}]}

// Analyze Weakness (nível 6) — não mecanizável (valor de escala, não rank/doc)
{"value":[{"value":"sneak attack 2d6"}]}
```

**As 18 cadeias internas** (formato `[feat, prereq]`, texto do vendor
preservado onde ajuda a auditoria — já no `rogue.json`):

Twin Distraction→Twin Feint; Nimble Roll→Nimble Dodge; Improved Poison
Weapon→Poison Weapon; Deadly Poison Weapon→Improved Poison Weapon; Ricochet
Feint→Ricochet Stance (Rogue); Eldritch/Methodical/Precise/Tactical/Vicious
Debilitations→Debilitating Strike (feature, nível 9) + racket correspondente;
Bloody/Critical/Enduring Debilitation→Debilitating Strike; Implausible Purchase
(Rogue)→Predictive Purchase (Rogue); Steal Spell→Loaner Spell (+ referência
externa); Reactive Distraction→Perfect Distraction; Impossible
Striker→Sly Striker; Implausible Infiltration→(legendary Acrobatics + referência
externa).

**3 referências externas** (fora da seleção do Rogue, feats de skill genéricos):
Plant Evidence→Pickpocket (nível 1); Steal Spell→Legendary Thief (nível 15);
Implausible Infiltration→Quick Squeeze (nível 1).

**1 caso não-resolvido/ambíguo**: `Ambushing Knockdown` (nível 8) exige
`"Ruffian Rogue"` no texto — não bate com nenhum nome de doc (a racket se chama
apenas "Ruffian"). Provável erro de redação do vendor ou forma abreviada; não
resolvi por heurística de nome (proibido pela regra 4/DEC-BC-01) — fica
reportado, sem aresta automática.

## 10. Preparação para multiclasse (§4 do plano)

- Todo class feat do Rogue tem trait `rogue` + `category: class` → gate derivado
  `{"class_level": {"rogue": {">=": N}}}`. **0 dos 87 feats candidatos têm trait
  `archetype`** (confirmado por leitura de `system.traits.value` em todos os 87
  arquivos) — logo não há ambiguidade `archetype` vs. trait de classe para o
  Rogue.
- Nenhum dos 87 feats do Rogue carrega trait de **outra classe** junto com
  `rogue` (ao contrário do caso relatado pelo Fighter, onde 38/110 feats tinham
  trait duplo com Barbarian) — não há ambiguidade de "qual classe" no gate
  derivado para o conjunto do Rogue.
- `grantedBy` das 16 features novas: todas concedidas só pelo Rogue no nível
  correspondente da tabela do §3, exceto as 6 compartilhadas do §5, cujo
  `grantedBy` real (multi-classe, multi-nível) sai da varredura completa das 27
  classes já feita ali — não precisa de levantamento adicional.

## 11. Focus spells

Rogue não tem `spellcasting` (`system.spellcasting === 0` no doc da classe) e
nenhuma racket ou feat do conjunto medido concede focus spells na classe base.
`focusSpells: { names: [], alreadyInPacks: [] }`.

## 12. Riscos e armadilhas encontradas

1. **Homônimo uuid-tail vs. entry.name**: "Debilitating Strike" (canônico) vs.
   "Debilitating Strikes" (entry.name) — já tratado no schema.
2. **Nomes truncados em texto de pré-requisito**: "Ricochet Stance" e
   "Predictive Purchase" no texto do vendor faltam o sufixo `(Rogue)` que
   desambigua do homônimo de outra classe/fonte (Investigator tem "Predictive
   Purchase (Investigator)"). Resolvido manualmente para o feat do próprio
   Rogue; registrado em `dedupe.collisionsDetected`.
3. **Racket gate com texto não-padronizado**: "Ambushing Knockdown" exige
   "Ruffian Rogue" em vez de "ruffian racket" — quebra o casamento automático
   por string usado nos outros 8 gates de racket. Fica como texto puro.
4. **`shared-class-feats` vazio**: `includeSharedClassFeats: true` está correto
   no schema, mas hoje não adiciona nada — se o vendor ganhar arquivos ali no
   futuro (outra classe com trait `rogue` num feat cruzado), a curadoria já
   está pronta para pegá-los sem mudança.
5. **`classDC` ausente no doc da classe**: mesma ambiguidade já levantada pelo
   Fighter — decisão de integração central, não resolvida por mim.
6. **`Rogue Dedication` já em `feats-core`**: não é class feat da classe (sem
   trait `rogue`), corretamente fora do conjunto — mas vale conferência humana
   de que o builder de arquétipo (fora de escopo desta rodada) vai reusar esse
   doc, não recriar.
7. Nenhuma arte/ícone da Paizo foi referenciada nas evidências deste relatório;
   nenhuma prosa de lore foi transcrita (só nomes de mecânica e valores
   numéricos, conforme REQ-LEG-010).

## 13. Decisões tomadas

- Nome canônico da 9ª entrada do `items{}` = "Debilitating Strike" (uuid tail),
  não "Debilitating Strikes" (entry.name).
- `keyAbilityOptions: ["dex"]` — Rogue não tem opção alternativa de key ability
  no doc do vendor (diferente de, por exemplo, Fighter com `["str","dex"]`).
- Cadeias de pré-requisito que misturam feature de classe + racket
  (`Debilitating Strike` + `"<racket> racket"`) foram registradas como cadeia
  interna com o texto completo, não separadas em duas entradas — para não
  perder a informação de que a Debilitação exige AMBOS.
- `Ambushing Knockdown → "Ruffian Rogue"` não foi normalizado para "Ruffian" por
  heurística; fica como caso ambíguo reportado (regra 4 proíbe resolução por
  heurística de nome).

## 14. Perguntas em aberto (para a integração central)

1. `classDC` inicial para Rogue (e Fighter): emitir `classDC: 1` por convenção,
   mesmo sem `system.classDC` explícito no doc do vendor? (mesma pergunta do
   agente do Fighter — parece ser um padrão geral do vendor para classes
   marciais/semi-marciais, vale resolver uma vez para as duas.)
2. Como tratar o gate ambíguo de `Ambushing Knockdown` ("Ruffian Rogue")? Opções:
   (a) mapear manualmente para "ruffian racket" com uma tabela de exceção
   documentada, (b) deixar como texto puro sem aresta/predicado. Não decidi
   sozinho por ser exatamente o tipo de resolução por heurística que a regra 4
   proíbe sem confirmação.
3. `feats/class/shared-class-feats` vazio hoje — confirmar se isso é esperado
   para esta rodada (Onda 1) ou se é sinal de pin de vendor desatualizado
   (DEC-BC-07).
