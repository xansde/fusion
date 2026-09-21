# Fixer o1 — rodada 4 (fix-r4)

Worktree: `C:/Users/xansd/AppData/Local/Temp/claude/C--Users-xansd-pessoal-fusion/00fac927-00b8-4b98-a337-d71694dff4dc/scratchpad/wt-o0`
Core branch: `ficha3/o1` · Satélite branch: `ficha3/o1` (`external/fusion-systems-2e`)

## Achado → commit → teste

| Achado | Descrição | Commit (satélite) | Commit (core, pin) | Teste (vermelho → verde) |
|---|---|---|---|---|
| N3 (importante) | Opções do picker de idiomas fora da regra do PF2e: `COMMON_LANGUAGE_FALLBACK` era um proxy inventado (união das línguas fixas de cada ancestralidade curada), incluía `ysoki` (língua própria do Ratfolk, não comum) e faltavam `draconic`/`jotun`/`sakvroth`; além disso só era oferecido ao Humano como fallback — nenhuma outra ancestralidade recebia o pool comum, só sua própria `additionalLanguages.value` | `c7bb7cc` (`xansde/fusion-systems-2e`) | `75a5090e` (`xansde/fusion`) | `derivations.test.ts` (`system-pf2e`) + `planVM.test.ts` (`sheets-pf2e`) — 2 testes novos + 2 testes existentes atualizados, vermelhos pelo motivo certo antes do conserto (ver detalhe abaixo) |

## Detalhe do conserto (N3)

**Causa raiz**: `COMMON_LANGUAGE_FALLBACK` (em `systems/pf2e/src/derivations/character.ts` e seu espelho em `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts`) era uma lista inventada ("união da língua fixa de cada ancestralidade curada"), não a lista RAW de idiomas de raridade comum do Player Core. Dois defeitos: (1) continha `ysoki`, que no livro é a língua própria do Ratfolk, não uma língua comum; faltavam `draconic`, `jotun`, `sakvroth`, que SÃO comuns. (2) `languageOptions`/`languagePickerOptions` só ofereciam esse pool quando `additionalLanguages.value` da própria ancestralidade vinha vazio (caso único: Humano) — RAW diz que qualquer personagem pode escolher entre os idiomas comuns MAIS a lista própria da ancestralidade; as duas listas são aditivas, não um "ou".

**Conserto**: troquei `COMMON_LANGUAGE_FALLBACK` por `COMMON_LANGUAGES` (as 10 línguas de raridade comum do remaster — draconic, dwarven, elven, fey, gnomish, goblin, halfling, jotun, orcish, sakvroth — só slugs, sem texto proprietário) e mudei `languageOptions`/`languagePickerOptions` para sempre unir `COMMON_LANGUAGES` com `additionalLanguages.value` da ancestralidade (menos os idiomas já conhecidos), nos dois lados: `systems/pf2e/src/derivations/character.ts` (servidor) e `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts` (espelho client, comentário "MUST stay in sync" já existia e foi respeitado).

**TDD**: escrevi 2 testes novos (um em cada lado) que reproduziam o achado exatamente como descrito — Humano sem draconic/jotun/sakvroth e com ysoki; Anão sem elven — confirmei vermelho (`AssertionError` no motivo certo: opções erradas), apliquei o conserto, confirmei verde. Também atualizei 3 testes existentes (2 em `derivations.test.ts`, 1 em `planVM.test.ts`) cuja expectativa antiga codificava o comportamento errado (só a lista própria da ancestralidade, sem união com o pool comum) — as novas expectativas foram calculadas manualmente a partir da nova implementação (união + filtro de conhecidos, ordem de inserção).

**Não-circular**: a asserção vem da regra do livro (idiomas de raridade comum do Player Core remaster) e de fatos já confirmados no repo (dados reais de `ancestries-core/documents.json` usados nos fixtures dos testes), não da própria fórmula sob teste.

## Verificação (worktree `wt-o0`, raiz do core)

- `pnpm build` — verde (client, server, shared, system-api, systems/*, sheets/pf2e).
- `pnpm typecheck` — verde, 0 erros (`packages/client` via `svelte-check`: 0 erros, 24 warnings pré-existentes não relacionados).
- `pnpm lint` — verde, 0 erros (1 warning pré-existente não relacionado em `pregen-parity.test.ts`, arquivo que não toquei).
- `pnpm lint:boundaries` — verde, "no dependency violations found" (5027 módulos).
- `pnpm format:check` — verde, "All matched files use Prettier code style!".
- `pnpm spec:report` — verde, `cobertura [MVP] com teste: 710 (piso 710)`; sem alteração de specs, nada para commitar.
- Testes AFETADOS (não a suíte inteira):
  - `system-pf2e/src/__tests__/derivations.test.ts` — 78/78 verdes.
  - `sheets-pf2e/src/lib/sheets/pf2e/__tests__/planVM.test.ts` — 390/390 verdes.
  - Verificação adicional (uso indireto de `languagePickerOptions` via `classBuildHarness.ts`): `ficha-nivel3-onda1.test.ts`, `grantMaterializer-realPacks.test.ts`, `varredura-classes.test.ts` — todos verdes; `pregen-parity.test.ts` — 22 falhas em "skillIncreaseCeiling"/`CLASSES_WITHOUT_PREGEN`, **confirmadas PRÉ-EXISTENTES** (mesmo arquivo, mesmas 22 falhas, mesma contagem, rodado com `git stash` das minhas mudanças — nada a ver com N3; já documentado em `ficha3-reports/o0/baseline.md`).

## Pendências para issue

Nenhuma pendência nova gerada por este achado. A pendência pré-existente de `pregen-parity.test.ts` (22 falhas: `CLASSES_WITHOUT_PREGEN`/divergências de `attacks.other`/HP/skillIncreaseCeiling contra o pregen oficial) já está registrada no baseline da Onda 0 (`ficha3-reports/o0/baseline.md`) e não foi tocada nem agravada por este conserto.

## Push

- Satélite `xansde/fusion-systems-2e` branch `ficha3/o1`: `8431c59..c7bb7cc` pushed.
- Core `xansde/fusion` branch `ficha3/o1`: `5f2f09a1..75a5090e` pushed (inclui o re-pin do submodule).
