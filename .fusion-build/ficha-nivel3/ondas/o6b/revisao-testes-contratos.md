# Revisão adversarial — O6b (T6.5) — lente: teste não-circular + contratos

Escopo revisado: core `git diff origin/alfa/app...ficha3/o6b` (commit `d848ce08`: 2 arquivos de teste + `tasks.md`);
satélite `git diff origin/main...ficha3/o6b` = **vazio** (nenhum contrato core<->satélite tocado).
Nenhum código de produção foi alterado nesta onda.

## Veredito

Pode mergear. **Nenhum bloqueante.** A decisão de não criar botão novo está certa pelas specs
(REQ-CFG-051a, REQ-USR-025/025d, DEC-NPC-02, REQ-NPC-055a [V2]); não é corte de escopo.
Os testes novos não são circulares: o fixture do servidor passa pelo `authService.createUser` real
(REQ-USR-025), e o teste de socket usa o `buildSnapshot` real. Nenhuma asserção existente foi
enfraquecida, pulada ou afrouxada (o diff só acrescenta).

O problema está no que os testes **afirmam provar**: a fronteira de redação que o teste do "outsider"
diz garantir vale só no snapshot de join. Nos outros três caminhos de emissão ela não vale.

## Achados

### A1 — importante — a fronteira que T6.5 "prova" não existe no broadcast, no replay nem no eco do ack (viola REQ-NET-096)

- Arquivos: `packages/server/src/net/redaction.ts:800` (`if (isCharacterActor(doc)) return true;`),
  em contraste com `packages/server/src/net/handlers/sync-handlers.ts:~400` (o snapshot filtra por
  `resolveOwnership >= LIMITED` antes do funil). Teste novo:
  `packages/server/src/__tests__/player-character-create.test.ts:704-716` e o comentário em :666-672
  ("the redaction boundary that makes 'na mesa' safe…").
- Cenário (conferido chamando o `redactActorDocsForViewer` do `dist`): um ator
  `{type:"character", ownership:{default:0, owner:3}, system:{derived:{ac:18}, attributes:{hp:…}}}`
  com viewer = outro jogador (`role 1`, sem posse) → o funil devolve o documento INTEIRO
  (`hp` removido, `system.derived` e o resto intactos) e `removedIds: []`. Esse é o funil usado pelo
  broadcast ao vivo (`doc-handlers.ts:2351`), pelo replay (`sync-handlers.ts:205`) e pelo eco do ack.
- Em produção: o jogador B entra e o card do personagem do jogador A não aparece em "Na mesa"
  (o snapshot o retira). Depois de qualquer `doc:update` de A (por exemplo, escolher a classe no
  builder), o corpo chega a B e o card aparece. Quando B recarrega a página, o card some de novo.
  Isso contraria REQ-NET-096 ("NÃO DEVE emitir um Actor a usuário < LIMITED por **nenhum** dos quatro
  caminhos… predicado único") e deixa a seção "Na mesa" instável.
- O defeito é **anterior** à onda. O que a T6.5 acrescenta é a falsa garantia: o teste cobre só o
  snapshot, e o comentário e a linha em `tasks.md` apresentam isso como prova da fronteira.
  Há também um conflito de spec não resolvido: spec 39 Q-CTT-03 diz "Na mesa mostra todos a todos",
  enquanto REQ-USR-025a (`default = none`) e REQ-NET-096 dizem o contrário.
- Correção mínima nesta onda: estender o teste do outsider para o broadcast (A faz `doc:update` e B
  não pode receber o corpo) **ou** retirar do comentário e do `tasks.md` a alegação de fronteira e
  abrir uma issue que case REQ-NET-096 com Q-CTT-03 (decisão de produto: o personagem nasce
  `LIMITED` para a mesa, ou o funil passa a aplicar o corte de ownership também a character).

### A2 — menor — a asserção negativa do outsider passa no vazio

- Arquivo: `player-character-create.test.ts:712` (`actorDocsIn(traffic).some(...) === false`).
- Cenário: uma regressão que faz o snapshot de um jogador sair com `documents.Actor = []` (o
  `catch` de `sync-handlers.ts` já faz exatamente isso quando a tabela inteira lança) ou que muda o
  caminho `payload.snapshot.documents` deixa `actorDocsIn` retornando `[]`, e o teste continua verde.
- Correção: afirmar também que o **próprio** personagem do outsider (ele foi criado por
  `createUser`, então tem um) está presente no mesmo snapshot.

### A3 — menor — a "prova automatizada da cadeia" não cobre os dois últimos elos

- Arquivos: `docs/design/ficha-nivel3/tasks.md` (linha T6.5 e o texto do Gate) e
  `ContactsPanel.test.ts:393-401`.
- Cenário: trocar `planVisible = $state(true)` para `false` em
  `external/fusion-systems-2e/sheets/pf2e/src/components/sheets/pf2e/CharacterSheet.svelte`
  (DEC-R10-05) ou desligar o `openActorSheet` do botão do card. Nenhum teste da T6.5 falha, e
  nenhum outro teste referencia `planVisible` (grep vazio em `*.test.ts`). O teste de componente
  só confere se o `aria-label` do botão existe.
- O texto de `tasks.md` diz "prova automatizada da mesma cadeia… até CharacterSheet com a coluna
  Plano visível". Isso é mais do que foi provado. Registrar o elo que falta como issue ou reduzir o
  texto.

## Conferido e sem achado

- O fixture do cliente (sem `system`) difere do que o cliente recebe em produção: o snapshot roda a
  derivação, e o cliente recebe `system: {derived, abilities}`. Conferi rodando `runActorDerivation`
  num character em branco: não aparece `details`, então `systemIdentityLine` devolve `""` do mesmo
  jeito. Resultado equivalente, não é achado.
- A linha de fallback vazia atende REQ-CTT-023 ("identificação já disponível": não há nenhuma).
- Não há mudança de contrato core<->satélite. O pin do submódulo segue a regra do fecho.
