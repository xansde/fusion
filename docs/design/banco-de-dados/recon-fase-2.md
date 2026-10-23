# Recon Fase 2 — leitura adversarial de T012/T013/T016/T025

Data: 2026-08-16 · Base: `alfa/app` (worktree `wt-banco`)

Quatro tarefas da Fase 2/3 (T012, T013, T016, T025) passaram por um recon (levantamento
de terreno + premissas + abordagem + riscos + plano de teste) seguido de uma refutação
adversarial independente — outro agente, sem acesso ao raciocínio do primeiro, tentando
derrubar cada afirmação por execução real (scripts em
`scratchpad/recon-fase-2/*.{mjs,cjs}`, contra o `dist/` compilado do worktree e, quando
citado, contra o mundo real `~/.fusion/worlds/teste_xande/` em cópia só-leitura).

Uma quinta rodada (T014/T015) foi disparada e **falhou antes de produzir resultado** —
não existe `T014.json` nem `T015.json`. Ver seção dedicada abaixo; não invento conteúdo
para essa lacuna.

Este documento não repete o recon inteiro. Ele extrai o que **sobrevive** ao ataque
adversarial: fatos provados por execução, premissas do plano que caíram, desenhos que
morreram (para ninguém tentar de novo do mesmo jeito), e defeitos vivos achados de
passagem que não eram tarefa de ninguém.

## Panorama por tarefa

| Tarefa | Veredito da refutação | O que isso significa na prática                                                                                                     |
| ------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| T012   | SUSTENTA_COM_RESSALVA | Abordagem certa na direção, código de exemplo errado (quebra em runtime) e escopo subdimensionado (batches, chat_messages/settings) |
| T013   | SUSTENTA_COM_RESSALVA | Gate central correto, mas contornável por lote misto; depende de um pré-requisito (mirror fresco) que o recon não verificou         |
| T016   | **DERRUBA**           | O desenho ("função única, 4 call sites") não é implementável como escrito — precisa de desenho novo                                 |
| T025   | **DERRUBA**           | O gate de autorização proposto é contornável pelo próprio atacante — precisa de desenho novo                                        |

---

## T012 — Transação em volta do read-modify-write

### Provado por execução

- **O esqueleto de código do recon não roda.** `this-bind.cjs` reproduz literalmente a
  proposta (`this.db.transaction(function () { const existing = this.get(...); ... })`
  chamado como `txn.immediate()`) contra o better-sqlite3 real desta árvore
  (`node_modules/.pnpm/better-sqlite3@12.10.0/.../transaction.js:65`,
  `apply.call(fn, this, arguments)`): dentro do callback, `this` é o **objeto-função da
  transação** (únicas props: `database`), não a instância de `DocumentStore`. Saída real:
  `TypeError: this.get is not a function`. O estilo arrow-function que `store.ts` já usa
  hoje (linhas 367, 545, 572, 599, 625, 645) é **load-bearing** por causa disso — precisa
  ser preservado, não descartado, ao mover a leitura para dentro da transação.
- **`createBatch`/`updateBatch`/`deleteBatch` não estão "já corretos".** `snapshot2.cjs`
  (duas conexões reais no mesmo arquivo WAL, reproduzindo a forma read-then-write de
  `_createInTxn`/`_updateInTxn`, `store.ts:684/691` e `:703/734`, dentro da variante
  `default`/DEFERRED usada em `:599/625/645`): sob contenção real, a leitura-então-escrita
  em transação DEFERRED lança `SQLITE_BUSY_SNAPSHOT` — e **`busy_timeout` não ajuda**,
  o erro chega em ~0–5ms mesmo com timeout de 60000ms configurado, porque não é um erro
  de lock, é recusa de upgrade de snapshot. O lote **inteiro** aborta, não uma linha. Como
  contraste, a mesma disputa sob `.immediate()` serializa corretamente: uma conexão
  comita em ~309ms, a outra é excluída com `SQLITE_BUSY` comum (retentável). Esse caminho
  é alcançável em produção hoje via `compendium/service.ts:475` (`store.createBatch`)
  rodando enquanto o servidor grava.
- **O lost update em si é real e reproduzido**, tanto o bug quanto a correção: `exp1-lost-update.cjs`
  reproduz a perda de dado hoje (duas conexões, uma sobrescreve a outra em silêncio, sem
  erro — `gold=100` vira `gold=0`); `exp2-immediate-*.cjs` (dois processos OS reais via
  `child_process.fork`, não threads) confirma que ler e escrever dentro da MESMA
  transação `IMMEDIATE`, com duas conexões concorrentes, serializa de verdade (a segunda
  conexão bloqueia ~758ms enquanto a primeira segura um `IMMEDIATE` de 800ms, e ao
  desbloquear já enxerga o commit da primeira).
- **A enumeração de quem abre `world.db` fora do servidor estava incompleta por um.**
  `grep -rn "openDatabase(" packages/server/src --include=*.ts` (fora de `__tests__` e
  `connection.ts`) devolve 6 chamadores, não 5: falta `packages/server/src/admin/lockout-db.ts:54`.
  Não muda nenhuma conclusão (não é tabela de documento), mas mostra que a lista não foi
  varrida à exaustão.
- **A lista de emissores concorrentes de `chat_messages`/`settings`/`users` estava
  incompleta.** Essas três tabelas são `DOCUMENT_TABLES`
  (`packages/shared/src/document.ts:275/279/291`), mas têm escritores de produção em SQL
  cru que **não passam pelo `DocumentStore` nenhuma vez** — a forma exata do bug do T012,
  só que sem NENHUMA transação, nem a fraca de hoje.
  `packages/server/src/etmos/conjuracao-handlers.ts:188-194` (`loadChatMessage`, SELECT)
  e `:197-205` (`updateChatMessage`, UPDATE) fazem read-modify-write em JS puro sobre
  `chat_messages`, em 5 pares de call sites (linhas 406/428, 464, 580/750, 773/845,
  889/926). Outros bypasses da mesma família: `chat-handler.ts:205`, `combat-chat.ts:98`,
  `contestado-handler.ts:148` (INSERT em `chat_messages`); `sync-handlers.ts:109` e
  `seq-store.ts:63` (`INSERT OR REPLACE INTO settings`). Conferido também o inverso:
  `user-store.ts:293/303` usa `SET` por campo (não é read-modify-write em JS) — não é
  vulnerável, não entra na lista.

### Premissas que caíram

- **O plano dizia**: os batches (`createBatch`/`updateBatch`/`deleteBatch`) já estão
  corretos porque leitura e escrita ficam na mesma transação externa, e trocar a variante
  para `.immediate()` neles é "defesa em profundidade... não estritamente exigido". **A
  execução mostrou**: é o pior caso sob concorrência real (DEFERRED + read-then-write =
  `SQLITE_BUSY_SNAPSHOT` não-retentável, lote inteiro abortado). O item é **exigido**, não
  estético.
- **O plano dizia**: o esqueleto de código com `function () { this.get(...) }` chamado via
  `txn.immediate()` é como implementar a correção. **A execução mostrou**: não roda —
  `this` dentro do callback não é a instância de `DocumentStore`. É preciso manter arrow
  functions, exatamente como o código atual já faz.
- **O plano dizia** (implícito, ao listar os call sites do T012 como a corrida inteira):
  corrigir `store.ts` fecha a janela de corrida do fluxo de escrita de documento. **A
  execução mostrou**: existe uma família de escritores (chat/settings via SQL cru) fora
  do `DocumentStore` por completo, com a mesma forma de bug e nenhuma proteção — corrigir
  `store.ts` não encosta nisso. Fica fora do escopo de arquivo de T012
  (`store.ts`/`connection.ts`), mas precisa ser nomeado como risco adjacente conhecido,
  não descoberto de novo por quem implementar.

### O que muda na implementação

1. Mover a leitura/checagem para dentro do callback da transação em `create()`, `update()`
   e `delete()` **mantendo arrow functions** — não reescrever para `function(){}` +
   `.immediate()` como o esqueleto original sugeria.
2. Trocar a variante `default` para `.immediate()` também nos 3 batches
   (`store.ts:599/625/645`) — isso agora é parte do "Pronto quando", não um extra.
3. O plano de teste (duas conexões reais, dois processos OS) precisa cobrir, além de
   `update()`: a checagem de colisão de id em `create()` (`store.ts:354`), a checagem de
   existência em `delete()` (`store.ts:568`), e **o caminho de batch sob contenção real**
   (onde `SQLITE_BUSY_SNAPSHOT` foi reproduzido) — não só o caso feliz de `update()`.
4. O bypass de `chat_messages`/`settings` via SQL cru em `conjuracao-handlers.ts` e afins
   fica fora do escopo de arquivo de T012 — registrar como risco conhecido (ver riscos do
   recon original) para abrir tarefa própria depois; não foi criada uma tarefa nova para
   isso nesta rodada.

---

## T013 — `expectedVersion` deixa de ser opcional

### Provado por execução

Script `probe.mjs` rodando `buildDocUpdateHandler`/`buildTokenMoveHandler` reais sobre
SQLite real (dist do worktree):

- **Caso A** (baseline): `create` → `version: 1`; após 1 `update` → `version: 2` —
  confirma que `buildUpdateStats` (`store.ts:131-140`) incrementa (`existing.version + 1`,
  linha 135).
- **Caso B** (lote misto — 1 entry primária de Actor sem `expectedVersion` + 1 entry
  `embedded` de Token): `ack.ok = true`, `ack.result.documentType = "Scene"`; o Actor
  ficou **inalterado** (nome e versão antes == depois). A entry primária foi **engolida
  em silêncio**, e o ack não denuncia isso.
- **Caso C** (mesmo formato de lote, mas a entry primária com `expectedVersion: 999999` —
  grosseiramente obsoleta): `ack.ok = true`, `code = undefined`. A checagem de
  `STALE_WRITE` (774-785) **nunca rodou**.
- **Caso D** (após remover `_stats.version` de uma linha persistida via SQL direto):
  `store.get` devolve `version` como `undefined` — o `.default(1)` do schema Zod
  (`document.ts:75`) não se aplica na leitura. Um `update` com `expectedVersion: 1` volta
  `ack.ok = false`, `code = VALIDATION_FAILED` (não `STALE_WRITE`) — `buildUpdateStats`
  calcula `existing.version + 1 = NaN`.
- **Caso E** (player, dono do documento): version 1 → 2, delta = 1 — caminho normal
  funciona.
- **Caso F**: `_stats.version` do ack bate com o que está no banco.

Achado independente por leitura de código, confirmado por não haver broadcast no arquivo:

- `packages/server/src/etmos/reacao-handler.ts:254-277` (`applyEstresseCost`) chama
  `store.update("actors", actorId, {system:{estresse,fadiga}}, {userId})` — incrementa a
  versão do Actor. Seu único chamador (linha 351) emite **apenas** `combat:updated`
  (payload `{combatId, diff:{combatants}, seq}`, construído em 358-366) — nenhum
  `doc:update` de Actor em todo o arquivo.
- `packages/server/src/net/handlers/sync-handlers.ts:517` chama
  `store.update("scenes", id, {active: shouldBeActive}, ...)`, podendo bumpar até 2
  Scenes — só `world:activeScene` (`{sceneId}`, linhas 526-535) é emitido.
- Contraprova de que o padrão certo existe: `etmos/conjuracao-handlers.ts:853-874` emite
  `doc:update` de Actor corretamente depois de `store.update`.

Enumeração de arquivos de teste (client e server) do recon estava incompleta por poucos
itens, mas as conclusões numéricas ("zero testes de servidor quebram sob a política
recomendada") sobrevivem — os 2 arquivos de teste omitidos (`e2e-etmos-conjuracao.test.ts`,
`etmos/__tests__/conjuracao-handlers.test.ts`) e o emissor de cliente omitido
(`lib/docs/worldSync.ts:70`) são todos do lado receptor ou não mudam o resultado.

### Premissas que caíram

- **O plano dizia**: o gate recomendado (recusar `doc:update` sem `expectedVersion` para
  papéis não-privilegiados, dentro do bloco 774-785) cobre o caminho primário, e o
  caminho `embedded` é uma lacuna **separada**, documentada e fora de escopo. **A
  execução mostrou**: não são caminhos separados — o roteamento em
  `doc-handlers.ts:739` (`hasEmbedded = updates.some(u => u.embedded)`) desvia o **lote
  inteiro** para `handleEmbeddedUpdate` assim que **uma** entry tem `embedded`; esse
  handler (`:1118`, `if (!upd.embedded) continue;`) descarta as entries primárias em
  silêncio, com `ack.ok = true`. O caminho embedded não é paralelo ao primário, ele o
  **engole**. Agravante: o próprio item 4(a) da abordagem recomendada (coalescer diffs no
  VM em lotes multi-entry) empurraria o cliente para produzir justamente esse formato de
  lote misto, ativando um buraco hoje latente.
- **O plano dizia** (premissa PARCIAL do próprio recon): o documento no mirror do cliente
  já carrega `_stats.version`, então preencher `expectedVersion` automaticamente é
  "trivial". **A execução mostrou**: o dado existe, mas o desenho nunca verificou se o
  mirror fica **fresco** — há escritas de servidor que incrementam `_stats.version` sem
  emitir `doc:update` (`reacao-handler.ts`, `sync-handlers.ts`, acima). Sob a política
  recomendada, o jogador afetado levaria `STALE_WRITE` em toda escrita seguinte da
  própria ficha, permanentemente, sem nenhum sinal de resync (`sendOpFn` só faz
  `console.error`).
- **O plano dizia**: a checagem real é `if (upd.expectedVersion !== undefined)`. **A
  execução mostrou**: a condição completa (`doc-handlers.ts:782`) também exige
  `currentVersion !== undefined` — quando o documento persistido não tem
  `_stats.version`, a checagem vira no-op silencioso **mesmo com `expectedVersion`
  enviado**, e o incremento seguinte calcula `NaN`, deixando o documento permanentemente
  não-gravável com um erro enganoso (`VALIDATION_FAILED`, não `STALE_WRITE`). Hoje é
  latente — nenhum produtor desse estado foi identificado no código atual — mas uma
  migration futura que reescreva JSON de documento é um produtor plausível.
- **O plano dizia** que o plano de teste (3 casos) não é circular porque o oráculo vem de
  round-trip real via socket. **Isso se sustenta no sentido da lição #48** (o ataque de
  circularidade não encontrou nada ali), **mas** nenhum dos 3 casos observa a versão
  **avançar**: o caso 2 reenvia o número que o próprio servidor acabou de devolver no ack
  de `create` — um servidor com `_stats.version` travado em 1 passaria nos três casos
  como estão escritos. Falta um 4º caso: ler V, atualizar uma vez, reenviar o MESMO V,
  esperar `STALE_WRITE`.

### O que muda no escopo

- Fechar o roteamento `hasEmbedded` que engole entries primárias é **pré-requisito** do
  gate — não dá para shippar o bloco 774-785 sozinho contra lotes mistos. Esse fechamento
  específico está sendo corrigido nesta leva como item próprio (ver T030 em `tasks.md`);
  o resto do escopo original de T013 (protocolo, cliente, política, plano de teste) segue
  em aberto.
- A política "cliente preenche `expectedVersion` a partir do mirror" só é segura se o
  mirror for mantido fresco — isso torna fechar os broadcasts faltantes (T032, backlog)
  um pré-requisito real do rollout de T013 para papéis não-privilegiados, não um risco
  lateral que se documenta e segue.
- O plano de teste precisa ganhar o caso de monotonicidade (reenviar uma versão já
  consumida) — sem ele, a suíte não prova que o lock funciona, só que o número certo é
  aceito uma vez.
- Continua em aberto (não decidido nesta rodada) a política do lote mesmo-documento
  (coalescer no VM vs. incremento otimista local) — item 4(a)/4(b) do recon original.

---

## T016 — Ponto único de escrita de token + instrumentação

**Veredito: DERRUBA.** O desenho recomendado (`persistSceneTokens(...)` substituindo 4
call sites) não é implementável como escrito e, mesmo corrigido, ficaria cego a dois
caminhos de escrita reais. Precisa de desenho novo.

### Provado por execução

- **Os 3 call sites de `doc-handlers.ts` são polimórficos, não específicos de token.**
  `prove-callsite-polymorphism.mjs` instrumentou `store.update` real e mostrou os mesmos
  3 call sites (1080/1254/1363) servindo tanto Token↔Scene
  (`{table:"scenes", patchKeys:["tokens"]}`) quanto Item↔Actor
  (`{table:"actors", patchKeys:["items"]}`) — para update, create **e** delete de Item
  embedded. `EMBEDDED_PARENT_MAP` (`doc-handlers.ts:153-157`): `Token→Scene`,
  `Combatant→Combat`, `Item→Actor`.
- **Existe um caminho de escrita de token fora dos "4 call sites".**
  `prove-generic-path.mjs`: um payload `{documentType:"Scene", updates:[{_id,
diff:{tokens:[...]}}]}` **sem** campo `embedded` (o caminho genérico, `hasEmbedded =
false`) retornou `ok:true` e, lido de volta do disco: token movido, `hidden` alterado, e
  um token **novo injetado**. A única guarda que o caminho genérico tem para Scene é
  sobre o campo `active` (`doc-handlers.ts:~800`) — não existe guarda para `tokens`.
  Adicionalmente, `doc:create` de uma Scene inteira persiste `tokens` via `store.create`
  (`:698`) — um sexto caminho, também fora da lista de 4.
- **O "caminho real de criação de token" citado no recon não funciona.** O terreno cita
  `packages/client/src/lib/actors/actorDirectory.ts:97-120` como confirmação do fluxo
  drag-actor-onto-canvas → `doc:create` com `embedded.type="Token"`. `prove-tablescreen-create.mjs`
  mostra que esse arquivo é só uma interface TypeScript + docstring — o payload real que
  `TableScreen.svelte` envia (`{documents, embedded:{type,sceneId}}`) é **rejeitado** pelo
  servidor (`VALIDATION_FAILED`, `"data" Required`, 0 tokens no disco). O caminho de
  create que de fato funciona usa `{data, parent}` (`TokenInteractionManager.ts`).
- **O risco de key-repeat sem debounce é superdimensionado.** Existe um gate de
  concorrência: `canStartDrag` (`token-interaction.ts:368-374`) recusa novo drag enquanto
  o anterior está `pending`; `TokenInteractionManager.ts:585` checa isso antes de enviar
  (`:587`). O teto real é 1 escrita em voo por vez, limitado pelo RTT da rede — não a
  taxa de repetição de tecla do SO.
- **O log diário não rotaciona.** `logger.ts:25-28` (`dailyLogFilePath`) usa
  `date.toISOString().slice(0,10)` (UTC), chamado **uma vez** em `tryCreateFileDestination`
  (`:42-46`) dentro de `createLogger` (`:87`) — o nome do arquivo fica congelado para a
  vida do processo. Provado sobre o log real vivo da máquina: `fusion-2026-08-15.log` tem
  203 linhas cobrindo `2026-08-15T21:23:35.018Z` até `2026-08-16T03:15:58.824Z` — **duas
  datas UTC distintas no mesmo arquivo**. Isso é o defeito (d) listado abaixo.

### Por que o desenho original morre

1. **`persistSceneTokens(store, meta, tokens, ...)` hardcoda
   `store.update("scenes", meta.sceneId, {tokens}, ...)`.** Aplicá-lo aos 3 call sites de
   `doc-handlers.ts`, como o texto manda, roteia escrita de `Actor.items` para a tabela
   `scenes` — não é extração mecânica, é um bug de roteamento embutido no próprio
   "extrato mínimo".
2. **A lista de "4 call sites" não é exaustiva.** O caminho genérico de `doc:update`
   (sem `embedded`) e o `doc:create` de Scene completa gravam `tokens` sem passar por
   nenhum dos 4 — qualquer wrapper em volta deles fica cego a essas duas escritas, que
   são o achado (b) da lista de defeitos vivos abaixo.

### O que sobra para o desenho novo

- Mapear **todos** os pontos que gravam `scene.tokens`/`actor.items` — pelo menos 6 hoje
  (3 call sites polimórficos em `doc-handlers.ts`, `token:move` em `vision-handlers.ts`
  — morto do lado cliente mas alcançável via socket —, o caminho genérico de
  `doc:update`, e `doc:create` de documento completo) — não uma lista fixa de 4.
- Decidir se o "ponto único" é um wrapper parametrizado por tabela/coleção em cada
  call site, ou uma barreira dentro do próprio `DocumentStore`/validação que recuse
  `tokens` fora dos handlers dedicados — mesmo padrão que T010 já aplicou para `active`
  em Scene (`doc:update` passou a recusar o campo).
- A instrumentação (relatório em log) depende do defeito (d) — sem rotação, o "Pronto
  quando" original ("relatório de sessão real no log diário") aponta para o arquivo
  errado em qualquer sessão que atravesse meia-noite UTC (21h no fuso local, UTC-3) —
  exatamente o horário de uma sessão de RPG noturna.
- O antídoto contra a circularidade que a refutação sugeriu — comparar o **delta de
  `_stats.version`** de cada Scene contra a contagem da métrica — é reaproveitável no
  desenho novo como oráculo independente de "quantas escritas de verdade aconteceram".
- A métrica proposta só conta patches com a chave `tokens`; a linha inteira da tabela
  `scenes` é reescrita por outros escritores sem essa chave (`vision-handlers.ts`:
  `walls`/`lights`/`doorState` em 5 pontos; `sync-handlers.ts:517`: `active`) — uma
  métrica de pressão de reescrita real precisa contar todos, não só os de token.

---

## T025 — Autorização por documento na rota de assets

**Veredito: DERRUBA.** O gate proposto (`JSON.stringify(doc).includes(path)`) é
contornável pelo próprio atacante — o jogador controla o documento que apresenta como
prova de posse. Precisa de desenho novo.

### Provado por execução

- **A vulnerabilidade original é real e reproduzida.** `prove-vuln.mjs` contra o `dist/`
  real: um usuário PLAYER (role 1) fez `GET /assets/<hash-de-um-asset-referenciado-só-
por-Scene-oculta>` e recebeu `HTTP 200` com os bytes do arquivo. `GET /api/assets`
  (role ≥ TRUSTED) lista **todos** os nomes de arquivo do mundo, incluindo os só
  referenciados por documentos ocultos — um usuário TRUSTED (abaixo do limiar de
  privilégio, `ASSISTANT_GM=3`) recebeu o nome hash do asset oculto na listagem.
- **O gate do desenho é contornável.** `types.ts:83` — `img` do Actor é
  `z.string().nullable().optional()`, sem validação de conteúdo. `doc-handlers.ts:765-771`
  — a única barreira de `update` para não-privilegiado é `level < OwnershipLevel.OWNER`.
  Um jogador pode: (1) descobrir o nome de um asset oculto pelo próprio vazamento acima;
  (2) gravar esse path no `img` do próprio Actor (é OWNER dele); (3) pedir token com
  `docRef = {actors, próprio id}`; (4) `resolveOwnership` devolve OWNER, `includes(path)`
  devolve `true`, token é assinado; (5) `GET /assets/<secreto>` → 200. Não reproduzido
  contra código já implementado (o desenho nunca chegou a ser codificado), mas traçado
  ponta a ponta contra os arquivos reais citados.
- **HMAC e `includes()` exigem representações diferentes do mesmo path — quebra
  garantida.** `wildcard.mjs` (Fastify real, rota `/assets/*`): `/assets/a%20b.png` →
  `req.params["*"] = "a b.png"` (percent-**decodificado**, sem prefixo `/assets/`).
  `packages/client/src/lib/assets/assetApi.ts:229-236` (`assetUrl`) grava no documento a
  forma percent-**codificada** com o prefixo `/assets/` — confirmado por teste existente
  (`assetApi.test.ts:21`, `assetUrl("a b/c.png") === "/assets/a%20b/c.png"`). Qualquer
  escolha única de representação para o HMAC (item 3 do desenho) quebra o `includes()`
  (item 2), ou vice-versa, em **100%** dos casos com caractere especial — não é uma
  borda.
- **`region_maps` não está em `DOCUMENT_TABLES`.** `packages/shared/src/document.ts:281-294`
  lista 12 tabelas; `region_maps` não é uma delas. `store.ts:383-385` lança erro para
  tabela fora da allowlist. O único asset do mundo real usado como evidência no recon
  (`taverna-demo.jpg`, referenciado só por `region_maps`) **não pode ser autorizado**
  pelo `documentStore.get(table, id)` que o desenho propõe reaproveitar.
- **A enumeração de tabelas com ownership estava errada.** `migrations/001` cria 12
  tabelas de documento, não 7 — o recon citou o range `33-107`, que para exatamente
  antes das outras 5. `ownership` aparece 7 vezes em `documents/types.ts` (Actor, Item,
  Scene, JournalEntry, Macro, RollTable, Playlist); `users`, `folders`, `chat_messages`,
  `combats` e `settings` **não** declaram `ownership`. `users.avatar`
  (`types.ts:239`) é campo de path de asset numa tabela sem ownership — hoje latente
  (nenhum lugar no client lê `avatar`), mas o desenho isenta só `combats`, como se fosse
  o único caso especial.
- **O exemplo de dado real do terreno estava fabricado.** A cena `Ifau3CIXklXVgocW`
  ('aha', `ownership.default=0`) citada como "cena oculta com background servido sem
  checagem" **não tem `background`** (`undefined`) — e o arquivo citado como sendo o
  dela (`11237343496245_..._192-8fc539a3.png`) não é referenciado por nenhum documento
  em nenhuma tabela do `world.db` real (`scan.mjs`, busca do nome em todas as tabelas
  com coluna `data`). É um asset **órfão**. A cena oculta real com background é outra:
  `dCIvcMCUvrLT5krp` ('fdsfdsfdsf') → `/assets/vovo_sofa_2-a9ad968f.jpg`. A
  vulnerabilidade em si segue real (item acima); o exemplo ilustrativo é que estava
  errado — e é justamente esse tipo de detalhe que vira caso de teste.
- **`FilePicker` já é alcançável por PLAYER comum hoje, e já está quebrado.**
  `CharacterSheet.svelte:1194-1199` renderiza `<FilePicker>` atrás de `vm.editable`
  (ownership, não role — comentário explícito nas linhas 189/323, "gated by vm.editable
  (ownership), not by the Play/Edit toggle"). `FilePicker.svelte:64` chama
  `GET /api/assets`, que exige `role ≥ TRUSTED` — confirmado por teste existente
  (`assets.test.ts:637-643`, "returns 403 for PLAYER"). Um PLAYER dono do próprio
  personagem já não consegue trocar o próprio retrato hoje, e o item 5 do desenho ("mantém
  `role ≥ TRUSTED`, o FilePicker continua funcionando") só é verdade para TRUSTED+.

### Por que o desenho original morre (três pontos)

1. **O gate mede um dado que o próprio atacante escreve** — o jogador escolhe o
   documento e, em pelo menos um caso real (`Actor.img`), o conteúdo dele. Não fecha a
   vulnerabilidade, adiciona cerimônia por cima.
2. **HMAC e `includes()` não podem concordar sobre a mesma string** — uma decodificada
   sem prefixo, outra codificada com prefixo. Quebra garantida, não borda.
3. **`region_maps` fica fora da allowlist reaproveitada** — o desenho não consegue
   autorizar a única tabela de asset do mundo real citada como motivação da investigação.

### O que sobra para o desenho novo

- Precisa de uma prova de posse que o requisitante **não controle sozinho** — não pode
  ser "o campo X do documento Y contém o path", porque X é editável pelo próprio
  requisitante em pelo menos um caso real. Direções possíveis a avaliar (nenhuma fechada
  nesta rodada): registro de asset no write path (T020/T021, já no plano) como fonte de
  verdade de "quem referencia este arquivo", desacoplado do conteúdo arbitrário de
  outros documentos; ou índice reverso mantido incrementalmente (rejeitado no recon
  original por custo de manutenção — motivo a reavaliar, já que a alternativa proposta
  está morta).
- Precisa de uma representação única e documentada do path (decodificada vs. codificada,
  com ou sem prefixo `/assets/`), com teste cobrindo nome com caractere especial.
- Precisa decidir o que fazer com as 5 tabelas sem `ownership` (`users`, `folders`,
  `chat_messages`, `combats`, `settings`) — não é só o caso especial de `combats`.
- Precisa incluir `region_maps` explicitamente (allowlist própria para o endpoint, ou
  tratamento de ownership à parte).
- Precisa de uma história para asset **órfão** (sem documento nenhum referenciando) —
  hoje 25% dos arquivos do único mundo real disponível.
- Precisa lidar com (ou documentar como limitação aceita) a janela de debounce entre
  escolha otimista no cliente e persistência no servidor, e com o fato de que o
  `FilePicker` por jogador comum já está quebrado hoje, independente deste desenho —
  vale decidir junto se o fix também resolve isso.

---

## Lacuna: T014/T015 (recon falhou, não existe)

O recon para **T014** (`LIMIT ?` interpolado, `store.ts:444`) e **T015**
(`_tableHasColumn` derivado de `PRAGMA table_info`, `store.ts:456`) foi disparado nesta
rodada e **falhou antes de produzir resultado** — não existe `T014.json` nem `T015.json`
em `scratchpad/recon-fase-2/`. Nenhuma leitura de terreno, execução ou verificação de
premissa foi feita para essas duas tarefas nesta leva.

Não há "correção de escopo" vinda do recon — o enunciado em `tasks.md` era o único ponto de
partida. A verificação acabou acontecendo na implementação, e achou uma coisa que valia a
pena: **a lista manual de colunas de `_tableHasColumn` já estava divergente do banco.**
Comparada contra o `PRAGMA table_info` de um banco com as migrations 001–008 aplicadas,
faltavam `id` e `data` em todas as tabelas, e faltavam as cinco colunas que `users` ganhou
nas migrations 002 e 006 (`password_hash`, `color`, `avatar`, `active`, `preferences`).
Uma terceira cópia do schema que ninguém sincronizou é exatamente o defeito que T015
existia para matar.

---

## Defeitos vivos achados de passagem

Nenhum destes era tarefa de ninguém — apareceram como efeito colateral dos quatro recons
acima, ao ler/executar código adjacente ao que estava sob investigação.

| #   | Defeito                                                                                                                                                                                                  | Onde                                                                                                                  | Status nesta leva                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| (a) | Lote misto de `doc:update` (uma entry `embedded` + entries primárias) descarta as primárias em silêncio, com `ack.ok=true`                                                                               | `doc-handlers.ts:739` (roteamento `hasEmbedded`), `:1118` (`if (!upd.embedded) continue`)                             | **Em correção nesta leva** — ver T030                                                                                                   |
| (b) | Caminho genérico de `doc:update` (Scene sem `embedded`) grava `scene.tokens` sem passar pelos handlers dedicados nem pela guarda que Scene tem para `active`                                             | `doc-handlers.ts:~800` (guarda só cobre `active`), `:815`                                                             | **Em correção nesta leva** — ver T031                                                                                                   |
| (c) | Escritas que incrementam `_stats.version` sem emitir `doc:update`, deixando o mirror do cliente permanentemente atrasado                                                                                 | `etmos/reacao-handler.ts:254-277/351` (`applyEstresseCost`), `net/handlers/sync-handlers.ts:517/526-535` (cena ativa) | Backlog — ver T032                                                                                                                      |
| (d) | Log diário não rotaciona — nome do arquivo é congelado com data **UTC** no `createLogger`; sessão que atravessa meia-noite UTC (21h no fuso local, UTC-3) continua escrevendo no arquivo do dia anterior | `logger.ts:25-28/42-46/87`; reproduzido no log real (`fusion-2026-08-15.log`, 203 linhas cobrindo duas datas UTC)     | Backlog — ver T033                                                                                                                      |
| (e) | Rota de assets serve arquivo de documento oculto a jogador comum, sem checar `ownership` — reproduzido por execução, não é mais hipótese                                                                 | `assets/routes.ts:409-457` (`GET /assets/*`), único gate é `role ≥ PLAYER`                                            | Backlog — é o próprio escopo de **T025** (ver acima); reforçado aqui porque deixou de ser leitura de código e virou exploit reproduzido |

(a) e (b) foram atribuídos a esta leva porque são fechamentos pontuais, isolados dos
desenhos maiores (T013 e T016) que continuam em aberto — fechar o roteamento e a guarda
não exige decidir a política de `expectedVersion` nem o desenho novo de ponto único de
escrita de token.

### Dois achados que só apareceram ao implementar (b)

**(b2) `Actor.items` tem a mesma fuga, e é a perigosa.** A guarda de (b) foi escrita para
Scene, mas a abertura é da forma, não do tipo: qualquer coleção do `EMBEDDED_PARENT_MAP`
pode ser substituída em bloco pelo caminho genérico. `Actor.items` é o caso grave porque
ser OWNER de uma Scene significa GM na prática, enquanto **todo jogador é OWNER da própria
ficha**. Reproduzido contra o handler real: um `doc:update` de Actor com `items: [...]`
substituiu a coleção inteira, apagando a condição que existia e gravando um item de `type`
inexistente — passando por cima de `validateEmbeddedItemForSystem`, cuja docstring afirma
ser "o único lugar que valida Items embutidos". `Combat.combatants` fecha o terceiro caso.
A guarda entregue deriva do `EMBEDDED_PARENT_MAP` e cobre os três.

**(b3) O toggle de condição da ficha não funciona — nem antes, nem depois desta leva.**
Ao verificar se a guarda de `items` quebraria algum fluxo legítimo, apareceu que
`characterSheetVM.toggleCondition` e `npcSheetVM.toggleCondition` enviam
`diff: { "items.-<id>": true }` e `diff: { "items.+": {...} }`, e que **o servidor não
implementa esses operadores em lugar nenhum**. `applyDotPathDiff` expande o caminho
literalmente para `{ items: { "-<id>": true } }`, o `deepMerge` substitui o array pelo
objeto e a validação de schema reprova. Reproduzido: as duas formas voltam
`VALIDATION_FAILED` e o Actor fica intacto. Nenhum teste cobre o caminho — por isso passou
despercebido. Virou **T034**, e a guarda de (b2) foi deliberadamente escrita para recusar
**só o array**, para não trocar essa rejeição por outra e enterrar o defeito debaixo de uma
mensagem mais bonita.

---

## Desenhos derrubados — não tentar de novo

Registro curto, para quem for retomar não reconstruir o mesmo caminho:

- **T016**: uma função única `persistSceneTokens(store, {table:"scenes", ...}, ...)`
  hardcodada para a tabela `scenes` **morre** porque os 3 call sites de
  `doc-handlers.ts` que ela pretendia envolver são polimórficos sobre (tabela, coleção)
  — os mesmos três servem `actors`/`items`. Qualquer desenho novo precisa passar
  tabela/coleção como parâmetro, ou trabalhar num nível mais baixo (dentro do
  `DocumentStore`), não hardcoded no nome da tabela.
- **T025**: um token de asset amarrado a `{userId, path, exp}` com autorização decidida
  por `JSON.stringify(doc).includes(path)` **morre** em três pontos: (1) o predicado mede
  um dado que o próprio atacante escreve; (2) HMAC e `includes()` exigem representações
  de string incompatíveis do mesmo path; (3) a tabela do único exemplo real de asset do
  plano (`region_maps`) fica fora da allowlist reaproveitada. Qualquer desenho novo
  precisa de uma prova de posse que o requisitante não controle sozinho.

---

## Para quem retomar T013 / T016 / T025

- **T013**: o gate central (recusar `doc:update` sem `expectedVersion` para
  não-privilegiado) está certo na direção, mas só é seguro depois de (1) T030 fechar o
  desvio de lote misto e (2) o mirror do cliente ficar confiavelmente fresco (T032). O
  plano de teste precisa ganhar o caso de monotonicidade (reenviar versão já consumida).
  A política do lote mesmo-documento (coalescer no VM vs. incremento otimista) segue sem
  decisão.
- **T016**: comece mapeando os pelo menos 6 pontos de escrita de `scene.tokens`/`actor.items`
  (não uma lista de 4) antes de desenhar a função única. Decida se o "ponto único" bloqueia
  o caminho genérico (como T010 fez para `active`) ou instrumenta todos os caminhos. A
  instrumentação em log depende de T033 (rotação) para o "Pronto quando" original fazer
  sentido.
- **T025**: comece decidindo a prova de posse (não pode ser conteúdo de documento
  editável pelo requisitante). Resolva a representação única do path antes de tocar em
  HMAC. Inclua `region_maps` e as 5 tabelas sem `ownership` no desenho desde o início, não
  como exceção depois. Tem uma história pendente para asset órfão.
