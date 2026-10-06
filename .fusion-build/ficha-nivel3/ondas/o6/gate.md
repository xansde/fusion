# Gate de integração — Onda 6 (ficha3/o6)

Worktree: `wt-o0` (core branch `ficha3/o6`; satélite `external/fusion-systems-2e` branch `ficha3/o6`)

## SHAs finais (já pushados antes do gate — confirmados via `git fetch` + `git ls-remote`)

- Core: `93639fa413488aa434e0a250ce3f4acea6a03118`
- Satélite: `18c6b7f76f730d1df716f6d21842f73a56f078b9`
- Pin do core aponta exatamente para o HEAD do satélite (`git ls-tree HEAD external/fusion-systems-2e` = `18c6b7f...`). Não foi preciso commit de pin adicional (a lane já tinha pinado corretamente).

## Comandos (comparados ao baseline `ficha3-reports/o0/baseline.md`, com o precedente já verificado pelo gate da Onda 1 `ficha3-reports/o1/gate.md`)

| Comando | Resultado | Baseline (o0) | Observação |
|---|---|---|---|
| `pnpm build` | EXIT 0 | verde | sem mudança |
| `pnpm typecheck` | EXIT 0 — 0 erros, 24 warnings (svelte a11y/state pré-existentes) | verde | sem mudança |
| `pnpm lint` | EXIT 0 — 0 erros, 1 warning pré-existente (`no-console` eslint-disable não usado em `pregen-parity.test.ts`) | verde | sem mudança |
| `pnpm lint:boundaries` | EXIT 0 — 0 violações, 5032 módulos/12131 deps | verde | sem mudança |
| `pnpm format:check` | EXIT 0 | verde | sem mudança |
| `pnpm test` (suite completa) | EXIT 1 — **2 arquivos falhos, 23 testes falhos**, 443 arquivos/8155 testes verdes (445 arquivos, 8180 testes, 1 skip, 1 todo). Duração 418s. + 1 "Unhandled Error: Timeout calling onTaskUpdate" (flakiness de infra conhecida, não teste vermelho) | 3 arquivos falhos, 25 testes falhos | **Sem regressão nova.** Diff confirmado (`git diff --stat b0af1fe3 HEAD` no core e `2c07d20 HEAD` no satélite): a Onda 6 só tocou `doc-handlers.ts` + seu teste, `build-validation.ts` (novo) + seu teste, e `systems/pf2e/src/index.ts` (export) — nenhum arquivo relacionado a `sheets-pf2e`/pregen/traits. As 23 falhas atuais (`actionCategories.test.ts` — 1 teste de vendor folder coverage; `pregen-parity.test.ts` — 22 testes: HP do Commander L3/L5, chassis do Alchemist/Gunslinger, "has pregens to compare against", e "never exceeds the skill increase ceiling" para 17 classes) são **exatamente o mesmo conjunto** já verificado como não-regressão pelo gate da Onda 1 (`ficha3-reports/o1/gate.md`: "23 testes falhos... subconjunto idêntico das 25 falhas do baseline"). As 2 falhas do baseline em `traitNames.sync.test.ts` continuam ausentes (corrigidas na Onda 1, `51696f79`). Nenhuma falha nova, nenhum arquivo novo na lista de falhas. |
| `pnpm spec:report` | EXIT 0 — cobertura [MVP] com teste: 710 (piso 710) | — | sem arquivo gerado/alterado (`git status --porcelain` limpo além do resíduo pré-existente `tools/importer-pf2e/` untracked, de onda anterior — não tocado por esta gate); nada para commitar |

## Push

Ambas as branches (`ficha3/o6` no core e no satélite) já estavam pushadas antes do gate rodar — a lane T6.1-T6.4 fez o push. `git fetch origin` + `git ls-remote origin ficha3/o6` em cada repo confirmaram o mesmo SHA do `HEAD` local (core `93639fa4`, satélite `18c6b7f7`). Nenhum commit adicional foi necessário (pin já correto, `spec:report` não gerou diff).

## Pendências para issue

Nenhuma pendência nova desta onda/gate. As 23 falhas pré-existentes (vendor folder coverage, HP parity do Commander, chassis de Alchemist/Gunslinger, teto de perícia de 17 classes) já são conhecidas desde o baseline da Onda 0 e reconfirmadas sem mudança pelo gate da Onda 1 — mantendo a mesma decisão daquele gate, não abrindo duplicata aqui.

As duas pendências já registradas pela lane T6.1-T6.4 continuam de pé (não fazem parte deste gate, só relato):
1. `xansde/fusion#233` — ownership do eidolon (companheiro do Summoner) quando a Onda 3 landar em `alfa/app`.
2. `xansde/fusion-systems-2e#109` — `validateCharacterBuild` não cobre contagem de perícias treinadas por classe/nível.

## Conclusão

**Gate verde.** Onda 6 (o jogador cria o próprio personagem) integrada sem regressão: build/typecheck/lint/lint:boundaries/format:check/spec:report limpos, e a suite completa de testes sem nenhuma falha nova em relação ao estado já confirmado pela Onda 1. Nenhum commit adicional necessário — as branches já estavam no estado final pushado.
