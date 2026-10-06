# Fixer da o1 — rodada 3

Worktree: `.../scratchpad/wt-o0` (core `ficha3/o1`, satélite `ficha3/o1`).

## Tabela achado → commit → teste

| Achado | Título | Commit (satélite) | Commit (core) | Teste |
|---|---|---|---|---|
| C4 | T1.8 cortou o picker de idiomas BONUS por Inteligência (issue #102) | `8431c59` fix(system-pf2e,sheets-pf2e): implementa o picker de idiomas bonus (T1.8/C4) | `5f2f09a1` fix(client): i18n do picker de idiomas bonus + re-pina o satélite (T1.8/C4) | `systems/pf2e/src/__tests__/derivations.test.ts` (6 testes novos, `stepCharLanguages`), `sheets/pf2e/src/lib/sheets/pf2e/__tests__/planVM.test.ts` (15 testes novos: `chooseLanguage`, `languagePickerOptions`, `derivePlan — level-1 language slot count`), `sheets/pf2e/src/lib/sheets/pf2e/__tests__/helpers/classBuildHarness.ts` (branch `"language"` — sem isso a varredura das 29 classes achava "unrecognized slot type" para Runesmith) |

## O que foi implementado (decisão do orquestrador: "implementar agora, sem corte")

- **`stepCharLanguages`** (systems/pf2e/src/derivations/character.ts): cada
  escolha registrada (`system.build.choices` tipo `"language"`, `ref: <slug>`)
  agora soma a `derived.languages` e subtrai de `derived.languagesPendingCount`
  (clamp em 0). Nova saída `derived.languageOptions` — `additionalLanguages.value`
  da ancestralidade quando não-vazio, senão `COMMON_LANGUAGE_FALLBACK` (Human,
  RAW: "pode escolher qualquer idioma comum"), lista fonteada da união dos
  idiomas FIXOS de cada ancestralidade curada em `ancestries-core/documents.json`
  — dado próprio, não texto proprietário.
- **`planVM.ts`** (sheets-pf2e, mirror client puro, mesmo padrão de
  `computeAbilityScores`): `PlanSlotType "language"`, `pendingLanguageSlotCount`,
  `languagePickerOptions`, `chooseLanguage` (op builder ref-only, mesmo formato
  de `adoptedAncestryChoice`). Slots `language-1-<N>`, um por vaga (max(0, mod
  Int) + `additionalLanguages.count` da ancestralidade), sem colapso em grupo.
- **UI real** (`docs/design/PROCESSO-UI.md`): `PlanColumn.svelte` abre
  `LanguageDialog.svelte` (novo componente) ao clicar no slot — lista plana,
  clique escolhe E fecha, sem chamada de socket (idioma não é documento de
  compêndio). i18n: `FUSION.Sheet.Plan.SlotLabel.language` (pt-BR/en) — resto
  reaproveita `FUSION.Dialog.Close`, já existente.
- Fecha **xansde/fusion-systems-2e#102**: o dado do picker já existia e estava
  completo — o gap era só a UI, que passa a existir aqui.

## TDD

Cada peça: teste vermelho pelo motivo certo (função/slot inexistente) →
implementação → verde. Teste **não-circular** (regra do livro, não da própria
fórmula): a asserção do fallback do Human verifica que "common" nunca reaparece
e que "dwarven"/"elven" aparecem (fato conhecido do Player Core), não compara
contra o próprio `COMMON_LANGUAGE_FALLBACK` sob teste.

## Verificação

- `systems/pf2e`: `npx vitest run` — 669/669 verdes (22 arquivos).
- `sheets/pf2e`: `npx vitest run` — 1538/1561 verdes; as 23 falhas restantes
  são **pré-existentes** (confirmado contra `ficha3-reports/o0/baseline.md` e
  `test-baseline.log`: `pregen-parity.test.ts` — `skillIncreaseCeiling`,
  chassis, HP — e `actionCategories.test.ts`), nenhuma relacionada a idiomas.
  A varredura `varredura-classes.test.ts` (que TINHA regredido no meio do
  trabalho por causa do slot novo — achava `language` "unrecognized slot type"
  para Runesmith) foi corrigida com o branch novo em `classBuildHarness.ts` e
  voltou a 100% verde.
- `packages/client`: `svelte-check` (via `pnpm typecheck`) — 0 erros (24
  warnings pré-existentes, nenhum nos arquivos tocados).
- Gate completo do core: `pnpm build` ✅, `pnpm typecheck` ✅ (0 erros, 14/15
  pacotes — `sheets-pf2e` não tem script `typecheck` próprio, coberto pelo
  `svelte-check` do client + `tsc` manual limpo), `pnpm lint` ✅ (0 erros, 1
  warning pré-existente em arquivo não tocado), `pnpm lint:boundaries` ✅ (0
  violações, 5027 módulos), `pnpm format:check` ✅, `pnpm spec:report` ✅
  (cobertura MVP 710/710, piso mantido).

## Pendências para issue

Nenhuma nova. A issue xansde/fusion-systems-2e#102 é fechada por este commit
(o dado sempre existiu; a UI agora existe). O menor N2 registrado na revisão
r2 ("Human tem `additionalLanguages.value = []`, picker ficaria sem opções")
está resolvido pelo fallback `COMMON_LANGUAGE_FALLBACK` implementado aqui.

## Commits

- Satélite (`xansde/fusion-systems-2e`, branch `ficha3/o1`): `8431c59`
  (push confirmado, `80fb68b..8431c59`).
- Core (`xansde/fusion`, branch `ficha3/o1`): `5f2f09a1`
  (push confirmado, `735bcf39..5f2f09a1`).
