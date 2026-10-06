# Revisão adversarial da o4b: julgamento

**Veredito: REPROVADA.** Há 3 bloqueantes, 4 importantes e 4 menores confirmados, e 1 achado refutado.

O satélite está em `497313a` (`fix(pf2e): Apparition Attunement passa a alimentar magias, Lore e vessel spell`).
A verificação foi feita lendo o código e rodando duas sondas vitest isoladas. As sondas importam o `planVM.ts` real e os packs reais, e ficam fora da worktree, em
`f93e1369-.../scratchpad/probe/probe.test.ts` e `probe2.test.ts`. Nada na wt-d foi editado.

## Resultado das sondas

| Cenário | Saída observada |
|---|---|
| Pick de Crafter em `apparition-1-0` numa ficha nova | `build.choices` fica só com `apparitionLore-0/1`, e a choice da aparição some |
| Ator com a choice `apparition-1-0` anterior à lane, depois de `removeChoice` | slot `filled:true`, `choiceName:"Crafter in the Vault"`, sem `itemId`: slot fantasma |
| `apparitionRepertoireOps`, 1ª passada | `slots.1.spellsKnown = []`, com as magias já criadas |
| `apparitionRepertoireOps`, 2ª passada | `slots.1.spellsKnown = ["gen-10"]` |
| Aparição escolhida no nv1, depois 2× `levelUp` | entrada `{0:2, 1:2, 2:1}`. O livro dá `{1:1, 2:1}` |
| Animist nv3 escolhe a 1ª aparição | entrada `{0:2, 1:1}`, sem slot de rank 2 |
| Impostor + Crafter, trocando Impostor por Speaker | `system.skills.lore-fortune-telling = null`, embora a choice `apparitionLore-2` aponte para ela |
| `apparitionAttunementSyncOps` rodado 2× sem mudança | 1 `doc:update` de `system.build.choices` em cada passada |

## Confirmados

### C1 · bloqueante · `build.choices` sobrescrito pelo snapshot (regressão da #26)
- Satélite, `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts:5181-5192` (`apparitionLoreSyncOps`).
- O efeito é o que a sonda mostra: no pick a choice da aparição se perde, e no remove de um ator anterior à lane o slot fica fantasma, sem como limpar.
- Deduplica regra-pf2e I1, testes-contratos A1 e costura B1.
- **Conserto:** montar as choices de Lore sobre o array pendente, isto é, o `survivingChoices` ou o último write do lote, e não sobre `ctx.doc`. De preferência, emitir tudo numa única escrita final de choices. A igualdade deve ser checada por conjunto (slot, skill), o que também fecha o C8.

### C2 · bloqueante · repertório de rank ≥1 invisível depois do pick (é a própria queixa do Alexandre)
- Satélite, `planVM.ts:5339-5363`. O `spellsKnown` só é gravado na chamada seguinte.
- `SpellsTab.svelte:534` (`knownSpellsAt`) só lista os ids que estão em `spellsKnown`. Os truques aparecem porque são renderizados por outro caminho, por isso a evidência viva viu o truque e não viu o rank 1.
- Na personagem nova, o rank 1 fica vazio até outra chamada, que é o 2º pick ou a próxima abertura. Isso é o "não adicionou nada na minha lista de magia".
- Deduplica regra-pf2e B1, testes-contratos A3 e costura B2. Era o ajuste obrigatório nº 2 da revisão de decisão.
- **Conserto:** fazer a 2ª passada de reconciliação depois do ack dos `doc:create`, no padrão do `pendingKnown` do SpellsTab. O aceite é um print do pick 1 com o rank 1 listado sem reabrir a ficha.

### C3 · bloqueante · slots da entrada Apparition Spells errados nos níveis 2 e 3
- (a) O pick e o remove passam o nível da linha do plano (1), não o nível do personagem. Os pontos são `PlanColumn.svelte:1219` e `:1006` e `planVM.ts:4793/5083/5268`. Num nv3, a entrada nasce sem rank 2, e cada pick ou remove apaga as magias de rank 2 que o heal criou. A evidência viva usou um ator de nível 3, mostra só "Patamar 1" e ainda afirma, errado, que Knock "não é acessível no nível 3".
- (b) O `levelUp`/`levelSet` (`planVM.ts:6493-6512`) aplica a tabela PREPARADA da classe à entrada de aparição: nv2 fica `{1:2}` e nv3 fica `{1:2, 2:1}`.
- Deduplica regra-pf2e B2 e B3, dado-importer A1 e A2, testes-contratos A2 e costura I1 e I2.
- **Conserto:** passar o nível do personagem (`ctx.level`) no pick e no remove. No `levelUp`/`levelSet`, sincronizar essa entrada pela `ANIMIST_APPARITION_SLOTS_BY_LEVEL`, e o heal deve corrigir o `max` de uma entrada que já existe.

### C4 · importante · trocar entre aparições que compartilham uma Lore apaga a Lore
- Satélite, `planVM.ts:5148-5160`. O `removeChoice`, chamado dentro do `chooseFeat` na troca, anula a skill.
- A sync seguinte vê `slug in persistedSkills` no snapshot e não regrava.
- Acontece com Fortune-Telling (4 aparições), Mountain (3) e Sailing (2). Reproduzido na sonda.
- **Conserto:** calcular `alreadyPersisted` considerando os nulls pendentes do lote, ou não anular um slug que a aparição que está entrando concede.

### C5 · importante · lacuna de dado no recorte 1-3 sem issue
- Satélite, `systems/pf2e/packs/spells-core` e o skip silencioso em `apparitionRepertoireOps`.
- Protector Tree (rank 1 do Custodian) e Blistering Invective (rank 2 do Lamentation) não existem no pack, conferido, e não estão na #115, que lista 16.
- Custodian + Speaker deixa o rank 1 sem nenhuma magia, sem aviso.
- **Conserto:** atualizar a #115 com a lista completa medida e mandar os nomes não resolvidos para o `collector` do heal ou do pick.

### C6 · importante · os testes novos não passam pelo caminho de produção
- Satélite, `__tests__/apparitionSpellcasting.test.ts:226-231,295`.
- O teste passa o nível 3 literal no pick, enquanto a produção passa 1.
- Nenhum teste confere `build.choices` nem `levelUp`, e a 2ª passada é feita à mão.
- Por isso a suíte ficou verde convivendo com C1, C2 e C3.
- **Conserto:** reescrever os testes com o slot no nível 1 e o personagem no nível 3, com asserção de `build.choices`, pick→remove em ator legado e `levelUp`→slots.

### C7 · importante (processo) · o gate aprovou com os 3 ajustes obrigatórios em aberto
- `ficha3-reports/o4b/gate.md` declara "PODE MERGEAR: SIM" com o satélite ainda em `497313a`, que não tem os consertos pedidos pela revisão de decisão.
- A evidência viva também não produziu o print de aceite que a revisão pediu: o rank 1 listado depois do pick 1.
- **Conserto:** o gate passa a reprovar quando a revisão de decisão tiver ajuste obrigatório aberto. A evidência viva deve ser refeita depois dos consertos, com um ator nv1 e outro nv3.

### C8 · menor · o heal regrava `build.choices` a cada abertura
- Satélite, `planVM.ts:5182`. A sonda mostra 1 op na 2ª passada idêntica.
- **Conserto:** vem junto com C1 (comparar por conjunto).

### C9 · menor · a primária e a vessel oscilam ao trocar o slot 0
- Satélite, `PlanColumn.svelte:425-437`. `[...others, justPicked]` não é ordenado por slot, e o heal ordena.
- **Conserto:** inserir `justPicked` na posição do slot dele antes de escolher `attuned[0]`.

### C10 · menor · "Adicionar magia conhecida" na entrada de aparição é apagado sem aviso
- `SpellsTab.svelte:1021-1039` junto com o retract de `planVM.ts:5296`.
- **Conserto:** esconder o botão para a entrada `class:apparitionSpellcasting`.

### C11 · menor · a troca de classe deixa os itens `apparition-*`, e o heal ressuscita a conjuração de aparição
- `planVM.ts:3629-3647` (`replaceAbcItem`) junto com o heal (5) de `PlanColumn.svelte:683`, que não confere a classe.
- **Conserto:** condicionar a sync e o heal à classe ter o eixo `apparition`. Registrar em issue o resíduo geral de troca de classe (o "Bárbaro" fantasma que a evidência viva achou) em `xansde/fusion`.

## Refutado
- **regra-pf2e M2**, "não dá para escolher a primária". A primária fixa no slot 0 é um corte declarado e aceito pela revisão de decisão ("primária fixa, sem reescolha diária"). Não corta o escopo da T4.4, que é fazer a aparição ter efeito, e a escolha diária é uma feature à parte. O texto de UI é sugestão, não defeito demonstrado.

## Evidência viva
- O check "feedback não reproduz" está **parcialmente errado**. A aba, os truques, a Lore e a vessel aparecem de fato (prints 03-08). O rank 1 depois do pick 1 não foi mostrado, e pelo código fica vazio (C2).
- O ator de teste era de nível 3, e o print 06 mostra só o Patamar 1 (C3a).
- A evidência também confirma C1 no world.db: `build.choices` não tem nenhuma choice `apparition-1-*`.
- O check "código de produção alterado: false" é o esperado. Não é achado.
