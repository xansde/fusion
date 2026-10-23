# O2 (Conjuração) — Fixer, rodada 3

Worktree: `wt-o0-grants` (core branch `ficha3/o2`, satélite `external/fusion-systems-2e` branch `ficha3/o2`).
Ambos pushados (`gh auth switch -u xansde` antes).

- Satélite: `f3d810d`..`e05a362` (2 commits), push `f3d810d..e05a362`.
- Core: `35ebbae8`..`bea5bc49` (1 commit: repin), push `35ebbae8..bea5bc49`.

Alvo: os 2 achados confirmados de `revisao-adversarial-r2.md` (N1 bloqueante, N2 importante).

## Tabela achado → commit → teste

| id | severidade | achado | commit(s) | teste que prova |
|---|---|---|---|---|
| N1 | bloqueante | Truque aprendido pelo espontâneo ficava invisível — `spellcastingEntries` agrupava cada magia pelo seu `system.level` cru, mas o pack real armazena truques ranqueados ≥1 (Daze é `level: 1`) e os distingue só pelo traço `cantrip`; o item caía no balde do círculo 1, sem botão Lançar/Remover, fora da seção Truques e fora do círculo 1 (que lê `spellsKnown[1]`, enquanto o picker grava em `slots.0.spellsKnown`). A guarda de duplicata (`knownSpellsAt` cruzando `slot.spells`×`slot.spellsKnown`) também nunca encontrava o item, deixando cada clique em "Aprender truque" empilhar cópias invisíveis até o teto. | satélite `5ef4cb8` | `characterSheetVM.test.ts` — novo teste em `describe("CharacterSheetVM — spellcastingEntries")`: constrói o doc com o item REAL de Daze lido de `spells-core/documents.json` (não fixture moldada pelo código sob teste); confirma bucket rank-0 contém "Daze", rank-1 não contém, a guarda de duplicata resolve o id, e a `heightening` view está presente. Confirmado vermelho pelo motivo certo antes do fix (`git stash` do source): `expected [] to include 'Daze'`. |
| N2 | importante | O picker de "preparar" (círculo ≥1 do caster preparado) continuava listando truques — o conserto do C3 (rodada 2) só setou `cantripOnly=false` para `pickerMode==="known"`; `pickerMode==="prepare"` ficava sem filtro (`undefined`), então um Mago abrindo "Buscar no compêndio" num espaço vazio de 1º círculo via os 63 truques de nível 1 do pack (Daze, Detect Magic…) listados como magias de 1º círculo, e podia preparar um truque num espaço de círculo 1. | satélite `e05a362` | `characterSheetVM.test.ts` — novo `describe("resolveSpellPickerCantripOnly")`: 4 modos cobertos + teste não-circular sobre o índice REAL do spells-core provando que um picker "prepare" em `maxRank:1` não retorna nenhum truque. Confirmado vermelho pelo motivo certo antes do fix (`TypeError: resolveSpellPickerCantripOnly is not a function` — a lógica ainda vivia como ternária inline não testável no `.svelte`). |

## O que mudou (resumo técnico)

- **N1**: nova `spellSystemIsCantrip(system)` em `characterSheetVM.ts` (espelha `pickerIsCantrip`, já usada pelo picker desde o C3) lê `system.traits.value.includes("cantrip")`. No laço de agrupamento de `spellcastingEntries`, o bucket de rank vira `isCantrip ? 0 : spLevel`, onde `isCantrip = spellSystemIsCantrip(spSys) || spLevel === 0` — o `|| spLevel === 0` é **aditivo**, preserva o comportamento de dados/fixtures antigos com `level: 0` (que `_healSpellSystem` não toca quando não há resolver de heal, como em teste) sem depender só do traço. A mesma condição agora também decide se a `heightening` view (auto-scale de truque) é calculada — antes só rodava para `spLevel===0`, deixando de fora qualquer truque real do pack (todos ranqueados ≥1).
- **N2**: a decisão de qual `cantripOnly` passar ao `SpellPickerDialog` sai da ternária inline do `SpellsTab.svelte` e vira `resolveSpellPickerCantripOnly(pickerMode, isCantripPick)`, função pura exportada de `characterSheetVM.ts` (mesmo padrão de `pickerIsCantrip`/`filterSpellPicker`) — extraída porque o pacote não tem infraestrutura de teste de componente Svelte (mesma lacuna do C3/fix-r1), e uma função pura é testável sem ela. Regra: `"known"` → `isCantripPick`; `"prepare"` → sempre `false`; `"add"`/`"focus"` → `undefined` (sem filtro).

## Gates da rodada (raiz do core, estado final pós-2-commits)

Todos verdes:
- `pnpm build` — client+server+shared+system-api+systems 2e OK (rodado duas vezes: após cada metade do fix, sem erro).
- `pnpm typecheck` — OK, exit 0.
- `pnpm lint` — OK, exit 0 (1 warning pré-existente em `pregen-parity.test.ts`, mesmo arquivo já sinalizado em fix-r1/fix-r2, não tocado nesta rodada).
- `pnpm lint:boundaries` — OK, 0 violações (5027 módulos, 12116 dependências).
- `pnpm format:check` — OK.
- `pnpm spec:report` — OK, cobertura MVP 710 (piso 710, sem regressão — igual ao fix-r2).

## Testes rodados (afetados, não a suíte completa)

- `sheets/pf2e` `characterSheetVM.test.ts` — **243 testes, 243 ok** (237 da rodada anterior + 6 novos: 1 do N1, 5 do N2).
- `sheets/pf2e` `planVM.test.ts` — **417 testes, 417 ok** (não tocado nesta rodada, rodado por afetar o mesmo módulo de VM).
- `sheets/pf2e` `varredura-classes.test.ts` — **190 testes, 190 ok** (idem).
- Total do lote: **850/850 verde**.
- TDD verificado: reverti temporariamente cada metade do fix (`git stash`/edição inversa) e confirmei os 6 testes novos vermelhos pelo motivo certo antes de restaurar — N1 com asserção falhando (`expected [] to include 'Daze'`), N2 com `TypeError` (função ainda não existia).

## O que não foi testado (limite conhecido, não escondido)

- **N2**: a extração para `resolveSpellPickerCantripOnly` é testada por unidade, mas a wiring real do `<SpellPickerDialog cantripOnly={...}>` dentro do `.svelte` não tem teste de componente — mesma lacuna do C3 (fix-r1/fix-r2). Recomendo a skill `tutorial-e2e` numa rodada futura para fechar com prints reais (Mago preparando um espaço de 1º círculo, confirmando que nenhum truque aparece na lista).

## Achados avaliados e considerados corretos (não contestados)

Nenhum dos 2 achados desta lista foi considerado incorreto — ambos reproduzidos e consertados como descrito na revisão adversarial r2.

## Pendências para issue

Nenhuma nova nesta rodada. Seguem de pé, fora do escopo (não atribuídas a este fixer):
- N3 (menor, `revisao-adversarial-r2.md`): `levelSet` usa a 1ª classe do doc para re-sincronizar `repertoireBonus` em TODA entrada não-foco — quebra em multiclasse por níveis com duas entradas espontâneas de classes diferentes (ex. Bardo 1ª + Psychic). Mesmo padrão herdado que `syncSlotMaxOp` já tinha.
- Pendências nº 1, 3, 4 do `fix-r1.md` (Animist metade espontânea; `chooseClassLevel` multiclasse sem teste dedicado; `restAll` sem teste unitário dedicado) — seguem fora do escopo desta rodada.
- C8 (Animist fora de "Destrava" em tasks.md/plano.md) — não atribuído a esta rodada.

## Arquivos tocados

Satélite (`external/fusion-systems-2e`):
- `sheets/pf2e/src/lib/sheets/pf2e/characterSheetVM.ts`
- `sheets/pf2e/src/components/sheets/pf2e/SpellsTab.svelte`
- `sheets/pf2e/src/lib/sheets/pf2e/__tests__/characterSheetVM.test.ts`

Core:
- `external/fusion-systems-2e` (pin)

## Impacto no fluxo de criação/subida de personagem

`tocou_fluxo_criacao = true`: os dois consertos mudam `characterSheetVM.ts` (VM que a ficha lê ao vivo — agrupamento de magias/truques por entrada de conjuração) e `SpellsTab.svelte` (UI de magias da ficha), caminhos que a criação/uso de personagem espontâneo/preparado executa diretamente (aprender truque, ver a seção Truques, abrir o picker de preparar).
