# Setup da worktree — Onda 2 (Conjuracao)

## O que foi feito

1. Worktree `wt-o0-grants` já existia (reaproveitada de onda anterior, já pushada). Segui o
   caminho de reaproveitamento em vez de criar do zero.
2. Checagem de sujeira: `git status --porcelain` no core mostrou apenas
   `M external/fusion-systems-2e` (ponteiro do submodule, esperado) e `?? tools/importer-pf2e/`
   (resíduo conhecido, sem rastreamento no core). No submodule, `git status --porcelain` veio
   vazio. Nada exigiu `git stash`.
3. Core: `git fetch origin` (trouxe `alfa/app` até `b0af1fe3`) e
   `git checkout -B ficha3/o2 origin/alfa/app` — branch nova criada a partir do remoto
   atualizado, tracking `origin/alfa/app`.
4. `git submodule update --init external/fusion-systems-2e` — sincronizado no commit
   `2c07d2094ce352c8fbaba5668b5f88a238d4cd2f` (trouxe também `origin/main` do satélite até
   `2c07d20`, novas tags v0.2.0/v0.2.1 e a branch `ficha3/o1` de outra onda).
5. Satélite: `git fetch origin` + `git checkout -B ficha3/o2 origin/main` — branch nova
   criada a partir do `main` remoto do satélite, tracking `origin/main`. `git status --porcelain`
   limpo.
6. Junctions do vendor (leitura, gitignoradas) confirmadas de pé, sem necessidade de recriar:
   - `wt-o0-grants/external/fusion-systems-2e/tools/importer-pf2e/vendor` → vendor da árvore
     principal.
   - `wt-o0-grants/tools/importer-pf2e/vendor` → mesmo alvo.
   Ambas com `pf2e/packs` e `sf2e` presentes dentro.
7. `pnpm install`: "Already up to date" (lockfile ok, sem `--no-frozen-lockfile`).
8. `pnpm build` (topológico, raiz da worktree): **sucesso, exit 0** (rodado duas vezes,
   segunda vez confirmando `EXIT=0` explicitamente). `packages/client` build finalizou
   normalmente (~20s), sem erros em nenhum pacote da cadeia.

## Estado final

- Core: branch `ficha3/o2`, tracking `origin/alfa/app`, HEAD em `b0af1fe3`.
- Satélite (`external/fusion-systems-2e`): branch `ficha3/o2`, tracking `origin/main`, HEAD em
  `2c07d20`.
- Nenhum commit ou push feito nesta tarefa (é setup mecânico).
- Suíte de testes **não** foi rodada, conforme instrução — baseline de referência é
  `scratchpad/ficha3-reports/o0/baseline.md`.

## Pendências para issue

Nenhuma pendência nova gerada por esta tarefa.
