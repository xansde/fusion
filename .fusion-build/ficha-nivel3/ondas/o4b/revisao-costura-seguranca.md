# Revisão adversarial — costura, CI, segurança e UI da Onda 4b (T4.4, aparições do Animist)

**Veredito: NÃO PODE MERGEAR.** Tem 2 bloqueantes, 3 importantes e 3 menores.

O gate registrou "PODE MERGEAR: SIM" mesmo com os 3 ajustes obrigatórios da revisão da decisão
(`T4.4-aparicoes-revisao-decisao.md`) ainda abertos. O satélite parou em `497313a` e nenhum commit
de correção entrou depois dele.

Revisado: satélite `origin/main...ficha3/o4b` (planVM.ts, PlanColumn.svelte, apparitionSpellcasting.test.ts,
planVM.test.ts) e core `origin/alfa/app...ficha3/o4b` (pin `497313a`, tasks.md, execucao.md).
Nada foi editado. Os probes rodaram isolados, com um config de vitest no meu scratchpad
(`f93e1369-.../scratchpad/probe/probe.test.ts`) que importa o `planVM.ts` real e os packs reais.

## O que está OK (lente costura/CI/segurança)

- **Higiene:** o diff do core tem 3 arquivos (2 docs e o pin) e o do satélite tem 4 arquivos de código/teste.
  Não entrou data-dir, auth_secret, node_modules, vendor, out/ nem binário. O lockfile não foi tocado.
- **Pin:** `external/fusion-systems-2e` aponta para `497313a`, que já foi pushado para `ficha3/o4b` do satélite.
- **Segurança:** todas as ops são `doc:create`, `doc:update` ou `doc:delete` com o ator do próprio jogador
  como pai, pelo caminho normal de permissão do servidor. Não há mudança de redação nem predicado de
  privilégio duplicado.
- **CI:** o CI do satélite roda `pnpm --filter @fusion/sheets-pf2e test`. O teste novo está nesse include
  e passa isolado (13/13). Os packs que ele lê (`class-features-core`, `classes-core`) estão versionados.
  As falhas pré-existentes (actionCategories, pregen-parity) são as mesmas do baseline.
- **Ghost cleanup:** "Apparition Spells" (espontânea) não casa com o critério de ghost do `divine Spells`
  (preparada, e o nome é diferente).

## Achados

### B1 — BLOQUEANTE — o sync de Lore sobrescreve `system.build.choices` a partir do snapshot velho
`planVM.ts:5181-5193` (`apparitionLoreSyncOps`) grava `[...keptChoices, ...newLoreChoices]` a partir de
`getBuildChoices(ctx.doc)`. Esse snapshot é anterior à escrita do `chooseFeat`/`removeChoice`, e essa
escrita vem DEPOIS da dele no mesmo lote.
- Probe A (pick em ficha nova): depois de `chooseClassChoice("apparition", …, "apparition-1-0")`,
  choices = `[apparitionLore-0, apparitionLore-1]`. A choice `apparition-1-0` sumiu.
- Probe D (ator anterior à lane, que já tem as choices `apparition-1-0/1-1`, que é o caso do mundo do
  Alexandre): depois de `removeChoice` do slot `apparition-1-1`, o item é deletado, mas as choices continuam
  `[apparition-1-0, apparition-1-1, apparitionLore-0, apparitionLore-1]`. O slot vira fantasma: `resolveSlot`
  cai na choice e mostra o slot preenchido sem aparição (padrão #15/#26).
- O mesmo acontece no heal de abertura. O passo (5) do `runHeal` regrava as choices a partir do snapshot da
  abertura e pode desfazer escritas de choices de passos anteriores do mesmo heal.

### B2 — BLOQUEANTE — o fix de "não mudou nada" nunca foi visto rodando, e o repertório de rank 1 fica invisível depois do pick
`planVM.ts:5339` só grava `slots.<rank>.spellsKnown` na PRÓXIMA chamada, depois do ack do create.
O `SpellsTab.knownSpellsAt` (SpellsTab.svelte:534) só mostra magia de rank ≥1 que esteja em `spellsKnown`.
O heal roda uma vez por ator aberto (`healedActorId`).

Cenário: o jogador escolhe a 1ª aparição. O truque aparece, porque `cantrips()` não filtra por known, mas o
rank 1 (ex.: Mending) fica vazio até a ficha ser reaberta ou outra aparição ser escolhida. Ao escolher a 2ª
aparição, as magias da 2ª ficam invisíveis. É a mesma queixa do Alexandre.

Além disso, com o rank-1 known vazio, o botão "adicionar conhecida" libera knownCap=1 para qualquer magia
divina. O próximo reconcile sobrescreve `spellsKnown` e deixa órfão o item que o jogador escolheu.

Some-se a isso: não há prova Vivo/Olhado nem roteiro tutorial-e2e (execucao.md, linha 4b, marcada como
"NÃO FEITO"), exigidos por `docs/design/PROCESSO-UI.md` e pela tabela de critérios da própria fatia.
Numa onda cujo pedido é literalmente "a tela não mudou", mergear sem print é mergear sem aceite.

### I1 — IMPORTANTE — o `levelSet` aplica a tabela PREPARADA à entrada "Apparition Spells"
`planVM.ts:6510` sincroniza os slots de TODA spellcastingEntry que não é de foco com
`classSystem.spellcasting` (a metade preparada).
Probe B: aparição escolhida no nv1 dá `{0:2, 1:1}` (certo). Subir para o nv2 dá `{1: max 2}`, e o livro
diz 1 (curadoria animist.json nota 9: L2 {1:1}). Subir para o nv3 dá `{1:2, 2:1}`, e o livro diz {1:1, 2:1}.
Todo Animist que sobe de nível ganha um slot de aparição de rank 1 a mais.
Conserto: excluir `class:apparitionSpellcasting` desse loop e ressincronizar pela `ANIMIST_APPARITION_SLOTS_BY_LEVEL`.

### I2 — IMPORTANTE — o pick usa o nível da LINHA do plano (1), não o nível do personagem
`PlanColumn.svelte:1219` e `:1208` passam `slotPicker.level`, que é 1 para `apparition-1-N`.
Probe C: Animist nv3 escolhendo a 1ª aparição cria a entrada com `{0:2, 1:1}`, sem o slot de rank 2
(o livro manda {1:1, 2:1}).
E `materializeApparitionSpells(1, …)` usa maxRank=1 (`PlanColumn.svelte:427`, `planVM.ts:5268`).
O loop de retração (`planVM.ts:5296`) então DELETA as magias de rank 2 (ex.: Knock) que o heal (ctx.level=3)
criou, e o próximo heal recria. As magias de rank 2 ficam oscilando entre delete e create a cada troca de aparição.
Conserto: passar `ctx.level`.

### I3 — IMPORTANTE — os 3 ajustes obrigatórios da revisão da decisão não foram aplicados, e o gate aprovou mesmo assim
O satélite continua em `497313a`. B1 (= ajuste 1), B2 (= ajuste 2) e M1 (= ajuste 3) seguem abertos.
É defeito de costura: o gate compara só com o baseline de testes e não confere se as revisões anteriores foram fechadas.

### M1 — MENOR — o heal regrava `system.build.choices` em toda abertura
`planVM.ts:5182-5185`: `sameChoices` sai sempre falso quando já existem choices `apparitionLore-*`,
porque `keptChoices` as exclui. Resultado: um `doc:update` por abertura, contado como `created++`.

### M2 — MENOR — a aparição primária não é estável quando o slot 0 é trocado
`PlanColumn.svelte:425/437`: `[...others, justPicked]` não é reordenado. Ao trocar o slot 0, a primária
vira a aparição do slot 1 e o vessel é trocado. No próximo heal (ordenado por slot), volta ao slot 0 e
troca de novo.

### M3 — MENOR — a retração apaga qualquer magia com location = entrada de aparição
`planVM.ts:5296`: uma magia que o jogador pôs à mão na aba "Apparition Spells" (botão de adicionar
conhecida, ver B2) é deletada no reconcile seguinte, sem aviso.

## Conferência com o livro (recorte 1-3)
- Tabela da metade espontânea L1 {1:1}, L2 {1:1}, L3 {1:1, 2:1}, 2 truques: a constante está certa.
  O que quebra são os caminhos de nível (I1, I2).
- Repertório = truque + rank 1 (+ rank 2 no nv3) das aparições atuneadas: está certo no parse. Conferi
  as 14 aparições e todas parseiam (lore, vessel e ≥3 magias). Faltam 6 nomes em spells-core:
  Blistering Invective, Protector Tree, Gentle Breeze, Ill Omen (×2) e Rousing Splash, que são a issue
  #115 já declarada. Por causa dela, a Custodian of Groves and Gardens no nv1 não ganha magia de rank 1.
- Vessel da primária no pool `class:focus`: a entrada existe desde o `applyClass` (probe E).
- Troca de aparição: o repertório e o Lore trocam no nível de ops (os testes provam). Na tela, B1, B2 e I2
  impedem que a troca fique correta.
