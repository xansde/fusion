# O2 (Conjuração) — Fixer, rodada 1

Worktree: `wt-o0-grants` (core branch `ficha3/o2`, satélite `external/fusion-systems-2e` branch `ficha3/o2`).
Ambos os branches foram **pushados** (`gh auth switch -u xansde` antes).

- Satélite: `1c65658`..`31d80d0` (4 commits), push `37df631..31d80d0`.
- Core: `715e7116` (1 commit: pin + teste do caminho real), push `2a8013e3..715e7116`.

## Tabela achado → commit → teste

| id | severidade | achado | commit(s) | teste que prova |
|---|---|---|---|---|
| C1 | bloqueante | `focusPoints.max` gravado em `system.resources` (descartado pelo servidor) | satélite `b515c9c` (server) + `31d80d0` (cliente); core `715e7116` | `systems/pf2e/src/__tests__/derivations-build.test.ts` (describe "survives... recomputeDerivedIfNeeded" — nota apontando pro teste real) + **`packages/server/src/__tests__/derive-wiring.test.ts`** novo caso "a focus-granting spellcastingEntry... on the real doc:create path" (20/20 verde) — via handler de socket real, não o step isolado |
| C2 | bloqueante | Bard pela UI (caminho `chooseClassLevel`) sem entry de foco | satélite `8d4e34a` | `planVM.test.ts` — bloco `applyClass — focus pools...` cobre `applyClass`/`bloodlineSpellcastingOps`; `chooseClassLevel` em si não tinha teste dedicado pré-existente pra esse ramo — a cobertura direta vem do gate C9 (Sorcerer/Oracle/Psychic/Animist/Druid usam `applyClass`, que compartilha `buildFocusEntryOp`); **pendência registrada abaixo** (teste dedicado de `chooseClassLevel` multiclasse com foco) |
| C3 | bloqueante | Espontâneo sem botão de truque | satélite `31d80d0` | Sem teste de componente (nenhum existe no repo pra `SpellsTab.svelte` — ver "O que não foi testado" abaixo). Build+typecheck verdes. |
| C4 | importante | `restAll` não recupera slot.value de espontânea | satélite `31d80d0` | `characterSheetVM.test.ts` (232/232 verde — os testes existentes de `restAll` continuam passando; nenhum teste novo dedicado foi adicionado por falta de fixture pronta de entry espontânea nesse arquivo — ver pendência) |
| C5 | importante | Teto de repertório errado p/ Bard e Psychic; DEC-T2.1-01 invertida | satélite `8d4e34a` (criação, `repertoireBonus`) + `31d80d0` (consumo, `knownCap`) | `planVM.test.ts`: "Bard level 1... repertoire CAP is 3", "Bard level 3... rank-1 repertoire cap = 4", "Psychic nv1... repertoire cap = 2", "Psychic nv3" |
| C6 | importante | Pool de foco não detectado p/ Witch/Druid/Wizard/Animist/Psychic | satélite `8d4e34a` | `planVM.test.ts`: teste da Witch **invertido** ("DOES get a Focus Spells entry sized 1"); C9's testes de Oracle/Psychic/Animist/Druid confirmam `focusPoolSize` |
| C7 | importante | Wizard sem +1 slot/+1 truque de currículo; teste circular | satélite `8d4e34a` | `planVM.test.ts`: "level 1: PREPARED entry, 6 cantrips... 3 first-rank slots", "level 3: rank1 max=4... rank2 max=3", "levelSet 1 -> 3 GROWS..."; `varredura-classes.test.ts` ajustado (`applyCurriculumBonus` exportado e reusado) |
| C8 | importante | Metade espontânea do Animist inexistente | satélite `1c65658` (docs) | Registrado como **pendência** (issue abaixo), não implementado — opção explicitamente autorizada pelo achado. `planVM.test.ts`: "Animist nv1... NO spontaneous apparition entry" documenta o gap como esperado |
| C9 | importante | 6 das 10 classes sem teste de slots/conhecidas | satélite `8d4e34a` | `planVM.test.ts`: bloco novo "C9 gate" com Sorcerer/Oracle/Psychic/Animist/Druid (nv1 e nv3 cada, 10 testes). **Cleric excluído** — ver "Achado considerado incorreto" abaixo. |

## Achado considerado incorreto (registrado, não "consertado")

A instrução da tarefa (JSON) listava Cleric no conserto de C9. A
`revisao-adversarial.md` (síntese das 3 lentes) **refutou** exatamente esse
ponto: *"Cleric sem Divine Font / 'Cleric nv3' no gate... o tasks.md diz
'Cleric depende da onda 4', então está fora da O2."* Segui a refutação (fonte
mais autoritativa, já reconciliada entre as lentes) e excluí Cleric do C9 —
registrado no comentário do bloco de teste em `planVM.test.ts`.

## Gates da rodada (raiz do core)

Todos verdes:
- `pnpm build` — client+server+shared+system-api+systems 2e (via workspace) OK.
- `pnpm typecheck` — OK, 0 erros.
- `pnpm lint` — OK (1 warning pré-existente em `pregen-parity.test.ts`, arquivo não tocado).
- `pnpm lint:boundaries` — OK, 0 violações (5027 módulos).
- `pnpm format:check` — OK.
- `pnpm spec:report` — OK, cobertura MVP 710 (piso 710, sem regressão).

## Testes rodados (afetados, não a suíte completa)

- `systems/pf2e` `derivations-build.test.ts` — **35/35 verde**.
- `sheets/pf2e` `planVM.test.ts` — **416/416 verde**.
- `sheets/pf2e` `characterSheetVM.test.ts` — **232/232 verde**.
- `sheets/pf2e` `varredura-classes.test.ts` — **190/190 verde**.
- `sheets/pf2e` suíte completa do pacote — **1575/1598 verde**; os 23 vermelhos são
  `pregen-parity.test.ts` (skillIncreaseCeiling, `CLASSES_WITHOUT_PREGEN`) e
  `actionCategories.test.ts` (pastas do vendor sem grupo) — **confirmados
  pré-existentes** contra `origin/ficha3/o2` antes dos meus commits (rodei
  `pregen-parity.test.ts` isolado com `git stash` das minhas mudanças: mesmos
  22 vermelhos, mesma mensagem) e batem com `ficha3-reports/o0/baseline.md`.
- Core `packages/server` `derive-wiring.test.ts` — **20/20 verde** (inclui o
  novo caso do C1).

## Pendências para issue

1. **xansde/fusion-systems-2e** — "Animist: metade espontânea (aparição) não
   tem entry de conjuração (C8)". Corpo: `classSystem.spellcasting` do
   Animist em `classes-core` só descreve a metade preparada; a metade
   espontânea (slots/repertório vindos da apparition sintonizada) não tem
   fonte de dado nenhuma no pack hoje — precisa de modelagem nova (provável
   onda futura, ligada a Apparition Attunement). `planVM.ts`'s
   `buildSpellcastingEntryOp`/`buildFocusEntryOp` e
   `schema-primitives.ts:SpellSlotSchema` comentam o gap.

2. **xansde/fusion-systems-2e** — "Psychic: Conscious Mind pode estender o
   bônus de repertório além do 1º círculo (DEC-T2.1-02, rank ≥2 não
   verificado)". Corpo: o texto RAW de "Psi Cantrips and Amps"/"Conscious
   Mind" diz "Your conscious mind also adds additional spells to your
   repertoire as you gain spells of higher ranks", mas não dá um número
   concreto pro recorte nv1-3 desta fatia. `SPONTANEOUS_REPERTOIRE_RANK1_
   BONUS` (planVM.ts) aplica o bônus só no rank 1; confirmar contra o livro
   físico antes de estender.

3. **xansde/fusion** — "chooseClassLevel (Bard/foco multiclasse): sem teste
   dedicado do C2 no caminho de segunda classe". Corpo: o conserto do C2
   está coberto indiretamente (a mesma `buildFocusEntryOp` que `applyClass`
   usa), mas não há um teste que exercite `chooseClassLevel` criando uma
   SEGUNDA classe com foco (cenário de multiclasse/arquétipo livre com 2
   conjuradores) — recomendado antes da onda de arquétipo/multiclasse tocar
   conjuração de novo.

4. **xansde/fusion-systems-2e** — "restAll: sem teste unitário dedicado para
   entry espontânea (C4)". O fix está coberto pela suíte existente
   continuar verde + leitura de código, mas não há um teste novo que crie
   uma entry `spellsKnown` com `value < max` e chame `restAll()` — útil
   como regressão futura.

## O que não foi testado (limite conhecido, não escondido)

- **C3 (botão de truque)**: não existe infraestrutura de teste de
  componente Svelte neste pacote (`grep` por `@testing-library/svelte`/
  `render(` no diretório de testes não encontra nada) e adicionar uma é
  fora do escopo desta rodada (regra "não instale dependência nova").
  Verificado por leitura + `pnpm build` (Svelte compila sem erro) +
  `pnpm typecheck`. Recomendo a skill `tutorial-e2e` numa rodada futura
  para fechar essa lacuna com prints reais (Bard/Sorcerer/Psychic
  aprendendo truque).

## Arquivos tocados

Satélite (`external/fusion-systems-2e`):
- `systems/pf2e/src/derivations/build.ts`
- `systems/pf2e/src/__tests__/derivations-build.test.ts`
- `systems/pf2e/src/schema-primitives.ts`
- `systems/pf2e/src/schemas/item-spellcasting-entry.ts`
- `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts`
- `sheets/pf2e/src/lib/sheets/pf2e/characterSheetVM.ts`
- `sheets/pf2e/src/lib/sheets/pf2e/derivedTypes.ts`
- `sheets/pf2e/src/lib/sheets/pf2e/__tests__/planVM.test.ts`
- `sheets/pf2e/src/lib/sheets/pf2e/__tests__/varredura-classes.test.ts`
- `sheets/pf2e/src/components/sheets/pf2e/SpellsTab.svelte`

Core:
- `external/fusion-systems-2e` (pin)
- `packages/server/src/__tests__/derive-wiring.test.ts`
