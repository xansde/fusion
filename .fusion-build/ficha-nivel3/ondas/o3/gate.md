# Gate de integração — Onda 3 (Ator companheiro: eidolon e familiar)

Worktree: `wt-o0`, core branch `ficha3/o3` (sha `d6bc3ec4`), submodule `external/fusion-systems-2e`
branch `ficha3/o3` (sha `2f1d895`). Pin do core já apontava para o HEAD do submodule desde o
início do gate — nenhum commit de pin novo foi necessário.

## Comandos e resultados

| Comando | Resultado | Comparação com baseline (o0) |
|---|---|---|
| `pnpm build` | exit 0 | build limpo, sem regressão |
| `pnpm typecheck` | exit 0 | baseline também 0 |
| `pnpm lint` | exit 0 | não coberto pelo baseline (baseline só tinha typecheck+test); verde |
| `pnpm lint:boundaries` | exit 0 | idem, verde |
| `pnpm format:check` | exit 0 | idem, verde |
| `pnpm test` (suíte completa) | exit 1 — **6 arquivos falharam, 26 testes falharam** de 8253 (442 passaram/448) | baseline: 3 arquivos, 25 testes falharam, de 8003 (8253 é maior pois a Onda 3 acrescentou testes) |
| `pnpm spec:report` | exit 0, `cobertura [MVP] com teste: 719 (piso 719)` | igual ao número reportado pela lane T3.2 — nada para commitar |

## Diff de falhas frente ao baseline — nenhuma é regressão desta onda

- **`traitNames.sync.test.ts`** (2 testes no baseline) — **não falha mais** nesta rodada (corrigido
  por outra frente, fora do escopo desta onda).
- **`actionCategories.test.ts`** (1 teste) — mesma falha do baseline, mesma causa (vendor
  `impossible-spells`/`naval-combat` sem display group).
- **`pregen-parity.test.ts`** — 20 testes falharam nesta rodada vs. 22 no baseline (2 a menos,
  não é regressão). Mesma causa documentada no baseline (dado de classe incompleto/pregens
  ausentes para Necromancer/Runesmith).
- **4 arquivos "novos" na lista de falhas, nenhum tocado pela Onda 3** (confirmado por
  `git log --name-only origin/alfa/app..HEAD` sobre os paths abaixo — lista vazia):
  - `packages/server/src/update/__tests__/boot-nonblocking.test.ts`
  - `packages/server/src/__tests__/cli/serve-tunnel-guard.test.ts`
  - `packages/client/src/lib/__tests__/socket.test.ts`
  - `tools/spec-lint/src/__tests__/spec-lint.test.ts` (timeout de 5000ms na suíte cheia)

  **Verificação feita**: fiz checkout detached para `origin/alfa/app` (ponto de partida da Onda 3,
  sha `c9be8544`, sem nenhum commit desta fatia), rodei os mesmos 3 arquivos de
  server/client isolados — **falharam igual ou pior (6 testes, 3 arquivos)**, provando que é
  flakiness de timing/IO pré-existente no worktree (mesma classe do "Timeout calling
  onTaskUpdate" documentado no CLAUDE.md), não regressão da Onda 3. Restaurei a branch
  `ficha3/o3` e o submodule (`git checkout ficha3/o3` + `git submodule update --init`) logo em
  seguida — sha final confere com o commit original (`d6bc3ec4` / `2f1d895`).
  `spec-lint.test.ts` rodado isolado passa 21/21 em 11.5s (o teste do metamodelo sozinho leva
  1.6s, bem abaixo do timeout de 5s) — confirma que é timeout por carga da suíte cheia, não
  problema na spec.

## Conclusão

Nenhuma falha nova é regressão da Onda 3. Nada precisou de conserto no repo. `pnpm spec:report`
não gerou diff para commitar (piso já em 719, igual ao reportado pela lane T3.2).

## Push

Ambas as branches (`ficha3/o3` no core e no submodule) já estavam pushed e atualizadas com
`origin` antes e depois do gate — nenhum novo commit foi criado por este gate.

## SHAs finais

- Core `ficha3/o3`: `d6bc3ec4ba54e1341998a7b3395a026ed58d00de`
- Submodule `ficha3/o3`: `2f1d8952f2f0907dda54f6df4d9304126f7e7b0d`
- Pin do core → submodule: confere (sem diff)

## Pendências para issue

Nenhuma nova. As pendências já abertas pelas lanes T3.1/T3.2/T3.3 (xansde/fusion#236, #237,
#238, mais as issues de mecânica própria do eidolon da T3.1) seguem como estavam — este gate
não abriu nem fechou issues.
