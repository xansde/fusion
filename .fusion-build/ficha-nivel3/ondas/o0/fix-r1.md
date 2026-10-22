# Fixer O0 — rodada 1 — relatório

Worktree: `scratchpad/wt-o0`. Core `ficha3/onda0` (`f160594a` → `0433f286`); satélite
`ficha3/onda0` (`77a31bc` → `35a56b1`). Ambas as branches **pushadas** (`gh auth switch -u
xansde` antes de cada push).

## Achado → commit → teste

| Achado | Severidade | Commit | Repo | Teste (vermelho→verde) |
|---|---|---|---|---|
| **C1** — classFeature de `featuresByLevel` nunca vira item do ator | bloqueante | `d081bc8` (embed) + `c57169f` (corolário: fórmula aritmética em `resolveRuleValue`) + `35a56b1` (fix de colisão de nome achado pelo `pnpm build`) | satélite | `grantMaterializer-realPacks.test.ts` (Monk nv1: Powerful Fist/Flurry embutidos; Monk nv3: + Incredible Movement/Mystic Strikes, velocidade derivada 25+10=35 via `runFullDerivation`; Guardian nv1-3: 5 features nominadas) + `derivations-speed.test.ts` (2 testes novos, confirmado vermelho manualmente revertendo o arquivo antes do fix) |
| **C2** — validador T0.4 vermelho por construção (8 grants fora do allowlist) | bloqueante | `0d97227` | satélite | `grant-resolution-validator.test.ts` (4 testes, incl. novo: toda entrada `blocked-by-issue` carrega `issue`) |
| **C3** — pin novo quebra `traitNames.sync` no core (217 vs 228) | bloqueante | `825b292` (satélite: conserta o path do gerador, estava ENOENT desde a F4) + `005e6a56` (core: regenera + re-pina) | satélite + core | `traitNames.sync.test.ts` (3 testes) + `documentDetails.test.ts` (150 testes, contagem 217→228) |
| **C4** — teste do Monk vácuo / prova de entrega ausente | bloqueante (parcial — ver Bloqueios) | mesmo de C1 (`d081bc8`) | satélite | ver C1 — reescrito para assertar por nome + derivação real, não mais `after >= before` |
| **C5** — GrantItem ignora `predicate` | importante | `0a3b2e0` | satélite | `grantMaterializer.test.ts` (13 testes novos: `evaluateGrantPredicate` unitário + integração via `materializeGrants` com fixtures no formato real — Vindicator/Scare to Death) |
| **C6** — subir/descer de nível não (re)materializa grants de classe | importante | `c0a485b` (descer, `levelSet`) + `d081bc8` (subir, `materializeClassGrantsAtLevel`) | satélite | `planVM.test.ts` (4 testes novos de `levelSet`) + evidência indireta em C1/C4 |
| **C7** — allowlist rotula 4 dedicações de nv1 como multiclasse | importante | `0d97227` (junto com C2) | satélite | mesmo teste de C2; issue nova #92 |
| **DOC** — plano/tasks desatualizados | importante | `92763cca` (core) | core | — (documentação) |

## Issues GitHub

- **#88** (Battle Creed) e **#89** (Undead Creator) — já existiam, agora referenciadas pelo
  allowlist com categoria `blocked-by-issue`.
- **#92** (nova) — as 4 dedicações de subclasse de nível 1 mal categorizadas como
  `archetype-not-imported`; criada e referenciada pela categoria nova `class-archetype-gap`.

## Gate rodado (não a suíte inteira — essa fica para o fecho)

- `pnpm build` — verde (achou e corrigiu 1 colisão de nome real: `itemSourceId` duplicado em
  `PlanColumn.svelte`).
- `pnpm typecheck` — verde, 0 erros (24 warnings pré-existentes, nenhum em arquivo tocado).
- `pnpm lint` — verde, 0 erros (1 warning pré-existente em arquivo não tocado).
- `pnpm lint:boundaries` — verde, 0 violações (5023 módulos).
- `pnpm format:check` — verde (corrigido com `prettier --write` numa tabela markdown que eu
  tinha deixado fora do padrão).
- `pnpm spec:report` — verde, piso mantido em 710 (nenhuma spec tocada).
- `pnpm --filter @fusion/sheets-pf2e test` — **1442 passam, 23 falham — todas as 23
  pré-existentes** (22 `pregen-parity.test.ts` + 1 `actionCategories.test.ts`, issue #91,
  medidas ANTES desta rodada). Nenhuma regressão nova.
- `pnpm --filter @fusion/system-pf2e test` — 655/655 verdes.
- `pnpm --filter @fusion/client test` — 3181/3181 verdes (1 todo).

## Achado C4 — o que ficou verificado e o que não

Verificado por teste automatizado, contra os packs REAIS e pela lógica de produção
(`grantMaterializer-realPacks.test.ts`): Monk nível 1 (Powerful Fist + Flurry of Blows
embutidos, tipo `classFeature`, `grantedSlot` correto), Monk nível 3 (+ Incredible
Movement/Mystic Strikes, com a velocidade derivada 25+10=35 rodando `runFullDerivation`, o
pipeline real de servidor), Guardian nível 1-3 (Taunt, Guardian's Techniques, Shield Block,
Guardian's Armor, Tough To Kill), idempotência em todos os três.

**Não verificado nesta rodada**: o runbook AO VIVO com prints (servidor + browser,
`docs/design/PROCESSO-UI.md`) que o achado original pedia. Rodar servidor e navegador está fora
do escopo desta sessão (regra global: nunca usar a extensão Chrome; e o runbook ao vivo é
trabalho do gate da onda, não de um fixer de código). Registrado em `tasks.md`/T0.6 como
pendência explícita, não escondida.

## Pendências para issue (nenhuma nova além da #92)

Nenhuma pendência nova ficou fora de issue. As 23 falhas pré-existentes já têm dono na
issue #91 (aberta em T0.3/T0.4, antes desta rodada).

## Nota sobre o formato do arquivo gerado (`traitNames.ts`)

O gerador (`gen-client-maps.mjs`) sempre escreve as chaves entre aspas (`JSON.stringify`); o
arquivo historicamente committed tinha as aspas removidas pelo `prettier --write` (chaves que
são identificadores JS válidos não precisam de aspas, `quoteProps: "as-needed"`). Rodei
`prettier --write` no arquivo gerado antes de commitar — sem isso o diff mostrava as 217 chaves
existentes "re-quotadas", ruído puro escondendo as 11 linhas que realmente mudaram.

## Pendência de qualidade linguística (não corrigida, fora do escopo do achado)

6 dos 11 traits novos sincronizados (necromancer/runesmith/ikon/additive/additive2/apparition/
wandering/modification/mindshift/amp/evolution) vieram do glossário sem acentuação correta
(`apparition→aparicao` devia ser `aparição`, `ikon→icone` devia ser `ícone`, etc. — a tabela
`ACCENT_FIXES` do gerador nunca foi atualizada para eles). Não é regressão desta onda nem parte
de C3 (que é sobre o path do gerador estar quebrado, não sobre a qualidade de cada tradução) —
registrando aqui para quem for revisar não achar que foi esquecido.
