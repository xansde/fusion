# Setup da worktree — Onda 1 (ficha3/o1)

## O que foi feito

1. Worktree `wt-o0` **já existia** (reaproveitada da Onda 0, branch anterior `ficha3/onda0`,
   já pushada). Não recriei do zero.
2. `git status --porcelain` no core: só `?? tools/importer-pf2e/` (o diretório residual só
   com dado, sem código — esperado, não é sujeira de sessão anterior). Nada a dar stash.
3. `git status --porcelain` no submodule: limpo.
4. `git fetch origin` no core → trouxe `origin/alfa/app` atualizado (`5e208936` → `dd01d01e`).
5. `git checkout -B ficha3/o1 origin/alfa/app` — branch nova `ficha3/o1` recriada sobre o
   `alfa/app` mais recente (HEAD `dd01d01e`), substituindo `ficha3/onda0` como branch corrente
   (a antiga já estava pushada como `origin/ficha3/onda0`, então nada se perdeu).
6. `git submodule update --init external/fusion-systems-2e` — sem output (submodule já estava
   inicializado da Onda 0, checkout ficou intacto).
7. No submodule: `git fetch origin` + `git checkout -B ficha3/o1 origin/main` — branch nova
   `ficha3/o1` sobre `origin/main` do satélite.
8. Junctions do vendor conferidas (ambas já existiam da Onda 0, sobreviveram ao troca de
   branch por serem apenas symlinks/junctions fora do controle do git):
   - `wt-o0/external/fusion-systems-2e/tools/importer-pf2e/vendor` → vendor da árvore principal
   - `wt-o0/tools/importer-pf2e/vendor` → mesmo alvo (necessária para `pregen-parity.test.ts`)
   - `pf2e/packs` presente em ambas.
9. `docs/design/ficha-nivel3/{plano.md,tasks.md,execucao.md,gate-runbook.md}` já presentes na
   worktree — vieram do merge em `alfa/app` (não precisou copiar manualmente como na Onda 0).
10. `pnpm install`: "Already up to date", 565ms — lockfile em dia, sem `--no-frozen-lockfile`.
11. `pnpm build` (topológico, raiz): **sucesso, exit 0**, ~29s reais. Todos os pacotes
    buildaram, incluindo `packages/client` (Vite, sem erros — só os warnings pré-existentes
    de bundle size / a11y, não bloqueantes).

## Estado final

- Core: `xansde/fusion`, branch `ficha3/o1`, HEAD em `origin/alfa/app` (`dd01d01e`), sem
  commits próprios ainda (setup puro, nada commitado nesta tarefa).
- Satélite: `external/fusion-systems-2e`, branch `ficha3/o1`, HEAD em `origin/main`.
- Worktree pronta para as tarefas de implementação da Onda 1 (cabear escolhas de classe
  restantes + fólio do Commander + idiomas), conforme `docs/design/ficha-nivel3/{plano.md,tasks.md}`.

## Pendências para issue

Nenhuma pendência bloqueante. Nenhum problema encontrado no setup.

## Verificação

- `pnpm install`: "Already up to date", sem erro.
- `pnpm build`: log sem "error"/"ERROR"/"Failed"; último pacote (`packages/client`) terminou
  com `✓ built in 16.64s` + `Done`; `real 0m29.330s`.
- `git status --porcelain` checado no core e no submodule antes de qualquer checkout.
- Branches confirmadas com `git branch --show-current` em ambas as árvores: `ficha3/o1`.
