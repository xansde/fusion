# Revisão adversarial — Onda 5 (Arquétipos padrão, variante Arquétipo Livre): parecer do juiz

**Veredito: REPROVADA.** Há 2 bloqueantes, 5 importantes e 4 menores. Nenhum achado foi refutado. O gate da onda falhou no critério "0 dedicações de multiclasse".

Verificação feita em `wt-c` (satélite HEAD 86bbe99, base 80740cc), sem editar nada.

## Confirmados

### C-1 — BLOQUEANTE — CI vermelho (grantMaterializer), classificado errado como pré-existente
Lentes: regra-pf2e B1, testes-contratos A1, costura C1.
- **Prova:** `vitest run grantMaterializer.test.ts` isolado deu 1 falha e 74 aprovados. O run 35638099655 (satélite, `ficha3/o5`) terminou em `failure`.
- **Causa:** a T5.1 mudou 8 entradas do `grant-resolution-allowlist.mjs` sem espelhar a mudança no `expectedRemainingGap`. Com isso, Harrower, Razmiran Priest e Tattooed Historian deixam de resolver o item concedido, e o jogador não recebe aviso.
- **Dono:** `fusion-systems-2e`, arquivos `sheets/pf2e/src/lib/sheets/pf2e/__tests__/grantMaterializer.test.ts:1745` e `tools/importer-pf2e/src/curation/grant-resolution-allowlist.mjs`.
- **Conserto:** resolver os 3 grants novos (Harrowing, Razmiri Mask, Storied Skin) ou registrá-los em issue. Depois, atualizar o `expectedRemainingGap` com as 8 mudanças.

### C-2 — BLOQUEANTE — regeneração do feats-core mexeu em 83 documentos fora do escopo
Lentes: regra-pf2e I2, dado-importer A1, testes-contratos A2.
- **Prova por `_id`** (origin/main × HEAD): 83 documentos pré-existentes mudaram. Em 24 mudaram as `rules`, em 9 os `prerequisites`, e 1 foi renomeado (Cascade Countermeasure → Conjurer's Countermeasure).
- **Efeito nas traduções:** recalculei com o `computeI18nSourceHash` do server. As traduções pt-BR vivas caem de **1807 para 1756**: 51 talentos passam a aparecer em inglês num mundo existente.
- **Efeito no Magus:** os talentos do Magus ficam num snapshot do vendor diferente do usado pela classe. A trava do grafo (118→110) foi rebaixada com uma justificativa que não se sustenta: as arestas somem por drift do vendor, não por ordem de inserção.
- **Dono:** `fusion-systems-2e`, arquivos `systems/pf2e/packs/feats-core/documents.json` e `tools/importer-pf2e/src/__tests__/grafo-de-feats.test.mjs:111-131`.
- **Conserto:** acrescentar só os 163 documentos novos sobre o pack anterior (ou pinar o regen no mesmo commit do vendor usado antes) e restaurar o assert em 118.

### C-3 — IMPORTANTE — dedicações de multiclasse no slot do Arquétipo Livre (critério do gate violado)
Lentes: regra-pf2e I4, dado-importer A3, evidência viva (check falho, print 03 olhado por mim).
- **Prova:** o ramo `archetypeFeat` do `isFeatEligible` só exige o trait `archetype`. Por isso, Alchemist Dedication e Rogue Dedication (`archetype`, `dedication`, `multiclass`) aparecem no nível 2.
- **Dono:** `fusion-systems-2e`, `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts:2348`.
- **Conserto:** rejeitar o trait `multiclass` no ramo `archetypeFeat` e cobrir com teste usando essas duas dedicações do pack real.

### C-4 — IMPORTANTE — a T5.3 libera uma nova dedicação depois de 1 talento de seguimento; o RAW exige 2
Lentes: regra-pf2e I1, testes-contratos A4, costura C2.
- **Prova:** `planVM.ts:3414-3441` considera a dedicação completa com um único seguimento. O próprio texto do pack diz "two other feats". O teste em `planVM.test.ts:5258` congela a interpretação errada (é circular: afirma o que o código já faz).
- **Dono:** `fusion-systems-2e`, arquivos `planVM.ts:3414` e `__tests__/planVM.test.ts:5258`.
- **Conserto:** exigir pelo menos 2 talentos do mesmo arquétipo, contando também os seguimentos em cadeia (um seguimento cujo requisito cita outro seguimento). Corrigir o teste.

### C-5 — IMPORTANTE — ao editar o slot já preenchido com a dedicação, todas as dedicações somem (acontece dentro do corte 1-3)
Lente: testes-contratos A3.
- **Prova:** `LevelCard.canEdit` liga o `onEdit` do slot preenchido, e `PlanColumn.svelte:1075` chama `getIncompleteDedications(doc)`. Essa função inclui o item do próprio slot, porque a dedicação ainda não tem seguimento. Resultado: o picker de troca do `archetypeFeat-2` fica sem nenhuma dedicação. O comentário do código afirma que isso "nunca dispara em 1-3", e isso é falso.
- **Dono:** `fusion-systems-2e`, arquivos `planVM.ts:3414` e `PlanColumn.svelte:1075`.
- **Conserto:** passar o slot em edição e excluir da contagem o item que ocupa esse slot. Cobrir com teste de troca no nível 2.

### C-6 — IMPORTANTE — Sanguimancer Dedication fica invisível no slot de arquétipo e vaza para o slot de talento de classe
Lentes: regra-pf2e I3, dado-importer A2, testes-contratos A6, evidência viva (check falho).
- **Prova:** no pack, a Sanguimancer está como `category: class`, traits `["dedication"]` (sem `archetype`), nível 2.
  - No ramo `archetypeFeat` ela é rejeitada.
  - No ramo `classFeat`, `dedication` não pertence a `KNOWN_CLASS_TRAITS`, então ela passa como talento de classe compartilhado. Isso viola a regra "dedicação não cabe em slot de classe".
- **Dono:** `fusion-systems-2e`, arquivos `tools/importer-pf2e/src/build-mvp-subset.mjs:~916` e `planVM.ts:2365`.
- **Conserto:** normalizar o trait `archetype` na importação. Além disso, fazer o ramo `classFeat` rejeitar qualquer talento com o trait `dedication`.

### C-7 — MENOR — seguimento com requisito composto "A or B" não é reconhecido
Lente: testes-contratos A5.
- **Prova:** o requisito de We're on the List é `"Alter Ego Dedication or Archaeologist Dedication"`, e a comparação é por igualdade exata.
- **Dono:** `planVM.ts:3432`.
- **Conserto:** reutilizar o separador de "or" que já existe (~3070).

### C-8 — MENOR — dedicação bloqueada some do picker sem motivo visível
Lente: costura C3.
- **Dono:** `PlanColumn.svelte:1100`.
- **Conserto:** mostrar um aviso no padrão do `showRepeatCapNotice` (#57).

### C-9 — MENOR — pré-requisito, raridade e dedicação de arquétipo de classe não são checados no pool de 166
Lentes: regra-pf2e M1, dado-importer A4.
- **Situação:** o comportamento já existia antes da onda, mas a superfície passou de ~5 para 166 dedicações.
- **Dono:** `planVM.ts:2347` e `build-mvp-subset.mjs` (`isStandardArchetypeDedication`).
- **Conserto:** abrir issue.

### C-10 — MENOR (achado do juiz) — as 163 dedicações novas não têm pt-BR
- **Prova:** o print 06 mostra "Acrobat Dedication" em inglês, e o `i18n.pt-BR.json` continua com as mesmas 1807 entradas.
- **Conserto:** abrir issue de tradução, no mesmo padrão da #58 (deities).

## Processo
- A lane de evidência viva rodou de verdade: servidor em data-dir isolado, ator real e gravação conferida no `world.db`.
- A lane **não** olhou os prints. Olhei o 03 e o 06, e os dois batem com o que foi descrito. Isso não é bloqueante.
- O `gate.md` fechou a onda sem conferir o critério de multiclasse do `tasks.md`, e a T5.2/T5.3 classificou uma falha como pré-existente com base num `git stash` que não removia o pack regenerado. Nos dois casos, o gate afirmou algo que não tinha verificado.

## Refutados
Nenhum.
