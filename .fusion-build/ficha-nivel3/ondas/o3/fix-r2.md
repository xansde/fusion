# Fixer o3 — rodada 2

Worktree: `.../scratchpad/wt-o0` (core `ficha3/o3`, satélite `external/fusion-systems-2e` `ficha3/o3`).
Achados-fonte: `revisao-adversarial-r1.md` (veredito REPROVADA: B1 bloqueante seguia aberto, N1 importante novo).

## Tabela achado → commit → teste

| Achado | O quê | Commit(s) | Teste (RED→GREEN) |
|---|---|---|---|
| **N1** importante — aviso de "companheiro obsoleto" com falso positivo, oferecendo apagar companheiro legítimo | `staleAutoCompanionAfterClassChange` (petsVM.ts) passa a receber `oldClassSourceId` (lido do item de classe ATUAL antes do `applyClass`) e só flagar quando `kind === autoCompanionKindForClass(old) && kind !== autoCompanionKindForClass(new)`; comparação direta por `companionKind` (sem normalizar `pet`→`familiar`), então `pet` nunca é comparado. `PlanColumn.svelte`'s `checkStaleAutoCompanion` agora lê `abcCurrentSourceId("class")` (a classe sendo SUBSTITUÍDA, ainda não sobrescrita no `doc` local nesse ponto) e passa os dois ids ao VM. | satélite `e3bff2f` (`fix(pf2e): aviso de companheiro obsoleto compara com a classe ANTERIOR`), pushado; core `19bff216` (bump do pin), pushado | `petsVM.test.ts` → suíte `staleAutoCompanionAfterClassChange` reescrita: os 5 casos antigos passaram a exigir `oldClassSourceId` explícito, + 6 casos novos regressivos do N1 (Wizard+talento reconfirmando Wizard, Summoner+talento DEC-PET-03 reconfirmando Summoner, `pet` nunca flagado mesmo em swap real, eidolon flagado e não o pet quando ambos existem, sem classe antiga = null). RED confirmado via `git stash` da implementação (5 dos 11 casos falharam pelo motivo certo contra o código antigo — os 3 exemplos exatos do achado: Wizard+talento, Summoner+talento e `pet` sendo tratado como familiar); GREEN com o fix (51/51). |
| **B1** bloqueante de processo — evidência viva ainda não rodou | **Não resolvido por este fixer, de novo** — estrutural, não de esforço: a skill `tutorial-e2e` só existe (código + `node_modules` do Playwright) na árvore principal `C:/Users/xansd/pessoal/fusion`, nunca commitada (`.claude/` inteiro é `??` em qualquer branch — confirmado com `git status`/`git ls-files`), então nenhuma worktree isolada a herda. As duas saídas (instalar node_modules na worktree, ou tocar a árvore principal) são proibidas nesta rodada. Ver "Pendências" abaixo — virou issue registrada desta vez, em vez de só texto de rascunho. | — | — |

## Verificação rodada (nesta ordem)

- `pnpm build` (core, monorepo completo incl. submódulo) — verde.
- `pnpm -r typecheck` — **0 ERRORS**, 24 warnings pré-existentes (mesmos do fix-r1, a11y/CSS não tocados).
- `pnpm lint` — 0 erros (1 warning pré-existente em `pregen-parity.test.ts`).
- `pnpm lint:boundaries` — sem violação (5044 módulos).
- `pnpm format:check` — tudo formatado.
- `pnpm spec:report` — `cobertura [MVP] com teste: 719 (piso 719)`, sem regressão.
- Testes AFETADOS (não a suíte inteira):
  - `sheets/pf2e`: `petsVM.test.ts` (51/51), `petsWire.test.ts` (7/7), `planVM.test.ts` (397/397).
  - `packages/server`: `companion-eidolon.test.ts` (9/9), `companion-witch-familiar.test.ts` (2/2), `player-familiar-create.test.ts` (11/11) — sem regressão.
  - Rodada incidental da suíte completa de `sheets-pf2e` (efeito colateral de um comando `pnpm --filter` mal-parametrizado) mostrou 23 falhas em `pregen-parity.test.ts` (Necromancer/Runesmith, `skillIncreaseCeiling`) — **pré-existentes**, documentadas em `ficha3-reports/o0/baseline.md` linha 22, nada a ver com este conserto.

`tocou_fluxo_criacao = true`: `staleAutoCompanionAfterClassChange` e `checkStaleAutoCompanion` rodam sempre que o jogador aplica/reaplica uma classe no card Classe do Plano — caminho que a criação e a progressão de nível de personagem executam.

## Commits

Satélite (`xansde/fusion-systems-2e`, branch `ficha3/o3`, pushada):
- `e3bff2f` fix(pf2e): aviso de companheiro obsoleto compara com a classe ANTERIOR

Core (`xansde/fusion`, branch `ficha3/o3`, pushada):
- `19bff216` chore(deps): atualiza o pin do fusion-systems-2e (N1, rodada 2 da onda 3)

## Achados que considerei e NÃO consertei (com prova)

Nenhum achado confirmado desta rodada (N1) foi refutado — RED reproduzido contra o código real
antes do fix. B1 não foi refutado nem resolvido: é um bloqueio estrutural de ambiente (skill
local não versionada), não uma questão de esforço — a mesma conclusão da rodada 1, agora com a
pendência virada issue de verdade (ver abaixo) em vez de só texto de rascunho.

## Pendências para issue (CRIADAS nesta rodada, não só redigidas)

### 1. B1 — evidência viva ainda não rodou
- **Repo**: `xansde/fusion`
- **Issue**: https://github.com/xansde/fusion/issues/241 — "Rodar tutorial-e2e (Summoner/Witch nível 1) — evidência viva da onda 3 de companheiros"

### 2. Fora da onda 3 — feedback do Alexandre sobre o Animista (relatado de novo nesta rodada)
O Alexandre relatou (repetindo o que já constava em `revisao-adversarial-r1.md` e no `fix-r1.md`):
ao selecionar os espíritos na ficha do Animista, nada muda — não adiciona à lista de magias, não
muda o filtro, não abre/atualiza aba nenhuma. **Não pertence à onda 3** (Ator companheiro /
eidolon-familiar); não investigado por este fixer (fora do escopo desta rodada). Desta vez a
pendência virou issue de verdade, não só texto:
- **Repo**: `xansde/fusion`
- **Issue**: https://github.com/xansde/fusion/issues/242 — "Animista: selecionar espírito não atualiza lista de magias, filtro nem aba"
