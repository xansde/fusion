# o6b: re-verificação adversarial, rodada 1

Worktree: scratchpad/wt-d. Core `ficha3/o6b` @ 82231a7e; satélite `ficha3/o6b` @ 66c3a3f.

## C1 (importante): FECHADO
- Commit ee0d801c: o comentário do teste do outsider e o texto da T6.5 e do Gate no tasks.md agora dizem que a negativa prova **só o snapshot de join**. Os dois citam `xansde/fusion#240`.
- A issue #240 está aberta. Descreve os dois predicados: `redaction.ts:800` (`isCharacterActor`, que devolve true para qualquer viewer) e `sync-handlers.ts:404` (`resolveOwnership >= LIMITED`). Descreve também o conflito entre 05 REQ-USR-025a (default=none) e 39 REQ-CTT-014 ("Na mesa" mostra todos a todos).
- O predicado não foi alinhado. Julguei essa decisão CERTA:
  - A divergência é anterior à o6b: nenhum dos dois predicados foi tocado nesta onda.
  - Qualquer lado que se escolha muda o produto, e a spec não diz qual está certo. Unificar em "character visível a todos" entrega `system.derived` da ficha alheia a todos os jogadores, o que é uma questão de privacidade. Unificar em "ownership" apaga o "Na mesa" de REQ-CTT-014.
  - A T6.5 é sobre o gatilho de UI e a prova dele. Deixar o alinhamento de fora não corta nada dela.
  - A pendência ficou registrada como issue, como pede a regra.
- Resíduo, sem virar achado: o teste do outsider continua travando o lado restritivo, mas está anotado. Se a #240 decidir por "todos veem", ele tem que ser invertido junto.

## C2 (importante): FECHADO
- Commit 20edd60d: `runUserAdd` agora delega a `AuthService.createUser` (`auth/service.ts:278-337`), que cria o Actor `character` na mesma transação, com default=NONE e o novo usuário como OWNER. GM e ASSISTANT continuam sem Actor.
- Vermelho antes do conserto, por leitura: o código antigo chamava só `userStore.create`, e esse caminho nunca cria Actor.
- Verde agora: `user-add.test.ts` passou 2/2, rodado por mim contra o dist atual (o dist contém `authService.createUser`).
- Regressão: nenhuma.
  - Nome duplicado continua saindo com exit 1 e a mesma mensagem, agora via `AuthError NAME_TAKEN`.
  - A senha gerada continua impressa uma vez, igual a antes.
  - `loadOrCreateSecret` segue o mesmo padrão de `worlds.ts:166`.
  - O store não tem cache de documentos em memória, então escrever direto no banco não gera estado divergente novo.
- Outros caminhos de criação de usuário: sobra só `bootstrapGm`, que cria GM e portanto fica sem Actor, correto.

## C3 (importante): FECHADO
- Commit 66c3a3f: `checkSlotRequirement` agora usa `filter` e `!includes(classSlug)`. Ficou coerente com o filtro do picker (`planVM.ts:2303-2308`, `traits.includes(classSlug)` e `looksClassTagged`).
- Vermelho antes do conserto, por leitura:
  - No pack real (`feats-core/documents.json`), os traits de Familiar são `[magus, sorcerer, thaumaturge, wizard]` e os de Cantrip Expansion começam com `bard`.
  - O `find` antigo devolvia `magus` para um Wizard e marcava WrongClass. As fixtures do teste batem com o pack.
- Verde agora: 4/4 no describe "several class traits", rodado por mim.
- Caso sem classSlug: continua marcado, igual ao comportamento antigo.
- Não achei outro ponto com a mesma lógica de "primeiro trait de classe" no satélite.
- Issue de rastreio aberta: fusion-systems-2e#129.

## Ataque ao diff do conserto
Não achei regressão nem achado novo bloqueante ou importante.

Veredito: APROVADA.
