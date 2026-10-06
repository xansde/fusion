# O2 (Conjuração) — Fixer, rodada 2

Worktree: `wt-o0-grants` (core branch `ficha3/o2`, satélite `external/fusion-systems-2e` branch `ficha3/o2`).
Ambos pushados (`gh auth switch -u xansde` antes).

- Satélite: `31d80d0`..`f3d810d` (2 commits), push `31d80d0..f3d810d`.
- Core: `715e7116`..`35ebbae8` (1 commit: repin), push `715e7116..35ebbae8`.

## Rodada anterior (r2 morta no meio, retomada)

`git status`/`git log` na worktree mostraram um arquivo de teste modificado e
não commitado: `characterSheetVM.test.ts` já tinha o bloco `describe("cantripOnly
(C3)", ...)` completo (4 testes + o teste sobre o índice real do pack) escrito
por uma sessão anterior que morreu antes de implementar o `cantripOnly` em si
(estava vermelho pelo motivo certo: `filterSpellPicker` ainda não conhecia
`cantripOnly`). Aproveitei esse trabalho integralmente — não descartei nada —
e implementei o conserto que faltava por cima dele.

## Tabela achado → commit → teste

| id | severidade | achado | commit(s) | teste que prova |
|---|---|---|---|---|
| C3 | bloqueante | Botão de truque do espontâneo abria picker vazio (filtrava `system.level 0`, mas nenhum truque do pack tem nível 0 — são ranked ≥1 e marcados pelo traço `cantrip`) | satélite `f3d810d` | `characterSheetVM.test.ts` — `describe("cantripOnly (C3)")`: 5 testes, incluindo um sobre o **índice real** de `spells-core/index.json` (69 truques, todos rank ≥1, zero em rank 0; filtro antigo `maxRank:0` → `[]`; filtro novo `cantripOnly:true` → os 69). Confirmado vermelho pelo motivo certo antes do fix (`git stash` do source, reroda, `expected undefined`-shape falhas). |
| C5 | importante | Teto de repertório do Psychic no círculo 2 (nv3) ficava 1 em vez de 2 — `Conscious Mind` (RAW no pack) dá +1 em TODO círculo alcançado, não só no 1º; `repertoireBonus` também nunca era re-sincronizado no `levelSet` | satélite `ce8e4ba` | `planVM.test.ts`: "Psychic nv3... rank2 max=1 (repertoire cap 2...)" (bônus `{2:1}`, não só `{1:1}`) + novo teste "Psychic levelSet 1 -> 3: repertoireBonus is re-synced to {1:1, 2:1}...". Confirmado vermelho pelo motivo certo via `git stash` do source antes de aplicar (`expected undefined to be 1`, depois `expected a repertoireBonus sync op`). |

## O que mudou (resumo técnico)

- **C3**: `filterSpellPicker` (characterSheetVM.ts) ganha `cantripOnly?: boolean`
  — filtra pelo traço `cantrip` em `system.traits.value`, nunca por rank.
  `SpellsTab.svelte` identifica o pedido de truque (`pickerMode==="known" &&
  pickerRank===0` — único caller que usa rank 0 nesse modo) e para de passar
  `maxRank=0`/`minRank=0`/`initialRank=0` nesse caso, passando `cantripOnly`
  ao `SpellPickerDialog` em vez disso. O picker de círculo ≥1 (rank exato)
  agora passa `cantripOnly=false`, excluindo truques (problema correlato
  citado na revisão: truques nível-1 apareciam como magias de 1º círculo).
  `SpellPickerDialog.svelte` some com os chips de rank quando `cantripOnly`
  é `true` (rank não é a dimensão de filtro certa para truque).
- **C5**: `repertoireBonusMap` (planVM.ts) passa a receber `slotsByRank` e
  aplicar um de dois modos por classe (`SPONTANEOUS_REPERTOIRE_BONUS_MODE`):
  `"rank1-only"` (Bard — +1 fixo, só rank 1) e `"every-rank"` (Psychic — +1
  em cada rank com slot > 0). `levelSet` agora emite um `doc:update` de
  `system.repertoireBonus` a cada troca de nível, só para classes com modo de
  bônus definido (evita op extra/write supérfluo para as demais 8 classes).
  Retirada a pendência nº 2 do `fix-r1.md` ("Psychic: sem número concreto
  para rank≥2") — o número está no próprio texto do pack
  (`class-features-core`, "Conscious Mind › Granted Spells").

## Gates da rodada (raiz do core)

Todos verdes:
- `pnpm build` — client+server+shared+system-api+systems 2e OK.
- `pnpm typecheck` — OK, 0 erros (svelte-check: 1611 arquivos, 0 erros, 24
  warnings pré-existentes em arquivos não tocados).
- `pnpm lint` — OK (1 warning pré-existente em `pregen-parity.test.ts`,
  mesmo arquivo já sinalizado no fix-r1).
- `pnpm lint:boundaries` — OK, 0 violações (5027 módulos).
- `pnpm format:check` — OK.
- `pnpm spec:report` — OK, cobertura MVP 710 (piso 710, sem regressão).

## Testes rodados (afetados, não a suíte completa)

- `sheets/pf2e` `characterSheetVM.test.ts` — **237 testes, 237 ok** (5 novos
  do C3, todos os outros continuam verdes).
- `sheets/pf2e` `planVM.test.ts` — **417 testes, 417 ok** (2 novos do C5:
  "Psychic nv3" ajustado + "Psychic levelSet 1 -> 3").
- `sheets/pf2e` `varredura-classes.test.ts` — **190 testes, 190 ok**
  (rodado junto por tocar o mesmo arquivo de VM/planVM indiretamente).
- Total do lote: **844/844 verde**.

## O que não foi testado (limite conhecido, não escondido)

- **C3**: mesma lacuna do fix-r1 — não existe infraestrutura de teste de
  componente Svelte no pacote. A prova é o teste sobre o índice REAL do
  pack (não circular — lê `spells-core/index.json` de verdade) + build +
  typecheck. Recomendo a skill `tutorial-e2e` numa rodada futura para
  fechar com prints reais (Bard/Sorcerer/Psychic aprendendo um truque).

## Pendências para issue

Nenhuma nova nesta rodada. A pendência nº 2 do `fix-r1.md` (Psychic
rank≥2) foi RESOLVIDA e retirada, não reaberta. As pendências nº 1, 3 e 4
do `fix-r1.md` (Animist metade espontânea; `chooseClassLevel` multiclasse
sem teste dedicado; `restAll` sem teste unitário dedicado) seguem de pé,
fora do escopo desta rodada (achados C8/C2/C4, não atribuídos a este
fixer). C8 (Animist fora de "Destrava" em tasks.md/plano.md + issue no
satélite) também não foi atribuído a esta rodada — só C3 e C5 estavam na
lista de achados confirmados.

## Arquivos tocados

Satélite (`external/fusion-systems-2e`):
- `sheets/pf2e/src/lib/sheets/pf2e/characterSheetVM.ts`
- `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts`
- `sheets/pf2e/src/components/sheets/pf2e/SpellsTab.svelte`
- `sheets/pf2e/src/components/sheets/pf2e/SpellPickerDialog.svelte`
- `sheets/pf2e/src/lib/sheets/pf2e/__tests__/characterSheetVM.test.ts`
- `sheets/pf2e/src/lib/sheets/pf2e/__tests__/planVM.test.ts`

Core:
- `external/fusion-systems-2e` (pin)
