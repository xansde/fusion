# Gate de integração — Onda 2 (Conjuração)

Worktree: `wt-o0-grants` (core branch `ficha3/o2`; satélite `external/fusion-systems-2e` branch
`ficha3/o2`). Baseline de referência: `ficha3-reports/o0/baseline.md` (T0.2, mesma árvore de
classes pós-Onda 0/1).

## 1. Pin e push (passo 1 do gate)

- Satélite `ficha3/o2` pushado, HEAD `37df631` (T2.1–T2.5: repertório espontâneo, picker
  "conhecidas", conjuração preparada, proficiência de conjuração, pool de foco).
- Core `ficha3/o2` pushado, HEAD `2a8013e3`, pin do submodule (`git ls-tree HEAD
  external/fusion-systems-2e`) = `37df631` — confere com o HEAD do satélite. Nenhum commit de
  pin adicional foi necessário (as 3 lanes já deixaram o pin correto).
- `git ls-remote --heads origin ficha3/o2` em ambos os repos confirma que o remoto já está no
  mesmo SHA do local — nada para pushar nesta tarefa de gate.

## 2. Comandos (passo 2) — todos rodados na raiz da worktree

| Comando | Exit | Baseline (T0.2) | Veredito |
|---|---|---|---|
| `pnpm build` | **0** | 0 | igual |
| `pnpm typecheck` | **0** | 0 | igual |
| `pnpm lint` | **0** (1 warning pré-existente, `pregen-parity.test.ts`) | — | igual ao já visto nas lanes O2 |
| `pnpm lint:boundaries` | **0** (0 violações, 5027 módulos/12113 deps cruzadas) | — | igual |
| `pnpm test` (suíte completa, `vitest run --workspace`) | **1** | 1 | ver detalhe abaixo — **sem regressão nova** |
| `pnpm format:check` | **0** | — | igual |
| `pnpm spec:report` | **0**, sem diff no working tree após rodar | — | igual (nada para commitar) |

Logs completos em `gate-build.log`, `gate-typecheck.log`, `gate-lint.log`,
`gate-lint-boundaries.log`, `gate-test.log`, `gate-format.log`, `gate-spec-report.log`
(este diretório).

### `pnpm test` — comparação item a item com o baseline

Baseline (T0.2): **3 arquivos falharam, 25 testes falharam** (8003 testes, 438 arquivos, 385s).
Onda 2 (gate): **2 arquivos falharam, 23 testes falharam** (8188 testes, 443 arquivos, 703.71s —
mais lento porque a suíte cresceu com os testes novos de T2.1–T2.5, não por regressão de
performance).

- `sheets-pf2e/.../actionCategories.test.ts` (1 teste) — **mesma falha, mesma mensagem** (2
  pastas de vendor sem grupo de display: `impossible-spells`, `naval-combat`).
- `sheets-pf2e/.../pregen-parity.test.ts` (22 testes) — **mesmos 22 testes, mesmos nomes**
  (chassis Alchemist/Gunslinger, HP Commander L3/L5, `CLASSES_WITHOUT_PREGEN` e os 17 testes de
  "never exceeds the skill increase ceiling" para as classes novas, incl. Runesmith/Necromancer)
  — comparação linha a linha contra `grep FAIL` do log de baseline confirma **string idêntica**
  em cada um dos 23 casos remanescentes.
- `client/.../traitNames.sync.test.ts` (2 testes no baseline) — **não aparece mais na lista de
  falhas**: passou a verde. Não é trabalho desta onda (dívida do i18n de classes, sanada em onda
  anterior/O1) — resultado é estritamente melhor que o baseline, não pior.
- 1 "Unhandled Error: [vitest-worker]: Timeout calling 'onTaskUpdate'" — mesma flakiness de
  infra documentada no `CLAUDE.md` e já presente no baseline; não é teste vermelho.

**Conclusão:** nenhuma falha nova, nenhuma falha em arquivo diferente dos 2 já conhecidos, e as
mensagens de cada teste remanescente são idênticas ao baseline. Nada a consertar — regra do
prompt ("falha nova = regressão") não se aplica aqui.

## 3. Commits e push (passo 3)

Nenhum commit novo foi necessário nesta tarefa de gate (nenhuma regressão para corrigir,
`spec:report` não gerou diff). As branches já estavam pushadas pelas 3 lanes (T2.1/T2.2, T2.3,
T2.4/T2.5) antes deste gate rodar; confirmado que `origin/ficha3/o2` (ambos os repos) já aponta
para os SHAs finais abaixo — não houve novo push nesta tarefa.

## 4. SHAs finais

| Repo | Branch | HEAD |
|---|---|---|
| `xansde/fusion` (core) | `ficha3/o2` | `2a8013e3dcbc66980821b5e2e119e7ac7a5105fa` |
| `xansde/fusion-systems-2e` (satélite) | `ficha3/o2` | `37df6313fbde4eae52756580d4070421045cddfd` |

Nenhuma operação em `main`/`master`/`beta/app`/`stable/app`, nenhum `--no-verify`, nenhum force
push, nenhuma branch deletada.

## Pendências para issue (já abertas pelas lanes, sem novas nesta tarefa de gate)

- `xansde/fusion-systems-2e#111` — focus points: `value` não enche para o novo `max` quando o
  pool é concedido pela primeira vez (T2.5).
- `xansde/fusion-systems-2e#59` — segue aberta, comentário adicionado pela lane T2.3 (Witch).

## Veredito

**PODE MERGEAR: SIM** (do ponto de vista deste gate — build/typecheck/lint/lint:boundaries/
format:check verdes, test sem regressão nova contra o baseline, spec:report sem diff). Decisão
de merge em si continua humana, fora do escopo desta tarefa.
