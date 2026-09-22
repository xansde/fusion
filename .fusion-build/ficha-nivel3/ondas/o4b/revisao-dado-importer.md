# Revisão adversarial: DADO + IMPORTADOR + INTEGRIDADE (Onda 4b, T4.4, aparições do Animist)

Revisado: satélite `497313a` (`git diff origin/main...ficha3/o4b`) e core `2f7b980b` (`git diff origin/alfa/app...ficha3/o4b`, só o pin e os docs). Nada foi editado. Não rodei a suíte; só scripts `node` de leitura sobre os packs compilados.

**Veredito: REPROVA.** Há 1 bloqueante e 3 importantes. O bloqueante atinge exatamente o caso do Alexandre, que é uma ficha de nível 3.

## Escopo do diff

- Nenhum pack mudou. `documents.json`, `i18n.pt-BR.json`, `mechanics.json` e a curadoria ficaram intactos, então não há risco de tradução, `sourceId` ou homônimo **no dado**.
- A mudança toda está no consumidor: `planVM.ts` (+526), `PlanColumn.svelte` (+80) e um teste novo.
- O dado vem de um parse, em runtime, do `system.description` em inglês de cada aparição, com a resolução **por nome** em `spells-core`.

## O que confere (não é achado)

- **O parser casa as 14 aparições do pack.** Rodei a regex da lane sobre `class-features-core/documents.json`: cada aparição dá 2 Lores, o truque, o rank 1, o rank 2 e a vessel spell. O inglês sobrevive no `system.description` (`compendium/service.ts:510-517` só anexa `i18n`), e o `name` continua em inglês. O `resolveGranterByName` casa pelo nome em inglês.
- **As 14 vessel spells existem em `spells-core`** com a trait `focus`/`animist`. Não há homônimo em `spells-core` para nenhum dos 56 nomes das faixas 0-2 + vessel.
- **A tabela `ANIMIST_APPARITION_SLOTS_BY_LEVEL` está certa na criação.** L1 `{1:1}`, L2 `{1:1}`, L3 `{1:1,2:1}`, 2 truques. Bate com a nota 10 da curadoria e com a prosa do livro ("At first level, you can cast two apparition cantrips and one 1st-rank apparition spell per day").
- **O teste não é circular.** As expectativas foram copiadas à mão do texto de 3 aparições.
- **Ao trocar a aparição, o repertório troca junto.** `apparitionRepertoireOps` apaga o que o conjunto atual não pede mais, e a vessel troca junto com a primária (em teste puro).

## Achados

### A1 (BLOQUEANTE): o pick numa ficha de nível 3 cria a entrada e o repertório com o formato de nível 1

- **Arquivos:** `PlanColumn.svelte` (`handleSlotPickerSelect`, ~l.1178-1219); `planVM.ts:4792-4794` e `apparitionRepertoireOps` (`maxRank`).
- **Causa:** o `level` que chega a `chooseClassChoice` e a `materializeApparitionSpells` é o `level` da **linha do plano** (`slotPicker.level`). O slot de aparição mora na linha 1 (`apparition-1-0`/`apparition-1-1`), não no nível do personagem.
- **Cenário:** um Animist de nível 3 escolhe a primeira aparição.
  1. `apparitionAttunementSyncOps(ctx, 1)` cria "Apparition Spells" com `slots {0:2, 1:1}`, **sem slot de rank 2**.
  2. `materializeApparitionSpells(1)` usa `maxRank = 1`, e o rank 2 (Knock, Blistering Invective…) não entra.
  3. Na próxima abertura, o heal (5) usa `ctx.level = 3` e acrescenta as magias de rank 2. Como a entrada já existe, ela nunca ganha o slot de rank 2.
  4. O próximo pick ou a próxima remoção roda de novo com `level = 1` e **apaga** as magias de rank 2, porque `allNeeded` não as contém. Isso vira um pisca-pisca entre o heal e o pick.
- **Por que o teste não pega:** ele chama `apparitionRepertoireOps(ctx(doc), 3, …)` com 3 literal (l.294-297). A fiação nunca passa 3.
- **Correção:** usar `ctx.level` (o nível do personagem) nos dois pontos do pick e no `handleSlotRemove`.

### A2 (IMPORTANTE, beira o bloqueante): `levelSet` sobrescreve os slots da entrada de aparição com a tabela PREPARADA da classe

- **Arquivo:** `planVM.ts:6480-6512` (`levelSet`).
- **Causa:** o `levelSet` sincroniza **toda** entrada não-foco com `spellSlotsForLevel(classSystem.spellcasting)`, e a "Apparition Spells" (`isFocusPool: false`) entra nesse filtro. A tabela preparada do Animist em `classes-core` é L1 `{1:1}`, L2 `{1:2}`, L3 `{1:2,2:1}`.
- **Cenário:** criar um Animist no nível 1, escolher as duas aparições e subir para o nível 2.
  - A entrada de aparição passa a ter **2 slots de rank 1**. O livro e a nota 10 dizem 1.
  - No nível 3, fica `{1:2,2:1}`; o certo é `{1:1,2:1}`.
  - Como `ANIMIST_APPARITION_SLOTS_BY_LEVEL` só é lido na criação, nada corrige depois.
- **Correção:** `levelSet` deve pular o slot `class:apparitionSpellcasting`, ou então re-sincronizá-lo com `apparitionSpellSlotsForLevel`.

### A3 (IMPORTANTE): a troca de classe Animist → outra ressuscita a conjuração de aparição a cada abertura

- **Arquivos:** `planVM.ts:3629-3647` (`replaceAbcItem`) e `PlanColumn.svelte` heal (5), ~l.677-685.
- **Causa:**
  - O `replaceAbcItem` apaga o item de classe e os auxiliares `class:*`, o que inclui a entrada de aparição e a vessel.
  - **Não** apaga os itens de aparição (`build.slot = apparition-1-N`, sem `grantedBy`).
  - O heal (5) chama `apparitionAttunementSyncOps(opCtx, ctx.level)` sem conferir se a classe ainda é Animist.
- **Cenário:** trocar Animist → Wizard e reabrir a ficha. O heal:
  - recria "Apparition Spells" (divina, sabedoria) no Wizard;
  - concede as 4 Lores das aparições órfãs;
  - repopula o repertório.
- **Resíduo extra:** as magias de repertório têm `grantedBy = "class:apparitionSpellcasting"`, que não é `sourceId` nem build slot. O cascade da troca não as pega, e elas sobram com `location` apontando para a entrada apagada.
- **Diferença para o problema antigo:** o vazamento dos itens de escolha de classe já existia, mas era inerte. Agora ele tem efeito na ficha.
- **Correção:** fazer o gate do heal e dos syncs pela classe Animist presente (ou pela feature "Apparition Attunement"), marcar as magias com um build slot `class:`, e limpar os itens `apparition-*` na troca de classe.

### A4 (IMPORTANTE): lacuna de dado no recorte 1-3 que não está rastreada, e a #115 subconta

- **Arquivos:** `spells-core/documents.json` e a issue `xansde/fusion-systems-2e#115`.
- **Medição:** pela regra de resolução da própria lane (nome normalizado), faltam em `spells-core` **24** magias de aparição, não 16. As 8 fora da #115 são Blistering Invective, Protector Tree, Honeyed Words, Breath of Life, Sacred Form, Nature's Enmity, Strange Geometry e Weapon of Judgment.
- **Dentro do recorte 1-3, duas não estão em issue nenhuma:**
  - **Protector Tree** (rank 1 do Custodian of Groves and Gardens);
  - **Blistering Invective** (rank 2 do Lamentation of Sinister Deals).
- **Cenário de produção:** Custodian + Speaker in Sibilance no nível 1.
  - O rank 1 do Custodian é Protector Tree (falta) e o do Speaker é Ill Omen (falta, #115).
  - O repertório de rank 1 fica **vazio** e o slot de rank 1 de aparição fica inutilizável.
  - Tudo acontece em silêncio, sem entrada no `collector` de grants não resolvidos (issue #35).
  - O relatório da lane afirma que "todo o não-fechado já tem issue", e isso é falso para essas duas.
- **Correção:**
  - Importar as 5 magias de rank 0-2 que faltam: Rousing Splash, Ill Omen, Protector Tree, Gentle Breeze e Blistering Invective.
  - No mínimo, emitir o nome não resolvido no `collector.flush` e corrigir a #115 com a lista real de 24. Algumas podem existir com outro nome no remaster: conferir por `sourceId` antes de importar.

## Corroborado (já no relatório de revisão da decisão, não conto de novo)

A escrita final de `system.build.choices` em `apparitionLoreSyncOps` parte do snapshot velho (`getBuildChoices(ctx.doc)`). Confirmei em `chooseFeat` (`planVM.ts:4698-4711`): a escrita de choices do `chooseFeat` não é a última da sequência. A Lore sync sobrescreve depois dela e apaga a choice `apparition-1-N` recém-gravada. Do ponto de vista da integridade de dado, isso é bloqueante.

## Não verificado

- Não fiz a prova "Vivo". O cenário A1 foi traçado por leitura do fluxo `slotPicker.level` → `chooseClassChoice`/`materializeApparitionSpells`, e o A2 por leitura do `levelSet` somada à tabela real de `classes-core`.
- Não conferi se as 8 magias fora da #115 existem com outro nome no vendor (a busca no vendor estourou o timeout).
