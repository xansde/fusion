# Revisão adversarial O0, rodada 4

Alvo: fix-r4 (satélite `f7bc97e`, core `ac8caf99` com o pin em `f7bc97e`).

## N1: FECHADO

- Ligação: `CharacterSheet.svelte:448` `handleLevelCommit` -> `commitUpdate` -> `updateScheduler.commitNow`. O `oninput` (linha 439) continua usando `scheduleUpdate(vm.updateLevelDraft)`, que é só o dual-write sem efeito colateral.
- `commitNow` (`updateScheduler.ts`): `clearPending()` seguido de `flush(op)` **síncrono**. Como o envio não passa por timer, nenhum `schedule()` posterior consegue cancelá-lo. A corrida da r3 (commit, depois outro campo em menos de 400 ms) não se reproduz mais.
- Teste: `updateScheduler.test.ts` roda 6 de 6 verdes, rodado por mim. No caso "N1", se `commitNow` fosse um alias de `schedule` (o comportamento antigo), o `schedule({speed})` do passo 4 limparia o timer do commit e o `expect(sent).toContainEqual(grant:retract)` falharia. A leitura confirma a demonstração de vermelho do fixer.
- `levelSet` não depende do nível anterior guardado no doc: faz a retração por `slotLevel > clamped` e a sincronia de slots pelo nível-alvo. Por isso, um draft que já persistiu o nível novo não esvazia o commit.
- O `clearPending` do commit só descarta de fato o draft do próprio nível, porque qualquer `change` no input de nível é precedido por um `input` nele, e esse `input` já tinha substituído o draft pendente de outro campo.

## Ataque ao diff: sem regressão bloqueante ou importante

- Pin do core confere (`git ls-tree`: `f7bc97e`). A branch do satélite está em dia com `origin/ficha3/onda0`.

## Menores (não bloqueiam)

- M1 (processo): a issue #94 continua OPEN. O commit `f7bc97e` não traz `Closes #94`, e o corpo do PR #99 ainda diz "NÃO MERGEAR — achado aberto #94". O pedido era fechar a issue no commit.
- M2 (pré-existente, fora do escopo da O0): `schedule()` descarta o draft pendente de **qualquer** campo, não só do mesmo campo. Exemplo: digitar "30" em Speed, dar Tab e digitar em HP máx em menos de 400 ms faz a op de Speed nunca ser enviada. O docstring novo ("only the most recent draft of a given field matters") descreve um comportamento que o código não tem. Não é regressão (o timer único já existia antes). Sugestão: abrir issue para um debounce por chave, ou fazer flush do pendente em vez de descartar.
