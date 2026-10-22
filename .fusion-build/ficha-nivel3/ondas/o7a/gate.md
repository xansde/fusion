# Gate de integração — Onda 7a (molde das 29 fichas + comparador)

**Worktree:** `.../scratchpad/wt-d`
**Core branch:** `ficha3/o7a` — sha `8f56ce16` (já pushado; `origin/ficha3/o7a` == HEAD)
**Satélite branch:** `external/fusion-systems-2e` `ficha3/o7a` — sha `f7a113f7` (já pushado; `origin/ficha3/o7a` == HEAD)
**Pin:** confirmado — `git ls-tree HEAD external/fusion-systems-2e` no core aponta exatamente para `f7a113f7` (o HEAD do satélite). Sem commit de pin necessário; já estava correto ao entrar no gate.

## Comandos (comparados ao baseline `ficha3-reports/o0/baseline.md`)

| Comando | Exit | Resultado | Comparação com baseline |
|---|---|---|---|
| `pnpm build` | 0 | verde | baseline não mediu build isolado; verde |
| `pnpm typecheck` | 0 | 0 erros | baseline: exit 0, sem falhas — igual |
| `pnpm lint` | 0 | verde | não estava no baseline (T0.5 media outro subset); verde |
| `pnpm lint:boundaries` | 0 | verde | verde |
| `pnpm format:check` | 0 | verde | verde |
| `pnpm test` (suíte completa, `vitest --workspace`) | 1 | **2 arquivos falharam, 23 testes falharam** de 8380 (452 arquivos), 452s. 1 "Timeout calling onTaskUpdate" (flakiness de infra conhecida, não teste vermelho) | baseline: 3 arquivos/25 testes. **Sem regressão nova** — ver detalhe abaixo |
| `pnpm spec:report` | 0 | `cobertura [MVP] com teste: 719 (piso 719)` — nenhum arquivo gerado mudou (RASTREABILIDADE/COBERTURA já estavam no piso correto) | nada para commitar |

## Detalhe do `pnpm test` — comparação com o baseline

Baseline (o0, 2026-09-21) tinha 3 arquivos vermelhos:
1. `traitNames.sync.test.ts` (2 testes) — `TRAIT_NAMES_PT` faltando 11 chaves.
2. `actionCategories.test.ts` (1 teste) — 2 pastas do vendor sem grupo de exibição.
3. `pregen-parity.test.ts` (22 testes) — `CLASSES_WITHOUT_PREGEN` desatualizado + divergências de HP/attacks para Alchemist, Gunslinger, Commander.

Nesta rodada (o7a):
1. `traitNames.sync.test.ts` — **passou** (as chaves faltantes já foram supridas por ondas anteriores; melhora, não regressão).
2. `actionCategories.test.ts` (1 teste) — mesma falha (mesma mensagem, "every top-level vendor action folder maps to a display group").
3. `pregen-parity.test.ts` (22 testes) — mesmo conjunto de divergências pré-existentes: 3 de chassis (has pregens / Alchemist / Gunslinger), 2 de HP do Commander (L3/L5), e 17 de "skill increase ceiling" (Alchemist, Animist, Commander, Druid, Exemplar, Guardian, Gunslinger, Inventor, Investigator, Necromancer, Oracle, Psychic, Runesmith, Summoner, Swashbuckler, Thaumaturge, Witch) — todas com a mesma assinatura `NEW divergence against the official pregen sheet — <Classe>/skillIncreaseCeiling: ... expected undefined to be defined`, ou seja, dívida já documentada (falta registrar em `KNOWN_DIVERGENCES`), não introduzida por esta onda.

**Conclusão: nenhuma falha nova, nenhum arquivo vermelho diferente dos 3 do baseline — pelo contrário, 1 dos 3 arquivos do baseline passou a ficar verde.** Nada para consertar nesta lane.

## Trabalho já entregue nesta onda (antes do gate)

- **T7.1** — molde de referência (`character-templates.json` + `README-molde.md`), 8 classes detalhadas + 21 em template, todos os campos derivados em `null` (não-circularidade, lição #48).
- **T7.2** — comparador molde × ficha gerada (commit `8f56ce16` core / `f7a113f7` satélite), com correção de lacuna do Commander.

## Pendências para issue

Nenhuma pendência nova gerada por este gate. As divergências de `pregen-parity.test.ts` já são dívida conhecida (baseline da Onda 0); não há dado novo que justifique abrir issue adicional nesta lane — quem deve registrar `KNOWN_DIVERGENCES` (se ainda não há issue) é a lane dona do teste, fora do escopo deste gate mecânico.

## Shas finais

- Core `ficha3/o7a`: `8f56ce16`
- Satélite `ficha3/o7a`: `f7a113f7`
- Ambos já em `origin` antes deste gate rodar (nenhum push adicional foi necessário).
