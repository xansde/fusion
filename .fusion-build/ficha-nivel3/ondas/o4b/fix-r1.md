# Fixer da Onda 4b — rodada 1

Consertados os 7 achados confirmados da revisão adversarial
(`revisao-adversarial.md`). TDD: cada achado corrigível por teste puro de
op-builder ganhou um teste que reproduziu o bug (vermelho pelo motivo certo,
confirmado rodando contra o `planVM.ts` do commit `497313a`, antes do
conserto) antes do código mudar. C2/C3a/C5 vivem em `PlanColumn.svelte`, que
este repo não monta em teste (`.svelte` não é montado no vitest — ver
`planColumn-variant-rules.test.ts`); cobertos por leitura de código +
verificação manual do fluxo de ops, e a metade testável em op-builder de C3
(C3b) tem teste próprio.

## Tabela achado → commit → teste

| achado | severidade | commit(s) | teste |
| --- | --- | --- | --- |
| C1 | bloqueante | satélite `675375c` | `apparitionSpellcasting.test.ts` (commit `5073cfd`): "C1: a fresh pick's OWN build.choices entry survives…" e "C1: removeChoice on an actor built BEFORE this lane…" |
| C2 | bloqueante (é a queixa do Alexandre) | satélite `b6ccce1` | Sem teste unitário (PlanColumn.svelte não é montado em vitest neste repo). Verificado por leitura: `materializeApparitionSpells` agora arma `pendingApparitionSpells` quando `apparitionRepertoireOps` ainda tem `doc:create` pendente, e um `$effect` que observa `doc` reconcilia sozinho (reenvia só o `doc:update` de `spellsKnown`, nunca o `doc:create` de novo) assim que o mirror do servidor chega — mesmo padrão do `pendingKnown` do `SpellsTab.svelte`. |
| C3 | bloqueante | satélite `675375c` (planVM.ts: `characterLevel`, `apparitionSpellcastingEntryOps` sync, bloco dedicado em `levelSet`) + `b6ccce1` (PlanColumn.svelte: `ctx.level` nos 2 pontos de chamada) | `apparitionSpellcasting.test.ts`: "level 3 also resolves the rank-2 spell (Knock)" (asserção nova de `slots["2"].max`) e "C3b: levelUp grows the 'Apparition Spells' entry…" |
| C4 | importante | satélite `675375c` | `apparitionSpellcasting.test.ts`: "C4: swapping between apparitions that share a Lore keeps the shared skill…" |
| C5 | importante | satélite `b6ccce1` + comentário na issue [fusion-systems-2e#115](https://github.com/xansde/fusion-systems-2e/issues/115#issuecomment-5768546412) | Sem teste unitário novo (canal `onGrantFailure` já teria cobertura própria se existisse; não escrevi mock de `GrantFailure` para não duplicar o padrão de `materializeAppliedGrants`). Verificado por leitura do código + medição real contra o pack (`Protector Tree`/`Blistering Invective` confirmados ausentes de `spells-core`, reportado na issue). |
| C6 | importante (processo/teste) | satélite `5073cfd` | O próprio commit é a correção: `docWithEntryAndApparitions` passa a chamar `chooseClassChoice(…, 1, …, characterLevel)` em vez de `chooseClassChoice(…, characterLevel, …)` — reproduz a forma real de chamada de `PlanColumn.svelte`. |
| C7 | importante (processo) | não corrigido em código — ver nota abaixo | — |
| C8 (menor, dedup de C1) | menor | satélite `675375c` (mesmo fix de C1: comparação por conjunto `(slot, skill)`) | `apparitionSpellcasting.test.ts`: "C8: the on-open heal … is a true no-op on an already-synced actor" |

## C7 — nota de processo (sem código correspondente)

O achado é sobre o **gate da própria onda** (`ficha3-reports/o4b/gate.md` aprovou "PODE
MERGEAR: SIM" com 3 ajustes obrigatórios da revisão de decisão em aberto) e sobre a
evidência viva (não produziu o print de aceite pedido). Isso vive nos artefatos de
orquestração desta rodada, não em nenhum dos dois repos (`xansde/fusion` /
`xansde/fusion-systems-2e`) — não há código para consertar aqui. Registro para quem
orquestrar a próxima onda: **o gate deveria reprovar automaticamente quando a revisão de
decisão tiver um ajuste obrigatório em aberto**, em vez de depender de checagem manual.
A evidência viva desta onda continua pendente (nenhum servidor/browser foi levantado
nesta rodada nem na original — só TDD no nível do op-builder).

## Commits

Satélite `xansde/fusion-systems-2e`, branch `ficha3/o4b` (push feito):

1. `675375c` — fix(pf2e): C1/C4/C8 (planVM.ts: `chooseClassChoice`, `chooseFeat`,
   `removeChoice`, `apparitionLoreSyncOps`, `apparitionAttunementSyncOps`,
   `apparitionSpellcastingEntryOps`, `levelSet`).
2. `b6ccce1` — fix(pf2e): C2/C3/C5 (PlanColumn.svelte).
3. `5073cfd` — test(pf2e): C1/C3/C4/C6/C8 (apparitionSpellcasting.test.ts).

Core `xansde/fusion`, branch `ficha3/o4b` (push feito):

4. `0f84874f` — fix(ficha-nivel3): repin do submodule + `tasks.md`/`execucao.md`.

## Verificação

| Comando | Resultado |
| --- | --- |
| `pnpm build` (core, topológico) | verde |
| `pnpm typecheck` (14 pacotes incl. o submodule) | verde, 0 erros, 24 warnings pré-existentes (mesmo número da lane original) |
| `pnpm lint` | verde, 0 erros, 1 warning pré-existente (`pregen-parity.test.ts`, arquivo não tocado) |
| `pnpm lint:boundaries` | verde (5037 módulos, 0 violações) |
| `pnpm format:check` | verde |
| `pnpm spec:report` | verde (`cobertura [MVP] com teste: 710`, piso mantido) |
| `vitest run apparitionSpellcasting.test.ts` | 18/18 verde (13 pré-existentes + 5 novos) |
| `vitest run planVM.test.ts` | 424/424 verde, sem regressão |
| `vitest run planColumn-variant-rules.test.ts` | 6/6 verde |
| `vitest run` (sheets-pf2e, suíte completa do pacote) | 1615/1638 verde; **23 falhas idênticas às PRÉ-EXISTENTES** (`pregen-parity.test.ts` 22 + `actionCategories.test.ts` 1) — confirmado rodando a suíte inteira com o fix aplicado e comparando contra o baseline do `T4.4-aparicoes.md` original (mesmos nomes de teste, mesma contagem) |

Não subi servidor/browser (fora do escopo desta rodada de fixer — TDD no nível do
op-builder, mesma limitação já registrada pela lane original). A prova "Vivo"/"Olhado"
continua pendente.

## Metodologia — como confirmei "vermelho pelo motivo certo"

Para C1/C3b/C4/C8 (e a correção de C6), rodei a suíte nova/reescrita **duas vezes**:
uma com `git stash` só do `planVM.ts` (voltando ao `497313a`, antes do fix), outra com
o fix restaurado. As 4 asserções relevantes falharam na primeira rodada com a mensagem
exata prevista pelo achado (ex.: C1 — "expected undefined to be defined" no
`apparitionChoice`; C3b — "expected 2 to be 1" no slot de rank 1 pós-levelUp; C8 —
`heal ops` não-vazio) e passaram na segunda. Para C4, a primeira tentativa de teste
passou incorretamente mesmo sem o fix — `.toBeDefined()` deixa passar `null` — corrigido
para `.not.toBeNull()`, e só então o teste reproduziu o bug (confirmado com um script de
debug isolado que imprimiu `system.skills` real sob o código antigo:
`lore-fortune-telling: null` após a troca).

## Pendências para issue

Nenhuma issue nova aberta. Uma correção registrada na já existente:

- **fusion-systems-2e#115** — comentário adicionado
  (https://github.com/xansde/fusion-systems-2e/issues/115#issuecomment-5768546412)
  apontando 2 nomes ausentes da lista original (`Protector Tree`, `Blistering
  Invective`), medidos contra o pack real no recorte 1-3 desta fatia. A issue
  continua ABERTA.

Pendências que já eram de outras lanes e continuam sem dono novo (não fabriquei issue
para nenhuma): reseleção da aparição primária, reescolha diária, #101, #110, #119 — como
já registrado em `T4.4-aparicoes.md`.
