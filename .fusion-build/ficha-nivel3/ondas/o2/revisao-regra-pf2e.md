# Revisão adversarial O2 (Conjuração): regra PF2e e caminho de produção

Revisor: lente REGRA PF2e + CAMINHO DE PRODUÇÃO. Somente leitura. Diffs: satélite `origin/main...ficha3/o2`
(HEAD 37df631), core `origin/alfa/app...ficha3/o2` (HEAD 2a8013e3). Fonte da regra: o texto das features
do próprio pack (`class-features-core`, texto vendor Remaster PC1/PC2/War of Immortals), que traz as tabelas
de repertório e de foco. As lanes disseram que essa fonte "não existia", mas ela está no pack.

## Veredito: NÃO MERGEAR. São 3 bloqueantes, 5 importantes e 4 menores.

### Tabela de conferência (níveis 1-3, contra o texto do pack)

| Classe | Slots no pack (1/2/3) | Regra | Repertório/grimório | Foco na regra | Foco entregue |
|---|---|---|---|---|---|
| Bard | 2 / 3 / 3+2 | ok | repertório = slots (ok, teto correto) | 1 | entry criada; max só no derivado (A4) |
| Sorcerer | 3 / 4 / 4+3 | ok | 2 escolhidas + 1 de linhagem = 3 = slots (teto correto) | 1 | igual ao Bard (A4) |
| Oracle | 3 / 4 / 4+3 | ok | "three 1st-rank spells" = slots (teto correto) | 1 | igual ao Bard (A4) |
| Psychic | 1 / 2 / 2+1 | ok | 1 escolhida + 1 da mente consciente = 2 no N1, **teto dá 1** (A7) | 2 | fora do escopo desta onda (mecanizado antes) |
| Wizard | 2 / 3 / 3+2 | **falta +1 de currículo por círculo e +1 truque** (A6) | grimório sem teto | 1 (school spell) | **0** (A5) |
| Cleric | 2 / 3 / 3+2 | ok (Divine Font derivado à parte) | preparado | 0 | 0 (ok) |
| Druid | 2 / 3 / 3+2 | ok | preparado | 1 (Druidic Order) | **0** (A5) |
| Witch | 2 / 3 / 3+2 | ok | preparado (familiar = T3.3) | 1 (Hexes) | **0** (A5) |
| Magus | 1 / 2 / 2+1 | ok | preparado | 1 (Conflux) | igual ao Bard (A4) |
| Animist | 1 / 2 / 2+1 preparado, 2 truques | ok na metade preparada | **metade de aparição (espontânea) inexistente** (A11) | 1 | **0** (A5) |

T2.4 (proficiência): o consumidor está certo. No recorte 1-3 não muda número, porque a primeira linha
`spellcasting` é do nível 7 (Magus, nível 9). O Cleric não tem nenhuma linha `spellcasting` em
`proficiencyUpgrades` (vem da doutrina). Isso fica fora do recorte 1-3 e não entra como achado.

---

## Bloqueantes

### A1. Conjurador espontâneo não consegue aprender truques
- Onde: `sheets/pf2e/src/components/sheets/pf2e/SpellsTab.svelte:1009` (`{#if entry.prepared === "spontaneous"}`) e `:1071-1191`: o `{:else}` passou a envolver também a seção "Grimório", que tem o único botão "+ Adicionar magia" (`openAddPicker`, sem `maxRank`, e é por ele que se adiciona círculo 0).
- Cenário: criar um Bard nível 1 e abrir a aba Magias. Aparece "Círculo 1" com "+ Adicionar magia conhecida" (o picker fica travado em min=max=1). A seção de truques só renderiza `{#if cantrips(entry).length > 0}` e não tem botão. **Não há caminho para aprender os 5 truques ocultistas.** O mesmo vale para Sorcerer (4+1), Oracle (5) e Psychic (3). Na `origin/main` o grimório aparecia para espontâneos e dava para adicionar truque por ele, então é regressão. A issue #14 (fechada) já pedia a seção de truques do Bard.
- Correção mínima: modo "known" também para o círculo 0, com teto `cantripsKnown` (o slot "0" já é criado com `spellsKnown: []`).

### A2. Ator espontâneo de mundo existente perde todas as magias da vista
- Onde: `SpellsTab.svelte:1009` e `knownSpellsAt` (cerca de 521), `characterSheetVM.ts:1511-1517` (`spellsKnown` só aparece se o array existir). Não há migration nem backfill: o core só mexe em i18n e o pin.
- Cenário: um Bard ou Sorcerer criado antes desta onda (entry com `prepared.value: "spontaneous"`, slots `{value,max,prepared:[...]}` e magias embutidas adicionadas pelo grimório) abre a ficha depois do deploy. O ramo espontâneo lê `spellsKnown` inexistente e mostra "nenhuma magia conhecida", e o grimório está oculto. **As magias continuam no ator, mas somem da aba e não dá para lançar nem remover.** Se o jogador adicionar de novo, `alreadyKnown` só olha `spellsKnown`, então cria um item duplicado. Isso atinge o mundo `teste_xande` e qualquer mesa da linha stable.
- Correção: backfill (migration, ou leitura com fallback `spellsKnown ?? ids das magias embutidas daquele círculo`).

### A4. T2.5 escreve fora do contrato de persistência: no caminho real o foco não acende
- Onde: `systems/pf2e/src/derivations/build.ts` (`stepCharFocusClamp`, grava `system.resources.focusPoints`). O contrato do servidor está em `packages/server/src/documents/derive.ts:25-33` e em `net/derive-runner.ts` (docstring: "only `doc.system.derived` is ever read back out and written to storage"). `recomputeDerivedIfNeeded` só persiste e broadcasta `system.derived` (prunedPatch). A ficha lê `this._system.resources.focusPoints` (`characterSheetVM.ts:920-924`).
- Cenário: numa sessão aberta, o jogador cria um Bard. O `doc:create` da entry de foco (`isFocusPool: true`) roda a derivação num clone, o `max: 1` calculado é descartado e o espelho do cliente continua em `focusPoints = {value:0, max:0}`. **A ficha mostra 0/0, e o gate da onda ("foco em 1") falha.** O valor 1 só aparece depois de reentrar, porque o snapshot de join serve o clone mutado (`sync-handlers.ts:426-440`). Mesmo assim fica 0/1 até o primeiro Descansar (issue #111). O teste `derivations-build.test.ts` chama o step isolado e não passa pelo servidor, por isso não pegou. Veredito: PLAUSIBLE no broadcast em sessão; CONFIRMADO que o valor não é persistido.
- Correção: derivar em `system.derived.focusPoints` e a ficha ler de lá, ou gravar `max`/`value` no momento da concessão (`buildFocusEntryOp`), o que também resolve a #111.

## Importantes

### A3. "Descansar" não recupera os slots do conjurador espontâneo
- Onde: `characterSheetVM.ts` `restAll` (cerca de 3002-3004): `rawPrepared = slots[rank].prepared`, e se não for um array não vazio faz `continue`. A entry espontânea agora só tem `spellsKnown`.
- Cenário: um Oracle nível 3 lança as 4 de 1º círculo e as 3 de 2º (os valores ficam em 0) e clica Descansar. HP e foco voltam, **os slots continuam 0/4 e 0/3.** A única saída é clicar "Recuperar" 7 vezes. Nenhum dos 18 testes novos cobre `restAll` com entry espontânea.

### A5. Wizard, Druid, Witch e Animist ficam sem pool de foco (a regra dá 1 no nível 1)
- Onde: `planVM.ts:3676-3680` `hasFocusFeature`, que só casa features de nível 1 cujo nome termina em `" Spells"`. As features reais são "Hexes" (Witch), "Druidic Order" (Druid), "Arcane School" com as School Spells nos docs de escola (Wizard) e "Animist & Apparition Spellcasting" (Animist). O texto do pack diz: "you start with a focus pool of 1 Focus Point".
- Cenário: criar Witch, Druid, Wizard ou Animist nível 1. Nenhuma entry `isFocusPool` é criada, `countFocusPoolEntries` dá 0 e o foco fica 0/0. Sem entry de foco também não há onde adicionar a hex, o order spell, o school spell ou o vessel spell. A onda declara "Destrava: Wizard, Druid, Witch, Animist". A lane T2.3 escreveu "Patron não concede foco" e usou isso como teste (ausência de Focus Spells): **o teste trava a regra errada**, porque o foco vem de Hexes, não do Patron.

### A6. Wizard sem o slot de currículo: 2/3/3+2 em vez de 3/4/4+3, e 5 truques em vez de 6
- Onde: os dados de `classes-core` Wizard `spellcasting.slots`. Nada no código aplica "one extra curriculum cantrip and one extra curriculum spell of each rank you can cast" (texto de Wizard Spellcasting no pack; `grep curriculum` em `systems/pf2e/src` e `sheets` não acha nada). O teste novo de T2.3 (`planVM.test.ts`, Wizard com o documento real) fixa 2/3/3+2 como "regra".
- Cenário: um Wizard nível 1 prepara só 2 magias de 1º círculo e 5 truques. Pela regra são 3 (+1 de currículo) e 6. No nível 3 são 3+2 contra 4+3. **O teste marca o número errado como verde**, que é o padrão da lição #48 (circularidade com o pack).

### A7. DEC-T2.1-01 está invertida: Sorcerer e Oracle estão certos e o Psychic fica com teto a menos
- Onde: a nota em `characterSheetVM.ts` (cerca de 2765-2795) e `SpellsTab.svelte` `knownCap` (`slot.max`). A pendência sugerida no relatório da lane manda **reduzir** o teto de Sorcerer e Oracle.
- Texto do pack (feature "Spell Repertoire"): o Oracle "learn three 1st-rank divine spells" com 3 slots. O Sorcerer tem "two 1st-rank spells ... as well as an additional spell ... from your bloodline", ou seja, 3 = slots. O Psychic tem "one 1st-rank occult spell" mais "an additional 1st-rank spell ... listed in your conscious mind", ou seja, 2 contra 1 slot.
- Cenário: um Psychic nível 1 adiciona 1 magia e o botão vira "repertório cheio". A magia da mente consciente não pode entrar (nada a concede automaticamente e ela não passa do teto). No nível 2 são 3 contra teto 2. No nível 3, no 2º círculo, são 2 contra teto 1. Se alguém abrir a issue sugerida, Sorcerer e Oracle passam a ficar 1 abaixo da regra.

### A8. O picker "conhecidas" proíbe aprender magia de círculo menor elevada
- Onde: `SpellPickerDialog.svelte` (cerca de 214), filtro `rankOf(e) >= minRank` sobre o círculo **base**, com `SpellsTab` passando `minRank = maxRank = rank`.
- Cenário: um Oracle nível 3 quer `heal` no repertório de 2º círculo (o texto do Repertoire diz "you might add a higher-rank version of a spell you already have"). O picker de 2º círculo só lista magias de base 2 e `heal` (base 1) não aparece. O mesmo acontece com Bard e `soothe`, e com Sorcerer. O cast também não eleva, porque o espontâneo só lança no círculo em que a magia foi conhecida.

## Menores (viram issue)

- **A9. Signature Spells (nível 3 de Bard, Sorcerer, Oracle e Psychic) não existem.** `castKnownSpell` só gasta o `value` do círculo em que a magia é conhecida. Cenário: um Bard 3 com os slots de 1º círculo gastos não consegue lançar a assinatura de 1º círculo num slot de 2º.
- **A10. A magia de linhagem do Sorcerer não é concedida nem reservada** ("your first new spell is always the sorcerous gift spell"). O jogador ocupa os 3 lugares com escolhas livres. O comentário do schema (`schema-primitives.ts:241-244`) afirma que "a spell granted automatically ... is pushed into this array", mas nenhum código faz isso. O comentário é enganoso.
- **A11. A metade de aparição do Animist (espontânea, 2 truques + 1 de 1º círculo por dia) não tem entry.** O pack só tem a metade preparada. O schema e o relatório citam "a metade espontânea do Animist" como coberta. Liga com a T4.2, mas a onda declara "Destrava Animist".
- **A12. Witch de mundo existente com patrono escolhido antes do fix continua sem entry de conjuração** até alguém re-escolher o patrono. Não há backfill.

## O que está certo (conferido)
- Tetos de Bard, Oracle e Sorcerer: `slot.max` bate com o texto do Repertoire do pack.
- Slots de Bard, Cleric, Druid, Witch, Sorcerer, Oracle, Psychic, Magus e Animist (metade preparada) nos níveis 1-3.
- Fix do patrono da Witch (`chooseClassChoice`, `slotType === "patron"`): mecanismo genérico e correto.
- `syncSlotMaxOp` preserva `spellsKnown` no level-up.
- T2.4: aplica upgrade só quando ele sobe o rank, e não adivinha em multiclasse sem `classKey`.
