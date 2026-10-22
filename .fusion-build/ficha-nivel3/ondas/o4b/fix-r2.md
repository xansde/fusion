# Fixer o4b — rodada 2

Alvo: 2 achados confirmados pela revisão adversarial r1 (`revisao-adversarial-r1.md`).
Worktree `scratchpad/wt-d` (core branch `ficha3/o4b`, satélite `external/fusion-systems-2e`
branch `ficha3/o4b`).

## Tabela achado → commit → teste

| Achado | Severidade | Commit (satélite) | Commit (core) | Teste |
| --- | --- | --- | --- | --- |
| N2 — level-up não materializa o repertório de rank 2+ da Apparition atunada até reabrir a ficha | importante | `8203bae` fix(pf2e): level-up materializa o repertório da Apparition atunada (N2) | `bb7fe458` fix(ficha-nivel3): repina satélite com o fixer da Onda 4b r2 (N2) | `planColumn-levelup-apparition.test.ts` (novo, 3 casos) — vermelho antes do fix (faltava a chamada e o guard), verde depois; `apparitionSpellcasting.test.ts` (18) e `planVM.test.ts` (424) sem regressão |
| C7 — evidência viva não foi refeita depois dos consertos (sem print de aceite do C2 sem reabrir, nem de ator nv1/nv3) | importante | — (não é código, é evidência) | — | `evidencia-viva-r2.md` + `prints/r2-00..10-*.png`, servidor+browser reais no pin atual (satélite `8203bae`), ator limpo `Fixer_o4b_r2` |

## N2 — detalhe

`handleLevelUp` (`PlanColumn.svelte`) já chamava `materializeClassGrantsAtLevel(targetLevel)`
depois de `levelUp(opCtx)`, mas nunca `materializeApparitionSpells(targetLevel)` — a função que
faz `apparitionRepertoireOps` resolver o novo rank contra `spells-core`. Um Animist subindo de
nível (2→3 destrava o rank 2, ex. Knock em "Crafter in the Vault") ficava com o slot novo vazio
até uma ação não relacionada (fechar/reabrir a ficha) disparar a reconciliação de novo.

`apparitionRepertoireOps` em si já resolvia o rank 2 corretamente quando chamada direto com o
nível novo (teste pré-existente "level 3 also resolves the rank-2 spell (Knock)" em
`apparitionSpellcasting.test.ts`) — o bug era só a chamada faltando na wiring do level-up.

Fix: em `handleLevelUp`, depois de `materializeClassGrantsAtLevel`, chamar
`materializeApparitionSpells(targetLevel)` guardado por
`attunedApparitionItems(doc).length > 0` (não dispara para classes sem aparição atunada).

**TDD**: como nenhum `.svelte` deste repo é montado em teste (convenção já estabelecida em
`planColumn-variant-rules.test.ts`), o teste novo lê o source, extrai o corpo de
`handleLevelUp` por brace-matching e afirma as duas chamadas (a pré-existente, que não pode
regredir, e a nova). Rodei o teste ANTES do fix: 2 dos 3 casos vermelhos pelo motivo certo
("expected … to match /materializeApparitionSpells.../" — a chamada realmente não existia).
Depois do fix: os 3 verdes.

## C7 — detalhe

Não é um conserto de código — é reproduzir a prova "Vivo"/"Olhado" que a revisão cobrou, no
pin ATUAL (satélite pós-N2). As fotos anteriores (`evidencia-viva.md`) eram de antes do fixer
r1 inteiro. Refiz do zero com um ator LIMPO (`Fixer_o4b_r2`, criado por seed direto no banco,
sem o Barbarian fantasma nem o Knock pré-resolvido que contaminavam o "Novo Ator" usado antes)
e provei, com servidor+browser reais:
- **C2** (fixer r1): escolher a 1ª aparição e ver o Patamar 1 na aba Magias SEM reabrir a
  ficha.
- **N2** (este fixer): subir de nível 1→2→3 pelo botão e ver o Patamar 2 (Knock) SEM reabrir a
  ficha.

Detalhe completo, prints e comandos em `evidencia-viva-r2.md`.

## Verificação

| Comando | Resultado |
| --- | --- |
| `pnpm build` (raiz, topológico) | verde |
| `svelte-check` (via `packages/client`, `--tsconfig tsconfig.json`) | 0 erros, 24 warnings pré-existentes (não relacionados) |
| `eslint` (arquivo de teste novo) | limpo |
| `depcruise --config .dependency-cruiser.cjs packages systems tools external/fusion-systems-2e/systems external/fusion-systems-2e/sheets` | "no dependency violations found" (5038 módulos) |
| `prettier --check` (arquivo de teste novo) | "All matched files use Prettier code style!" |
| `node --experimental-strip-types tools/spec-lint/bin/report.ts` | "cobertura [MVP] com teste: 710 (piso 710)" — sem mudança de specs |
| `vitest run` — `planColumn-levelup-apparition.test.ts` + `planColumn-variant-rules.test.ts` | 2 arquivos, 9 testes verdes |
| `vitest run` — `apparitionSpellcasting.test.ts` + `planVM.test.ts` | 2 arquivos, 442 testes verdes (sem regressão) |
| `pnpm --filter @fusion/sheets-pf2e test` (suíte completa do pacote, rodada uma vez pra achar falhas pré-existentes) | 25 falhas, TODAS em `pregen-parity.test.ts`/`actionCategories.test.ts`, batendo exatamente com `ficha3-reports/o0/baseline.md` (Runesmith/Necromancer sem pregen de referência, divergências de HP/skill-ceiling de dado de classe incompleto) — nenhuma delas em arquivo tocado por este fixer |
| Evidência viva (servidor real, porta 33045, ator `Fixer_o4b_r2`) | verde — ver `evidencia-viva-r2.md` |

Suíte COMPLETA do monorepo (`pnpm test` na raiz) não rodada aqui por instrução do prompt (só o
gate da onda roda a completa); rodei a completa do PACOTE tocado (`sheets-pf2e`) pra separar
regressão de ruído pré-existente.

## Pendências para issue

Nenhuma nova. As pendências já registradas em rodadas anteriores (`T4.4-aparicoes.md`,
`evidencia-viva.md` — defeito do picker de Classe deixando item fantasma) continuam válidas e
não foram tocadas por este fixer.

## Decisões e porquês

- Não estendi o guard de N2 para o path de edição direta de nível (`CharacterSheet.svelte`
  `handleLevelCommit` → `vm.updateLevel`) — o achado N2 nomeou explicitamente
  `PlanColumn.svelte`'s `handleLevelUp` como dono, e esse é o único ponto de chamada de
  `levelUp(opCtx)` nesse arquivo. Estender para o campo de nível direto seria bom saneamento
  mas é escopo além do achado confirmado; registrado aqui em vez de silenciosamente ignorado.
- Ator de evidência criado do zero (seed direto no banco, servidor parado durante o seed) em
  vez de reaproveitar "Novo Ator" — ele já carregava o defeito do picker de Classe (item
  fantasma) e o repertório de Crafter já resolvido por um teste anterior fora de um level-up
  real, o que mascararia justamente o que C7 pede pra provar.
