# Setup da worktree — Onda 3 (o3), Ator companheiro (eidolon e familiar)

## Situação encontrada

A worktree `wt-o0` já existia, reaproveitada de outra onda: estava no branch
`ficha3/o6` (core) com o satélite em estado sem branch visível na primeira checagem.
Havia um item sujo no core: `tools/importer-pf2e/` untracked, com um subdiretório
`vendor/pf2e` reconhecido como repositório git embutido (aviso "adding embedded git
repository").

## O que foi feito

1. `git status --porcelain` no core: só `?? tools/importer-pf2e/` (a junction do
   vendor mais algum conteúdo). `git submodule status`: satélite em `v0.2.2`
   (`5a93903`).
2. `git stash push -u -m 'ficha3: sobra antes da o3' -- tools/importer-pf2e/` —
   preservou a sobra sem descartar nada (nada foi perdido; stash nomeado fica
   disponível se outra onda precisar).
3. `git fetch origin` no core: trouxe atualizações de `ficha3/o4`, nova branch
   `ficha3/o6b`, `main` do satélite avançou e nova tag `v0.2.3`.
4. `git checkout -B ficha3/o3 origin/alfa/app` no core — branch nova criada,
   rastreando `origin/alfa/app`.
5. `git submodule update --init external/fusion-systems-2e` — satélite avançou para
   `80740cc` (tag v0.2.3).
6. No satélite: `git fetch origin` + `git checkout -B ficha3/o3 origin/main` — branch
   nova criada, rastreando `origin/main`, working tree limpa.
7. Verificadas as DUAS junctions do vendor descritas no relatório da Onda 0
   (`setup-ficha3_onda0.md`): `wt-o0/tools/importer-pf2e/vendor` e
   `wt-o0/external/fusion-systems-2e/tools/importer-pf2e/vendor`, ambas apontando
   para `C:\Users\xansd\pessoal\fusion\tools\importer-pf2e\vendor` — íntegras, `git
   status` não as lista.
8. `pnpm install` na raiz: lockfile já em dia, "Already up to date", 1.9s.
9. `pnpm build` (topológico, raiz): sucesso, todos os pacotes buildaram sem erro
   (client, server, shared, system-api etc.), log completo não commitado
   (artefato de sessão).
10. Confirmado que `docs/design/ficha-nivel3/{plano.md,tasks.md,execucao.md,
    gate-runbook.md}` já estão presentes na worktree (herdados do merge da Onda 0).

## Estado final

- Core (`wt-o0`): branch `ficha3/o3`, a partir de `origin/alfa/app`, working tree
  limpa (exceto o stash guardado à parte).
- Satélite (`wt-o0/external/fusion-systems-2e`): branch `ficha3/o3`, a partir de
  `origin/main` (`80740cc`, tag v0.2.3), working tree limpa.
- Junctions do vendor: íntegras (2x).
- `pnpm install` e `pnpm build`: OK.
- Suíte de testes: NÃO rodada (fora do escopo do setup; referência de baseline em
  `../o0/baseline.md`).

## Stash preservado (não descartado)

- Nome: `ficha3: sobra antes da o3`
- Conteúdo: `tools/importer-pf2e/` untracked (residuo de outra sessão/onda; a raiz
  `tools/importer-pf2e/` do core é resíduo só com dado, conforme CLAUDE.md — código
  real do importador vive em `external/fusion-systems-2e/tools/importer-pf2e/src/`).
- Ação: nenhuma — preservado no stash da worktree para não perder nada de outra
  onda; não recuperado nesta tarefa porque está fora do escopo do o3
  (ator companheiro).

## Pendências para issue

Nenhuma pendência nova gerada por este setup.
