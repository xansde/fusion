# Revisão adversarial o2 — lente DADO + IMPORTADOR + INTEGRIDADE

Escopo lido: satélite `git diff origin/main...ficha3/o2` (13 arquivos, 8 commits), core
`git diff origin/alfa/app...ficha3/o2` (pin + 5 chaves i18n), relatórios das 3 lanes + gate.md,
plano/tasks da ficha-nivel3. Nada editado. Sondas: leitura de `classes-core`/`class-features-core`,
leitura read-only de `~/.fusion/worlds/teste_xande/world.db`, e um script isolado
(`$TEMP/probe.mjs`) chamando `recomputeDerivedIfNeeded` do `dist` do server com o `dist` do pf2e.

## Dado / importador
- **Nenhum pack mudou nesta onda.** Não há diff em `systems/pf2e/packs/**` nem em
  `tools/importer-pf2e`. Por isso não há risco de regeneração/idempotência/sourceId/homônimo
  introduzido aqui. A T2.5 pedia `rules` em `class-features-core` (curadoria); a lane trocou por
  derivação a partir de `isFocusPool` — troca aceitável em si, mas quebrada em produção (B1).

## Achados

### B1 — BLOQUEANTE — pool de foco derivado nunca chega ao documento (T2.5 não funciona em produção)
`systems/pf2e/src/derivations/build.ts:714-726` escreve `system.resources.focusPoints.max`. O
servidor roda a derivação sobre um `structuredClone` e persiste **só** `system.derived`
(`packages/server/src/documents/derive.ts:84-120`, `store.update(..., { system: { derived } })`).
A ficha lê o campo cru (`characterSheetVM.ts:920`, `this._system.resources.focusPoints`).
Sonda: ator com uma entrada `isFocusPool:true` → pipeline em memória dá `{value:0,max:1}`, mas o
documento devolvido/persistido por `recomputeDerivedIfNeeded` fica `{value:0,max:0}`.
Cenário: Bard nível 1 criado no builder → aba Foco mostra 0/0 para sempre; Refocar/descanso não
enchem nada. Os testes novos passam porque chamam `runCharacterPipeline(doc)` mutando o doc no
lugar, sem passar pelo caminho de persistência.

### B2 — BLOQUEANTE — conjurador espontâneo não tem como adicionar truques
`SpellsTab.svelte` (branch): a seção Grimório com "+ Adicionar magia" (`openAddPicker`, o único
caminho para pegar truque) foi movida para o `{:else}` de `entry.prepared === "spontaneous"`; o
novo picker "known" só existe nos círculos `!s.isCantrip`; a seção de truques não tem botão.
Cenário: Bard/Sorcerer/Oracle/Psychic recém-criado (entrada nasce vazia) → não consegue escolher
os 5 (Bard) / 3 (Psychic) truques de repertório. Antes da onda conseguia pelo Grimório.

### I1 — IMPORTANTE — descanso não recupera os usos do espontâneo
`characterSheetVM.ts` `restAll` (~l.3000): o laço de slots faz `continue` quando não há array
`prepared` — é exatamente o caso espontâneo (`{value,max,spellsKnown}`). Cenário: Bard gasta os 2
usos do 1º círculo (value 0/2), clica Descansar → continua 0/2; só volta clicando "Recuperar" um a
um.

### I2 — IMPORTANTE — teto do repertório (DEC-T2.1-01) errado para Psychic; justificativa errada para Sorcerer/Oracle
Texto do próprio pack (`class-features-core`, "Spell Repertoire"): Psychic aprende **1 magia de
1º + 1 da mente consciente** com **1 slot** — repertório 2 no nível 1 (e "slots e repertório são
separados"). `knownCap = slot.max` (`SpellsTab.svelte` `knownCap`) trava em 1: o Psychic nível 1
não consegue ter o repertório RAW; nível 3 idem (1/2/2+1 contra 2/3/3+2).
Ao contrário do que o comentário de `characterSheetVM.ts` (bloco DEC-T2.1-01) e a issue proposta
afirmam, Sorcerer (2 escolhidas + 1 de linhagem = 3 = slots) e Oracle (3 = slots) **batem** com
`slot.max`; aplicar o `SPONTANEOUS_REPERTOIRE_OVERRIDES` sugerido (reduzir 1) quebraria os dois.
Resíduo menor: como a magia de linhagem não é empurrada para `spellsKnown`, o Sorcerer escolhe 3
livres em vez de 2 livres + 1 de linhagem.

### I3 — IMPORTANTE — Druid, Witch, Wizard e Psychic ficam sem pool de foco no nível 1
`planVM.ts:3676` `hasFocusFeature` só reconhece feature de nível 1 terminada em " Spells". O pack
diz literalmente "you start with a focus pool of 1 Focus Point" em "Druidic Order" e "Hex Spells"
(a feature da Witch na classe chama "Hexes"); Wizard tem "School Spells initial" na escola;
Psychic tem regra `system.resources.focus.max +2` em "Psi Cantrips and Amps" que nenhum código
aplica (não há consumidor de `resources.focus`). Cenário: Druid nível 1 com Ordem da Folha →
nenhuma entrada de foco, max 0 → magia de ordem não conjurável. O comentário de `build.ts:659-667`
diz que a auditoria achou 7 classes; faltam essas 4 (+ Animist via vaso). A onda declara destravar
Druid/Witch/Wizard/Psychic.

### I4 — IMPORTANTE — Wizard sem o slot de currículo; teste novo congela o número errado
Pack, "Wizard Spellcasting": "prepare up to two 1st-rank spells ... as well as one extra curriculum
cantrip and one extra curriculum spell of each rank" (exceto Teoria Mágica Unificada). O motor usa
só `classes-core` (2 / 3 / 3+2). O teste novo `planVM.test.ts:2756+` ("Wizard, straight from
classes-core", T2.3) afirma que 2 é "a memorized value from the rules" — é circular com o pack e
errado. Cenário: Wizard nível 1 escola de Batalha → 2 slots de 1º em vez de 3 (+1 truque de
currículo); nível 3 → 3+2 em vez de 4+3. O plano ("slots corretos nos níveis 1-3") também está
errado aqui.

### I5 — IMPORTANTE — gate da onda (Cleric nível 3 com slots corretos) não é atendido nem verificado
Divine Font (4 slots extras de cura/dano no nível 1) não gera slot nenhum (`Divine Font` sem
`rules`, só eixo de escolha em `planVM.ts:964`). gate.md só roda build/test; nenhuma evidência do
gate declarado em tasks.md ("um Bard e um Cleric de nível 3 ... foco em 1 ... proficiência no rank
certo"). Com B1, o "foco em 1" do Bard também falha.

### I6 — IMPORTANTE — metade espontânea do Animist não existe
`classes-core` Animist tem uma só `spellcasting` (`prepared`, divine). Não há entrada de
aparição/repertório; o docstring novo de `schema-primitives.ts` ("the spontaneous half of
Animist") e o relatório T2.1 tratam como coberto. Plano item 5 põe o Animist entre os travados
pelo repertório. Cenário: Animist nível 1 → sem slots/repertório de aparição. Corte de escopo sem
issue.

### M1 — MENOR — entradas espontâneas antigas sem `spellsKnown`, sem migração
Mundo `teste_xande`: Tobias tem "occult Spells" `spontaneous` com arrays `prepared` e sem
`spellsKnown`. Qualquer magia que já estivesse nessa entrada fica invisível (Grimório escondido,
`knownSpellsAt` vazio) e o level-up (`syncSlotMaxOp`) descarta o `prepared` legado. Hoje o Tobias
não tem magias, então não há perda observada.

### M2 — MENOR — picker "known" trava no círculo exato e impede versão elevada
`SpellPickerDialog.svelte` filtro `rankOf(e) >= minRank` com `maxRank` igual: não dá para pôr uma
magia de 1º como versão elevada no repertório de 2º, o que o texto de Spell Repertoire permite
explicitamente.

## Conferido e OK
- Slots de `classes-core` nos níveis 1-3: Bard 2/3/3+2, Sorcerer 3/4/4+3, Oracle 3/4/4+3,
  Psychic 1/2/2+1, Cleric/Druid/Witch 2/3/3+2, Magus 1/2/2+1, Animist (preparado) 1/2/2+1 —
  batem com a tabela de slots (exceto o currículo do Wizard, I4, e o Divine Font, I5).
- Repertório: Bard e Oracle = slot.max. T2.4: primeira melhoria de conjuração no nível 7 (9 para
  Magus/Summoner/Champion), sem efeito em 1-3 — correto. Fix do gatilho `patron` da Witch: correto.
- i18n pt-BR das 5 chaves novas presente nos dois arquivos.
