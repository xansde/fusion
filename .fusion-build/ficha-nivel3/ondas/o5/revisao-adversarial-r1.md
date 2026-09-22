# Re-verificação adversarial — O5, rodada 1

Alvo: satélite `ficha3/o5` 86bbe99..c9e3372 (commits 7bb370e, ba0c16a, 47ce479, b382cf5, c9e3372) + pin do core ae1a2c32 em wt-c.

## Testes rodados (só os afetados)
- `vitest run planVM.test.ts grantMaterializer.test.ts` (sheets/pf2e): 489/489 verdes.
- `node --test grafo-de-feats.test.mjs` (importer): 31/31, assert de volta em 118.
- Comparação `_id` a `_id` do `feats-core/documents.json` contra 80740cc: 2759 → 2922, added=163, changed=0, removed=0.
- Consistência `index.json` × `documents.json` do feats-core: **8 divergências** (na base 80740cc: 0).

## Veredito por achado
| Achado | Estado | Evidência |
|---|---|---|
| C-1 | FECHADO | grantMaterializer 75/75; as 4 dedicações resolvidas saíram do census e os 4 alvos novos entraram com o motivo já registrado na allowlist (b3e6a24). Menor: nenhuma issue aberta para esses gaps, e o motivo "classFeature de nível 4+" da Catharsis Emotion é discutível (a emoção vem junto com a própria dedicação), mas já é decisão registrada da T5.1, não do fixer. |
| C-2 | **ABERTO (importante)** | documents.json restaurado (changed=0) e grafo em 118, mas o `index.json` **não** foi restaurado: 7 entradas continuam com o drift do vendor — "Cascade Countermeasure" aparece no índice como "Conjurer's Countermeasure"; Quickened Casting, Effortless Concentration, Conceal Spell e Steady Spellcasting ganharam o trait `necromancer` só no índice; Resounding Cascade ganhou `aura` só no índice. O servidor serve o índice a partir do index.json (`compendium/service.ts` `_buildIndex`, que só recorre ao documents.json quando o index.json está ausente) e o picker filtra por ele (`PlanColumn.svelte` `featDocFromIndex`). Cenário: um Necromancer abre o slot de talento de classe e vê Quickened Casting/Steady Spellcasting elegíveis por um trait que o doc não tem; o picker mostra "Conjurer's Countermeasure" (sem pt-BR) e o item materializado vira "Cascade Countermeasure". |
| C-3 | FECHADO | `planVM.ts:2357` rejeita `multiclass` no ramo archetypeFeat; os 2 testes usam os docs reais; o índice mantém o trait `multiclass` das duas, então o picker também rejeita. |
| C-4 | FECHADO | A cadeia (dedicação + seguimentos que citam um membro, iterando até estabilizar) exige ≥2; os testes de 1 seguimento (continua incompleta), 2 diretos e cadeia deixaram de ser circulares. Menor: pré-requisito composto "A or B" continua sem casar (C-7, já listado). |
| C-5 | FECHADO | `excludeSlotId` filtra o slot antes da contagem; `PlanColumn.svelte:1080` passa `slot.slotId` (formato `archetypeFeat-N`, igual à flag de build `slot`, planVM.ts:1610). |
| C-6 | **ABERTO (importante)** | O vazamento para classFeat fechou (planVM.ts:2384, pega o trait `dedication`). A metade "invisível no slot de arquétipo" continua no app real: o patch cirúrgico mexeu só no documents.json; no `index.json` a Sanguimancer Dedication (h1Zd9luvXtpuGwxH) segue com `system.traits.value: ["dedication"]`. Como o picker filtra pelo índice, o ramo archetypeFeat recusa por falta de `archetype`, exatamente o caso que o teste novo "rejects Sanguimancer Dedication when the archetype trait is missing" confirma. Os testes do conserto usam o doc cheio, não a entrada do índice, e por isso não pegaram. |

## Achados novos
Nenhum além da causa comum de C-2/C-6 (índice não regenerado). Menor: o pack.json perdeu o newline final e mudou a ordem das chaves (cosmético).

## Conserto sugerido (C-2 + C-6, mesma causa)
Regenerar `systems/pf2e/packs/feats-core/index.json` a partir do documents.json já restaurado (mesmos `indexFields` do pack.json) e acrescentar um teste de consistência índice×documentos para todo pack (nome + `indexFields`), que teria falhado aqui com as 8 divergências.
