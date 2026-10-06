# Setup da worktree — Onda 0, Fatia 1 (criar qualquer ficha até o nível 3)

## O que foi feito

1. `git fetch origin` na árvore principal (`C:/Users/xansd/pessoal/fusion`) — sem checkout.
2. `git worktree add -b ficha3/onda0 <worktree> origin/alfa/app` — worktree criada em
   `.../scratchpad/wt-o0`, branch nova `ficha3/onda0` rastreando `origin/alfa/app`
   (HEAD em `5e208936`).
3. `git submodule update --init external/fusion-systems-2e` — veio raso (shallow=true no
   `.gitmodules`), HEAD em `e0597c9d`.
4. Submodule estava raso com refspec de branch única. Rodei
   `git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"` seguido de
   `git fetch --unshallow origin` — trouxe todo o histórico e todas as branches remotas.
   Confirmado: `git rev-parse --is-shallow-repository` → `false`;
   `origin/feat/classes-necromancer-runesmith` = `073fb5e`;
   `git merge-base origin/main origin/feat/classes-necromancer-runesmith` = `e0597c9` (não
   vazio → ancestral comum presente, sem qualquer "unrelated histories"). Não foi preciso
   merge nenhum — só um `checkout -b` a partir da branch de origem:
   `git checkout -b ficha3/onda0 origin/feat/classes-necromancer-runesmith`.
5. `pnpm install` na raiz da worktree: lockfile já estava em dia (`Lockfile is up to date,
   resolution step is skipped`), 484 pacotes, 35.6s. `pnpm-lock.yaml` **não mudou** —
   nada a registrar.
6. Vendor do Foundry (leitura, gitignorado): criei DUAS junctions apontando para
   `C:/Users/xansd/pessoal/fusion/tools/importer-pf2e/vendor`:
   - `wt-o0/external/fusion-systems-2e/tools/importer-pf2e/vendor` (uso direto do importer
     no satélite).
   - `wt-o0/tools/importer-pf2e/vendor` (raiz do core) — necessária porque
     `sheets/pf2e/src/lib/sheets/pf2e/__tests__/pregen-parity.test.ts` resolve o vendor por
     caminho relativo (`../../../../../../../../../tools/importer-pf2e/vendor/...`), que
     aponta para a raiz do core, não do submodule. Confirmado por `realpath -m` a partir do
     diretório do teste. `<link>/pf2e/packs` existe nas duas junctions (`pf2e`, `sf2e`).
     `git status` no core e no satélite não lista nenhuma das duas como arquivo a
     commitar.
7. `pnpm build` (topológico, raiz da worktree): **sucesso, exit 0**, 47.4s reais
   (log completo salvo em `.../scratchpad/build-o0.log`, não commitado — é artefato de
   sessão).
8. Copiei os documentos da Fatia 1 (untracked na árvore principal) para a worktree:
   `docs/design/ficha-nivel3/{plano.md,tasks.md,execucao.md}` e
   `.fusion-build/ficha-nivel3/{inventario.md,classes/,auditoria/}`. Rodei
   `pnpm exec prettier --write` nos 3 `.md` de `docs/design/` (formatados, 91-133ms cada);
   os arquivos de `.fusion-build/` ficaram de fora do prettier por design
   (`.prettierignore` tem `.fusion-build/**`).
   Commit **só** desses 14 caminhos (`git add` com paths explícitos, sem `-A`/`-u`):
   `513b971d docs(ficha-nivel3): plano, tarefas, execucao e sondas da Fatia 1`.
   `gh auth switch -u xansde` (confirmado ativo) e
   `git push -u origin ficha3/onda0` — branch nova publicada em
   `https://github.com/xansde/fusion/pull/new/ficha3/onda0` (PR não foi aberto, o passo não
   pediu).

## Commits / branches

- Core: `xansde/fusion` branch `ficha3/onda0`, commit `513b971d`, pushada e rastreando
  `origin/ficha3/onda0`.
- Satélite: `external/fusion-systems-2e` branch local `ficha3/onda0` a partir de
  `origin/feat/classes-necromancer-runesmith` (`073fb5e`) — **não commitada nem pushada**
  (a tarefa não pediu; é o ponto de partida das lanes de implementação). `git status` no
  submodule está limpo.

## Decisões e porquês

- Não usei `--allow-unrelated-histories` em nenhum momento — o ancestral comum
  (`e0597c9`) apareceu assim que o fetch deixou de ser raso, confirmando a hipótese do
  prompt.
- Segunda junction na raiz do core (além da óbvia dentro do submodule) foi necessária só
  depois de grep explícito nos testes/scripts por `importer-pf2e/vendor`/`vendor/pf2e`
  excluindo `node_modules` — o `pregen-parity.test.ts` é o único consumidor que resolve o
  vendor relativo à raiz do core.
- Não rodei `pnpm test` (fora do escopo do passo — só build).

## Pendências para issue

Nenhuma. Todos os passos mecânicos completaram sem erro; nada bloqueou.

## Verificação

- `pnpm install`: log mostra "Lockfile is up to date, resolution step is skipped", exit
  implícito 0 (sem erro no output).
- `pnpm build`: `real 0m47.374s`, sem "error"/"ERROR"/"Failed" no log; último pacote
  (`packages/client`) terminou com `✓ built in 24.90s` + `Done`.
- `git status --porcelain` checado em ambas as árvores (core e satélite) antes e depois de
  cada junction e do commit — nenhuma junction listada como arquivo, nenhum
  arquivo fora do escopo (`docs/design/ficha-nivel3/`, `.fusion-build/ficha-nivel3/`) foi
  staged.
- Push confirmado pela resposta do remoto (`new branch ficha3/onda0 -> ficha3/onda0`).

## Caminhos relevantes

- Worktree: `C:/Users/xansd/AppData/Local/Temp/claude/C--Users-xansd-pessoal-fusion/00fac927-00b8-4b98-a337-d71694dff4dc/scratchpad/wt-o0`
- Log de build: `C:/Users/xansd/AppData/Local/Temp/claude/C--Users-xansd-pessoal-fusion/00fac927-00b8-4b98-a337-d71694dff4dc/scratchpad/build-o0.log`
- Branch core: `ficha3/onda0` (https://github.com/xansde/fusion/tree/ficha3/onda0)
- Branch satélite (local, não pushada): `ficha3/onda0` em `wt-o0/external/fusion-systems-2e`
