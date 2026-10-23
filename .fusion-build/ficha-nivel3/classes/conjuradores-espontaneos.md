# Sonda de criação de ficha — conjuradores espontâneos (Sorcerer, Bard, Oracle, Psychic, Animist)

Fonte lida: `origin/feat/classes-necromancer-runesmith` (HEAD do submodule, detached, NUNCA escrito) via
`git show origin/feat/classes-necromancer-runesmith:systems/pf2e/packs/<pack>/documents.json` de dentro de
`external/fusion-systems-2e`. Packs: `classes-core`, `class-features-core`, `feats-core`, `spells-core`.
JSONs intermediários em `%TEMP%/classes-core.json`, `class-features-core.json`, `feats-core.json`,
`spells-core.json` (sessão), não commitados.

## Modelo de dados — achados transversais

1. **Repertório de conjuração espontânea: CONFIRMADO AUSENTE.**
   - `external/fusion-systems-2e/systems/pf2e/src/schema-primitives.ts:223-227` — `SpellSlotSchema` só tem
     `max` (nº de slots) e `prepared: z.array(PreparedSpellSchema).optional()`. Não existe um array paralelo
     de "spells conhecidas" por círculo (o que um espontâneo precisaria para saber QUAIS magias pode
     converter num slot vago).
   - `external/fusion-systems-2e/systems/pf2e/src/schemas/item-spellcasting-entry.ts:24` — `prepared.value`
     aceita `"prepared" | "spontaneous" | "innate"`, mas o resto do schema (linhas 25-40: `tradition`,
     `ability`, `proficiency`, `slots`, `isFocusPool`) é o MESMO para os três tipos — não há campo dedicado
     a repertório espontâneo.
   - No pack `classes-core`, o item de classe (`system.spellcasting`) tem `cantripsKnown` (array por nível)
     e `slots` (array por nível) estruturados — mas NÃO tem um `spellsKnown` equivalente para magias de
     círculo. Ex.: Sorcerer (`classes-core`, doc "Sorcerer") — chaves de `spellcasting`: `tradition, type,
     ability, cantripsKnown, slots, traditionByBloodline`. Mesmo padrão em Bard/Oracle/Psychic (sem
     `traditionByBloodline`); Animist é `type: "prepared"` (não espontâneo).
   - A classFeature "Spell Repertoire" (existe em Bard/Sorcerer/Oracle/Psychic, nível 1) tem só 2 `rules`
     cosméticas (`ItemAlteration` de descrição + trait) — a prosa (HTML) explica o mecanismo em linguagem
     natural, mas nada no rules-engine grava um repertório processável.
   - UI: `external/fusion-systems-2e/sheets/pf2e/src/components/sheets/pf2e/SpellPickerDialog.svelte:11`
     — comentário do próprio arquivo diz que o picker é para "prepared slot" (narrowed by grimoire/rank);
     não há modo "conhecida"/espontâneo. **Achado do r29 CONFIRMADO, com evidência de arquivo:linha nos dois
     lados (schema + UI).**

2. **Escolha de linhagem/musa/mistério/mente/prática — ChoiceSet NÃO processável.**
   - `Bloodline` (Sorcerer), `Muses` (Bard), `Conscious Mind` (Psychic) têm `system.rules` com só 1 entrada:
     `GrantItem` com uuid template `{item|flags.system.rulesSelections.<slug>}` — o valor desse placeholder
     seria preenchido por um `ChoiceSet` do PF2e original, mas esse `ChoiceSet` está em
     `flags.fusion.unconvertedRules` com `_conversionState: "unsupported"` (visto em Bloodline e Muses).
     Ou seja: a escolha em si não é processável pelo motor de regras da Fusion — fica em prosa HTML
     (confirmado lendo `system.description` de "Mystery"/"Ancestors"/"Animistic Practice" — texto corrido,
     sem estrutura).
   - Cascata de magias (ex.: linhagem draconic → bloodline spells) também é só prosa com `@UUID[...]` dentro
     do HTML (ex. "The Distant Grasp" do Psychic lista "Granted Spells" como texto com links UUID, não como
     `GrantItem` estruturado por nível).
   - Oracle: mistério (`Mystery`, rules=1) + maldição (`Oracular Curse`, rules=1) EXISTEM como documentos no
     pack, mas ambos com rules mínimas/placeholder — a mecânica de "Cursebound" (condição especial) é só
     descrita em prosa.
   - Animist: `Apparition Attunement` (nível 1) tem `system.rules: []` — nenhuma regra, confirma a lacuna já
     registrada no projeto ("sintonia diária falta"). `Animistic Practice` tem 1 rule (GrantItem do
     placeholder da prática), mesma limitação do ChoiceSet acima.

3. **Magia focal / pontos de foco.**
   - Existe modelo genérico: `actor-character.ts:154-158` (`ResourcesSchema.focusPoints`, `{value, max≤3}`)
     e `item-spellcasting-entry.ts:40` (`isFocusPool: boolean`).
   - MAS as classFeatures que deveriam CONCEDER o pool inicial (Composition Spells/Bard, Bloodline
     Spells/Sorcerer, Revelation Spells/Oracle) têm `system.rules: []` — nada incrementa `focusPoints.max`
     nem grava as magias focais em si; é descrição HTML apenas. Única exceção: Psychic — "Psi Cantrips and
     Amps" tem uma rule real (`ActiveEffectLike add system.resources.focus.max +2`, priority 10). Ou seja,
     de 4 classes só o Psychic mecaniza o pool de foco no nível 1; Bard/Sorcerer/Oracle/Animist não.

4. **Vazamento de talentos de Psychic (achado do PR #203) — NÃO corrigido nesta ref.**
   - O fix original (core, commit `f068074b`, fora deste submodule) tratou as 12 classes já publicadas.
   - Este submodule tem seu PRÓPRIO guard equivalente (`KNOWN_CLASS_TRAITS` em `planVM.ts`, mencionado no
     commit `9795545` "fix(pf2e): fecha o gate de vazamento de talentos... faltavam animist, commander,
     exemplar, guardian, psychic e thaumaturge").
   - `git merge-base --is-ancestor 9795545 origin/feat/classes-necromancer-runesmith` → **NÃO é ancestral**
     (retornou "NO"). Logo, na ref lida para esta sonda, Psychic (e também Animist) ainda vazam talentos de
     classe para o picker de qualquer classe — a correção existe no histórico do repo mas não está presente
     neste branch específico.

## Por classe (nível 1-3)

- Bard: 12 features nv1-3, 8 com rules não-vazias. Escolha = Musa (ChoiceSet unsupported). Repertório
  ausente. Focus (Composition Spells) sem rule.
- Sorcerer: 26 features nv1-3 (18 são as 18 linhagens = "Bloodline: X", 8-10 rules cada, mas são regras
  cosméticas/skill, não repertório). Escolha = Bloodline (ChoiceSet unsupported). Repertório ausente. Focus
  (Bloodline Spells) sem rule.
- Oracle: 28 features nv1-3 (10 mistérios com 3 rules cada + 10 maldições variando 1-6 rules). Mistério +
  maldição existem como documentos, mecanismo raso. Repertório ausente. Focus (Revelation Spells) sem rule.
- Psychic: 18 features nv1-3 (6 "Conscious Mind"/subconsciente com 7-13 rules cada — as mais ricas do grupo).
  Repertório ausente (mesmo padrão). Focus MECANIZADO (única exceção). Talentos de classe vazam (gate não
  presente nesta ref).
- Animist: 23 features nv1-3, mas só 6 com rules não-vazias (menor cobertura do grupo — 17 das 23 são só
  prosa, incluindo as 12 "práticas" do apparition e Apparition Attunement). Sintonia diária ausente
  (confirmado, rules=[]). Talentos de classe também vazam (mesmo gate faltante).

## Classificação

- **Bard** — VERMELHO — repertório ausente + escolha (musa) não processável + focus sem rule (3
  mecanismos) — 12 features nv1-3 / 4 com rules vazias
- **Sorcerer** — VERMELHO — repertório ausente + linhagem (ChoiceSet) não processável + focus sem rule —
  26 features nv1-3 / 5 com rules vazias
- **Oracle** — VERMELHO — repertório ausente + mistério/maldição rasos + focus sem rule — 28 features
  nv1-3 / 3 com rules vazias
- **Psychic** — VERMELHO — repertório ausente + vazamento de talentos não corrigido nesta ref (focus é o
  único ponto OK) — 18 features nv1-3 / 2 com rules vazias
- **Animist** — VERMELHO — repertório/prepared list ausente + sintonia diária ausente + prática (ChoiceSet)
  não processável + vazamento de talentos — 23 features nv1-3 / 17 com rules vazias (pior cobertura)
