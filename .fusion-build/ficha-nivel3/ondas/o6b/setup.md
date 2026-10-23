# Setup da worktree — Onda 6b (gatilho de UI para criar personagem)

## O que foi feito

1. `git fetch origin` na árvore principal (`C:/Users/xansd/pessoal/fusion`) — sem checkout.
2. `git worktree add -b ficha3/o6b <worktree> origin/alfa/app` — worktree criada em
   `.../scratchpad/wt-d`, branch nova `ficha3/o6b` rastreando `origin/alfa/app`
   (HEAD em `2386ef57`, já inclui o merge do PR #234 da onda 0 — `docs/design/ficha-nivel3/`
   já vem pronto, sem precisar copiar nada).
3. `git submodule update --init external/fusion-systems-2e` — veio raso, HEAD em `5a939039`.
4. Submodule: `git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"` +
   `git fetch --unshallow origin` (trouxe todo histórico e branches, incluindo tags v0.1.0–v0.2.1),
   depois `git checkout -b ficha3/o6b origin/main`.
5. Junctions do vendor (leitura, gitignorado) criadas com `New-Item -ItemType Junction`:
   - `wt-d/external/fusion-systems-2e/tools/importer-pf2e/vendor` → `.../pessoal/fusion/tools/importer-pf2e/vendor`
   - `wt-d/tools/importer-pf2e/vendor` → mesmo alvo (raiz do core, consumida por
     `pregen-parity.test.ts`).
   Confirmado `pf2e/packs` e `sf2e` visíveis via as duas junctions.
6. `pnpm install`: lockfile já em dia (resolution step pulado), 484 pacotes, 24.7s,
   `pnpm-lock.yaml` inalterado. Nenhum install concorrente detectado antes de rodar.
7. `pnpm build` (topológico): **sucesso, exit 0**, 1m10s reais. Log completo em
   `.../scratchpad/build-o6b.log`.

## Commits / branches

- Core: `xansde/fusion` branch `ficha3/o6b`, sem commits novos ainda (worktree pronta para
  as tarefas da onda). Nada pushado.
- Satélite: `external/fusion-systems-2e` branch local `ficha3/o6b` a partir de
  `origin/main` (`5a939039`). Sem commits, sem push.

## Decisões e porquês

- Não copiei `docs/design/ficha-nivel3/{plano,tasks,execucao}.md` manualmente — já vieram
  pelo merge do PR #234 (onda 0) que está em `alfa/app`. Também apareceu
  `docs/design/ficha-nivel3/gate-runbook.md`, adicional ao que a onda 0 registrou.
- Segui a receita documentada em `ficha3-reports/o0/setup-ficha3_onda0.md` para as duas
  junctions do vendor (raiz do core + dentro do submodule), sem precisar reinterpretar nada.

## Pendências para issue

Nenhuma. Setup mecânico completou sem erro.

## Verificação

- `pnpm install`: sem erro no output, `pnpm-lock.yaml` não mudou.
- `pnpm build`: exit 0, sem "error"/"ERROR"/"Failed" nos logs; `packages/client build: ✓ built in 39.15s` + `Done`.
- `git status --porcelain` no core: só `?? tools/importer-pf2e/` (a junction nova, dir não
  rastreado nesta branch — nunca commitar). Submodule: limpo (`git status --porcelain` vazio).
- `docs/design/ficha-nivel3/` confirmado presente com os 4 arquivos (plano, tasks, execucao, gate-runbook).

## Caminhos relevantes

- Worktree: `C:/Users/xansd/AppData/Local/Temp/claude/C--Users-xansd-pessoal-fusion/00fac927-00b8-4b98-a337-d71694dff4dc/scratchpad/wt-d`
- Log de build: `C:/Users/xansd/AppData/Local/Temp/claude/C--Users-xansd-pessoal-fusion/00fac927-00b8-4b98-a337-d71694dff4dc/scratchpad/build-o6b.log`
- Branch core: `ficha3/o6b` (não pushada ainda)
- Branch satélite (local, não pushada): `ficha3/o6b` em `wt-d/external/fusion-systems-2e`
