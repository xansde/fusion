# Revisão adversarial o3 — lente DADO + IMPORTADOR + INTEGRIDADE

Escopo lido: satélite `git diff origin/main...ficha3/o3` (8 arquivos, 0 pack/importer), core
`git diff origin/alfa/app...ficha3/o3` (doc-handlers, specs 29/45, rastreabilidade, i18n).

## O que foi conferido e está OK

- **Nenhum pack e nenhum script do importador mudaram** nesta onda — não há diff de tradução,
  curadoria, ids ou homônimos para auditar; regeneração não afeta nada daqui.
- **Identidade por sourceId**: `YtOm245r8GFSFYeD` (Summoner, `_id` NIzzd1NGrR7sdFze) e
  `bYDXk9HUMKOuym9h` (Witch, `_id` eN4Jk0CQEkvRH7C3) conferidos contra
  `classes-core/documents.json`; um único documento de classe para cada (sem homônimo/legado).
  `sourceId` = `_id` do vendor (transform.mjs:726), estável desde o commit que publicou as
  classes (6b8dc1f, `git log -S`) — nenhum mundo antigo tem outro id para essas classes.
- `companion-grant.test.ts` lê o pack REAL (não circular). Heal e pick usam sourceId, nunca nome.
- `featuresByLevel[1]` do Witch resolve `Familiar (Witch)` (YZuMJcbifuD0uTJb) e do Summoner
  resolve `Eidolon`; o `grant-item` de `Pet` do Familiar (Witch) mapeia para `feats-core/Pet`.
- Server: não há loop de escrita no refresh do eidolon — `store.update` devolve null no no-op
  (REQ-DOC-038), então o 2º write não faz broadcast.

## Achados

### A1 — importante — a autorização do familiar da Witch NÃO depende do item de classe; o retry foi dimensionado (e especificado) para a dependência errada
- Arquivos: `sheets/pf2e/src/lib/sheets/pf2e/petsVM.ts:500-505` (retry 5×, ~2 s total),
  `systems/pf2e/src/companion-grant.ts:56-58` (familiar → `detectFamiliarGrant`),
  `specs/29-pets-companions-familiars.md:693-697` (REQ-PET-096 fala "até o item de classe estar persistido").
- Prova executada (dist do satélite, pack real): `companionGrantAllows("familiar", {items:[Witch]})`
  → **false**; com `Familiar (Witch)` embutido → **true**. O item de classe Witch tem `rules: []` e
  não é feat; o sinal é a regra `familiarAbilities` da *class feature*, que só chega via
  `materializeClassGrants` — async, sequencial, com `resolvePackIndex("class-features-core")`
  (index 340 KB, doc 3,2 MB no pack) e `resolveGrantDoc` de `Witch Spellcasting` ANTES do
  `Familiar (Witch)`. Para o Summoner o argumento do relatório vale (o item de classe sai
  primeiro); para a Witch é falso.
- Cenário: jogador remoto (túnel) escolhe Witch pela 1ª vez na sessão, índice de
  class-features frio → o op do `Familiar (Witch)` sai depois de ~2 s → as 5 tentativas recebem
  "has no grant for a companion" → `console.warn` e a Witch fica **sem familiar** (RAW: obrigatório
  no nível 1) até o dono reabrir o Plano (heal). O gate da onda ("criar e o companheiro existir")
  passa no localhost e falha em produção remota.
- Conserto sugerido: disparar o auto-create da Witch DEPOIS de `materializeClassGrants`
  resolver (await da cadeia, não `void`), ou fazer o retry esperar o sinal real; corrigir
  REQ-PET-096/DEC-PET-04 para nomear a dependência por tipo.

### A2 — menor — familiar da Witch nasce com orçamento de habilidades 2 em vez de 4
- Arquivo: `PlanColumn.svelte:476` passa `masterDoc: doc` (snapshot do momento do pick, sem
  `Familiar (Witch)` nem `Pet`) → `petsVM.ts:433` `detectFamiliarGrant` → budget 2.
- Com `Pet` embutido o detector dá 2+2 = 4, que casa com o vendor no nível 1-3
  (`Pet` upgrade 2 + add `2+min(3,floor(L/6))`). Cenário: Witch criada, familiar aberto
  direto pela lista de atores (sem passar pela aba Pets, onde `buildMasterRefreshOp` corrige)
  → só 2 habilidades selecionáveis. O caminho heal não tem o problema (doc persistido).

### A3 — menor — o eidolon recebe `abilitiesBudget` (campo só de familiar) ao abrir a aba Pets
- Arquivo: `petsVM.ts:528-560` + `PetsTab.svelte:86-92`. O "unchanged" compara `hp.max` com
  `5×nível`; o eidolon tem `hp.max = 0` por decisão (lição #48) → nunca "unchanged" → escreve
  `abilitiesBudget: {2,2}` e `master` no eidolon. Contradiz o próprio docstring da T3.2
  ("eidolon pula abilitiesBudget/selectedAbilities") e deixa dado inventado persistido.
  Cenário: Summoner abre a aba Pets → eidolon passa a ter orçamento 2 de habilidades de familiar.
  Conserto: `buildMasterRefreshOp` ignorar kinds que não espelham o mestre.

### A4 — menor — constantes espelhadas no client não são amarradas ao pack
- `petsVM.ts:98-101` duplica os dois sourceIds; `petsVM.test.ts:248-249` compara a constante
  com ela mesma (circular). Cenário: regeneração com `_id` novo do vendor → `companion-grant.test`
  falha e é corrigido, o espelho do client fica velho e nenhum teste do `sheets` falha → o pick
  para de auto-criar (o server continua autorizando). Conserto: o teste do petsVM ler
  `classes-core/documents.json` como o do system já faz.

## Não-achados (checados)
- Pin do core no commit de feature do satélite — estado normal.
- Espelho de `WITCH_CLASS_SOURCE_ID` não exportado do index do system — não usado pelo server.
