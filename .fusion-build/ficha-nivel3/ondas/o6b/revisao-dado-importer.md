# Revisão adversarial o6b — lente DADO + IMPORTADOR + INTEGRIDADE

Veredito: **sem achados nesta lente.** Não há superfície de dado, de importador nem de pack no diff.

## O que foi conferido
- Satélite `external/fusion-systems-2e`: `git diff origin/main...ficha3/o6b` está **vazio**. `ficha3/o6b` = `5a93903` = `origin/main` (merge do PR #117). Nenhum pack, nenhuma curadoria, nenhuma tradução, nenhum importador tocado.
- Core `git diff origin/alfa/app...ficha3/o6b` (commit único `d848ce08`): 3 arquivos, e só isso: `docs/design/ficha-nivel3/tasks.md` (linha T6.5), `ContactsPanel.test.ts` (+64), `player-character-create.test.ts` (+126/-1). O pin do submodule não mudou, e nem `packs/`, `tools/` ou `curation/`.
- Integridade da fixture: `BLANK_NEW_PLAYER` (sem `system`/`img`, `ownership {default:0, owner:3}`, `flags.fusion.playerId`) confere com o que `UserService.createUser` grava de fato (`packages/server/src/auth/service.ts:308-329`). `DocumentStore.create` não injeta `system` nem `img` por padrão: o grep em `documents/store.ts` só acha `systemId/systemVersion` em `_stats`. A fixture é a forma real de produção, não uma inventada.
- Vacuidade do teste de redação: o teste do "outsider" (`some(...)===false`) poderia passar vazio se `actorDocsIn` lesse a chave errada do snapshot. Não é o caso: o teste do dono, que usa a mesma função, exige `toBeDefined()` e `OWNER`, o que prova que a forma `payload.snapshot.documents.Actor` está correta.
- Rodei isolado `vitest run src/__tests__/player-character-create.test.ts`: 17/17 verdes, sem regressão.
- O "29 classes" na T6.5 bate com o escopo declarado no topo do tasks.md (Onda 0, T0.1).

## Observação fora da lente (não é achado)
- `wt-d` tem `tools/importer-pf2e/` não rastreado (resíduo pré-F4). Não entra no diff e é o mesmo estado do repo principal. É ambiente, não entrega.
