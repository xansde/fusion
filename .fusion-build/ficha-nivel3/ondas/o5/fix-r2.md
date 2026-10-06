# Fixer O5 — Onda 5 (Arquétipos padrão, variante Arquétipo Livre), rodada 2

Worktree: `.../scratchpad/wt-c` (core `ficha3/o5`, satélite `xansde/fusion-systems-2e` `ficha3/o5`).

Status: **os 2 achados importantes (C-2, C-6) foram consertados, testados e commitados/pushados.**
Nenhum achado foi contestado — os dois se confirmaram reais, e são a MESMA causa raiz.

## Tabela achado → commit → teste

| Achado | Severidade | Commit (satélite) | Teste que prova o conserto |
|---|---|---|---|
| C-2 — `index.json` do feats-core não restaurado (7 entradas com drift do vendor servidas ao picker) | importante | `d88c5ff` | `pack-index-consistency.test.mjs` (novo, node --test) — vermelho antes (1 falha: Sanguimancer), verde depois (42/42 sobre todos os 20 packs pf2e+sf2e) |
| C-6 — Sanguimancer Dedication sem o trait `archetype` no `index.json` (segue invisível no slot de Arquétipo Livre no app real) | importante | `d88c5ff` (mesmo commit — mesma causa raiz, mesmo conserto) | mesmo `pack-index-consistency.test.mjs`; a divergência de `system.traits.value` da Sanguimancer Dedication era a falha vermelha específica |

Repin do core: commit `c8bebc02` (`chore(ficha-nivel3): repina o satélite pós fixer da Onda 5,
rodada 2`), satélite `c9e3372..d88c5ff`. Ambas as branches (`ficha3/o5` core e satélite)
**pushadas** para `origin` (conta `xansde`).

**Nota sobre C-2/C-6 no mesmo commit:** os dois achados da revisão adversarial descrevem o
MESMO defeito (o `index.json` do feats-core não foi regenerado depois dos patches cirúrgicos da
rodada 1) por dois ângulos diferentes — drift geral de 7 docs (C-2) e o caso específico da
Sanguimancer Dedication (C-6). O conserto é uma única regeneração do `index.json`; não há como
dividir sem committar um índice inconsistente no meio.

## O que o conserto fez

- `documents.json` do feats-core já estava correto (restaurado em C-2/rodada 1, normalizado em
  C-6/rodada 1) — confirmado por comparação campo a campo antes de mexer em qualquer coisa.
- O `index.json`, que o servidor serve preferencialmente (`packages/server/src/compendium/
  service.ts` `_buildIndex`, só cai para `documents.json` na ausência dele) e que o picker do
  client filtra (`PlanColumn.svelte` `featDocFromIndex`), tinha ficado para trás nos dois patches
  cirúrgicos anteriores — 8 divergências reais (1 doc a menos que os "8" citados pela revisão
  porque duas linhas do relatório eram o mesmo drift de nome contado 2x).
- Script novo `tools/importer-pf2e/src/regenerate-pack-index.mjs`: recebe `<sistema> <slug>` e
  reconstrói `index.json` a partir de `documents.json` + `indexFields` de `pack.json`. Duplica
  deliberadamente (não importa) o algoritmo mínimo `buildIndex()` de `build-mvp-subset.mjs`,
  porque aquele arquivo roda a pipeline de importação inteira como efeito colateral do próprio
  `import` (`main().catch(...)` incondicional no fim do arquivo) — importá-lo para reusar a
  função reintroduziria o drift do vendor que a rodada 1 já tinha restaurado (mesmo risco que o
  C-2 original). Rodado uma vez sobre `feats-core`; diff final = exatamente as 8 divergências
  documentadas (nenhum doc fora do escopo tocado).
- Teste novo `pack-index-consistency.test.mjs`: varre TODO pack committed (pf2e + sf2e, 20 packs)
  e, para cada documento, confere que a entrada do índice tem o mesmo `name` e o mesmo valor (via
  a mesma resolução de path pontilhado) para cada campo de `indexFields`. É exatamente o teste
  "de consistência índice×documentos" que a revisão adversarial pediu — cobre qualquer pack
  futuro, não só o feats-core.

## Verificação (rodada nesta worktree)

- TDD: `pack-index-consistency.test.mjs` rodou vermelho ANTES do conserto (1 falha, feats-core,
  motivo certo: `system.traits.value` da Sanguimancer Dedication divergindo entre índice e
  documento) e verde DEPOIS (42/42).
- `pnpm build` (core, topológico) — **verde**.
- `pnpm typecheck` (core, svelte-check + 6 projetos tsc) — **0 erros**, 24 warnings a11y/svelte
  pré-existentes (mesmo baseline da rodada 1).
- `pnpm lint` — **0 erros**, 1 warning pré-existente (`pregen-parity.test.ts`, mesmo da rodada 1).
- `pnpm lint:boundaries` — **sem violações** (5036 módulos, 12139 dependências).
- `pnpm format:check` — **todos os arquivos no padrão Prettier**.
- `pnpm spec:report` — cobertura MVP com teste: 710 (mesmo piso da rodada 1), sem regressão.
- Testes AFETADOS (não a suíte inteira):
  - `pack-index-consistency.test.mjs` (importer, novo) — 42/42
  - `grafo-de-feats.test.mjs` + `divine-font-options.test.mjs` (importer, node --test junto com o
    novo) — 81/81 no total
  - `planVM.test.ts` — 414/414 (nenhum teste tocado — fixtures inline não leem index.json/
    documents.json do disco, então continuam válidos como estavam)
  - `grantMaterializer.test.ts` — 75/75
  - `grantMaterializer-realPacks.test.ts` — 11/11 (carrega packs reais — confirma que a
    regeneração do índice não quebrou nada consumido por esses testes)
  - `varredura-classes.test.ts` — 190/190
  - `classFeatLeakGuard.test.ts` — 5/5

## Pendências para issue

Nenhuma pendência nova nesta rodada. As 4 pendências menores (C-7/C-8/C-9/C-10) já levantadas na
rodada 1 continuam fora do escopo desta lista de achados confirmados — ver `fix-r1.md` para os
títulos/corpos prontos.

## `tocou_fluxo_criacao`

`false` — o único conserto de comportamento foi regenerar um arquivo de DADO (`index.json`) para
que ele volte a espelhar `documents.json`, que já estava correto desde a rodada 1. Nenhuma linha
de `planVM.ts`, `PlanColumn.svelte` ou qualquer outro código que a criação/subida de nível
executa foi tocada nesta rodada — só dado de pack + script de tooling + teste novo.
