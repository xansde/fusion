# Re-verificação adversarial — Onda 4b, rodada 1

Alvo: fixer r1 (satélite `675375c`, `b6ccce1`, `5073cfd`; core `0f84874f`) em `wt-d`.
Sem edição: as sondas rodaram num arquivo de teste temporário, apagado depois (a árvore está limpa).
`apparitionSpellcasting.test.ts` passa 18/18. A suíte inteira não foi rodada.

## Veredito: REPROVADA (há 2 itens importantes em aberto: C7 e N2)

## Situação de cada achado

| id | situação | como foi verificado |
|---|---|---|
| C1 | FECHADO | Leitura: `chooseClassChoice` tira de `ops` a escrita de choices de `chooseFeat` (que é sempre o último op; o caso `[]` do teto de repetição está protegido por `ops.length>0`) e a passa como `pendingChoices`. O `removeChoice` avulso junta `remaining` na escrita única de `apparitionLoreSyncOps`. Os testes C1 cobrem pick e remove em ator legado. Resta um caminho residual, descrito em N1. |
| C2 | FECHADO no código, aceite pendente (ver C7) | Leitura: `pendingApparitionSpells` e o `$effect` sobre `doc` reenviam só os ops que não são `doc:create`, e a espera expira em 10 s. A condição de corrida entre a entrada e a resolução não se aplica, porque `getDocument` é um round-trip de socket que vem depois do `doc:create`. Falta o print do pick 1 com o rank 1 listado sem reabrir. |
| C3 | FECHADO | O pick e o remove passam `ctx.level`. `levelSet` tira a entrada Apparition do laço genérico e sincroniza pela tabela própria. O heal ajusta o `max` de uma entrada que já existe. O teste C3b cobre a subida 1→2→3. |
| C4 | FECHADO | `skipApparitionLoreSync` no `removeChoice` interno do swap. O teste usa `.not.toBeNull()` sobre Fortune-Telling. |
| C5 | FECHADO | Medição própria, ranks 0-2 + vessel, contra `spells-core`: faltam Blistering Invective, Protector Tree, Gentle Breeze, Ill Omen e Rousing Splash. Os 3 últimos já estavam no corpo da #115 e os 2 primeiros entraram pelo comentário. A falha agora aparece no `onGrantFailure` do pick e do heal. |
| C6 | FECHADO | Os testes usam slot nível 1 com `characterLevel` à parte, fazem assert de `build.choices`, cobrem remove em ator legado e levelSet→slots. |
| C7 | **ABERTO** | `evidencia-viva.md` e `prints/` são de 18:44–18:55, anteriores ao fixer. O próprio fix-r1 diz que não subiu servidor. Não existe print de aceite do C2 (rank 1 listado sem reabrir) nem de ator nv3. |

## Achados novos

### N2 · importante: subir para o nv3 não traz a magia de rank 2 do repertório até a ficha ser reaberta
`PlanColumn.svelte` `handleLevelUp` (linhas ~1495-1503) manda `levelUp(opCtx)` e depois
`materializeClassGrantsAtLevel`, mas não chama `materializeApparitionSpells(targetLevel)`.
Com o C3b, a entrada ganha o slot de rank 2 (`max 1`), só que `apparitionRepertoireOps` só roda no pick, no remove e no heal de abertura.
Cenário: Animist nv2 com Crafter in the Vault atunado → clica em subir de nível → a aba Apparition Spells
mostra o 2º círculo com 1 slot e nenhuma magia. Knock só aparece depois de fechar e reabrir a ficha.
É o mesmo sintoma do C2 ("não adicionou nada até reabrir") no fluxo central da fatia nível 3.
Na descida 3→2, Knock fica no repertório até reabrir, pelo mesmo motivo.
Conserto: em `handleLevelUp` (e em qualquer chamada de `levelSet`), quando houver apparition atunada, rodar
`void materializeApparitionSpells(targetLevel)`, que já retrai e arma o `pendingApparitionSpells`.

### N1 · menor: repetir a mesma aparição no mesmo slot apaga a choice dela
Sonda (teste temporário): `chooseClassChoice(ctx, "apparition", 1, Crafter, "apparition-1-0", 1)` duas vezes seguidas.
O 2º lote emite `[doc:delete, doc:update(build.choices = remaining sem apparition-1-0), doc:create]`.
A escrita final de `apparitionLoreSyncOps` é suprimida porque `sameChoiceSet(final, persisted)` dá verdadeiro,
e então a escrita intermediária do `removeChoice` interno (que com `skipApparitionLoreSync` cai no `else`) fica valendo.
Resultado: `build.choices` fica sem `apparition-1-0`. O teste falhou com `expected [ …(2) ] to include 'apparition-1-0:'`.
Impacto baixo: o slot é item-backed (`resolveSlot` acha o item pelo build flag) e nenhum consumidor lê a choice
`type: "apparition"`. Mesmo assim é o livro-razão divergindo, a mesma classe do C1.
Medi as 14 aparições: com 2 slots, nenhuma troca entre aparições DIFERENTES produz um conjunto de Lore igual,
então só a repetição da mesma aparição dispara o problema.
Conserto: em `chooseClassChoice`, comparar `finalChoices` contra o estado que o lote deixa para trás
(o último `build.choices` já em `ops`), e não contra `persistedChoices`. Outra saída é emitir a escrita sempre que `ops` já contiver uma escrita de choices.

## O que não é achado
- Um nível 3→2 deixa `slots.2` com `max 1`: segue o comportamento do laço genérico pré-existente, que também não zera ranks acima.
- O remove não passa `onGrantFailure`: cosmético.
