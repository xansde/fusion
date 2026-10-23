# Setup da worktree — Onda 7a (molde das 29 fichas + comparador)

## O que foi feito

1. Worktree `wt-d` **já existia** (reaproveitada da Onda 4b, branch `ficha3/o4b`).
2. `git status --porcelain` no core mostrou `?? tools/importer-pf2e/` (untracked, resíduo
   pré-existente). `git stash push -u -m "ficha3: sobra antes da o7a"` — nada descartado.
3. `git fetch origin` no core → `git checkout -B ficha3/o7a origin/alfa/app` (HEAD em
   `89716d5c`, merge do PR #250, `ficha3/o5`).
4. `git submodule update --init external/fusion-systems-2e` (satélite estava com `M`
   pendente, agora limpo em `502bcf2`/v0.2.6).
5. No satélite: `git fetch origin` → `git checkout -B ficha3/o7a origin/main` (HEAD em
   `0626b54`, merge do PR #147, `ficha3/o5`, tag v0.2.7 nova trazida no fetch).
6. Junctions do vendor Foundry (somente leitura, gitignoradas):
   - `wt-d/external/fusion-systems-2e/tools/importer-pf2e/vendor` → já existia, íntegra
     (`pf2e/packs` presente).
   - `wt-d/tools/importer-pf2e/vendor` → **faltava**, criada agora
     (`New-Item -ItemType Junction`) apontando para
     `C:\Users\xansd\pessoal\fusion\tools\importer-pf2e\vendor`. Necessária para
     `pregen-parity.test.ts` (resolve `ICONICS_ROOT` na raiz do core, não no submodule) —
     confirmado nos relatórios da Onda 0.
7. Nenhum outro `pnpm install` rodando na máquina (checado antes).
8. `pnpm install` na raiz da worktree: `Already up to date`, 645ms — lockfile não mudou.
9. `pnpm build` (topológico): **sucesso, exit 0**, incluindo `packages/client` (Vite, build
   completo, só warnings de a11y/CSS pré-existentes, nada bloqueante).
10. Suíte de testes **não rodada** (fora do escopo do setup; próxima tarefa da onda decide
    o que rodar, contra a referência de `ficha3-reports/o0/baseline.md`).

## Estado final

- Core: worktree `wt-d`, branch `ficha3/o7a` (tracking `origin/alfa/app`), HEAD `89716d5c`.
- Satélite: branch `ficha3/o7a` (tracking `origin/main`), HEAD `0626b54`.
- `docs/design/ficha-nivel3/{plano.md,tasks.md,execucao.md,gate-runbook.md}` presentes
  (herdados do merge da Onda 0 em `alfa/app`).
- Stash `ficha3: sobra antes da o7a` preservado (conteúdo: `tools/importer-pf2e/` untracked
  residual de onda anterior) — não aplicado de volta, só guardado por segurança.
- Nenhum `git add`/commit feito — tarefa é setup puro.
- Árvore principal (`C:/Users/xansd/pessoal/fusion`) não foi tocada (só leitura de referência).

## Pendências para issue

Nenhuma pendência bloqueante. Nada a registrar como issue nova.

## Decisões e porquês

- Reaproveitei a worktree existente (`wt-d`) em vez de recriar, conforme instrução do
  prompt para o caso "worktree já existe" — mais rápido e evita duplicar node_modules.
- Stash em vez de descartar o resíduo untracked: pode ser artefato útil de outra sessão
  (regra global de nunca descartar sem necessidade).
- Recriei a junction raiz do vendor mesmo não estando listada como "faltante" no prompt,
  porque os relatórios de referência da Onda 0 (dois setups independentes) confirmam que
  ambas as junctions são necessárias — sem a da raiz, `pregen-parity.test.ts` roda contra
  caminho errado ou falha silenciosamente.
