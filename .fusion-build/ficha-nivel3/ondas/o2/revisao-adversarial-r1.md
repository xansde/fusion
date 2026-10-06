# O2 (Conjuração): re-verificação adversarial, rodada 1

Alvo: satélite `37df631..31d80d0` (4 commits) + core `715e7116` (pin + teste de foco no caminho real).
Método: leitura do diff e do código ao redor, mais conferência contra os packs reais (`classes-core`, `class-features-core`, `spells-core`). Não editei nada e não rodei a suíte inteira.

## Veredito: REPROVADA. 1 bloqueante e 1 importante continuam abertos; 1 menor.

| id | estado | evidência |
|---|---|---|
| C1 | FECHADO | `stepCharFocusClamp` agora escreve `system.derived.focusPoints`; a VM lê de lá primeiro, com fallback. `recomputeDerivedIfNeeded` roda em doc:update/embedded create (derive.ts, doc-handlers.ts:885/1124/1607). O teste novo do core, em `derive-wiring.test.ts`, passa pelo handler de socket real e falharia sem o conserto (antes, `derived.focusPoints` não existia). `focusPoolSize` está no schema (passthrough), então `repertoireBonus` também sobrevive. |
| C2 | FECHADO (por leitura) | `chooseClassLevel` agora emite `buildFocusEntryOp` com o `classKey` gravado, só quando `shouldCreateItem` (não duplica). O fallback do Champion foi espelhado. Não há teste dedicado; o fixer registrou isso como pendência. |
| C3 | **ABERTO, bloqueante** | O botão existe, mas abre um picker **vazio**. `openKnownPicker(entry, 0)` passa `maxRank=0`, `minRank=0` e `rankFilter=0` para o `SpellPickerDialog`. No `spells-core/index.json` **não há nenhum** feitiço com `system.level` 0: os 69 truques têm nível ≥1 (63 no nível 1), com o traço `cantrip`; Daze, por exemplo, é `system.level: 1`. `filterSpellPicker` (`pickerSpellLevel > maxRank`) descarta todos. O espontâneo continua sem conseguir aprender truque. Problema correlato, anterior ao conserto: o picker de repertório no círculo 1 lista os 63 truques como magias de 1º círculo. |
| C4 | FECHADO (por leitura) | `restAll`: um slot com `spellsKnown` emite `system.slots.N.value = max` quando `value < max`. Sem teste novo. |
| C5 | **ABERTO, importante (parcial)** | Bard está certo (+1 no círculo 1, e o teste nv3 confere). O Psychic continua errado no nv3: o texto do pack em "Conscious Mind › Granted Spells" diz *"learning the 2nd-rank spell at 3rd level, the 3rd-rank spell at 5th level"*. O teto do círculo 2 no nv3 deveria ser 1+1=2, mas o código dá 1. A pendência nº 2 do fixer ("sem número concreto") está errada: o número está no próprio pack. Além disso, `repertoireBonus` só é gravado na criação; `levelSet` não o atualiza. |
| C6 | FECHADO | O mapa `NAMED_FOCUS_FEATURE_POOL_SIZE` confere com os nomes nv1 do pack (Hexes, Druidic Order, Arcane School, Psi Cantrips and Amps = 2, "Animist & Apparition Spellcasting"). O "2 Focus Points" do Psychic foi conferido no texto do pack. O teste da Witch foi invertido. `countFocusPoolEntries` soma `focusPoolSize`. |
| C7 | FECHADO | `applyCurriculumBonus` está aplicado na criação, em `chooseClassLevel` e em `levelSet`. Os testes do Wizard usam números literais (6 truques / 3 slots no nv1; 4/3 no nv3). O servidor só usa `spellSlotsForLevel` para achar o círculo mais alto, então nada sobrescreve. |
| C8 | ABERTO, menor | O docstring foi corrigido e o teste documenta a lacuna. Porém `docs/design/ficha-nivel3/tasks.md:89` (e `plano.md:176`) ainda listam o Animist em "Destrava" da O2, e não existe issue da metade de aparição no fusion-systems-2e (#110/#114/#115 tratam de outro assunto). |
| C9 | FECHADO | Há 10 testes novos (Sorcerer/Oracle/Psychic/Animist/Druid, nv1 e nv3) conferidos contra o texto: repertório do Oracle 3 = slots 3, Sorcerer 2+linhagem = 3. O Cleric foi excluído com base na decisão do tasks.md ("Cleric depende da onda 4"); aceito, porque é decisão de escopo que já está registrada. |

## Consertos pedidos

- **C3**: o picker de truque deve filtrar pelo traço `cantrip` (índice `system.traits.value`), e não por `system.level === 0`. Os pickers de círculo ≥1 devem excluir truques. Precisa de prova viva: um Bard/Sorcerer aprendendo um truque (tutorial-e2e) ou um teste do filtro sobre o índice real.
- **C5**: gravar o bônus do Psychic por círculo alcançado (+1 em todo círculo ≥1, ou seja, `{1:1, 2:1}` no nv3), recalculado no `levelSet`. Corrigir o teste "Psychic nv3" para esperar um teto de 2 no círculo 2, e retirar a pendência nº 2.
- **C8**: tirar o Animist de "Destrava" (tasks.md/plano.md) e abrir a issue no satélite.
