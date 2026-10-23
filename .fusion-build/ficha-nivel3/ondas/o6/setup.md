# Setup da worktree da Onda 6 (ficha3/o6)

## Situação encontrada

A worktree `wt-o0` já existia — reaproveitada de uma execução anterior (Onda 1, branch
`ficha3/o1`). Estava com um diretório sujo: `tools/importer-pf2e/` (untracked, residual de
onda anterior).

## Passos executados

1. `git status --porcelain` no core: mostrou `tools/importer-pf2e/` untracked.
2. `git stash push -u -m "ficha3: sobra antes da o6"` no core — sobra preservada, não
   descartada (o stash guarda inclusive `tools/importer-pf2e/vendor/pf2e/`, que era a
   junction anterior).
3. `git fetch origin` no core.
4. `git checkout -B ficha3/o6 origin/alfa/app` — branch nova criada a partir do remoto
   atualizado, tracking `origin/alfa/app`.
5. `git submodule update --init external/fusion-systems-2e` — submódulo inicializado/
   atualizado.
6. No submódulo (`external/fusion-systems-2e`): estava limpo (sem sobra). `git fetch
   origin` + `git checkout -B ficha3/o6 origin/main` — branch nova criada, tracking
   `origin/main`.
7. Junction do vendor recriada via PowerShell (a anterior tinha ido para o stash junto
   com o diretório `tools/importer-pf2e/`):
   `New-Item -ItemType Junction` em
   `wt-o0/tools/importer-pf2e/vendor` → `C:\Users\xansd\pessoal\fusion\tools\importer-pf2e\vendor`.
   Confirmado `LinkType: Junction`. A junction dentro do submódulo
   (`external/fusion-systems-2e/tools/importer-pf2e/vendor`) já veio íntegra do
   `submodule update` (não foi tocada pelo stash, pois vive dentro do submódulo).
8. `pnpm install`: sem mudanças, lockfile íntegro (`Already up to date`, 760ms).
9. `pnpm build`: **sucesso, exit 0** — todos os pacotes do monorepo (shared, system-api,
   server, client) compilaram, incluindo o build do `packages/client` (bundle Vite
   completo, sem erros).
10. Suite de testes: **NÃO rodada**, conforme instrução (referência de baseline é
    `ficha3-reports/o0/baseline.md`; CI de `alfa/app` é o baseline vivo).

## Estado final

- Core: worktree em `ficha3/o6`, tracking `origin/alfa/app`, limpo (stash da sobra
  anterior preservado com `git stash list`).
- Satélite (`external/fusion-systems-2e`): branch `ficha3/o6`, tracking `origin/main`,
  limpo.
- Junctions do vendor (leitura) recriadas e funcionais nos dois pontos usados pelos
  testes (core root e dentro do submódulo).
- Build verde.

## Pendências / observações

- Nenhuma pendência de código. Único ponto de atenção operacional: como a worktree é
  reaproveitada entre ondas, a próxima onda que reusar `wt-o0` deve rodar o mesmo
  procedimento de `git stash` antes de trocar de branch, e recriar a junction do vendor
  na raiz do core se ela tiver ido para o stash (não é rastreada pelo git, então some
  silenciosamente ao fazer stash de um diretório untracked que a contém).
- Nada para abrir issue.
