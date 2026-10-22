# O2 (Conjuração): julgamento da revisão adversarial

**Veredito: REPROVADA.** São 3 bloqueantes e o gate da onda não foi atingido: o Bard nível 3 não fica com foco 1 no world.db real.

Base verificada: satélite `37df631` (ficha3/o2), merge-base `2c07d20`, worktree `wt-o0-grants` e o world.db de `data-o2`, lido em modo somente leitura.

## Evidência viva
A evidência viva rodou: servidor isolado, Playwright e 6 prints. Dois checks falharam, e conferi os dois diretamente no `world.db`:
- `Bard_o2` tem só `occult Spells:false` e nenhuma entry isFocusPool.
- `Sorcerer_o2` tem `Focus Spells:true`.
- Nos 3 atores, `system.resources.focusPoints` = undefined, ou seja, nunca é persistido.

## Confirmados

| id | sev | achado | origem | dono | conserto |
|---|---|---|---|---|---|
| C1 | bloqueante | focusPoints.max derivado em `system.resources` é descartado: o servidor persiste e transmite só `system.derived` (derive.ts:109-120 grava só o `derivedPatch`). O teste da T2.5 roda o step isolado. | A4, B1×3, evidência viva #112 | satélite `systems/pf2e/src/derivations/build.ts:714` + `sheets/.../characterSheetVM.ts:920` | derivar em `system.derived.focusPoints` (ou `derived.focusMax`), fazer a VM/restAll ler de lá e cobrir com teste pelo `recomputeDerivedIfNeeded` do server |
| C2 | bloqueante | Bard criado pela UI fica sem entry isFocusPool. Causa provável: o caminho de escolha de classe por nível (planVM.ts ~5436-5459) cria a entry de conjuração sem `buildFocusEntryOp`. Só `applyClass` (3561) e a linhagem (4613) criam foco. | evidência viva #113 | satélite `sheets/.../planVM.ts:~5451` | extrair um helper que emita entry de conjuração + foco e usá-lo nos 3 caminhos; e2e: Bard pela UI com isFocusPool no db |
| C3 | bloqueante | Espontâneo não consegue adicionar truques. O Grimório com `openAddPicker` (único caminho para rank 0) foi para o `{:else}`, e o picker "known" filtra `!isCantrip`. Regressão contra `2c07d20`. | A1, B2×2 | satélite `SpellsTab.svelte:1009/1165` | botão "+ truque" na seção de truques do ramo espontâneo (picker rank 0) |
| C4 | importante | `restAll` não recupera `slot.value` de entry espontânea: dá `continue` sem `prepared[]`. | A3, I1×3 | satélite `characterSheetVM.ts:~2995` | para espontânea, emitir `system.slots.N.value = max` |
| C5 | importante | Teto do repertório = slot.max, errado para Bard (2+musa=3, teto 2) e Psychic (1+mente consciente=2, teto 1). Sorcerer e Oracle estão certos. A DEC-T2.1-01 propõe o sentido inverso e não virou issue. O teste :2276 afirma "book 2==2". | A7, I2×3, M1 costura | satélite `SpellsTab.svelte:518` + `characterSheetVM.ts` (DEC) | teto = slots + concedidas (musa/mente consciente) e issue com o conteúdo correto |
| C6 | importante | `hasFocusFeature` não detecta Hexes/Druidic Order/Arcane School/Psi Cantrips/Animist. Witch, Druid, Wizard, Animist e Psychic ficam com foco 0, contra o "Destrava" da O2. O teste da Witch "does NOT get a Focus Spells entry" trava o erro. | A5, I3×3 | satélite `planVM.ts:3676` + `planVM.test.ts:2629` | mapa explícito de feature→pool (Psychic 2) e inverter o teste |
| C7 | importante | Wizard sem slot e truque de currículo. O pack diz "one extra curriculum cantrip and one extra curriculum spell of each rank". O teste congela 2/3/3+2 como "(book)", circular (#48). | A6, I4×3 | satélite `planVM.ts` (slots) + `planVM.test.ts:2757/2776` | +1 slot por círculo e +1 truque quando a escola tiver currículo; expectativa tirada do texto do livro |
| C8 | importante | Metade de aparição do Animist inexistente: só há entry preparada. O docstring do schema e o "Destrava" dão como coberto. | A11, I6×2 | satélite `planVM.ts` (`buildSpellcastingEntryOp`) + `schema-primitives.ts:231` | criar entry espontânea de aparição ou registrar issue e tirar o Animist do "Destrava" |
| C9 | importante | Gate mecânico descumprido: o execucao.md exige teste de slots/conhecidas nv1-3 para as 10 conjuradoras, e só Bard/Wizard/Witch/Magus têm. C5-C8 caem nas classes sem teste. | I5 testes, I5 dado (parte Bard) | satélite `planVM.test.ts` | teste por classe, com expectativa do texto do livro |
| C10 | menor | Sem backfill de atores existentes: espontâneo pré-O2 com `prepared[]` fica com as magias invisíveis, e Witch com patrono antigo fica sem entry. Hoje o impacto é nulo (Tobias com 0 magias). | A2, M1, M3, I2 costura, A12 | satélite `characterSheetVM.ts:1511` / `planVM.ts:4503` | migração ou fallback de leitura de `prepared[]` → `spellsKnown` |
| C11 | menor | Picker "known" trava o círculo exato, sem versão elevada. | A8, M2, M1 testes, I7 | satélite `SpellPickerDialog.svelte:215` | em modo known, minRank=1 e maxRank=rank (agrupar pelo rank do slot) |
| C12 | menor | Signature Spells (nv3) não suportadas. | A9 | satélite `SpellsTab.svelte:765` | issue |
| C13 | menor | Magia concedida da linhagem não entra em `spellsKnown`, embora o comentário do schema diga que entra. Confirmado no world.db: Sorcerer só com a magia escolhida. | A10 | satélite `schema-primitives.ts:241` | empurrar a concedida ou corrigir o comentário + issue |

## Refutados (2)
- **Cleric sem Divine Font / "Cleric nv3" no gate** (M2 testes e a parte Cleric de I5 dado): o tasks.md diz "Cleric depende da onda 4", então está fora da O2.
- **UI sem prints nem smoke** (M2 costura): a O2 exige "print da aba de magias dos dois", e a evidência viva gerou 6 prints lidos. O smoke GM+player é o gate da onda de UI (tasks.md:168).
