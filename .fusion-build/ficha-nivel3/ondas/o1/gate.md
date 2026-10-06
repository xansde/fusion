# Gate de integração — Onda 1 (ficha3/o1)

Worktree: `wt-o0` (core branch `ficha3/o1`; satélite `external/fusion-systems-2e` branch `ficha3/o1`)

## SHAs finais (já pushados antes do gate — confirmados via `git fetch`)

- Core: `51696f79dc98fce1d8641f76de63099a098cf5ec`
- Satélite: `ad991baf22533622a6cc29a5eadf9a14f23103e6`
- Pin do core aponta exatamente para o HEAD do satélite (`git ls-tree HEAD external/fusion-systems-2e` = `ad991ba...`). Não foi preciso commit de pin adicional.

## Comandos (comparados ao baseline `ficha3-reports/o0/baseline.md`)

| Comando | Resultado | Baseline (o0) | Observação |
|---|---|---|---|
| `pnpm build` | EXIT 0 | verde | sem mudança |
| `pnpm typecheck` | EXIT 0 | verde | sem mudança |
| `pnpm lint` | EXIT 0 | verde | sem mudança |
| `pnpm lint:boundaries` | EXIT 0 | verde | sem mudança |
| `pnpm format:check` | EXIT 0 | verde | sem mudança |
| `pnpm test` (suite completa) | EXIT 1 — 2 arquivos falhos, 23 testes falhos, 441 arquivos/8099 testes verdes, 1 skip, 1 todo | 3 arquivos falhos, 25 testes falhos, 435 arquivos/7976 testes verdes | **Sem regressão nova.** As 23 falhas de `o1` são um subconjunto idêntico das 25 falhas do baseline (`actionCategories.test.ts` — vendor folder coverage; `pregen-parity.test.ts` — HP do Commander L3/L5, chassis do Alchemist/Gunslinger, "has pregens to compare against", e "never exceeds the skill increase ceiling" para as 16 classes). As 2 falhas do baseline em `client/traitNames.sync.test.ts` (contagem de traits fora de sincronia com o glossário) **sumiram** — corrigidas pelo commit `51696f79` (T1.8, tradução do label "Idiomas" e regeneração de `traitNames.ts`). Nenhuma falha nova apareceu. |
| `pnpm spec:report` | EXIT 0 — cobertura [MVP] com teste: 710 (piso 710) | — | sem arquivo gerado/alterado (`git status` limpo além da junction pré-existente `tools/importer-pf2e/vendor`); nada para commitar |

## Push

Ambas as branches (`ficha3/o1` no core e no satélite) já estavam pushadas antes do gate rodar — `git fetch origin ficha3/o1` em cada repo devolveu o mesmo SHA do `HEAD` local. Nenhum commit adicional foi necessário (pin já correto, spec:report não gerou diff).

## Pendências para issue

Nenhuma pendência nova desta onda. As 23 falhas pré-existentes (vendor folder coverage, HP parity do Commander, chassis de Alchemist/Gunslinger, teto de perícia das 16 classes) já são conhecidas do baseline da Onda 0 e presumivelmente já têm (ou deveriam ter) issue própria registrada por essa onda — não abrindo duplicata aqui por falta de contexto sobre o registro anterior.
