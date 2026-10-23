# Revisão adversarial o3 — lente: teste não-circular + contratos

Diffs revisados: core `origin/alfa/app...ficha3/o3` (d6bc3ec4), satélite `origin/main...ficha3/o3` (2f1d895).
Somente leitura; a única execução foi um `node` isolado contra `systems/pf2e/dist/companion-grant.js` e os packs reais.

## Veredito

A parte do eidolon (Summoner) está sólida: a autorização no servidor lê o item de classe, que é
exatamente o que o `applyClass` envia. Os testes do satélite usam os documentos reais de
`classes-core`, e o teste do servidor passa pelo handler real. O problema está na **Witch (T3.3)**:
a premissa da DEC-PET-04 ("a autorização lê o item de classe persistido") é **falsa para o
familiar**, e nenhum teste cobre esse caminho. Os testes da Witch só conferem o mapeamento
sourceId→kind.

## Achados

### A1 — importante — O auto-create do familiar da Witch depende de uma classFeature que o retry não espera, e nenhum teste cobre isso

- Arquivos: `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/petsVM.ts` (`sendAutoCompanionOp`,
  retry de 5 tentativas com espera de 200·n ms, cerca de 2 s no total);
  `sheets/pf2e/src/components/sheets/pf2e/plan/PlanColumn.svelte:~938` (`void materializeClassGrants(doc2); void autoCreateClassCompanion(doc2);`);
  `systems/pf2e/src/companion-grant.ts:57-59` (familiar → `detectFamiliarGrant`).
- Evidência executada: com os packs reais, `companionGrantAllows("familiar", {items:[WitchClass]})`
  retorna **false**, e `{items:[WitchClass, "Familiar (Witch)"]}` retorna **true**. O item de classe
  da Witch tem `rules: []`. O sinal que libera o familiar é a regra `familiarAbilities` da
  classFeature "Familiar (Witch)", que só entra no ator pelo `materializeClassGrants`. Esse caminho
  roda em paralelo, faz `await resolvePackIndex/resolveGrantDoc` para cada feature (Witch
  Spellcasting vem antes) e usa o funil fire-and-forget `sendOpFn`.
- Cenário: um jogador escolhe Witch numa ficha nova. Se o índice de `class-features-core`, a
  resolução das features e a gravação de "Familiar (Witch)" passarem de uns 2 s (primeiro load do
  índice pelo socket, servidor sob carga, conexão remota por túnel), as 5 tentativas recebem
  "Master has no grant for a companion of kind \"familiar\"". O resultado é só um
  `console.warn`, e a Witch fica sem familiar. O heal (`runHealAutoCompanion`) roda uma vez por
  abertura (`healedActorId`) e já rodou antes da escolha da classe, então só corrige quando a
  ficha for reaberta. Se "Familiar (Witch)" não resolver no pack, o familiar nunca nasce, e o erro
  continua silencioso.
- Por que os testes não pegam: `petsVM.test.ts` simula a corrida só com a mensagem do
  **eidolon**, e os testes de `sendAutoCompanionOp` usam um `send` falso.
  `planColumn-auto-companion.test.ts` é um regex sobre o código-fonte. `companion-eidolon.test.ts`
  (servidor) não tem nenhum caso da Witch. A spec (DEC-PET-04/REQ-PET-096) e o relatório dizem que
  "cada tentativa É a re-checagem… a espera nunca passa do round-trip do item de classe". Para a
  Witch isso é falso: o que falta é a classFeature, não o item de classe.
- Conserto sugerido: encadear o auto-create **depois** do `await materializeClassGrants(doc2)`
  (que por sua vez precisa aguardar o ack do create da feature) ou incluir a Witch no detector por
  sourceId de classe, como o eidolon. Falta também um teste de servidor, com os packs reais, em que
  um mestre só com o item de classe Witch cria o familiar, e que hoje falharia.

### A2 — importante — O familiar da Witch nasce, e continua depois do resnap, com orçamento de 2 habilidades, ignorando a regra da própria classFeature

- Arquivos: `sheets/pf2e/src/lib/sheets/pf2e/petsVM.ts:260` e `systems/pf2e/src/familiar-grant.ts`
  (`if (typeof v === "number" && v > maxBump)`); `petsVM.ts:433-436` (create) e `:534-555` (resnap).
- Evidência: o `value` da regra de "Familiar (Witch)" em `class-features-core` é a **string**
  `"2 + min(3,floor(@actor.level / 6))"`, com `mode: "add"` sobre `familiarAbilities`. O detector
  só soma números, então `maxBump` fica 0 e o orçamento fica em 2. Além disso, o
  `autoCreateClassCompanion` passa `masterDoc: doc`, que é a foto de **antes** da classe.
- Cenário: numa Witch de nível 1, o dado do vendor dá 2 + 2 = 4 habilidades de familiar (5 no
  nível 6). O ator nasce com `abilitiesBudget {2,2}`, o resnap da aba Pets recalcula 2 de novo, e
  o `FamiliarAbilityPicker` trava na 2ª habilidade. A nota da T3.3 no plano cita justamente
  `familiar-abilities-core` / o builder. Hoje o familiar existe, mas errado.
- Não há teste: nenhum caso cobre o orçamento de um mestre Witch.

### A3 — menor — O espelho `SUMMONER/WITCH_CLASS_SOURCE_ID` no petsVM é testado contra ele mesmo

- Arquivo: `sheets/pf2e/src/lib/sheets/pf2e/__tests__/petsVM.test.ts` (bloco `autoCompanionKindForClass`).
- O teste importa as constantes do próprio petsVM e confere `autoCompanionKindForClass(CONST)`,
  o que é circular. Só `companion-grant.test.ts` (no systems) compara com o sourceId real do pack.
- Cenário: um reimport troca o sourceId da Witch. Alguém atualiza `companion-grant.ts`, porque o
  teste do systems quebra, e esquece o espelho no petsVM. O servidor passa a aceitar, mas o client
  nunca dispara o auto-create, e a suíte continua verde. Conserto: fazer o teste do petsVM ler
  `classes-core/documents.json`, como o do systems faz.

### A4 — menor — O contrato de erro core↔satélite está em substring de mensagem, não em código

- Arquivos: `petsVM.ts` (`sendAutoCompanionOp`: `includes("has no grant for a companion")` /
  `includes("already has a companion")`) × `packages/server/src/net/handlers/doc-handlers.ts`
  (as mensagens de `authorizePlayerCompanionCreate`).
- O `OpError` já traz o `code` (`PERMISSION_DENIED` / `VALIDATION_FAILED`), mas o client
  classifica o erro pelo texto, e os testes simulam o texto copiado. Nenhum teste liga as duas
  pontas.
- Cenário: alguém reescreve ou traduz a mensagem do servidor. A corrida do eidolon deixa de ser
  re-tentada e falha na 1ª tentativa, e o "já existe" vira falha. Todos os testes continuam
  verdes.

## Verificado e sem achado

- As asserções antigas não foram enfraquecidas: o diff só acrescenta testes, e nenhum `skip`,
  `todo` ou contagem afrouxada aparece nos arquivos tocados.
- Os testes do systems usam os documentos reais de `classes-core`, com identidade por sourceId
  (os casos de item forjado e de item com sourceId de classe mas type feat também estão lá).
- Contrato de schema: `COMPANION_KINDS` ganhou `eidolon`, e o servidor lê `companionKind` via
  `readCompanionKind`. `index.ts` não exporta `autoCompanionKindForClass`/`WITCH_CLASS_SOURCE_ID`,
  mas nenhum consumidor do core os importa (o client usa o espelho). Não há quebra de build: o
  gate rodou typecheck e build verdes.
- `inheritMasterOwnershipOnCreate` só age em companheiro sem ownership explícito e passa pelo
  handler real no teste do servidor.
