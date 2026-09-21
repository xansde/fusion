# O6 — Revisão adversarial, rodada 2

Alvo: satélite `3939aa1` (build-validation.ts + testes) e core `10ebb270` (teste de integração + pin).
Sonda: `probe-r2/probe.mjs`, rodada contra o `dist` recompilado (o dist contém `checkItemSlots`).

## Veredito por achado

| id | estado | evidência |
|---|---|---|
| C4 | FECHADO | `checkItemSlots` itera `doc.items` e valida todo item com `flags.fusion.build.slot` no formato `<type>-<level>`, sem depender de choice. O `handleEmbeddedCreate` (`doc-handlers.ts:1754-1758`) chama `rejectIllegalCharacterBuild` ANTES do `store.update` (l.1762), então o item recusado não persiste. Sonda P2 (mesmo payload que na r1 dava `ok:true`) agora dá `["FEAT_SLOT_MISMATCH"]`. Teste de integração "DENIES the embedded doc:create itself ... NO choice sent at all" passa (porta real, socket). |
| N1 | FECHADO | `FEAT_LEVEL_EXCEEDS_SLOT_LEVEL`: `system.level` do talento > nível do slot. Sonda P3 (talento nível 20 em `classFeat-1`, que na r1 dava `ok:true`) → recusado; P3b (nível 4 em `classFeat-2`) → recusado; P3c (nível 2 em `classFeat-2`, personagem desceu ao nível 1) → aceito, então o C2 não reabre. Os packs guardam `system.level` como número (0 de 2759 talentos do feats-core fogem disso), logo a checagem não é código morto. |

Testes rodados: `build-validation.test.ts` 28/28; `player-character-create.test.ts` 14/14.
Prova de vermelho sem o conserto: a sonda da r1 (`probe-r1`) registrou P2 e P3 como `ok:true` no código anterior. Os mesmos casos na sonda r2 agora voltam com issue.

## Ataque ao diff do conserto

- **Falso positivo no fluxo real:** nenhum encontrado. O `isFeatEligible` do picker é mais estrito que o `matchesFeatSlot` em todos os tipos de slot. Itens concedidos (`buildGrantCreateOp`) não recebem `flags.fusion.build`. Sub-slots (`<slot>:grant...`, `:impulse:`), `class:*`, `classLevel-N`, `gateThreshold-N` e `hybridStudy` são ignorados pelo padrão ou pelo `FEAT_SLOT_TYPES` (sonda F2). Dedicação em `classFeat` e talento de perícia em `generalFeat` passam (F4, F5), conforme o Player Core.
- **Chave de "issue nova" no core** (`code|path`, com o path usando o índice do item): o create embutido anexa no fim e o update embutido não reordena, então as chaves das issues antigas não mudam nessas portas. Não há regressão nova.
- **Menor (M1), endurecimento:** `buildLevel` confia em `flags.fusion.build.level`, que vem do cliente, e só usa o nível do id do slot como fallback. Um payload forjado com `{slot:"classFeat-1", level:20}` e um talento de nível 20 passa (sonda F1). Impacto baixo: o `resolveSlot` exige `flag.level === nível do slot`, então esse item não ocupa o `classFeat-1`. Ele fica tão fora do build quanto um talento embutido sem flag nenhuma (F3), e essa lacuna já é aceita (modo manual r9 ou importToActor). Conserto sugerido: usar `min(slotLevel, flagLevel)` ou recusar quando os dois divergem.
- **Menor (M2), teste:** o teste de integração do C4 diz "Nothing persisted", mas não confere isso (nenhum assert de versão ou de itens depois da recusa). Pela leitura do código, a recusa sai antes do `store.update`, então o comportamento está certo. O que falta é a prova no teste.
- A pendência que o fixer registrou (personagem sem `system.build` isento) é do mesmo tipo que F3 e N3 da r1. Não é achado novo bloqueante nem importante.

## Conclusão
Nada bloqueante nem importante ficou aberto. Os dois itens M1 e M2 são menores.
