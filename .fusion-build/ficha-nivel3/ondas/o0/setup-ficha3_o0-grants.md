# Setup worktree — Onda 0, ficha3/o0-grants

## O que foi feito

1. `git fetch origin` na árvore principal (`C:\Users\xansd\pessoal\fusion`) — sem checkout lá.
2. `git worktree add -b ficha3/o0-grants <worktree> origin/alfa/app` — HEAD em `5e208936`
   (merge do PR #214, bump systems-2e v0.1.1). Branch tracking `origin/alfa/app`.
3. `git submodule update --init external/fusion-systems-2e` — clone raso automático (HEAD
   `e0597c9`, conforme `.gitmodules` shallow=true).
4. Submodule estava com refspec de branch única (`+refs/heads/main:refs/remotes/origin/*`).
   Ampliado para `+refs/heads/*:refs/remotes/origin/*` e refeito `git fetch origin` (trouxe
   ~28 branches remotas). `git fetch --unshallow` sozinho não bastava porque o refspec restrito
   nunca traria `feat/classes-necromancer-runesmith`.
   - Confirmado: `origin/feat/classes-necromancer-runesmith` = `073fb5e...` (commit
     "fix(sheets-pf2e): corrige expectedRemainingGap após CI").
   - Confirmado: `git merge-base origin/main origin/feat/classes-necromancer-runesmith` =
     `e0597c9...` (não-vazio → histórico comum presente, sem shallow residual).
   - `git checkout -b ficha3/o0-grants origin/feat/classes-necromancer-runesmith` — sem
     "unrelated histories", `--allow-unrelated-histories` NÃO foi necessário nem usado.
5. `pnpm install` na worktree (core): lockfile já estava atualizado (`frozen-lockfile`
   funcionou de primeira, sem precisar de `--no-frozen-lockfile`). 484 pacotes, ~19s.
6. Junctions do vendor Foundry (somente leitura, terceiros, gitignored):
   - `<worktree>/external/fusion-systems-2e/tools/importer-pf2e/vendor` → vendor da árvore
     principal (caminho pedido no prompt).
   - `<worktree>/tools/importer-pf2e/vendor` → mesmo alvo. Necessário além do primeiro:
     `pregen-parity.test.ts` (em `sheets/pf2e/src/lib/sheets/pf2e/__tests__/`) resolve
     `ICONICS_ROOT` subindo 8 níveis a partir do arquivo de teste, o que aponta para a
     **raiz do core** (`tools/importer-pf2e/vendor/pf2e/packs/pf2e/iconics`), não para dentro
     do submodule. Confirmado por grep no próprio teste e no `AGENTS.md` do satélite.
   - Ambas as junctions verificadas com `pf2e/packs` presente dentro delas.
   - `git status` no core mostra `tools/importer-pf2e/` como `??` (untracked) — core não
     rastreia esse diretório (migrou para o submodule); nada foi adicionado ao stage.
7. `pnpm build` (topológico) na worktree: **sucesso, exit 0**, ~28–85s dependendo da run
   (cache de build variou entre as duas execuções). Todos os pacotes buildaram, incluindo
   `packages/client` (Vite, 2301 módulos, chunks normais de Svelte/PIXI — só warnings de
   a11y/CSS não usado, nada bloqueante).

## Estado final

- Worktree core: `ficha3/o0-grants`, HEAD em `origin/alfa/app` (5e208936), sem commits ainda
  (nenhum passo pediu commit nesta tarefa — é setup puro).
- Submodule: `ficha3/o0-grants`, HEAD em `073fb5e` (`origin/feat/classes-necromancer-runesmith`,
  29 classes).
- Nenhum `git add`/commit feito — instrução era só preparar a worktree.
- Árvore principal (`C:\Users\xansd\pessoal\fusion`) e o checkout do submodule dela **não
  foram tocados** — só leitura (fetch na raiz, grep/ls no vendor). O `M external/fusion-systems-2e`
  que aparece no `git status` da árvore principal já existia antes (outra sessão, alchemist.json
  staged) e não foi gerado por esta tarefa.

## Pendências para issue

Nenhuma pendência bloqueante desta tarefa. Observação não-bloqueante (não vira issue):
o build do `packages/client` emite warnings de acessibilidade (a11y_no_noninteractive_element_to_interactive_role
em `CharacterSheet.svelte`) e um `state_referenced_locally` em `NpcSheet.svelte` — pré-existentes
na branch, não causados por este setup, e não impedem o build.

## Decisões e porquês

- Refspec ampliado no submodule em vez de só `--unshallow`: o clone raso do `.gitmodules`
  também restringe o refspec a `main`; sem ampliar, a branch alvo nunca chegaria no fetch,
  independente de shallow/unshallow.
- Duas junctions do vendor (não só a pedida no passo 6): confirmado via grep que
  `pregen-parity.test.ts` procura o vendor na raiz do core, não dentro do submodule — sem a
  segunda junction esse teste ficaria "skipped" silenciosamente em vez de rodar a suíte real.
