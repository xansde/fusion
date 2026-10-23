# Revisão adversarial — o4b (T4.4, aparições do Animist) — lente TESTE NÃO-CIRCULAR + CONTRATOS

**Veredito: NÃO MERGEAR.** Há 2 bloqueantes e 3 importantes. Todos foram reproduzidos com uma sonda
vitest isolada, que chama o `planVM.ts` real e o `applyOps` do harness com os docs REAIS de
`classes-core`, `class-features-core` e `spells-core`. A sonda vive fora da worktree, em
`<scratchpad desta revisão>/probe/src/__tests__/probe.test.ts`; nada da worktree foi editado.

Satélite `ficha3/o4b` = `497313a` (commit único). Os 3 ajustes obrigatórios da revisão de decisão
(`T4.4-aparicoes-revisao-decisao.md`) **não foram aplicados**: não há commit posterior. O gate
aprovou por cima deles.

## O que confere contra o livro (não são achados)

- Tabela de slots da metade espontânea, níveis 1-3: L1 {truques 2, 1:1}, L2 {1:1}, L3 {1:1, 2:1}.
  Bate com a nota 9 da curadoria (`tools/importer-pf2e/src/curation/classes/animist.json`) e com a
  prosa da class feature: "At first level, you can cast two apparition cantrips and one 1st-rank
  apparition spell per day".
- O parse do `system.description` casa com as 14 aparições do pack. Nas 14, as Lore saem sempre
  como "X Lore". O rank listado bate com o `system.level` do spells-core em todas as magias
  encontradas: nenhuma magia é listada num rank acima do próprio. As vessel spells existem e têm
  o traço focus. Os nomes ausentes são exatamente os da issue #115: Blistering Invective,
  Protector Tree, Gentle Breeze, Ill Omen e Rousing Splash. Nenhum nome homônimo foi encontrado no
  spells-core.
- Trocar uma aparição troca o repertório: a união é refeita por nome, a magia que ficou sem dono é
  apagada e a magia compartilhada (Sure Strike, Tangle Vine) é preservada. A vessel spell vai para
  o pool `class:focus`, e as Lore são concedidas e retiradas.
- `location` na raiz do item e o update embutido `embedded:{type:"Item", id:actorId}` seguem o
  mesmo formato já usado em `characterSheetVM.ts:2675`, `planVM.ts:4894` e `planVM.ts:6851`. O
  diff do core só traz o pin e docs, sem mudança de tipo compartilhado. `planGhostEntryCleanup`
  não apaga a nova entrada, porque o nome dela não é "divine Spells".

## Achados

### A1 — BLOQUEANTE — escrita de `system.build.choices` a partir do snapshot velho (regressão da #26: slot fantasma e choice perdida)
`planVM.ts:5181` (`apparitionLoreSyncOps`), chamado em `planVM.ts:5228` (pick) e `planVM.ts:6440`
(remove).
`chooseFeat` grava por último `system.build.choices = existentes + newChoice`. Depois dele,
`apparitionLoreSyncOps` grava de novo `choices` montado com `getBuildChoices(ctx.doc)`, que é o
array anterior ao pick.
- **Pick numa ficha nova.** A sonda mostra, depois do pick de Crafter em `apparition-1-0`:
  `choices = [apparitionLore-0, apparitionLore-1]`. A choice `{slot:"apparition-1-0",
  type:"apparition"}` sumiu.
- **Remoção num ator anterior à lane.** É o caso do ator do Alexandre, que já tem as choices
  `apparition-*`. Na sonda: antes `filled:true, itemId:gen-14`; depois do `removeChoice`,
  `filled:true, choiceName:"Crafter in the Vault"`, sem item nenhum, e a choice continua em
  `build.choices`. O slot fica marcado como ocupado sem nada por trás e não dá para escolher outra
  aparição nele. É o padrão exato das issues #15 e #26.

### A2 — BLOQUEANTE — slots da entrada "Apparition Spells" errados nos níveis 2 e 3 (contrato de `levelSet` com a nova entrada)
Dois caminhos independentes levam ao erro:
1. **O pick usa o nível do slot, não o do personagem.** `PlanColumn.svelte:1219` e
   `handleSlotPickerSelect` passam `slotPicker.level`, que vale 1 para `apparition-1-*`, para
   `chooseClassChoice` e para `materializeApparitionSpells`. Resultado: `apparitionSpellcastingEntryOps`
   cria a entrada com a tabela do nível 1, e `maxRank` fica em 1 (`planVM.ts:5268`,
   `PlanColumn.svelte:427`). Na sonda, um Animist de nível 3 que escolhe a primeira aparição recebe
   a entrada `{"0":{max:2},"1":{max:1}}`, **sem slot de rank 2**. Pelo livro deveria ser
   {1:1, 2:1}. O heal de abertura não conserta, porque a criação da entrada é idempotente
   (`planVM.ts:5082`, `if (existing) return []`). Pior: o heal cria as magias de rank 2 e grava
   `slots.2.spellsKnown`, e a ficha passa a mostrar "Rank 2 0/0".
2. **`levelSet` aplica a tabela da classe na entrada da aparição.** O laço em `planVM.ts:6504`
   sincroniza TODA entrada que não é de foco com a tabela da classe, que para o Animist é a metade
   PREPARADA. Na sonda, com a aparição escolhida no nível 1 e dois level-ups até o 3, a entrada
   "Apparition Spells" fica com `{0:2, 1:2, 2:1}`. Pelo livro são {1:1, 2:1}: um slot de rank 1 a
   mais nos níveis 2 e 3. Esse laço já existia, mas o contrato "uma entrada não-foco = tabela da
   classe" foi quebrado pela nova entrada, e ninguém atualizou o consumidor.

A fatia é "ficha nível 3", então o nível 3 é justamente o nível-alvo. O personagem fica com slots
errados em qualquer ordem: escolher no 3 ou escolher no 1 e subir de nível.

### A3 — IMPORTANTE — o repertório com rank não aparece depois do pick (a própria queixa "não adicionou nada na lista")
`planVM.ts:5268-5363` e `PlanColumn.svelte:1219`.
`knownSpellsAt` (`SpellsTab.svelte:534`) só lista magia de rank cujo id está em `spellsKnown`.
`apparitionRepertoireOps` cria as magias e só grava `spellsKnown` na chamada SEGUINTE. Na sonda,
depois de uma passada: `slots.1.spellsKnown = []`.
- **Pick 1:** aparecem os truques (a seção de truques lê o bucket), mas o rank 1 mostra
  "KnownEmpty".
- **Pick 2:** conserta o rank 1 da aparição 1, mas o da aparição 2 continua faltando.

Só reabrir a ficha resolve. Existe ainda um risco de corrida: se o índice do spells-core já estiver
em cache, o `await` pode voltar antes do ack da entrada recém-criada. Aí
`apparitionRepertoireOps` devolve `[]` e nenhuma magia é criada. Isso não foi medido, porque a
lane não fez o "Vivo".

### A4 — IMPORTANTE — os testes novos não exercitam o caminho de produção e mascaram A1, A2 e A3
Arquivo: `apparitionSpellcasting.test.ts`.
- **Nível 3 que a produção nunca passa.** `docWithEntryAndApparitions(level)` (linha 226) chama
  `chooseClassChoice(..., level=3, ...)`, mas em produção o nível passado é o do slot (1). O teste
  "level 3 also resolves the rank-2 spell" (linha 294) chama `apparitionRepertoireOps(..., 3)`
  direto. Ele passa, e o caminho real (pick em ficha de nível 3) nunca chega ao rank 2 (A2).
- **A escrita de choices nunca é conferida.** Nenhum teste confere `system.build.choices`. Não há
  asserção de que a choice do pick persiste nem de que o slot fica `filled:false` depois da remoção.
  O teste de remoção usa uma ficha nascida nesta lane, que já perdeu a choice (A1), e por isso
  passa.
- **Nenhum teste de level-up** com a entrada "Apparition Spells" (A2.2).
- **Resolver falso no lugar do spells-core real.** `fakeResolver` devolve todas as magias com
  `system.level 1` e sem traço cantrip, e nenhum teste exercita `resolveGranterByName` nem a
  exibição no `characterSheetVM`, que é onde A3 aparece. As expectativas de
  `parseApparitionSpellData` são as únicas realmente não-circulares, porque foram copiadas da prosa.
- **Duas passadas manuais escondem A3.** O teste do repertório roda a segunda passada à mão. Na UI,
  essa segunda passada só acontece quando a ficha é reaberta.

Não houve asserção enfraquecida em `planVM.test.ts`: só mudaram o nome do teste e o comentário, e a
contagem de entradas criadas por `applyClass` foi mantida.

### A5 — IMPORTANTE — o heal regrava `build.choices` a cada abertura
`planVM.ts:5181-5184`. Em `sameChoices`, a parte `keptChoices.length === choices.length` é sempre
falsa quando já existem choices `apparitionLore-*`. Resultado: para todo Animist com aparição, cada
abertura da ficha manda um `doc:update` de `system.build.choices`, o que dispara derive e broadcast,
e ainda conta `created++` no heal (`PlanColumn.svelte:683`). A lógica de comparação está errada, não
é uma questão de gosto.

### A6 — MENOR — a vessel spell alterna depois de trocar a aparição do slot 0
`PlanColumn.svelte:437`. No caminho do pick, `attuned = [...others(ordenado), justPicked]` não é
reordenado. Cenário: A no slot 0, B no slot 1; trocar o slot 0 por C faz `primary = B`, e a vessel
de B é criada. Na próxima abertura, o heal ordena por slot, `primary = C`, apaga a vessel de B e cria
a de C. Enquanto a ficha não é reaberta, o jogador tem a vessel da aparição errada. Hoje a regra é
"primária = slot 0", então o estado transitório contradiz a própria regra da lane.

## Correções sugeridas (para a lane)
1. **A1:** a sync de Lore deve partir do array PENDENTE, como o `survivingChoices` do `chooseFeat`
   ou o `remaining` do `removeChoice`. Outra saída é embutir as choices de Lore na última escrita de
   choices. Teste: ator com a choice `apparition-1-0` já gravada → remove → `filled:false`; e pick →
   a choice está presente.
2. **A2:** passar `ctx.level` (nível do personagem) no pick. Em `levelSet`, pular a entrada
   `class:apparitionSpellcasting` no laço da tabela da classe e sincronizá-la com
   `ANIMIST_APPARITION_SLOTS_BY_LEVEL`. Teste: nível 1 → pick → levelUp ×2 → {1:1, 2:1}; e pick
   direto num ator de nível 3.
3. **A3:** reconciliar de novo depois do ack dos creates, ou gravar `spellsKnown` quando o item
   chegar, como o `pendingKnown` do SpellsTab. O print "Vivo" do pick 1, com o rank 1 listado sem
   reabrir a ficha, vira critério de aceite.
4. **A5:** comparar o conjunto (slot, skill) das Lore atuais com o das novas.
5. **A6:** ordenar `attuned` por slotId também no caminho do pick.
