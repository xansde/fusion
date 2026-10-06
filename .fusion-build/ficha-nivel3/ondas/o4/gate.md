# Gate de integração — Onda 4 (ficha3/o4)

Worktree: `wt-c` (core branch `ficha3/o4`; satélite `external/fusion-systems-2e` branch `ficha3/o4`)

## Lanes da onda

- T4.1 (divindades) — feito, `PODE MERGEAR: SIM`.
- T4.2 (rules das 17 features do Animist) — feito, `PODE MERGEAR: SIM`.
- T4.3 (Necromancer/Fatal Method) — verificação apenas: pré-condição ("se T1.5 confirmar
  ausência") não se cumpriu (T1.6 da Onda 1 já havia cabeado os 2 documentos). Nenhum código
  alterado.

## SHAs finais (já pushados antes do gate — confirmados via `git fetch`)

- Core: `3b8ceb6fc949edb21b1c2205772ad645e50f6a4a`
- Satélite: `52fc0ab25c5d563fd8d22ed3de32313bfb527182`
- Pin do core aponta exatamente para o HEAD do satélite (`git ls-tree HEAD external/fusion-systems-2e` = `52fc0ab...`). Não foi preciso commit de pin adicional (T4.2 já fez o pin pós-Animist).

## Comandos (comparados ao baseline `ficha3-reports/o0/baseline.md`)

| Comando | Resultado | Baseline (o0) | Observação |
|---|---|---|---|
| `pnpm build` | EXIT 0 | verde | sem mudança |
| `pnpm typecheck` | EXIT 0 | verde | sem mudança |
| `pnpm lint` | EXIT 0 | verde | sem mudança |
| `pnpm lint:boundaries` | EXIT 0 | verde | sem mudança |
| `pnpm format:check` | EXIT 0 | verde | sem mudança |
| `pnpm test` (suite completa) | EXIT 1 — 2 arquivos falhos, 23 testes falhos, 441 arquivos passando (443 total), 8134 testes passando (8159 total), 1 skip, 1 todo. Duração 414.65s. | 3 arquivos falhos, 25 testes falhos (8003 testes, 438 arquivos) | **Sem regressão nova.** As 23 falhas são exatamente o mesmo par de arquivos já visto no gate da Onda 1 (`ficha3-reports/o1/gate.md`): `actionCategories.test.ts` (1 — vendor folder coverage sem grupo de exibição) e `pregen-parity.test.ts` (22 — HP Commander L3/L5, chassis Alchemist/Gunslinger, "has pregens to compare against", teto de skill-increase das 16 classes). As 2 falhas de `traitNames.sync.test.ts` do baseline original seguem corrigidas (fix da Onda 1, `51696f79`). Também presente 1 "Unhandled Error: [vitest-worker]: Timeout calling onTaskUpdate" — flakiness de infra conhecida (CLAUDE.md), não teste vermelho. |
| `pnpm spec:report` | EXIT 0 | — | sem diff gerado (`git status` limpo além da junction pré-existente `tools/importer-pf2e/vendor`, read-only, mesma observação do gate da Onda 1); nada para commitar |

## Push

Ambas as branches (`ficha3/o4` no core e no satélite) já estavam pushadas antes do gate rodar —
`git fetch origin ficha3/o4` em cada repo devolveu o mesmo SHA do `HEAD` local (ver SHAs acima).
Nenhum commit adicional foi necessário (pin já correto, `spec:report` não gerou diff).

## Pendências para issue (já registradas pelas lanes, não soltas)

1. `xansde/fusion-systems-2e#22` (comentário adicionado por T4.1) — sanctification
   (holy/unholy/none) do Cleric/Champion segue sem picker/derivação.
2. `xansde/fusion-systems-2e#58` (comentário adicionado por T4.1) — os 473 documentos de
   `deities-core` entram no lote de tradução pt-BR pendente.
3. `xansde/fusion-systems-2e#110` (aberta pelo gate, texto redigido por T4.2) — divergência
   `optionCount` (13) × pack real (14) no eixo `animist-apparition` (`Lamentation of Sinister
   Deals`, uncommon).

Nenhuma pendência nova desta rodada de gate — as 23 falhas pré-existentes já são conhecidas do
baseline da Onda 0 / gate da Onda 1.
