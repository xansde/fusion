# Revisão adversarial: regra do PF2e e caminho de produção (Onda 4b, T4.4, aparições do Animist)

**Veredito: NÃO PODE MERGEAR.** Encontrei 3 bloqueantes, 3 importantes e 3 menores.

Revisei o satélite `497313a` (`ficha3/o4b`) e o core `2f7b980b`. Não editei nada.

**Como reproduzi.** Montei um script isolado no meu scratchpad. Ele usa o esbuild para empacotar o `planVM.ts` real com os packs reais (`class-features-core`, `classes-core` e `spells-core`) e aplica as ops em ordem, com `null` significando apagar a chave (a convenção do servidor, REQ-DOC-037). Não rodei a suíte, não subi servidor e não toquei na worktree.
Script: `C:/Users/xansd/AppData/Local/Temp/claude/C--Users-xansd-pessoal-fusion/f93e1369-2b29-4884-8a39-cf076bcda837/scratchpad/repro.ts`.

**Aviso de processo.** O `gate.md` diz "PODE MERGEAR: SIM". Só que a revisão de decisão (`T4.4-aparicoes-revisao-decisao.md`) exigiu 3 ajustes obrigatórios, e nenhum deles foi aplicado: o satélite continua em `497313a`, sem commit depois da revisão. Reproduzi 2 dos 3 abaixo (itens I1 e M1). Também nasceram achados novos.

## O que está certo pela regra (confirmado)

- A tabela de slots da metade espontânea nos níveis 1 a 3 bate com o livro: 2 truques; L1 {1:1}, L2 {1:1}, L3 {1:1, 2:1}. Ela coincide com a nota 9 da curadoria e com o pregen do Samo.
- A tradição é divina, a habilidade é Sabedoria e a entrada tem aba própria. É o que diz a prosa de "Animist & Apparition Spellcasting".
- O parse do `system.description` real funciona nas 14 aparições do pack. Lore, magias e vessel saem certos nas 14, e o parse não é circular.
- As duas Lores de cada aparição são concedidas, como manda o RAW de Apparition Attunement ("each grant you knowledge in the form of Lore skills").
- A vessel spell entra no pool de foco (`class:focus`). As 13+1 vessel spells existem no `spells-core`.
- Trocar uma aparição retrai as magias dela e adiciona as da nova (`apparitionRepertoireOps` deleta o que deixou de ser necessário). Isso funciona **na chamada seguinte** (ver B1).

## Bloqueantes

### B1. Depois de escolher, o repertório de rank 1 ou mais não aparece: é a mesma queixa do Alexandre
Arquivos: `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts:5339` e `SpellsTab.svelte:534-538`.

Em espontânea, o `SpellsTab.knownSpellsAt` só mostra magia cujo id está em `slots.<rank>.spellsKnown`. O `apparitionRepertoireOps` cria o item agora e só grava o `spellsKnown` na **próxima** chamada, e essa chamada só acontece no próximo pick, no próximo remove ou no heal de abertura.

- **Reproduzido (S5).** Duas aparições atuneadas (Impostor e Crafter), uma chamada. Resultado: as magias Telekinetic Hand, Sigil e Mending são criadas, com `slots.1.spellsKnown = []`.
- **Personagem nova.** Depois do pick 1 aparecem só os truques, porque o `cantrips()` não filtra por `spellsKnown`. Depois do pick 2, o rank 1 mostra só a magia da 1ª aparição. A da 2ª só aparece ao reabrir a ficha.
- **Ator já existente (o do Alexandre).** O heal roda uma vez por abertura (`healedActorId`):
  1. A 1ª abertura cria a entrada. O async pode ler o `opCtx` antes do ack e não criar nada.
  2. A abertura seguinte cria as magias.
  3. Só a próxima grava o `spellsKnown`.

  São 2 ou 3 aberturas até o rank 1 aparecer.

A lane não fez a prova "Vivo", por isso isso passou.

### B2. O level-up aplica a tabela da conjuração PREPARADA à entrada "Apparition Spells": nível 2 e 3 ficam com 2 slots de rank 1 (o RAW dá 1)
Arquivo: `planVM.ts:6493-6510` (`levelSet` / `levelUp`).

O `levelSet` percorre **toda** entrada que não é de foco e aplica `spellSlotsForLevel(classSystem.spellcasting)`, que é a metade A (Animist preparado). A lane criou uma entrada nova e não a excluiu desse loop.

- **Reproduzido (S7).** Animist nível 1 com 2 aparições. Depois de `levelUp`:
  - no nível 2, "Apparition Spells" fica `{"0":2,"1":2}`; o RAW é `{1:1}`;
  - no nível 3, fica `{"0":2,"1":2,"2":1}`; o RAW é `{1:1, 2:1}`.
- É um slot de aparição a mais em cada nível do recorte, justamente no caminho padrão de subir de nível.

### B3. Animist criado já no nível 3 (a "ficha nível 3" desta fatia) fica sem slot de aparição de rank 2
Arquivos: `planVM.ts:4792` / `5083` e `PlanColumn.svelte:1219`.

`chooseClassChoice(..., level, ...)` recebe o nível da **linha do slot**, que é 1 para Apparition Attunement, e não o nível do personagem. Então `apparitionSpellSlotsForLevel(1)` cria a entrada com `{1:1}`, e `materializeApparitionSpells(level, ...)` no pick também usa 1, com `maxRank = 1`.

- **Reproduzido (S8).** Personagem nível 3, depois picks em `apparition-1-0` e `apparition-1-1`. A entrada fica `{"0":{max:2},"1":{max:1}}`, **sem rank 2**.
- O heal (`ctx.level = 3`) depois cria Invisibility e Knock e grava `slots.2 = {spellsKnown:[...]}` **sem `max`**. A seção de rank 2 aparece com 0/0 e o "Lançar" fica desabilitado (`slot.value <= 0`).
- O `levelUp` também não re-materializa o repertório. As magias de rank 2 só entram ao reabrir.

## Importantes

### I1. Regressão da #26: a choice `apparition-*` é apagada no pick, e o remove deixa slot fantasma no ator existente
Arquivos: `planVM.ts:5181-5192` (e `6432`).

`apparitionLoreSyncOps` grava `system.build.choices` a partir do snapshot velho, **depois** da escrita do `chooseFeat`, e a última escrita vence.

- **Reproduzido (S1).** Numa personagem nova, depois dos 2 picks as choices ficam só `apparitionLore-0..3`. As choices `apparition-1-0` e `apparition-1-1` nunca persistem.
- **Reproduzido (S3).** Tomei um ator anterior à lane, com as choices `apparition-1-0/1` (é o caso do Alexandre), e fiz `removeChoice` no slot 0. As choices finais ainda contêm `apparition-1-0`. O `derivePlan` devolve `{"slotId":"apparition-1-0","filled":true,"choiceName":"apparition"}` sem `itemId`: slot preenchido sem aparição.
- Remover de novo não resolve, porque o sync regrava o snapshot, que ainda tem a choice.

### I2. Trocar entre aparições que compartilham uma Lore apaga essa Lore da ficha
Arquivo: `planVM.ts:5158`.

Numa troca, o `chooseFeat` roda o `removeChoice`, que roda o próprio sync de Lore sem a aparição nova e **anula** `system.skills.<lore>`. Em seguida, o sync do `chooseClassChoice` calcula `alreadyPersisted` pelo snapshot velho (onde a Lore ainda existe) e não a regrava.

- **Reproduzido (S2).** Impostor e Crafter atuneadas; troquei o slot 0 por Speaker in Sibilance (as duas têm Fortune-Telling Lore). Resultado: a choice `apparitionLore-2:lore-fortune-telling` existe, mas `system.skills.lore-fortune-telling` sumiu, e a Lore desaparece da ficha.
- Atinge Fortune-Telling (4 aparições), Mountain (3) e Sailing (2). A troca entre aparições é o uso normal da classe (RAW: re-atunar todo dia).

### I3. A aparição primária não é estável: a vessel spell alterna entre o pick e a reabertura
Arquivo: `PlanColumn.svelte:425`.

No pick, `attuned = [...others, justPicked]` não é ordenado. No heal, `attunedApparitionItems` ordena por `slotId`.

- **Cenário.** Trocar a aparição do slot 0: no pick, a primária vira a do slot 1 e a vessel é trocada. Na próxima abertura, a primária volta a ser o slot 0 e a vessel é deletada e recriada.
- O mesmo vale quando o jogador preenche primeiro o slot 1.

## Menores (viram issue)

### M1. O heal grava `system.build.choices` a cada abertura
Arquivo: `planVM.ts:5182`.

O `sameChoices` sai sempre falso quando já existem choices de Lore.

- **Reproduzido (S4).** Um segundo heal idêntico emite 1 op, quando deveria emitir 0.
- O `created++` também conta essa op como item "criado".

### M2. Não dá para escolher a aparição primária, e a UI não diz que o slot 0 é a primária
Arquivo: `planVM.ts:4990`.

O RAW manda escolher a primária entre as atuneadas. O corte está declarado, mas o jogador não tem como saber que a ordem dos slots decide qual vessel spell ele recebe. Issue.

### M3. A aba "Apparition Spells" oferece "Adicionar magia conhecida" e o reconcile apaga em silêncio
Arquivos: `SpellsTab.svelte:1021-1039` e `planVM.ts` (retract em `apparitionRepertoireOps`).

- A aba oferece o botão, pelo menos no rank 0.
- Se o jogador adiciona um truque divino qualquer, o próximo reconcile deleta o truque, porque o nome dele não está no conjunto necessário.
- O RAW não permite expandir o repertório de aparição, então o botão também está errado.

## Correções sugeridas (sem implementar)

- **B1.** Fazer uma segunda passada de reconciliação depois do ack dos creates, esperando os ids (no padrão `pendingKnown`). Outra saída: o `knownSpellsAt` da entrada de aparição listar por `location`.
- **B2.** Excluir `APPARITION_SPELLCASTING_SLOT` do loop do `levelSet` e sincronizar essa entrada pela `ANIMIST_APPARITION_SLOTS_BY_LEVEL`.
- **B3.** Passar o nível do **personagem** (`getLevel(doc)`) para a tabela e para o `maxRank`. Depois do `levelUp`, rodar de novo o `materializeApparitionSpells`.
- **I1 e I2.** Montar a escrita de Lore a partir das choices pendentes (o `survivingChoices`) e decidir `alreadyPersisted` pelo diff acumulado da operação inteira, não pelo snapshot. Outra saída: rodar o sync de Lore uma única vez por operação.
- **I3.** Ordenar por `slotId` também no caminho do pick.
- **Prova "Vivo".** Pick 1 → pick 2 → aba mostrando os 2 truques e as 2 magias de rank 1 sem reabrir; level-up até o nível 3 mostrando slots 1+1; troca Impostor↔Speaker mantendo Fortune-Telling Lore.
