# Fixer O0 — rodada 2 — relatório

Worktree `scratchpad/wt-o0`. Core `ficha3/onda0` (`0433f286` → `63cacfed`); satélite
`ficha3/onda0` (`35a56b1` → `6bb0893`). Ambas as branches **pushadas** (`gh auth switch -u
xansde` antes de cada push).

Achados desta rodada: os dois abertos pela revisão adversarial r1 —
`revisao-adversarial-r1.md` (C6 parcial, N1 importante).

## Achado → commit → teste

| Achado | Severidade | Commit | Repo | Teste (vermelho→verde) |
|---|---|---|---|---|
| **N1** — `modifiersFromItem` nunca lia `predicate`; flat-modifiers de classe recém-embutidas (C1) aplicavam bônus que o RAW nega (Stylish Combatant +5 velocidade fora de panache, Vivacious Speed, Incredible Movement com armadura) | importante | `88488c0` | satélite | `derivations-speed.test.ts`: 2 casos vermelhos novos (Monk armado com Incredible Movement fica em 25; Swashbuckler sem panache fica em 25) + 1 caso positivo provando avaliação real (Monk DESARMADO com a mesma regra predicada continua em 35 — distingue "avaliar" de "pular tudo") |
| **C6** — retração de `levelSet` inalcançável pela UI: só `levelUp` (sempre +1) chama `levelSet`; o campo de nível do modo edição (`characterSheetVM.updateLevel`) escrevia os dois campos de nível direto, sem retrair ao descer | importante | `6bb0893` | satélite | `characterSheetVM.test.ts`: `updateLevel` agora retorna `DocOpPayload[]` (era `DocUpdatePayload \| null`) — teste de delegação (diff de nível) + teste de retração (Monk 3→2 remove o `classFeature` acima do novo nível) reaproveitando a cobertura exaustiva já existente em `planVM.test.ts` para `levelSet` |
| **re-pin** | — | `63cacfed` | core | — (pin do submodule) |

## Como cada achado foi consertado

### N1 — avaliação real do `predicate`, não um skip cego

A alternativa mais simples (pular qualquer regra com `predicate` não vazio, espelhando
`itemAlterations.ts`'s `hasNoPredicate`) **quebrava o teste já aprovado do C1**
(`grantMaterializer-realPacks.test.ts`: Monk nível 3 DESARMADO deve mostrar velocidade 35 —
Incredible Movement tem `predicate: [{"not":"self:armored"}]`, que é verdadeiro para um Monk
sem armadura). Confirmado rodando esse teste com o skip cego: `expected 25 to be 35`.

Conserto real: `modifiersFromItem` agora avalia o `predicate` via `evaluatePredicate`
(`@fusion/system-api`, já usado por `instincts.ts` no mesmo pacote) contra um conjunto mínimo
de roll options que o próprio scanner consegue provar a partir de `doc.items`
(`computeKnownRollOptions`) — hoje só `self:armored` (item `armor` equipado), o único termo que
os 3 casos do achado precisam. Qualquer outro termo (`self:effect:panache`,
`feature:vivacious-speed`, `class:*`, `item:trait:*`, ...) fica ausente do conjunto e portanto
`evaluatePredicate` o trata como falso — mesma postura conservadora que `itemAlterations.ts` já
usa para conteúdo não modelado, mas agora capaz de deixar um bônus passar quando a condição é
comprovadamente verdadeira, não só de bloquear tudo.

Verificado contra os 3 packs reais (`node -e` direto no `documents.json`): Incredible Movement
(`{"not":"self:armored"}`), Stylish Combatant (`{"or":["self:effect:panache",...]}`) e Vivacious
Speed (duas variantes `self:effect:panache`/`not self:effect:panache`) — as fixtures dos testes
usam a forma exata do pack, não uma reconstrução à mão.

### C6 — delegação, não duplicação

`characterSheetVM.updateLevel` passou a montar um `PlanOpBuilderContext` a partir dos próprios
campos da VM (`_doc`/`_actorId`/`editable`) e chamar `planVM.levelSet(ctx, value)` diretamente,
em vez de reescrever a lógica de retração (que já existia, testada exaustivamente, em
`planVM.test.ts`). `updateLevel` mudou de retorno (`DocUpdatePayload | null` → `DocOpPayload[]`);
`CharacterSheet.svelte`'s `scheduleUpdate` passou a aceitar `DocUpdatePayload | DocOpPayload[] |
null`, no mesmo padrão do `sendAll` que `PlanColumn.svelte` já usa para `levelUp`.

Import `characterSheetVM.ts → planVM.ts` é seguro: `planVM.ts` só importa TIPOS de volta
(`import type {...} from "./characterSheetVM.js"`), erased em tempo de compilação — sem ciclo em
runtime. `pnpm lint:boundaries` confirmou (0 violações, 5023 módulos).

**Pendência registrada, não escondida**: subir de nível pelo campo de edição continua sem
materializar os `featuresByLevel` do novo nível (isso só existe hoje em
`PlanColumn.svelte`'s `materializeClassGrantsAtLevel`, assíncrona e não exportada) — o próximo
`runHeal` (reabrir a ficha) fecha o gap, então nunca é permanente, mas fica implícito. Issue
aberta: **xansde/fusion-systems-2e#93**.

## Pendências para issue

- **xansde/fusion-systems-2e#93** (aberta nesta rodada) — "Campo de nível do modo edição não
  materializa grants ao SUBIR (só retrai ao descer)". Severidade importante, não bloqueante (o
  heal-on-open já fecha o gap no próximo open).

## Gate rodado (core, não a suíte inteira — essa fica para o fecho da onda)

- `pnpm build` — verde, exit 0.
- `pnpm typecheck` — verde, exit 0, 0 erros / 24 warnings pré-existentes (mesma contagem do
  fix-r1, nenhum warning novo em arquivo tocado).
- `pnpm lint` — verde, exit 0, 0 erros / 1 warning pré-existente (mesmo do fix-r1, arquivo não
  tocado).
- `pnpm lint:boundaries` — verde, 0 violações, 5023 módulos (inclui o import
  `characterSheetVM.ts → planVM.ts` do C6).
- `pnpm format:check` — verde.
- `pnpm spec:report` — verde, piso mantido em 710 (nenhuma spec tocada).

## Testes afetados rodados (satélite, sempre com `pnpm build` antes)

- `@fusion/system-pf2e` (build fresco): suíte completa, **658/658 verdes** (era 657, +1 pelo N1;
  inclui `derivations-speed.test.ts` 15/15 e `itemAlterations.test.ts` 13/13 intactos).
- `@fusion/sheets-pf2e` (build fresco de `system-pf2e` antes): suíte completa, **1443/1466
  verdes, 23 falhas — todas as mesmas pré-existentes do fix-r1** (22 `pregen-parity.test.ts` + 1
  `actionCategories.test.ts`, issue #91; contagem de passes subiu 1442→1443 pelo teste novo de
  C6). `grantMaterializer-realPacks.test.ts` (Monk nv3 desarmado, velocidade 35) e
  `characterSheetVM.test.ts` (215/215, era 214) conferidos individualmente.
- `@fusion/client`: suíte completa, **3181/3181 verdes + 1 todo**, sem regressão (mesma contagem
  do fix-r1 — `CharacterSheet.svelte` não tem harness de teste próprio nesta suíte; verificado
  por `svelte-check` via `pnpm typecheck`, 0 erros).

## Nota metodológica — a ordem `pnpm build` antes de `pnpm test` importa entre pacotes

Rodar `pnpm --filter @fusion/sheets-pf2e test` logo após editar `embeddedModifiers.ts` (sem
rebuildar `system-pf2e`) deu **falso-verde**: o teste `grantMaterializer-realPacks.test.ts`
continuava vendo o `dist/` antigo de `system-pf2e` (resolução `node_modules → dist`, não
`src`), então a mudança de fonte não aparecia até um `pnpm --filter @fusion/system-pf2e build`
explícito. Registrando porque quase levou a declarar o N1 "consertado" sem ter de fato mudado o
comportamento observado por esse consumidor.
