# Revisão adversarial — Onda 1 (ficha3/o1) — lente TESTE NÃO-CIRCULAR + CONTRATOS

Diffs revisados: satélite `origin/main...ficha3/o1` (8 arquivos) e core `origin/alfa/app...ficha3/o1`
(i18n + pin). Rodei, isolado, `vitest run ficha-nivel3-onda1.test.ts` → 69/69 verdes (confirma o
relatório; o problema não é o teste falhar, é ele passar com dado errado).

Veredito: **1 importante, 5 menores, nenhum bloqueante.** Nenhuma asserção existente foi
enfraquecida, pulada ou teve contagem afrouxada (o diff só adiciona testes). Contrato
core<->satélite (i18n SlotLabel das 19 chaves novas, `BuildChoice.type` é `z.string()`, schema de
`action`/`ancestry` com `passthrough`, `indexFields` de `actions-core` inclui `system.traits.value`)
está íntegro para server/client/sheets.

## A1 — IMPORTANTE — fólio do Commander aceita táticas expert/master/legendary no nível 1, e o teste constrói um fólio ilegal e fica verde

- Arquivo: `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/planVM.ts:2306`
  (`tacticKnown: { packSlug: "actions-core", traitFilter: "tactic", ... }`); comentário falso em
  `planVM.ts:2303` ("all level 1 (no expert/master/legendary tactics imported yet)").
- Fato medido em `systems/pf2e/packs/actions-core/documents.json`: das 37 ações com trait `tactic`,
  7 têm otherTags `commander-expert-tactic`, 5 `commander-master-tactic` (+1 com o typo
  `vcommander-master-tactic`: Ready, Aim, Fire!), 5 `commander-legendary-tactic`, 5 sem otherTag
  (Corpse Crenellation, For Talmandor! For Freedom!, Seek and Destroy, Shadows in the Moonlight,
  Wait For It...). Só 7 mobility + 8 offensive são legais no nível 1. O próprio doc `Tactics` de
  `class-features-core` diz: táticas expert só com Expert Tactician, master com Master Tactician,
  legendary com Legendary Tactician.
- Cenário de produção: Commander nível 1 abre o slot "Tática Conhecida" → o picker (filtro
  `isClassChoiceOption` por `system.traits.value` incluindo "tactic") lista as 37 → o jogador
  escolhe "Cry Havoc!" (legendary) → `chooseClassChoice` embute o item com `system.level` 1 →
  `checkSlotRequirement` não marca nada. Ficha ilegal, sem aviso.
- Circularidade: `ficha-nivel3-onda1.test.ts:61` só afirma `options.length > 0`, e o harness
  (`classBuildHarness.ts:503-520`) escolhe a primeira opção na ordem do pack. A primeira é
  **Alley-Oop (expert)**, a segunda **Bloody Guillotine (master)**. Ou seja, o teste "Commander
  builds L1-3 with zero findings and fills tacticKnown" passa construindo um fólio ilegal. A
  contagem de opções nunca é conferida contra a regra (o piso é 15, não 37).
- Conserto: filtrar por otherTags `commander-mobility-tactic` | `commander-offensive-tactic` (o
  mecanismo aceita só uma `category`, então é preciso lista de categorias ou `traitFilter` junto
  com um predicado de tier). Mais um teste que afirme que o conjunto é exatamente as 15 legais,
  lido de outra fonte (otherTags do pack / texto do `Tactics`), nunca do próprio filtro.

## A2 — MENOR — slots múltiplos aceitam a mesma opção repetida; o harness esconde isso e a issue #101 esquece o Commander

- Arquivos: `planVM.ts:997` (`CLASS_CHOICE_SLOT_COUNT`), `classBuildHarness.ts:520`
  (`used.add(...)`, o Set que impede repetição só no teste), e os testes de ikon, apparition e
  tacticKnown em `ficha-nivel3-onda1.test.ts`, que afirmam slot ids distintos
  (`ikon-1-0/1/2`) e nunca opções distintas.
- Cenário: o Commander escolhe "Strike Hard!" em `tacticKnown-1-0` até `tacticKnown-1-4` → o
  `pickerConfigFor` não exclui irmãos, e `isFeatAtRepeatCap` não faz nada para doc que não é
  `feat` → 5 cópias da mesma tática no fólio. Com Ikon (3) e Apparition (2) é igual. A issue
  `fusion-systems-2e#101` cita só Ikon e Apparition. Falta incluir `tacticKnown` nela.

## A3 — MENOR — `CHOICE_SET_INVENTORY` ficou desatualizado: os eixos cabeados continuam "pendente"

- Arquivo: `sheets/pf2e/src/lib/sheets/pf2e/choiceSetInventory.ts:327-414` (ex.:
  `Tactics/firstTactic..fifthTactic`, `Druidic Order/druidicOrder`, `Mystery/mystery`,
  `Divine Spark and Ikons/firstIkon..thirdIkon`, `Swashbuckler's Style/...`).
- Cenário: o teste `choice-sets.test.ts` ("registra as escolhas pendentes") imprime como dívida
  escolhas que a ficha já oferece. Pelo contrato do próprio arquivo, `eixo` quer dizer "já vira
  slot de sub-escolha". Quem triar a fila de pendentes vai trabalhar de novo em escolha já
  resolvida. Precisa promover para `eixo` as entradas dos 19 eixos (Tactics é o caso que o
  inventário lista como 5 flags).

## A4 — MENOR — `derived.languages` fora do contrato tipado `CharacterDerived`

- Arquivos: `systems/pf2e/src/derivations/types.ts:287` e `sheets/pf2e/src/lib/sheets/pf2e/derivedTypes.ts:168`
  (sem `languages`); `characterSheetVM.ts:2182` lê `this._system["derived"]["languages"]` por
  cast cru, sem passar por `_derived: CharacterDerived`.
- Cenário: um rename da chave no step (`character.ts`, `writes: system.derived.languages`)
  compila e passa no typecheck. A ficha passa a mostrar a linha de Idiomas vazia e nenhum teste
  cai, porque não há teste do getter `languages` no VM e o teste do step usa um item montado à
  mão, não o `applyAncestry` real. Conserto: adicionar `languages: string[]` aos dois
  `CharacterDerived` e ler via `_derived`, com um caso no `characterSheetVM.test.ts`.

## A5 — MENOR — idiomas aparecem como slug cru na ficha em pt-BR

- Arquivo: `sheets/pf2e/src/components/sheets/pf2e/CharacterSheet.svelte:986`
  (`vm.languages.join(", ")`).
- Cenário: Ratfolk em pt-BR → a ficha mostra "Idiomas: common, ysoki". Não existe mapa de
  tradução de idioma no diff nem no i18n do core. É o mesmo tipo de defeito que o label
  traduzido ("Idiomas") queria evitar.

## A6 — MENOR — o gate explica errado por que os testes do `traitNames.sync` sumiram

- Arquivo: `ficha3-reports/o1/gate.md` diz que as 2 falhas de `client/traitNames.sync.test.ts`
  foram "corrigidas pelo commit 51696f79 (… regeneração de traitNames.ts)". Mas o
  `git show --stat 51696f79` mostra só `en.json`/`pt-BR.json` (+1 linha cada), e nenhum commit da
  onda mexe em `traitNames.ts`.
- Cenário: a melhora vem do ambiente (worktree/untracked `tools/importer-pf2e`) e não do código.
  Então, no CI a partir do remoto, as 2 falhas voltam e a comparação "sem regressão" do gate fica
  apoiada numa causa que não existe. Antes de usar essa comparação no PR, rodar o arquivo isolado
  a partir de um clone limpo.

## O que conferi e está OK (sem achado)

- As 19 entradas novas de `CLASS_CHOICE_SLOTS` batem com `featuresByLevel` reais (cada nome
  aparece em uma classe só, no nível declarado). O prefixo de `category` deriva a classe certa em
  `CHOICE_SLOT_REQUIRED_CLASS` para todas, e as contagens de opções batem com o pack (6/6/5/16/9/
  11/6/4/14/4/4/4/15/10/2/4/21/6), todas no nível certo.
- Não há quebra de compatibilidade no id de slot: eixo de escolha única mantém `<tipo>-<nível>`.
  O 5º parâmetro de `chooseClassChoice` é opcional e o PlanColumn passa o `slot.slotId` real.
- `resolveAxisChoice` só devolve a 1ª escolha de um eixo múltiplo, mas hoje nenhum
  `condition.axis` usa os eixos novos (só `cleric.json`). É latente, sem cenário de produção hoje.
