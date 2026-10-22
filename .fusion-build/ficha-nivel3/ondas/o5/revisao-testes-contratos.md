# Revisão adversarial — Onda 5 (lente: teste não-circular + contratos)

Revisor somente-leitura. Satélite `ficha3/o5` @ `86bbe99` contra `origin/main`; core `ficha3/o5` contra `origin/alfa/app` (o core só muda o pin do submodule — sem contrato de tipo/schema/API alterado: `indexFields` do `feats-core` iguais, schema `item-feat` intocado, `isFeatEligible` só ganha opção opcional; nenhum consumidor no server/client quebra).

Evidência reproduzível: árvores extraídas via `git archive` em `scratchpad/rev-o5/{origin_main,ficha3_o5}` + scripts `g.mjs`/`h.mjs`/`k.mjs` (grafo de feats nas duas revisões).

## A1 — BLOQUEANTE — `grantMaterializer.test.ts` vermelho: regressão da T5.1, rotulada "pré-existente"

- Arquivo: `sheets/pf2e/src/lib/sheets/pf2e/__tests__/grantMaterializer.test.ts:1724-1745`.
- Rodado isolado agora: `1 failed | 74 passed`. Diff:
  `- Battle Harbinger Dedication, - Munitions Master Dedication, - Palatine Detective Dedication, - Spellshot Dedication, + Catharsis Emotion, + Harrowing, + Razmiri Mask, + Storied Skin`.
- Baseline da O0 (`ficha3-reports/o0/baseline.md`) lista só `traitNames.sync`, `actionCategories`, `pregen-parity` — **não** `grantMaterializer`. A "confirmação pré-existente" da lane T5.2 foi um `git stash` só do diff da T5.3, com a T5.1 já commitada; a falha é causada pela T5.1 (as mesmas 8 mudanças que ela aplicou no `grant-resolution-allowlist.mjs`, sem espelhar no `expectedRemainingGap` do teste). O gate herdou o rótulo errado.
- Cenário: CI do satélite roda a suíte → PR da onda vermelho; ou, pior, alguém "resolve" afrouxando o guard.
- Conserto: atualizar a lista esperada (4 saem, 4 entram) com o mesmo comentário do allowlist.

## A2 — IMPORTANTE — T5.1 reescreveu 83 documentos JÁ EXISTENTES do `feats-core`; a asserção do grafo foi baixada 118→110 com justificativa falsa

- A lane afirma "diff cirúrgico": reverteu os outros packs para não herdar o drift da #123. Mas o próprio `feats-core` foi regenerado do vendor no pin `98cb84f` (2026-08-23), mais novo que o snapshot usado no pack de `origin/main`. Comparando por `_id` (0 removidos): **83 docs pré-existentes mudaram** — `system.rules` em 24 (ex.: Iron Fists, Blood Rising, Tusks (Orc), One-Inch Punch…), `system.prerequisites` em 9 (Fused Staff `[Spellstrike]→[]`, Dazzling Block perde `Arcane Cascade`, Steal Essence funde dois requisitos num "or"), `traits` em 5 (Quickened Casting ganha `necromancer`), 1 renomeação (`Cascade Countermeasure → Conjurer's Countermeasure`, enquanto `spells-core` e `i18n.pt-BR.json` continuam com o nome antigo), 51 descrições (o pt-BR fica traduzindo o texto velho), 15 flags (Iron Fists `conversion: partial→full`).
- `tools/importer-pf2e/src/__tests__/grafo-de-feats.test.mjs:130` — comentário diz que a queda para 110 é "ordem de inserção do universo global… não porque uma ambiguidade parou de ser marcada". Medido: o Magus cai de **62 para 54 arestas** — as 8 arestas ambíguas perdidas (Arcane Cascade/Spellstrike → Dazzling Block, Sustaining Steel, Arcane Shroud, Devastating Spellstrike, Starlit Eyes, Cascade Countermeasure, Fused Staff, Standby Spell) **deixaram de existir** porque o vendor novo apagou esses pré-requisitos. A asserção travada existe exatamente para gritar numa mudança dessas; foi baixada com motivo inventado.
- Cenário em produção: pack `feats-core` passa a vir de um snapshot do vendor e `class-features-core`/`spells-core`/`actions-core` de outro (mistura que a #123 queria evitar); 24 regras de mecânica mudam sem teste nem registro; o talento renomeado aponta para magia que o `spells-core` não tem com esse nome.
- Conserto: ou gerar só as 163 dedicações novas sobre o `feats-core` antigo (mantendo os 2759 docs byte-idênticos), ou declarar e revisar a atualização do vendor como mudança própria (lista das 83, corrigir o comentário do grafo com a causa real, issue).

## A3 — IMPORTANTE — Regra T5.3 bloqueia a TROCA da própria dedicação no nível 2 (dispara dentro do recorte 1-3)

- `sheets/pf2e/src/components/sheets/pf2e/plan/PlanColumn.svelte:1075` calcula `getIncompleteDedications(doc)` com o ator inteiro, **incluindo o item do slot que está sendo reaberto**; `planVM.ts:2357-2362` rejeita qualquer candidato com trait `dedication` se a lista não for vazia.
- Slot preenchido editável abre o mesmo picker (`LevelCard.svelte:126` `onEdit` → `handleSlotClick` → `slotPicker`; `chooseFeat` já suporta substituir).
- Cenário: Arquétipo Livre ligado, nível 2, `archetypeFeat-2 = Acrobat Dedication`. Clicar no slot para trocar → `incompleteDedications = ["Acrobat Dedication"]` → as 168 dedicações somem; sobram só os 6 talentos de arquétipo não-dedicação de nível ≤2 (Dueling Acumen, Familiar Oddities, Fresh Ingredients, Malleable Movement, Embed Aeon Stone, Express Driver), nenhum deles pegável sem a dedicação. O relatório afirma "nunca dispara no recorte 1-3" — falso. Os testes novos só exercitam `isFeatEligible` com lista injetada, nunca o picker de um slot preenchido.
- Conserto: excluir o item do slot em edição (`slot.itemId`) do cálculo, com teste pelo caminho do slot preenchido.

## A4 — IMPORTANTE — T5.3 implementa "1 talento de seguimento"; o RAW exige 2

- `planVM.ts:3393-3441` (docstring: "the dedication plus one follow-up") e o teste `planVM.test.ts` "returns [] once a follow-up feat naming the dedication is also picked" codificam a regra errada. PF2e (Player Core, Archetypes; igual ao CRB p. 219): não se pode escolher outra dedicação "until you have gained **two other feats** from your current archetype". O plano ("até pegar 2 talentos dela") é ambíguo; a leitura adotada contraria a regra.
- Cenário: Arquétipo Livre, nível 6: `archetypeFeat-2 = Aldori Duelist Dedication`, `archetypeFeat-4 = Dueling Acumen` → no `archetypeFeat-6` o picker oferece `Bright Lion Dedication`; RAW proíbe.
- O teste é circular nesse ponto: afirma o comportamento que o próprio código escolheu, sem fonte de regra.

## A5 — MENOR — Detecção de seguimento por igualdade exata ignora requisito "A or B" dos dados reais

- `planVM.ts:3432-3436` compara `prerequisites[].value` inteiro com o nome da dedicação. No pack real existem requisitos compostos ("Alter Ego Dedication or Archaeologist Dedication" — We're on the List; "Assassin Dedication or Scout Dedication" — Eclipsed Vitality). O módulo já tem splitter de "A or B" (`planVM.ts:~3070`) e normalização (`:2755`), não reusados.
- Cenário (nível 4+): Alter Ego Dedication + We're on the List (+ outro) → dedicação continua "incompleta" para sempre, bloqueando nova dedicação. Fixtures dos testes nunca usam o formato real composto.

## A6 — MENOR — Sanguimancer Dedication importada mas inalcançável no picker

- O importador aceita dedicação sem trait `archetype` (`build-mvp-subset.mjs:~916`, justamente para bater 167), mas o consumidor exige `traits.includes("archetype")` (`planVM.ts:2356`). Pack real: `Sanguimancer Dedication` é a única com `dedication` sem `archetype`.
- Cenário: Arquétipo Livre, nível 2 → Sanguimancer não aparece no picker. A contagem 167 é verdade no pack e mentira na ficha.

## Checados sem achado

- Contrato core↔satélite: core só move o pin; `pack.json` do `feats-core` mantém `indexFields`/`schemaVersion`; schema `prerequisites` (array de `{value}`) confere com o formato que `getIncompleteDedications` lê.
- `choiceSetInventory.ts`: 27 ChoiceSets novos marcados `pendente` — dívida declarada, não enfraquece o guard.
- `grant-resolution-allowlist.mjs`: remoção das 4 entradas da #92 é coerente com o resultado real (os 4 alvos resolvem agora).
- Nenhum `skip`/`only` novo; contagem de `pregen-parity` igual ao baseline.
