# Onda 1 — T1-commander-idiomas (T1.7, T1.8) — relatório

## Achado: tarefas já implementadas por outra lane, mesma worktree/branch

Ao abrir a worktree `wt-o0` (branch core `ficha3/o1`, satélite `ficha3/o1`), o histórico já
tinha as duas tarefas desta lane concluídas e commitadas pela lane **T1-escolhas**, que — por
decisão documentada no próprio relatório dela (`ficha3-reports/o1/T1-escolhas.md`) — absorveu
T1.1-T1.8 inteiras num diff só, já que `tasks.md` lista T1.7/T1.8 dentro da mesma Onda 1 de lane
única e elas tocam os mesmos símbolos (`CLASS_CHOICE_SLOT_OPTIONS`, `planVM.ts`).

Não havia mais nada de código para escrever nesta lane. Verifiquei o resultado em vez de
reimplementar:

- **T1.7 (fólio do Commander)**: slot `tacticKnown` (count=5) cabeado em
  `CLASS_CHOICE_SLOT_OPTIONS`/`CLASS_CHOICE_SLOTS` (`planVM.ts`), opções vindas de
  `actions-core` filtradas pelo trait `tactic` (novo `traitFilter`, alternativa a `category`).
  Drill diário (3-de-5) fora de escopo, registrado como issue.
- **T1.8 (idiomas)**: novo `DeriveStep` `stepCharLanguages` deriva `system.derived.languages` a
  partir de `system.languages.value` do item de ancestralidade embutido, exibido na aba
  principal da ficha ao lado de "Sentidos"; label "Idiomas" traduzido (commit `51696f79`).
  Picker de idiomas bônus por Inteligência (`additionalLanguages`) fora de escopo, registrado
  como issue — não cabe no mecanismo `CLASS_CHOICE_SLOT_OPTIONS` (lista de strings do próprio
  item, não documentos de pack) e exigiria diálogo novo.

Commits já existentes na branch (satélite `1a90ad0`, `ad991ba`; core `d12d0687`, `fe96580d`,
`51696f79`) — todos já pushed para `origin/ficha3/o1` (core e satélite), confirmado por
`git log origin/ficha3/o1..HEAD` vazio nos dois repos.

## Verificação que rodei

`pnpm --filter @fusion/sheets-pf2e exec vitest run src/lib/sheets/pf2e/__tests__/ficha-nivel3-onda1.test.ts`
→ **69/69 verdes**. É o teste que prova o gate da onda 1 (as 28 entradas de
`CLASS_CHOICE_SLOT_OPTIONS`, incluindo `tacticKnown`, com opções reais e persistência no ator).

`git status --short` na worktree e no submodule: só `tools/importer-pf2e/` untracked (resíduo
conhecido, só dado, fora do escopo). Nenhuma mudança pendente de commit.

## Pendências (já registradas como issue pela lane T1-escolhas, não duplicadas aqui)

1. `xansde/fusion-systems-2e#101` — dedup entre slots-irmãos (Ikon/Apparition).
2. `xansde/fusion-systems-2e#102` — picker de idiomas bônus por Inteligência (resto de T1.8).
3. `xansde/fusion-systems-2e#103` — drill diário do Commander (resto de T1.7).

## Resumo (contrato de retorno)

Status: **OK**. T1.7 e T1.8 já estavam implementadas e commitadas pela lane T1-escolhas (mesma
onda, mesma worktree) antes desta lane começar — trabalho duplicado no plano de fan-out, não
código faltando. Zero commits novos desta lane (nada a fazer sem re-fazer o que já existe).
Verifiquei com o teste do gate da onda (69/69 verde) e `git log` contra o remoto: ambos os repos
(core + satélite) já em `ficha3/o1` pushed, sem divergência. Nenhum bloqueio.
