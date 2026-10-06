# Auditoria factual — plano/tasks/execucao ficha-nivel3 (2026-09-20)

Metodologia: leitura direta dos JSONs dos packs (pin `HEAD`=`e0597c9` no submodule e
`origin/feat/classes-necromancer-runesmith`), grep/parse em Node ad-hoc, leitura de
`planVM.ts`, `schema-primitives.ts`, `disabled-rules.mjs`, migration 010, `choiceSetInventory.ts`,
e árvore de arquivos em `tools/importer-pf2e/vendor/pf2e/packs/pf2e/feats/archetype/`.

## 1. ERRADO — 2.541 GrantItem→Compendium.pf2e em class-features-core+feats-core
Contando `key==="GrantItem"` com `uuid` iniciando em `"Compendium.pf2e."`:
- Pin atual (12 classes, HEAD `e0597c9`): 57 (class-features-core) + 65 (feats-core) = **122**.
- Branch de 29 classes (`origin/feat/classes-necromancer-runesmith`): 239 + 111 = **350**.
O número 2.541 na verdade é a contagem de OCORRÊNCIAS BRUTAS da substring `"Compendium.pf2e."`
(via regex no texto do JSON, não filtrado por `key==="GrantItem"`) **só dentro de
`class-features-core` da branch de 29 classes** (não somado com feats-core): esse arquivo
sozinho dá exatamente 2541 substring-hits — mas confundindo "toda ocorrência da string" com
"GrantItem" e "só um arquivo" com "os dois arquivos". O número real de GrantItem quebrados é
uma ordem de grandeza menor (122 no pin, 350 na branch completa).

## 2. CONFERE — 29 classes na branch, 12 no pin
`classes-core/documents.json`: pin = Barbarian, Bard, Champion, Cleric, Fighter, Kineticist,
Magus, Monk, Ranger, Rogue, Sorcerer, Wizard (12). Branch = essas 12 + Alchemist, Animist,
Commander, Druid, Exemplar, Guardian, Gunslinger, Inventor, Investigator, Necromancer, Oracle,
Psychic, Runesmith, Summoner, Swashbuckler, Thaumaturge, Witch (29).

## 3. CONFERE — 12 cabeadas / 15 faltando em CLASS_CHOICE_SLOT_OPTIONS
`planVM.ts:2094` tem exatamente as 12 chaves citadas (hybridStudy, instinct, racket,
huntersEdge, arcaneThesis, arcaneSchool, bloodline, muse, cause, doctrine, divineFont,
blessing). Nenhuma das 15 citadas como faltando (ikon, rootEpithet, style, way, methodology,
implement, patron, order, researchField, innovation, eidolon, fatalMethod, mystery,
consciousMind, practice) existe sequer no `type PlanSlotType` (linha 420) — confirma que
estão 100% de fora, não parcialmente cabeadas.

## 4. CONFERE — 0 ChoiceSet nos packs
`class-features-core` e `feats-core` (pin): 0 ocorrências de `key==="ChoiceSet"` dentro de
`system.rules` (as únicas 62+50 ocorrências vivem em `flags.fusion.unconvertedRules`, marcadas
`_conversionState:"unsupported"` — nunca chegam a rodar).

## 5. ERRADO — dedicações/talentos do vendor archetype
Path confere (251 pastas = 251 arquétipos, CONFERE). Mas usando trait `dedication` (ou nome
terminando em "Dedication") sobre os 2.340 arquivos `.json`:
- Dedicações totais: **245** (não 179).
- Multiclasse (trait `multiclass`): **29** (não 21).
- Padrão (não-multiclasse): **216** (não 158).
- Padrão de nível 2: **167** (não 129).
- Talentos de arquétipo (excluindo dedicações): **2.095** (2.340−245); mesmo filtrando por
  licença ORC (que é o critério de uso permitido no projeto) dá 1.667, nenhum bate com 1.713.
Todas as 5 sub-cifras deste item divergem da tabela do plano; nenhuma bateu exatamente.

## 6. CONFERE — 37 ações com trait `tactic`
`actions-core` da branch de 29 classes: 37 de 538 documentos com `traits.value` incluindo
`"tactic"`.

## 7. CONFERE — Animist 17/23 sem rules
23 `classFeature` com trait `animist` e nível ≤3 na branch; 17 com `system.rules` vazio, 6 com
rules não-vazio (Fortitude Expertise, Animistic Practice, Liturgist, Medium, Seer, Shaman).

## 8. CONFERE — SpellSlotSchema sem spellsKnown
`schema-primitives.ts:223` define `SpellSlotSchema` com só `value`, `max`, `prepared[]` —
nenhum array de magias conhecidas.

## 9. CONFERE — proficiencyUpgrades sem consumidor em packages/
Grep literal em `packages/` (core): 0 matches. Ressalva registrada no relatório (não afeta o
veredito do item, que é sobre `packages/` especificamente): existe consumidor real em
`external/fusion-systems-2e/systems/pf2e/src/derivations/{build,character}.ts` para os stats
`perception`/`saves`/`classDC`/`weapons`/`armor`, mas **nenhuma chamada usa o stat
"spellcasting"** — logo a conclusão maior do plano ("proficiência de conjuração não progride")
também se sustenta, só o mecanismo genérico já existe e é reaproveitável (T2.4 pode ser mais
barata do que "consumidor inexistente" sugere).

## 10. CONFERE — focusPoints clampado em 3, spells com rules:[]
`actor-character.ts:156` define `focusPoints`; `build.ts:653-686` clampa `max` em 3. Composition
Spells, Bloodline Spells e Revelation Spells (class-features-core, branch): `rules.length === 0`
nos três.

## 11. CONFERE — enforcement em planVM.ts:2008 e slot em 1442
Linha 2008 é exatamente `if (traits.includes("archetype")) return false;` dentro do case
`classFeat` de `isFeatEligible`. Linha 1442 é exatamente
`if (freeArchetype && level % 2 === 0) {` — slot `archetypeFeat` só existe com a variante ligada.

## 12. CONFERE — Elfo Ancião
`heritages-core` (pin): "Ancient Elf" com `system.rules.length === 0`. `disabled-rules.mjs`
tem a entrada `docName: "Ancient Elf"`, decisão `DEC-MC-01`. Migration
`010_dec_mc_01_ancient_elf.ts` existe em `packages/server/src/db/migrations/`.

## 13. CONFERE — pack de divindades inexistente
Nenhum pack `deities-*` em `systems/pf2e/packs/`. `choiceSetInventory.ts:110` é exatamente
`"class-features-core/Deity (Champion)/deity": "pendente",`.

## 14. CONFERE — 16/16 talentos de arquétipo nv2-3 com prerequisites
Na branch de 29 classes, `feats-core`: 16 documentos com trait `archetype` e nível 2 ou 3
(incluindo as dedicações de nível 2 que são o grosso da lista); as 16 têm
`system.prerequisites.length > 0`. (No pin de 12 classes o número é 15, não 16 — a contagem do
plano bate com o estado PÓS-merge da onda 0, que é o que o plano pressupõe.)

## 15. CONFERE — guard KNOWN_CLASS_TRAITS não é ancestral da branch
`git merge-base --is-ancestor e0597c9 origin/feat/classes-necromancer-runesmith` retorna falso;
o merge-base é `073fb5e`, um commit anterior ao que adicionou a lista atual de 21 traits
(inclusive Witch/Wizard) em `e0597c9`. Confirma que reintegrar as 29 classes sem reaplicar o
guard perde a proteção nas classes já cobertas em `e0597c9` (Alchemist, Druid, Gunslinger,
Inventor, Investigator, Oracle, Summoner, Swashbuckler, Witch) e nunca cobriu as 8 restantes
(Animist, Commander, Exemplar, Guardian, Necromancer, Psychic, Runesmith, Thaumaturge).

---

**Total de erros: 2** (itens 1 e 5). Os outros 13 itens conferem exatamente com o texto dos
documentos.
