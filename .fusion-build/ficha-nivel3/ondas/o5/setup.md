# Setup worktree — Onda 5 (Arquétipos padrão / Arquétipo Livre)

## O que foi feito

Worktree `wt-c` já existia, reaproveitada da onda 4 (`ficha3/o4`, merge do PR #120 no
submodule). Segui o caminho de reaproveitamento:

1. Core (`wt-c`): `git status --porcelain` limpo (só `?? tools/importer-pf2e/`, resíduo
   esperado — diretório não versionado no core). `git fetch origin` +
   `git checkout -B ficha3/o5 origin/alfa/app`.
2. Submodule (`wt-c/external/fusion-systems-2e`): estava com HEAD detached em `80740cc`
   (merge do PR #120), árvore de trabalho limpa. `git fetch origin` +
   `git checkout -B ficha3/o5 origin/main`.
3. `git submodule update --init external/fusion-systems-2e` no core: sem efeito (já
   inicializado), confirmei que o submodule continuou em `ficha3/o5` depois.
4. Junctions do vendor (leitura) conferidas — ambas com `pf2e/packs` e `sf2e/packs`
   presentes:
   - `wt-c/tools/importer-pf2e/vendor` → vendor da árvore principal.
   - `wt-c/external/fusion-systems-2e/tools/importer-pf2e/vendor` → idem.
5. `pnpm install`: lockfile já em dia, `Already up to date`, 923ms — não precisou
   `--no-frozen-lockfile`.
6. `pnpm build` (topológico): **sucesso, exit 0**, ~44s no `packages/client` (maior
   pacote); nenhum erro, só warnings normais de bundle size/a11y pré-existentes.

## Estado final

- Core: branch `ficha3/o5`, tracking `origin/alfa/app`.
- Submodule: branch `ficha3/o5`, tracking `origin/main`.
- Nenhum commit feito (setup puro). Nenhum `git add`.
- Árvore principal (`C:/Users/xansd/pessoal/fusion`) não foi tocada.

## Pendências para issue

Nenhuma.

## Decisões e porquês

- Segui o ramo "worktree reaproveitada" do prompt em vez de recriar do zero, pois `wt-c`
  já existia com histórico de onda anterior e estava limpa — `stash` não foi necessário
  por não haver sujeira.
