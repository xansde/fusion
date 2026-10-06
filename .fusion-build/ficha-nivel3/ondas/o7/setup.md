# Setup da worktree — Onda 7 (Aceite não-circular)

## Situação encontrada

A worktree `wt-c` já existia (reaproveitada de uma onda anterior — estava em `ficha3/o5`).
Não houve necessidade de `git worktree add`.

## Passos executados

1. `git status --porcelain` no core: só `?? tools/importer-pf2e/` (resíduo esperado, dado —
   não é sujeira de trabalho em progresso; nada para stash).
2. `git status --porcelain` no submodule: limpo.
3. `git fetch origin` no core → trouxe `alfa/app` atualizado (`d9bae081..a9c35fc2`).
4. `git checkout -B ficha3/o7 origin/alfa/app` no core — branch recriada a partir do remoto
   atualizado (substituiu `ficha3/o5`).
5. `git submodule update --init external/fusion-systems-2e` — trouxe atualizações do satélite
   (novas tags v0.2.8/v0.2.9, branches novas).
6. No satélite: `git fetch origin` + `git checkout -B ficha3/o7 origin/main`.
7. Confirmadas as junctions: `external/fusion-systems-2e/tools/importer-pf2e/vendor` →
   `C:\Users\xansd\pessoal\fusion\tools\importer-pf2e\vendor` (symlink presente e íntegro).
8. Checado que não havia `pnpm install` concorrente rodando na máquina (só processos bash/
   powershell da própria sessão).
9. `pnpm install` — `Already up to date` (nenhuma dependência nova, lockfile aceito sem flags).
10. `pnpm build` (rodado duas vezes para confirmar) — **exit 0**, build completo de todos os
    pacotes do workspace incluindo `packages/client`.

## Estado final

- Core: branch `ficha3/o7`, base `origin/alfa/app` (a9c35fc2).
- Satélite (`external/fusion-systems-2e`): branch `ficha3/o7`, base `origin/main` (b5990b9).
- Build verde. Nenhum teste rodado (conforme instrução — suíte não faz parte do setup).
- Nenhuma dependência nova instalada. Nenhuma pendência a registrar como issue.

## Próximo passo

Ler `docs/design/ficha-nivel3/{plano.md,tasks.md,execucao.md}` na worktree e seguir com o
trabalho da Onda 7 (aceite não-circular: molde, comparador, roteiro e2e).
