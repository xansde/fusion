# Setup Onda 4 (ficha3/o4) — relatório

## Passos executados

1. Worktree `wt-c` NÃO existia (primeira vez para esta onda). Rodei o fluxo de criação:
   - `cd C:/Users/xansd/pessoal/fusion; git fetch origin` (sem output relevante, silencioso).
   - `git worktree add -b ficha3/o4 <wt-c> origin/alfa/app` — sucesso. HEAD em `b0af1fe3`
     (Merge pull request #232 from xansde/ficha3/o1). Branch `ficha3/o4` rastreando
     `origin/alfa/app`.
2. Submodule: `git submodule update --init external/fusion-systems-2e` — clonou e fez
   checkout em `2c07d209` (detached, mesmo commit pinado no core).
3. Submodule estava raso (`git rev-parse --is-shallow-repository` = true). Configurei
   `remote.origin.fetch` completo, rodei `git fetch origin` (trouxe todas as branches/tags)
   e depois `git fetch --unshallow origin` para garantir histórico completo.
4. `git checkout -b ficha3/o4 origin/main` no submodule — sucesso, branch rastreando
   `origin/main`.
5. Junctions do vendor Foundry (somente leitura, conforme `setup-ficha3_o0-grants.md`):
   - `<wt-c>/external/fusion-systems-2e/tools/importer-pf2e/vendor` → `C:/Users/xansd/pessoal/fusion/tools/importer-pf2e/vendor`
   - `<wt-c>/tools/importer-pf2e/vendor` → mesmo alvo (necessária por causa do
     `pregen-parity.test.ts`, que resolve `ICONICS_ROOT` subindo 8 níveis até a raiz do
     core — mesma lição registrada pela Onda 0).
   - Ambas verificadas: `pf2e/packs` presente dentro das duas (via `ls`).
6. `pnpm install` na raiz do `wt-c`: lockfile já estava OK, `frozen-lockfile` funcionou de
   primeira (não precisou `--no-frozen-lockfile`). 484 pacotes, ~16s.
7. `pnpm build` (topológico): **sucesso, exit 0** (rodei duas vezes para confirmar o
   exit code; ~18–?s, client buildou 2301 módulos Vite/Svelte/PIXI sem erros bloqueantes).

## Estado final

- Core (`wt-c`): branch `ficha3/o4`, HEAD `b0af1fe3` (= `origin/alfa/app` no momento do
  fetch), sem commits novos — setup puro, nenhum `git add`/commit.
- Submodule (`wt-c/external/fusion-systems-2e`): branch `ficha3/o4`, HEAD `2c07d209`
  (= `origin/main` no momento do fetch), sem commits novos.
- Junctions do vendor criadas e verificadas nos dois pontos exigidos.
- `pnpm install` e `pnpm build` verdes. Suíte de testes **não** foi rodada (conforme
  instrução — referência de baseline fica em `ficha3-reports/o0/baseline.md`).
- Árvore principal (`C:\Users\xansd\pessoal\fusion`) não foi tocada além do
  `git fetch origin` (somente leitura).

## Pendências para issue

Nenhuma pendência identificada nesta tarefa de setup.
